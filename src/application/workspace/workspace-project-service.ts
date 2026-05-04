import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import XLSX from "xlsx";
// @ts-expect-error no bundled types
import WordExtractor from "word-extractor";
import { z } from "zod";
import { OpenAIClient, StructuredOutputParseError, type LlmConnectionValidationResult } from "../../infrastructure/llm/openai-client.js";
import { WorkspaceProjectRepository } from "../../infrastructure/files/workspace-project-repository.js";
import { buildFallbackChatDecision, type ChatDecision } from "./chat-rules.js";
import { MainAgentOrchestratorService } from "./main-agent-orchestrator-service.js";
import type {
  WorkspaceBundle,
  WorkspaceDesignComponent,
  WorkspaceDesignAsset,
  WorkspaceDesignFile,
  WorkspaceDesignImportResult,
  WorkspaceDesignNode,
  WorkspaceDesignNodeType,
  WorkspaceDesignPage,
  WorkspaceProjectDocument,
  WorkspaceLlmSettings,
  WorkspaceRequirementPointSection,
  WorkspaceProject,
  WorkspaceRequirementCollection,
  WorkspaceRequirementCollectionVersion,
  WorkspaceRequirementSourceRecord,
  WorkspaceRequirementSourceSummary,
  WorkspaceRequirementStructure,
  WorkspaceRequirementStructureVersion,
  WorkspaceStageDocument,
  WorkspaceStageDocumentVersion,
  WorkspaceSourceFileRecord,
  WorkspaceStageStateRecord,
  WorkspaceStageType
} from "../../shared/types/workspace.js";
import { nowIso } from "../../shared/utils/time.js";

const captureSchema = z.object({
  aiSummary: z.string(),
  structuredSnapshot: z.object({
    userGoals: z.array(z.string()).default([]),
    coreScenarios: z.array(z.string()).default([]),
    coreFunctions: z.array(z.string()).default([]),
    constraints: z.array(z.string()).default([])
  }),
  followupQuestions: z.array(z.string()).default([]),
  requirementsDocument: z.string().optional()
});

const captureChatSchema = z.object({
  mode: z.enum(["capture", "suggestion", "clarify", "answer"]),
  shouldCapture: z.boolean(),
  reply: z.string(),
  guidance: z.array(z.string()).default([])
});
type LlmChatDecision = z.infer<typeof captureChatSchema>;
type RuntimeChatDecision = ChatDecision & { model?: string };
type LlmSettingsSaveResult = {
  bundle: WorkspaceBundle;
  validation: {
    ok: boolean;
    model: string;
    baseUrl: string;
    message: string;
  };
};

type WorkspaceProjectDocumentSaveInput = {
  title: string;
  sortOrder: number;
  contentBlocks: unknown[];
  contentHtml: string;
  contentText: string;
  deleted?: boolean;
};

type WorkspaceDesignImportFile = {
  filename: string;
  mimeType: string;
  bytes: Buffer;
};

type SketchSharedStyleMaps = {
  layerStyleById: Map<string, Record<string, unknown>>;
  textStyleById: Map<string, Record<string, unknown>>;
};

const structureSchema = z.object({
  userGoals: z.array(z.string()).default([]),
  coreScenarios: z.array(z.string()).default([]),
  coreFunctions: z.array(z.string()).default([]),
  scope: z.object({
    inScope: z.array(z.string()).default([]),
    outOfScope: z.array(z.string()).default([])
  }),
  risks: z.array(z.string()).default([]),
  clarificationNeeded: z.array(z.string()).default([])
});

const stageOrder: WorkspaceStageType[] = [
  "requirement-collection",
  "requirement-structure",
  "requirement-clarification",
  "product-model",
  "prd",
  "prototype",
  "prototype-annotation",
  "ui-draft",
  "review"
];

interface SourceMaterial {
  id: string;
  title: string;
  sourceType: "record" | "file";
  text: string;
  note?: string;
}

export class WorkspaceProjectService {
  constructor(
    private readonly repository: WorkspaceProjectRepository,
    private readonly orchestrator: MainAgentOrchestratorService
  ) {}

  async createProject(input: {
    id: string;
    name: string;
    description: string;
    industry?: string;
    systemPrompt?: string;
    llmSettings?: Partial<WorkspaceLlmSettings>;
    apiKey?: string;
  }) {
    const project = this.repository.createDefaultProject(input);
    await this.repository.saveProject(project);
    await this.repository.saveStageState(project.id, this.repository.createDefaultStageState());
    await this.repository.saveLlmSettings(project.id, project.llmSettings, input.apiKey);
    return this.getBundle(project.id);
  }

  async getBundle(
    projectId: string,
    options?: {
      signal?: AbortSignal;
      onStatus?: (status: string) => void | Promise<void>;
      onLlmDelta?: (payload: { source: "stage-plan" | "main-agent"; delta: string }) => void | Promise<void>;
    }
  ) {
    return this.orchestrator.buildWorkspaceView(projectId, options);
  }

  async deleteProject(projectId: string) {
    await this.repository.deleteProject(projectId);
  }

  async saveLlmSettings(projectId: string, input: {
    provider: WorkspaceLlmSettings["provider"];
    baseUrl?: string;
    modelProfile: WorkspaceLlmSettings["modelProfile"];
    stageModelRouting?: WorkspaceLlmSettings["stageModelRouting"];
    apiKey?: string;
  }): Promise<LlmSettingsSaveResult> {
    const project = await this.repository.getProject(projectId);
    const settings: WorkspaceLlmSettings = {
      ...project.llmSettings,
      provider: input.provider,
      baseUrl: input.baseUrl,
      modelProfile: input.modelProfile,
      apiKeyConfigured: input.apiKey ? true : project.llmSettings.apiKeyConfigured,
      stageModelRouting: {
        ...project.llmSettings.stageModelRouting,
        ...(input.stageModelRouting ?? {})
      }
    };

    project.llmSettings = settings;
    project.updatedAt = nowIso();

    await this.repository.saveProject(project);
    await this.repository.saveLlmSettings(projectId, settings, input.apiKey);
    const validation = await this.validateProjectLlm(projectId, settings, input.apiKey);
    const bundle = await this.repository.buildBundle(projectId);
    return { bundle, validation };
  }

  async listProjectDocuments(projectId: string) {
    return this.repository.listProjectDocuments(projectId);
  }

  async createProjectDocument(projectId: string, input?: { title?: string }) {
    const existing = await this.repository.listProjectDocuments(projectId);
    const now = nowIso();
    const document: WorkspaceProjectDocument = {
      id: `doc-${Date.now()}`,
      projectId,
      title: input?.title?.trim() || `未命名文档 ${existing.length + 1}`,
      sortOrder: existing.length + 1,
      deleted: false,
      contentBlocks: [{ type: "paragraph", content: "" }],
      contentHtml: "<p></p>",
      contentText: "",
      createdAt: now,
      updatedAt: now
    };
    await this.repository.saveProjectDocument(document, "manual");
    return document;
  }

  async getProjectDocument(projectId: string, documentId: string) {
    return this.repository.getProjectDocument(projectId, documentId);
  }

  async saveProjectDocument(projectId: string, documentId: string, input: WorkspaceProjectDocumentSaveInput) {
    const existing = await this.repository.getProjectDocument(projectId, documentId);
    if (!existing) {
      throw new Error(`Document "${documentId}" not found.`);
    }

    const nextDocument: WorkspaceProjectDocument = {
      ...existing,
      title: input.title,
      sortOrder: input.sortOrder,
      deleted: input.deleted ?? existing.deleted,
      contentBlocks: input.contentBlocks,
      contentHtml: input.contentHtml,
      contentText: input.contentText,
      updatedAt: nowIso()
    };

    await this.repository.saveProjectDocument(nextDocument, "manual");
    return nextDocument;
  }

  async deleteProjectDocument(projectId: string, documentId: string) {
    await this.repository.deleteProjectDocument(projectId, documentId);
    return { ok: true, projectId, documentId };
  }

  async reorderProjectDocuments(projectId: string, orderedIds: string[]) {
    await this.repository.saveProjectDocumentOrder(projectId, orderedIds);
    return this.repository.listProjectDocuments(projectId);
  }

  async listProjectDocumentVersions(projectId: string, documentId: string) {
    return this.repository.listProjectDocumentVersions(projectId, documentId);
  }

  async getProjectDocumentVersion(projectId: string, documentId: string, versionId: string) {
    return this.repository.getProjectDocumentVersion(projectId, documentId, versionId);
  }

  async restoreProjectDocumentVersion(projectId: string, documentId: string, versionId: string) {
    const existing = await this.repository.getProjectDocument(projectId, documentId);
    const version = await this.repository.getProjectDocumentVersion(projectId, documentId, versionId);

    if (!existing || !version) {
      throw new Error(`Document version "${versionId}" not found.`);
    }

    const restored: WorkspaceProjectDocument = {
      id: existing.id,
      projectId: existing.projectId,
      title: version.title,
      sortOrder: existing.sortOrder,
      deleted: false,
      contentBlocks: version.contentBlocks,
      contentHtml: version.contentHtml,
      contentText: version.contentText,
      createdAt: existing.createdAt,
      updatedAt: nowIso()
    };

    await this.repository.saveProjectDocument(restored, "rollback");
    return restored;
  }

  async appendRequirementInput(projectId: string, message: string) {
    const project = await this.repository.getProject(projectId);
    const currentCollection = normalizeCollection(await this.getOrCreateCollection(project));
    const nextRecords = [...currentCollection.sourceRecords, createSourceRecord(message.trim())].filter((item) => item.content);
    const organized = await this.organizeCollection(project, nextRecords, currentCollection.uploadedFiles);
    return this.persistCollectionAndBundle(project, organized, "pending-review");
  }

  async chat(projectId: string, input: {
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  }, options?: {
    signal?: AbortSignal;
    onStatus?: (status: string) => void | Promise<void>;
    onLlmDelta?: (payload: { source: "chat-decision" | "source-summary" | "collection-organize"; delta: string }) => void | Promise<void>;
    onAssistantReady?: (assistant: {
      role: "assistant";
      type: "question" | "review" | "suggestion" | "normal";
      mode: "capture" | "suggestion" | "clarify" | "answer";
      captured: boolean;
      reply: string;
      guidance: string[];
    }) => void | Promise<void>;
  }) {
    await options?.onStatus?.("正在读取当前阶段上下文");
    const project = await this.repository.getProject(projectId);
    throwIfAborted(options?.signal);
    const collection = normalizeCollection(await this.getOrCreateCollection(project));
    await options?.onStatus?.("思考中...");
    const decision = await this.decideChatAction(project, collection, input.message, input.history ?? [], {
      signal: options?.signal,
      onLlmDelta: options?.onLlmDelta
    });
    throwIfAborted(options?.signal);

    const assistantReply = this.composeAssistantReply(decision.reply);
    await options?.onAssistantReady?.({
      role: "assistant",
      type: decision.mode === "capture" ? "question" : decision.mode === "suggestion" ? "suggestion" : "normal",
      mode: decision.mode,
      captured: decision.shouldCapture,
      reply: assistantReply,
      guidance: decision.guidance
    });

    let nextBundle = await this.repository.buildBundle(projectId);
    let nextCollection = collection;
    if (decision.shouldCapture) {
      await options?.onStatus?.("正在把这条输入收录进需求采集文档");
      const nextRecords = [...collection.sourceRecords, createSourceRecord(input.message.trim())].filter((item) => item.content);
      nextCollection = await this.organizeCollection(project, nextRecords, collection.uploadedFiles, collection.requirementsDocument, undefined, {
        signal: options?.signal,
        onLlmDelta: options?.onLlmDelta
      });
      throwIfAborted(options?.signal);
      await options?.onStatus?.("正在重新整理需求采集结果");
      nextBundle = await this.persistCollectionAndBundle(project, nextCollection, "pending-review", "ai");
    } else {
      await options?.onStatus?.("当前问题已回答");
      nextBundle = await this.repository.buildBundle(projectId);
    }
    throwIfAborted(options?.signal);
    await options?.onStatus?.("回复已准备完成");

    return {
      bundle: nextBundle,
      assistant: {
        role: "assistant" as const,
        type: decision.mode === "capture" ? "question" as const : decision.mode === "suggestion" ? "suggestion" as const : "normal" as const,
        mode: decision.mode,
        captured: decision.shouldCapture,
        reply: assistantReply,
        guidance: decision.guidance,
        modelOutput: {
          source: decision.decisionSource,
          model: decision.model,
          details: {
            currentStage: project.currentStage,
            chatDecision: {
              mode: decision.mode,
              shouldCapture: decision.shouldCapture,
              reply: decision.reply,
              guidance: decision.guidance
            },
            collectionSummary: {
              aiSummary: nextCollection.aiSummary,
              followupQuestions: nextCollection.followupQuestions,
              structuredSnapshot: nextCollection.structuredSnapshot
            },
            mainAgentDecision: nextBundle.mainAgentDecision ?? null,
            currentStageTaskPlan: nextBundle.currentStageTaskPlan ?? null
          }
        },
        collection: nextCollection
      }
    };
  }

  async getSourceFile(projectId: string, fileId: string) {
    const collection = await this.repository.getRequirementCollection(projectId);
    const file = collection.uploadedFiles.find((item) => item.id === fileId);
    if (!file?.storedFilename) {
      throw new Error("Source file not found");
    }

    const bytes = await this.repository.readSourceFile(projectId, file.storedFilename);
    return {
      file,
      bytes
    };
  }

  async uploadRequirementFiles(
    projectId: string,
    files: Array<{
      filename: string;
      mimeType: string;
      bytes: Buffer;
    }>
  ) {
    const project = await this.repository.getProject(projectId);
    const currentCollection = normalizeCollection(await this.getOrCreateCollection(project));
    const parsedFiles: WorkspaceSourceFileRecord[] = [];

    for (const file of files) {
      const stored = await this.repository.saveSourceFile(projectId, file.filename, file.bytes);
      const parsed = await parseWorkspaceFile({
        filename: file.filename,
        mimeType: file.mimeType,
        bytes: file.bytes,
        storedFilename: stored.storedFilename,
        relativePath: stored.relativePath,
        fullPath: stored.fullPath
      });
      parsedFiles.push(parsed);
    }

    const organized = await this.organizeCollection(
      project,
      currentCollection.sourceRecords,
      [...currentCollection.uploadedFiles, ...parsedFiles]
    );

    return this.persistCollectionAndBundle(project, organized, currentCollection.sourceRecords.length > 0 ? "pending-review" : "in-progress");
  }

  async getDesignFile(projectId: string): Promise<WorkspaceDesignFile> {
    const project = await this.repository.getProject(projectId);
    return this.repository.getDesignFile(projectId).catch(() => createInitialWorkspaceDesignFile(project.name));
  }

  async getDesignPage(projectId: string, pageId: string): Promise<WorkspaceDesignPage> {
    await this.repository.getProject(projectId);
    return this.repository.getDesignPage(projectId, pageId);
  }

  async saveDesignFile(projectId: string, designFile: WorkspaceDesignFile): Promise<WorkspaceDesignFile> {
    await this.repository.getProject(projectId);
    const normalized: WorkspaceDesignFile = {
      ...designFile,
      updatedAt: nowIso(),
      importedComponents: Array.isArray(designFile.importedComponents) ? designFile.importedComponents : [],
      importedAssets: Array.isArray(designFile.importedAssets) ? designFile.importedAssets : [],
      pages: Array.isArray(designFile.pages) && designFile.pages.length > 0 ? designFile.pages : createInitialWorkspaceDesignFile(designFile.name).pages
    };
    await this.repository.saveDesignFile(projectId, normalized);
    return this.repository.getDesignFile(projectId);
  }

  async importDesignFile(projectId: string, file: WorkspaceDesignImportFile): Promise<WorkspaceDesignFile> {
    const current = await this.getDesignFile(projectId);
    const imported = await importDesignSourceFile(file);
    const persisted = await this.persistImportedDesignAssets(projectId, imported);
    const nextFile: WorkspaceDesignFile = {
      ...current,
      pages: [...current.pages, ...persisted.pages],
      importedComponents: [...current.importedComponents, ...persisted.components],
      importedAssets: [...current.importedAssets, ...persisted.assets],
      updatedAt: nowIso()
    };
    return await this.repository.saveDesignFile(projectId, nextFile);
    // return this.repository.getDesignFile(projectId);
  }

  async getDesignAsset(projectId: string, assetId: string) {
    await this.repository.getProject(projectId);
    const bytes = await this.repository.readDesignAsset(projectId, assetId);
    return {
      bytes,
      mimeType: mimeTypeFromSketchImageRef(assetId)
    };
  }

  private async persistImportedDesignAssets(projectId: string, imported: WorkspaceDesignImportResult): Promise<WorkspaceDesignImportResult> {
    if (imported.assets.length === 0) {
      return imported;
    }

    const persistedAssets = await Promise.all(imported.assets.map(async (asset) => {
      const bytes = decodeDataUrl(asset.url);
      if (!bytes) {
        return asset;
      }
      const saved = await this.repository.saveDesignAsset(projectId, asset.name, bytes);
      return {
        ...asset,
        url: `/api/workspace/projects/${projectId}/design/assets/${encodeURIComponent(saved.storedFilename)}`
      };
    }));
    const assetByRef = new Map(persistedAssets.map((asset) => [asset.sourceRef, asset]));
    const rewriteNodeAssetUrl = (node: WorkspaceDesignNode): WorkspaceDesignNode => {
      const asset = node.sourceRef ? assetByRef.get(node.sourceRef) : undefined;
      const fillAsset = imported.assets.find((candidate) => candidate.url === node.fillImageUrl);
      const persistedFillAsset = fillAsset?.sourceRef ? assetByRef.get(fillAsset.sourceRef) : undefined;
      return {
        ...node,
        imageUrl: asset?.url ?? node.imageUrl,
        fillImageUrl: persistedFillAsset?.url ?? node.fillImageUrl
      };
    };

    return {
      pages: imported.pages.map((page) => ({
        ...page,
        nodes: page.nodes.map(rewriteNodeAssetUrl)
      })),
      components: imported.components.map((component) => ({
        ...component,
        nodes: component.nodes.map(rewriteNodeAssetUrl)
      })),
      assets: persistedAssets
    };
  }

  async updateRequirementDocument(projectId: string, document: string) {
    const project = await this.repository.getProject(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(project));
    const normalizedHtml = normalizeRichTextHtml(document);
    const nextCollection: WorkspaceRequirementCollection = {
      ...collection,
      requirementsDocument: richTextHtmlToText(normalizedHtml),
      requirementsDocumentHtml: normalizedHtml,
      lastEditedAt: nowIso()
    };
    return this.persistCollectionAndBundle(project, nextCollection, "pending-review", "manual");
  }

  async listRequirementDocumentVersions(projectId: string) {
    return this.repository.listRequirementCollectionVersions(projectId);
  }

  async rollbackRequirementDocumentVersion(projectId: string, versionId: string) {
    const project = await this.repository.getProject(projectId);
    const current = normalizeCollection(await this.getOrCreateCollection(project));
    const version = await this.repository.getRequirementCollectionVersion(projectId, versionId);
    const nextCollection: WorkspaceRequirementCollection = {
      ...current,
      aiSummary: `已回滚到 ${new Date(version.createdAt).toLocaleString("zh-CN")} 的历史版本。`,
      requirementsDocument: version.requirementsDocument,
      requirementsDocumentHtml: version.requirementsDocumentHtml,
      lastEditedAt: nowIso()
    };
    return this.persistCollectionAndBundle(project, nextCollection, "pending-review", "rollback");
  }

  async organizeRequirementDocument(projectId: string, instruction?: string) {
    const project = await this.repository.getProject(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(project));
    const fragments = splitFragments(collection.requirementsDocument);
    const organized = await this.organizeCollection(
      project,
      fragments.length > 0 ? fragments.map((item) => createSourceRecord(item)) : collection.sourceRecords,
      collection.uploadedFiles,
      collection.requirementsDocument,
      instruction
    );
    return this.persistCollectionAndBundle(project, organized, "pending-review", "ai");
  }

  async createRequirementSourceRecord(projectId: string, input: { content: string; parentId?: string }) {
    const project = await this.repository.getProject(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(project));
    const nextRecords = [...collection.sourceRecords, createSourceRecord(input.content, input.parentId)].filter((item) => item.content);
    return this.persistSourceRecordsOnly(project, collection, nextRecords);
  }

  async updateRequirementSourceRecord(projectId: string, recordId: string, content: string) {
    const project = await this.repository.getProject(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(project));
    const nextRecords = collection.sourceRecords.map((record) =>
      record.id === recordId
        ? { ...record, content: content.trim(), updatedAt: nowIso() }
        : record
    );
    return this.persistSourceRecordsOnly(project, collection, nextRecords);
  }

  async deleteRequirementSourceRecord(projectId: string, recordId: string) {
    const project = await this.repository.getProject(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(project));
    const nextRecords = removeSourceRecordTree(collection.sourceRecords, recordId);
    return this.persistSourceRecordsOnly(project, collection, nextRecords);
  }

  async updateRequirementStructureDocument(projectId: string, documentHtml: string) {
    const bundle = await this.ensureBundle(projectId);
    const structure = await this.repository.getRequirementStructure(projectId);
    const normalizedHtml = normalizeRichTextHtml(documentHtml);
    const nextStructure: WorkspaceRequirementStructure = {
      ...structure,
      documentHtml: normalizedHtml,
      documentMarkdown: richTextHtmlToText(normalizedHtml),
      lastEditedAt: nowIso()
    };
    await this.repository.saveRequirementStructure(projectId, nextStructure, "manual");
    return this.getBundle(projectId);
  }

  async generateStageDocument(
    projectId: string,
    stage: "requirement-clarification" | "product-model" | "prd" | "prototype"
  ) {
    const bundle = await this.ensureBundle(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(bundle.project));
    const structure = await this.repository.getRequirementStructure(projectId).catch(() => null);

    if (!structure && ["requirement-clarification", "product-model", "prd", "prototype"].includes(stage)) {
      throw new Error("请先完成需求结构化阶段");
    }

    const document = await this.buildStageDocument(bundle.project, stage, {
      collection,
      structure: structure ?? undefined,
      clarification: await this.repository.getStageDocument(projectId, "requirement-clarification").catch(() => undefined),
      productModel: await this.repository.getStageDocument(projectId, "product-model").catch(() => undefined),
      prd: await this.repository.getStageDocument(projectId, "prd").catch(() => undefined)
    });

    await this.repository.saveStageDocument(projectId, stage, document, "ai");
    await this.advanceProjectToStage(projectId, stage);
    return this.getBundle(projectId);
  }

  async updateStageDocument(
    projectId: string,
    stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
    documentHtml: string
  ) {
    const existing = await this.repository.getStageDocument(projectId, stage);
    const normalizedHtml = normalizeRichTextHtml(documentHtml);
    const nextDocument: WorkspaceStageDocument = {
      ...existing,
      documentHtml: normalizedHtml,
      documentMarkdown: richTextHtmlToText(normalizedHtml),
      lastEditedAt: nowIso()
    };
    await this.repository.saveStageDocument(projectId, stage, nextDocument, "manual");
    return this.getBundle(projectId);
  }

  async listStageDocumentVersions(
    projectId: string,
    stage: "requirement-clarification" | "product-model" | "prd" | "prototype"
  ) {
    return this.repository.listStageDocumentVersions(projectId, stage);
  }

  async rollbackStageDocumentVersion(
    projectId: string,
    stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
    versionId: string
  ) {
    const existing = await this.repository.getStageDocument(projectId, stage);
    const version = await this.repository.getStageDocumentVersion(projectId, stage, versionId);
    const nextDocument: WorkspaceStageDocument = {
      ...existing,
      summary: version.summary,
      documentMarkdown: version.documentMarkdown,
      documentHtml: version.documentHtml,
      lastEditedAt: nowIso()
    };
    await this.repository.saveStageDocument(projectId, stage, nextDocument, "rollback");
    return this.getBundle(projectId);
  }

  async listRequirementStructureVersions(projectId: string) {
    return this.repository.listRequirementStructureVersions(projectId);
  }

  async rollbackRequirementStructureVersion(projectId: string, versionId: string) {
    const structure = await this.repository.getRequirementStructure(projectId);
    const version = await this.repository.getRequirementStructureVersion(projectId, versionId);
    const nextStructure: WorkspaceRequirementStructure = {
      ...structure,
      documentMarkdown: version.documentMarkdown,
      documentHtml: version.documentHtml,
      lastEditedAt: nowIso()
    };
    await this.repository.saveRequirementStructure(projectId, nextStructure, "rollback");
    return this.getBundle(projectId);
  }

  async rollbackStage(projectId: string, targetStage: WorkspaceStageType) {
    const bundle = await this.ensureBundle(projectId);
    const nextStates = this.rollbackStates(bundle.project.currentStage, targetStage);
    const nextProject: WorkspaceProject = {
      ...bundle.project,
      currentStage: targetStage,
      updatedAt: nowIso()
    };
    await this.repository.saveProject(nextProject);
    await this.repository.saveStageState(projectId, nextStates);
    return this.getBundle(projectId);
  }

  async generateRequirementStructure(projectId: string) {
    const bundle = await this.ensureBundle(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(bundle.project));
    const structure = await this.buildRequirementStructure(bundle.project, collection);
    await this.repository.saveRequirementStructure(projectId, structure, "ai");

    const nextProject: WorkspaceProject = {
      ...bundle.project,
      currentStage: "requirement-structure",
      updatedAt: nowIso()
    };
    await this.repository.saveProject(nextProject);
    const nextStates = this.advanceToStructure();
    await this.repository.saveStageState(projectId, nextStates);
    return this.getBundle(projectId);
  }

  private async ensureBundle(projectId: string) {
    return this.getBundle(projectId);
  }

  private composeAssistantReply(primary: string) {
    return primary.trim();
  }

  private async validateProjectLlm(
    projectId: string,
    settings: WorkspaceLlmSettings,
    apiKey?: string
  ): Promise<LlmConnectionValidationResult> {
    if (settings.provider !== "openai" && settings.provider !== "openai-compatible") {
      return {
        ok: false,
        model: settings.stageModelRouting.capture ?? process.env.OPENAI_MODEL ?? "gpt-5-mini",
        baseUrl: settings.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        message: `当前 provider ${settings.provider} 暂不支持轻量连接校验。`
      };
    }

    const resolvedApiKey = apiKey?.trim()
      || await this.repository.getStoredApiKey(projectId)
      || process.env.OPENAI_API_KEY;
    const model = settings.stageModelRouting.capture ?? process.env.OPENAI_MODEL ?? "gpt-5-mini";
    const client = new OpenAIClient(
      resolvedApiKey,
      settings.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model
    );

    return client.validateConnection();
  }

  private async getOrCreateCollection(project: WorkspaceProject) {
    try {
      return normalizeCollection(await this.repository.getRequirementCollection(project.id));
    } catch {
      return {
        projectName: project.name,
        rawInputs: [],
        sourceRecords: [],
        uploadedFiles: [],
        extractedHighlights: [],
        aiSummary: "尚未整理需求采集信息。",
        requirementsDocument: `# ${project.name} 需求采集文档\n\n## 当前状态\n- 尚未输入需求点\n`,
        requirementsDocumentHtml: markdownLikeToHtml(`# ${project.name} 需求采集文档\n\n## 当前状态\n- 尚未输入需求点\n`),
        structuredSnapshot: {
          userGoals: [],
          coreScenarios: [],
          coreFunctions: [],
          constraints: []
        },
        sourceDirty: false,
        lastSourceUpdatedAt: undefined,
        lastOrganizedSourceUpdatedAt: undefined,
        followupQuestions: ["请先补充一句话需求或上传文档。"],
        lastOrganizedAt: nowIso()
      } satisfies WorkspaceRequirementCollection;
    }
  }

  private async persistCollectionAndBundle(
    project: WorkspaceProject,
    collection: WorkspaceRequirementCollection,
    status: WorkspaceStageStateRecord["status"],
    source: WorkspaceRequirementCollectionVersion["source"] = "ai"
  ) {
    const normalized = normalizeCollection(collection);
    const nextProject: WorkspaceProject = {
      ...project,
      currentStage: "requirement-collection",
      updatedAt: nowIso()
    };
    await this.repository.saveProject(nextProject);
    await this.repository.saveRequirementCollection(project.id, normalized, source);
    await this.repository.saveStageState(project.id, this.createStageStatesForCollection(status));
    return this.repository.buildBundle(project.id);
  }

  private async persistSourceRecordsOnly(
    project: WorkspaceProject,
    collection: WorkspaceRequirementCollection,
    sourceRecords: WorkspaceRequirementSourceRecord[]
  ) {
    const latestSourceUpdatedAt = getLatestSourceUpdatedAt(sourceRecords, collection.uploadedFiles);
    const nextCollection: WorkspaceRequirementCollection = {
      ...collection,
      sourceRecords,
      rawInputs: sourceRecordsToRawInputs(sourceRecords),
      sourceDirty: sourceRecords.length > 0 || collection.uploadedFiles.length > 0,
      lastSourceUpdatedAt: latestSourceUpdatedAt,
      lastEditedAt: nowIso()
    };
    return this.persistCollectionAndBundle(project, nextCollection, "pending-review", "manual");
  }

  async confirmAdvanceToNextStage(projectId: string) {
    const bundle = await this.getBundle(projectId);
    const decision = bundle.mainAgentDecision;
    const nextStage = decision?.suggestedNextStage;

    if (!decision || !decision.canAdvance || !nextStage) {
      const error = new Error("Current stage is not ready to advance");
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }

    if (bundle.project.currentStage === "requirement-collection" && nextStage === "requirement-structure") {
      return this.generateRequirementStructure(projectId);
    }

    const stages = await this.repository.getStageState(projectId);
    const nextStates = stages.map((state) => {
      if (state.stage === bundle.project.currentStage) {
        return { ...state, status: "completed" as const, updatedAt: nowIso() };
      }
      if (state.stage === nextStage) {
        return { ...state, status: "in-progress" as const, updatedAt: nowIso() };
      }
      return state;
    });

    await this.repository.saveStageState(projectId, nextStates);
    await this.repository.saveProject({
      ...bundle.project,
      currentStage: nextStage,
      updatedAt: nowIso()
    });
    return this.getBundle(projectId);
  }

  private createStageStatesForCollection(status: WorkspaceStageStateRecord["status"]) {
    const now = nowIso();
    return stageOrder.map((stage, index) => ({
      stage,
      status: index === 0 ? status : "not-started",
      updatedAt: now
    })) satisfies WorkspaceStageStateRecord[];
  }

  private advanceToStructure() {
    const now = nowIso();
    return stageOrder.map((stage, index) => {
      if (index === 0) {
        return { stage, status: "completed", updatedAt: now } as const;
      }
      if (index === 1) {
        return { stage, status: "in-progress", updatedAt: now } as const;
      }
      return { stage, status: "not-started", updatedAt: now } as const;
    });
  }

  private rollbackStates(currentStage: WorkspaceStageType, targetStage: WorkspaceStageType) {
    const now = nowIso();
    const targetIndex = stageOrder.indexOf(targetStage);
    return stageOrder.map((stage, index) => {
      if (index < targetIndex) {
        return { stage, status: "completed", updatedAt: now } as const;
      }
      if (index === targetIndex) {
        return { stage, status: "in-progress", updatedAt: now } as const;
      }
      return { stage, status: "pending-review", updatedAt: now } as const;
    });
  }

  private async organizeCollection(
    project: WorkspaceProject,
    sourceRecords: WorkspaceRequirementSourceRecord[],
    uploadedFiles: WorkspaceSourceFileRecord[],
    currentDocument?: string,
    instruction?: string,
    options?: {
      signal?: AbortSignal;
      onLlmDelta?: (payload: { source: "source-summary" | "collection-organize"; delta: string }) => void | Promise<void>;
    }
  ): Promise<WorkspaceRequirementCollection> {
    const rawInputs = sourceRecordsToRawInputs(sourceRecords);
    const llm = await this.createProjectLlm(project, "capture");
    const materials = await this.buildSourceMaterials(project.id, sourceRecords, uploadedFiles);
    const extractedHighlights = materials
      .flatMap((material) => splitFragments(material.text))
      .slice(0, 80);
    const fallback = heuristicCollection(project.name, rawInputs, sourceRecords, uploadedFiles, extractedHighlights, materials);

    console.info("[AIPM][Capture] organize:start", {
      projectId: project.id,
      sourceRecordCount: sourceRecords.length,
      uploadedFileCount: uploadedFiles.length,
      materialCount: materials.length,
      extractedHighlightCount: extractedHighlights.length,
      hasCurrentDocument: Boolean(currentDocument?.trim()),
      hasInstruction: Boolean(instruction?.trim())
    });

    if (!llm) {
      console.warn("[AIPM][Capture] organize:fallback-heuristic", {
        projectId: project.id,
        sourceRecordCount: sourceRecords.length,
        uploadedFileCount: uploadedFiles.length
      });
      return fallback;
    }

    const sourceSummaries = this.buildSinglePassSourceSummaries(materials);
    const sourceContext = this.buildSinglePassSourceContext(materials);
    const organizeSystemPrompt = `${project.systemPrompt ?? "你是资深产品经理。"}\n请基于全部来源内容，一次性整理需求采集结果。重点是保留全部需求点，做去重、合并、轻度润色和层级整理，不要把内容过度压缩成少量摘要。不要遗漏后面的来源。requirementsDocument 应该是一份完整、可继续编辑的需求点文档。`;
    const organizeUserPrompt = JSON.stringify({
      projectName: project.name,
      rawInputs,
      sourceRecords,
      currentDocument,
      instruction,
      sourceContext,
      sourceSummaries,
      uploadedFiles: uploadedFiles.map((file) => ({
        name: file.name,
        extractedTextExcerpt: file.extractedTextExcerpt,
        note: file.note
      })),
      extractedHighlights
    }, null, 2);

    try {
      console.info("[AIPM][Capture] source-summaries:built", {
        projectId: project.id,
        summaryCount: sourceSummaries.length
      });
      const promptArgs = {
        systemPrompt: organizeSystemPrompt,
        userPrompt: organizeUserPrompt,
        temperature: 0.3,
        signal: options?.signal
      } as const;
      const result = options?.onLlmDelta
        ? await llm.generateJsonStream(captureSchema, {
            ...promptArgs,
            onToken: async (delta) => {
              await options.onLlmDelta?.({ source: "collection-organize", delta });
            }
          })
        : await llm.generateJson(captureSchema, promptArgs);
      await this.repository.saveLlmLog(project.id, {
        stage: "requirement-collection",
        step: "collection-organize",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt: organizeSystemPrompt,
        userPrompt: organizeUserPrompt,
        parsedOutput: result
      });

      const requirementPointSections = buildRequirementPointSections({
        sourceRecords,
        uploadedFiles,
        materials,
        extractedHighlights,
        currentDocument
      });
      const requirementsDocument = renderCollectionDocument({
        projectName: project.name,
        summary: result.aiSummary,
        requirementPointSections,
        userGoals: result.structuredSnapshot.userGoals,
        coreScenarios: result.structuredSnapshot.coreScenarios,
        coreFunctions: result.structuredSnapshot.coreFunctions,
        constraints: result.structuredSnapshot.constraints,
        followupQuestions: result.followupQuestions.length > 0 ? result.followupQuestions : fallback.followupQuestions
      });

      return {
        ...fallback,
        aiSummary: result.aiSummary,
        requirementPointSections,
        requirementsDocument,
        requirementsDocumentHtml: markdownLikeToHtml(requirementsDocument),
        sourceSummaries,
        structuredSnapshot: result.structuredSnapshot,
        sourceDirty: false,
        lastSourceUpdatedAt: getLatestSourceUpdatedAt(sourceRecords, uploadedFiles),
        lastOrganizedSourceUpdatedAt: nowIso(),
        followupQuestions: result.followupQuestions.length > 0 ? result.followupQuestions : fallback.followupQuestions,
        lastOrganizedAt: nowIso()
      };
    } catch (error) {
      await this.repository.saveLlmLog(project.id, {
        stage: "requirement-collection",
        step: "collection-organize-error",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt: organizeSystemPrompt,
        userPrompt: organizeUserPrompt,
        outputText: error instanceof StructuredOutputParseError ? error.rawText : undefined,
        parsedOutput: error instanceof StructuredOutputParseError ? { extractedJson: error.extractedJson } : undefined,
        error: error instanceof Error ? error.message : "Unknown organizeCollection error"
      });
      console.error("[AIPM][Capture] organize:error-fallback", {
        projectId: project.id
      });
      return fallback;
    }
  }

  private async buildRequirementStructure(
    project: WorkspaceProject,
    collection: WorkspaceRequirementCollection
  ): Promise<WorkspaceRequirementStructure> {
    const llm = await this.createProjectLlm(project, "structure");
    const fallback = heuristicStructure(collection);

    if (!llm) {
      return fallback;
    }

    try {
      const systemPrompt = `${project.systemPrompt ?? "你是资深产品经理。"}\n请基于需求采集文档输出结构化需求。`;
      const userPrompt = collection.requirementsDocument;
      const result = await llm.generateJson(structureSchema, {
        systemPrompt,
        userPrompt,
        temperature: 0.25
      });
      await this.repository.saveLlmLog(project.id, {
        stage: "requirement-structure",
        step: "requirement-structure",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt,
        userPrompt,
        parsedOutput: result
      });
      const structure: WorkspaceRequirementStructure = {
        ...result,
        documentMarkdown: "",
        documentHtml: "",
        lastGeneratedAt: nowIso()
      };
      structure.documentMarkdown = renderRequirementStructureMarkdown(structure);
      structure.documentHtml = markdownLikeToHtml(structure.documentMarkdown);
      return structure;
    } catch (error) {
      await this.repository.saveLlmLog(project.id, {
        stage: "requirement-structure",
        step: "requirement-structure-error",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt: `${project.systemPrompt ?? "你是资深产品经理。"}\n请基于需求采集文档输出结构化需求。`,
        userPrompt: collection.requirementsDocument,
        outputText: error instanceof StructuredOutputParseError ? error.rawText : undefined,
        parsedOutput: error instanceof StructuredOutputParseError ? { extractedJson: error.extractedJson } : undefined,
        error: error instanceof Error ? error.message : "Unknown buildRequirementStructure error"
      });
      return fallback;
    }
  }

  private async buildStageDocument(
    project: WorkspaceProject,
    stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
    context: {
      collection: WorkspaceRequirementCollection;
      structure?: WorkspaceRequirementStructure;
      clarification?: WorkspaceStageDocument;
      productModel?: WorkspaceStageDocument;
      prd?: WorkspaceStageDocument;
    }
  ): Promise<WorkspaceStageDocument> {
    const llm = await this.createProjectLlm(project, "structure");
    const fallback = buildFallbackStageDocument(project.name, stage, context);

    if (!llm) {
      return fallback;
    }

    try {
      const systemPrompt = `${project.systemPrompt ?? "你是资深产品经理。"}\n请输出${labelStageForPrompt(stage)}的正式文档草案。要求：1）自然、专业；2）使用清晰标题和列表；3）只输出 Markdown 文档正文；4）不要输出 JSON。`;
      const userPrompt = JSON.stringify({
          project: {
            name: project.name,
            description: project.description,
            currentStage: project.currentStage
          },
          stage,
          requirementCollection: {
            aiSummary: context.collection.aiSummary,
            requirementsDocument: context.collection.requirementsDocument,
            structuredSnapshot: context.collection.structuredSnapshot,
            followupQuestions: context.collection.followupQuestions
          },
          requirementStructure: context.structure ?? null,
          clarification: context.clarification?.documentMarkdown ?? null,
          productModel: context.productModel?.documentMarkdown ?? null,
          prd: context.prd?.documentMarkdown ?? null
        }, null, 2);
      const markdown = await llm.generateText({
        systemPrompt,
        userPrompt,
        temperature: 0.25
      });
      await this.repository.saveLlmLog(project.id, {
        stage,
        step: `${stage}-document`,
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt,
        userPrompt,
        outputText: markdown
      });

      return {
        ...fallback,
        summary: firstNonEmptyLine(markdown) ?? fallback.summary,
        documentMarkdown: markdown.trim(),
        documentHtml: markdownLikeToHtml(markdown),
        sections: buildStageDocumentSections(stage, markdown),
        lastGeneratedAt: nowIso()
      };
    } catch (error) {
      await this.repository.saveLlmLog(project.id, {
        stage,
        step: `${stage}-document-error`,
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt: `${project.systemPrompt ?? "你是资深产品经理。"}\n请输出${labelStageForPrompt(stage)}的正式文档草案。要求：1）自然、专业；2）使用清晰标题和列表；3）只输出 Markdown 文档正文；4）不要输出 JSON。`,
        userPrompt: JSON.stringify({
          project: {
            name: project.name,
            description: project.description,
            currentStage: project.currentStage
          },
          stage
        }, null, 2),
        outputText: error instanceof StructuredOutputParseError ? error.rawText : undefined,
        parsedOutput: error instanceof StructuredOutputParseError ? { extractedJson: error.extractedJson } : undefined,
        error: error instanceof Error ? error.message : "Unknown buildStageDocument error"
      });
      return fallback;
    }
  }

  private async advanceProjectToStage(projectId: string, targetStage: WorkspaceStageType) {
    const bundle = await this.ensureBundle(projectId);
    const currentIndex = stageOrder.indexOf(bundle.project.currentStage);
    const targetIndex = stageOrder.indexOf(targetStage);
    const now = nowIso();
    const nextStates = stageOrder.map((stage, index) => {
      if (index < targetIndex) {
        return { stage, status: "completed" as const, updatedAt: now };
      }
      if (index === targetIndex) {
        return { stage, status: "in-progress" as const, updatedAt: now };
      }
      if (index > targetIndex && index <= currentIndex) {
        return { stage, status: "pending-review" as const, updatedAt: now };
      }
      return { stage, status: "not-started" as const, updatedAt: now };
    });

    await this.repository.saveStageState(projectId, nextStates);
    await this.repository.saveProject({
      ...bundle.project,
      currentStage: targetStage,
      updatedAt: now
    });
  }

  private async buildSourceMaterials(
    projectId: string,
    sourceRecords: WorkspaceRequirementSourceRecord[],
    uploadedFiles: WorkspaceSourceFileRecord[]
  ) {
    const recordMaterials = buildSourceRecordMaterials(sourceRecords);
    const fileMaterials = await Promise.all(
      uploadedFiles.map(async (file) => {
        const text = await this.readFullUploadedFileText(projectId, file);
        return {
          id: file.id,
          title: file.name,
          sourceType: "file" as const,
          text: text?.trim() || file.extractedTextExcerpt?.trim() || file.note || "",
          note: file.note
        };
      })
    );

    const materials = [...recordMaterials, ...fileMaterials].filter((material) => material.text.trim().length > 0);
    console.info("[AIPM][Capture] source-materials", {
      projectId,
      recordMaterials: recordMaterials.length,
      fileMaterials: fileMaterials.length,
      totalMaterials: materials.length,
      materialChars: materials.reduce((sum, item) => sum + item.text.length, 0)
    });
    return materials;
  }

  private async readFullUploadedFileText(projectId: string, file: WorkspaceSourceFileRecord) {
    if (!file.storedFilename || file.extractionStatus !== "parsed") {
      return file.extractedTextExcerpt;
    }

    try {
      const bytes = await this.repository.readSourceFile(projectId, file.storedFilename);
      const parsed = await extractWorkspaceFileText({
        filename: file.name,
        mimeType: file.mimeType,
        bytes,
        fullPath: this.repository.projectSourceFilePath(projectId, file.storedFilename)
      });
      return parsed.text?.trim() || file.extractedTextExcerpt;
    } catch {
      return file.extractedTextExcerpt;
    }
  }

  private async createProjectLlm(project: WorkspaceProject, stage: "capture" | "structure") {
    const settings = await this.repository.getLlmSettings(project.id);
    if (settings.provider !== "openai" && settings.provider !== "openai-compatible") {
      console.warn("[AIPM][LLM] disabled:unsupported-provider", {
        projectId: project.id,
        stage,
        provider: settings.provider
      });
      return null;
    }

    const apiKey = await this.repository.getStoredApiKey(project.id) ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn("[AIPM][LLM] disabled:missing-api-key", {
        projectId: project.id,
        stage,
        provider: settings.provider,
        baseUrl: settings.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
      });
      return null;
    }

    const model = settings.stageModelRouting[stage] ?? process.env.OPENAI_MODEL ?? (stage === "capture" ? "gpt-5-mini" : "gpt-5.2");
    console.info("[AIPM][LLM] enabled", {
      projectId: project.id,
      stage,
      provider: settings.provider,
      model,
      baseUrl: settings.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
    });

    return new OpenAIClient(
      apiKey,
      settings.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model
    );
  }

  private buildSinglePassSourceSummaries(materials: SourceMaterial[]): WorkspaceRequirementSourceSummary[] {
    return materials.map((material) => {
      const fragments = splitFragments(material.text);
      return {
        id: material.id,
        title: material.title,
        sourceType: material.sourceType,
        summary: summarizeText(material.text, 240),
        keyPoints: fragments.slice(0, 8),
        candidateUserGoals: classify(fragments, ["目标", "提升", "效率", "增长", "希望", "价值", "帮助"]).slice(0, 4),
        candidateScenarios: classify(fragments, ["场景", "流程", "使用", "协作", "聊天", "上传", "跟踪"]).slice(0, 4),
        candidateFunctions: classify(fragments, ["支持", "功能", "编辑", "上传", "预览", "导出", "回滚", "管理"]).slice(0, 5),
        candidateConstraints: classify(fragments, ["本地", "安全", "版本", "约束", "必须", "限制"]).slice(0, 4),
        openQuestions: classify(fragments, ["待确认", "不清楚", "问题", "风险", "建议"]).slice(0, 4)
      };
    });
  }

  private buildSinglePassSourceContext(materials: SourceMaterial[], maxChars = 18000) {
    const blocks: string[] = [];
    let usedChars = 0;

    for (const material of materials) {
      const content = material.text.trim();
      if (!content) {
        continue;
      }

      const remaining = maxChars - usedChars;
      if (remaining <= 0) {
        break;
      }

      const truncated = content.length > remaining ? `${content.slice(0, Math.max(0, remaining - 20))}\n...[内容过长，已截断]` : content;
      const block = [
        `来源标题：${material.title}`,
        `来源类型：${material.sourceType}`,
        material.note ? `备注：${material.note}` : undefined,
        "来源内容：",
        truncated
      ].filter(Boolean).join("\n");

      blocks.push(block);
      usedChars += block.length + 2;
    }

    return blocks.join("\n\n---\n\n");
  }

  private async decideChatAction(
    project: WorkspaceProject,
    collection: WorkspaceRequirementCollection,
    message: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    options?: {
      signal?: AbortSignal;
      onLlmDelta?: (payload: { source: "chat-decision"; delta: string }) => void | Promise<void>;
    }
  ): Promise<RuntimeChatDecision> {
    const llm = await this.createProjectLlm(project, "capture");
    const fallback = buildFallbackChatDecision(message, collection);

    if (!llm) {
      return fallback;
    }

    try {
      const systemPrompt = `${project.systemPrompt ?? "你是资深产品经理。"}\n你正在和用户一起做需求采集。你的任务是判断用户当前输入应该：1) 收录进需求采集文档；2) 仅给建议；3) 追问澄清；4) 直接回答问题。reply 要自然、像协作中的产品专家。如果用户输入本身是在描述需求、诉求、评论、补充说明，默认 shouldCapture=true，不要先反问用户是否确认收录。完成当前阶段整理后，应停留在当前阶段供真人 review，而不是主动催促进入下一阶段。`;
      const userPrompt = JSON.stringify({
        message,
        history: history.slice(-8),
        currentSummary: collection.aiSummary,
        currentFollowupQuestions: collection.followupQuestions,
        currentStructuredSnapshot: collection.structuredSnapshot
      }, null, 2);
      const result = options?.onLlmDelta
        ? await llm.generateJsonStream(captureChatSchema, {
            systemPrompt,
            userPrompt,
            temperature: 0.2,
            signal: options?.signal,
            onToken: async (delta) => {
              await options.onLlmDelta?.({ source: "chat-decision", delta });
            }
          })
        : await llm.generateJson(captureChatSchema, {
            systemPrompt,
            userPrompt,
            temperature: 0.2
          });
      await this.repository.saveLlmLog(project.id, {
        stage: "chat",
        step: "chat-decision",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt,
        userPrompt,
        parsedOutput: result
      });
      const resultDecision: RuntimeChatDecision = {
        ...result,
        decisionSource: "llm",
        model: llm.model
      };
      return resultDecision;
    } catch (error) {
      await this.repository.saveLlmLog(project.id, {
        stage: "chat",
        step: "chat-decision-error",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt: `${project.systemPrompt ?? "你是资深产品经理。"}\n你正在和用户一起做需求采集。你的任务是判断用户当前输入应该：1) 收录进需求采集文档；2) 仅给建议；3) 追问澄清；4) 直接回答问题。reply 要自然、像协作中的产品专家。如果用户输入本身是在描述需求、诉求、评论、补充说明，默认 shouldCapture=true，不要先反问用户是否确认收录。完成当前阶段整理后，应停留在当前阶段供真人 review，而不是主动催促进入下一阶段。`,
        userPrompt: JSON.stringify({
          message,
          history: history.slice(-8),
          currentSummary: collection.aiSummary,
          currentFollowupQuestions: collection.followupQuestions,
          currentStructuredSnapshot: collection.structuredSnapshot
        }, null, 2),
        outputText: error instanceof StructuredOutputParseError ? error.rawText : undefined,
        parsedOutput: error instanceof StructuredOutputParseError ? { extractedJson: error.extractedJson } : undefined,
        error: error instanceof Error ? error.message : "Unknown decideChatAction error"
      });
      console.log(error);
      return fallback;
    }
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const reason = signal.reason instanceof Error ? signal.reason : new Error("Chat stream aborted");
    throw reason;
  }
}

async function parseWorkspaceFile(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  storedFilename: string;
  relativePath: string;
  fullPath: string;
}): Promise<WorkspaceSourceFileRecord> {
  const uploadedAt = nowIso();
  const parsed = await extractWorkspaceFileText(input);
  return buildSourceRecord(input, uploadedAt, parsed.status, parsed.text, parsed.note);
}

function buildSourceRecord(
  input: {
    filename: string;
    mimeType: string;
    bytes: Buffer;
    storedFilename: string;
    relativePath: string;
    fullPath: string;
  },
  uploadedAt: string,
  extractionStatus: WorkspaceSourceFileRecord["extractionStatus"],
  extractedText?: string,
  note?: string
): WorkspaceSourceFileRecord {
  return {
    id: `${Date.now()}-${input.storedFilename}`,
    name: input.filename,
    storedFilename: input.storedFilename,
    relativePath: input.relativePath,
    mimeType: input.mimeType || "application/octet-stream",
    size: input.bytes.byteLength,
    uploadedAt,
    extractionStatus,
    extractedTextExcerpt: extractedText ? extractedText.slice(0, 4000) : undefined,
    note
  };
}

async function extractWorkspaceFileText(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  fullPath: string;
}) {
  const extension = extname(input.filename).toLowerCase();

  try {
    if (isTextLike(extension, input.mimeType)) {
      return {
        status: "parsed" as const,
        text: input.bytes.toString("utf-8").trim(),
        note: "已提取文本内容。"
      };
    }

    if (extension === ".pdf") {
      const parser = new PDFParse({ data: input.bytes });
      try {
        const parsed = await parser.getText();
        return {
          status: "parsed" as const,
          text: parsed.text.trim(),
          note: "已解析 PDF 文本。"
        };
      } finally {
        await parser.destroy();
      }
    }

    if (extension === ".docx") {
      const parsed = await mammoth.extractRawText({ buffer: input.bytes });
      return {
        status: "parsed" as const,
        text: parsed.value.trim(),
        note: "已解析 DOCX 文本。"
      };
    }

    if (extension === ".doc") {
      const extractor = new WordExtractor();
      const doc = await extractor.extract(input.fullPath);
      const body = doc.getBody?.() ?? "";
      if (body.trim()) {
        return {
          status: "parsed" as const,
          text: body.trim(),
          note: "已解析 DOC 文本。"
        };
      }
    }

    if (extension === ".xls" || extension === ".xlsx") {
      const workbook = XLSX.read(input.bytes, { type: "buffer" });
      const sheetTexts = workbook.SheetNames.map((sheetName) => {
        const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(workbook.Sheets[sheetName], {
          header: 1,
          blankrows: false
        });
        return [`# ${sheetName}`, ...rows.map((row) => row.filter(Boolean).join(" | "))].join("\n");
      }).join("\n\n");
      return {
        status: "parsed" as const,
        text: sheetTexts.trim(),
        note: "已解析 Excel 工作表内容。"
      };
    }
  } catch (error) {
    return {
      status: "metadata-only" as const,
      text: undefined,
      note: `文件已保存，但解析失败：${error instanceof Error ? error.message : "unknown error"}`
    };
  }

  return {
    status: "metadata-only" as const,
    text: undefined,
    note: "文件已保存，当前类型先保留元数据。"
  };
}

function isTextLike(extension: string, mimeType: string) {
  return mimeType.startsWith("text/") || [".txt", ".md", ".markdown", ".json", ".csv", ".tsv"].includes(extension);
}

function splitFragments(input: string) {
  return input
    .split(/[\n。！？；;•·]/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 6);
}

function heuristicCollection(
  projectName: string,
  rawInputs: string[],
  sourceRecords: WorkspaceRequirementSourceRecord[],
  uploadedFiles: WorkspaceSourceFileRecord[],
  extractedHighlights: string[],
  materials: SourceMaterial[] = []
): WorkspaceRequirementCollection {
  const fragments = [...rawInputs.flatMap((item) => splitFragments(item)), ...extractedHighlights];
  const userGoals = classify(fragments, ["目标", "提升", "减少", "效率", "体验", "增长", "希望", "解决", "价值", "收益"]).slice(0, 4);
  const coreScenarios = classify(fragments, ["场景", "使用", "流程", "入口", "协作", "查看", "聊天", "上传", "编辑", "回退"]).slice(0, 4);
  const coreFunctions = classify(fragments, ["功能", "支持", "上传", "编辑", "导出", "生成", "管理", "通知", "保存", "预览", "回滚", "标注"]).slice(0, 5);
  const constraints = classify(fragments, ["本地", "导出", "版本", "安全", "必须", "需要", "限制", "约束", "阶段", "模型"]).slice(0, 4);
  const followupQuestions = buildFollowupQuestions({
    hasFiles: uploadedFiles.length > 0,
    userGoalsCount: userGoals.length,
    scenarioCount: coreScenarios.length,
    functionCount: coreFunctions.length,
    constraintCount: constraints.length
  });
  const summary = [
    rawInputs.length > 0 ? `已接收 ${rawInputs.length} 条散落需求点` : "当前主要来自上传文档",
    uploadedFiles.length > 0 ? `并记录 ${uploadedFiles.length} 份上传文件` : "暂未上传文档",
    "已整理为需求点文档。"
  ].join("，");

  const sourceSummaries = materials
    .map((material) => ({
      id: material.id,
      title: material.title,
      sourceType: material.sourceType,
      summary: summarizeText(material.text),
      keyPoints: splitFragments(material.text).slice(0, 5),
      candidateUserGoals: classify(splitFragments(material.text), ["目标", "提升", "效率", "增长", "希望", "价值"]).slice(0, 3),
      candidateScenarios: classify(splitFragments(material.text), ["场景", "流程", "使用", "协作", "聊天", "上传"]).slice(0, 3),
      candidateFunctions: classify(splitFragments(material.text), ["支持", "功能", "编辑", "上传", "预览", "导出", "回滚"]).slice(0, 4),
      candidateConstraints: classify(splitFragments(material.text), ["本地", "安全", "版本", "约束", "必须", "发布时间"]).slice(0, 3),
      openQuestions: []
    }))
    .filter((item) => item.summary || item.keyPoints.length > 0);

  const requirementPointSections = buildRequirementPointSections({
    sourceRecords,
    uploadedFiles,
    materials,
    extractedHighlights
  });

  const requirementsDocument = renderCollectionDocument({
    projectName,
    summary,
    requirementPointSections,
    userGoals,
    coreScenarios,
    coreFunctions,
    constraints,
    followupQuestions
  });

  return {
    projectName,
    rawInputs,
    sourceRecords,
    uploadedFiles,
    sourceSummaries,
    requirementPointSections,
    extractedHighlights,
    aiSummary: summary,
    requirementsDocument,
    requirementsDocumentHtml: markdownLikeToHtml(requirementsDocument),
    structuredSnapshot: {
      userGoals,
      coreScenarios,
      coreFunctions,
      constraints
    },
    sourceDirty: false,
    lastSourceUpdatedAt: getLatestSourceUpdatedAt(sourceRecords, uploadedFiles),
    lastOrganizedSourceUpdatedAt: nowIso(),
    followupQuestions,
    lastOrganizedAt: nowIso()
  };
}

function heuristicStructure(collection: WorkspaceRequirementCollection): WorkspaceRequirementStructure {
  const structure: WorkspaceRequirementStructure = {
    userGoals: collection.structuredSnapshot.userGoals,
    coreScenarios: collection.structuredSnapshot.coreScenarios,
    coreFunctions: collection.structuredSnapshot.coreFunctions,
    scope: {
      inScope: collection.structuredSnapshot.coreFunctions.slice(0, 4),
      outOfScope: [
        "高级自动化",
        "复杂权限系统",
        "深度第三方集成"
      ]
    },
    risks: collection.structuredSnapshot.constraints.length > 0
      ? collection.structuredSnapshot.constraints
      : ["部分业务边界仍需继续澄清。"],
    clarificationNeeded: collection.followupQuestions,
    documentMarkdown: "",
    documentHtml: "",
    lastGeneratedAt: nowIso()
  };
  structure.documentMarkdown = renderRequirementStructureMarkdown(structure);
  structure.documentHtml = markdownLikeToHtml(structure.documentMarkdown);
  return structure;
}

function buildFallbackStageDocument(
  projectName: string,
  stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
  context: {
    collection: WorkspaceRequirementCollection;
    structure?: WorkspaceRequirementStructure;
    clarification?: WorkspaceStageDocument;
    productModel?: WorkspaceStageDocument;
    prd?: WorkspaceStageDocument;
  }
): WorkspaceStageDocument {
  const markdown = renderFallbackStageMarkdown(projectName, stage, context);
  return {
    stage,
    title: `${projectName} ${labelStageForPrompt(stage)}`,
    summary: firstNonEmptyLine(markdown) ?? `${projectName} ${labelStageForPrompt(stage)}`,
    documentMarkdown: markdown,
    documentHtml: markdownLikeToHtml(markdown),
    sections: buildStageDocumentSections(stage, markdown),
    lastGeneratedAt: nowIso()
  };
}

function renderRequirementStructureMarkdown(structure: WorkspaceRequirementStructure) {
  return [
    "# 结构化需求文档",
    "",
    "## 用户目标",
    ...bullet(structure.userGoals),
    "",
    "## 核心场景",
    ...bullet(structure.coreScenarios),
    "",
    "## 核心功能",
    ...bullet(structure.coreFunctions),
    "",
    "## 范围",
    "### 包含范围",
    ...bullet(structure.scope.inScope),
    "",
    "### 不包含",
    ...bullet(structure.scope.outOfScope),
    "",
    "## 风险",
    ...bullet(structure.risks),
    "",
    "## 待澄清",
    ...bullet(structure.clarificationNeeded)
  ].join("\n");
}

function renderFallbackStageMarkdown(
  projectName: string,
  stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
  context: {
    collection: WorkspaceRequirementCollection;
    structure?: WorkspaceRequirementStructure;
    clarification?: WorkspaceStageDocument;
    productModel?: WorkspaceStageDocument;
    prd?: WorkspaceStageDocument;
  }
) {
  if (stage === "requirement-clarification") {
    return [
      `# ${projectName} 需求澄清文档`,
      "",
      "## 已确认项",
      ...bullet(context.structure?.coreFunctions ?? []),
      "",
      "## 待确认项",
      ...bullet(context.structure?.clarificationNeeded ?? context.collection.followupQuestions),
      "",
      "## 当前假设",
      "- 第一版围绕当前核心功能先做 MVP。",
      "- 结构化结果中的目标用户和场景暂作为当前假设继续推进。",
      "",
      "## Blocker",
      ...bullet((context.structure?.clarificationNeeded ?? []).length > 0 ? ["仍有关键待确认项需要继续澄清。"] : ["当前未发现明显 blocker。"])
    ].join("\n");
  }

  if (stage === "product-model") {
    return [
      `# ${projectName} 产品模型`,
      "",
      "## 功能模块",
      ...bullet(context.structure?.coreFunctions ?? []),
      "",
      "## 页面列表",
      ...bullet(buildDefaultPages(context.structure?.coreFunctions ?? [])),
      "",
      "## 用户流程",
      ...bullet(buildDefaultFlows(context.structure?.coreScenarios ?? [])),
      "",
      "## 信息架构说明",
      "- 首页承接核心入口与当前状态概览。",
      "- 列表页承接对象管理与筛选。",
      "- 详情页承接单个对象的查看与操作。"
    ].join("\n");
  }

  if (stage === "prd") {
    return [
      `# ${projectName} PRD`,
      "",
      "## 背景",
      context.collection.aiSummary,
      "",
      "## 目标用户",
      ...bullet(context.structure?.userGoals ?? []),
      "",
      "## 核心场景",
      ...bullet(context.structure?.coreScenarios ?? []),
      "",
      "## 功能需求",
      ...bullet(context.structure?.coreFunctions ?? []),
      "",
      "## 页面说明",
      ...bullet(buildDefaultPages(context.structure?.coreFunctions ?? [])),
      "",
      "## 风险与开放问题",
      ...bullet(context.structure?.risks ?? ["部分业务边界仍需继续明确。"])
    ].join("\n");
  }

  return [
    `# ${projectName} 原型稿`,
    "",
    "## 页面列表",
    ...bullet(buildDefaultPages(context.structure?.coreFunctions ?? [])),
    "",
    "## 页面流转",
    ...bullet(buildDefaultFlows(context.structure?.coreScenarios ?? [])),
    "",
    "## 原型说明",
    "- 当前原型以页面结构和关键交互为主。",
    "- 重点验证页面承接关系、主流程和关键信息布局。",
    "",
    "## 标注建议",
    "- 补充每个页面的关键交互说明。",
    "- 标注待确认规则和异常状态。"
  ].join("\n");
}

function renderCollectionDocument(params: {
  projectName: string;
  summary: string;
  requirementPointSections: WorkspaceRequirementPointSection[];
  userGoals: string[];
  coreScenarios: string[];
  coreFunctions: string[];
  constraints: string[];
  followupQuestions: string[];
}) {
  return [
    `# ${params.projectName} 需求点文档`,
    "",
    "## 文档说明",
    params.summary,
    "",
    "## 需求内容",
    "",
    ...params.requirementPointSections.flatMap((section) => [
      `### ${section.title}`,
      ...bullet(section.items),
      ""
    ]),
    "## 当前可提炼出的重点",
    "",
    "### 用户目标",
    ...bullet(params.userGoals),
    "",
    "### 核心场景",
    ...bullet(params.coreScenarios),
    "",
    "### 核心功能",
    ...bullet(params.coreFunctions),
    "",
    "### 约束条件",
    ...bullet(params.constraints.length > 0 ? params.constraints : ["暂未明确约束条件"]),
    "",
    "## 待补充问题",
    ...bullet(params.followupQuestions)
  ].join("\n");
}

function buildDefaultPages(coreFunctions: string[]) {
  const defaults = [
    "首页：展示当前状态、关键入口和最近进展",
    "列表页：承接对象浏览、筛选和批量操作",
    "详情页：展示单个对象详情和关联操作",
    "设置页：承接配置、偏好与系统选项"
  ];
  return coreFunctions.length > 0 ? coreFunctions.map((item) => `${item} 页面承接`) : defaults;
}

function buildDefaultFlows(coreScenarios: string[]) {
  return coreScenarios.length > 0
    ? coreScenarios.map((item) => `${item} -> 查看信息 -> 执行动作 -> 返回结果`)
    : ["进入产品 -> 查看当前状态 -> 执行核心动作 -> 获得结果反馈"];
}

function labelStageForPrompt(stage: "requirement-clarification" | "product-model" | "prd" | "prototype") {
  return ({
    "requirement-clarification": "需求澄清文档",
    "product-model": "产品模型",
    "prd": "PRD 文档",
    "prototype": "原型稿"
  })[stage];
}

function firstNonEmptyLine(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => Boolean(line && !line.startsWith("#")));
}

function buildStageDocumentSections(
  stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
  markdown: string
) {
  const blocks = markdown.split(/\n##\s+/).filter(Boolean);
  const sections = blocks.slice(1).map((block, index) => {
    const [titleLine, ...rest] = block.split("\n");
    const body = rest.join("\n").trim();
    const items = rest
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2));
    return {
      id: `${stage}-section-${index + 1}`,
      title: titleLine?.trim() ?? `Section ${index + 1}`,
      body,
      items
    };
  });

  return sections;
}

function buildRequirementPointSections(params: {
  sourceRecords: WorkspaceRequirementSourceRecord[];
  uploadedFiles: WorkspaceSourceFileRecord[];
  materials: SourceMaterial[];
  extractedHighlights: string[];
  currentDocument?: string;
}): WorkspaceRequirementPointSection[] {
  const allPoints = dedupeStrings([
    ...params.materials.flatMap((material) => splitFragments(material.text)),
    ...params.extractedHighlights,
    ...splitFragments(params.currentDocument ?? "")
  ]);

  const groups: Array<{ id: string; title: string; keywords: string[] }> = [
    { id: "goals", title: "目标与价值", keywords: ["目标", "价值", "提升", "减少", "效率", "增长", "解决", "收益", "帮助"] },
    { id: "users", title: "用户与角色", keywords: ["用户", "团队", "角色", "管理员", "成员", "老板", "客户", "负责人"] },
    { id: "scenarios", title: "场景与流程", keywords: ["场景", "流程", "阶段", "使用", "协作", "跟踪", "查看", "推进"] },
    { id: "functions", title: "功能与交互", keywords: ["功能", "支持", "上传", "编辑", "生成", "导出", "预览", "保存", "回复", "版本", "回滚"] },
    { id: "data", title: "数据与内容", keywords: ["数据", "文档", "记录", "需求点", "内容", "文件", "说明"] },
    { id: "constraints", title: "规则与约束", keywords: ["必须", "约束", "限制", "本地", "安全", "模型", "版本化"] },
    { id: "issues", title: "问题、评论与待确认", keywords: ["问题", "评论", "担心", "不清楚", "待确认", "风险", "建议"] }
  ];

  const assigned = new Set<string>();
  const sections: WorkspaceRequirementPointSection[] = groups
    .map((group) => {
      const items = allPoints.filter((point) => {
        if (assigned.has(point)) {
          return false;
        }
        const matched = group.keywords.some((keyword) => point.includes(keyword));
        if (matched) {
          assigned.add(point);
        }
        return matched;
      });

      return {
        id: group.id,
        title: group.title,
        items
      };
    })
    .filter((section) => section.items.length > 0);

  const remaining = allPoints.filter((point) => !assigned.has(point));
  if (remaining.length > 0) {
    sections.push({
      id: "others",
      title: "其他需求点",
      items: remaining
    });
  }

  return sections.length > 0
    ? sections
    : [{
        id: "empty",
        title: "当前需求点",
        items: ["暂未整理出明确需求点"]
      }];
}

function bullet(items: string[]) {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- 暂无"];
}

function classify(fragments: string[], keywords: string[]) {
  return Array.from(new Set(fragments.filter((fragment) => keywords.some((keyword) => fragment.includes(keyword)))));
}

function buildFollowupQuestions(params: {
  hasFiles: boolean;
  userGoalsCount: number;
  scenarioCount: number;
  functionCount: number;
  constraintCount: number;
}) {
  const questions: string[] = [];
  if (params.userGoalsCount < 1) {
    questions.push("最优先要解决的业务目标是什么？");
  }
  if (params.scenarioCount < 1) {
    questions.push("目标用户会在什么具体场景下使用这个产品？");
  }
  if (params.functionCount < 2) {
    questions.push("第一版必须包含的 3 个核心功能分别是什么？");
  }
  if (params.constraintCount < 1) {
    questions.push("有没有必须遵守的约束，比如本地存储、导出、安全或发布时间？");
  }
  if (!params.hasFiles) {
    questions.push("如果你手上有会议纪要、需求文档或竞品材料，可以继续上传帮助我补齐上下文。");
  }
  return questions.slice(0, 4);
}

function buildSourceRecordMaterials(sourceRecords: WorkspaceRequirementSourceRecord[]): SourceMaterial[] {
  const byId = new Map(sourceRecords.map((record) => [record.id, record]));
  const sortByCreated = (left: WorkspaceRequirementSourceRecord, right: WorkspaceRequirementSourceRecord) =>
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();

  const serialize = (record: WorkspaceRequirementSourceRecord, depth = 0): string[] => {
    const prefix = depth > 0 ? `${"  ".repeat(depth)}回复：` : "记录：";
    const children = sourceRecords
      .filter((item) => item.parentId === record.id)
      .sort(sortByCreated)
      .flatMap((item) => serialize(item, depth + 1));
    return [`${prefix} ${record.content}`.trim(), ...children];
  };

  return sourceRecords
    .filter((record) => !record.parentId || !byId.has(record.parentId))
    .sort(sortByCreated)
    .map((record, index) => ({
      id: record.id,
      title: `需求点记录 ${index + 1}`,
      sourceType: "record" as const,
      text: serialize(record).join("\n")
    }));
}

function chunkText(input: string, maxChars = 3500) {
  const normalized = input.trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!current) {
      if (paragraph.length <= maxChars) {
        current = paragraph;
        continue;
      }
      for (let index = 0; index < paragraph.length; index += maxChars) {
        chunks.push(paragraph.slice(index, index + maxChars));
      }
      continue;
    }

    const candidate = `${current}\n\n${paragraph}`;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      chunks.push(current);
      if (paragraph.length <= maxChars) {
        current = paragraph;
      } else {
        for (let index = 0; index < paragraph.length; index += maxChars) {
          chunks.push(paragraph.slice(index, index + maxChars));
        }
        current = "";
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function summarizeText(input: string, maxLength = 180) {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function dedupeStrings(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function createSourceRecord(content: string, parentId?: string): WorkspaceRequirementSourceRecord {
  const now = nowIso();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content: content.trim(),
    parentId,
    createdAt: now,
    updatedAt: now
  };
}

function normalizeCollection(collection: WorkspaceRequirementCollection): WorkspaceRequirementCollection {
  const sourceRecords = collection.sourceRecords?.length
    ? collection.sourceRecords
    : collection.rawInputs.map((content, index) => {
        const now = collection.lastEditedAt ?? collection.lastOrganizedAt ?? nowIso();
        return {
          id: `${Date.now()}-legacy-${index}`,
          content,
          createdAt: now,
          updatedAt: now
        } satisfies WorkspaceRequirementSourceRecord;
      });

  return {
    ...collection,
    sourceRecords,
    rawInputs: sourceRecordsToRawInputs(sourceRecords),
    sourceDirty: collection.sourceDirty ?? isSourceDirty(collection.lastSourceUpdatedAt, collection.lastOrganizedSourceUpdatedAt),
    lastSourceUpdatedAt: collection.lastSourceUpdatedAt ?? getLatestSourceUpdatedAt(sourceRecords, collection.uploadedFiles),
    lastOrganizedSourceUpdatedAt: collection.lastOrganizedSourceUpdatedAt ?? collection.lastOrganizedAt
  };
}

function getLatestSourceUpdatedAt(
  sourceRecords: WorkspaceRequirementSourceRecord[],
  uploadedFiles: WorkspaceSourceFileRecord[]
) {
  const timestamps = [
    ...sourceRecords.map((record) => record.updatedAt || record.createdAt),
    ...uploadedFiles.map((file) => file.uploadedAt)
  ].filter(Boolean);

  if (timestamps.length === 0) {
    return undefined;
  }

  return timestamps.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

function isSourceDirty(lastSourceUpdatedAt?: string, lastOrganizedSourceUpdatedAt?: string) {
  if (!lastSourceUpdatedAt) {
    return false;
  }

  if (!lastOrganizedSourceUpdatedAt) {
    return true;
  }

  return new Date(lastSourceUpdatedAt).getTime() > new Date(lastOrganizedSourceUpdatedAt).getTime();
}

function sourceRecordsToRawInputs(records: WorkspaceRequirementSourceRecord[]) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const sortByCreated = (left: WorkspaceRequirementSourceRecord, right: WorkspaceRequirementSourceRecord) =>
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();

  const serialize = (record: WorkspaceRequirementSourceRecord, depth = 0): string[] => {
    const prefix = depth > 0 ? `${"  ".repeat(depth)}回复：` : "";
    const children = records
      .filter((item) => item.parentId === record.id)
      .sort(sortByCreated)
      .flatMap((item) => serialize(item, depth + 1));
    return [`${prefix}${record.content}`.trim(), ...children];
  };

  return records
    .filter((record) => !record.parentId || !byId.has(record.parentId))
    .sort(sortByCreated)
    .flatMap((record) => serialize(record))
    .filter(Boolean);
}

function removeSourceRecordTree(records: WorkspaceRequirementSourceRecord[], recordId: string) {
  const deletedIds = new Set<string>([recordId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (record.parentId && deletedIds.has(record.parentId) && !deletedIds.has(record.id)) {
        deletedIds.add(record.id);
        changed = true;
      }
    }
  }
  return records.filter((record) => !deletedIds.has(record.id));
}

function markdownLikeToHtml(input: string) {
  return input
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length === 0) {
        return "";
      }
      if (lines.every((line) => line.startsWith("- "))) {
        return `<ul>${lines.map((line) => `<li>${escapeHtml(line.slice(2))}</li>`).join("")}</ul>`;
      }
      const first = lines[0] ?? "";
      if (first.startsWith("# ")) {
        return `<h1>${escapeHtml(first.slice(2))}</h1>${lines.slice(1).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}`;
      }
      if (first.startsWith("## ")) {
        return `<h2>${escapeHtml(first.slice(3))}</h2>${lines.slice(1).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}`;
      }
      if (first.startsWith("### ")) {
        return `<h3>${escapeHtml(first.slice(4))}</h3>${lines.slice(1).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}`;
      }
      return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    })
    .join("");
}

function normalizeRichTextHtml(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return "<p></p>";
  }
  return trimmed;
}

function richTextHtmlToText(input: string) {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|ul|ol)>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function importDesignSourceFile(file: WorkspaceDesignImportFile): Promise<WorkspaceDesignImportResult> {
  const extension = extname(file.filename).toLowerCase().replace(/^\./, "");
  if (extension === "sketch") {
    return importSketchDesignFile(file);
  }
  if (extension === "fig" || extension === "figma") {
    return importVextraDesignFile(file);
  }
  throw new Error("仅支持导入 .sketch / .fig / .figma 文件");
}

async function importSketchDesignFile(file: WorkspaceDesignImportFile): Promise<WorkspaceDesignImportResult> {
  const extension = extname(file.filename).toLowerCase().replace(/^\./, "");
  if (extension !== "sketch") {
    throw new Error("仅支持导入 .sketch 文件");
  }

  const tempDir = await mkdtemp(join(tmpdir(), "aipm-sketch-import-"));
  const tempPath = join(tempDir, basename(file.filename));

  try {
    await writeFile(tempPath, file.bytes);
    const sketch = await import("@sketch-hq/sketch-file") as unknown as {
      fromFile(filepath: string): Promise<{
        contents: {
          document?: {
            assets?: unknown;
            pages?: unknown[];
            foreignSymbols?: unknown[];
          };
        };
      }>;
    };
    const parsedFile = await sketch.fromFile(tempPath);
    const document = safeObject(parsedFile.contents.document);
    const sourcePages = toArray(document.pages);
    const assets = await extractSketchImageAssets(tempPath, document, sourcePages, file.filename);
    const assetByRef = new Map(assets.map((asset) => [asset.sourceRef, asset]));
    const symbolById = buildSketchSymbolMap(sourcePages, document);
    const sharedStyleMaps = buildSketchSharedStyleMaps(document);
    const pages = sourcePages.flatMap((pageLike, pageIndex) => {
      const pageName = getStringProp(pageLike, "name") || `Sketch 页面 ${pageIndex + 1}`;
      const pageCandidates = getSketchTopLevelPageCandidates(pageLike);
      const pageLayers = pageCandidates.length > 0 ? pageCandidates : [pageLike];

      return pageLayers.map((layer, layerIndex) => {
        const zIndexRef = { current: 0 };
        const rawNodes = (pageCandidates.length > 0 ? [layer] : getSketchRenderableLayers(layer)).flatMap((renderLayer, renderIndex) => (
          convertSketchLayer(renderLayer, {
            depth: 0,
            index: renderIndex,
            zIndexRef,
            parentX: 0,
            parentY: 0,
            scaleX: 1,
            scaleY: 1,
            assetByRef,
            symbolById,
            sharedStyleMaps
          })
        ));
        const normalizedNodes = normalizeDesignNodesToLocalCanvas(rawNodes);
        const layerName = pageCandidates.length > 0 ? getStringProp(layer, "name") : pageName;

        return {
          id: createDesignId("import-page"),
          name: layerName || (pageCandidates.length > 0 ? `${pageName} ${layerIndex + 1}` : pageName),
          nodes: normalizedNodes.length > 0 ? normalizedNodes : [
            createDesignNode("frame", {
              name: layerName || pageName || file.filename,
              text: "已读取 Sketch 页面，但没有识别到可展示图层",
              x: 420,
              y: 280,
              width: 420,
              height: 220,
              fill: "#f4f4f5"
            })
          ]
        } satisfies WorkspaceDesignPage;
      });
    });

    const symbolMasters = [
      ...sourcePages.flatMap((pageLike) => collectSketchSymbolMasters(getSketchLayers(pageLike))),
      ...toArray(document.foreignSymbols).flatMap((foreignSymbol) => {
        const symbol = safeObject(foreignSymbol).symbolMaster ?? safeObject(foreignSymbol).originalMaster;
        return symbol ? [symbol] : [];
      })
    ];
    const components = (symbolMasters.length > 0
      ? symbolMasters
      : sourcePages.flatMap((pageLike) => getSketchLayers(pageLike).filter((layer) => isSketchComponentCandidate(layer)))
    ).map((layer, index) => {
      const zIndexRef = { current: 0 };
      const nodes = convertSketchLayer(layer, {
        depth: 0,
        index,
        zIndexRef,
        parentX: 0,
        parentY: 0,
        scaleX: 1,
        scaleY: 1,
        assetByRef,
        symbolById,
        sharedStyleMaps
      });

      return {
        id: createDesignId("import-component"),
        name: getStringProp(layer, "name") || `Sketch 组件 ${index + 1}`,
        sourceFileName: file.filename,
        nodeCount: nodes.length,
        nodes
      } satisfies WorkspaceDesignComponent;
    }).filter((component) => component.nodes.length > 0);

    if (pages.length === 0) {
      throw new Error("Sketch 文件已读取，但没有识别到页面");
    }

    return { pages, components, assets };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function importVextraDesignFile(file: WorkspaceDesignImportFile): Promise<WorkspaceDesignImportResult> {
  const extension = extname(file.filename).toLowerCase().replace(/^\./, "");
  if (!["fig", "figma"].includes(extension)) {
    throw new Error("仅支持导入 .sketch / .fig / .figma 文件");
  }

  const tempDir = await mkdtemp(join(tmpdir(), "aipm-design-import-"));
  const tempPath = join(tempDir, basename(file.filename));

  try {
    await writeFile(tempPath, file.bytes);
    const vextra = await import("@kcaitech/vextra-core") as unknown as {
      DataGuard: new () => { guard(data: unknown): unknown };
      IO: {
        importSketch(file: string, guard: { guard(data: unknown): unknown }): Promise<{ pagesMgr: unknown }>;
        importFigma(file: string, guard: { guard(data: unknown): unknown }): Promise<{ pagesMgr: unknown }>;
      };
    };
    const guard = new vextra.DataGuard();
    const document = await vextra.IO.importFigma(tempPath, guard);
    const sourcePages = getResourceValues(document.pagesMgr);
    const pages = sourcePages.map((pageLike, pageIndex) => {
      const rawNodes = getChildShapes(pageLike).flatMap((shape, shapeIndex) => (
        convertVextraShape(shape, {
          depth: 0,
          index: shapeIndex,
          parentX: 0,
          parentY: 0
        })
      )).slice(0, 220);

      return {
        id: createDesignId("import-page"),
        name: getStringProp(pageLike, "name") || `导入页面 ${pageIndex + 1}`,
        nodes: rawNodes.length > 0 ? rawNodes : [
          createDesignNode("frame", {
            name: getStringProp(pageLike, "name") || file.filename,
            text: "未识别到可展示节点",
            x: 420,
            y: 280,
            width: 420,
            height: 220,
            fill: "#f4f4f5"
          })
        ]
      } satisfies WorkspaceDesignPage;
    });

    const components = sourcePages.flatMap((pageLike) => getChildShapes(pageLike).slice(0, 24).map((shape, index) => {
      const nodes = convertVextraShape(shape, {
        depth: 0,
        index,
        parentX: 0,
        parentY: 0
      }).slice(0, 80);

      return {
        id: createDesignId("import-component"),
        name: getStringProp(shape, "name") || `导入组件 ${index + 1}`,
        sourceFileName: file.filename,
        nodeCount: nodes.length,
        nodes
      } satisfies WorkspaceDesignComponent;
    })).filter((component) => component.nodes.length > 0);

    if (pages.length === 0) {
      throw new Error("文件已读取，但没有识别到可导入页面");
    }

    return { pages, components, assets: [] };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function convertVextraShape(
  shape: unknown,
  context: {
    depth: number;
    index: number;
    zIndexRef?: { current: number };
    parentX: number;
    parentY: number;
  }
): WorkspaceDesignNode[] {
  if (!shape || typeof shape !== "object" || context.depth > 4) {
    return [];
  }

  const shapeObject = shape as Record<string, unknown>;
  const frame = readShapeFrame(shapeObject);
  const shapeType = String(shapeObject.type ?? "");
  const nodeType = mapVextraShapeType(shapeType, getStringProp(shapeObject, "name"));
  const node = createDesignNode(nodeType, {
    id: createDesignId("import-node"),
    name: getStringProp(shapeObject, "name") || defaultDesignNodeName(nodeType),
    x: Math.round(context.parentX + frame.x),
    y: Math.round(context.parentY + frame.y),
    width: Math.max(16, Math.round(frame.width)),
    height: Math.max(16, Math.round(frame.height)),
    fill: readShapeFill(shapeObject, nodeType),
    stroke: readShapeStroke(shapeObject),
    radius: readShapeRadius(shapeObject, nodeType),
    text: readShapeText(shapeObject, nodeType),
    textColor: readTextColor(shapeObject, nodeType),
    fontSize: nodeType === "text" ? 18 : 14,
    visible: shapeObject.isVisible !== false,
    locked: shapeObject.isLocked === true
  });

  const children = getChildShapes(shapeObject).flatMap((child, index) => (
    convertVextraShape(child, {
      depth: context.depth + 1,
      index,
      parentX: 0,
      parentY: 0
    })
  ));

  return [node, ...children].slice(0, 120);
}

function convertSketchLayer(
  layer: unknown,
  context: {
    depth: number;
    index: number;
    zIndexRef?: { current: number };
    parentX: number;
    parentY: number;
    scaleX: number;
    scaleY: number;
    assetByRef?: Map<string | undefined, WorkspaceDesignAsset>;
    symbolById?: Map<string, unknown>;
    sharedStyleMaps?: SketchSharedStyleMaps;
    clipBounds?: WorkspaceDesignNode["clipBounds"];
    clipPath?: WorkspaceDesignNode["clipPath"];
    parentNodeId?: string;
    inheritedShapeStyle?: Record<string, unknown>;
    parentShapeGroupBounds?: { x: number; y: number; width: number; height: number };
  }
): WorkspaceDesignNode[] {
  if (!layer || typeof layer !== "object" || context.depth > 30) {
    return [];
  }

  const sharedLayerObject = applySketchSharedStyleToLayer(layer as Record<string, unknown>, context.sharedStyleMaps);
  const layerObject = applySketchInheritedShapeStyle(sharedLayerObject, context.inheritedShapeStyle);
  const frame = readSketchFrame(layerObject);
  const layerClass = getStringProp(layerObject, "_class");
  const nodeType = mapSketchLayerType(layerClass, getStringProp(layerObject, "name"));
  const shouldUseParentShapeBounds = context.parentShapeGroupBounds && isSketchPathLayer(layerObject);
  const nodeX = shouldUseParentShapeBounds ? context.parentShapeGroupBounds!.x : Math.round(context.parentX + frame.x * context.scaleX);
  const nodeY = shouldUseParentShapeBounds ? context.parentShapeGroupBounds!.y : Math.round(context.parentY + frame.y * context.scaleY);
  const nodeWidth = shouldUseParentShapeBounds ? context.parentShapeGroupBounds!.width : Math.max(1, Math.round(frame.width * context.scaleX));
  const nodeHeight = shouldUseParentShapeBounds ? context.parentShapeGroupBounds!.height : Math.max(1, Math.round(frame.height * context.scaleY));
  const nodeId = createDesignId("import-node");
  const node = createDesignNode(nodeType, {
    id: nodeId,
    parentId: context.parentNodeId,
    depth: context.depth,
    name: getStringProp(layerObject, "name") || defaultDesignNodeName(nodeType),
    x: nodeX,
    y: nodeY,
    width: nodeWidth,
    height: nodeHeight,
    fill: readSketchFill(layerObject, nodeType, context.assetByRef),
    stroke: readSketchStroke(layerObject),
    strokeWidth: readSketchStrokeWidth(layerObject),
    strokePosition: readSketchStrokePosition(layerObject),
    strokeDashPattern: readSketchStrokeDashPattern(layerObject),
    strokeLineCap: readSketchStrokeLineCap(layerObject),
    strokeLineJoin: readSketchStrokeLineJoin(layerObject),
    radius: readSketchRadius(layerObject, nodeType),
    text: readSketchText(layerObject, nodeType),
    textRuns: readSketchTextRuns(layerObject),
    textColor: readSketchTextColor(layerObject, nodeType),
    fontSize: readSketchFontSize(layerObject, nodeType),
    lineHeight: readSketchLineHeight(layerObject),
    textAlign: readSketchTextAlign(layerObject),
    fontFamily: readSketchFontFamily(layerObject),
    fontWeight: readSketchFontWeight(layerObject),
    letterSpacing: readSketchLetterSpacing(layerObject),
    underline: readSketchTextUnderline(layerObject),
    strikethrough: readSketchTextStrikethrough(layerObject),
    visible: layerObject.isVisible !== false,
    locked: layerObject.isLocked === true,
    sourceLayerClass: layerClass,
    opacity: readSketchOpacity(layerObject),
    rotation: toNumber(layerObject.rotation, 0),
    blendMode: readSketchBlendMode(layerObject),
    blurRadius: readSketchBlurRadius(layerObject),
    flippedHorizontal: layerObject.isFlippedHorizontal === true,
    flippedVertical: layerObject.isFlippedVertical === true,
    shadow: readSketchShadow(layerObject),
    innerShadow: readSketchInnerShadow(layerObject),
    zIndex: nextSketchRenderZIndex(context),
    clipBounds: context.clipBounds,
    clipPath: context.clipPath,
    ...readSketchVectorMeta(layerObject, nodeWidth, nodeHeight),
    ...readSketchFillImageMeta(layerObject, context.assetByRef),
    ...readSketchImageMeta(layerObject, context.assetByRef)
  });
  const renderNode = suppressSketchContainerPaint(layerObject, node);
  const shouldRenderShapeGroupAsVector = layerClass === "shapeGroup" && Boolean(renderNode.svgPath);

  const symbolChildren = layerClass === "symbolInstance"
    ? convertSketchSymbolInstance(layerObject, {
        ...context,
        nodeX,
        nodeY,
        nodeWidth,
        nodeHeight,
        parentNodeId: nodeId
      })
    : [];
  const children = shouldRenderShapeGroupAsVector ? [] : convertSketchChildLayers(layerObject, {
    ...context,
    parentX: nodeX,
    parentY: nodeY,
    depth: context.depth + 1,
    parentNodeId: nodeId,
    inheritedShapeStyle: getSketchChildInheritedShapeStyle(layerObject, context.inheritedShapeStyle)
  });

  return [renderNode, ...symbolChildren, ...children];
}

function nextSketchRenderZIndex(context: { depth: number; index: number; zIndexRef?: { current: number } }) {
  if (!context.zIndexRef) {
    return context.depth * 1000 + context.index;
  }
  const zIndex = context.zIndexRef.current;
  context.zIndexRef.current += 1;
  return zIndex;
}

function convertSketchChildLayers(
  parentLayer: Record<string, unknown>,
  context: {
    depth: number;
    zIndexRef?: { current: number };
    parentX: number;
    parentY: number;
    scaleX: number;
    scaleY: number;
    assetByRef?: Map<string | undefined, WorkspaceDesignAsset>;
    symbolById?: Map<string, unknown>;
    sharedStyleMaps?: SketchSharedStyleMaps;
    clipBounds?: WorkspaceDesignNode["clipBounds"];
    clipPath?: WorkspaceDesignNode["clipPath"];
    parentNodeId?: string;
    inheritedShapeStyle?: Record<string, unknown>;
    parentShapeGroupBounds?: { x: number; y: number; width: number; height: number };
  }
) {
  let activeClipBounds = context.clipBounds;
  let activeClipPath = context.clipPath;
  const parentFrame = readSketchFrame(parentLayer);
  const parentShapeGroupBounds = getStringProp(parentLayer, "_class") === "shapeGroup"
    ? {
        x: context.parentX,
        y: context.parentY,
        width: Math.max(1, Math.round(parentFrame.width * context.scaleX)),
        height: Math.max(1, Math.round(parentFrame.height * context.scaleY))
      }
    : context.parentShapeGroupBounds;
  return getSketchLayers(parentLayer).flatMap((child, index) => {
    const childObject = safeObject(child);
    if (childObject.shouldBreakMaskChain === true) {
      activeClipBounds = context.clipBounds;
      activeClipPath = context.clipPath;
    }

    if (childObject.hasClippingMask === true) {
      const clip = readSketchLayerClip(childObject, context);
      activeClipBounds = intersectDesignRects(activeClipBounds, clip.bounds);
      activeClipPath = clip.path ?? activeClipPath;
      return [];
    }

    return convertSketchLayer(child, {
      depth: context.depth,
      index,
      zIndexRef: context.zIndexRef,
      parentX: context.parentX,
      parentY: context.parentY,
      scaleX: context.scaleX,
      scaleY: context.scaleY,
      assetByRef: context.assetByRef,
      symbolById: context.symbolById,
      sharedStyleMaps: context.sharedStyleMaps,
      clipBounds: activeClipBounds,
      clipPath: activeClipPath,
      parentNodeId: context.parentNodeId,
      inheritedShapeStyle: context.inheritedShapeStyle,
      parentShapeGroupBounds
    });
  });
}

function readSketchLayerClip(
  layer: Record<string, unknown>,
  context: {
    parentX: number;
    parentY: number;
    scaleX: number;
    scaleY: number;
  }
): {
  bounds: NonNullable<WorkspaceDesignNode["clipBounds"]>;
  path?: WorkspaceDesignNode["clipPath"];
} {
  const frame = readSketchFrame(layer);
  const width = Math.max(1, Math.round(frame.width * context.scaleX));
  const height = Math.max(1, Math.round(frame.height * context.scaleY));
  const bounds = {
    x: Math.round(context.parentX + frame.x * context.scaleX),
    y: Math.round(context.parentY + frame.y * context.scaleY),
    width,
    height
  };
  const vector = readSketchVectorMeta(layer, width, height);
  return {
    bounds,
    path: vector.svgPath ? {
      ...bounds,
      svgPath: vector.svgPath,
      fillRule: vector.svgFillRule
    } : undefined
  };
}

function intersectDesignRects(
  first: WorkspaceDesignNode["clipBounds"] | undefined,
  second: NonNullable<WorkspaceDesignNode["clipBounds"]>
): WorkspaceDesignNode["clipBounds"] {
  if (!first) {
    return second;
  }
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y)
  };
}

function createDesignNode(type: WorkspaceDesignNodeType, overrides: Partial<WorkspaceDesignNode> = {}): WorkspaceDesignNode {
  const base: WorkspaceDesignNode = {
    id: createDesignId("node"),
    type,
    name: defaultDesignNodeName(type),
    x: 420,
    y: 320,
    width: type === "text" ? 220 : type === "table" ? 520 : type === "input" ? 260 : 180,
    height: type === "text" ? 64 : type === "table" ? 270 : type === "button" ? 64 : 120,
    fill: type === "button" ? "#246bfe" : type === "text" ? "transparent" : "#ffffff",
    stroke: type === "text" ? "transparent" : "#d8d8dd",
    radius: type === "button" || type === "input" ? 14 : 8,
    text: type === "text" ? "Text" : type === "button" ? "Button" : "",
    textColor: type === "button" ? "#ffffff" : "#171717",
    fontSize: type === "text" ? 22 : 14,
    visible: true,
    locked: false
  };
  return { ...base, ...overrides };
}

function createInitialWorkspaceDesignFile(projectName: string): WorkspaceDesignFile {
  const now = nowIso();
  return {
    id: createDesignId("design"),
    name: `${projectName} AI Design`,
    prdText: "这里承载当前项目的 PRD 草稿。后续 AI 会根据 PRD 生成页面清单、UI Schema 和可编辑画布。",
    updatedAt: now,
    importedComponents: [],
    importedAssets: [],
    pages: [
      {
        id: createDesignId("page"),
        name: "页面 1",
        nodes: [
          createDesignNode("frame", { x: 520, y: 260, name: "分区 1", width: 360, height: 210, fill: "#f2f2f3", text: "分区 1" }),
          createDesignNode("container", { x: 615, y: 325, name: "容器 3", width: 190, height: 130, fill: "#c52b32", stroke: "#c52b32", text: "" }),
          createDesignNode("container", { x: 960, y: 290, name: "容器 4", width: 118, height: 150, fill: "#ffffff", stroke: "#ffffff", text: "" }),
          createDesignNode("table", { x: 520, y: 670, name: "表格/多内容/两行", width: 520, height: 270, fill: "#ffffff", text: "" })
        ]
      }
    ]
  };
}

function suppressSketchContainerPaint(layer: Record<string, unknown>, node: WorkspaceDesignNode): WorkspaceDesignNode {
  const layerClass = getStringProp(layer, "_class");
  const childLayers = getSketchLayers(layer);
  const isStructuralContainer = ["group", "shapeGroup", "symbolMaster", "symbolInstance"].includes(layerClass);
  if (!isStructuralContainer || childLayers.length === 0) {
    return node;
  }
  if (node.svgPath) {
    return node;
  }

  // Sketch shapeGroup/style can describe the composed vector, but drawing the
  // group frame as a rectangle creates the black blocks seen in imported files.
  return {
    ...node,
    fill: "transparent",
    stroke: "transparent",
    strokeWidth: 0,
    text: ""
  };
}

function getSketchChildInheritedShapeStyle(
  parentLayer: Record<string, unknown>,
  inheritedStyle?: Record<string, unknown>
) {
  const layerClass = getStringProp(parentLayer, "_class");
  const parentStyle = safeObject(parentLayer.style);
  if (layerClass !== "shapeGroup" || Object.keys(parentStyle).length === 0) {
    return inheritedStyle;
  }
  return inheritedStyle ? mergeSketchStyles(inheritedStyle, parentStyle) : parentStyle;
}

function applySketchInheritedShapeStyle(
  layer: Record<string, unknown>,
  inheritedStyle?: Record<string, unknown>
) {
  if (!inheritedStyle || !isSketchShapePrimitive(layer)) {
    return layer;
  }
  return {
    ...layer,
    style: mergeSketchStyles(inheritedStyle, safeObject(layer.style))
  };
}

function isSketchShapePrimitive(layer: Record<string, unknown>) {
  return ["shapePath", "rectangle", "oval", "polygon", "star", "triangle", "line"].includes(getStringProp(layer, "_class"));
}

function isSketchPathLayer(layer: Record<string, unknown>) {
  return ["shapePath", "polygon", "star", "triangle"].includes(getStringProp(layer, "_class"));
}

function getResourceValues(resourceManager: unknown) {
  if (!resourceManager || typeof resourceManager !== "object") {
    return [];
  }

  const manager = resourceManager as {
    resource?: unknown;
    keys?: unknown;
    getSync?: (key: string) => unknown;
  };
  const resourceValues = toArray(manager.resource);
  if (resourceValues.length > 0) {
    return resourceValues;
  }

  return toArray(manager.keys)
    .map((key) => typeof key === "string" ? manager.getSync?.(key) : undefined)
    .filter(Boolean);
}

function getChildShapes(shape: unknown) {
  if (!shape || typeof shape !== "object") {
    return [];
  }
  return toArray((shape as { childs?: unknown }).childs);
}

function getSketchLayers(layer: unknown) {
  if (!layer || typeof layer !== "object") {
    return [];
  }
  return toArray((layer as { layers?: unknown }).layers);
}

function getSketchRenderableLayers(layer: unknown) {
  return [...getSketchLayers(layer)].reverse();
}

function getSketchTopLevelPageCandidates(pageLike: unknown) {
  return getSketchRenderableLayers(pageLike).filter(isSketchTopLevelPageCandidate);
}

function isSketchTopLevelPageCandidate(layer: unknown) {
  const layerObject = safeObject(layer);
  const layerClass = getStringProp(layerObject, "_class");
  const frame = readSketchFrame(layerObject);
  const isCanvasContainer = ["artboard", "group", "symbolMaster"].includes(layerClass);
  const isLargeEnough = frame.width >= 300 && frame.height >= 300;
  return isCanvasContainer && isLargeEnough;
}

function normalizeDesignNodesToLocalCanvas(nodes: WorkspaceDesignNode[]) {
  if (nodes.length === 0) {
    return nodes;
  }

  const bounds = nodes.reduce(
    (next, node) => ({
      minX: Math.min(next.minX, node.x),
      minY: Math.min(next.minY, node.y)
    }),
    { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY }
  );

  const offsetX = Number.isFinite(bounds.minX) ? bounds.minX : 0;
  const offsetY = Number.isFinite(bounds.minY) ? bounds.minY : 0;
  if (offsetX === 0 && offsetY === 0) {
    return nodes;
  }

  return nodes.map((node) => ({
    ...node,
    x: node.x - offsetX,
    y: node.y - offsetY,
    clipBounds: node.clipBounds ? {
      ...node.clipBounds,
      x: node.clipBounds.x - offsetX,
      y: node.clipBounds.y - offsetY
    } : undefined,
    clipPath: node.clipPath ? {
      ...node.clipPath,
      x: node.clipPath.x - offsetX,
      y: node.clipPath.y - offsetY
    } : undefined
  }));
}

function collectSketchSymbolMasters(layers: unknown[]): unknown[] {
  return layers.flatMap((layer) => {
    const layerObject = safeObject(layer);
    const current = getStringProp(layerObject, "_class") === "symbolMaster" ? [layer] : [];
    return [...current, ...collectSketchSymbolMasters(getSketchLayers(layerObject))];
  });
}

function isSketchComponentCandidate(layer: unknown) {
  const layerClass = getStringProp(layer, "_class");
  return ["artboard", "group", "shapeGroup", "symbolInstance"].includes(layerClass);
}

function buildSketchSymbolMap(pages: unknown[], document: Record<string, unknown>) {
  const symbols = [
    ...pages.flatMap((pageLike) => collectSketchSymbolMasters(getSketchLayers(pageLike))),
    ...toArray(document.foreignSymbols).flatMap((foreignSymbol) => {
      const symbol = safeObject(foreignSymbol).symbolMaster ?? safeObject(foreignSymbol).originalMaster;
      return symbol ? [symbol] : [];
    })
  ];
  const symbolById = new Map<string, unknown>();
  symbols.forEach((symbol) => {
    const symbolId = getStringProp(symbol, "symbolID");
    if (symbolId) {
      symbolById.set(symbolId, symbol);
    }
  });
  return symbolById;
}

function buildSketchSharedStyleMaps(document: Record<string, unknown>): SketchSharedStyleMaps {
  return {
    layerStyleById: buildSketchSharedStyleMap([
      ...getSketchSharedStyles(document.layerStyles),
      ...toArray(document.foreignLayerStyles).map(normalizeSketchForeignSharedStyle)
    ]),
    textStyleById: buildSketchSharedStyleMap([
      ...getSketchSharedStyles(document.layerTextStyles),
      ...toArray(document.foreignTextStyles).map(normalizeSketchForeignSharedStyle)
    ])
  };
}

function buildSketchSharedStyleMap(sharedStyles: unknown[]) {
  const styleById = new Map<string, Record<string, unknown>>();
  sharedStyles.map(safeObject).forEach((sharedStyle) => {
    const styleValue = safeObject(sharedStyle.value);
    if (Object.keys(styleValue).length === 0) {
      return;
    }
    [
      getStringProp(sharedStyle, "do_objectID"),
      getStringProp(sharedStyle, "remoteStyleID"),
      getStringProp(styleValue, "do_objectID")
    ].filter(Boolean).forEach((styleId) => {
      styleById.set(styleId, styleValue);
      const bracketId = extractSketchBracketId(styleId);
      if (bracketId) {
        styleById.set(bracketId, styleValue);
      }
    });
  });
  return styleById;
}

function normalizeSketchForeignSharedStyle(style: unknown) {
  const styleObject = safeObject(style);
  const localSharedStyle = safeObject(styleObject.localSharedStyle);
  return {
    ...localSharedStyle,
    remoteStyleID: getStringProp(styleObject, "remoteStyleID") || getStringProp(localSharedStyle, "remoteStyleID")
  };
}

function getSketchSharedStyles(value: unknown) {
  const valueObject = safeObject(value);
  return toArray(valueObject.objects).length > 0 ? toArray(valueObject.objects) : toArray(value);
}

function applySketchSharedStyleToLayer(layer: Record<string, unknown>, sharedStyleMaps?: SketchSharedStyleMaps) {
  if (!sharedStyleMaps) {
    return layer;
  }

  const layerClass = getStringProp(layer, "_class");
  const sharedStyleId = getStringProp(layer, "sharedStyleID") || getStringProp(safeObject(layer.style), "sharedObjectID");
  if (!sharedStyleId) {
    return layer;
  }

  const sharedStyle = resolveSketchSharedStyle(
    sharedStyleId,
    layerClass === "text" ? sharedStyleMaps.textStyleById : sharedStyleMaps.layerStyleById
  );
  if (!sharedStyle) {
    return layer;
  }

  const mergedStyle = mergeSketchStyles(sharedStyle, safeObject(layer.style));
  return {
    ...layer,
    style: mergedStyle,
    attributedString: layerClass === "text"
      ? applySketchAttributedStringStyleOverride(safeObject(layer.attributedString), mergedStyle)
      : layer.attributedString
  };
}

function resolveSketchSharedStyle(styleId: string, styleById?: Map<string, Record<string, unknown>>) {
  if (!styleById || !styleId) {
    return undefined;
  }
  const candidates = [
    styleId,
    extractSketchBracketId(styleId),
    styleId.split("[")[0]
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.map((candidate) => styleById.get(candidate)).find(Boolean);
}

function extractSketchBracketId(value: string) {
  return /\[(?<id>[^\]]+)\]/.exec(value)?.groups?.id;
}

function convertSketchSymbolInstance(
  instance: Record<string, unknown>,
  context: {
    depth: number;
    zIndexRef?: { current: number };
    nodeX: number;
    nodeY: number;
    nodeWidth: number;
    nodeHeight: number;
    assetByRef?: Map<string | undefined, WorkspaceDesignAsset>;
    symbolById?: Map<string, unknown>;
    sharedStyleMaps?: SketchSharedStyleMaps;
    clipBounds?: WorkspaceDesignNode["clipBounds"];
    clipPath?: WorkspaceDesignNode["clipPath"];
    parentNodeId?: string;
  }
) {
  const overrideValues = toArray(instance.overrideValues);
  const directSymbolOverride = overrideValues
    .map(safeObject)
    .find((override) => getStringProp(override, "overrideName") === "_symbolID");
  const directSymbolId = typeof directSymbolOverride?.value === "string" ? directSymbolOverride.value : "";
  const symbolId = directSymbolId || getStringProp(instance, "symbolID");
  if (directSymbolOverride && !symbolId) {
    return [];
  }

  const symbol = context.symbolById?.get(symbolId);
  if (!symbol) {
    return [];
  }
  const symbolObject = safeObject(symbol);
  const symbolFrame = readSketchFrame(symbolObject);
  const scaleX = symbolFrame.width > 0 ? context.nodeWidth / symbolFrame.width : 1;
  const scaleY = symbolFrame.height > 0 ? context.nodeHeight / symbolFrame.height : 1;
  const layers = applySketchSymbolOverrides(getSketchRenderableLayers(symbolObject), overrideValues, context.sharedStyleMaps);
  return layers.flatMap((layer, index) => (
    convertSketchLayer(layer, {
      depth: context.depth + 1,
      index,
      zIndexRef: context.zIndexRef,
      parentX: context.nodeX - symbolFrame.x * scaleX,
      parentY: context.nodeY - symbolFrame.y * scaleY,
      scaleX,
      scaleY,
      assetByRef: context.assetByRef,
      symbolById: context.symbolById,
      sharedStyleMaps: context.sharedStyleMaps,
      clipBounds: context.clipBounds,
      clipPath: context.clipPath,
      parentNodeId: context.parentNodeId
    })
  ));
}

function applySketchSymbolOverrides(layers: unknown[], overrideValues: unknown[], sharedStyleMaps?: SketchSharedStyleMaps) {
  if (overrideValues.length === 0) {
    return layers;
  }
  const textOverrideByLayerId = new Map<string, string>();
  const textColorOverrideByLayerId = new Map<string, unknown>();
  const symbolOverrideByLayerId = new Map<string, string>();
  const fillColorOverrideByLayerId = new Map<string, Map<number, unknown>>();
  const imageOverrideByLayerId = new Map<string, unknown>();
  const layerStyleOverrideByLayerId = new Map<string, Record<string, unknown>>();
  const textStyleOverrideByLayerId = new Map<string, Record<string, unknown>>();
  overrideValues.forEach((override) => {
    const overrideObject = safeObject(override);
    const overrideName = getStringProp(overrideObject, "overrideName");
    const value = overrideObject.value;
    if (typeof value === "string" && overrideName.includes("_stringValue")) {
      const layerId = overrideName.split("_stringValue")[0];
      if (layerId) {
        textOverrideByLayerId.set(layerId, value);
      }
    }
    if (overrideName.includes("_textColor")) {
      const layerId = overrideName.split("_textColor")[0];
      if (layerId) {
        textColorOverrideByLayerId.set(layerId, value);
      }
    }
    if (typeof value === "string" && overrideName.includes("_symbolID") && overrideName !== "_symbolID") {
      const layerId = overrideName.split("_symbolID")[0];
      if (layerId) {
        symbolOverrideByLayerId.set(layerId, value);
      }
    }
    const fillMatch = /^(?<layerId>.+)_color:fill-(?<index>\d+)$/.exec(overrideName);
    if (fillMatch?.groups) {
      const layerId = fillMatch.groups.layerId;
      const fillIndex = Number(fillMatch.groups.index);
      const current = fillColorOverrideByLayerId.get(layerId) ?? new Map<number, unknown>();
      current.set(Number.isFinite(fillIndex) ? fillIndex : 0, value);
      fillColorOverrideByLayerId.set(layerId, current);
    }
    if (overrideName.includes("_image")) {
      const layerId = overrideName.split("_image")[0];
      if (layerId) {
        imageOverrideByLayerId.set(layerId, value);
      }
    }
    if (typeof value === "string" && overrideName.includes("_layerStyle")) {
      const layerId = overrideName.split("_layerStyle")[0];
      const style = resolveSketchSharedStyle(value, sharedStyleMaps?.layerStyleById);
      if (layerId && style) {
        layerStyleOverrideByLayerId.set(layerId, style);
      }
    }
    if (typeof value === "string" && overrideName.includes("_textStyle")) {
      const layerId = overrideName.split("_textStyle")[0];
      const style = resolveSketchSharedStyle(value, sharedStyleMaps?.textStyleById);
      if (layerId && style) {
        textStyleOverrideByLayerId.set(layerId, style);
      }
    }
  });

  const cloneWithOverrides = (layer: unknown): unknown => {
    const layerObject = safeObject(layer);
    const layerId = getStringProp(layerObject, "do_objectID");
    const textOverride = textOverrideByLayerId.get(layerId);
    const nextLayer: Record<string, unknown> = {
      ...layerObject,
      layers: getSketchLayers(layerObject).map(cloneWithOverrides)
    };
    const symbolOverride = symbolOverrideByLayerId.get(layerId);
    if (symbolOverride !== undefined) {
      if (!symbolOverride) {
        nextLayer.isVisible = false;
      } else {
        nextLayer.symbolID = symbolOverride;
      }
    }
    if (textOverride !== undefined) {
      nextLayer.attributedString = {
        ...safeObject(layerObject.attributedString),
        string: textOverride
      };
    }
    const layerStyleOverride = layerStyleOverrideByLayerId.get(layerId);
    if (layerStyleOverride) {
      nextLayer.style = mergeSketchStyles(safeObject(nextLayer.style), layerStyleOverride);
      nextLayer.sharedStyleID = getStringProp(layerStyleOverride, "do_objectID") || nextLayer.sharedStyleID;
    }
    const textStyleOverride = textStyleOverrideByLayerId.get(layerId);
    if (textStyleOverride) {
      nextLayer.style = mergeSketchStyles(safeObject(nextLayer.style), textStyleOverride);
      nextLayer.attributedString = applySketchAttributedStringStyleOverride(safeObject(nextLayer.attributedString), textStyleOverride);
      nextLayer.sharedStyleID = getStringProp(textStyleOverride, "do_objectID") || nextLayer.sharedStyleID;
    }
    const textColorOverride = textColorOverrideByLayerId.get(layerId);
    if (textColorOverride) {
      nextLayer.style = applySketchTextColorOverride(safeObject(nextLayer.style), textColorOverride);
      nextLayer.attributedString = applySketchAttributedStringTextColorOverride(safeObject(nextLayer.attributedString), textColorOverride);
    }
    const fillColorOverride = fillColorOverrideByLayerId.get(layerId);
    if (fillColorOverride) {
      nextLayer.style = applySketchFillColorOverride(safeObject(nextLayer.style), fillColorOverride);
    }
    const imageOverride = imageOverrideByLayerId.get(layerId);
    if (imageOverride) {
      nextLayer.image = imageOverride;
    }
    return nextLayer;
  };

  return layers.map(cloneWithOverrides);
}

function applySketchFillColorOverride(style: Record<string, unknown>, overrideByIndex: Map<number, unknown>) {
  const fills = toArray(style.fills).map((fill, index) => {
    const overrideColor = overrideByIndex.get(index);
    return overrideColor ? {
      ...safeObject(fill),
      color: overrideColor,
      isEnabled: safeObject(fill).isEnabled !== false
    } : fill;
  });
  return {
    ...style,
    fills
  };
}

function mergeSketchStyles(baseStyle: Record<string, unknown>, overrideStyle: Record<string, unknown>) {
  const baseTextStyle = safeObject(baseStyle.textStyle);
  const overrideTextStyle = safeObject(overrideStyle.textStyle);
  const baseEncodedAttributes = safeObject(baseTextStyle.encodedAttributes);
  const overrideEncodedAttributes = safeObject(overrideTextStyle.encodedAttributes);
  return {
    ...baseStyle,
    ...overrideStyle,
    fills: toArray(overrideStyle.fills).length > 0 ? overrideStyle.fills : baseStyle.fills,
    borders: toArray(overrideStyle.borders).length > 0 ? overrideStyle.borders : baseStyle.borders,
    shadows: toArray(overrideStyle.shadows).length > 0 ? overrideStyle.shadows : baseStyle.shadows,
    innerShadows: toArray(overrideStyle.innerShadows).length > 0 ? overrideStyle.innerShadows : baseStyle.innerShadows,
    blurs: toArray(overrideStyle.blurs).length > 0 ? overrideStyle.blurs : baseStyle.blurs,
    blur: Object.keys(safeObject(overrideStyle.blur)).length > 0 ? overrideStyle.blur : baseStyle.blur,
    contextSettings: {
      ...safeObject(baseStyle.contextSettings),
      ...safeObject(overrideStyle.contextSettings)
    },
    borderOptions: {
      ...safeObject(baseStyle.borderOptions),
      ...safeObject(overrideStyle.borderOptions)
    },
    textStyle: {
      ...baseTextStyle,
      ...overrideTextStyle,
      encodedAttributes: {
        ...baseEncodedAttributes,
        ...overrideEncodedAttributes,
        paragraphStyle: {
          ...safeObject(baseEncodedAttributes.paragraphStyle),
          ...safeObject(overrideEncodedAttributes.paragraphStyle)
        }
      }
    }
  };
}

function applySketchTextColorOverride(style: Record<string, unknown>, color: unknown) {
  const textStyle = safeObject(style.textStyle);
  const encodedAttributes = safeObject(textStyle.encodedAttributes);
  return {
    ...style,
    textStyle: {
      ...textStyle,
      encodedAttributes: {
        ...encodedAttributes,
        MSAttributedStringColorAttribute: color
      }
    }
  };
}

function applySketchAttributedStringStyleOverride(attributedString: Record<string, unknown>, style: Record<string, unknown>) {
  const encodedAttributes = safeObject(safeObject(style.textStyle).encodedAttributes);
  if (Object.keys(encodedAttributes).length === 0) {
    return attributedString;
  }
  const attributes = toArray(attributedString.attributes);
  return {
    ...attributedString,
    attributes: (attributes.length > 0 ? attributes : [{ location: 0, length: getStringProp(attributedString, "string").length, attributes: {} }]).map((attribute) => {
      const attributeObject = safeObject(attribute);
      const currentAttributes = safeObject(attributeObject.attributes);
      return {
        ...attributeObject,
        attributes: {
          ...currentAttributes,
          ...encodedAttributes,
          paragraphStyle: {
            ...safeObject(currentAttributes.paragraphStyle),
            ...safeObject(encodedAttributes.paragraphStyle)
          }
        }
      };
    })
  };
}

function applySketchAttributedStringTextColorOverride(attributedString: Record<string, unknown>, color: unknown) {
  const attributes = toArray(attributedString.attributes).map((attribute) => {
    const attributeObject = safeObject(attribute);
    const nestedAttributes = safeObject(attributeObject.attributes);
    return {
      ...attributeObject,
      attributes: {
        ...nestedAttributes,
        MSAttributedStringColorAttribute: color
      }
    };
  });
  return {
    ...attributedString,
    attributes
  };
}

async function extractSketchImageAssets(
  sketchFilePath: string,
  document: Record<string, unknown>,
  pages: unknown[],
  sourceFileName: string
): Promise<WorkspaceDesignAsset[]> {
  const imageRefs = [
    ...collectSketchAssetImageRefs(document),
    ...pages.flatMap((page) => collectSketchLayerImageRefs(getSketchLayers(page)))
  ];
  const uniqueRefs = new Map<string, unknown>();
  imageRefs.forEach((refLike) => {
    const ref = normalizeSketchImageRef(refLike);
    if (ref) {
      uniqueRefs.set(ref, refLike);
    }
  });

  if (uniqueRefs.size === 0) {
    return [];
  }

  // @ts-ignore adm-zip has CommonJS typings and is only used by the Node import pipeline.
  const admZipModule = await import("adm-zip") as unknown as {
    default?: new (filePath: string) => {
      readFile(path: string): Buffer | null;
      getEntries(): Array<{ entryName: string }>;
    };
  };
  const AdmZip = (admZipModule.default ?? admZipModule) as unknown as new (filePath: string) => {
    readFile(path: string): Buffer | null;
    getEntries(): Array<{ entryName: string }>;
  };
  const zip = new AdmZip(sketchFilePath);
  const zipEntries = zip.getEntries();

  return Array.from(uniqueRefs.entries()).map<WorkspaceDesignAsset | undefined>(([ref, refLike]) => {
    const refObject = safeObject(refLike);
    const inlineData = safeObject(safeObject(refObject.data)._data ? refObject.data : undefined);
    const rawBase64 = getStringProp(inlineData, "_data");
    const fallbackEntry = zipEntries.find((entry) => entry.entryName === ref || entry.entryName.startsWith(`${ref}.`));
    const buffer = rawBase64 ? Buffer.from(rawBase64, "base64") : zip.readFile(ref) ?? (fallbackEntry ? zip.readFile(fallbackEntry.entryName) : null);
    if (!buffer) {
      return undefined;
    }
    const mimeType = mimeTypeFromSketchImageRef(ref);
    const url = `data:${mimeType};base64,${buffer.toString("base64")}`;
    return {
      id: createDesignId("import-asset"),
      name: basename(ref),
      sourceFileName,
      type: "image",
      mimeType,
      url,
      sourceRef: ref
    } satisfies WorkspaceDesignAsset;
  }).filter((asset): asset is WorkspaceDesignAsset => Boolean(asset));
}

function collectSketchAssetImageRefs(document: Record<string, unknown>) {
  const assets = safeObject(document.assets);
  const imageCollection = safeObject(assets.imageCollection);
  const collectionImages = Object.values(safeObject(imageCollection.images));
  return [
    ...toArray(assets.images),
    ...collectionImages
  ];
}

function collectSketchLayerImageRefs(layers: unknown[]): unknown[] {
  return layers.flatMap((layer) => {
    const layerObject = safeObject(layer);
    const fillImages = toArray(safeObject(layerObject.style).fills)
      .map((fill) => safeObject(fill).image)
      .filter(Boolean);
    const current = [
      ...(layerObject.image ? [layerObject.image] : []),
      ...fillImages
    ];
    return [...current, ...collectSketchLayerImageRefs(getSketchLayers(layerObject))];
  });
}

function normalizeSketchImageRef(refLike: unknown) {
  const refObject = safeObject(refLike);
  const ref = getStringProp(refObject, "_ref");
  if (ref) {
    return ref;
  }
  const sha = getStringProp(safeObject(refObject.sha1), "_data");
  return sha ? `images/${sha}` : "";
}

function readSketchImageMeta(layer: Record<string, unknown>, assetByRef?: Map<string | undefined, WorkspaceDesignAsset>) {
  if (getStringProp(layer, "_class") !== "bitmap") {
    return {};
  }
  const ref = normalizeSketchImageRef(layer.image);
  const asset = assetByRef?.get(ref);
  return {
    imageUrl: asset?.url,
    sourceRef: ref
  };
}

function readSketchFillImageMeta(layer: Record<string, unknown>, assetByRef?: Map<string | undefined, WorkspaceDesignAsset>): Partial<WorkspaceDesignNode> {
  const enabledFills = toArray(safeObject(layer.style).fills).map(safeObject).filter((fill) => fill.isEnabled !== false);
  const imageFill = enabledFills.find((fill) => normalizeSketchImageRef(fill.image));
  const ref = imageFill ? normalizeSketchImageRef(safeObject(imageFill).image) : "";
  const asset = ref ? assetByRef?.get(ref) : undefined;
  return asset?.url ? {
    fillImageUrl: asset.url,
    fillImageMode: sketchPatternFillTypeToMode(toNumber(safeObject(imageFill).patternFillType, 1)),
    fillImageScale: Math.max(0.01, toNumber(safeObject(imageFill).patternTileScale, 1))
  } : {};
}

function sketchPatternFillTypeToMode(patternFillType: number): WorkspaceDesignNode["fillImageMode"] {
  if (patternFillType === 0) return "tile";
  if (patternFillType === 2) return "fit";
  if (patternFillType === 3) return "fill";
  return "stretch";
}

function readSketchVectorMeta(layer: Record<string, unknown>, width: number, height: number): Partial<WorkspaceDesignNode> {
  const layerClass = getStringProp(layer, "_class");
  if (layerClass === "shapeGroup") {
    return readSketchShapeGroupVectorMeta(layer, width, height);
  }
  if (!["shapePath", "rectangle", "oval", "polygon", "star", "triangle", "line"].includes(layerClass)) {
    return {};
  }

  const svgPath = readSketchSvgPath(layer, width, height);
  if (!svgPath) {
    return {};
  }

  const booleanOperation = toNumber(layer.booleanOperation, -1);
  const windingRule = toNumber(safeObject(layer.style).windingRule, 0);
  return {
    svgPath,
    svgFillRule: windingRule === 1 || booleanOperation === 1 || booleanOperation === 3 ? "evenodd" : "nonzero"
  };
}

function readSketchShapeGroupVectorMeta(layer: Record<string, unknown>, width: number, height: number): Partial<WorkspaceDesignNode> {
  if (!hasRenderableSketchStyle(safeObject(layer.style))) {
    return {};
  }

  const children = getSketchLayers(layer).map(safeObject).filter((child) => child.isVisible !== false);
  if (children.length === 0 || !children.every(isSketchShapePrimitive)) {
    return {};
  }
  if (children.some((child) => hasRenderableSketchStyle(safeObject(child.style)))) {
    return {};
  }

  const paths = children
    .map((child) => {
      const childClass = getStringProp(child, "_class");
      if (["shapePath", "polygon", "star", "triangle"].includes(childClass)) {
        return readSketchSvgPath(child, width, height);
      }
      const childFrame = readSketchFrame(child);
      return readSketchSvgPath(
        child,
        Math.max(1, childFrame.width || width),
        Math.max(1, childFrame.height || height),
        childFrame.x,
        childFrame.y
      );
    })
    .filter(Boolean);
  if (paths.length === 0) {
    return {};
  }

  const hasBooleanPath = children.some((child) => {
    const op = toNumber(child.booleanOperation, -1);
    return op === 1 || op === 3;
  });
  const windingRule = toNumber(safeObject(layer.style).windingRule, 0);
  return {
    svgPath: paths.join(" "),
    svgFillRule: windingRule === 1 || hasBooleanPath ? "evenodd" : "nonzero"
  };
}

function hasRenderableSketchStyle(style: Record<string, unknown>) {
  const hasFill = toArray(style.fills).some((fill) => safeObject(fill).isEnabled !== false);
  const hasBorder = toArray(style.borders).some((border) => safeObject(border).isEnabled !== false);
  const hasShadow = toArray(style.shadows).some((shadow) => safeObject(shadow).isEnabled !== false);
  const hasInnerShadow = toArray(style.innerShadows).some((shadow) => safeObject(shadow).isEnabled !== false);
  return hasFill || hasBorder || hasShadow || hasInnerShadow;
}

function readSketchSvgPath(layer: Record<string, unknown>, width: number, height: number, offsetX = 0, offsetY = 0) {
  const layerClass = getStringProp(layer, "_class");
  if (layerClass === "line") {
    return `M ${formatPathNumber(offsetX)} ${formatPathNumber(offsetY + height / 2)} L ${formatPathNumber(offsetX + width)} ${formatPathNumber(offsetY + height / 2)}`;
  }
  if (layerClass === "rectangle") {
    return rectSvgPath(offsetX, offsetY, width, height, readSketchRadius(layer, "container"));
  }
  if (layerClass === "oval") {
    return ovalSvgPath(offsetX, offsetY, width, height);
  }

  const points = toArray(layer.points).map(safeObject);
  if (points.length === 0 || width <= 0 || height <= 0) {
    return "";
  }

  const coordinateMode = resolveSketchPathCoordinateMode(points);
  const normalizedPoints = points.map((point) => ({
    point: sketchPathPointToCanvas(point.point, width, height, offsetX, offsetY, coordinateMode),
    curveFrom: point.hasCurveFrom === true
      ? sketchPathPointToCanvas(point.curveFrom, width, height, offsetX, offsetY, coordinateMode)
      : sketchPathPointToCanvas(point.point, width, height, offsetX, offsetY, coordinateMode),
    curveTo: point.hasCurveTo === true
      ? sketchPathPointToCanvas(point.curveTo, width, height, offsetX, offsetY, coordinateMode)
      : sketchPathPointToCanvas(point.point, width, height, offsetX, offsetY, coordinateMode),
    hasCurveFrom: point.hasCurveFrom === true,
    hasCurveTo: point.hasCurveTo === true
  }));

  const [first, ...rest] = normalizedPoints;
  if (!first) {
    return "";
  }

  const commands = [`M ${formatPathNumber(first.point.x)} ${formatPathNumber(first.point.y)}`];
  rest.forEach((current, index) => {
    const previous = normalizedPoints[index];
    if (!previous) {
      return;
    }
    const canUseCurve = (previous.hasCurveFrom || current.hasCurveTo)
      && isSketchPathPointReasonable(previous.curveFrom, width, height, offsetX, offsetY)
      && isSketchPathPointReasonable(current.curveTo, width, height, offsetX, offsetY);
    if (canUseCurve) {
      commands.push(`C ${formatPathNumber(previous.curveFrom.x)} ${formatPathNumber(previous.curveFrom.y)} ${formatPathNumber(current.curveTo.x)} ${formatPathNumber(current.curveTo.y)} ${formatPathNumber(current.point.x)} ${formatPathNumber(current.point.y)}`);
    } else {
      commands.push(`L ${formatPathNumber(current.point.x)} ${formatPathNumber(current.point.y)}`);
    }
  });

  if (layer.isClosed !== false && normalizedPoints.length > 1) {
    const last = normalizedPoints[normalizedPoints.length - 1];
    const canCloseWithCurve = (last.hasCurveFrom || first.hasCurveTo)
      && isSketchPathPointReasonable(last.curveFrom, width, height, offsetX, offsetY)
      && isSketchPathPointReasonable(first.curveTo, width, height, offsetX, offsetY);
    if (canCloseWithCurve) {
      commands.push(`C ${formatPathNumber(last.curveFrom.x)} ${formatPathNumber(last.curveFrom.y)} ${formatPathNumber(first.curveTo.x)} ${formatPathNumber(first.curveTo.y)} ${formatPathNumber(first.point.x)} ${formatPathNumber(first.point.y)}`);
    }
    commands.push("Z");
  }

  return commands.join(" ");
}

function isSketchPathPointReasonable(
  point: { x: number; y: number },
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0
) {
  const toleranceX = Math.max(width * 4, 512);
  const toleranceY = Math.max(height * 4, 512);
  return point.x >= offsetX - toleranceX
    && point.x <= offsetX + width + toleranceX
    && point.y >= offsetY - toleranceY
    && point.y <= offsetY + height + toleranceY;
}

type SketchPathCoordinateMode = "normalized" | "absolute";

function resolveSketchPathCoordinateMode(points: Record<string, unknown>[]): SketchPathCoordinateMode {
  const anchors = points.map((point) => parseSketchPoint(typeof point.point === "string" ? point.point : ""));
  if (anchors.length === 0) {
    return "normalized";
  }

  const normalizedLikeCount = anchors.filter((point) => (
    Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1
  )).length;
  return normalizedLikeCount / anchors.length >= 0.8 ? "normalized" : "absolute";
}

function sketchPathPointToCanvas(
  value: unknown,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
  coordinateMode: SketchPathCoordinateMode = "normalized"
) {
  const point = parseSketchPoint(typeof value === "string" ? value : "");
  if (coordinateMode === "absolute") {
    return {
      x: offsetX + point.x,
      y: offsetY + point.y
    };
  }

  return {
    x: offsetX + point.x * width,
    y: offsetY + point.y * height
  };
}

function rectSvgPath(x: number, y: number, width: number, height: number, radius = 0) {
  const right = x + width;
  const bottom = y + height;
  const corner = Math.min(Math.max(0, radius), width / 2, height / 2);
  if (corner <= 0) {
    return `M ${formatPathNumber(x)} ${formatPathNumber(y)} H ${formatPathNumber(right)} V ${formatPathNumber(bottom)} H ${formatPathNumber(x)} Z`;
  }
  return [
    `M ${formatPathNumber(x + corner)} ${formatPathNumber(y)}`,
    `H ${formatPathNumber(right - corner)}`,
    `Q ${formatPathNumber(right)} ${formatPathNumber(y)} ${formatPathNumber(right)} ${formatPathNumber(y + corner)}`,
    `V ${formatPathNumber(bottom - corner)}`,
    `Q ${formatPathNumber(right)} ${formatPathNumber(bottom)} ${formatPathNumber(right - corner)} ${formatPathNumber(bottom)}`,
    `H ${formatPathNumber(x + corner)}`,
    `Q ${formatPathNumber(x)} ${formatPathNumber(bottom)} ${formatPathNumber(x)} ${formatPathNumber(bottom - corner)}`,
    `V ${formatPathNumber(y + corner)}`,
    `Q ${formatPathNumber(x)} ${formatPathNumber(y)} ${formatPathNumber(x + corner)} ${formatPathNumber(y)}`,
    "Z"
  ].join(" ");
}

function ovalSvgPath(x: number, y: number, width: number, height: number) {
  const rx = width / 2;
  const ry = height / 2;
  const cx = x + rx;
  const cy = y + ry;
  return [
    `M ${formatPathNumber(cx - rx)} ${formatPathNumber(cy)}`,
    `A ${formatPathNumber(rx)} ${formatPathNumber(ry)} 0 1 0 ${formatPathNumber(cx + rx)} ${formatPathNumber(cy)}`,
    `A ${formatPathNumber(rx)} ${formatPathNumber(ry)} 0 1 0 ${formatPathNumber(cx - rx)} ${formatPathNumber(cy)}`,
    "Z"
  ].join(" ");
}

function formatPathNumber(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
}

function mimeTypeFromSketchImageRef(ref: string) {
  const extension = extname(ref).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  return "image/png";
}

function decodeDataUrl(url: string) {
  const match = /^data:[^;]+;base64,(?<data>.+)$/s.exec(url);
  const data = match?.groups?.data;
  return data ? Buffer.from(data, "base64") : undefined;
}

function toArray(value: unknown): unknown[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "object" && Symbol.iterator in value) {
    return Array.from(value as Iterable<unknown>);
  }
  if (typeof value === "object" && "length" in value && typeof (value as { length?: unknown }).length === "number") {
    return Array.from({ length: (value as { length: number }).length }, (_, index) => (value as Record<number, unknown>)[index]).filter(Boolean);
  }
  return [];
}

function readShapeFrame(shape: Record<string, unknown>) {
  const frame = safeObject(shape.frame);
  const size = safeObject(shape.size);
  const transform = safeObject(shape.transform);
  return {
    x: toNumber(shape.x, toNumber(frame.x, toNumber(transform.m02, 0))),
    y: toNumber(shape.y, toNumber(frame.y, toNumber(transform.m12, 0))),
    width: toNumber(frame.width, toNumber(size.width, 180)),
    height: toNumber(frame.height, toNumber(size.height, 120))
  };
}

function readSketchFrame(layer: Record<string, unknown>) {
  const frame = safeObject(layer.frame);
  return {
    x: toNumber(frame.x, 0),
    y: toNumber(frame.y, 0),
    width: toNumber(frame.width, 180),
    height: toNumber(frame.height, 120)
  };
}

function readShapeFill(shape: Record<string, unknown>, nodeType: WorkspaceDesignNodeType) {
  const fills = tryCallArray(shape, "getFills");
  const firstFill = fills.find((fill) => safeObject(fill).isEnabled !== false);
  const color = safeObject(firstFill).color;
  if (color) {
    return colorToHex(color);
  }
  if (nodeType === "text") {
    return "transparent";
  }
  return nodeType === "button" ? "#246bfe" : "#ffffff";
}

function readSketchFill(
  layer: Record<string, unknown>,
  nodeType: WorkspaceDesignNodeType,
  assetByRef?: Map<string | undefined, WorkspaceDesignAsset>
) {
  const layerClass = getStringProp(layer, "_class");
  if (nodeType === "text") {
    return "transparent";
  }
  if (layerClass === "artboard" && layer.hasBackgroundColor === true) {
    return colorToRgba(layer.backgroundColor);
  }
  const style = safeObject(layer.style);
  const enabledFills = toArray(style.fills).map(safeObject).filter((fill) => fill.isEnabled !== false);
  const fillLayers = enabledFills.map((fill) => sketchFillToCss(fill, assetByRef)).filter(Boolean);
  if (fillLayers.length > 0) {
    return fillLayers.reverse().join(", ");
  }
  if (nodeType === "button") {
    return "#246bfe";
  }
  if (layerClass === "artboard") {
    return "#ffffff";
  }
  if (["group", "shapeGroup", "symbolMaster", "symbolInstance"].includes(layerClass)) {
    return "transparent";
  }
  return "#f8f8fa";
}

function sketchFillToCss(fill: Record<string, unknown>, assetByRef?: Map<string | undefined, WorkspaceDesignAsset>) {
  const imageRef = normalizeSketchImageRef(fill.image);
  const imageAsset = assetByRef?.get(imageRef);
  if (imageAsset?.url) {
    return `url("${imageAsset.url}") center / 100% 100% no-repeat`;
  }
  const fillType = toNumber(fill.fillType, 0);
  const gradient = safeObject(fill.gradient);
  if (fillType === 1 && Object.keys(gradient).length > 0) {
    return sketchGradientToCss(gradient, readSketchContextOpacity(fill));
  }
  if (fill.color) {
    return colorToRgba(fill.color, readSketchContextOpacity(fill));
  }
  return "";
}

function sketchGradientToCss(gradient: Record<string, unknown>, opacityMultiplier = 1) {
  const stops = toArray(gradient.stops).map((stop) => {
    const stopObject = safeObject(stop);
    return `${colorToRgba(stopObject.color, opacityMultiplier)} ${Math.round(toNumber(stopObject.position, 0) * 100)}%`;
  });
  if (stops.length === 0) {
    return "";
  }
  const gradientType = toNumber(gradient.gradientType, 0);
  if (gradientType === 1) {
    return `radial-gradient(circle, ${stops.join(", ")})`;
  }
  const from = parseSketchPoint(getStringProp(gradient, "from"));
  const to = parseSketchPoint(getStringProp(gradient, "to"));
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI + 90);
  return `linear-gradient(${angle}deg, ${stops.join(", ")})`;
}

function readSketchContextOpacity(value: Record<string, unknown>) {
  return Math.max(0, Math.min(1, toNumber(safeObject(value.contextSettings).opacity, 1)));
}

function readShapeStroke(shape: Record<string, unknown>) {
  const border = safeObject(tryCall(shape, "getBorders") ?? safeObject(shape.style).borders);
  const strokePaint = toArray(border.strokePaints)[0];
  const color = safeObject(strokePaint).color;
  return color ? colorToHex(color) : "#d8d8dd";
}

function readSketchStroke(layer: Record<string, unknown>) {
  const style = safeObject(layer.style);
  const border = toArray(style.borders).find((item) => safeObject(item).isEnabled !== false);
  const borderObject = safeObject(border);
  const gradient = safeObject(borderObject.gradient);
  if (toNumber(borderObject.fillType, 0) === 1 && Object.keys(gradient).length > 0) {
    return sketchGradientToCss(gradient, readSketchContextOpacity(borderObject));
  }
  const color = borderObject.color;
  return color ? colorToRgba(color, readSketchContextOpacity(borderObject)) : "transparent";
}

function readSketchStrokeWidth(layer: Record<string, unknown>) {
  const style = safeObject(layer.style);
  const border = safeObject(toArray(style.borders).find((item) => safeObject(item).isEnabled !== false));
  return Math.max(0, toNumber(border.thickness, border.color ? 1 : 0));
}

function readSketchStrokePosition(layer: Record<string, unknown>): WorkspaceDesignNode["strokePosition"] {
  const style = safeObject(layer.style);
  const border = safeObject(toArray(style.borders).find((item) => safeObject(item).isEnabled !== false));
  const position = toNumber(border.position, 1);
  if (position === 0) return "center";
  if (position === 2) return "outside";
  return "inside";
}

function readSketchStrokeDashPattern(layer: Record<string, unknown>) {
  const dashPattern = toArray(safeObject(safeObject(layer.style).borderOptions).dashPattern)
    .map((value) => toNumber(value, Number.NaN))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return dashPattern.length > 0 ? dashPattern : undefined;
}

function readSketchStrokeLineCap(layer: Record<string, unknown>): WorkspaceDesignNode["strokeLineCap"] {
  const lineCapStyle = toNumber(safeObject(safeObject(layer.style).borderOptions).lineCapStyle, 0);
  if (lineCapStyle === 1) return "round";
  if (lineCapStyle === 2) return "square";
  return "butt";
}

function readSketchStrokeLineJoin(layer: Record<string, unknown>): WorkspaceDesignNode["strokeLineJoin"] {
  const lineJoinStyle = toNumber(safeObject(safeObject(layer.style).borderOptions).lineJoinStyle, 0);
  if (lineJoinStyle === 1) return "round";
  if (lineJoinStyle === 2) return "bevel";
  return "miter";
}

function readShapeRadius(shape: Record<string, unknown>, nodeType: WorkspaceDesignNodeType) {
  return Math.max(0, toNumber(shape.fixedRadius, nodeType === "button" || nodeType === "input" ? 14 : 8));
}

function readSketchRadius(layer: Record<string, unknown>, nodeType: WorkspaceDesignNodeType) {
  if (getStringProp(layer, "_class") === "oval") {
    return 9999;
  }
  const fixedRadius = toNumber(layer.fixedRadius, Number.NaN);
  if (Number.isFinite(fixedRadius)) {
    return Math.max(0, fixedRadius);
  }
  const cornerRadius = toNumber(layer.cornerRadius, Number.NaN);
  if (Number.isFinite(cornerRadius)) {
    return Math.max(0, cornerRadius);
  }
  const styleCornerRadius = toNumber(safeObject(layer.style).cornerRadius, Number.NaN);
  if (Number.isFinite(styleCornerRadius)) {
    return Math.max(0, styleCornerRadius);
  }
  const cornerRadii = toArray(safeObject(safeObject(layer.style).corners).radii)
    .map((value) => toNumber(value, Number.NaN))
    .filter(Number.isFinite);
  if (cornerRadii.length > 0) {
    return Math.max(0, Math.max(...cornerRadii));
  }
  const pointRadii = toArray(layer.points)
    .map((point) => toNumber(safeObject(point).cornerRadius, Number.NaN))
    .filter(Number.isFinite);
  if (pointRadii.length > 0) {
    return Math.max(0, Math.max(...pointRadii));
  }
  return nodeType === "button" || nodeType === "input" ? 14 : nodeType === "frame" ? 0 : 8;
}

function readSketchOpacity(layer: Record<string, unknown>) {
  const contextSettings = safeObject(safeObject(layer.style).contextSettings);
  const opacity = toNumber(contextSettings.opacity, 1);
  return Math.max(0, Math.min(1, opacity));
}

function readSketchBlendMode(layer: Record<string, unknown>) {
  const blendMode = toNumber(safeObject(safeObject(layer.style).contextSettings).blendMode, 0);
  return sketchBlendModeToCanvas(blendMode);
}

function readSketchBlurRadius(layer: Record<string, unknown>) {
  const blur = safeObject(safeObject(layer.style).blur);
  if (blur.isEnabled !== true) {
    return undefined;
  }
  const radius = toNumber(blur.radius, 0);
  return radius > 0 ? radius : undefined;
}

function readSketchShadow(layer: Record<string, unknown>) {
  const style = safeObject(layer.style);
  return sketchShadowsToCss(style.shadows);
}

function readSketchInnerShadow(layer: Record<string, unknown>) {
  const style = safeObject(layer.style);
  return sketchShadowsToCss(style.innerShadows);
}

function sketchShadowsToCss(value: unknown) {
  const shadows = toArray(value)
    .map(safeObject)
    .filter((shadow) => shadow.isEnabled !== false)
    .map((shadow) => {
      const offsetX = toNumber(shadow.offsetX, 0);
      const offsetY = toNumber(shadow.offsetY, 0);
      const blur = toNumber(shadow.blurRadius, 0);
      const spread = toNumber(shadow.spread, 0);
      return `${offsetX}px ${offsetY}px ${blur}px ${spread}px ${colorToRgba(shadow.color)}`;
    });
  return shadows.join(", ");
}

function readShapeText(shape: Record<string, unknown>, nodeType: WorkspaceDesignNodeType) {
  const text = safeObject(shape.text);
  const paras = toArray(text.paras);
  const content = paras.map((para) => getStringProp(para, "text")).filter(Boolean).join("\n").trim();
  if (content) {
    return content;
  }
  if (nodeType === "text") {
    return getStringProp(shape, "name") || "Text";
  }
  return nodeType === "button" ? "Button" : "";
}

function readSketchText(layer: Record<string, unknown>, nodeType: WorkspaceDesignNodeType) {
  const text = normalizeSketchText(getStringProp(safeObject(layer.attributedString), "string")).trim();
  if (text) {
    return text;
  }
  if (nodeType === "text") {
    return getStringProp(layer, "name") || "Text";
  }
  if (nodeType === "button") {
    return getStringProp(layer, "name") || "Button";
  }
  return "";
}

function normalizeSketchText(value: string) {
  return value.replace(/\u2028/g, "\n").replace(/\u2029/g, "\n");
}

function readSketchTextRuns(layer: Record<string, unknown>): WorkspaceDesignNode["textRuns"] {
  if (getStringProp(layer, "_class") !== "text") {
    return undefined;
  }
  const rawText = normalizeSketchText(getStringProp(safeObject(layer.attributedString), "string"));
  const attributes = toArray(safeObject(layer.attributedString).attributes).map(safeObject);
  if (!rawText || attributes.length <= 1) {
    return undefined;
  }

  const runs = attributes
    .map((attribute, index) => {
      const location = Math.max(0, Math.floor(toNumber(attribute.location, 0)));
      const fallbackLength = index === attributes.length - 1
        ? rawText.length - location
        : Math.max(0, Math.floor(toNumber(safeObject(attributes[index + 1]).location, rawText.length)) - location);
      const length = Math.max(0, Math.floor(toNumber(attribute.length, fallbackLength)));
      const text = safeTextSlice(rawText, location, location + length);
      const nestedAttributes = safeObject(attribute.attributes);
      const font = safeObject(nestedAttributes.MSAttributedStringFontAttribute);
      const fontAttributes = safeObject(font.attributes);
      const fontSize = toNumber(fontAttributes.size, toNumber(font.size, Number.NaN));
      return {
        text,
        color: nestedAttributes.MSAttributedStringColorAttribute ? colorToRgba(nestedAttributes.MSAttributedStringColorAttribute) : undefined,
        fontSize: Number.isFinite(fontSize) ? Math.max(1, Math.round(fontSize)) : undefined,
        fontFamily: normalizeSketchFontFamily(getStringProp(fontAttributes, "name") || getStringProp(font, "name")),
        fontWeight: sketchFontNameToWeight(getStringProp(fontAttributes, "name") || getStringProp(font, "name")),
        letterSpacing: Number.isFinite(toNumber(nestedAttributes.kerning, Number.NaN)) ? toNumber(nestedAttributes.kerning, 0) : undefined,
        underline: safeObject(nestedAttributes.underlineStyle).style !== undefined || toNumber(nestedAttributes.NSUnderline, 0) > 0,
        strikethrough: safeObject(nestedAttributes.strikethroughStyle).style !== undefined || toNumber(nestedAttributes.NSStrikethrough, 0) > 0
      };
    })
    .filter((run) => run.text.length > 0);

  return runs.length > 1 ? runs : undefined;
}

function readTextColor(shape: Record<string, unknown>, nodeType: WorkspaceDesignNodeType) {
  if (nodeType === "button") {
    return "#ffffff";
  }
  const text = safeObject(shape.text);
  const para = safeObject(toArray(text.paras)[0]);
  const attr = safeObject(para.attr);
  return attr.color ? colorToRgba(attr.color) : "#171717";
}

function readSketchTextColor(layer: Record<string, unknown>, nodeType: WorkspaceDesignNodeType) {
  if (nodeType === "button") {
    return "#ffffff";
  }
  const style = safeObject(layer.style);
  const textStyle = safeObject(style.textStyle);
  const encodedAttributes = safeObject(textStyle.encodedAttributes);
  const color = encodedAttributes.MSAttributedStringColorAttribute;
  if (color) {
    return colorToRgba(color);
  }
  const firstAttribute = safeObject(toArray(safeObject(layer.attributedString).attributes)[0]);
  const attributeColor = safeObject(firstAttribute.attributes).MSAttributedStringColorAttribute;
  return attributeColor ? colorToRgba(attributeColor) : "#171717";
}

function readSketchFontFamily(layer: Record<string, unknown>) {
  const font = readSketchFontDescriptor(layer);
  return normalizeSketchFontFamily(getStringProp(safeObject(font.attributes), "name") || getStringProp(font, "name"));
}

function readSketchFontWeight(layer: Record<string, unknown>) {
  return sketchFontNameToWeight(readSketchFontFamily(layer) ?? "");
}

function sketchFontNameToWeight(fontNameLike: string) {
  const fontName = fontNameLike.toLowerCase();
  if (fontName.includes("thin")) return 100;
  if (fontName.includes("ultralight")) return 200;
  if (fontName.includes("light")) return 300;
  if (fontName.includes("regular")) return 400;
  if (fontName.includes("medium")) return 500;
  if (fontName.includes("semibold") || fontName.includes("semi-bold")) return 600;
  if (fontName.includes("bold")) return 700;
  if (fontName.includes("heavy")) return 800;
  return undefined;
}

function normalizeSketchFontFamily(fontName: string) {
  if (!fontName) {
    return undefined;
  }
  if (fontName.startsWith("PingFangSC")) return "PingFang SC";
  if (fontName.startsWith("Helvetica")) return "Helvetica Neue";
  if (fontName.startsWith("Arial")) return "Arial";
  if (fontName.toLowerCase().includes("iconfont")) return "iconfont";
  return fontName.replace(/-(Regular|Medium|Semibold|SemiBold|Bold|Light|Thin|Heavy|Black)$/i, "");
}

function safeTextSlice(text: string, start: number, end: number) {
  return Array.from(text).slice(start, end).join("");
}

function readSketchLetterSpacing(layer: Record<string, unknown>) {
  const attrs = readSketchTextEncodedAttributes(layer);
  const kern = toNumber(attrs.kerning, toNumber(attrs.NSKern, Number.NaN));
  return Number.isFinite(kern) ? kern : undefined;
}

function readSketchTextUnderline(layer: Record<string, unknown>) {
  const attrs = readSketchTextEncodedAttributes(layer);
  const firstAttributeAttrs = safeObject(safeObject(toArray(safeObject(layer.attributedString).attributes)[0]).attributes);
  return safeObject(attrs.underlineStyle).style !== undefined
    || toNumber(attrs.NSUnderline, 0) > 0
    || safeObject(firstAttributeAttrs.underlineStyle).style !== undefined
    || toNumber(firstAttributeAttrs.NSUnderline, 0) > 0;
}

function readSketchTextStrikethrough(layer: Record<string, unknown>) {
  const attrs = readSketchTextEncodedAttributes(layer);
  const firstAttributeAttrs = safeObject(safeObject(toArray(safeObject(layer.attributedString).attributes)[0]).attributes);
  return safeObject(attrs.strikethroughStyle).style !== undefined
    || toNumber(attrs.NSStrikethrough, 0) > 0
    || safeObject(firstAttributeAttrs.strikethroughStyle).style !== undefined
    || toNumber(firstAttributeAttrs.NSStrikethrough, 0) > 0;
}

function readSketchFontSize(layer: Record<string, unknown>, nodeType: WorkspaceDesignNodeType) {
  if (nodeType !== "text") {
    return 14;
  }
  const font = readSketchFontDescriptor(layer);
  const fontAttributes = safeObject(font.attributes);
  return Math.max(10, Math.round(toNumber(fontAttributes.size, toNumber(font.size, 18))));
}

function readSketchLineHeight(layer: Record<string, unknown>) {
  const paragraphStyle = readSketchParagraphStyle(layer);
  const lineHeight = toNumber(paragraphStyle.minimumLineHeight, toNumber(paragraphStyle.maximumLineHeight, 0));
  return lineHeight > 0 ? Math.round(lineHeight) : undefined;
}

function readSketchTextAlign(layer: Record<string, unknown>): WorkspaceDesignNode["textAlign"] {
  const alignment = toNumber(readSketchParagraphStyle(layer).alignment, 0);
  if (alignment === 1) return "right";
  if (alignment === 2) return "center";
  if (alignment === 3) return "justify";
  return "left";
}

function readSketchParagraphStyle(layer: Record<string, unknown>) {
  const style = safeObject(layer.style);
  const textStyle = safeObject(style.textStyle);
  const encodedAttributes = safeObject(textStyle.encodedAttributes);
  const paragraphStyle = safeObject(encodedAttributes.paragraphStyle);
  if (Object.keys(paragraphStyle).length > 0) {
    return paragraphStyle;
  }
  const firstAttribute = safeObject(toArray(safeObject(layer.attributedString).attributes)[0]);
  return safeObject(safeObject(firstAttribute.attributes).paragraphStyle);
}

function readSketchFontDescriptor(layer: Record<string, unknown>) {
  const encodedAttributes = readSketchTextEncodedAttributes(layer);
  const font = safeObject(encodedAttributes.MSAttributedStringFontAttribute);
  if (Object.keys(font).length > 0) {
    return font;
  }
  const firstAttribute = safeObject(toArray(safeObject(layer.attributedString).attributes)[0]);
  return safeObject(safeObject(firstAttribute.attributes).MSAttributedStringFontAttribute);
}

function readSketchTextEncodedAttributes(layer: Record<string, unknown>) {
  const style = safeObject(layer.style);
  const textStyle = safeObject(style.textStyle);
  return safeObject(textStyle.encodedAttributes);
}

function mapVextraShapeType(shapeType: string, name: string): WorkspaceDesignNodeType {
  const normalizedName = name.toLowerCase();
  if (shapeType.includes("text")) return "text";
  if (shapeType.includes("table")) return "table";
  if (shapeType.includes("symbol") || normalizedName.includes("button")) return "button";
  if (normalizedName.includes("input") || normalizedName.includes("输入")) return "input";
  if (shapeType.includes("artboard") || shapeType.includes("frame") || shapeType.includes("page")) return "frame";
  if (shapeType.includes("group")) return "card";
  if (normalizedName.includes("image") || normalizedName.includes("图片")) return "image";
  return "container";
}

function mapSketchLayerType(layerClass: string, name: string): WorkspaceDesignNodeType {
  const normalizedName = name.toLowerCase();
  if (layerClass === "text") return "text";
  if (normalizedName.includes("table") || normalizedName.includes("表格")) return "table";
  if (layerClass === "bitmap" || normalizedName.includes("image") || normalizedName.includes("图片")) return "image";
  if (layerClass === "artboard") return "frame";
  if (layerClass === "symbolMaster" || layerClass === "symbolInstance") return "card";
  if (layerClass === "group" || layerClass === "shapeGroup") return "card";
  return "container";
}

function tryCall(target: Record<string, unknown>, method: string) {
  const candidate = target[method];
  if (typeof candidate !== "function") {
    return undefined;
  }
  try {
    return candidate.call(target);
  } catch {
    return undefined;
  }
}

function tryCallArray(target: Record<string, unknown>, method: string) {
  return toArray(tryCall(target, method));
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function getStringProp(value: unknown, key: string) {
  const prop = safeObject(value)[key];
  return typeof prop === "string" ? prop : "";
}

function toNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function colorToHex(colorValue: unknown) {
  const color = safeObject(colorValue);
  const red = colorChannelToByte(color.red);
  const green = colorChannelToByte(color.green);
  const blue = colorChannelToByte(color.blue);
  return `#${[red, green, blue].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function colorToRgba(colorValue: unknown, opacityMultiplier = 1) {
  const color = safeObject(colorValue);
  const red = colorChannelToByte(color.red);
  const green = colorChannelToByte(color.green);
  const blue = colorChannelToByte(color.blue);
  const alpha = Math.max(0, Math.min(1, toNumber(color.alpha, 1) * opacityMultiplier));
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function parseSketchPoint(value: string) {
  const numbers = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return {
    x: Number.isFinite(numbers[0]) ? numbers[0] : 0,
    y: Number.isFinite(numbers[1]) ? numbers[1] : 0
  };
}

function sketchBlendModeToCanvas(blendMode: number) {
  const blendModes: Record<number, string | undefined> = {
    0: undefined,
    1: "multiply",
    2: "screen",
    3: "overlay",
    4: "darken",
    5: "lighten",
    6: "color-dodge",
    7: "color-burn",
    8: "soft-light",
    9: "hard-light",
    10: "difference",
    11: "exclusion",
    12: "hue",
    13: "saturation",
    14: "color",
    15: "luminosity"
  };
  return blendModes[blendMode];
}

function colorChannelToByte(value: unknown) {
  const numeric = toNumber(value, 255);
  const scaled = numeric <= 1 ? numeric * 255 : numeric;
  return Math.max(0, Math.min(255, Math.round(scaled)));
}

function defaultDesignNodeName(type: WorkspaceDesignNodeType) {
  return {
    frame: "Frame",
    container: "Container",
    text: "Text",
    button: "Button",
    input: "Input",
    table: "Table",
    card: "Card",
    image: "Image"
  }[type];
}

function createDesignId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
