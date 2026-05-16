import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import XLSX from "xlsx";
import type { AnyLayer } from "../../../node_modules/@sketch-hq/sketch-file-format-ts/dist/cjs/types.js";
// @ts-expect-error no bundled types
import WordExtractor from "word-extractor";
import { z } from "zod";
import { OpenAIClient, StructuredOutputParseError, type LlmConnectionValidationResult } from "../../infrastructure/llm/openai-client.js";
import { WorkspaceProjectRepository } from "../../infrastructure/files/workspace-project-repository.js";
import { buildFallbackChatDecision, type ChatDecision } from "./chat-rules.js";
import {
  DesignAgentToolService,
  designAgentPlanSchema,
  designAgentToolCallSchema,
  designAgentToolDescriptions,
  uiSchemaDraftSchema,
  type DesignAgentPlan,
  type DesignAgentToolCall,
  type DesignAgentToolResult,
  type UiSchemaDraft
} from "./design-agent-tool-service.js";
import { getDesignReferenceContext } from "./design-reference-catalog.js";
import { getCapabilityPrompt, getDesignCapabilityProfile } from "./design-capability-registry.js";
import { MainAgentOrchestratorService } from "./main-agent-orchestrator-service.js";
import type {
  WorkspaceBundle,
  WorkspaceDesignComponent,
  WorkspaceDesignComponentLibrary,
  WorkspaceDesignAsset,
  WorkspaceDesignFile,
  WorkspaceDesignImageColorControls,
  WorkspaceDesignImportResult,
  WorkspaceDesignNode,
  WorkspaceDesignNodeType,
  WorkspaceDesignPage,
  WorkspaceDesignPaint,
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
const designAgentSchema = z.object({
  action: z.enum(["answer", "list-pages", "get-schema", "create-page", "delete-page", "duplicate-page", "generate-schema", "modify-schema"]),
  reply: z.string(),
  pageName: z.string().optional(),
  nodes: z.array(z.object({
    type: z.enum(["frame", "container", "text", "button", "input", "table", "card", "image"]),
    name: z.string().optional(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    fill: z.string().optional(),
    stroke: z.string().optional(),
    radius: z.number().optional(),
    text: z.string().optional(),
    textColor: z.string().optional(),
    fontSize: z.number().optional()
  })).default([])
});
const flexibleStringArraySchema = z.preprocess((value) => normalizeStringArrayLike(value), z.array(z.string()).default([]));
const pageModeSchema = z.enum(["collection", "detail", "form", "dashboard", "auth", "settings", "flow", "landing", "unknown"]);
const layoutPatternSchema = z.enum(["pcTable", "pcDetail", "pcForm", "pcDashboard", "mobileList", "mobileDetail", "mobileForm", "settingsSplit", "authCentered", "flowSteps", "custom"]).default("custom");
const uiDesignerPlanSchema = z.object({
  designGoal: z.string().default(""),
  businessUnderstanding: z.string().default(""),
  platform: z.enum(["pc_web", "wechat_mini_program", "mobile_app", "responsive_web"]).default("pc_web"),
  industry: z.string().default("通用业务"),
  interactionTypes: flexibleStringArraySchema,
  referenceSystems: flexibleStringArraySchema,
  layoutPlan: z.object({
    type: z.string().default(""),
    areas: flexibleStringArraySchema
  }).default({ type: "", areas: [] }),
  styleGuide: z.object({
    theme: z.string().default(""),
    primaryColor: z.string().default(""),
    background: z.string().default(""),
    cardRadius: z.number().default(8),
    spacing: z.number().default(16),
    fontSize: z.number().default(14)
  }).default({ theme: "", primaryColor: "", background: "", cardRadius: 8, spacing: 16, fontSize: 14 }),
  componentPlan: z.array(z.object({
    type: z.string(),
    position: z.string().default(""),
    reason: z.string().default("")
  })).default([]),
  pageSpecs: z.array(z.object({
    name: z.string(),
    goal: z.string().default(""),
    pageMode: pageModeSchema.default("unknown"),
    businessEntity: z.string().default(""),
    layoutPattern: layoutPatternSchema,
    requiredRegions: flexibleStringArraySchema,
    forbiddenRegions: flexibleStringArraySchema,
    componentFamilies: flexibleStringArraySchema,
    keyBlocks: flexibleStringArraySchema,
    primaryAction: z.string().default(""),
    states: flexibleStringArraySchema
  })).default([]),
  executionPlan: z.array(z.object({
    action: z.string(),
    target: z.string().default(""),
    component: z.string().default(""),
    reason: z.string().default("")
  })).default([]),
  qualityBar: flexibleStringArraySchema,
  reviewChecklist: flexibleStringArraySchema
});
const visualDesignReviewSchema = z.object({
  passed: z.boolean(),
  platformFit: z.object({
    expected: z.string().default(""),
    actual: z.string().default(""),
    ok: z.boolean(),
    reason: z.string().default("")
  }),
  visualQualityScore: z.number().min(0).max(100).default(0),
  findings: z.array(z.object({
    severity: z.enum(["blocking", "warning", "info"]).default("warning"),
    pageLabel: z.string().default(""),
    issue: z.string(),
    evidence: z.string().default(""),
    fixSuggestion: z.string().default("")
  })).default([]),
  strengths: z.array(z.string()).default([]),
  nextAction: z.enum(["pass", "local_fix", "regenerate"]).default("pass"),
  summary: z.string().default("")
});
type LlmChatDecision = z.infer<typeof captureChatSchema>;
type RuntimeChatDecision = ChatDecision & { model?: string };
type DesignAgentDecision = z.infer<typeof designAgentSchema>;
type UiDesignerPlan = z.infer<typeof uiDesignerPlanSchema>;
type VisualDesignReview = z.infer<typeof visualDesignReviewSchema>;
type RecentDesignAgentMessage = {
  role: string;
  eventType?: string;
  toolName?: string;
  content: string;
  createdAt: string;
};
type DesignAgentToolHistoryItem = {
  id: string;
  toolName: string;
  arguments?: unknown;
  result?: unknown;
  status: string;
  error?: string;
  startedAt: string;
  endedAt?: string;
};
type DesignAgentResumeContext = {
  userRequest: string;
  feedbackMessage?: string;
  reason: string;
  lastFailedTool?: DesignAgentToolHistoryItem;
  lastSchemaTool?: DesignAgentToolHistoryItem;
  generatedFrameIds: string[];
  shouldUseCreateUiFlow: boolean;
  hadSuccessfulSchemaMutation: boolean;
  hasCaptureAfterLastMutation: boolean;
  hasReviewAfterLastMutation: boolean;
};
type DesignAgentRoleName =
  | "负责人 Agent"
  | "产品经理 Agent"
  | "产品规划 Agent"
  | "UI 设计师 Agent"
  | "Schema 执行 Agent"
  | "页面理解 Agent"
  | "组件库 Agent"
  | "素材 Agent"
  | "审核 Agent"
  | "文件 Agent"
  | "联网 Agent"
  | "视觉识别 Agent"
  | "记忆 Agent";
export type DesignAgentStreamEvent =
  | { type: "message"; content: string; agentRole?: DesignAgentRoleName }
  | { type: "llm_delta"; source: "ui-designer" | "schema-draft" | "json-repair" | "visual-review"; delta: string; agentRole?: DesignAgentRoleName }
  | { type: "plan"; title: string; steps: string[]; plan: DesignAgentPlan; uiDesignPlan?: UiDesignerPlan; agentRole?: DesignAgentRoleName }
  | { type: "tool_call_start"; toolName: string; params?: unknown; reason?: string; toolCallId: string; agentRole?: DesignAgentRoleName }
  | { type: "tool_call_result"; toolName: string; success: boolean; result?: unknown; error?: string; message: string; toolCallId?: string; agentRole?: DesignAgentRoleName }
  | { type: "schema_patch"; action: "add" | "update" | "delete" | "replace"; pageId?: string; nodeCount?: number; selectedNodeIds?: string[]; file?: WorkspaceDesignFile; page?: WorkspaceDesignPage; agentRole?: DesignAgentRoleName }
  | { type: "review"; result: unknown; message: string; agentRole?: DesignAgentRoleName }
  | { type: "done"; summary: string; file: WorkspaceDesignFile; page?: WorkspaceDesignPage; selectedPageId?: string; agentRole?: DesignAgentRoleName }
  | { type: "error"; message: string; agentRole?: DesignAgentRoleName };

function normalizeStringArrayLike(value: unknown): unknown {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values
    .map((item) => stringifyPlanListItem(item))
    .filter((item): item is string => Boolean(item));
}

function stringifyPlanListItem(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const parts = [
    record.name,
    record.title,
    record.label,
    record.type,
    record.component,
    record.area,
    record.position,
    record.purpose,
    record.goal,
    record.reason,
    record.description
  ].filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (parts.length > 0) return Array.from(new Set(parts.map((item) => item.trim()))).join(" / ");
  return JSON.stringify(record);
}
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
type SketchClippingMaskSourceMeta = NonNullable<WorkspaceDesignNode["sourceMeta"]>["activeClippingMask"];

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
  private readonly designTools: DesignAgentToolService;

  constructor(
    private readonly repository: WorkspaceProjectRepository,
    private readonly orchestrator: MainAgentOrchestratorService
  ) {
    this.designTools = new DesignAgentToolService(repository);
  }

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
    systemPrompt?: string;
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
    if (input.systemPrompt !== undefined) {
      project.systemPrompt = input.systemPrompt;
    }
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
    const file = await this.repository.getDesignFile(projectId).catch(() => createInitialWorkspaceDesignFile(project.name));
    return this.hydrateDesignFileWithComponentStore(projectId, file);
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
      componentLibraries: Array.isArray(designFile.componentLibraries) ? designFile.componentLibraries : [],
      pageTemplates: Array.isArray(designFile.pageTemplates) ? designFile.pageTemplates : [],
      importedComponents: Array.isArray(designFile.importedComponents) ? designFile.importedComponents : [],
      importedAssets: Array.isArray(designFile.importedAssets) ? designFile.importedAssets : [],
      pages: Array.isArray(designFile.pages) && designFile.pages.length > 0 ? designFile.pages : createInitialWorkspaceDesignFile(designFile.name).pages
    };
    await this.repository.saveDesignFile(projectId, normalized);
    await this.syncDesignComponentStoreFromFile(projectId, normalized);
    return this.repository.getDesignFile(projectId);
  }

  async upsertDesignComponentLibrary(
    projectId: string,
    input: Pick<WorkspaceDesignComponentLibrary, "name" | "description"> & { id?: string }
  ) {
    await this.repository.getProject(projectId);
    const now = nowIso();
    const existing = input.id
      ? (await this.repository.listDesignComponentLibraries(projectId).catch(() => [])).find((library) => library.id === input.id)
      : undefined;
    const library: WorkspaceDesignComponentLibrary = {
      id: input.id || createDesignId("component-library"),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    if (!library.name) {
      throw new Error("组件库名称不能为空");
    }
    await this.repository.upsertDesignComponentLibrary(projectId, library);
    return library;
  }

  async deleteDesignComponentLibrary(projectId: string, libraryId: string) {
    await this.repository.getProject(projectId);
    await this.repository.deleteDesignComponentLibrary(projectId, libraryId);
    return { ok: true, id: libraryId };
  }

  async upsertDesignComponent(projectId: string, component: WorkspaceDesignComponent) {
    await this.repository.getProject(projectId);
    if (!component.name.trim()) {
      throw new Error("组件名称不能为空");
    }
    if (!component.libraryId) {
      throw new Error("组件必须选择组件库");
    }
    const normalized: WorkspaceDesignComponent = {
      ...component,
      sourceFileName: component.sourceFileName || "本地组件集合",
      nodeCount: Array.isArray(component.nodes) ? component.nodes.length : 0,
      nodes: Array.isArray(component.nodes) ? component.nodes : []
    };
    await this.repository.upsertDesignComponent(projectId, normalized);
    return normalized;
  }

  async deleteDesignComponent(projectId: string, componentId: string) {
    await this.repository.getProject(projectId);
    await this.repository.deleteDesignComponent(projectId, componentId);
    return { ok: true, id: componentId };
  }

  async importDesignFile(projectId: string, file: WorkspaceDesignImportFile): Promise<WorkspaceDesignFile> {
    const current = await this.getDesignFile(projectId);
    const imported = await importDesignSourceFile(file);
    const persisted = await this.persistImportedDesignAssets(projectId, imported);
    const nextFile: WorkspaceDesignFile = {
      ...current,
      pages: [...current.pages, ...persisted.pages],
      componentLibraries: current.componentLibraries ?? [],
      pageTemplates: current.pageTemplates ?? [],
      importedComponents: current.importedComponents,
      importedAssets: [...current.importedAssets, ...persisted.assets],
      updatedAt: nowIso()
    };
    return await this.repository.saveDesignFile(projectId, nextFile);
    // return this.repository.getDesignFile(projectId);
  }

  private async hydrateDesignFileWithComponentStore(projectId: string, file: WorkspaceDesignFile): Promise<WorkspaceDesignFile> {
    const [componentLibraries, storedComponents] = await Promise.all([
      this.repository.listDesignComponentLibraries(projectId).catch(() => []),
      this.repository.listDesignComponents(projectId).catch(() => [])
    ]);
    const localStoredComponentIds = new Set(storedComponents.map((component) => component.id));
    const nonStoredComponents = (file.importedComponents ?? []).filter((component) => (
      component.sourceFileName !== "本地组件集合" || !localStoredComponentIds.has(component.id)
    ));
    return {
      ...file,
      componentLibraries: componentLibraries.length > 0 ? componentLibraries : file.componentLibraries ?? [],
      importedComponents: [...storedComponents, ...nonStoredComponents]
    };
  }

  private async syncDesignComponentStoreFromFile(projectId: string, file: WorkspaceDesignFile) {
    await Promise.all([
      ...(file.componentLibraries ?? []).map((library) => this.repository.upsertDesignComponentLibrary(projectId, library)),
      ...(file.importedComponents ?? [])
        .filter((component) => component.sourceFileName === "本地组件集合")
        .map((component) => this.repository.upsertDesignComponent(projectId, component))
    ]);
  }

  async getDesignAsset(projectId: string, assetId: string) {
    await this.repository.getProject(projectId);
    const bytes = await this.repository.readDesignAsset(projectId, assetId);
    return {
      bytes,
      mimeType: mimeTypeFromSketchImageRef(assetId)
    };
  }

  async runDesignAgent(projectId: string, input: {
    message: string;
    pageId?: string;
    systemPrompt?: string;
    planningMode?: "auto" | "plan";
  }): Promise<{
    reply: string;
    action: DesignAgentDecision["action"] | "tool-plan" | "tool-execute";
    file: WorkspaceDesignFile;
    page?: WorkspaceDesignPage;
    selectedPageId?: string;
    plan?: DesignAgentPlan;
    toolResults?: Array<{ tool: string; ok: boolean; message: string; data?: unknown }>;
    uiDesignPlan?: UiDesignerPlan;
  }> {
    const project = await this.repository.getProject(projectId);
    const file = await this.getDesignFile(projectId);
    const message = input.message.trim();
    if (!message) {
      return {
        reply: "你可以直接告诉我想查询页面、查看 schema、新建/删除/复制页面，或者描述要生成的 UI 页面。",
        action: "answer",
        file
      };
    }

    const selectedPage = await this.getDesignAgentSelectedPage(projectId, file, input.pageId);
    if (input.pageId && !selectedPage) {
      return {
        reply: `当前页 ${input.pageId} 不存在或 schema 未加载，已停止执行，避免错误回退到第一个页面。`,
        action: "answer",
        file
      };
    }
    const llmForPlan = await this.createProjectLlm(project, "design");
    if (!llmForPlan) {
      return {
        reply: [
          "当前无法执行 AI Design Agent，因为没有可用的设计模型连接。",
          "建议：先在 AI 设置里配置 API Key、Base URL 和设计模型，然后再发送任务。",
          "我不会使用本地 fallback 伪造执行结果，避免 schema 被错误修改。"
        ].join("\n"),
        action: "answer",
        file,
        page: selectedPage,
        selectedPageId: selectedPage?.id
      };
    }

    const taskProfile = classifyDesignAgentTask(message);
    let uiDesignPlan: UiDesignerPlan | undefined;
    if (taskProfile.needUIAgent) {
      try {
        uiDesignPlan = await this.createUiDesignerPlan(project, llmForPlan, selectedPage, message, input.systemPrompt);
      } catch (error) {
        const messageText = formatDesignAgentError(error);
        console.error("[AIPM][DesignAgent] ui designer planning failed", {
          projectId,
          error: messageText
        });
        return {
          reply: [
            "UI 设计 Agent 调用失败，已停止执行。",
            `错误信息：${messageText}`,
            "建议：检查模型配置、模型输出 JSON 格式，或先用更明确的页面目标/业务场景描述再执行。"
          ].join("\n"),
          action: "answer",
          file,
          page: selectedPage,
          selectedPageId: selectedPage?.id
        };
      }
    }

    let toolPlan: DesignAgentPlan;
    let selectedPageId = selectedPage?.id;
    let latestFile = file;
    let latestPage = selectedPage;
    let didPersistUi = false;
    const formatFailureStopSummary = (reason: string) => didPersistUi
      ? `执行失败：${reason}。已停止，已保留本次运行中已经成功落盘的 UI，不做回滚或清空。`
      : `执行失败：${reason}。已停止，本次还没有成功生成或落盘任何 UI。`;

    try {
      toolPlan = await this.planDesignAgentTools(project, llmForPlan, file, selectedPage, message, input.systemPrompt, {
        taskProfile,
        uiDesignPlan
      });
      validateDesignAgentPlanForIntent(message, toolPlan);
    } catch (error) {
      const messageText = formatDesignAgentError(error);
      console.error("[AIPM][DesignAgent] tool planning failed", {
        projectId,
        error: messageText
      });
      return {
        reply: [
          "AI Design Agent 规划失败，已停止执行。",
          `错误信息：${messageText}`,
          "建议：检查模型配置、模型返回是否为合法 JSON，或者把任务描述得更具体一些。"
        ].join("\n"),
        action: "answer",
        file,
        page: selectedPage,
        selectedPageId: selectedPage?.id
      };
    }

    if (shouldStopAfterDesignAgentPlan(input.planningMode, toolPlan, message)) {
      return {
        reply: formatDesignToolPlanReply(toolPlan, uiDesignPlan),
        action: "tool-plan",
        file,
        page: selectedPage,
        selectedPageId: selectedPage?.id,
        plan: toolPlan,
        uiDesignPlan
      };
    }

    if (toolPlan.steps.length > 0) {
      let selectedPageId = selectedPage?.id;
      let latestFile = file;
      let latestPage = selectedPage;
      const toolResults: Array<{ tool: string; ok: boolean; message: string; data?: unknown }> = [];
      for (const step of toolPlan.steps.slice(0, 8)) {
        const result = await this.executeDesignToolStep(projectId, selectedPageId, step);
        toolResults.push({ tool: step.tool, ok: result.ok, message: result.message, data: result.data });
        if (result.file) latestFile = result.file;
        if (result.page) latestPage = result.page;
        if (result.selectedPageId) selectedPageId = result.selectedPageId;
        if (!result.ok) {
          break;
        }
      }
      const failed = toolResults.some((result) => !result.ok);
      const alreadyReviewed = toolResults.some((result) => result.tool === "ui.review");
      if (!failed && !alreadyReviewed) {
        const reviewResult = await this.executeDesignToolStep(projectId, selectedPageId, {
          tool: "ui.review",
          reason: "执行完成后由审核 Agent 做一次 UI/schema 综合检查。",
          input: {}
        });
        toolResults.push({ tool: "ui.review", ok: reviewResult.ok, message: reviewResult.message, data: reviewResult.data });
        if (reviewResult.file) latestFile = reviewResult.file;
        if (reviewResult.page) latestPage = reviewResult.page;
        if (reviewResult.selectedPageId) selectedPageId = reviewResult.selectedPageId;
      }
      return {
        reply: formatDesignToolPlanAndExecutionReply(toolPlan, toolResults, uiDesignPlan),
        action: "tool-execute",
        file: latestFile,
        page: latestPage,
        selectedPageId,
        plan: toolPlan,
        toolResults,
        uiDesignPlan
      };
    }

    return {
      reply: toolPlan.reply || "我判断这次不需要调用工具。如果你希望我修改页面，请明确说明要修改当前页面的哪个组件、位置和内容。",
      action: "answer",
      file,
      page: selectedPage,
      selectedPageId: selectedPage?.id,
      plan: toolPlan,
      uiDesignPlan
    };
  }

  async *runDesignAgentStream(projectId: string, input: {
    message: string;
    pageId?: string;
    systemPrompt?: string;
    planningMode?: "auto" | "plan";
    conversationId?: string;
    onDeltaEvent?: (event: Extract<DesignAgentStreamEvent, { type: "llm_delta" }>) => void | Promise<void>;
    signal?: AbortSignal;
  }): AsyncGenerator<DesignAgentStreamEvent> {
    const project = await this.repository.getProject(projectId);
    const conversationId = input.conversationId || `design-agent-${projectId}`;
    const createdAt = nowIso();
    await this.repository.upsertAgentConversation({
      id: conversationId,
      projectId,
      title: "AI Design Agent",
      metadata: { pageId: input.pageId },
      createdAt,
      updatedAt: createdAt
    });

    const emit = async (event: DesignAgentStreamEvent) => {
      await this.persistDesignAgentStreamEvent(projectId, conversationId, event);
      return event;
    };

    const file = await this.getDesignFile(projectId);
    const message = input.message.trim();
    await this.repository.saveAgentMessage({
      id: createAgentRunId("msg"),
      conversationId,
      projectId,
      role: "user",
      content: message,
      eventType: "message",
      createdAt: nowIso()
    });

    if (!message) {
      yield await emit({ type: "error", agentRole: "负责人 Agent", message: "请输入要执行的 AI Design 任务。" });
      yield await emit({ type: "done", agentRole: "负责人 Agent", summary: "已停止：没有收到有效输入。", file });
      return;
    }

    const selectedPage = await this.getDesignAgentSelectedPage(projectId, file, input.pageId);
    if (input.pageId && !selectedPage) {
      const errorMessage = `当前页 ${input.pageId} 不存在或 schema 未加载，已停止执行，避免错误回退到第一个页面。`;
      yield await emit({ type: "error", agentRole: "负责人 Agent", message: errorMessage });
      yield await emit({ type: "done", agentRole: "负责人 Agent", summary: errorMessage, file });
      return;
    }
    const llmForPlan = await this.createProjectLlm(project, "design");
    if (!llmForPlan) {
      const errorMessage = "当前无法执行 AI Design Agent：没有可用的设计模型连接。请先配置 API Key、Base URL 和设计模型。";
      yield await emit({ type: "error", agentRole: "负责人 Agent", message: errorMessage });
      yield await emit({ type: "done", agentRole: "负责人 Agent", summary: "已停止：不会使用本地 fallback 伪造执行结果。", file, page: selectedPage, selectedPageId: selectedPage?.id });
      return;
    }

    let selectedPageId = selectedPage?.id;
    let latestFile = file;
    let latestPage = selectedPage;
    let didPersistUi = false;
    const formatFailureStopSummary = (reason: string) => didPersistUi
      ? `执行失败：${reason}。已停止，已保留本次运行中已经成功落盘的 UI，不做回滚或清空。`
      : `执行失败：${reason}。已停止，本次还没有成功生成或落盘任何 UI。`;

    try {
      throwIfAborted(input.signal);
      const recentConversationMessages = (await this.repository.listAgentMessages({
        projectId,
        conversationId,
        limit: 40
      })).map((message) => ({
        role: message.role,
        eventType: message.eventType,
        toolName: message.toolName,
        content: message.content.slice(0, 1200),
        createdAt: message.createdAt
      }));
      const resumeContext = isContinueDesignAgentMessage(message)
        ? await this.buildDesignAgentResumeContext(projectId, conversationId, recentConversationMessages, message)
        : undefined;
      const taskMessage = resumeContext?.userRequest ?? message;
      if (resumeContext) {
        yield await emit({
          type: "message",
          agentRole: "负责人 Agent",
          content: [
            "继续模式：已从会话上下文恢复上次任务。",
            `原始需求：${resumeContext.userRequest}`,
            resumeContext.feedbackMessage ? `本次反馈：${resumeContext.feedbackMessage}` : "",
            `续接判断：${resumeContext.reason}`
          ].filter(Boolean).join("\n")
        });
      }
      const routedTaskType = routeDesignAgentTask(taskMessage);
      yield await emit({
        type: "message",
        agentRole: "负责人 Agent",
        content: routedTaskType === "create_new_ui"
          ? "任务判断：这是从需求生成新 UI 稿，我会在当前画布已有画板右侧追加新 UI，不会误改当前已有内容。"
          : "任务判断：这是对当前页面/画布的操作，我会先读取必要上下文再执行。"
      });
      const taskProfile = classifyDesignAgentTask(taskMessage);
      const qualityContext = buildDesignQualityContext(taskMessage);
      const emitSchemaDraftProgress = async (content: string) => {
        await emit({ type: "message", agentRole: "Schema 执行 Agent", content });
      };
      yield await emit({
        type: "message",
        agentRole: "负责人 Agent",
        content: [
          "决策原因：我会先把需求归类为平台、行业和交互类型，再决定是否读取当前页面或直接生成新 UI。",
          `质量上下文：平台=${qualityContext.platformLabel}，行业=${qualityContext.industry}，交互类型=${qualityContext.interactionTypes.join("、") || "待识别"}。`,
          `参考系统：${qualityContext.referenceSystems.join("、")}。`,
          qualityContext.designReferences.matchedReferenceIds.length > 0
            ? `已命中参考数据：${qualityContext.designReferences.matchedReferenceIds.join("、")}。`
            : "本次没有命中本地参考 schema 数据。"
        ].join("\n")
      });
      let uiDesignPlan: UiDesignerPlan | undefined;
      if (taskProfile.needUIAgent) {
        yield await emit({ type: "message", agentRole: "UI 设计师 Agent", content: "ReAct 思考：我先输出设计判断，不直接画 schema。重点确认平台规范、页面信息架构、组件粒度和审核标准。" });
        uiDesignPlan = await this.createUiDesignerPlan(project, llmForPlan, selectedPage, taskMessage, input.systemPrompt, qualityContext, recentConversationMessages, async (delta) => {
          const event: Extract<DesignAgentStreamEvent, { type: "llm_delta" }> = { type: "llm_delta", source: "ui-designer", delta, agentRole: "UI 设计师 Agent" };
          await emit(event);
          await input.onDeltaEvent?.(event);
        }, input.signal);
        yield await emit({ type: "message", agentRole: "UI 设计师 Agent", content: formatUiDesignPlanReply(uiDesignPlan) || "UI 设计判断已完成。" });
      }

      let toolPlan = resumeContext
        ? buildDesignAgentResumePlan(taskMessage, resumeContext)
        : await this.planDesignAgentTools(project, llmForPlan, file, selectedPage, taskMessage, input.systemPrompt, {
          taskProfile,
          uiDesignPlan,
          recentConversationMessages
        });
      if (!resumeContext) {
        toolPlan = normalizeDesignAgentPlanForIntent(taskMessage, toolPlan);
        validateDesignAgentPlanForIntent(taskMessage, toolPlan);
      }
      yield await emit({
        type: "plan",
        agentRole: "负责人 Agent",
        title: toolPlan.title,
        steps: toolPlan.steps.map((step, index) => `${index + 1}. ${getDesignAgentRoleForTool(step.tool)} -> ${step.tool}：${step.reason || "执行工具"}`),
        plan: toolPlan,
        uiDesignPlan
      });

      if (shouldStopAfterDesignAgentPlan(input.planningMode, toolPlan, taskMessage)) {
        yield await emit({ type: "done", agentRole: "负责人 Agent", summary: "已输出执行计划，当前为明确规划模式，未执行工具。", file, page: selectedPage, selectedPageId: selectedPage?.id });
        return;
      }

      if (toolPlan.steps.length === 0) {
        if (routeDesignAgentTask(taskMessage) === "create_new_ui") {
          toolPlan = normalizeDesignAgentPlanForIntent(taskMessage, {
            ...toolPlan,
            mode: "execute",
            reply: "这是生成 UI 稿任务，禁止空回答，我会按标准流程生成 UI 产物。"
          });
          yield await emit({
            type: "plan",
            agentRole: "负责人 Agent",
            title: toolPlan.title,
            steps: toolPlan.steps.map((step, index) => `${index + 1}. ${getDesignAgentRoleForTool(step.tool)} -> ${step.tool}：${step.reason || "执行工具"}`),
            plan: toolPlan,
            uiDesignPlan
          });
        } else {
        yield await emit({ type: "message", agentRole: "负责人 Agent", content: toolPlan.reply || "我判断这次不需要调用工具。" });
        yield await emit({ type: "done", agentRole: "负责人 Agent", summary: toolPlan.reply || "已完成回答。", file, page: selectedPage, selectedPageId: selectedPage?.id });
        return;
        }
      }

      let latestGeneratedFrameIds: string[] = resumeContext?.generatedFrameIds ?? [];
      let visualReviewFailure: DesignAgentToolResult | undefined;
      let didInitialPreviewReview = false;

      for (const step of toolPlan.steps.slice(0, 8)) {
        throwIfAborted(input.signal);
        if (routeDesignAgentTask(taskMessage) === "create_new_ui" && (step.tool === "canvas.capture" || step.tool === "ui.critic_review" || step.tool === "ui.review_design" || step.tool === "ui.review")) {
          yield await emit({
            type: "message",
            agentRole: "负责人 Agent",
            content: `流程调整：${step.tool} 延后到 UI 稿落盘并截图之后执行，避免在用户看到首版稿之前内部修复。`
          });
          continue;
        }
        let executableStep = step;
        if (step.tool === "schema.generate_ui_from_requirements" && routeDesignAgentTask(taskMessage) === "create_new_ui" && !step.input.targetFrameId && shouldUseIncrementalUiGeneration(taskMessage)) {
          const draftRequests = buildSequentialUiDraftRequests(taskMessage, uiDesignPlan);
          yield await emit({
            type: "message",
            agentRole: "Schema 执行 Agent",
            content: `制作 UI 稿改为增量推进：本次识别到 ${draftRequests.length} 个页面；每个页面先创建画板外框，再按区块逐块落盘、校验和截图观察。`
          });
          for (const draftRequest of draftRequests) {
            const pageSections = buildIncrementalUiSectionRequests(draftRequest, String(step.input.platform ?? ""), taskMessage);
            yield await emit({
              type: "message",
              agentRole: "Schema 执行 Agent",
              content: `正在生成页面「${draftRequest.name}」：先创建空画板，再分 ${pageSections.length} 个区块输出。`
            });
            throwIfAborted(input.signal);
            const shellDraft = createUiPageShellDraft(draftRequest, String(step.input.platform ?? ""), taskMessage);
            const shellStep: DesignAgentToolCall = {
              ...step,
              input: {
                ...step.input,
                userRequest: draftRequest.prompt,
                schemaDraft: shellDraft
              }
            };
            const agentRole = getDesignAgentRoleForTool(shellStep.tool);
            const shellToolCallId = createAgentRunId("tool");
            yield await emit({ type: "tool_call_start", agentRole, toolName: shellStep.tool, params: shellStep.input, reason: `${draftRequest.name} 创建画板外框`, toolCallId: shellToolCallId });
            const shellResult = await this.executeDesignToolStep(projectId, selectedPageId, shellStep, conversationId);
            yield await emit({
              type: "tool_call_result",
              agentRole,
              toolName: shellStep.tool,
              success: shellResult.ok,
              result: shellResult.data,
              error: shellResult.ok ? undefined : shellResult.message,
              message: shellResult.message,
              toolCallId: shellToolCallId
            });
            if (!shellResult.ok) {
              yield await emit({ type: "error", agentRole, message: shellResult.message });
              yield await emit({
                type: "done",
                agentRole: "负责人 Agent",
                summary: didPersistUi
                  ? `创建「${draftRequest.name}」画板失败，已停止后续页面，保留前面已完成页面。`
                  : `创建「${draftRequest.name}」画板失败，已停止后续页面；本次还没有成功生成或落盘任何 UI。`,
                file: latestFile,
                page: latestPage,
                selectedPageId
              });
              return;
            }
            if (shellResult.file) latestFile = shellResult.file;
            if (shellResult.page) latestPage = shellResult.page;
            if (shellResult.selectedPageId) selectedPageId = shellResult.selectedPageId;
            const generatedFrameIds = getGeneratedFrameIds(shellResult.data);
            const targetFrameId = generatedFrameIds[0];
            if (generatedFrameIds.length > 0) {
              latestGeneratedFrameIds = [...latestGeneratedFrameIds, ...generatedFrameIds];
            }
            didPersistUi = true;
            yield await emit({
              type: "schema_patch",
              agentRole,
              action: inferSchemaPatchAction(shellStep.tool),
              file: latestFile,
              page: latestPage,
              pageId: selectedPageId,
              nodeCount: latestPage?.nodes.length,
              selectedNodeIds: generatedFrameIds
            });
            if (!targetFrameId) {
              yield await emit({ type: "error", agentRole, message: `创建「${draftRequest.name}」后没有返回画板 ID，无法继续增量追加区块。` });
              return;
            }
            for (const section of pageSections) {
              throwIfAborted(input.signal);
              yield await emit({
                type: "message",
                agentRole: "Schema 执行 Agent",
                content: [
                  `边做边想：准备生成「${draftRequest.name} / ${section.name}」。`,
                  "行动策略：只输出本区块节点，追加到刚创建的画板内；追加后马上校验 schema 并截图观察接口是否正确。"
                ].join("\n")
              });
              const sectionDraft = await this.createUiSchemaDraft(project, llmForPlan, latestPage ?? selectedPage, section.prompt, input.systemPrompt, uiDesignPlan, String(step.input.platform ?? ""), qualityContext, async (delta) => {
                const event: Extract<DesignAgentStreamEvent, { type: "llm_delta" }> = { type: "llm_delta", source: "schema-draft", delta, agentRole: "Schema 执行 Agent" };
                await emit(event);
                await input.onDeltaEvent?.(event);
              }, emitSchemaDraftProgress, input.signal);
              const sectionStep: DesignAgentToolCall = {
                ...step,
                input: {
                  ...step.input,
                  userRequest: section.prompt,
                  targetFrameId,
                  schemaDraft: {
                    ...sectionDraft,
                    artboards: sectionDraft.artboards.slice(0, 1)
                  }
                }
              };
              const sectionToolCallId = createAgentRunId("tool");
              yield await emit({ type: "tool_call_start", agentRole, toolName: sectionStep.tool, params: sectionStep.input, reason: `${draftRequest.name} / ${section.name} 增量落盘`, toolCallId: sectionToolCallId });
              const sectionResult = await this.executeDesignToolStep(projectId, selectedPageId, sectionStep, conversationId);
              yield await emit({
                type: "tool_call_result",
                agentRole,
                toolName: sectionStep.tool,
                success: sectionResult.ok,
                result: sectionResult.data,
                error: sectionResult.ok ? undefined : sectionResult.message,
                message: sectionResult.message,
                toolCallId: sectionToolCallId
              });
              if (!sectionResult.ok) {
                yield await emit({ type: "error", agentRole, message: sectionResult.message });
                yield await emit({
                  type: "done",
                  agentRole: "负责人 Agent",
                  summary: didPersistUi
                    ? `生成「${draftRequest.name} / ${section.name}」失败，已停止后续区块，保留已完成区块。`
                    : `生成「${draftRequest.name} / ${section.name}」失败，已停止后续区块；本次还没有成功生成或落盘任何 UI。`,
                  file: latestFile,
                  page: latestPage,
                  selectedPageId
                });
                return;
              }
              if (sectionResult.file) latestFile = sectionResult.file;
              if (sectionResult.page) latestPage = sectionResult.page;
              if (sectionResult.selectedPageId) selectedPageId = sectionResult.selectedPageId;
              didPersistUi = true;
              yield await emit({
                type: "schema_patch",
                agentRole,
                action: inferSchemaPatchAction(sectionStep.tool),
                file: latestFile,
                page: latestPage,
                pageId: selectedPageId,
                nodeCount: latestPage?.nodes.length,
                selectedNodeIds: [targetFrameId]
              });
              const validateToolCallId = createAgentRunId("tool");
              const validateResult = await this.executeDesignToolStep(projectId, selectedPageId, { tool: "schema.validate", reason: `${section.name} 落盘后校验 schema 接口`, input: {} }, conversationId);
              yield await emit({ type: "tool_call_result", agentRole: "审核 Agent", toolName: "schema.validate", success: validateResult.ok, result: validateResult.data, error: validateResult.ok ? undefined : validateResult.message, message: `${draftRequest.name} / ${section.name}：${validateResult.message}`, toolCallId: validateToolCallId });
              const captureToolCallId = createAgentRunId("tool");
              const captureResult = await this.executeDesignToolStep(projectId, selectedPageId, { tool: "canvas.capture", reason: `${section.name} 落盘后观察画板预览`, input: { nodeIds: [targetFrameId], limit: 1 } }, conversationId);
              yield await emit({ type: "tool_call_result", agentRole: "审核 Agent", toolName: "canvas.capture", success: captureResult.ok, result: captureResult.data, error: captureResult.ok ? undefined : captureResult.message, message: `${draftRequest.name} / ${section.name}：${captureResult.message}`, toolCallId: captureToolCallId });
            }
          }
          continue;
        }
        if (step.tool === "schema.generate_ui_from_requirements" && !isUsableUiSchemaDraftInput(step.input.schemaDraft)) {
          yield await emit({ type: "message", agentRole: "Schema 执行 Agent", content: "我先让 Schema Agent 根据产品/设计上下文生成 aipm.design.schema.v1 草案，再执行落盘。" });
          const schemaDraftUserRequest = String(step.input.userRequest ?? taskMessage);
          const schemaDraft = await this.createUiSchemaDraft(project, llmForPlan, selectedPage, schemaDraftUserRequest, input.systemPrompt, uiDesignPlan, String(step.input.platform ?? ""), qualityContext, async (delta) => {
            const event: Extract<DesignAgentStreamEvent, { type: "llm_delta" }> = { type: "llm_delta", source: "schema-draft", delta, agentRole: "Schema 执行 Agent" };
            await emit(event);
            await input.onDeltaEvent?.(event);
          }, emitSchemaDraftProgress, input.signal);
          executableStep = {
            ...step,
            input: {
              ...step.input,
              schemaDraft
            }
          };
          yield await emit({
            type: "message",
            agentRole: "Schema 执行 Agent",
            content: [
              `Schema Draft 已生成：${schemaDraft.artboards.length} 个画板。`,
              schemaDraft.designRationale.length > 0 ? `设计依据：${schemaDraft.designRationale.join("；")}` : "",
              `画板：${schemaDraft.artboards.map((artboard) => `${artboard.name}(${artboard.width}x${artboard.height}, ${artboard.layoutIntent ? "layoutIntent" : `${artboard.nodes.length} nodes`})`).join("、")}`
            ].filter(Boolean).join("\n")
          });
        }
        if (executableStep.tool === "ui.critic_review") {
          executableStep = {
            ...executableStep,
            input: {
              ...executableStep.input,
              pageIds: selectedPageId ? [selectedPageId] : undefined,
              generatedFrameIds: latestGeneratedFrameIds
            }
          };
        }
        const toolCallId = createAgentRunId("tool");
        const agentRole = getDesignAgentRoleForTool(executableStep.tool);
        yield await emit({
          type: "message",
          agentRole,
          content: [
            `ReAct 思考：${executableStep.reason || "我需要执行这一步来推进任务。"}`,
            `ReAct 行动：调用 ${executableStep.tool}。`
          ].join("\n")
        });
        yield await emit({ type: "tool_call_start", agentRole, toolName: executableStep.tool, params: executableStep.input, reason: executableStep.reason, toolCallId });
        await this.repository.upsertAgentToolCall({
          id: toolCallId,
          conversationId,
          projectId,
          toolName: executableStep.tool,
          arguments: executableStep.input,
          status: "running",
          startedAt: nowIso()
        });

        const result = await this.executeDesignToolStep(projectId, selectedPageId, executableStep, conversationId);
        await this.repository.upsertAgentToolCall({
          id: toolCallId,
          conversationId,
          projectId,
          toolName: executableStep.tool,
          arguments: executableStep.input,
          result: result.data,
          status: result.ok ? "success" : "failed",
          error: result.ok ? undefined : result.message,
          startedAt: nowIso(),
          endedAt: nowIso()
        });
        yield await emit({
          type: "tool_call_result",
          agentRole,
          toolName: executableStep.tool,
          success: result.ok,
          result: result.data,
          error: result.ok ? undefined : result.message,
          message: result.message,
          toolCallId
        });
        yield await emit({
          type: "message",
          agentRole,
          content: `ReAct 观察：${result.ok ? "成功" : "失败"}，${result.message}`
        });

        if (result.file) latestFile = result.file;
        if (result.page) latestPage = result.page;
        if (result.selectedPageId) selectedPageId = result.selectedPageId;
        const generatedFrameIds = getGeneratedFrameIds(result.data);
        if (generatedFrameIds.length > 0) {
          latestGeneratedFrameIds = generatedFrameIds;
        }
        if (result.ok && isSchemaMutationTool(executableStep.tool)) {
          didPersistUi = true;
          yield await emit({
            type: "schema_patch",
            agentRole,
            action: inferSchemaPatchAction(executableStep.tool),
            file: latestFile,
            page: latestPage,
            pageId: selectedPageId,
            nodeCount: latestPage?.nodes.length,
            selectedNodeIds: generatedFrameIds
          });
        }

        if (!result.ok) {
          let failedResult = result;
          let recovered = false;
          let recoveryAttemptCount = 0;
          for (let retryAttempt = 1; retryAttempt <= 3; retryAttempt += 1) {
            const recoveryStep = buildDesignAgentRecoveryStep(taskMessage, executableStep, failedResult, retryAttempt);
            if (!recoveryStep) break;
            recoveryAttemptCount = retryAttempt;
            let executableRecoveryStep = recoveryStep;
            if (recoveryStep.tool === "schema.generate_ui_from_requirements" && !isUsableUiSchemaDraftInput(recoveryStep.input.schemaDraft)) {
              yield await emit({
                type: "message",
                agentRole: "Schema 执行 Agent",
                content: `${formatRetryAttemptLabel(retryAttempt)}重试：我会根据失败原因重新生成 schemaDraft，再追加一版修复稿。`
              });
              const schemaDraft = await this.createUiSchemaDraft(
                project,
                llmForPlan,
                selectedPage,
                String(recoveryStep.input.userRequest ?? message),
                input.systemPrompt,
                uiDesignPlan,
                String(recoveryStep.input.platform ?? ""),
                qualityContext,
                async (delta) => {
                  const event: Extract<DesignAgentStreamEvent, { type: "llm_delta" }> = { type: "llm_delta", source: "schema-draft", delta, agentRole: "Schema 执行 Agent" };
                  await emit(event);
                  await input.onDeltaEvent?.(event);
                },
                emitSchemaDraftProgress,
                input.signal
              );
              executableRecoveryStep = {
                ...recoveryStep,
                input: {
                  ...recoveryStep.input,
                  schemaDraft
                }
              };
            }
            const recoveryToolCallId = createAgentRunId("tool");
            const recoveryAgentRole = getDesignAgentRoleForTool(executableRecoveryStep.tool);
            yield await emit({ type: "message", agentRole: "负责人 Agent", content: `${formatRetryAttemptLabel(retryAttempt)}重试：${executableRecoveryStep.reason}` });
            yield await emit({ type: "tool_call_start", agentRole: recoveryAgentRole, toolName: executableRecoveryStep.tool, params: executableRecoveryStep.input, reason: executableRecoveryStep.reason, toolCallId: recoveryToolCallId });
            await this.repository.upsertAgentToolCall({
              id: recoveryToolCallId,
              conversationId,
              projectId,
              toolName: executableRecoveryStep.tool,
              arguments: executableRecoveryStep.input,
              status: "running",
              startedAt: nowIso()
            });
            const recoveryResult = await this.executeDesignToolStep(projectId, selectedPageId, executableRecoveryStep, conversationId);
            await this.repository.upsertAgentToolCall({
              id: recoveryToolCallId,
              conversationId,
              projectId,
              toolName: executableRecoveryStep.tool,
              arguments: executableRecoveryStep.input,
              result: recoveryResult.data,
              status: recoveryResult.ok ? "success" : "failed",
              error: recoveryResult.ok ? undefined : recoveryResult.message,
              startedAt: nowIso(),
              endedAt: nowIso()
            });
            yield await emit({
              type: "tool_call_result",
              agentRole: recoveryAgentRole,
              toolName: executableRecoveryStep.tool,
              success: recoveryResult.ok,
              result: recoveryResult.data,
              error: recoveryResult.ok ? undefined : recoveryResult.message,
              message: recoveryResult.message,
              toolCallId: recoveryToolCallId
            });
            if (recoveryResult.ok) {
              if (recoveryResult.file) latestFile = recoveryResult.file;
              if (recoveryResult.page) latestPage = recoveryResult.page;
              if (recoveryResult.selectedPageId) selectedPageId = recoveryResult.selectedPageId;
              const recoveryGeneratedFrameIds = getGeneratedFrameIds(recoveryResult.data);
              if (recoveryGeneratedFrameIds.length > 0) {
                latestGeneratedFrameIds = recoveryGeneratedFrameIds;
              }
              if (isSchemaMutationTool(executableRecoveryStep.tool)) {
                didPersistUi = true;
                yield await emit({
                  type: "schema_patch",
                  agentRole: recoveryAgentRole,
                  action: inferSchemaPatchAction(executableRecoveryStep.tool),
                  file: latestFile,
                  page: latestPage,
                  pageId: selectedPageId,
                  nodeCount: latestPage?.nodes.length,
                  selectedNodeIds: recoveryGeneratedFrameIds
                });
              }
              recovered = true;
              break;
            }
            failedResult = recoveryResult;
          }
          if (recovered) continue;
          yield await emit({ type: "error", agentRole: "负责人 Agent", message: failedResult.message });
          yield await emit({
            type: "done",
            agentRole: "负责人 Agent",
            summary: recoveryAttemptCount > 0
              ? `${formatFailureStopSummary(failedResult.message)} 已完成 ${recoveryAttemptCount} 次恢复尝试。`
              : `${formatFailureStopSummary(failedResult.message)} 当前失败类型没有安全的自动恢复步骤。`,
            file: latestFile,
            page: latestPage,
            selectedPageId
          });
          return;
        }
      }

      if (routeDesignAgentTask(taskMessage) === "create_new_ui" || latestGeneratedFrameIds.length > 0) {
        didInitialPreviewReview = true;
        const captureToolCallId = createAgentRunId("tool");
        yield await emit({
          type: "message",
          agentRole: "审核 Agent",
          content: "首版 UI 稿已落到画布。现在先截取本次生成的画板，让你能看到稿子，再基于截图做产品/交互/视觉审查。"
        });
        yield await emit({
          type: "tool_call_start",
          agentRole: "审核 Agent",
          toolName: "canvas.capture",
          params: latestGeneratedFrameIds.length > 0 ? { nodeIds: latestGeneratedFrameIds, limit: 6 } : { mode: "rightmost_artboards", limit: 6 },
          reason: "先输出首版 UI 截图，再进入审查和修复。",
          toolCallId: captureToolCallId
        });
        const captureResult = await this.executeDesignToolStep(projectId, selectedPageId, {
          tool: "canvas.capture",
          reason: "先输出首版 UI 截图，再进入审查和修复。",
          input: latestGeneratedFrameIds.length > 0 ? { nodeIds: latestGeneratedFrameIds, limit: 6 } : { mode: "rightmost_artboards", limit: 6 }
        }, conversationId);
        yield await emit({
          type: "tool_call_result",
          agentRole: "审核 Agent",
          toolName: "canvas.capture",
          success: captureResult.ok,
          result: captureResult.data,
          error: captureResult.ok ? undefined : captureResult.message,
          message: captureResult.message,
          toolCallId: captureToolCallId
        });
        const previews = extractVisualPreviewImages(captureResult.data);
        if (captureResult.ok && previews.length > 0) {
          const visualToolCallId = createAgentRunId("tool");
          yield await emit({
            type: "tool_call_start",
            agentRole: "审核 Agent",
            toolName: "ui.visual_review",
            params: { previewCount: previews.length, platform: qualityContext.platformLabel, industry: qualityContext.industry },
            reason: "基于首版截图审查产品要求、交互规范和视觉美观度。",
            toolCallId: visualToolCallId
          });
          try {
            const rawVisualReview = await this.createVisualDesignReview(project, llmForPlan, taskMessage, qualityContext, previews);
            const visualReview = enforceVisualQualityGate(rawVisualReview);
            const visualReviewMessage = formatVisualDesignReviewMessage(visualReview);
            yield await emit({
              type: "tool_call_result",
              agentRole: "审核 Agent",
              toolName: "ui.visual_review",
              success: visualReview.passed,
              result: { visualReview, previews },
              error: visualReview.passed ? undefined : visualReviewMessage,
              message: visualReviewMessage,
              toolCallId: visualToolCallId
            });
            if (!visualReview.passed) {
              visualReviewFailure = {
                ok: false,
                message: visualReviewMessage,
                data: { visualReview, previews },
                file: latestFile,
                page: latestPage,
                selectedPageId
              };
            }
          } catch (error) {
            const visualError = error instanceof Error ? error.message : String(error);
            const isUnsupportedVisionImage = /InvalidParameter|provided URL does not appear to be valid|image_url|data URL|invalid_parameter/i.test(visualError);
            yield await emit({
              type: "tool_call_result",
              agentRole: "审核 Agent",
              toolName: "ui.visual_review",
              success: isUnsupportedVisionImage,
              result: { previews },
              error: isUnsupportedVisionImage ? undefined : visualError,
              message: isUnsupportedVisionImage
                ? "视觉审核已跳过：当前模型服务不接受截图 data URL，后续继续执行结构化 UI/schema 审核。"
                : `视觉审核调用失败：${visualError}`,
              toolCallId: visualToolCallId
            });
          }
        }
      }

      const reviewToolName: DesignAgentToolCall["tool"] = routeDesignAgentTask(taskMessage) === "create_new_ui" || /搜索|筛选|查询|filter|search|query|页面|ui|UI|设计|小程序|app/i.test(taskMessage) ? "ui.review_design" : "ui.review";
      const reviewAgentRole = getDesignAgentRoleForTool(reviewToolName);
      const reviewToolCallId = createAgentRunId("tool");
      yield await emit({ type: "message", agentRole: reviewAgentRole, content: "工具执行完成，我现在做一次 UI/schema 审核。" });
      yield await emit({ type: "tool_call_start", agentRole: reviewAgentRole, toolName: reviewToolName, params: {}, reason: "执行完成后做综合检查", toolCallId: reviewToolCallId });
      let reviewResult = await this.executeDesignToolStep(projectId, selectedPageId, {
        tool: reviewToolName,
        reason: "执行完成后由审核 Agent 做一次 UI/schema 综合检查。",
        input: { userRequest: taskMessage, generatedFrameIds: latestGeneratedFrameIds }
      }, conversationId);
      yield await emit({
        type: "tool_call_result",
        agentRole: reviewAgentRole,
        toolName: reviewToolName,
        success: reviewResult.ok,
        result: reviewResult.data,
        error: reviewResult.ok ? undefined : reviewResult.message,
        message: reviewResult.message,
        toolCallId: reviewToolCallId
      });
      if (visualReviewFailure && reviewResult.ok) {
        reviewResult = visualReviewFailure;
      }
      if (!reviewResult.ok) {
        for (let reviewFixAttempt = 1; reviewFixAttempt <= 3 && !reviewResult.ok; reviewFixAttempt += 1) {
          const fixStep = buildDesignReviewFixStep(reviewResult.data, taskMessage, reviewFixAttempt);
          if (!fixStep) {
            yield await emit({
              type: "message",
              agentRole: "负责人 Agent",
              content: "ReAct 观察：审核失败，但当前问题没有安全的自动修复动作，我会保留现状并把问题交给你确认。"
            });
            break;
          }
          let executableFixStep = fixStep;
          if (fixStep.tool === "schema.generate_ui_from_requirements" && !isUsableUiSchemaDraftInput(fixStep.input.schemaDraft)) {
            yield await emit({
              type: "message",
              agentRole: "Schema 执行 Agent",
              content: `${formatRetryAttemptLabel(reviewFixAttempt)}审核修复：这是结构性问题，我会重新生成一版更严格的 UI Schema，而不是继续在坏稿上小修。`
            });
            const schemaDraft = await this.createUiSchemaDraft(
              project,
              llmForPlan,
              selectedPage,
              String(fixStep.input.userRequest ?? message),
              input.systemPrompt,
              uiDesignPlan,
              String(fixStep.input.platform ?? ""),
              qualityContext,
              async (delta) => {
                const event: Extract<DesignAgentStreamEvent, { type: "llm_delta" }> = { type: "llm_delta", source: "schema-draft", delta, agentRole: "Schema 执行 Agent" };
                await emit(event);
                await input.onDeltaEvent?.(event);
              },
              emitSchemaDraftProgress,
              input.signal
            );
            executableFixStep = {
              ...fixStep,
              input: {
                ...fixStep.input,
                schemaDraft
              }
            };
            yield await emit({
              type: "message",
              agentRole: "Schema 执行 Agent",
              content: [
                `修复 Schema Draft 已生成：${schemaDraft.artboards.length} 个画板。`,
                schemaDraft.designRationale.length > 0 ? `修复依据：${schemaDraft.designRationale.join("；")}` : "",
                `画板：${schemaDraft.artboards.map((artboard) => `${artboard.name}(${artboard.width}x${artboard.height}, ${artboard.layoutIntent ? "layoutIntent" : `${artboard.nodes.length} nodes`})`).join("、")}`
              ].filter(Boolean).join("\n")
            });
          }
          const fixToolCallId = createAgentRunId("tool");
          const fixAgentRole = getDesignAgentRoleForTool(executableFixStep.tool);
          yield await emit({
            type: "message",
            agentRole: fixAgentRole,
            content: [
              `ReAct 思考：${executableFixStep.reason || "根据审核问题执行自动修复。"}`,
              `ReAct 行动：调用 ${executableFixStep.tool}。`
            ].join("\n")
          });
          yield await emit({ type: "tool_call_start", agentRole: fixAgentRole, toolName: executableFixStep.tool, params: executableFixStep.input, reason: executableFixStep.reason, toolCallId: fixToolCallId });
          const fixResult = await this.executeDesignToolStep(projectId, selectedPageId, executableFixStep, conversationId);
          yield await emit({
            type: "tool_call_result",
            agentRole: fixAgentRole,
            toolName: executableFixStep.tool,
            success: fixResult.ok,
            result: fixResult.data,
            error: fixResult.ok ? undefined : fixResult.message,
            message: fixResult.message,
            toolCallId: fixToolCallId
          });
          yield await emit({
            type: "message",
            agentRole: fixAgentRole,
            content: `ReAct 观察：${fixResult.ok ? "修复动作成功" : "修复动作失败"}，${fixResult.message}`
          });
          if (fixResult.ok) {
            if (fixResult.file) latestFile = fixResult.file;
            if (fixResult.page) latestPage = fixResult.page;
            if (fixResult.selectedPageId) selectedPageId = fixResult.selectedPageId;
            const fixGeneratedFrameIds = getGeneratedFrameIds(fixResult.data);
            if (fixGeneratedFrameIds.length > 0) {
              latestGeneratedFrameIds = fixGeneratedFrameIds;
            }
            if (isSchemaMutationTool(executableFixStep.tool)) {
              didPersistUi = true;
              yield await emit({
                type: "schema_patch",
                agentRole: fixAgentRole,
                action: inferSchemaPatchAction(executableFixStep.tool),
                file: latestFile,
                page: latestPage,
                pageId: selectedPageId,
                nodeCount: latestPage?.nodes.length,
                selectedNodeIds: fixGeneratedFrameIds
              });
            }
            const postFixCaptureInput = latestGeneratedFrameIds.length > 0
              ? { nodeIds: latestGeneratedFrameIds, limit: 6 }
              : { mode: "rightmost_artboards", limit: 6 };
            const postFixCaptureToolCallId = createAgentRunId("tool");
            yield await emit({
              type: "tool_call_start",
              agentRole: reviewAgentRole,
              toolName: "canvas.capture",
              params: postFixCaptureInput,
              reason: `${formatRetryAttemptLabel(reviewFixAttempt)}自动修复后重新截图，再进入复审。`,
              toolCallId: postFixCaptureToolCallId
            });
            const postFixCaptureResult = await this.executeDesignToolStep(projectId, selectedPageId, {
              tool: "canvas.capture",
              reason: `${formatRetryAttemptLabel(reviewFixAttempt)}自动修复后重新截图，再进入复审。`,
              input: postFixCaptureInput
            }, conversationId);
            yield await emit({
              type: "tool_call_result",
              agentRole: reviewAgentRole,
              toolName: "canvas.capture",
              success: postFixCaptureResult.ok,
              result: postFixCaptureResult.data,
              error: postFixCaptureResult.ok ? undefined : postFixCaptureResult.message,
              message: postFixCaptureResult.message,
              toolCallId: postFixCaptureToolCallId
            });
            const secondReviewToolCallId = createAgentRunId("tool");
            yield await emit({ type: "tool_call_start", agentRole: reviewAgentRole, toolName: reviewToolName, params: {}, reason: `${formatRetryAttemptLabel(reviewFixAttempt)}自动修复后再次审核`, toolCallId: secondReviewToolCallId });
            reviewResult = await this.executeDesignToolStep(projectId, selectedPageId, {
              tool: reviewToolName,
              reason: `${formatRetryAttemptLabel(reviewFixAttempt)}自动修复后由审核 Agent 复查。`,
              input: { userRequest: taskMessage, generatedFrameIds: latestGeneratedFrameIds }
            }, conversationId);
            yield await emit({
              type: "tool_call_result",
              agentRole: reviewAgentRole,
              toolName: reviewToolName,
              success: reviewResult.ok,
              result: reviewResult.data,
              error: reviewResult.ok ? undefined : reviewResult.message,
              message: reviewResult.message,
              toolCallId: secondReviewToolCallId
            });
            yield await emit({
              type: "message",
              agentRole: reviewAgentRole,
              content: `ReAct 观察：${formatRetryAttemptLabel(reviewFixAttempt)}复审${reviewResult.ok ? "通过" : "仍未通过"}，${reviewResult.message}`
            });
          } else {
            break;
          }
        }
      }
      const shouldRunVisualReview = routeDesignAgentTask(taskMessage) === "create_new_ui" || latestGeneratedFrameIds.length > 0;
      if (shouldRunVisualReview && !didInitialPreviewReview) {
        const captureToolCallId = createAgentRunId("tool");
        yield await emit({
          type: "message",
          agentRole: "审核 Agent",
          content: "ReAct 思考：schema 规则审核只能看坐标和节点，我现在截取本次画板，让视觉模型从截图判断是否真的遮挡、是否符合平台风格。"
        });
        yield await emit({
          type: "tool_call_start",
          agentRole: "审核 Agent",
          toolName: "canvas.capture",
          params: latestGeneratedFrameIds.length > 0 ? { nodeIds: latestGeneratedFrameIds, limit: 6 } : { mode: "rightmost_artboards", limit: 6 },
          reason: "生成画板截图，供视觉审核和人工放大查看。",
          toolCallId: captureToolCallId
        });
        const captureResult = await this.executeDesignToolStep(projectId, selectedPageId, {
          tool: "canvas.capture",
          reason: "生成画板截图，供视觉审核和人工放大查看。",
          input: latestGeneratedFrameIds.length > 0 ? { nodeIds: latestGeneratedFrameIds, limit: 6 } : { mode: "rightmost_artboards", limit: 6 }
        }, conversationId);
        yield await emit({
          type: "tool_call_result",
          agentRole: "审核 Agent",
          toolName: "canvas.capture",
          success: captureResult.ok,
          result: captureResult.data,
          error: captureResult.ok ? undefined : captureResult.message,
          message: captureResult.message,
          toolCallId: captureToolCallId
        });
        const previews = extractVisualPreviewImages(captureResult.data);
        if (captureResult.ok && previews.length > 0) {
          const visualToolCallId = createAgentRunId("tool");
          yield await emit({
            type: "tool_call_start",
            agentRole: "审核 Agent",
            toolName: "ui.visual_review",
            params: { previewCount: previews.length, platform: qualityContext.platformLabel, industry: qualityContext.industry },
            reason: "使用视觉模型审核截图质量、平台匹配、遮挡和交互专业度。",
            toolCallId: visualToolCallId
          });
          try {
            const rawVisualReview = await this.createVisualDesignReview(project, llmForPlan, taskMessage, qualityContext, previews);
            const visualReview = enforceVisualQualityGate(rawVisualReview);
            const visualReviewMessage = formatVisualDesignReviewMessage(visualReview);
            yield await emit({
              type: "tool_call_result",
              agentRole: "审核 Agent",
              toolName: "ui.visual_review",
              success: visualReview.passed,
              result: { visualReview, previews },
              error: visualReview.passed ? undefined : visualReviewMessage,
              message: visualReviewMessage,
              toolCallId: visualToolCallId
            });
            if (!visualReview.passed && reviewResult.ok) {
              reviewResult = {
                ok: false,
                message: visualReviewMessage,
                data: { visualReview, previews },
                file: latestFile,
                page: latestPage,
                selectedPageId
              };
            }
          } catch (error) {
            const visualError = error instanceof Error ? error.message : String(error);
            yield await emit({
              type: "tool_call_result",
              agentRole: "审核 Agent",
              toolName: "ui.visual_review",
              success: false,
              result: { previews },
              error: visualError,
              message: `视觉审核调用失败：${visualError}`,
              toolCallId: visualToolCallId
            });
          }
        }
      }
      yield await emit({ type: "review", agentRole: reviewAgentRole, result: reviewResult.data, message: reviewResult.message });
      if (reviewResult.file) latestFile = reviewResult.file;
      if (reviewResult.page) latestPage = reviewResult.page;
      if (reviewResult.selectedPageId) selectedPageId = reviewResult.selectedPageId;

      yield await emit({
        type: "done",
        agentRole: "负责人 Agent",
        summary: reviewResult.ok ? "已完成：计划内工具执行完毕，并完成 UI/schema 审核。" : "工具已执行，但审核阶段发现问题，请查看 review 信息。",
        file: latestFile,
        page: latestPage,
        selectedPageId
      });
    } catch (error) {
      const messageText = formatDesignAgentError(error);
      yield await emit({ type: "error", agentRole: "负责人 Agent", message: messageText });
      yield await emit({
        type: "done",
        agentRole: "负责人 Agent",
        summary: formatFailureStopSummary(messageText),
        file: latestFile,
        page: latestPage,
        selectedPageId
      });
    }
  }

  private async buildDesignAgentResumeContext(
    projectId: string,
    conversationId: string,
    recentMessages: RecentDesignAgentMessage[],
    currentMessage?: string
  ): Promise<DesignAgentResumeContext | undefined> {
    const toolCalls = await this.repository.listAgentToolCalls({ projectId, conversationId, limit: 80 }) as DesignAgentToolHistoryItem[];
    const userRequest = inferResumeUserRequest(recentMessages, toolCalls);
    if (!userRequest) return undefined;
    const successfulMutations = toolCalls
      .filter((call) => call.status === "success" && isSchemaMutationTool(call.toolName as DesignAgentToolCall["tool"]))
      .sort((first, second) => second.startedAt.localeCompare(first.startedAt));
    const lastMutation = successfulMutations[0];
    const generatedFrameIds = Array.from(new Set(successfulMutations.flatMap((call) => getGeneratedFrameIds(call.result))));
    const lastMutationAt = lastMutation?.startedAt ?? "";
    const hasCaptureAfterLastMutation = Boolean(lastMutationAt) && toolCalls.some((call) => (
      call.status === "success"
      && call.toolName === "canvas.capture"
      && call.startedAt.localeCompare(lastMutationAt) >= 0
    ));
    const hasReviewAfterLastMutation = Boolean(lastMutationAt) && toolCalls.some((call) => (
      call.status === "success"
      && (call.toolName === "ui.review_design" || call.toolName === "ui.review" || call.toolName === "ui.critic_review")
      && call.startedAt.localeCompare(lastMutationAt) >= 0
    ));
    const lastFailedTool = toolCalls.find((call) => call.status === "failed");
    const lastSchemaTool = toolCalls.find((call) => call.toolName === "schema.generate_ui_from_requirements");
    const hadSuccessfulSchemaMutation = Boolean(lastMutation);
    const shouldUseCreateUiFlow = routeDesignAgentTask(userRequest) === "create_new_ui";
    return {
      userRequest,
      feedbackMessage: currentMessage && isQualityFeedbackResumeMessage(currentMessage) ? currentMessage.trim() : undefined,
      reason: summarizeResumeDecision({
        lastFailedTool,
        hadSuccessfulSchemaMutation,
        generatedFrameIds,
        hasCaptureAfterLastMutation,
        hasReviewAfterLastMutation
      }),
      lastFailedTool,
      lastSchemaTool,
      generatedFrameIds,
      shouldUseCreateUiFlow,
      hadSuccessfulSchemaMutation,
      hasCaptureAfterLastMutation,
      hasReviewAfterLastMutation
    };
  }

  async listDesignAgentMessages(projectId: string, input?: {
    conversationId?: string;
    limit?: number;
  }) {
    await this.repository.getProject(projectId);
    const conversationId = input?.conversationId || `design-agent-${projectId}`;
    const messages = await this.repository.listAgentMessages({
      projectId,
      conversationId,
      limit: input?.limit ?? 200
    });
    const visibleEventTypes = new Set(["message", "llm_delta", "plan", "tool_call_start", "tool_call_result", "schema_patch", "review", "done", "error"]);
    const visibleMessages = messages
      .filter((message) => message.content.trim())
      .filter((message) => !message.eventType || visibleEventTypes.has(message.eventType));
    const compacted = visibleMessages.reduce<typeof visibleMessages>((result, message) => {
      const previous = result[result.length - 1];
      if (message.eventType === "llm_delta" && previous?.eventType === "llm_delta") {
        result[result.length - 1] = {
          ...previous,
          content: `${previous.content}${message.content}`,
          metadata: message.metadata ?? previous.metadata
        };
        return result;
      }
      result.push(message);
      return result;
    }, []);
    return compacted
      .map((message, index) => {
        const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
          ? message.metadata as Record<string, unknown>
          : {};
        return {
          id: `${conversationId}-${message.createdAt}-${index}`,
          role: message.role === "user" ? "user" : "assistant",
          content: message.eventType === "llm_delta" ? `模型推理中：\n${message.content}` : message.content,
          eventType: message.eventType,
          toolName: message.toolName,
          agentRole: typeof metadata.agentRole === "string" ? metadata.agentRole : undefined,
          previewImages: extractPreviewImagesFromEventMetadata(metadata),
          createdAt: message.createdAt
        };
      });
  }

  async getDesignAgentCurrent(projectId: string, input?: {
    conversationId?: string;
    limit?: number;
    running?: boolean;
  }) {
    const conversationId = input?.conversationId || `design-agent-${projectId}`;
    const messages = await this.listDesignAgentMessages(projectId, {
      conversationId,
      limit: input?.limit ?? 300
    });
    const lastEvent = messages[messages.length - 1];
    return {
      conversationId,
      running: Boolean(input?.running),
      canResume: messages.length > 0,
      lastEventType: lastEvent?.eventType,
      messages
    };
  }

  async recordDesignAgentCancellation(projectId: string, conversationId: string, cancelled: boolean) {
    await this.repository.saveAgentMessage({
      id: createAgentRunId("msg"),
      conversationId,
      projectId,
      role: "assistant",
      content: cancelled
        ? "已中断当前会话的执行。你可以点击继续会话，根据上下文续接未完成步骤。"
        : "当前没有正在运行的会话。你可以点击继续会话，根据上下文续接未完成步骤。",
      eventType: "message",
      metadata: { agentRole: "负责人 Agent", cancelled },
      createdAt: nowIso()
    });
  }

  private async getDesignAgentSelectedPage(projectId: string, file: WorkspaceDesignFile, pageId?: string) {
    const pageMeta = pageId
      ? file.pages.find((page) => page.id === pageId)
      : file.pages[0];
    if (!pageMeta) {
      return undefined;
    }
    return this.repository.getDesignPage(projectId, pageMeta.id).catch(() => pageMeta);
  }

  private async planDesignAgentTools(
    project: WorkspaceProject,
    llm: OpenAIClient,
    file: WorkspaceDesignFile,
    selectedPage: WorkspaceDesignPage | undefined,
    message: string,
    systemPrompt?: string,
    options?: {
      taskProfile?: ReturnType<typeof classifyDesignAgentTask>;
      uiDesignPlan?: UiDesignerPlan;
      recentConversationMessages?: Array<{ role: string; eventType?: string; toolName?: string; content: string; createdAt: string }>;
    }
  ) {
    const localComponentLibraries = await this.getLocalComponentLibrarySummary(project.id, file);
    const pageTemplates = this.getPageTemplateSummary(file);
    return this.generateJsonWithRepair(llm, designAgentPlanSchema, {
      systemPrompt: [
        project.systemPrompt || "",
        systemPrompt || "",
        "你是 AI Design Agent 的主调度器，负责把用户意图、当前页面 schema、UI 设计方案转成标准 tool 调用计划。",
        "你的第一步是任务路由：create_new_ui / edit_existing_ui / extend_existing_ui / generate_component / generate_flow。",
        "如果用户说“根据需求生成 UI 稿/生成交互稿/生成交互 UI 稿/做一个 App 页面/设计一组页面/新建 UI”，必须是 create_new_ui：在当前画布已有画板右侧追加新 UI 画板，不修改已有节点。",
        "用户需求文本里的“添加、编辑、删除、管理、上传、绑定”等词通常是产品功能，不是画布编辑指令；不能因此路由为 edit_existing_ui。",
        "create_new_ui 禁止返回空 steps，原则上必须产出 UI schema、画板和预览截图。",
        "create_new_ui 不等于新建独立文件页面；必须使用 schema.generate_ui_from_requirements 在当前画布追加画板。",
        "create_new_ui 生成的画板必须和当前画布已有画板顶对齐，向右追加，默认水平间距 40px。",
        "只有用户明确说“修改当前页面/修改这个页面/修改选中节点/在画布指定地方修改/改这里”时，才允许使用 page.get_schema 和页面编辑工具。",
        "create_new_ui 必须按 requirement.parse -> flow.generate -> page_template.list -> component_library.list/component.search -> asset.resolve -> schema.generate_ui_from_requirements -> ui.critic_review 的链路规划。",
        "create_new_ui 的计划必须覆盖用户需求中的主要功能点，禁止引入用户未提到的业务对象，例如订单、商品列表、搜索筛选区。",
        "你具备自我判断、自我推理和多轮执行意识：先读上下文，再定位目标，再修改，再校验。",
        "你的输出必须是可执行计划，不要假装已经执行。",
        "执行任何页面局部修改前，第一步必须使用 page.get_schema 获取当前页面 schema，再基于返回信息选择 schema.* 工具。",
        "如果需要定位左侧/右侧/顶部/内容区，优先在 page.get_schema 后使用 schema.find_nodes 查询目标节点。",
        "只有用户明确提到列表/表格/数据表，并要求添加搜索条件/筛选条件/查询条件时，才走 page.analyze_structure -> product.review_requirements -> layout.insert_above；地图搜索、地址搜索、登录页搜索不属于列表筛选。",
        "product.review_requirements 如果没有识别到列表/表格，必须拒绝业务字段建议，禁止臆测订单、商品等业务对象。",
        "如果 schema.update_node 失败或找不到目标，不要直接停止；应切换到 layout.insert_above、schema.add_nodes 或 layout.reflow 完成用户目标。",
        "当用户要求调整间距、重排、上移/下移区块、给表格加列、给表单加字段时，优先使用 layout.apply_intent_patch，而不是手写 x/y 坐标。",
        "当用户说“添加菜单/新增菜单/左侧添加菜单/导航栏/侧边栏菜单”，必须使用 schema.create_menu，不要使用 schema.update_node。",
        "当用户说“本地组件库/组件库/插入组件/使用某某组件/用本地 AntD 组件库”等，必须先 component_library.list 或 component.search，再使用 component.insert 插入本地组件资产；不要退化成 schema.generate_from_prompt。",
        "如果项目存在页面模板 pageTemplates，create_new_ui 时必须把模板作为页面风格和整页结构参考；模板不是组件库，不能直接当组件插入，但要继承其 StyleProfile、布局密度和区块组织方式。",
        "当用户说“添加/插入/修改/调整 table/text/image/group/shapeGroup/container”等组件时，必须使用 schema.* 工具修改当前页面，不要新建页面。",
        "只有用户明确说“新建独立页面/创建独立页面/新增文件页面/复制页面”时才使用 page.create；普通生成 UI 稿不要用 page.create。",
        "如果用户需求涉及页面设计、排版、风格、组件选择，应参考 UI 设计 Agent 的设计方案生成 tool steps。",
        "如果用户提到参考、素材、竞品、联网搜索，并且 web.search tool 可用，可以先规划 web.search；如果工具返回不可用，要把不可用原因和建议告诉用户。",
        "如果用户只问问题，mode=answer 且 steps=[]。",
        "如果用户要求先规划、不要执行，mode=plan。",
        "每次修改后尽量追加 schema.validate 校验，并在 UI 任务最后使用 ui.review_design 或 ui.review 审核。",
        "plan.title 要说明任务目标；plan.userGoal 要复述用户目标；plan.assumptions 写出关键假设。",
        "可用工具如下：",
        JSON.stringify(designAgentToolDescriptions, null, 2)
      ].filter(Boolean).join("\n\n"),
      userPrompt: JSON.stringify({
        userMessage: message,
        taskProfile: options?.taskProfile,
        uiDesignPlan: options?.uiDesignPlan ?? null,
        recentConversationMessages: options?.recentConversationMessages?.slice(-24) ?? [],
        localComponentLibraries,
        pageTemplates,
        selectedPageId: selectedPage?.id,
        selectedPage: selectedPage ? summarizeDesignPageForPrompt(selectedPage) : null,
        pages: file.pages.map((page) => ({ id: page.id, name: page.name, nodeCount: page.nodeCount ?? page.nodes.length }))
      }, null, 2),
      temperature: 0.2
    });
  }

  private async createUiDesignerPlan(
    project: WorkspaceProject,
    llm: OpenAIClient,
    selectedPage: WorkspaceDesignPage | undefined,
    message: string,
    systemPrompt?: string,
    qualityContext?: ReturnType<typeof buildDesignQualityContext>,
    recentConversationMessages?: Array<{ role: string; eventType?: string; toolName?: string; content: string; createdAt: string }>,
    onToken?: (delta: string) => void | Promise<void>,
    signal?: AbortSignal
  ) {
    const [localComponentLibraries, pageTemplates] = await Promise.all([
      this.getLocalComponentLibrarySummary(project.id),
      this.getPageTemplateSummaryForProject(project.id)
    ]);
    const pageTemplateMatch = selectPageTemplateContractForPrompt(pageTemplates, message, /小程序|移动端|手机|app/i.test(message) ? "mobile_app" : "web");
    return this.generateJsonWithRepair(llm, uiDesignerPlanSchema, {
      systemPrompt: [
        project.systemPrompt || "",
        systemPrompt || "",
        "你是一个高级 UI 设计师 Agent，只负责设计决策，不直接修改 schema，不调用工具。",
        "你需要理解业务目标、页面结构、组件选择、视觉规范和可编辑性要求。",
        "你必须像一个独立设计师一样输出自己的专业判断：平台、行业、交互类型、信息架构、视觉参考、组件粒度、页面状态和审核清单。",
        "架构原则：AI 只负责组织信息和语义结构，不要把每个 x/y 当成设计质量来源；后续 Layout Compiler 会负责位置、尺寸、gap、组件展开和 Scene Graph 生成。",
        "输出 pageSpecs/keyBlocks 时要接近 Semantic Tree：Page、Toolbar、SearchBar、Tabs、CardList、Form、ActionBar、StatusPanel 等语义组件，而不是直接描述一堆绝对坐标。",
        "页面契约必须明确：每个 pageSpecs 项必须输出 pageMode、businessEntity、layoutPattern、requiredRegions、forbiddenRegions、componentFamilies。",
        "pageMode 只能是 collection/detail/form/dashboard/auth/settings/flow/landing/unknown。不要让后端靠关键词猜页面类型。",
        "requiredRegions/forbiddenRegions 使用语义组件名，例如 Header、Toolbar、Summary、FilterBar、Table、CardList、DescriptionList、Form、Pagination、Steps、Timeline、ActionBar。",
        "典型契约：详情页 requiredRegions=[Header,Summary,DescriptionList,ActionBar]，forbiddenRegions=[FilterBar,Table,Pagination]；列表页 requiredRegions=[Header,FilterBar,Table,Pagination,ActionBar]；表单页 requiredRegions=[Header,Form,ActionBar]。",
        "不要泛泛说“好看/简洁”，要说明采用哪类成熟交互范式，例如 Ant Design 后台、微信小程序单列卡片、App 原生表单、Tailwind SaaS 仪表盘。",
        "如果目标是小程序/移动端，禁止规划 PC dashboard、宽表格和横向统计大屏。",
        "输出必须结构化 JSON，供主 Agent 转成 schema tool 调用。",
        "如果 qualityContext.designReferences 命中本地参考数据，要把它作为设计基准：学习布局密度、间距、颜色、层级和组件构成，不要照抄业务文案和节点 ID。",
        "如果 localComponentLibraries 非空，必须优先从本地组件库中选择可复用组件，并在 pageSpecs/keyBlocks/designRationale 中体现选择了哪个组件库、哪些组件和原因。",
        "如果 pageTemplateMatch 非空，必须优先按 matchedTemplate 和 templateContract 规划页面：继承 StyleProfile、尺寸密度、区块顺序、requiredRegions/forbiddenRegions；不要让模型自己再随意挑模板。",
        "如果 pageTemplates 非空但 pageTemplateMatch 为空，再选择最接近需求的平台/页面模式模板作为风格和结构参考，并在 designRationale 里说明参考了哪个模板。",
        "不要输出代码、不要输出 markdown、不要直接生成完整 schema。"
      ].filter(Boolean).join("\n\n"),
      userPrompt: JSON.stringify({
        userRequest: message,
        qualityContext,
        localComponentLibraries,
        pageTemplates,
        pageTemplateMatch,
        recentConversationMessages: recentConversationMessages?.slice(-24) ?? [],
        currentPageSchemaSummary: selectedPage ? summarizeDesignPageForPrompt(selectedPage) : null,
        constraints: {
          outputSchema: true,
          editable: true,
          pageContractRequired: true,
          pageSpecFields: ["name", "goal", "pageMode", "businessEntity", "layoutPattern", "requiredRegions", "forbiddenRegions", "componentFamilies", "keyBlocks", "primaryAction", "states"],
          componentLibrary: "internal-design-schema",
          supportedNodeTypes: ["frame", "container", "text", "button", "input", "table", "card", "image"]
        }
      }, null, 2),
      temperature: 0.25,
      onToken,
      signal
    });
  }

  private async createUiSchemaDraft(
    project: WorkspaceProject,
    llm: OpenAIClient,
    selectedPage: WorkspaceDesignPage | undefined,
    message: string,
    systemPrompt?: string,
    uiDesignPlan?: UiDesignerPlan,
    platformOverride?: string,
    qualityContext?: ReturnType<typeof buildDesignQualityContext>,
    onToken?: (delta: string) => void | Promise<void>,
    onProgress?: (message: string) => void | Promise<void>,
    signal?: AbortSignal
  ) {
    const targetPlatform = platformOverride === "mobile_app" || /小程序|移动端|手机|app/i.test(message) ? "mobile_app" : "web";
    await onProgress?.(`Schema Draft 阶段 1/6：识别目标平台和页面上下文。目标平台=${targetPlatform}，需求长度=${message.length} 字。`);
    const schemaPromptQualityContext = qualityContext ? compactDesignQualityContextForSchema(qualityContext) : undefined;
    const capabilityProfile = getDesignCapabilityProfile(targetPlatform === "mobile_app" ? (/小程序|微信/.test(message) ? "wechat_mini_program" : "mobile_app") : "pc_web", message);
    await onProgress?.(`Schema Draft 阶段 2/6：加载设计能力注册表。已选择 platform=${capabilityProfile.platform}，组件库能力 ${capabilityProfile.libraries.length} 组，用于约束组件族、最小质量门槛和平台布局规则。`);
    await onProgress?.("Schema Draft 阶段 3/6：读取本地组件库和页面模板摘要，用来匹配 StyleProfile 与整页结构参考。");
    const [localComponentLibraries, pageTemplates] = await Promise.all([
      this.getLocalComponentLibrarySummary(project.id),
      this.getPageTemplateSummaryForProject(project.id)
    ]);
    const pageTemplateMatch = selectPageTemplateContractForPrompt(pageTemplates, message, targetPlatform, uiDesignPlan);
    await onProgress?.([
      `Schema Draft 阶段 3/6 完成：组件库 ${localComponentLibraries.length} 个，页面模板 ${pageTemplates.length} 个。`,
      pageTemplateMatch
        ? `模板命中：${pageTemplateMatch.matchedTemplate.name}，score=${pageTemplateMatch.matchedTemplate.score}，将继承 pageMode/requiredRegions/StyleProfile。`
        : "模板未命中：将使用平台能力注册表和 UI 设计计划约束生成。"
    ].join("\n"));
    await onProgress?.("Schema Draft 阶段 4/6：组装 schema prompt。正在合并用户需求、UI 设计计划、组件库摘要、模板契约、当前画布摘要和 schemaContract。");
    const schemaSystemPrompt = [
        project.systemPrompt || "",
        systemPrompt || "",
        "你是 AIPM Schema Agent，负责把产品需求和 UI 设计方案转换成 aipm.design.schema.v1。",
        "你不是关键词模板引擎，必须基于需求语义、页面目标、用户动作和设计规范推理出可编辑 UI Schema Draft。",
        "重要架构：你输出的是 Semantic/Layout Draft，不是最终设计稿；系统会用 Layout Compiler 计算位置、尺寸、gap，并用 Component Renderer 展开按钮、卡片、列表等组件。不要依赖手写像素微调掩盖结构问题。",
        "职责边界：Layout Compiler 只负责布局和组件展开，不会凭空补业务内容；你必须在 layoutIntent 中明确输出页面所需的核心内容结构。",
        "核心约束：优先输出 artboard.layoutIntent。AI 只决定页面结构、区块层级、组件关系、文案和语义 props；不要为 layoutIntent 输出 x/y/width/height 这类最终像素坐标。",
        "生成策略：普通 create_new_ui 必须一次输出完整页面级 layoutIntent；不要拆成空画板+多个区块，除非用户明确要求分区块/增量生成。",
        "layoutIntent 可用节点：Page、Stack、Grid、Section、Toolbar、FilterBar、MetricGroup、Card、Panel、DescriptionList、Table、CardList、ListItem、EmptyState、Form、Upload、Select、RadioGroup、CheckboxGroup、Steps、Modal、Drawer、ActionBar、Button、Input、Text、Image、Repeat。Stack/Toolbar/ActionBar 可设置 direction=vertical|horizontal，gap/padding 只能用 none/xs/sm/md/lg/xl token。",
        "layoutIntent 是可组合 grammar：父节点负责 layout/slot/density/tone，子节点负责语义内容；Repeat/ForEach 用 items + children[0] 模板表达重复卡片/字段/菜单，不要手写绝对坐标。",
        "layoutIntent 可用设计 token：slot=nav|header|summary|filter|content|sidebar|detail|footer|actions，layout=singleColumn|twoColumn|masterDetail|dashboard|form|table|cards，density=compact|comfortable|spacious，tone=default|muted|primary|warning|success|danger，emphasis=low|medium|high，priority=primary|secondary|tertiary，align=start|center|end|between，wrap=true|false。",
        "Layout Compiler 会根据 platform、tokens、gap、padding、fill/hug 计算所有节点位置；你不要用绝对定位拼 UI，也不要把多个业务模块写到同一 y 区间。",
        "交互结构必须匹配需求：详情/查看/资料页禁止输出 Table、FilterBar、Pagination、列表；表单/新增/编辑页以 Form/Field/ActionBar 为主；列表/管理/查询页才使用 FilterBar、Table/CardList、Pagination。",
        "必须继承 UI 设计计划里的页面契约：如果 uiDesignPlan.pageSpecs 提供 pageMode/businessEntity/layoutPattern/requiredRegions/forbiddenRegions/componentFamilies，schemaDraft.artboards 对应画板必须原样携带这些字段，并让 layoutIntent.children 满足 requiredRegions、避开 forbiddenRegions。",
        "业务实体必须严格一致：用户要求订单详情页，就只能生成订单详情页；用户要求商品详情页，才生成商品详情页。禁止把订单/商品/客户等相近业务互相替代，画板 name、businessEntity、标题和核心字段必须一致。",
        "不要自行重新判断 pageMode；如果页面契约写 detail，就按详情页生成；如果写 collection，才生成列表/筛选/分页；如果写 flow，才要求 Steps/Timeline。",
        "如果上一轮 Layout Intent Validator 返回“契约要求 X”，下一轮必须只补齐 X 对应的 required region 到 layoutIntent，不要重写已有页面，也不要把旧内容替换成默认模板。",
        "如果上一轮 Layout Intent Validator 返回“契约禁止 X”，下一轮必须只移除 X 对应区域；不要因为删除禁用区域而新增无关业务模块。",
        "如果 UI 设计计划的 pageMode 与用户需求冲突，先修正页面契约 pageMode/requiredRegions/forbiddenRegions，再按新契约生成；不要用关键词猜测覆盖产品/UI Agent 的契约。",
        "输出只能是 JSON，必须符合 schemaVersion=aipm.design.schema.v1。",
        "artboards 是要追加到当前画布右侧的新 UI 画板；不要输出已有页面内容。",
        "web/PC 画板推荐 1440x1024 或按需求调整；mobile_app 画板使用 375x812 逻辑尺寸。",
        `本次目标平台：${targetPlatform}。如果目标平台是 mobile_app 或小程序，必须生成 375x812 左右的移动端单列页面，禁止生成 PC dashboard、PC 表格页、横向统计面板。`,
        schemaPromptQualityContext ? `本次质量上下文：${JSON.stringify(schemaPromptQualityContext)}` : "",
        `本次设计能力注册表：${getCapabilityPrompt(capabilityProfile)}`,
        "必须先选择组件库能力，再落 schema：PC 后台优先 Ant Design + Tailwind SaaS；小程序/移动端优先微信小程序组件范式 + Tailwind 卡片范式。后续新增组件库时按注册表扩展，不要写死页面模板。",
        "如果 localComponentLibraries 非空，生成 schema 时必须把它当成风格参考和组件结构参考：复用其中的颜色、圆角、字号、控件高度、边框、阴影、表格密度、按钮/输入框尺寸和文字层级。",
        "如果 pageTemplateMatch 非空，生成 schema 时必须严格继承 templateContract：尺寸、StyleProfile tokens、requiredRegions、forbiddenRegions、regionOrder 和组件密度；模板是确定性约束，不是可选灵感。",
        "如果 pageTemplates 非空但 pageTemplateMatch 为空，再参考页面模板：复用其 StyleProfile（主色、背景、surface、border、字号、圆角、间距、按钮/输入框/卡片样式）和整页 structureSummary（顶部/摘要/内容/操作区组织），但不要照抄模板业务文案、节点 ID 或旧坐标。",
        "页面模板优先级高于默认设计系统，低于用户明确指定的本地组件库；如果模板平台与本次 targetPlatform 不一致，只参考颜色/字体/圆角，不照搬布局宽度。",
        "本地组件库是用户确认过的设计资产，不是 Sketch 自动切碎的默认组件；不要忽略组件库名称、组件描述、keyTexts、aliases、size 和 styleReference。",
        "注意：生成 UI 稿时是参考本地组件库风格来生成 schema，不是创建组件库；除非用户明确要求创建组件库，否则不要调用 component_library.create。",
        "每个画板必须体现页面风格：背景层、内容面、主色、弱文本、边框、圆角、层级阴影/色块至少 3 种可识别视觉 token。",
        "每个画板必须有可识别视觉 token 和小图标/状态符号；后台列表、表格、查询、管理页不要为了凑视觉资产生成大号 demo 预览图或页面缩略图。",
        "图片资产策略：当前所有生成 UI 里的图片、插画、商品图、头像和 banner 都先使用本地占位图；不要请求外部图片，不要输出真实图片 URL，不要调用图像生成。需要图片的地方只输出语义 Image 节点，系统会替换为可编辑占位图。",
        "按钮必须使用 button 节点，textAlign=center，lineHeight 接近按钮高度，文字垂直/水平居中；不要把按钮做成 card/text。",
        "文本排版必须拆分层级：标题、副标题、说明、字段、状态分别用独立 text 节点；禁止把多字段塞进一个 text/card 的 text。",
        "所有页面必须满足 qualityRubric.minimums；低于最小节点数、文本层级、视觉资产、主操作、颜色层级会被审核拒绝。",
        "设计参考必须落实到 schema：Ant Design 后台用于 PC 管理台；微信小程序用于小程序/移动端；Tailwind/SaaS 卡片用于现代 Web；App 原生用于移动 App。",
        "制作或编辑 UI 稿时必须按页面逐个完成；如果 userRequest 明确限定单个页面，本次 artboards 只能返回 1 个画板。",
        "行业约束必须来自原始需求或明确上下文：只有明确提到电商/商品/订单/交易时才生成对应对象；只提到列表/后台/管理时不得臆测订单、商品、客户等业务。",
        "交互类型要细分：登录注册、表单录入、列表卡片、详情查看、上传认证、地图选址、支付/收益、设置管理都要用对应组件结构。",
        "仅在 layoutIntent 无法表达极少数特殊图层时才输出 nodes；nodes 是旧兼容字段，必须少用。常规 UI 必须使用 layoutIntent。",
        "如果确实输出 nodes，所有 node 坐标都必须是相对 artboard 左上角的局部坐标，不是全局画布坐标。",
        "顶层业务模块必须按从上到下的语义顺序输出：Toolbar/PageHeader/MetricGroup/FilterBar/Content/Table/Pagination/ActionBar/Footer；不同业务模块不能互相压住。",
        "同一个模块内部可以左右排列，但不同模块不要靠绝对定位叠在一起；能作为整体的区块必须用 Section/Card/Panel/Stack 包起来。",
        "node.type 只能使用 frame/container/text/button/input/table/card/image。",
        "高保真原则：不要用一个大 card/table 承载整块信息；必须拆成可编辑的 container/text/button/input/image 等颗粒节点。",
        "移动端原则：列表/记录/消息/收益明细必须用多张卡片或行容器表达，禁止使用 table 节点；按钮、文字、金额、状态必须独立节点。",
        "间距原则：移动端左右安全边距 16-24，卡片内边距 12-16，按钮高度 44-52；PC 内容区栅格和卡片间距 16-24。",
        "字体原则：移动端正文不小于 13，主标题 20-24；PC 正文不小于 13，标题层级清楚；同一行文字不能互相压住。",
        "列表原则：移动端列表必须是卡片/行容器 + 独立文本，不允许把多列内容塞进一行导致重叠；PC 才允许表格结构。",
        "文本排版：中文长文案要拆成多行 text 节点或给足高度，禁止文字互相遮挡、溢出、被截断。",
        "每个 artboard 至少包含：页面标题、核心内容区、主操作或关键状态反馈；核心内容区必须是明确业务语义组件，不能只给空 Section/Panel。",
        "如果需求是详情页，要输出能表达详情页信息架构的 schema，而不是泛化卡片。",
        "允许正常 UI 层叠：容器/卡片/背景/图片可以承载内部文字、按钮、输入框；禁止的是功能交互控件互相遮挡、文字与文字/控件互相压住、内容越界或被剪切。",
        "如果无法一次覆盖全部功能，优先输出最关键的 3-6 个页面，但每个页面必须达到可评审质量。"
      ].filter(Boolean).join("\n\n");
    const userPrompt = JSON.stringify({
        userRequest: message,
        targetPlatform,
        qualityContext: schemaPromptQualityContext,
        capabilityProfile,
        localComponentLibraries,
        pageTemplates,
        pageTemplateMatch,
        uiDesignPlan: uiDesignPlan ?? null,
        currentCanvasSummary: selectedPage ? summarizeDesignPageForSchemaPrompt(selectedPage) : null,
        schemaContract: {
          schemaVersion: "aipm.design.schema.v1",
          preferredOutput: "artboard.layoutIntent",
          artboardContractFields: ["pageMode", "businessEntity", "layoutPattern", "requiredRegions", "forbiddenRegions", "componentFamilies"],
          pageModeValues: ["collection", "detail", "form", "dashboard", "auth", "settings", "flow", "landing", "unknown"],
          layoutIntentTypes: ["Page", "Stack", "Grid", "Section", "Toolbar", "FilterBar", "MetricGroup", "Card", "Panel", "DescriptionList", "Table", "CardList", "ListItem", "EmptyState", "Form", "Upload", "Select", "RadioGroup", "CheckboxGroup", "Steps", "Modal", "Drawer", "ActionBar", "Button", "Input", "Text", "Image", "Repeat"],
          layoutTokens: {
            slot: ["nav", "header", "summary", "filter", "content", "sidebar", "detail", "footer", "actions"],
            direction: ["vertical", "horizontal"],
            gap: ["none", "xs", "sm", "md", "lg", "xl"],
            padding: ["none", "xs", "sm", "md", "lg", "xl"],
            sizing: ["fill", "hug"],
            layout: ["singleColumn", "twoColumn", "masterDetail", "dashboard", "form", "table", "cards"],
            density: ["compact", "comfortable", "spacious"],
            tone: ["default", "muted", "primary", "warning", "success", "danger"],
            emphasis: ["low", "medium", "high"],
            priority: ["primary", "secondary", "tertiary"],
            align: ["start", "center", "end", "between"]
          },
          repeatGrammar: "Repeat nodes support items:string[]|object[] and children[0] as template; template text/label/name may use {{label}}, {{value}}, {{index}} or item keys.",
          interactionRules: {
            detail: "use Header/Summary/DescriptionList/Panel/Card/Text/ActionBar; no Table/FilterBar/Pagination/list unless user explicitly asks related records",
            form: "use Form/Input/Select/Upload/RadioGroup/CheckboxGroup/ActionBar; no collection controls unless explicitly requested",
            collection: "use FilterBar only when search/filter is requested; use Table for PC or CardList/Grid for mobile"
          },
          requiredArtboardFields: ["refId", "name", "width", "height", "layoutIntent"],
          legacyNodeTypes: ["frame", "container", "text", "button", "input", "table", "card", "image"],
          legacyCoordinateSystem: "artboard-local only when nodes are unavoidable"
        }
      }, null, 2);
    try {
      await onProgress?.("Schema Draft 阶段 5/6：开始调用模型生成 layoutIntent JSON。这里耗时主要来自模型推理、流式输出和 JSON 完整性等待。");
      const result = await this.generateJsonWithRepair(llm, uiSchemaDraftSchema, {
        systemPrompt: schemaSystemPrompt,
        userPrompt,
        temperature: 0.35,
        onToken,
        onProgress,
        signal
      });
      await onProgress?.([
        `Schema Draft 阶段 6/6：模型输出已解析并通过协议校验，得到 ${result.artboards.length} 个画板。`,
        `画板：${result.artboards.map((artboard) => `${artboard.name}(${artboard.layoutIntent ? "layoutIntent" : `${artboard.nodes.length} nodes`})`).join("、")}`
      ].join("\n"));
      await this.repository.saveLlmLog(project.id, {
        stage: "ui-draft",
        step: "design-schema-draft",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt: schemaSystemPrompt,
        userPrompt,
        parsedOutput: result
      });
      return result;
    } catch (error) {
      await onProgress?.(`Schema Draft 异常：${error instanceof Error ? error.message : String(error)}。准备记录 LLM 日志并把错误交给恢复链处理。`);
      await this.repository.saveLlmLog(project.id, {
        stage: "ui-draft",
        step: "design-schema-draft-error",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt: schemaSystemPrompt,
        userPrompt,
        error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)
      });
      throw error;
    }
  }

  private async createVisualDesignReview(
    project: WorkspaceProject,
    llm: OpenAIClient,
    message: string,
    qualityContext: ReturnType<typeof buildDesignQualityContext>,
    previews: Array<{ label: string; dataUrl: string; width?: number; height?: number; nodeId?: string }>
  ) {
    const reviewArgs = {
      systemPrompt: [
        project.systemPrompt || "",
        "你是 AIPM 的视觉审核 Agent。你必须根据截图本身做判断，不要只根据 schema 文本猜。",
        "审核重点：是否有文字遮挡/挤压/截断，是否有元素越界或显示不全，是否符合目标平台和行业常见交互范式，是否像正式产品 UI，而不是 demo 拼图。",
        "基础通过线：视觉质量低于 75 必须判失败；按钮文字不居中、文本排版混乱、文字/交互控件互相遮挡、缺少图标/图片、缺少组件库风格、页面过于简陋，任一出现都应给 blocking。容器、卡片、背景、图片与内部内容的正常层叠不要判失败。",
        "如果目标是小程序/移动端：应是 375 左右单列、卡片/表单/列表行，不应出现 PC 宽表格、dashboard 横向大面板。",
        "如果目标是 PC 后台：应接近 Ant Design Pro/Tailwind SaaS，信息区、筛选区、表格/卡片和操作层级清楚。",
        "如果 qualityContext.designReferences 命中参考数据，要把截图和参考摘要对比：布局密度、区域层级、平台范式是否接近参考。",
        "发现阻塞问题时 nextAction=regenerate；小修小补时 nextAction=local_fix；没有明显问题时 nextAction=pass。",
        "输出必须是 JSON。"
      ].filter(Boolean).join("\n\n"),
      userPrompt: JSON.stringify({
        userRequest: message,
        qualityContext,
        screenshots: previews.map((preview, index) => ({
          index: index + 1,
          label: preview.label,
          nodeId: preview.nodeId,
          width: preview.width,
          height: preview.height
        })),
        reviewCriteria: [
          "截图中是否存在文字互相覆盖、挤压、换行异常或看不清。",
          "截图中是否存在元素被画板裁剪、超出边界、按钮不可点击感。",
          "平台是否匹配：小程序/移动端不能像 PC 后台，PC 后台不能像移动端卡片堆。",
          "行业是否匹配：用户账号、电商、IoT、出行等是否出现对应信息结构。",
          "是否是颗粒化 UI 稿，而不是一张表/一张大卡片/一个占位块。"
        ]
      }, null, 2),
      images: previews.slice(0, 6).map((preview) => ({ dataUrl: preview.dataUrl, label: preview.label })),
      temperature: 0.1
    };
    try {
      return await llm.generateJsonWithImagesStream(visualDesignReviewSchema, reviewArgs);
    } catch (error) {
      if (!(error instanceof StructuredOutputParseError)) throw error;
      const repaired = await llm.generateTextStream({
        systemPrompt: [
          "你是 JSON 协议修复器。",
          "只修复视觉审核 JSON 的语法和字段类型，不新增截图里没有的判断。",
          "输出必须是合法 JSON，字段必须符合 visualDesignReviewSchema，不要 Markdown。"
        ].join("\n"),
        userPrompt: JSON.stringify({
          error: error.message,
          extractedJson: error.extractedJson,
          rawText: error.rawText.slice(0, 300000),
          requiredShape: {
            passed: false,
            platformFit: { expected: "", actual: "", ok: false, reason: "" },
            visualQualityScore: 0,
            findings: [{ severity: "warning", pageLabel: "", issue: "", evidence: "", fixSuggestion: "" }],
            strengths: [],
            nextAction: "local_fix",
            summary: ""
          }
        }, null, 2),
        temperature: 0
      });
      const extractedJson = extractJsonFromModelText(repaired);
      const parsed = parseJsonWithSchema(visualDesignReviewSchema, extractedJson, repaired);
      if (parsed.ok) return parsed.value;
      throw new StructuredOutputParseError(
        `视觉审核 JSON 修复后仍不符合协议：${formatZodIssues(parsed.error.issues)}`,
        repaired,
        extractedJson
      );
    }
  }

  private async generateJsonWithRepair<S extends z.ZodTypeAny>(
    llm: OpenAIClient,
    schema: S,
    args: {
      systemPrompt: string;
      userPrompt: string;
      temperature?: number;
      onToken?: (delta: string) => void | Promise<void>;
      onProgress?: (message: string) => void | Promise<void>;
      signal?: AbortSignal;
    }
  ): Promise<z.output<S>> {
    try {
      // return await llm.generateJson(schema, args);
      return await llm.generateJsonStreamEarly(schema, args);
    } catch (error) {
      throwIfAborted(args.signal);
      if (!(error instanceof StructuredOutputParseError)) {
        throw error;
      }
      await args.onProgress?.([
        "Schema Draft JSON 首次解析失败：开始进入协议修复阶段。",
        `失败原因：${error.message}`,
        "修复策略：只修 JSON 语法和字段类型，不新增业务含义。"
      ].join("\n"));
      const repaired = await llm.generateTextStream({
        systemPrompt: [
          "你是 JSON 协议修复器。",
          "只允许修复 JSON 语法和字段格式，不允许新增业务含义，不允许解释。",
          "输出必须是合法 JSON，不要 Markdown。"
        ].join("\n"),
        userPrompt: JSON.stringify({
          error: error.message,
          extractedJson: error.extractedJson,
          rawText: error.rawText
        }, null, 2),
        temperature: 0,
        signal: args.signal
      });
      const extractedJson = extractJsonFromModelText(repaired);
      const repairedParse = parseJsonWithSchema(schema, extractedJson, repaired);
      if (repairedParse.ok) {
        await args.onProgress?.("Schema Draft JSON 修复成功：修复后的 JSON 已通过协议校验。");
        return repairedParse.value;
      }
      await args.onProgress?.(`Schema Draft JSON 修复后仍不符合协议：${formatZodIssues(repairedParse.error.issues)}。`);
      if (Object.is(schema, uiSchemaDraftSchema) && shouldRegenerateUiSchemaDraftAfterParseFailure(error, repairedParse.error, extractedJson, repaired)) {
        await args.onProgress?.("Schema Draft 进入完整重生阶段：上一段 JSON 疑似截断、缺少 artboards 或结构不完整，将要求模型重新输出完整 schemaDraft。");
        const regenerated = await llm.generateTextStream({
          systemPrompt: [
            args.systemPrompt,
            "上一次输出没有满足 schemaDraft 协议，可能是 JSON 被截断、字段不完整或缺少 artboards。本次必须重新生成完整 JSON 对象，不要尝试续写上一段坏 JSON。",
            "最外层必须包含 schemaVersion、intent、platform、designRationale、artboards。",
            "artboards 必须是非空数组，每个 artboard 必须包含 refId、name、width、height、layoutIntent、nodes。",
            "不要只输出 pageSpecs、sections、children、layoutIntent 或解释文本。",
            "layoutIntent 文本内容字段统一使用 text；不要使用 content/typography 这类未注册字段表达核心文案。",
            "输出必须一次性闭合所有对象和数组。"
          ].join("\n\n"),
          userPrompt: JSON.stringify({
            originalUserPrompt: buildCompactUiSchemaDraftRetryPrompt(args.userPrompt),
            previousError: formatZodIssues(repairedParse.error.issues),
            requiredShape: {
              schemaVersion: "aipm.design.schema.v1",
              intent: "string",
              platform: "web | mobile_app",
              designRationale: ["string"],
              artboards: [{
                refId: "string",
                name: "string",
                width: 1440,
                height: 1024,
                layoutIntent: { type: "Page", title: "string", children: [] },
                nodes: []
              }]
            }
          }, null, 2),
          temperature: 0,
          signal: args.signal
        });
        const regeneratedJson = extractJsonFromModelText(regenerated);
        const regeneratedParse = parseJsonWithSchema(schema, regeneratedJson, regenerated);
        if (regeneratedParse.ok) {
          await args.onProgress?.("Schema Draft 完整重生成功：新的 schemaDraft 已通过协议校验。");
          return regeneratedParse.value;
        }
        await args.onProgress?.(`Schema Draft 完整重生后仍不符合协议：${formatZodIssues(regeneratedParse.error.issues)}。`);
        const fallbackDraft = Object.is(schema, uiSchemaDraftSchema)
          ? buildFallbackUiSchemaDraftAfterSchemaParseFailure(args.userPrompt)
          : undefined;
        if (fallbackDraft) {
          const fallbackParse = schema.safeParse(fallbackDraft);
          if (fallbackParse.success) {
            await args.onProgress?.("Schema Draft 兜底恢复：模型连续输出不完整 JSON，已根据原始需求生成一个可落盘的最小 layoutIntent，后续审核链会继续补齐内容。");
            return fallbackParse.data;
          }
        }
        throw new StructuredOutputParseError(
          `Schema Draft 生成仍不符合协议：${formatZodIssues(regeneratedParse.error.issues)}`,
          regenerated,
          regeneratedJson
        );
      }
      throw new StructuredOutputParseError(
        `结构化输出修复后仍不符合协议：${formatZodIssues(repairedParse.error.issues)}`,
        repaired,
        extractedJson
      );
    }
  }

  private async executeDesignToolStep(projectId: string, selectedPageId: string | undefined, step: DesignAgentToolCall, conversationId?: string): Promise<DesignAgentToolResult> {
    try {
      return await this.designTools.execute({ projectId, selectedPageId, conversationId }, step);
    } catch (error) {
      if (isReviewTool(step.tool) && isRetryableJsonParseError(error)) {
        try {
          return await this.designTools.execute({ projectId, selectedPageId, conversationId }, step);
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          return {
            ok: false,
            message: `工具 ${step.tool} 重试后仍失败：${retryMessage}`
          };
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `工具 ${step.tool} 调用失败：${message}`
      };
    }
  }

  private async getLocalComponentLibrarySummary(projectId: string, fallbackFile?: WorkspaceDesignFile) {
    const [componentLibraries, storedComponents] = await Promise.all([
      this.repository.listDesignComponentLibraries(projectId).catch(() => []),
      this.repository.listDesignComponents(projectId).catch(() => [])
    ]);
    if (componentLibraries.length > 0 || storedComponents.length > 0) {
      return summarizeLocalComponentLibraries({
        ...(fallbackFile ?? createInitialWorkspaceDesignFile("Project")),
        componentLibraries,
        importedComponents: storedComponents
      });
    }
    return fallbackFile ? summarizeLocalComponentLibraries(fallbackFile) : [];
  }

  private async getPageTemplateSummaryForProject(projectId: string) {
    const file = await this.repository.getDesignFile(projectId).catch(() => undefined);
    return file ? this.getPageTemplateSummary(file) : [];
  }

  private getPageTemplateSummary(file: WorkspaceDesignFile) {
    return summarizePageTemplatesForAgent(file);
  }

  private async createDesignExecutionSnapshot(projectId: string, file: WorkspaceDesignFile) {
    const pages = await Promise.all(
      file.pages.map((page) => this.repository.getDesignPage(projectId, page.id).catch(() => page))
    );
    return { file, pages };
  }

  private async restoreDesignExecutionSnapshot(
    projectId: string,
    snapshot: { file: WorkspaceDesignFile; pages: WorkspaceDesignPage[] }
  ) {
    const file = await this.repository.saveDesignFile(projectId, {
      ...snapshot.file,
      pages: snapshot.pages,
      updatedAt: nowIso()
    });
    return { file, pages: snapshot.pages };
  }

  private async persistDesignAgentStreamEvent(projectId: string, conversationId: string, event: DesignAgentStreamEvent) {
    const role = event.type === "tool_call_result" || event.type === "tool_call_start" ? "tool" : "assistant";
    const content = getDesignAgentEventContent(event);
    await this.repository.saveAgentMessage({
      id: createAgentRunId("msg"),
      conversationId,
      projectId,
      role,
      content,
      eventType: event.type,
      toolName: "toolName" in event ? event.toolName : undefined,
      toolCallId: "toolCallId" in event ? event.toolCallId : undefined,
      metadata: stripLargeDesignEventPayload(event),
      createdAt: nowIso()
    });
  }

  private async saveDesignPages(projectId: string, file: WorkspaceDesignFile, pages: WorkspaceDesignPage[]) {
    const nextFile: WorkspaceDesignFile = {
      ...file,
      pages,
      updatedAt: nowIso()
    };
    await this.repository.saveDesignFile(projectId, nextFile);
    return this.repository.getDesignFile(projectId);
  }

  private async decideDesignAgentActionWithLlm(
    project: WorkspaceProject,
    llm: OpenAIClient,
    file: WorkspaceDesignFile,
    selectedPage: WorkspaceDesignPage | undefined,
    message: string,
    systemPrompt?: string
  ) {
    const pageSummary = selectedPage ? summarizeDesignPageForPrompt(selectedPage) : "当前没有选中页面。";
    const result = await llm.generateJson(designAgentSchema, {
      systemPrompt: [
        project.systemPrompt || "",
        systemPrompt || "",
        "你是 AI Design Agent，负责在本地设计画布里操作页面和生成 UI Schema。",
        "你必须返回 JSON，不要返回 Markdown。",
        "如果用户要求生成页面或 schema，生成 nodes。nodes 使用绝对画布坐标，尽量做成清晰可编辑的 frame、container、text、button、input、table、card。",
        "如果用户说在当前页面添加、插入、调整某个组件，action 使用 modify-schema，不要新建页面。",
        "如果用户明确说生成一个新页面、创建页面、做一个完整页面，action 使用 generate-schema。",
        "table 节点的 text 用 columns:列名1|列名2|列名3 表达列结构。",
        "不要生成复杂 svgPath。不要删除页面，除非用户明确要求删除。"
      ].filter(Boolean).join("\n\n"),
      userPrompt: JSON.stringify({
        userMessage: message,
        file: {
          name: file.name,
          pageCount: file.pages.length,
          pages: file.pages.map((page) => ({ id: page.id, name: page.name, nodeCount: page.nodeCount ?? page.nodes.length }))
        },
        selectedPage: pageSummary
      }, null, 2),
      temperature: 0.35
    });
    return result;
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
      const markdown = await llm.generateTextStream({
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

  private async createProjectLlm(project: WorkspaceProject, stage: "capture" | "structure" | "design") {
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
    const pages = sourcePages.map((pageLike, pageIndex) => {
      const zIndexRef = { current: 0 };
      const pageName = getStringProp(pageLike, "name") || `Sketch 页面 ${pageIndex + 1}`;
      const rawNodes = getSketchRenderableLayers(pageLike).flatMap((renderLayer, renderIndex) => (
        convertSketchLayer(renderLayer, {
          depth: 0,
          index: renderIndex,
          zIndexRef,
          parentX: 0,
          parentY: 0,
          scaleX: 1,
          scaleY: 1,
          inheritedOpacity: 1,
          inheritedRotation: 0,
          transform: identitySketchTransform(),
          assetByRef,
          symbolById,
          sharedStyleMaps
        })
      ));
      const normalizedNodes = normalizeDesignNodesToLocalCanvas([
        ...rawNodes,
        ...collectMissingSketchGradientNodes(pageLike, rawNodes, { assetByRef })
      ]);

      return {
        id: createDesignId("import-page"),
        name: pageName,
        nodes: normalizedNodes.length > 0 ? normalizedNodes : [
          createDesignNode("frame", {
            name: pageName || file.filename,
            text: "已读取 Sketch 页面，但没有识别到可展示图层",
            x: 420,
            y: 280,
            width: 420,
            height: 220,
            fill: "#f4f4f5",
            sourceLayerClass: getStringProp(pageLike, "_class"),
            sourceLayerId: getStringProp(pageLike, "do_objectID"),
            sourceMeta: readSketchSourceMeta(safeObject(pageLike))
          })
        ]
      } satisfies WorkspaceDesignPage;
    });

    if (pages.length === 0) {
      throw new Error("Sketch 文件已读取，但没有识别到页面");
    }

    assets.push(...extractDesignVectorAssetsFromPages(pages, file.filename));
    return { pages, components: [], assets };
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
  layer: AnyLayer,
  context: {
    depth: number;
    index: number;
    zIndexRef?: { current: number };
    parentX: number;
    parentY: number;
    scaleX: number;
    scaleY: number;
    inheritedOpacity?: number;
    inheritedRotation?: number;
    transform?: SketchTransformMatrix;
    assetByRef?: Map<string | undefined, WorkspaceDesignAsset>;
    symbolById?: Map<string, unknown>;
    sharedStyleMaps?: SketchSharedStyleMaps;
    clipBounds?: WorkspaceDesignNode["clipBounds"];
    clipPath?: WorkspaceDesignNode["clipPath"];
    activeClippingMask?: SketchClippingMaskSourceMeta;
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
  if (shouldSkipSketchLayer(layerObject)) {
    return [];
  }
  const nodeType = mapSketchLayerType(layerClass, getStringProp(layerObject, "name"));
  const shouldUseParentShapeBounds = context.parentShapeGroupBounds && isSketchPathLayer(layerObject);
  const localNodeX = shouldUseParentShapeBounds ? context.parentShapeGroupBounds!.x : context.parentX + frame.x * context.scaleX;
  const localNodeY = shouldUseParentShapeBounds ? context.parentShapeGroupBounds!.y : context.parentY + frame.y * context.scaleY;
  const nodeWidth = shouldUseParentShapeBounds ? context.parentShapeGroupBounds!.width : Math.max(1, Math.round(frame.width * context.scaleX));
  const nodeHeight = shouldUseParentShapeBounds ? context.parentShapeGroupBounds!.height : Math.max(1, Math.round(frame.height * context.scaleY));
  const parentTransform = context.transform ?? identitySketchTransform();
  const transformedCenter = applySketchTransform(parentTransform, localNodeX + nodeWidth / 2, localNodeY + nodeHeight / 2);
  const nodeX = Math.round(transformedCenter.x - nodeWidth / 2);
  const nodeY = Math.round(transformedCenter.y - nodeHeight / 2);
  const layerOpacity = readSketchOpacity(layerObject);
  const inheritedOpacity = context.inheritedOpacity ?? 1;
  const effectiveOpacity = clampSketchAlpha(inheritedOpacity * layerOpacity);
  const layerRotation = readSketchRotation(layerObject);
  const inheritedRotation = context.inheritedRotation ?? 0;
  const effectiveRotation = normalizeSketchRotation(inheritedRotation + layerRotation);
  const hasChildClippingMask = isSketchVectorContainerLayer(layerObject) && hasSketchClippingMaskDescendant(layerObject);
  const shouldRenderLayerAsPaintedBox = shouldRenderSketchLayerAsPaintedBox(layerObject);
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
    fills: nodeType === "text" ? undefined : readSketchPaintLayers(layerObject, "fills", context.assetByRef),
    stroke: readSketchStroke(layerObject),
    borders: nodeType === "text" ? undefined : readSketchPaintLayers(layerObject, "borders", context.assetByRef),
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
    textVerticalAlign: readSketchTextVerticalAlign(layerObject),
    fontFamily: readSketchFontFamily(layerObject),
    fontWeight: readSketchFontWeight(layerObject),
    letterSpacing: readSketchLetterSpacing(layerObject),
    underline: readSketchTextUnderline(layerObject),
    strikethrough: readSketchTextStrikethrough(layerObject),
    visible: layerObject.isVisible !== false,
    locked: layerObject.isLocked === true,
    sourceLayerId: getStringProp(layerObject, "do_objectID"),
    sourceLayerClass: layerClass,
    sourceMeta: {
      ...readSketchSourceMeta(layerObject, context.assetByRef, context.activeClippingMask),
      layerOpacity,
      inheritedOpacity,
      effectiveOpacity,
      localRotation: layerRotation,
      inheritedRotation,
      effectiveRotation
    },
    opacity: effectiveOpacity,
    rotation: effectiveRotation,
    blendMode: readSketchBlendMode(layerObject),
    blurRadius: readSketchBlurRadius(layerObject),
    flippedHorizontal: layerObject.isFlippedHorizontal === true,
    flippedVertical: layerObject.isFlippedVertical === true,
    shadow: readSketchShadow(layerObject),
    innerShadow: readSketchInnerShadow(layerObject),
    clipBounds: context.clipBounds,
    clipPath: context.clipPath,
    ...(hasChildClippingMask || shouldRenderLayerAsPaintedBox ? {} : readSketchVectorMeta(layerObject, nodeWidth, nodeHeight, {
      scaleX: context.scaleX,
      scaleY: context.scaleY
    })),
    ...readSketchFillImageMeta(layerObject, context.assetByRef),
    ...readSketchImageMeta(layerObject, context.assetByRef)
  });
  node.zIndex = nextSketchRenderZIndex(context);
  const renderNode = suppressSketchContainerPaint(layerObject, node);
  const shouldRenderShapeGroupAsVector = isSketchVectorContainerLayer(layerObject) && !hasChildClippingMask && Boolean(renderNode.svgPath);

  const symbolChildren = layerClass === "symbolInstance"
    ? convertSketchSymbolInstance(layerObject, {
        ...context,
        nodeX: localNodeX,
        nodeY: localNodeY,
        nodeWidth,
        nodeHeight,
        parentNodeId: nodeId,
        inheritedOpacity: effectiveOpacity,
        inheritedRotation: effectiveRotation,
        transform: multiplySketchTransforms(parentTransform, sketchRotationTransform(localNodeX + nodeWidth / 2, localNodeY + nodeHeight / 2, layerRotation))
      })
    : [];
  const children = shouldRenderShapeGroupAsVector || shouldRenderLayerAsPaintedBox ? [] : convertSketchChildLayers(layerObject, {
    ...context,
    parentX: localNodeX,
    parentY: localNodeY,
    depth: context.depth + 1,
    parentNodeId: nodeId,
    inheritedOpacity: effectiveOpacity,
    inheritedRotation: effectiveRotation,
    transform: multiplySketchTransforms(parentTransform, sketchRotationTransform(localNodeX + nodeWidth / 2, localNodeY + nodeHeight / 2, layerRotation)),
    inheritedShapeStyle: getSketchChildInheritedShapeStyle(layerObject, context.inheritedShapeStyle)
  });
  return [renderNode, ...symbolChildren, ...children];
}

function nextSketchRenderZIndex(context: { depth: number; index: number; zIndexRef?: { current: number } }) {
  const zIndex = context.zIndexRef?.current ?? context.index;
  if (context.zIndexRef) {
    context.zIndexRef.current = zIndex + 1;
  }
  return zIndex;
}

type SketchTransformMatrix = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

function identitySketchTransform(): SketchTransformMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function multiplySketchTransforms(first: SketchTransformMatrix, second: SketchTransformMatrix): SketchTransformMatrix {
  return {
    a: first.a * second.a + first.c * second.b,
    b: first.b * second.a + first.d * second.b,
    c: first.a * second.c + first.c * second.d,
    d: first.b * second.c + first.d * second.d,
    e: first.a * second.e + first.c * second.f + first.e,
    f: first.b * second.e + first.d * second.f + first.f
  };
}

function sketchRotationTransform(centerX: number, centerY: number, rotation: number): SketchTransformMatrix {
  if (!rotation) {
    return identitySketchTransform();
  }
  const radians = rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: centerX - cos * centerX + sin * centerY,
    f: centerY - sin * centerX - cos * centerY
  };
}

function applySketchTransform(transform: SketchTransformMatrix, x: number, y: number) {
  return {
    x: transform.a * x + transform.c * y + transform.e,
    y: transform.b * x + transform.d * y + transform.f
  };
}

function clampSketchAlpha(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function normalizeSketchRotation(rotation: number) {
  if (!Number.isFinite(rotation) || Math.abs(rotation) < 0.0001) {
    return 0;
  }
  const normalized = ((rotation % 360) + 360) % 360;
  return Number((normalized > 180 ? normalized - 360 : normalized).toFixed(4));
}

function shouldSkipSketchLayer(layer: Record<string, unknown>) {
  const layerClass = getStringProp(layer, "_class").toLowerCase();
  const layerName = getStringProp(layer, "name").toLowerCase();
  const ignoredTokens = ["guide", "prototype", "flow", "selection"];
  return ignoredTokens.some((token) => layerClass.includes(token) || layerName.includes(token));
}

function shouldRenderSketchLayerAsPaintedBox(layer: Record<string, unknown>) {
  if (!hasSketchGradientFill(layer)) {
    return false;
  }
  const layerClass = getStringProp(layer, "_class");
  if (layerClass === "rectangle") {
    return true;
  }
  if (layerClass !== "shapeGroup") {
    return false;
  }
  const children = getSketchLayers(layer).map(safeObject).filter((child) => child.isVisible !== false && !shouldSkipSketchLayer(child));
  return children.length === 1 && getStringProp(children[0], "_class") === "rectangle";
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
    inheritedOpacity?: number;
    inheritedRotation?: number;
    transform?: SketchTransformMatrix;
    assetByRef?: Map<string | undefined, WorkspaceDesignAsset>;
    symbolById?: Map<string, unknown>;
    sharedStyleMaps?: SketchSharedStyleMaps;
    clipBounds?: WorkspaceDesignNode["clipBounds"];
    clipPath?: WorkspaceDesignNode["clipPath"];
    activeClippingMask?: SketchClippingMaskSourceMeta;
    parentNodeId?: string;
    inheritedShapeStyle?: Record<string, unknown>;
    parentShapeGroupBounds?: { x: number; y: number; width: number; height: number };
  }
) {
  let activeClipBounds = context.clipBounds;
  let activeClipPath = context.clipPath;
  let activeClippingMask = context.activeClippingMask;
  const parentFrame = readSketchFrame(parentLayer);
  const parentShapeGroupBounds = getStringProp(parentLayer, "_class") === "shapeGroup"
    ? {
        x: context.parentX,
        y: context.parentY,
        width: Math.max(1, Math.round(parentFrame.width * context.scaleX)),
        height: Math.max(1, Math.round(parentFrame.height * context.scaleY))
      }
    : context.parentShapeGroupBounds;
  return getSketchRenderableLayers(parentLayer).flatMap((child, index) => {
    const childObject = safeObject(child);
    if (shouldSkipSketchLayer(childObject)) {
      return [];
    }
    if (childObject.shouldBreakMaskChain === true) {
      activeClipBounds = context.clipBounds;
      activeClipPath = context.clipPath;
      activeClippingMask = context.activeClippingMask;
    }

    if (childObject.hasClippingMask === true) {
      const clip = readSketchLayerClip(childObject, context);
      const maskNodes = shouldRenderSketchClippingMaskLayer(childObject)
        ? convertSketchLayer(child, {
            depth: context.depth,
            index,
            zIndexRef: context.zIndexRef,
            parentX: context.parentX,
            parentY: context.parentY,
            scaleX: context.scaleX,
            scaleY: context.scaleY,
            inheritedOpacity: context.inheritedOpacity,
            inheritedRotation: context.inheritedRotation,
            transform: context.transform,
            assetByRef: context.assetByRef,
            symbolById: context.symbolById,
            sharedStyleMaps: context.sharedStyleMaps,
            clipBounds: context.clipBounds,
            clipPath: context.clipPath,
            activeClippingMask: context.activeClippingMask,
            parentNodeId: context.parentNodeId,
            inheritedShapeStyle: context.inheritedShapeStyle,
            parentShapeGroupBounds
          })
        : [];
      // Sketch mask chains are sibling-order render scopes: a new mask replaces the
      // current sibling chain, while any inherited parent clip still constrains it.
      activeClipBounds = intersectDesignRects(context.clipBounds, clip.bounds);
      activeClipPath = clip.path ?? context.clipPath;
      activeClippingMask = readSketchClippingMaskSourceMeta(childObject);
      return maskNodes;
    }

    return convertSketchLayer(child, {
      depth: context.depth,
      index,
      zIndexRef: context.zIndexRef,
      parentX: context.parentX,
      parentY: context.parentY,
      scaleX: context.scaleX,
      scaleY: context.scaleY,
      inheritedOpacity: context.inheritedOpacity,
      inheritedRotation: context.inheritedRotation,
      transform: context.transform,
      assetByRef: context.assetByRef,
      symbolById: context.symbolById,
      sharedStyleMaps: context.sharedStyleMaps,
      clipBounds: activeClipBounds,
      clipPath: activeClipPath,
      activeClippingMask,
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
  const vector = readSketchVectorMeta(layer, width, height, {
    scaleX: context.scaleX,
    scaleY: context.scaleY
  });
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
    fill: type === "button" ? "#246bfe" : type === "text" ? "transparent" : "transparent",
    stroke: type === "text" ? "transparent" : "#d8d8dd",
    radius: type === "button" || type === "input" ? 14 : 8,
    text: type === "text" ? "Text" : type === "button" ? "Button" : "",
    textColor: type === "button" ? "#ffffff" : "#171717",
    fontSize: type === "text" ? 22 : 14,
    textVerticalAlign: type === "text" ? "top" : "middle",
    visible: true,
    locked: false
  };
  return { ...base, ...overrides };
}

function createGeneratedDesignNode(input: DesignAgentDecision["nodes"][number]): WorkspaceDesignNode {
  const node = createDesignNode(input.type);
  return {
    ...node,
    name: input.name?.trim() || node.name,
    x: Number.isFinite(input.x) ? input.x : node.x,
    y: Number.isFinite(input.y) ? input.y : node.y,
    width: Math.max(1, Number.isFinite(input.width) ? input.width : node.width),
    height: Math.max(1, Number.isFinite(input.height) ? input.height : node.height),
    fill: input.fill?.trim() || node.fill,
    stroke: input.stroke?.trim() || node.stroke,
    radius: Number.isFinite(input.radius) ? input.radius ?? node.radius : node.radius,
    text: input.text ?? node.text,
    textColor: input.textColor?.trim() || node.textColor,
    fontSize: Math.max(8, Number.isFinite(input.fontSize) ? input.fontSize ?? node.fontSize : node.fontSize)
  };
}

function createDesignAgentPage(name: string, nodes: WorkspaceDesignNode[]): WorkspaceDesignPage {
  return {
    id: createDesignId("page"),
    name: name.trim() || "AI 生成页面",
    nodes,
    nodeCount: nodes.length,
    schemaLoaded: true
  };
}

function duplicateDesignAgentPage(page: WorkspaceDesignPage): WorkspaceDesignPage {
  const idMap = new Map(page.nodes.map((node) => [node.id, createDesignId("node")]));
  const nodes = page.nodes.map((node) => ({
    ...node,
    id: idMap.get(node.id) ?? createDesignId("node"),
    parentId: node.parentId ? idMap.get(node.parentId) : undefined,
    x: node.x + 48,
    y: node.y + 48
  }));
  return createDesignAgentPage(`${page.name} Copy`, nodes);
}

function applyDesignAgentPageModification(
  page: WorkspaceDesignPage,
  decision: DesignAgentDecision,
  message: string
): WorkspaceDesignPage {
  const generatedNodes = decision.nodes.length > 0
    ? decision.nodes.map(createGeneratedDesignNode)
    : createFallbackDesignSchemaNodes(message).filter((node) => shouldKeepFallbackNodeForModification(node, message));
  const explicitAddNode = /添加|新增|加一个|加入|放一个|插入|add|insert/i.test(message)
    && !/(列|字段|column|columns|表头)/i.test(message);
  const targetType = inferDesignNodeTypeFromMessage(message) ?? generatedNodes[0]?.type;

  if (!explicitAddNode && targetType) {
    const target = [...page.nodes].reverse().find((node) => node.type === targetType);
    const patch = generatedNodes.find((node) => node.type === targetType) ?? generatedNodes[0];
    if (target && patch) {
      const nextText = target.type === "table"
        ? mergeTableSchemaText(target.text, patch.text || serializeTableColumns(inferTableColumns(message)))
        : patch.text ?? target.text;
      return {
        ...page,
        nodes: page.nodes.map((node) => node.id === target.id ? {
          ...node,
          name: patch.name || node.name,
          width: patch.width || node.width,
          height: patch.height || node.height,
          fill: patch.fill || node.fill,
          stroke: patch.stroke || node.stroke,
          radius: patch.radius ?? node.radius,
          text: nextText,
          textColor: patch.textColor || node.textColor,
          fontSize: patch.fontSize || node.fontSize
        } : node),
        nodeCount: page.nodes.length,
        schemaLoaded: true
      };
    }
  }

  const positionedNodes = positionGeneratedNodesForPage(page, generatedNodes, message);
  return {
    ...page,
    nodes: [...page.nodes, ...positionedNodes],
    nodeCount: page.nodes.length + positionedNodes.length,
    schemaLoaded: true
  };
}

function shouldKeepFallbackNodeForModification(node: WorkspaceDesignNode, message: string) {
  const targetType = inferDesignNodeTypeFromMessage(message);
  if (targetType) {
    return node.type === targetType;
  }
  return !["frame", "text", "button"].includes(node.type);
}

function positionGeneratedNodesForPage(page: WorkspaceDesignPage, nodes: WorkspaceDesignNode[], message: string) {
  if (nodes.length === 0) {
    return nodes;
  }
  const bounds = getDesignPageContentBounds(page);
  const startX = bounds.x + 48;
  const startY = bounds.y + bounds.height + 40;
  const shouldAutoPlace = page.nodes.length > 0 && !/(坐标|位置|x\s*[:=]|y\s*[:=])/i.test(message);
  return nodes.map((node, index) => {
    const tableText = node.type === "table" && !node.text
      ? serializeTableColumns(inferTableColumns(message))
      : node.text;
    return {
      ...node,
      x: shouldAutoPlace ? startX + index * 24 : Number.isFinite(node.x) && node.x > 0 ? node.x : startX + index * 24,
      y: shouldAutoPlace ? startY + index * 24 : Number.isFinite(node.y) && node.y > 0 ? node.y : startY + index * 24,
      text: tableText
    };
  });
}

function getDesignPageContentBounds(page: WorkspaceDesignPage) {
  if (page.nodes.length === 0) {
    return { x: 520, y: 220, width: 960, height: 0 };
  }
  const minX = Math.min(...page.nodes.map((node) => node.x));
  const minY = Math.min(...page.nodes.map((node) => node.y));
  const maxX = Math.max(...page.nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...page.nodes.map((node) => node.y + node.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function inferDesignNodeTypeFromMessage(message: string): WorkspaceDesignNodeType | undefined {
  const text = message.toLowerCase();
  if (/table|表格|列表/.test(text)) return "table";
  if (/button|按钮/.test(text)) return "button";
  if (/input|输入框|搜索框|筛选框|表单/.test(text)) return "input";
  if (/text|文字|标题|文案/.test(text)) return "text";
  if (/card|卡片/.test(text)) return "card";
  if (/container|容器|区块/.test(text)) return "container";
  if (/frame|画板|框架/.test(text)) return "frame";
  return undefined;
}

function inferDesignAgentAction(message: string): DesignAgentDecision["action"] {
  const text = message.toLowerCase();
  if (/删除.*页面|delete.*page|remove.*page/.test(text)) {
    return "delete-page";
  }
  if (/复制|duplicate|copy/.test(text)) {
    return "duplicate-page";
  }
  if (/新建.*页面|新增.*页面|创建.*页面|create.*page|new.*page/.test(text)) {
    return "create-page";
  }
  if (/(添加|加一个|加入|放一个|插入|修改|调整|更新|改一下|add|insert|update).*(table|表格|列表|button|按钮|input|输入|card|卡片|text|文字|容器|container)|(?:table|表格|列表|button|按钮|input|输入|card|卡片|text|文字|容器|container).*(添加|加一个|加入|放一个|插入|修改|调整|更新|改一下|add|insert|update)/i.test(text)) {
    return "modify-schema";
  }
  if (/生成|设计|画一个|做一个|ui|界面|表单|后台|dashboard/.test(text)) {
    return "generate-schema";
  }
  if (/schema|结构|节点|图层信息|当前页|页面信息/.test(text)) {
    return "get-schema";
  }
  if (/页面列表|有哪些页面|查询页面|list.*page|pages/.test(text)) {
    return "list-pages";
  }
  return "answer";
}

function buildFallbackDesignAgentDecision(message: string, action = inferDesignAgentAction(message)): DesignAgentDecision {
  return {
    action,
    reply: action === "modify-schema"
      ? "我会根据你的描述修改当前页面 Schema。"
      : action === "generate-schema"
      ? "我会根据你的描述生成一个可编辑页面 Schema。"
      : "我可以查询页面、读取当前页 Schema、新建/删除/复制页面，也可以根据描述生成页面 Schema。",
    pageName: inferPageNameFromMessage(message),
    nodes: action === "generate-schema" || action === "modify-schema" ? createFallbackDesignSchemaNodes(message) : []
  };
}

function inferPageNameFromMessage(message: string) {
  const compact = message
    .replace(/请|帮我|生成|创建|新建|设计|一个|页面|界面|schema/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compact ? `${compact.slice(0, 18)}页面` : undefined;
}

function createFallbackDesignSchemaNodes(message: string): WorkspaceDesignNode[] {
  const title = inferPageNameFromMessage(message)?.replace(/页面$/, "") || "AI 生成";
  const wantsTable = /表格|列表|table|list/.test(message.toLowerCase());
  const wantsForm = /表单|输入|搜索|筛选|form|input/.test(message.toLowerCase());
  const nodes: WorkspaceDesignNode[] = [
    createDesignNode("frame", { name: `${title} Frame`, x: 520, y: 220, width: 960, height: 640, fill: "#f6f7fb", stroke: "#e5e7eb", radius: 24 }),
    createDesignNode("text", { name: "页面标题", x: 572, y: 268, width: 360, height: 44, text: title, fontSize: 28, fontWeight: 700 }),
    createDesignNode("text", { name: "页面说明", x: 572, y: 318, width: 520, height: 28, text: "由 AI Design Agent 生成，可继续编辑图层、样式和文字。", fontSize: 14, textColor: "#667085" }),
    createDesignNode("button", { name: "主操作", x: 1260, y: 270, width: 150, height: 44, text: "主要操作", radius: 12 })
  ];
  if (wantsForm) {
    nodes.push(
      createDesignNode("input", { name: "搜索输入", x: 572, y: 380, width: 320, height: 48, text: "请输入关键词", fill: "#ffffff", stroke: "#d0d5dd" }),
      createDesignNode("button", { name: "查询按钮", x: 912, y: 380, width: 108, height: 48, text: "查询", radius: 12 })
    );
  }
  nodes.push(
    wantsTable
      ? createDesignNode("table", { name: "数据表格", x: 572, y: 460, width: 840, height: 300, fill: "#ffffff", stroke: "#eaecf0", radius: 18, text: serializeTableColumns(inferTableColumns(message)) })
      : createDesignNode("card", { name: "内容卡片", x: 572, y: 400, width: 840, height: 300, fill: "#ffffff", stroke: "#eaecf0", radius: 20, text: "" })
  );
  return nodes;
}

function inferTableColumns(message: string) {
  const match = /(?:字段|列|columns?|包含|包括)[:：]?\s*([^\n。；;]+)/i.exec(message);
  const rawColumns = match?.[1]
    ?.split(/[、,，|/／\s]+/)
    .map((item) => item.trim())
    .filter((item) => item && !/字段|列|columns?|包含|包括|table|表格/.test(item));
  const columns = rawColumns && rawColumns.length >= 2
    ? rawColumns.slice(0, 8)
    : [];
  return Array.from(new Set(columns));
}

function serializeTableColumns(columns: string[]) {
  return `columns:${columns.join("|")}`;
}

function parseTableSchemaText(text?: string) {
  const match = /^columns:(.*)$/i.exec(text?.trim() ?? "");
  if (!match) {
    return [] as string[];
  }
  return match[1].split("|").map((item) => item.trim()).filter(Boolean);
}

function mergeTableSchemaText(current?: string, next?: string) {
  const columns = [
    ...parseTableSchemaText(current),
    ...parseTableSchemaText(next)
  ];
  return serializeTableColumns(Array.from(new Set(columns)));
}

function buildFallbackDesignToolPlan(message: string): DesignAgentPlan {
  const text = message.toLowerCase();
  const steps: DesignAgentToolCall[] = [];
  const wantsPlanOnly = /规划模式|只规划|先规划|不要执行|plan only/i.test(message);

  if (/联网|搜索|素材|竞品|参考|web|search|sketch 素材/i.test(message)) {
    steps.push({ tool: "web.search", reason: "用户需要联网搜索参考信息。", input: { query: message } });
    return makeDesignToolPlan(message, wantsPlanOnly, "我会先搜索参考信息。", steps);
  }

  if (/图片转|截图转|根据图片|image.*schema/i.test(message)) {
    steps.push({ tool: "image.to_schema", reason: "用户需要图片转 schema。", input: { imagePath: extractPathLikeText(message) ?? "" } });
    return makeDesignToolPlan(message, wantsPlanOnly, "我会尝试把图片识别成 schema。", steps);
  }

  if (/读取文件|打开文件|参考文件|workspace.*file/i.test(message)) {
    steps.push({ tool: "workspace.read_file", reason: "用户需要读取 workspace 内文件。", input: { path: extractPathLikeText(message) ?? "" } });
    return makeDesignToolPlan(message, wantsPlanOnly, "我会读取 workspace 内指定文件。", steps);
  }

  if (isComponentLibraryCreateIntent(message)) {
    steps.push({ tool: "component_library.create", reason: "创建一个本地组件库，保存到 SQLite，供 Agent 和画布组件面板共同使用。", input: { name: inferComponentLibraryNameFromMessage(message) ?? "Agent 组件库", description: inferComponentLibraryDescriptionFromMessage(message) ?? "Agent 可调用的本地组件库。" } });
  } else if (isLocalComponentCreationIntent(message)) {
    steps.push({ tool: "page.get_schema", reason: "读取当前页面 schema，选择要沉淀为组件的节点。", input: {} });
    steps.push({ tool: "component_library.create", reason: "如果没有合适组件库，先创建本地组件库。", input: { name: inferComponentLibraryNameFromMessage(message) ?? "Agent 组件库", description: "Agent 沉淀的本地 UI 组件资产。" } });
    steps.push({ tool: "component.create_from_nodes", reason: "把匹配到的页面节点保存为本地组件，供后续 UI 生成复用。", input: { componentName: inferComponentNameFromMessage(message) ?? "本地组件", match: inferComponentNodeMatchFromMessage(message), includeDescendants: true } });
  } else if (isLocalComponentQueryIntent(message)) {
    steps.push({ tool: "component_library.list", reason: "查询本地组件库和组件摘要。", input: {} });
  } else if (/页面列表|有哪些页面|查询页面|list.*page|pages/.test(text)) {
    steps.push({ tool: "page.list", reason: "查询页面列表。", input: {} });
  } else if (/schema|结构|节点|图层信息|当前页|页面信息/.test(text) && !/(添加|新增|加一个|加入|放一个|插入|修改|调整|更新|改一下|add|insert|update)/i.test(message)) {
    steps.push({ tool: "page.get_schema", reason: "获取当前页面 schema。", input: {} });
  } else if (/删除.*页面|delete.*page|remove.*page/.test(text)) {
    steps.push({ tool: "page.delete", reason: "删除当前页面。", input: {} });
  } else if (/复制.*页面|duplicate.*page|copy.*page/.test(text)) {
    steps.push({ tool: "page.duplicate", reason: "复制当前页面。", input: {} });
  } else if (/重命名.*页面|rename.*page/.test(text)) {
    steps.push({ tool: "page.rename", reason: "重命名当前页面。", input: { name: inferPageNameFromMessage(message) ?? "未命名页面" } });
  } else if (/新建.*页面|新增.*页面|创建.*页面|create.*page|new.*page/.test(text)) {
    steps.push({ tool: "page.create", reason: "用户明确要求新建页面。", input: { name: inferPageNameFromMessage(message) ?? "AI 新页面" } });
  } else if (isLocalComponentAssetIntent(message)) {
    steps.push({ tool: "page.get_schema", reason: "先读取当前页面 schema，确认组件插入上下文。", input: {} });
    steps.push({ tool: "component.search", reason: "按用户描述搜索本地组件库组件。", input: { query: message } });
    steps.push({ tool: "component.insert", reason: "把匹配的本地组件插入当前页面。", input: { query: message } });
    steps.push({ tool: "schema.validate", reason: "插入组件后校验页面。", input: {} });
  } else if (/(添加|新增|加一个|加入|放一个|插入|add|insert)/i.test(message)) {
    steps.push({ tool: "schema.generate_from_prompt", reason: "根据提示生成局部 schema 并添加到当前页面。", input: { prompt: message } });
    steps.push({ tool: "schema.validate", reason: "新增 schema 后校验页面。", input: {} });
  } else if (/(修改|调整|更新|改一下|update|change).*(table|表格|列表)|(?:table|表格|列表).*(列|字段|修改|调整|更新|改一下)/i.test(message)) {
    steps.push({
      tool: "schema.update_node",
      reason: "修改当前页面已有 table 节点。",
      input: { match: { type: "table" }, patch: { text: serializeTableColumns(inferTableColumns(message)) } }
    });
    steps.push({ tool: "schema.validate", reason: "修改 schema 后校验页面。", input: {} });
  } else if (/生成|设计|画一个|做一个|ui|界面|表单|后台|dashboard/.test(text)) {
    steps.push({ tool: "page.create", reason: "用户需要生成完整新页面。", input: { name: inferPageNameFromMessage(message) ?? "AI 生成页面" } });
    steps.push({ tool: "schema.generate_from_prompt", reason: "根据提示生成页面 schema。", input: { prompt: message } });
    steps.push({ tool: "schema.validate", reason: "生成 schema 后校验页面。", input: {} });
  }

  if (steps.length === 0) {
    return {
      title: "回答用户问题",
      userGoal: "查询或咨询 AI Design 能力",
      assumptions: [],
      mode: "answer",
      reply: "我可以读取页面 schema、操作页面、增删改复制节点、校验 schema，也可以规划后再执行。",
      steps: []
    };
  }

  return {
    ...makeDesignToolPlan(message, wantsPlanOnly, wantsPlanOnly ? "我先给出计划，不执行工具。" : "我会按计划调用工具完成这次页面/schema 操作。", steps)
  };
}

function makeDesignToolPlan(message: string, wantsPlanOnly: boolean, reply: string, steps: DesignAgentToolCall[]): DesignAgentPlan {
  return {
    title: wantsPlanOnly ? "AI Design Agent 规划" : "AI Design Agent 执行计划",
    userGoal: message,
    assumptions: ["优先操作当前选中页面", "修改 schema 前先读取页面信息"],
    mode: wantsPlanOnly ? "plan" : "execute",
    reply,
    steps
  };
}

function getDesignAgentRoleForTool(tool: DesignAgentToolCall["tool"]): DesignAgentRoleName {
  if (tool === "requirement.parse" || tool === "product.review_requirements") {
    return "产品经理 Agent";
  }
  if (tool === "flow.generate") {
    return "产品规划 Agent";
  }
  if (tool === "asset.resolve") {
    return "素材 Agent";
  }
  if (tool === "component_library.list" || tool === "component_library.create" || tool === "component.search" || tool === "component.insert" || tool === "component.create_from_nodes") {
    return "组件库 Agent";
  }
  if (tool === "page.analyze_structure" || tool === "page.get_schema" || tool === "page.list") {
    return "页面理解 Agent";
  }
  if (tool === "workspace.read_file") {
    return "文件 Agent";
  }
  if (tool === "web.search") {
    return "联网 Agent";
  }
  if (tool === "image.to_schema" || tool === "canvas.capture" || tool.startsWith("ui.analyze_")) {
    return "视觉识别 Agent";
  }
  if (tool.startsWith("conversation.")) {
    return "记忆 Agent";
  }
  if (tool === "ui.review" || tool === "ui.review_design" || tool === "ui.critic_review" || tool === "schema.validate") {
    return "审核 Agent";
  }
  if (
    tool === "schema.generate_ui_from_requirements" ||
    tool.startsWith("schema.") ||
    tool.startsWith("layout.") ||
    tool.startsWith("page.")
  ) {
    return "Schema 执行 Agent";
  }
  return "负责人 Agent";
}

function getGeneratedFrameIds(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const value = (data as Record<string, unknown>).generatedFrameIds;
  if (!Array.isArray(value)) return [];
  const ids = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return ids;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isUsableUiSchemaDraftInput(value: unknown) {
  return uiSchemaDraftSchema.safeParse(value).success;
}

function validateDesignAgentPlanForIntent(message: string, plan: DesignAgentPlan) {
  const taskType = routeDesignAgentTask(message);
  if (taskType === "create_new_ui") {
    const forbiddenTools = new Set(["page.get_schema", "page.analyze_structure", "schema.update_node", "schema.delete_node", "layout.insert_above", "layout.reflow"]);
    const usedForbidden = plan.steps.find((step) => forbiddenTools.has(step.tool));
    const requiredTools = ["requirement.parse", "flow.generate", "schema.generate_ui_from_requirements"];
    const missingTool = requiredTools.find((tool) => !plan.steps.some((step) => step.tool === tool));
    if (usedForbidden || missingTool) {
      throw new Error([
        "计划安全校验失败：当前任务是从需求生成新 UI，不是修改当前页面。",
        usedForbidden ? `不允许使用页面编辑工具：${usedForbidden.tool}` : "",
        missingTool ? `缺少必要工具：${missingTool}` : "",
        "建议：按 requirement.parse -> flow.generate -> page_template.list -> component_library.list/component.search -> asset.resolve -> schema.generate_ui_from_requirements -> ui.critic_review 重新规划。"
      ].filter(Boolean).join("\n"));
    }
    return;
  }

  const isAddMenu = /(添加|新增|加一个|加入|放一个|插入|add|insert).*(菜单|导航|menu|sidebar|侧边栏)|(?:菜单|导航|menu|sidebar|侧边栏).*(添加|新增|加一个|加入|放一个|插入|add|insert)/i.test(message);
  const isAddSearchCondition = isListSearchConditionIntent(message);
  const isLocalComponentIntent = isLocalComponentAssetIntent(message);
  if (isAddMenu) {
    const hasCreateMenu = plan.steps.some((step) => step.tool === "schema.create_menu");
    const hasUnsafeUpdate = plan.steps.some((step) => step.tool === "schema.update_node");
    if (!hasCreateMenu || hasUnsafeUpdate) {
      throw new Error([
        "计划安全校验失败：用户意图是添加菜单组件，但模型没有使用 schema.create_menu，或错误使用了 schema.update_node。",
        "已停止执行，避免把“添加”误执行成“修改已有节点”。",
        "建议：让 Agent 重新规划，要求先 page.get_schema，再 schema.create_menu，最后 schema.validate。"
      ].join("\n"));
    }
  }
  if (isAddSearchCondition) {
    const hasAnalyze = plan.steps.some((step) => step.tool === "page.analyze_structure");
    const hasProductReview = plan.steps.some((step) => step.tool === "product.review_requirements");
    const hasInsertFallback = plan.steps.some((step) => step.tool === "layout.insert_above" || step.tool === "schema.add_child" || step.tool === "schema.insert_before");
    const hasUnsafeTableUpdate = plan.steps.some((step) => step.tool === "schema.update_node" && /table|表格/i.test(JSON.stringify(step.input)));
    if (!hasAnalyze || !hasProductReview || !hasInsertFallback || hasUnsafeTableUpdate) {
      throw new Error([
        "计划安全校验失败：用户意图是给列表页添加搜索/筛选条件。",
        "必须先 page.analyze_structure，再 product.review_requirements，并使用 layout.insert_above / schema.add_child / schema.insert_before 完成插入。",
        "不允许把搜索条件直接 update 到表格节点内部。"
      ].join("\n"));
    }
  }
  if (isLocalComponentIntent) {
    const hasComponentLookup = plan.steps.some((step) => step.tool === "component_library.list" || step.tool === "component.search");
    const hasComponentInsert = plan.steps.some((step) => step.tool === "component.insert");
    const hasUnsafePromptGenerate = plan.steps.some((step) => step.tool === "schema.generate_from_prompt");
    if (!hasComponentLookup || !hasComponentInsert || hasUnsafePromptGenerate) {
      throw new Error([
        "计划安全校验失败：用户意图是使用本地组件库资产。",
        "必须先 component_library.list 或 component.search，再使用 component.insert 插入组件。",
        "不允许把本地组件库需求退化成 schema.generate_from_prompt。"
      ].join("\n"));
    }
  }

  const schemaMutationTools = new Set([
    "layout.insert_above",
    "layout.apply_intent_patch",
    "layout.reflow",
    "layout.update_spacing",
    "schema.create_menu",
    "schema.add_nodes",
    "schema.add_child",
    "schema.insert_before",
    "schema.update_node",
    "schema.delete_node",
    "schema.duplicate_node",
    "schema.generate_from_prompt",
    "component.insert",
    "component.create_from_nodes"
  ]);
  const hasMutation = plan.steps.some((step) => schemaMutationTools.has(step.tool));
  const firstMutationIndex = plan.steps.findIndex((step) => schemaMutationTools.has(step.tool));
  const hasSchemaContextBeforeMutation = firstMutationIndex >= 0
    && plan.steps.slice(0, firstMutationIndex).some((step) => step.tool === "page.get_schema" || step.tool === "page.create");
  if (hasMutation && !hasSchemaContextBeforeMutation) {
    throw new Error([
      "计划安全校验失败：schema 修改任务必须先读取当前页面 schema。",
      `第一个修改工具是 ${plan.steps[firstMutationIndex]?.tool ?? "空"}，但它前面没有 page.get_schema 或 page.create，已停止执行。`,
      "建议：重新规划为 page.get_schema/page.create -> 定位/生成 -> schema 修改 -> schema.validate。"
    ].join("\n"));
  }
}

function shouldStopAfterDesignAgentPlan(
  planningMode: "auto" | "plan" | undefined,
  plan: DesignAgentPlan,
  message: string
) {
  return (planningMode === "plan" || plan.mode === "plan") && isExplicitDesignPlanOnly(message);
}

function isExplicitDesignPlanOnly(message: string) {
  return /只规划|先规划|不要执行|别执行|仅输出计划|规划模式|plan only/i.test(message);
}

function ensureCreateUiComponentLookupSteps(message: string, plan: DesignAgentPlan): DesignAgentPlan {
  const hasPageTemplateList = plan.steps.some((step) => step.tool === "page_template.list");
  const hasLibraryList = plan.steps.some((step) => step.tool === "component_library.list");
  const hasComponentSearch = plan.steps.some((step) => step.tool === "component.search");
  if (hasPageTemplateList && hasLibraryList && hasComponentSearch) {
    return plan;
  }
  const generateIndex = plan.steps.findIndex((step) => step.tool === "schema.generate_ui_from_requirements");
  if (generateIndex < 0) {
    return plan;
  }
  const lookupSteps: DesignAgentToolCall[] = [
    hasPageTemplateList ? undefined : { tool: "page_template.list", reason: "读取整页页面模板摘要，并由 Template Matcher 输出本次最适合的模板契约。", input: { userRequest: message, platform: /app|移动|手机|小程序/i.test(message) ? "mobile_app" : "web" } },
    hasLibraryList ? undefined : { tool: "component_library.list", reason: "读取本地组件库摘要，优先匹配表格、状态、输入框、按钮等可复用组件。", input: {} },
    hasComponentSearch ? undefined : { tool: "component.search", reason: "按本次页面需求检索本地组件资产，作为生成 UI 稿的组件库基准。", input: { query: message, limit: 20 } }
  ].filter((step): step is DesignAgentToolCall => Boolean(step));
  return {
    ...plan,
    assumptions: [...plan.assumptions, "生成 UI 前先读取页面模板和本地组件库，优先继承模板风格、布局密度和组件资产"],
    steps: [
      ...plan.steps.slice(0, generateIndex),
      ...lookupSteps,
      ...plan.steps.slice(generateIndex)
    ].slice(0, 8)
  };
}

function normalizeDesignAgentPlanForIntent(message: string, plan: DesignAgentPlan): DesignAgentPlan {
  if (routeDesignAgentTask(message) === "create_new_ui") {
    const hasCreateUiFlow = plan.steps.some((step) => step.tool === "requirement.parse")
      && plan.steps.some((step) => step.tool === "flow.generate")
      && plan.steps.some((step) => step.tool === "schema.generate_ui_from_requirements");
    const hasPageEditTool = plan.steps.some((step) => ["page.get_schema", "page.analyze_structure", "schema.update_node", "layout.insert_above"].includes(step.tool));
    if (hasCreateUiFlow && !hasPageEditTool) return ensureCreateUiComponentLookupSteps(message, plan);
    return {
      ...plan,
      title: plan.title || "根据需求生成 UI 稿",
      userGoal: plan.userGoal || message,
      mode: isExplicitDesignPlanOnly(message) ? "plan" : "execute",
      reply: isExplicitDesignPlanOnly(message) ? "我先给出计划，不执行工具。" : "我会根据需求在当前画布右侧追加多张 UI 画板。",
      assumptions: [...plan.assumptions, "这是从需求生成新 UI，不改已有画板内容", "新画板在当前画布右侧追加，顶对齐，水平间距 40px", "先解析需求，再生成页面和流程，最后生成可渲染 schema"],
      steps: [
        { tool: "requirement.parse", reason: "解析自然语言需求，识别模块、功能点和实体。", input: { userRequest: message } },
        { tool: "flow.generate", reason: "根据功能点生成页面清单、用户流程和必要状态。", input: { userRequest: message } },
        { tool: "page_template.list", reason: "读取整页页面模板摘要，并由 Template Matcher 输出本次最适合的模板契约。", input: { userRequest: message, platform: /app|移动|手机|小程序/i.test(message) ? "mobile_app" : "web" } },
        { tool: "component_library.list", reason: "读取本地组件库摘要，优先匹配表格、状态、输入框、按钮等可复用组件。", input: {} },
        { tool: "component.search", reason: "按本次页面需求检索可复用的本地组件资产，给 Schema Agent 作为风格和结构基准。", input: { query: message, limit: 20 } },
        { tool: "asset.resolve", reason: "解析需要的图标、插画和素材占位。", input: { userRequest: message } },
        { tool: "schema.generate_ui_from_requirements", reason: "在当前画布右侧追加多页面可编辑 UI 画板，顶对齐并保持 40px 间距。", input: { userRequest: message, platform: /app|移动|手机|小程序/i.test(message) ? "mobile_app" : "web", gap: 40 } },
        { tool: "canvas.capture", reason: "生成 UI 后输出右侧新增画板的预览截图，交给产品确认。", input: { mode: "rightmost_artboards", limit: 6 } },
        { tool: "ui.critic_review", reason: "检查需求覆盖、无关内容、流程和布局问题。", input: { userRequest: message } }
      ]
    };
  }

  const isAddMenu = /(添加|新增|加一个|加入|放一个|插入|add|insert).*(菜单|导航|menu|sidebar|侧边栏)|(?:菜单|导航|menu|sidebar|侧边栏).*(添加|新增|加一个|加入|放一个|插入|add|insert)/i.test(message);
  const isAddSearchCondition = isListSearchConditionIntent(message);
  const isLocalComponentIntent = isLocalComponentAssetIntent(message);
  if (isLocalComponentIntent) {
    const hasComponentLookup = plan.steps.some((step) => step.tool === "component_library.list" || step.tool === "component.search");
    const hasComponentInsert = plan.steps.some((step) => step.tool === "component.insert");
    const hasUnsafePromptGenerate = plan.steps.some((step) => step.tool === "schema.generate_from_prompt");
    if (hasComponentLookup && hasComponentInsert && !hasUnsafePromptGenerate) return plan;
    return {
      ...plan,
      title: plan.title || "插入本地组件",
      userGoal: plan.userGoal || message,
      assumptions: [...plan.assumptions, "优先使用本地组件库里的组件资产，而不是重新生成近似 schema"],
      steps: [
        { tool: "page.get_schema", reason: "先读取当前页面 schema，确认组件插入的页面上下文。", input: {} },
        { tool: "component.search", reason: "按用户描述检索本地组件库和组件资产。", input: { query: message } },
        { tool: "component.insert", reason: "把匹配到的本地组件克隆并插入当前画布。", input: { query: message } },
        { tool: "schema.validate", reason: "插入组件后校验 schema 合法性。", input: {} },
        { tool: "ui.review_design", reason: "审核插入组件后的布局、层级和遮挡。", input: { userRequest: message } }
      ]
    };
  }
  if (isAddSearchCondition) {
    const hasSemanticFlow = plan.steps.some((step) => step.tool === "page.analyze_structure")
      && plan.steps.some((step) => step.tool === "product.review_requirements")
      && plan.steps.some((step) => step.tool === "layout.insert_above" || step.tool === "schema.add_child" || step.tool === "schema.insert_before");
    const hasUnsafeTableUpdate = plan.steps.some((step) => step.tool === "schema.update_node" && /table|表格/i.test(JSON.stringify(step.input)));
    if (hasSemanticFlow && !hasUnsafeTableUpdate) return plan;
    return {
      ...plan,
      title: plan.title || "添加列表页搜索条件",
      userGoal: plan.userGoal || message,
      assumptions: [...plan.assumptions, "列表页搜索条件优先放在主表格上方", "找不到已有搜索区时自动新增搜索区域并重排布局"],
      steps: [
        { tool: "page.get_schema", reason: "先读取当前页面 schema，确认可编辑上下文。", input: {} },
        { tool: "page.analyze_structure", reason: "分析页面语义，识别主表格、已有筛选区和推荐插入点。", input: { userRequest: message } },
        { tool: "product.review_requirements", reason: "由产品 Agent 判断搜索字段是否符合业务对象。", input: { userRequest: message } },
        { tool: "layout.insert_above", reason: "在主表格上方新增搜索条件区域，并自动下移表格避免遮挡。", input: { userRequest: message, insertKind: "filter_bar", spacing: 16, height: 96 } },
        { tool: "schema.validate", reason: "修改后校验 schema 合法性。", input: {} },
        { tool: "ui.review_design", reason: "由 UI Agent 审核搜索区位置、间距、遮挡和对齐。", input: { userRequest: message } }
      ]
    };
  }
  if (!isAddMenu) return plan;
  const hasCreateMenu = plan.steps.some((step) => step.tool === "schema.create_menu");
  if (hasCreateMenu) return plan;
  return {
    ...plan,
    title: plan.title || "添加菜单组件",
    userGoal: plan.userGoal || message,
    assumptions: [...plan.assumptions, "用户意图是新增菜单，使用确定性菜单工具，避免误改已有节点"],
    steps: [
      { tool: "page.get_schema", reason: "先读取当前页面 schema，确认页面结构。", input: {} },
      { tool: "schema.create_menu", reason: "按用户要求新增菜单组件，而不是修改已有节点。", input: { position: /右侧|right/i.test(message) ? "right" : "left", title: "菜单" } },
      { tool: "schema.validate", reason: "新增菜单后校验 schema。", input: {} }
    ]
  };
}

function isContinueDesignAgentMessage(message: string) {
  const text = message.trim();
  return /^(继续|继续执行|继续完成|接着来|接着做|往下做|续接|恢复|resume|continue)$/i.test(text)
    || /继续执行上次中断|上次未完成|根据会话上下文.*续接|不要从零开始|续接未完成/i.test(text)
    || isQualityFeedbackResumeMessage(text);
}

function isQualityFeedbackResumeMessage(message: string) {
  const text = message.trim();
  if (!text) return false;
  const mentionsGeneratedUi = /生成的|刚才|上次|当前|现在|这个|页面|画布|ui|UI|稿|结果|内容|布局|样式|信息/.test(text);
  const reportsProblem = /不对|不正确|有问题|还是.*问题|缺失|缺少|不完整|没生成|没有生成|没做|没出来|不全|太差|质量差|乱|错|失败|没法用|需要完善|继续完善|补齐|修复/.test(text);
  return mentionsGeneratedUi && reportsProblem;
}

function inferResumeUserRequest(
  messages: RecentDesignAgentMessage[],
  toolCalls: DesignAgentToolHistoryItem[]
) {
  const userMessage = [...messages].reverse().find((item) => (
    item.role === "user"
    && item.content.trim()
    && !isContinueDesignAgentMessage(item.content)
  ));
  if (userMessage) return userMessage.content.trim();
  const toolWithRequest = toolCalls.find((call) => {
    const args = isRecordLike(call.arguments) ? call.arguments : undefined;
    return typeof args?.userRequest === "string" && args.userRequest.trim();
  });
  if (isRecordLike(toolWithRequest?.arguments) && typeof toolWithRequest.arguments.userRequest === "string") {
    return toolWithRequest.arguments.userRequest.trim();
  }
  return "";
}

function buildDesignAgentResumePlan(userRequest: string, context: DesignAgentResumeContext): DesignAgentPlan {
  const reviewRequest = buildResumeReviewRequest(userRequest, context.feedbackMessage);
  if (context.shouldUseCreateUiFlow && !context.hadSuccessfulSchemaMutation) {
    return {
      title: "继续生成未落盘 UI 稿",
      userGoal: userRequest,
      mode: "execute",
      reply: "我会从上次原始需求继续生成 UI，不重复已完成的上下文读取；如果还没有任何 UI 落盘，先重新生成 schema 并落盘。",
      assumptions: ["这是续接任务", "上次没有成功落盘 UI，需要继续完成生成链路"],
      steps: [
        { tool: "page_template.list", reason: "续接前读取页面模板，并匹配本次模板契约。", input: { userRequest, platform: /app|移动|手机|小程序/i.test(userRequest) ? "mobile_app" : "web" } },
        { tool: "component_library.list", reason: "续接前读取本地组件库，保持风格一致。", input: {} },
        { tool: "component.search", reason: "按原始需求检索可复用组件。", input: { query: userRequest, limit: 20 } },
        { tool: "asset.resolve", reason: "解析原始需求需要的图标和图片占位。", input: { userRequest } },
        { tool: "schema.generate_ui_from_requirements", reason: "继续完成上次未落盘的 UI 生成。", input: { userRequest: reviewRequest, platform: /app|移动|手机|小程序/i.test(userRequest) ? "mobile_app" : "web", gap: 40 } }
      ]
    };
  }

  const lastFailed = context.lastFailedTool;
  const reviewFix = lastFailed && (lastFailed.toolName === "ui.review_design" || lastFailed.toolName === "ui.review" || lastFailed.toolName === "ui.critic_review")
    ? buildDesignReviewFixStep(lastFailed.result, userRequest, 1)
    : undefined;
  const contractFix = lastFailed && lastFailed.toolName === "schema.generate_ui_from_requirements"
    ? buildDesignAgentRecoveryStep(userRequest, {
      tool: "schema.generate_ui_from_requirements",
      reason: "续接上次失败的 schema 生成。",
      input: isRecordLike(lastFailed.arguments) ? { ...lastFailed.arguments, userRequest: reviewRequest } : { userRequest: reviewRequest }
    }, {
      ok: false,
      message: lastFailed.error ?? "上次 schema 生成失败。",
      data: lastFailed.result
    }, 1)
    : undefined;
  const fixStep = contractFix ?? reviewFix;
  if (fixStep) {
    return {
      title: "继续修复上次失败步骤",
      userGoal: userRequest,
      mode: "execute",
      reply: `我会从最近失败的 ${lastFailed?.toolName ?? "工具"} 继续，先执行可安全恢复的修复动作。`,
      assumptions: ["这是续接任务", "优先处理最近失败工具返回的问题，不从零重建整页"],
      steps: [fixStep]
    };
  }

  if (context.feedbackMessage && context.hadSuccessfulSchemaMutation) {
    return {
      title: "根据用户反馈续接完善 UI",
      userGoal: userRequest,
      mode: "execute",
      reply: "我会基于上次生成结果和本次反馈继续处理，不从零生成。先截取当前生成画板，再做需求覆盖和 UI 结构审核，发现缺失后走明确修复动作。",
      assumptions: ["这是对上次生成结果的质量反馈", "优先在已生成画板上补齐和修复，不重新创建无关页面"],
      steps: [
        { tool: "canvas.capture", reason: "先截取上次生成画板，确认用户反馈对应的可见结果。", input: context.generatedFrameIds.length > 0 ? { nodeIds: context.generatedFrameIds, limit: 6 } : { mode: "rightmost_artboards", limit: 6 } },
        { tool: "ui.critic_review", reason: "根据原始需求和本次反馈检查内容覆盖、无关内容和页面模式是否偏离。", input: { userRequest: reviewRequest, generatedFrameIds: context.generatedFrameIds } },
        { tool: "ui.review_design", reason: "根据原始需求和本次反馈检查布局、遮挡、越界和可用性问题。", input: { userRequest: reviewRequest, generatedFrameIds: context.generatedFrameIds, userFeedback: context.feedbackMessage } }
      ]
    };
  }

  if (!context.hasCaptureAfterLastMutation) {
    return {
      title: "继续输出已生成 UI 的截图",
      userGoal: userRequest,
      mode: "execute",
      reply: "上次已有 UI 落盘但还没有输出截图，我会先截图，再进入审核。",
      assumptions: ["这是续接任务", "已有生成画板，先补截图和审核"],
      steps: [
        { tool: "canvas.capture", reason: "截取上次生成的画板，展示首版 UI。", input: context.generatedFrameIds.length > 0 ? { nodeIds: context.generatedFrameIds, limit: 6 } : { mode: "rightmost_artboards", limit: 6 } }
      ]
    };
  }

  if (!context.hasReviewAfterLastMutation) {
    return {
      title: "继续审核已生成 UI",
      userGoal: userRequest,
      mode: "execute",
      reply: "上次已有 UI 落盘和截图，我会继续执行 UI/schema 审核。",
      assumptions: ["这是续接任务", "已有生成画板，继续审核并必要修复"],
      steps: [
        { tool: "ui.review_design", reason: "续接上次生成结果，执行 UI/schema 审核。", input: { userRequest: reviewRequest, generatedFrameIds: context.generatedFrameIds, userFeedback: context.feedbackMessage } }
      ]
    };
  }

  return {
    title: "继续复查上次 UI 任务",
    userGoal: userRequest,
    mode: "execute",
    reply: "上次任务已有生成和审核记录，我会基于当前画布复查并给出最新状态。",
    assumptions: ["这是续接任务", "没有发现明确失败步骤，先复查当前结果"],
    steps: [
      { tool: "canvas.capture", reason: "重新截取当前生成画板，确认可见结果。", input: context.generatedFrameIds.length > 0 ? { nodeIds: context.generatedFrameIds, limit: 6 } : { mode: "rightmost_artboards", limit: 6 } },
      { tool: "ui.review_design", reason: "复查当前生成 UI 是否仍有阻塞问题。", input: { userRequest: reviewRequest, generatedFrameIds: context.generatedFrameIds, userFeedback: context.feedbackMessage } }
    ]
  };
}

function buildResumeReviewRequest(userRequest: string, feedbackMessage?: string) {
  if (!feedbackMessage?.trim()) return userRequest;
  return [
    userRequest.trim(),
    `用户对上次生成结果的反馈：${feedbackMessage.trim()}`,
    "请基于已有生成结果继续完善，重点检查内容缺失、页面模式偏离、布局错乱、文字/控件遮挡和无关业务对象。"
  ].join("\n");
}

function summarizeResumeDecision(input: {
  lastFailedTool?: DesignAgentToolHistoryItem;
  hadSuccessfulSchemaMutation: boolean;
  generatedFrameIds: string[];
  hasCaptureAfterLastMutation: boolean;
  hasReviewAfterLastMutation: boolean;
}) {
  if (!input.hadSuccessfulSchemaMutation) {
    return input.lastFailedTool
      ? `上次失败在 ${input.lastFailedTool.toolName}，且没有检测到成功落盘的 UI。`
      : "没有检测到成功落盘的 UI，需要从生成步骤继续。";
  }
  if (!input.hasCaptureAfterLastMutation) {
    return `检测到 ${input.generatedFrameIds.length || 1} 个已落盘画板，但缺少后续截图。`;
  }
  if (!input.hasReviewAfterLastMutation) {
    return `检测到 ${input.generatedFrameIds.length || 1} 个已落盘画板和截图，但缺少审核结果。`;
  }
  if (input.lastFailedTool) {
    return `最近失败工具是 ${input.lastFailedTool.toolName}，优先从该失败点恢复。`;
  }
  return "已检测到历史生成结果，继续复查当前画布状态。";
}

function routeDesignAgentTask(message: string) {
  const text = message.toLowerCase();
  const strongCreateUiIntent = isStrongCreateUiGenerationIntent(message);
  const createUiIntent = strongCreateUiIntent || /根据需求|生成ui稿|生成 ui|新建ui|新建 ui|新增ui|新增 ui|生成交互稿|交互 ui|设计一组页面|做一个app|做一个 app|从需求|用户基础模块|页面清单|用户流|详情页|列表页|表单页|落地页|页面稿|(?:添加|新增|加一个|做一个).{0,24}(页|页面|详情|列表|表单|弹窗)/.test(text + message);
  const explicitModifyIntent = /修改|调整|更新|改一下|改成|替换|删除|移动|重命名|缩放|update|change|delete|move|rename/i.test(message);
  const explicitTarget = /当前页面|这个页面|选中|画布上|这里|此处|当前画布|修改当前|在当前|给当前|把这个|这个按钮|这个表格|指定区域|指定地方/.test(message);
  if (strongCreateUiIntent && !explicitTarget) {
    return "create_new_ui";
  }
  if (createUiIntent && !explicitTarget) {
    return "create_new_ui";
  }
  const explicitEdit = explicitTarget || explicitModifyIntent;
  if (explicitEdit) return "edit_existing_ui";
  if (createUiIntent) {
    return "create_new_ui";
  }
  if (/(新建|创建|生成|设计|添加|新增|做一个).*(页面|页|详情|列表|表单|弹窗)/.test(message) && !explicitEdit) {
    return "create_new_ui";
  }
  return "edit_existing_ui";
}

function isStrongCreateUiGenerationIntent(message: string) {
  return /根据.{0,20}需求.{0,20}生成.{0,20}(交互)?\s*ui\s*稿?|生成.{0,20}(交互)?\s*ui\s*稿?|输出.{0,20}(交互)?\s*ui\s*稿?|设计.{0,20}(交互)?\s*ui\s*稿?/i.test(message);
}

function shouldUseIncrementalUiGeneration(message: string) {
  return /分区块|逐块|一步步|边做边|增量|先创建空画板|每个区块|逐段|incremental|section by section/i.test(message);
}

function isListSearchConditionIntent(message: string) {
  const hasAddIntent = /(添加|新增|加一个|加入|放一个|插入|add|insert)/i.test(message);
  const hasSearchIntent = /(搜索条件|筛选条件|查询条件|filter|search|query|筛选区|搜索区|查询区)/i.test(message);
  const hasListContext = /(列表|表格|table|list|数据表|数据列表|主表格)/i.test(message);
  return hasAddIntent && hasSearchIntent && hasListContext;
}

function isLocalComponentAssetIntent(message: string) {
  return /(插入|添加|新增|使用|复用|放一个|加入|用|insert|use).{0,24}(本地组件|组件库|组件|component)|(本地组件|组件库|component).{0,24}(插入|添加|新增|使用|复用|用|insert|use)|component\.insert/i.test(message);
}

function isLocalComponentQueryIntent(message: string) {
  return /(本地组件|组件库|component).{0,20}(有哪些|列表|查询|查看|搜索|检索|list|search|find)|(有哪些|列表|查询|查看|搜索|检索|list|search|find).{0,20}(本地组件|组件库|component)/i.test(message);
}

function isComponentLibraryCreateIntent(message: string) {
  return /(创建|新建|新增|生成).{0,12}(本地)?组件库(?!组件)|(component_library\.create)/i.test(message);
}

function isLocalComponentCreationIntent(message: string) {
  return /(创建|新建|生成|保存|沉淀|提取|制作).{0,24}(本地组件|组件库组件|组件模板|组件资产|component)|(选区|当前页面|这些节点|这个区域).{0,24}(创建|保存|沉淀|提取).{0,12}(组件|component)/i.test(message);
}

function inferComponentLibraryNameFromMessage(message: string) {
  return /组件库[「“"]?([^」”"\n，,。；;]{2,24})/.exec(message)?.[1]?.trim();
}

function inferComponentLibraryDescriptionFromMessage(message: string) {
  return /(?:描述|说明)[:：]?\s*([^。\n]{2,80})/.exec(message)?.[1]?.trim();
}

function inferComponentNameFromMessage(message: string) {
  return /(?:组件|模板)[「“"]?([^」”"\n，,。；;]{2,24})/.exec(message)?.[1]?.trim()
    ?? /(查询区|搜索区|筛选区|表格区|操作栏|页头|卡片|表单块|详情区|状态栏|分页)/.exec(message)?.[1];
}

function inferComponentNodeMatchFromMessage(message: string) {
  if (/表格|table/i.test(message)) return { type: "table" };
  if (/查询区|搜索区|筛选区|filter|search/i.test(message)) return { name: "查询" };
  if (/页头|标题区|header/i.test(message)) return { position: "top" };
  if (/卡片|card/i.test(message)) return { type: "card" };
  if (/表单|form/i.test(message)) return { type: "input" };
  return {};
}

function isSchemaMutationTool(tool: DesignAgentToolCall["tool"]) {
  return [
    "schema.generate_ui_from_requirements",
    "page.create",
    "page.rename",
    "page.delete",
    "page.duplicate",
    "layout.insert_above",
    "layout.apply_intent_patch",
    "layout.reflow",
    "layout.update_spacing",
    "schema.create_menu",
    "schema.add_nodes",
    "schema.add_child",
    "schema.insert_before",
    "schema.update_node",
    "schema.delete_node",
    "schema.duplicate_node",
    "schema.generate_from_prompt",
    "component.insert",
    "component.create_from_nodes"
  ].includes(tool);
}

function inferSchemaPatchAction(tool: DesignAgentToolCall["tool"]): "add" | "update" | "delete" | "replace" {
  if (tool.includes("delete")) return "delete";
  if (tool.includes("update") || tool.includes("rename")) return "update";
  if (tool.includes("duplicate") || tool.includes("create") || tool.includes("add") || tool.includes("generate") || tool.includes("insert")) return "add";
  return "replace";
}

function buildDesignAgentRecoveryStep(message: string, failedStep: DesignAgentToolCall, result: DesignAgentToolResult, retryAttempt = 1): DesignAgentToolCall | undefined {
  const isAddSearchCondition = isListSearchConditionIntent(message);
  const contractIssue = readFirstContractIssue(result) ?? parseContractIssueFromMessage(result.message);
  if (failedStep.tool === "schema.generate_ui_from_requirements" && contractIssue) {
    return buildSchemaRegenerationForContractIssue(message, failedStep, result, contractIssue, retryAttempt);
  }
  if (isAddSearchCondition && failedStep.tool === "schema.update_node" && /没有找到|not found|找不到|失败/i.test(result.message)) {
    return {
      tool: "layout.insert_above",
      reason: "update_node 未找到可修改搜索区，降级为在主表格上方新增搜索条件区域并自动重排。",
      input: { userRequest: message, insertKind: "filter_bar", spacing: 16, height: 96 }
    };
  }
  if (isAddSearchCondition && (failedStep.tool === "schema.add_nodes" || failedStep.tool === "schema.insert_before") && /遮挡|重叠|spacing|layout|布局/i.test(result.message)) {
    return {
      tool: "layout.reflow",
      reason: "插入后布局可能重叠，使用布局重排工具补偿。",
      input: { spacing: 16 }
    };
  }
  if (failedStep.tool === "layout.insert_above" && /没有找到可插入|未找到安全插入点|target/i.test(result.message)) {
    const fallbackModes = ["largest_table_or_list", "largest_content", "first_frame_content"];
    const fallbackMode = fallbackModes[retryAttempt - 1];
    if (!fallbackMode) return undefined;
    return {
      tool: "layout.insert_above",
      reason: `layout.insert_above 未找到目标节点，改用 fallbackMode=${fallbackMode} 重新寻找安全插入点。`,
      input: {
        ...failedStep.input,
        fallbackMode,
        retryAttempt
      }
    };
  }
  if (failedStep.tool === "ui.critic_review" && routeDesignAgentTask(message) === "create_new_ui") {
    return buildCriticReviewPatchStep(result.data, message, retryAttempt)
      ?? {
        tool: "schema.generate_ui_from_requirements",
        reason: `${formatRetryAttemptLabel(retryAttempt)}重试：Critic 审核未通过，且没有安全 patch，才重新生成一版覆盖缺失主题并去掉无关内容的 UI 稿。`,
        input: {
          userRequest: [
            message,
            "",
            "Critic 审核失败，需要重新生成：",
            result.message,
            "",
        "要求：严格覆盖原始需求，不引入订单/商品/搜索筛选等无关业务；移动端/小程序必须单列卡片化。"
          ].join("\n"),
          platform: /小程序|移动端|手机|app/i.test(message) ? "mobile_app" : "web",
          gap: 40
        }
      };
  }
  return undefined;
}

function buildSchemaRegenerationForContractIssue(
  message: string,
  failedStep: DesignAgentToolCall,
  result: DesignAgentToolResult,
  issue: { kind: "missing_required_region" | "forbidden_region_present"; region: string },
  retryAttempt = 1
): DesignAgentToolCall {
  const action = issue.kind === "missing_required_region"
    ? `补齐契约要求区域 ${issue.region}`
    : `移除契约禁用区域 ${issue.region}`;
  return {
    tool: "schema.generate_ui_from_requirements",
    reason: `${formatRetryAttemptLabel(retryAttempt)}契约修复：schema 尚未成功落盘，不能 patch 旧画布；重新生成 schemaDraft 并${action}。`,
    input: {
      ...failedStep.input,
      schemaDraft: undefined,
      userRequest: [
        message,
        "",
        "上一次 schemaDraft 在落盘前被 Layout Intent Validator 拦截：",
        result.message,
        "",
        `本轮只修 schema 契约：${action}。`,
        "必须以原始需求和 UI 设计计划的 pageMode 为准；如果是列表页，不要继承模板里的 DescriptionList/DetailPanel；如果是详情页，不要生成 FilterBar/Table/Pagination。",
        "不要去修改当前画布旧画板，不要退回手写坐标 schema。"
      ].join("\n"),
      platform: failedStep.input.platform ?? (/小程序|移动端|手机|app/i.test(message) ? "mobile_app" : "web"),
      gap: failedStep.input.gap ?? 40
    }
  };
}

function buildContractIssuePatchStep(message: string, result: DesignAgentToolResult, retryAttempt = 1): DesignAgentToolCall | undefined {
  const issue = readFirstContractIssue(result) ?? parseContractIssueFromMessage(result.message);
  if (!issue) return undefined;
  const businessEntity = inferBusinessEntityFromUserRequest(message);
  const pageMode = inferPageModeForFallback("", message);
  if (issue.kind === "missing_required_region") {
    return {
      tool: "layout.apply_intent_patch",
      reason: `${formatRetryAttemptLabel(retryAttempt)}契约修复：Validator 要求补齐 ${issue.region} 区域，直接追加缺失 region，不重写已有页面。`,
      input: { operation: "add_required_region", region: issue.region, spacing: 16, userRequest: message, businessEntity, pageMode }
    };
  }
  if (issue.kind === "forbidden_region_present") {
    return {
      tool: "layout.apply_intent_patch",
      reason: `${formatRetryAttemptLabel(retryAttempt)}契约修复：Validator 禁止 ${issue.region} 区域，直接移除该 region，不重写已有页面。`,
      input: { operation: "remove_forbidden_region", region: issue.region, spacing: 16, userRequest: message, businessEntity, pageMode }
    };
  }
  return undefined;
}

function buildCriticReviewPatchStep(data: unknown, userRequest = "", retryAttempt = 1): DesignAgentToolCall | undefined {
  if (!isRecordLike(data)) return undefined;
  const missingTopics = Array.isArray(data.missingTopics) ? data.missingTopics.map(String).filter(Boolean) : [];
  const irrelevantContent = Array.isArray(data.irrelevantContent) ? data.irrelevantContent.map(String).filter(Boolean) : [];
  const entityMismatch = isRecordLike(data.entityMismatch) ? data.entityMismatch : undefined;
  const businessEntity = inferBusinessEntityFromUserRequest(userRequest);
  const pageMode = inferPageModeForFallback("", userRequest);
  const unexpectedEntities = Array.isArray(entityMismatch?.unexpectedEntities) ? entityMismatch.unexpectedEntities.map(String).filter(Boolean) : [];
  const missingEntities = Array.isArray(entityMismatch?.missingEntities) ? entityMismatch.missingEntities.map(String).filter(Boolean) : [];

  if (unexpectedEntities.length > 0) {
    return {
      tool: "layout.apply_intent_patch",
      reason: `${formatRetryAttemptLabel(retryAttempt)}Critic 修复：发现无关业务对象 ${unexpectedEntities.join("、")}，先移除相关区块，不重生整页。`,
      input: {
        operation: "remove_irrelevant_section",
        regions: unexpectedEntities,
        spacing: 16,
        userRequest,
        businessEntity,
        pageMode,
        reason: `remove unexpected entities: ${unexpectedEntities.join(",")}`
      }
    };
  }

  if (irrelevantContent.length > 0) {
    const forbiddenRegions = Array.from(new Set(irrelevantContent.map(inferForbiddenRegionFromCriticTopic).filter(Boolean)));
    return {
      tool: "layout.apply_intent_patch",
      reason: `${formatRetryAttemptLabel(retryAttempt)}Critic 修复：发现无关内容 ${irrelevantContent.join("、")}，按语义移除禁用区域。`,
      input: forbiddenRegions.length > 0
        ? { operation: "remove_forbidden_region", regions: forbiddenRegions, spacing: 16, userRequest, businessEntity, pageMode }
        : { operation: "remove_irrelevant_section", regions: irrelevantContent, spacing: 16, userRequest, businessEntity, pageMode }
    };
  }

  if (missingEntities.length > 0 || missingTopics.length > 0) {
    const regions = Array.from(new Set([
      ...missingTopics.map((topic) => inferRequiredRegionFromCriticTopic(topic, userRequest)),
      ...missingEntities.map((entity) => inferRequiredRegionFromCriticTopic(entity, userRequest))
    ].filter(Boolean)));
    return {
      tool: "layout.apply_intent_patch",
      reason: `${formatRetryAttemptLabel(retryAttempt)}Critic 修复：发现内容缺失 ${[...missingEntities, ...missingTopics].join("、")}，直接补齐缺失区域。`,
      input: {
        operation: "add_required_region",
        regions: regions.length > 0 ? regions : inferRequiredRegionsForPatch(userRequest),
        spacing: 16,
        userRequest,
        businessEntity,
        pageMode
      }
    };
  }

  return undefined;
}

function inferForbiddenRegionFromCriticTopic(topic: string) {
  if (/筛选|搜索|查询|filter|search|query/i.test(topic)) return "FilterBar";
  if (/表格|列表|table|list/i.test(topic)) return "Table";
  if (/分页|pagination|pager/i.test(topic)) return "Pagination";
  if (/卡片列表|cardlist/i.test(topic)) return "CardList";
  return "";
}

function inferRequiredRegionFromCriticTopic(topic: string, userRequest = "") {
  if (/操作|按钮|action|button|提交|保存|确认|取消|返回/i.test(topic)) return "ActionBar";
  if (/详情|明细|资料|信息|字段|属性|规格|detail|description/i.test(topic)) return "DescriptionList";
  if (/表单|输入|选择|上传|form|input|select|upload/i.test(topic)) return "Form";
  if (/流程|步骤|时间线|进度|steps|timeline/i.test(topic)) return "Steps";
  if (/筛选|搜索|查询|filter|search|query/i.test(topic)) return "FilterBar";
  if (/表格|列表|table|list/i.test(topic)) return /小程序|移动端|手机|app/i.test(userRequest) ? "CardList" : "Table";
  if (/摘要|统计|指标|状态|summary|metric/i.test(topic)) return "Summary";
  if (/标题|头部|导航|header|nav/i.test(topic)) return "Header";
  const pageMode = inferPageModeForFallback("", userRequest);
  if (pageMode === "detail") return "DescriptionList";
  if (pageMode === "form") return "Form";
  if (pageMode === "flow") return "Steps";
  if (pageMode === "collection") return /小程序|移动端|手机|app/i.test(userRequest) ? "CardList" : "Table";
  return inferRequiredRegionsForPatch(userRequest).find((region) => region !== "Header" && region !== "ActionBar") ?? "DescriptionList";
}

function inferRequiredRegionsForPatch(userRequest: string) {
  const pageMode = inferPageModeForFallback("", userRequest);
  if (pageMode === "detail") return ["Header", "DescriptionList", "ActionBar"];
  if (pageMode === "form") return ["Form", "ActionBar"];
  if (pageMode === "flow") return ["Steps", "ActionBar"];
  if (pageMode === "collection") return /搜索|筛选|查询|filter|search|query/i.test(userRequest)
    ? ["Header", "FilterBar", "Table", "Pagination"]
    : ["Header", "Table", "Pagination"];
  return ["Header", "DescriptionList", "ActionBar"];
}

function inferBusinessEntityFromUserRequest(message: string) {
  const request = getPrimaryUserRequestText(message);
  if (/订单|order|交易单|退款单|发货单|支付单/i.test(request)) return "订单";
  if (/商品|产品|product|sku|库存|上架|下架/i.test(request)) return "商品";
  if (/客户|会员|customer|crm/i.test(request)) return "客户";
  if (/用户(列表|详情|管理|页面|画板|账号|资料|中心|权限)|账号|user/i.test(request)) return "用户";
  if (/服务人员|家政员|护工|保姆/i.test(request)) return "服务人员";
  if (/设备|device|iot/i.test(request)) return "设备";
  if (/任务|task/i.test(request)) return "任务";
  if (/项目|project/i.test(request)) return "项目";
  return "";
}

function getPrimaryUserRequestText(text: string) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return text.trim();
  const stopIndex = lines.findIndex((line, index) => index > 0 && /上一次|本轮|失败|重试|修复|Validator|schemaDraft|Layout Intent|Critic|审核|契约|要求：|必须以|不要去修改|不要退回/i.test(line));
  return (stopIndex > 0 ? lines.slice(0, stopIndex) : [lines[0]]).join("\n").trim() || text.trim();
}

function readFirstContractIssue(result: DesignAgentToolResult): { kind: "missing_required_region" | "forbidden_region_present"; region: string } | undefined {
  if (!isRecordLike(result.data)) return undefined;
  const contractIssues = result.data.contractIssues;
  if (!Array.isArray(contractIssues)) return undefined;
  for (const item of contractIssues) {
    if (!isRecordLike(item)) continue;
    const kind = item.kind;
    const region = typeof item.region === "string" ? item.region.trim() : "";
    if ((kind === "missing_required_region" || kind === "forbidden_region_present") && region) {
      return { kind, region };
    }
  }
  return undefined;
}

function parseContractIssueFromMessage(message: string): { kind: "missing_required_region" | "forbidden_region_present"; region: string } | undefined {
  const missing = /契约要求\s+([^，。；]+)，但\s+layoutIntent\s+未包含对应区域/.exec(message);
  if (missing?.[1]) return { kind: "missing_required_region", region: missing[1].trim() };
  const forbidden = /契约禁止\s+([^，。；]+)，但\s+layoutIntent\s+包含该区域/.exec(message);
  if (forbidden?.[1]) return { kind: "forbidden_region_present", region: forbidden[1].trim() };
  return undefined;
}

function formatRetryAttemptLabel(retryAttempt: number) {
  return ["第一次", "第二次", "第三次"][retryAttempt - 1] ?? `第 ${retryAttempt} 次`;
}

function buildDesignReviewFixStep(data: unknown, userRequest = "", retryAttempt = 1): DesignAgentToolCall | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  const issues = record.issues;
  const issueMessages = Array.isArray(issues)
    ? issues
      .map((issue) => issue && typeof issue === "object" && !Array.isArray(issue) ? String((issue as Record<string, unknown>).message ?? "") : "")
      .filter(Boolean)
    : [];
  const missingTopics = Array.isArray(record.missingTopics) ? record.missingTopics.map(String).filter(Boolean) : [];
  const irrelevantContent = Array.isArray(record.irrelevantContent) ? record.irrelevantContent.map(String).filter(Boolean) : [];
  const visualFindings = isRecordLike(record.visualReview) && Array.isArray(record.visualReview.findings)
    ? record.visualReview.findings
      .map((finding) => isRecordLike(finding) ? [
        finding.issue ? String(finding.issue) : "",
        finding.evidence ? String(finding.evidence) : "",
        finding.fixSuggestion ? String(finding.fixSuggestion) : ""
      ].filter(Boolean).join("：") : "")
      .filter(Boolean)
    : [];
  const allMessages = [...issueMessages, ...visualFindings, ...missingTopics.map((item) => `缺失主题：${item}`), ...irrelevantContent.map((item) => `无关内容：${item}`)];
  const combined = allMessages.join("\n");
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (!issue || typeof issue !== "object" || Array.isArray(issue)) continue;
      const suggestedFix = (issue as Record<string, unknown>).suggestedFix;
      if (!suggestedFix || typeof suggestedFix !== "object" || Array.isArray(suggestedFix)) continue;
      const tool = (suggestedFix as Record<string, unknown>).tool;
      const input = (suggestedFix as Record<string, unknown>).input;
      const parsed = designAgentToolCallSchema.safeParse({
        tool,
        reason: `根据审核问题自动修复：${String((issue as Record<string, unknown>).message ?? "")}`,
        input: input && typeof input === "object" && !Array.isArray(input) ? input : {}
      });
      if (parsed.success) return parsed.data;
    }
  }
  const criticPatch = buildCriticReviewPatchStep(record, userRequest, retryAttempt);
  if (criticPatch) return criticPatch;
  if (/文字|文本|遮挡|重叠|越界|剪切|显示不全|间距|布局/.test(combined)) {
    return {
      tool: "layout.reflow",
      reason: `${formatRetryAttemptLabel(retryAttempt)}审核修复：检测到布局/文字/越界类问题，先执行局部重排和文本高度修正。`,
      input: { spacing: 16, fixTextOverflow: true, expandFrames: true }
    };
  }
  if (routeDesignAgentTask(userRequest) === "create_new_ui" && shouldRegenerateDesignFromReview(combined)) {
    return {
      tool: "schema.generate_ui_from_requirements",
      reason: [
        `${formatRetryAttemptLabel(retryAttempt)}审核修复：发现结构性质量问题，且没有可用局部 patch，重新生成一版更符合平台/行业/交互规范的 UI 稿。`,
        "不会使用 table/大图/大卡片糊弄，会要求颗粒化节点、移动端单列、文字不遮挡。"
      ].join(" "),
      input: {
        userRequest: [
          userRequest,
          "",
          "上一次 UI 审核失败，必须修复以下问题：",
          combined || "审核未通过。",
          "",
          "修复要求：如果是小程序/移动端，必须使用 375x812 单列卡片/表单布局；禁止 PC dashboard、禁止 table；所有文字必须独立节点且不能和文字/交互控件互相遮挡；容器/卡片/背景与内部内容可以正常层叠；每个页面必须有主操作和状态反馈。"
        ].join("\n"),
        platform: /小程序|移动端|手机|app/i.test(userRequest) ? "mobile_app" : "web",
        gap: 40
      }
    };
  }
  return undefined;
}

function shouldRegenerateDesignFromReview(reviewText: string) {
  return /PC 尺寸|移动端\/小程序|table 节点|禁止 table|缺少可交互|没有明确主操作|缺失主题|无关内容|大图|大表格|结构性|粗糙|风格|视觉资产|图标|图片|按钮文字|文本层级|质量门槛|颜色\/层级/.test(reviewText);
}

function formatDesignToolPlanReply(plan: DesignAgentPlan, uiDesignPlan?: UiDesignerPlan) {
  if (plan.steps.length === 0) {
    return [formatUiDesignPlanReply(uiDesignPlan), plan.reply || "这次不需要调用工具。"].filter(Boolean).join("\n\n");
  }
  return [
    formatUiDesignPlanReply(uiDesignPlan),
    "我准备这样做：",
    `目标：${plan.userGoal || plan.title}`,
    plan.assumptions.length > 0 ? `关键假设：${plan.assumptions.join("；")}` : "",
    plan.reply || "执行计划如下：",
    ...plan.steps.map((step, index) => `${index + 1}. ${step.tool}：${step.reason || "执行工具"}${formatToolInputBrief(step.input)}`)
  ].filter(Boolean).join("\n");
}

function formatDesignToolExecutionReply(results: Array<{ tool: string; ok: boolean; message: string }>) {
  if (results.length === 0) {
    return "没有执行工具。";
  }
  const failed = results.find((result) => !result.ok);
  return [
    failed ? "工具执行已停止：" : "已完成工具执行：",
    ...results.map((result, index) => `${index + 1}. ${result.ok ? "成功" : "失败"} ${result.tool}：${result.message}`),
    failed ? `建议：先处理 ${failed.tool} 返回的问题，再继续执行后续修改。` : "反馈：计划内工具已执行完成。"
  ].join("\n");
}

function formatDesignToolPlanAndExecutionReply(
  plan: DesignAgentPlan,
  results: Array<{ tool: string; ok: boolean; message: string; data?: unknown }>,
  uiDesignPlan?: UiDesignerPlan
) {
  const failedIndex = results.findIndex((result) => !result.ok);
  const failedStep = failedIndex >= 0 ? plan.steps[failedIndex] : undefined;
  return [
    "执行前计划：",
    formatDesignToolPlanReply(plan, uiDesignPlan),
    "",
    "执行结果：",
    formatDesignToolExecutionReply(results),
    failedStep ? [
      "",
      "失败上下文：",
      `Tool：${failedStep.tool}`,
      `Reason：${failedStep.reason || "未提供"}`,
      `Input：${JSON.stringify(failedStep.input)}`
    ].join("\n") : ""
  ].filter(Boolean).join("\n");
}

function formatUiDesignPlanReply(plan?: UiDesignerPlan) {
  if (!plan) return "";
  const components = plan.componentPlan.map((item) => `${item.type}${item.position ? `(${item.position})` : ""}`).join("、");
  const pageSpecs = plan.pageSpecs.map((page) => {
    const contract = [page.pageMode, page.layoutPattern, page.businessEntity].filter(Boolean).join("/");
    return `${page.name}${contract ? `[${contract}]` : ""}${page.primaryAction ? `(${page.primaryAction})` : ""}`;
  }).join("、");
  const lines = [
    "UI 设计 Agent 判断：",
    plan.designGoal ? `设计目标：${plan.designGoal}` : "",
    plan.businessUnderstanding ? `业务理解：${plan.businessUnderstanding}` : "",
    `平台/行业：${plan.platform} / ${plan.industry || "通用业务"}`,
    plan.interactionTypes.length > 0 ? `交互类型：${plan.interactionTypes.join("、")}` : "",
    plan.referenceSystems.length > 0 ? `参考系统：${plan.referenceSystems.join("、")}` : "",
    plan.layoutPlan.type ? `布局：${plan.layoutPlan.type}${plan.layoutPlan.areas.length > 0 ? `，区域：${plan.layoutPlan.areas.join("、")}` : ""}` : "",
    plan.styleGuide.theme || plan.styleGuide.primaryColor ? `视觉规范：${plan.styleGuide.theme || "默认主题"}，主色 ${plan.styleGuide.primaryColor || "未指定"}，间距 ${plan.styleGuide.spacing}` : "",
    components ? `组件选择：${components}` : "",
    pageSpecs ? `页面规划：${pageSpecs}` : "",
    plan.qualityBar.length > 0 ? `质量门槛：${plan.qualityBar.join("、")}` : "",
    plan.reviewChecklist.length > 0 ? `审查清单：${plan.reviewChecklist.join("、")}` : ""
  ].filter(Boolean);
  if (lines.length <= 1) {
    return [
      "UI 设计 Agent 判断：",
      "设计目标：先生成可评审的第一版页面，而不是只给空计划。",
      "布局：按平台选择移动端单列或 PC 分区布局，新增画板与已有画板顶对齐。",
      "组件选择：标题、核心内容区、主操作、状态反馈和必要表单/卡片。",
      "审查清单：需求覆盖、元素不遮挡、不越界、主操作明确、状态完整。"
    ].join("\n");
  }
  return lines.join("\n");
}

function buildSequentialUiDraftRequests(message: string, plan?: UiDesignerPlan) {
  const pageSpecs = plan?.pageSpecs?.length ? plan.pageSpecs : [];
  const fallbackPages = inferRequestedPageNames(message);
  const pages = pageSpecs.length > 0
    ? pageSpecs.map((page) => ({
      name: page.name,
      goal: page.goal,
      pageMode: page.pageMode,
      businessEntity: page.businessEntity,
      layoutPattern: page.layoutPattern,
      requiredRegions: page.requiredRegions,
      forbiddenRegions: page.forbiddenRegions,
      componentFamilies: page.componentFamilies,
      keyBlocks: page.keyBlocks,
      primaryAction: page.primaryAction,
      states: page.states
    }))
    : fallbackPages.map((name) => ({
      name,
      goal: `${name} UI 稿`,
      pageMode: inferPageModeForFallback(name, message),
      businessEntity: "",
      layoutPattern: "custom",
      requiredRegions: [] as string[],
      forbiddenRegions: [] as string[],
      componentFamilies: [] as string[],
      keyBlocks: [] as string[],
      primaryAction: "",
      states: [] as string[]
    }));
  return pages.slice(0, 8).map((page, index) => ({
    name: page.name || `页面 ${index + 1}`,
    pageMode: page.pageMode,
    businessEntity: page.businessEntity,
    layoutPattern: page.layoutPattern,
    requiredRegions: page.requiredRegions,
    forbiddenRegions: page.forbiddenRegions,
    componentFamilies: page.componentFamilies,
    prompt: [
      message,
      "",
      `本次只生成第 ${index + 1} 个页面：「${page.name || `页面 ${index + 1}`}」。`,
      `页面契约：pageMode=${page.pageMode || "unknown"}，businessEntity=${page.businessEntity || "未指定"}，layoutPattern=${page.layoutPattern || "custom"}。`,
      page.requiredRegions.length > 0 ? `必须包含区域：${page.requiredRegions.join("、")}` : "",
      page.forbiddenRegions.length > 0 ? `禁止出现区域：${page.forbiddenRegions.join("、")}` : "",
      page.componentFamilies.length > 0 ? `组件族：${page.componentFamilies.join("、")}` : "",
      page.goal ? `页面目标：${page.goal}` : "",
      page.keyBlocks.length > 0 ? `关键区块：${page.keyBlocks.join("、")}` : "",
      page.primaryAction ? `主操作：${page.primaryAction}` : "",
      page.states.length > 0 ? `必须覆盖状态：${page.states.join("、")}` : "",
      "严格要求：本次 schemaDraft.artboards 只能包含 1 个 artboard；不要顺手生成其他页面。"
    ].filter(Boolean).join("\n")
  }));
}

function inferPageModeForFallback(name: string, message: string): z.infer<typeof pageModeSchema> {
  const text = `${name} ${message}`;
  if (/登录|注册|验证码|找回密码|重置密码|login|register|auth/i.test(text)) return "auth";
  if (/详情|明细|查看|资料|detail|profile/i.test(text)) return "detail";
  if (/新增|新建|编辑|修改|创建|录入|表单|上传|form|create|edit/i.test(text)) return "form";
  if (/看板|仪表盘|统计|趋势|报表|dashboard|analytics/i.test(text)) return "dashboard";
  if (/设置|配置|权限|偏好|settings|permission/i.test(text)) return "settings";
  if (/流程|步骤|审批流|流转|flow|wizard/i.test(text)) return "flow";
  if (/列表|表格|管理|查询|搜索|筛选|table|list|collection/i.test(text)) return "collection";
  return "unknown";
}

function normalizeLayoutPatternForSchemaDraft(value: string | undefined): z.infer<typeof layoutPatternSchema> {
  const parsed = layoutPatternSchema.safeParse(value);
  return parsed.success ? parsed.data : "custom";
}

function createUiPageShellDraft(
  draftRequest: ReturnType<typeof buildSequentialUiDraftRequests>[number],
  platformOverride: string,
  userRequest: string
): UiSchemaDraft {
  const platform: "web" | "mobile_app" = platformOverride === "mobile_app" || /小程序|移动端|手机|app/i.test(userRequest) ? "mobile_app" : "web";
  const size = platform === "mobile_app" ? { width: 375, height: 812 } : { width: 1440, height: 1024 };
  return {
    schemaVersion: "aipm.design.schema.v1",
    intent: `${draftRequest.name} 页面外框`,
    platform,
    designRationale: ["先创建空画板外框，再按区块增量追加内容，便于边做边校验。"],
    artboards: [{
      refId: "page-root",
      name: draftRequest.name,
      width: size.width,
      height: size.height,
      layout: platform === "mobile_app" ? "mobile single column incremental canvas" : "web incremental canvas",
      pageMode: draftRequest.pageMode ?? "unknown",
      businessEntity: draftRequest.businessEntity ?? "",
      layoutPattern: normalizeLayoutPatternForSchemaDraft(draftRequest.layoutPattern),
      requiredRegions: draftRequest.requiredRegions ?? [],
      forbiddenRegions: draftRequest.forbiddenRegions ?? [],
      componentFamilies: draftRequest.componentFamilies ?? [],
      nodes: []
    }]
  };
}

function buildIncrementalUiSectionRequests(
  draftRequest: ReturnType<typeof buildSequentialUiDraftRequests>[number],
  platformOverride: string,
  userRequest: string
) {
  const isMobile = platformOverride === "mobile_app" || /小程序|移动端|手机|app/i.test(userRequest);
  const isDetail = /详情|查看|资料|detail|inspect/i.test(`${userRequest} ${draftRequest.name} ${draftRequest.prompt}`);
  const sections = isMobile
    ? [
      { name: "顶部导航与页面标题", bounds: "x=0,y=0,width=375,height=120", focus: "状态栏/导航标题/返回或辅助入口/页面主标题" },
      { name: "核心内容与数据卡片", bounds: "x=16,y=120,width=343,height=430", focus: "主要信息、卡片列表、图片或图标资产、状态标签，禁止 table" },
      { name: "表单输入与交互控件", bounds: "x=16,y=550,width=343,height=170", focus: "输入框、选择项、上传/搜索/筛选/操作控件，按钮文字居中" },
      { name: "底部主操作与反馈", bounds: "x=16,y=720,width=343,height=76", focus: "主按钮、次操作、提示/错误/安全区反馈" }
    ]
    : isDetail
      ? [
        { name: "页面框架与顶部区域", bounds: "x=0,y=0,width=1440,height=160", focus: "顶部导航、面包屑、页面标题、返回/编辑操作、用户区" },
        { name: "详情概览与状态区域", bounds: "x=240,y=160,width=1120,height=180", focus: "详情对象摘要、状态、价格/库存/更新时间等关键指标；禁止筛选查询区" },
        { name: "详情信息与规格区域", bounds: "x=240,y=340,width=1120,height=520", focus: "商品基础信息、规格参数、描述、图片/状态标签；禁止 table 和商品列表" },
        { name: "页脚操作与辅助反馈", bounds: "x=240,y=860,width=1120,height=120", focus: "编辑、返回、保存、上下架等详情页操作反馈；禁止分页" }
      ]
      : [
      { name: "页面框架与顶部区域", bounds: "x=0,y=0,width=1440,height=160", focus: "顶部导航、面包屑、页面标题、主操作、用户区" },
      { name: "筛选/摘要/工具栏区域", bounds: "x=240,y=160,width=1120,height=180", focus: "筛选条件、摘要指标、工具按钮、状态说明" },
      { name: "主内容区域", bounds: "x=240,y=340,width=1120,height=520", focus: "表格/卡片/详情内容、图标/图片资产、状态标签、空态/加载态" },
      { name: "页脚/分页/辅助反馈", bounds: "x=240,y=860,width=1120,height=120", focus: "分页、批量操作、底部说明、错误/成功反馈" }
    ];
  return sections.map((section, index) => ({
    ...section,
    prompt: [
      draftRequest.prompt,
      "",
      `本次只生成页面「${draftRequest.name}」的第 ${index + 1} 个区块：「${section.name}」。`,
      `区块建议范围：${section.bounds}。`,
      `区块职责：${section.focus}。`,
      "重要：schemaDraft.artboards 只能包含 1 个 artboard；不要生成完整页面；不要重复已完成区块。",
      "输出最外层必须是完整 schemaDraft：{ schemaVersion, intent, platform, artboards:[{ refId,name,width,height,layoutIntent,nodes:[] }] }；不要只返回 section/block/children。",
      "输出必须优先使用 artboard.layoutIntent 描述本区块的语义结构：Section/Stack/Grid/Card/FilterBar/Table/Button/Input/Text/Image 等；不要输出最终像素坐标。",
      "Layout Compiler 只负责布局，不会替你补业务内容；本区块必须包含实际 Text/Button/Input/Card/Table 等语义子节点，不能只输出空 Section/Panel。",
      "需要背景承载时用 Section/Card/Panel；需要横向操作时用 ActionBar/Toolbar；需要表格时用 Table 的 columns/rows；需要筛选时用 FilterBar 的 fields。",
      isDetail ? "详情页硬约束：禁止输出商品列表、列表、Table、FilterBar、分页、查询/筛选条件；必须输出详情概览、基础信息、规格/描述、编辑/返回/保存等详情页结构。" : "",
      "每个区块落盘后系统会立即 schema.validate 和 canvas.capture，因此你要让本区块单独也能被观察和校验。"
    ].filter(Boolean).join("\n")
  }));
}

function inferRequestedPageNames(message: string) {
  const explicitNames = message
    .split(/[，,、；;\n]/)
    .map((item) => item.trim())
    .map((item) => /([\u4e00-\u9fa5A-Za-z0-9_\-\s]{1,24}(?:页面|页))/.exec(item)?.[1]?.trim())
    .filter((item): item is string => Boolean(item));
  if (explicitNames.length > 0) {
    return Array.from(new Set(explicitNames)).slice(0, 6);
  }
  const inferredName = inferPageNameFromMessage(message);
  if (inferredName) {
    return [inferredName];
  }
  const compact = message.replace(/\s+/g, "").slice(0, 18);
  return compact ? [`${compact}页面`] : [];
}

function formatVisualDesignReviewMessage(review: VisualDesignReview) {
  const blocking = review.findings.filter((finding) => finding.severity === "blocking");
  const warnings = review.findings.filter((finding) => finding.severity === "warning");
  return [
    `视觉审核${review.passed ? "通过" : "未通过"}：${review.summary || `评分 ${review.visualQualityScore}/100`}`,
    `平台匹配：${review.platformFit.ok ? "通过" : "不匹配"}，期望 ${review.platformFit.expected || "未指定"}，实际 ${review.platformFit.actual || "未识别"}。${review.platformFit.reason}`,
    `质量评分：${review.visualQualityScore}/100，建议动作：${review.nextAction}`,
    blocking.length > 0 ? `阻塞问题：${blocking.map((item) => `${item.pageLabel ? `${item.pageLabel}：` : ""}${item.issue}${item.evidence ? `（${item.evidence}）` : ""}`).join("；")}` : "",
    warnings.length > 0 ? `警告：${warnings.map((item) => `${item.pageLabel ? `${item.pageLabel}：` : ""}${item.issue}`).join("；")}` : "",
    review.strengths.length > 0 ? `做得还可以的点：${review.strengths.join("；")}` : ""
  ].filter(Boolean).join("\n");
}

function enforceVisualQualityGate(review: VisualDesignReview): VisualDesignReview {
  if (review.visualQualityScore >= 75 && review.platformFit.ok && review.findings.every((finding) => finding.severity !== "blocking")) {
    return review;
  }
  const findings = [...review.findings];
  if (review.visualQualityScore < 75) {
    findings.push({
      severity: "blocking",
      pageLabel: "",
      issue: `视觉质量分 ${review.visualQualityScore}/100，低于基础门槛 75。`,
      evidence: "页面仍可能存在风格弱、粗糙、排版差、缺少视觉资产或组件层级的问题。",
      fixSuggestion: "重新生成或局部修复：补充组件库结构、图标/图片、按钮居中、文本层级和间距。"
    });
  }
  if (!review.platformFit.ok) {
    findings.push({
      severity: "blocking",
      pageLabel: "",
      issue: "平台范式不匹配。",
      evidence: review.platformFit.reason,
      fixSuggestion: "按目标平台组件库重新生成。"
    });
  }
  return {
    ...review,
    passed: false,
    findings,
    nextAction: review.nextAction === "pass" ? "regenerate" : review.nextAction,
    summary: review.summary || "视觉审核未达到基础质量门槛。"
  };
}

function extractVisualPreviewImages(data: unknown): Array<{ label: string; dataUrl: string; width?: number; height?: number; nodeId?: string }> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const previews = (data as Record<string, unknown>).previews;
  if (!Array.isArray(previews)) return [];
  return previews
    .map((item): { label: string; dataUrl: string; width?: number; height?: number; nodeId?: string } | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";
      if (!dataUrl.startsWith("data:image/")) return null;
      const preview: { label: string; dataUrl: string; width?: number; height?: number; nodeId?: string } = {
        label: typeof record.label === "string" ? record.label : "画板预览",
        dataUrl
      };
      if (typeof record.width === "number") preview.width = record.width;
      if (typeof record.height === "number") preview.height = record.height;
      if (typeof record.nodeId === "string") preview.nodeId = record.nodeId;
      return preview;
    })
    .filter((item): item is { label: string; dataUrl: string; width?: number; height?: number; nodeId?: string } => Boolean(item));
}

function formatToolInputBrief(input: Record<string, unknown>) {
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  return `，输入字段：${keys.join("、")}`;
}

function formatDesignAgentError(error: unknown) {
  if (error instanceof StructuredOutputParseError) {
    if (isLikelyTruncatedJsonText(error.extractedJson || error.rawText)) {
      return [
        "Schema Draft 输出不是完整 JSON，疑似模型输出被截断或提前结束。",
        `解析错误：${error.message}`,
        "系统已尝试 JSON 修复和完整重生；如果仍失败，会进入可落盘兜底草案，避免本次完全没有产物。"
      ].join("\n");
    }
    return [
      error.message,
      error.extractedJson ? `模型提取 JSON：${error.extractedJson.slice(0, 1200)}` : "",
      `模型原始输出：${error.rawText.slice(0, 1200)}`
    ].filter(Boolean).join("\n");
  }
  if (error instanceof z.ZodError) {
    return `结构化输出不符合协议：${formatZodIssues(error.issues)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function parseJsonWithSchema<S extends z.ZodTypeAny>(
  schema: S,
  extractedJson: string,
  rawText: string
): { ok: true; value: z.output<S> } | { ok: false; error: z.ZodError } {
  try {
    const parsedJson = JSON.parse(extractedJson);
    const parsed = schema.safeParse(parsedJson);
    if (parsed.success) return { ok: true, value: parsed.data };
    return { ok: false, error: parsed.error };
  } catch (error) {
    const issue = new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: [],
      message: error instanceof Error ? error.message : `JSON parse failed: ${String(error)}`
    }]);
    return { ok: false, error: issue };
  }
}

function formatZodIssues(issues: z.ZodIssue[]) {
  return issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join(".") || "root"} ${issue.message}`)
    .join("；");
}

function isMissingArtboardsError(error: z.ZodError) {
  return error.issues.some((issue) => issue.path.join(".") === "artboards" && /Required|required|undefined/i.test(issue.message));
}

function shouldRegenerateUiSchemaDraftAfterParseFailure(
  originalError: StructuredOutputParseError,
  repairedError: z.ZodError,
  extractedJson: string,
  repairedText: string
) {
  return isMissingArtboardsError(repairedError)
    || isJsonSyntaxZodError(repairedError)
    || isLikelyTruncatedJsonText(originalError.extractedJson || originalError.rawText)
    || isLikelyTruncatedJsonText(extractedJson)
    || isLikelyTruncatedJsonText(repairedText);
}

function isJsonSyntaxZodError(error: z.ZodError) {
  return error.issues.some((issue) => (
    issue.path.length === 0
    && /JSON|Expected ','|Expected '\}'|Unexpected token|Unexpected end|unterminated|parse|after property value/i.test(issue.message)
  ));
}

function isLikelyTruncatedJsonText(text?: string) {
  if (!text?.trim()) return false;
  const cleaned = extractJsonFromModelText(text).trim();
  if (!cleaned) return false;
  if (!/[}\]]$/.test(cleaned)) return true;
  const openCurly = (cleaned.match(/\{/g) ?? []).length;
  const closeCurly = (cleaned.match(/\}/g) ?? []).length;
  const openSquare = (cleaned.match(/\[/g) ?? []).length;
  const closeSquare = (cleaned.match(/\]/g) ?? []).length;
  return closeCurly < openCurly || closeSquare < openSquare;
}

function buildCompactUiSchemaDraftRetryPrompt(userPrompt: string) {
  try {
    const parsed = JSON.parse(userPrompt) as Record<string, unknown>;
    const uiDesignPlan = isRecordLike(parsed.uiDesignPlan)
      ? {
        productGoal: parsed.uiDesignPlan.productGoal,
        pageSpecs: Array.isArray(parsed.uiDesignPlan.pageSpecs)
          ? parsed.uiDesignPlan.pageSpecs.slice(0, 4)
          : undefined,
        qualityBar: parsed.uiDesignPlan.qualityBar,
        reviewChecklist: parsed.uiDesignPlan.reviewChecklist
      }
      : parsed.uiDesignPlan ?? null;
    const pageTemplateMatch = isRecordLike(parsed.pageTemplateMatch)
      ? {
        templateId: parsed.pageTemplateMatch.templateId,
        templateName: parsed.pageTemplateMatch.templateName,
        pageMode: parsed.pageTemplateMatch.pageMode,
        businessEntity: parsed.pageTemplateMatch.businessEntity,
        layoutPattern: parsed.pageTemplateMatch.layoutPattern,
        requiredRegions: parsed.pageTemplateMatch.requiredRegions,
        forbiddenRegions: parsed.pageTemplateMatch.forbiddenRegions,
        regionOrder: parsed.pageTemplateMatch.regionOrder,
        size: parsed.pageTemplateMatch.size,
        styleTokens: parsed.pageTemplateMatch.styleTokens
      }
      : parsed.pageTemplateMatch ?? null;
    return {
      userRequest: parsed.userRequest,
      targetPlatform: parsed.targetPlatform,
      qualityContext: parsed.qualityContext,
      uiDesignPlan,
      pageTemplateMatch,
      schemaContract: parsed.schemaContract,
      retryInstructions: [
        "重新生成完整 schemaDraft，不要修补或续写上次坏 JSON。",
        "只输出 1 个最相关 artboard，除非原始需求明确要求多页面。",
        "layoutIntent 文本用 text 字段，按钮也用 text 字段。",
        "不要输出 content/typography/fill:true 等未注册或类型不稳定字段。",
        "JSON 必须完整闭合。"
      ]
    };
  } catch {
    return {
      userRequest: userPrompt.slice(0, 4000),
      retryInstructions: [
        "重新生成完整 schemaDraft，不要修补或续写上次坏 JSON。",
        "只输出 JSON，必须完整闭合所有对象和数组。"
      ]
    };
  }
}

function buildFallbackUiSchemaDraftAfterSchemaParseFailure(userPrompt: string): UiSchemaDraft | undefined {
  const compact = buildCompactUiSchemaDraftRetryPrompt(userPrompt) as Record<string, unknown>;
  const request = String(compact.userRequest ?? userPrompt).trim();
  if (!request) return undefined;
  const targetPlatform = compact.targetPlatform === "mobile_app" || /小程序|移动端|手机|app/i.test(request) ? "mobile_app" : "web";
  const firstSpec = isRecordLike(compact.uiDesignPlan) && Array.isArray(compact.uiDesignPlan.pageSpecs) && isRecordLike(compact.uiDesignPlan.pageSpecs[0])
    ? compact.uiDesignPlan.pageSpecs[0]
    : undefined;
  const templateContract = isRecordLike(compact.pageTemplateMatch) && isRecordLike(compact.pageTemplateMatch.templateContract)
    ? compact.pageTemplateMatch.templateContract
    : undefined;
  const pageMode = normalizeFallbackPageMode(
    String(firstSpec?.pageMode ?? templateContract?.pageMode ?? inferPageModeForFallback(String(firstSpec?.name ?? ""), request))
  );
  const businessEntity = String(firstSpec?.businessEntity ?? templateContract?.businessEntity ?? inferBusinessEntityFromUserRequest(request) ?? "").trim();
  const title = String(firstSpec?.name ?? inferPageTitleFromRequest(request, businessEntity, pageMode)).trim();
  const requiredRegions = normalizeFallbackRegions(
    Array.isArray(firstSpec?.requiredRegions) && firstSpec.requiredRegions.length > 0
      ? firstSpec.requiredRegions
      : Array.isArray(templateContract?.requiredRegions) && templateContract.requiredRegions.length > 0
        ? templateContract.requiredRegions
        : inferRequiredRegionsForPatch(request)
  );
  const forbiddenRegions = normalizeFallbackRegions(
    Array.isArray(firstSpec?.forbiddenRegions) && firstSpec.forbiddenRegions.length > 0
      ? firstSpec.forbiddenRegions
      : Array.isArray(templateContract?.forbiddenRegions)
        ? templateContract.forbiddenRegions
        : defaultForbiddenRegionsForFallbackPageMode(pageMode)
  );
  const width = targetPlatform === "mobile_app" ? 375 : 1440;
  const height = targetPlatform === "mobile_app" ? 812 : 1024;
  const layoutIntentChildren = requiredRegions
    .filter((region) => !forbiddenRegions.map(normalizeFallbackRegionName).includes(normalizeFallbackRegionName(region)))
    .map((region) => createFallbackLayoutIntentRegion(region, businessEntity || "业务对象", request, targetPlatform));
  const draft: UiSchemaDraft = {
    schemaVersion: "aipm.design.schema.v1",
    intent: request,
    platform: targetPlatform,
    designRationale: [
      "模型连续输出不完整 JSON，系统使用原始需求和页面契约生成可落盘的最小 layoutIntent。",
      "该兜底草案只负责不中断流程，后续 review/critic/patch 会继续补齐内容和修复布局。"
    ],
    artboards: [{
      refId: "fallback-schema-draft-1",
      name: title,
      width,
      height,
      layout: pageMode,
      pageMode,
      businessEntity,
      layoutPattern: targetPlatform === "mobile_app"
        ? pageMode === "form" ? "mobileForm" : pageMode === "detail" ? "mobileDetail" : "mobileList"
        : pageMode === "form" ? "pcForm" : pageMode === "detail" ? "pcDetail" : pageMode === "dashboard" ? "pcDashboard" : "pcTable",
      requiredRegions,
      forbiddenRegions,
      componentFamilies: inferFallbackComponentFamilies(pageMode, targetPlatform),
      layoutIntent: {
        type: "Page",
        title,
        layout: targetPlatform === "mobile_app" ? "singleColumn" : pageMode === "collection" ? "table" : "singleColumn",
        density: "comfortable",
        padding: targetPlatform === "mobile_app" ? "md" : "lg",
        children: layoutIntentChildren.length > 0
          ? layoutIntentChildren
          : [createFallbackLayoutIntentRegion("DescriptionList", businessEntity || "业务对象", request, targetPlatform)]
      },
      nodes: []
    }]
  };
  return draft;
}

function normalizeFallbackPageMode(value: string): "collection" | "detail" | "form" | "dashboard" | "auth" | "settings" | "flow" | "landing" | "unknown" {
  if (["collection", "detail", "form", "dashboard", "auth", "settings", "flow", "landing", "unknown"].includes(value)) {
    return value as ReturnType<typeof normalizeFallbackPageMode>;
  }
  return "unknown";
}

function normalizeFallbackRegions(values: unknown[]) {
  return Array.from(new Set(values.map(String).map((item) => item.trim()).filter(Boolean)));
}

function normalizeFallbackRegionName(region: string) {
  if (/header|toolbar|头部|标题|导航/i.test(region)) return "Header";
  if (/summary|metric|摘要|统计|指标|状态/i.test(region)) return "Summary";
  if (/filter|search|query|筛选|搜索|查询/i.test(region)) return "FilterBar";
  if (/description|detail|详情|明细|资料|信息/i.test(region)) return "DescriptionList";
  if (/form|input|表单|字段|输入/i.test(region)) return "Form";
  if (/table|表格/i.test(region)) return "Table";
  if (/cardlist|list|列表/i.test(region)) return "CardList";
  if (/pagination|分页/i.test(region)) return "Pagination";
  if (/steps|timeline|流程|步骤/i.test(region)) return "Steps";
  if (/action|button|操作|按钮/i.test(region)) return "ActionBar";
  return region;
}

function defaultForbiddenRegionsForFallbackPageMode(pageMode: string) {
  if (pageMode === "detail") return ["FilterBar", "Table", "Pagination"];
  if (pageMode === "form" || pageMode === "auth") return ["Table", "Pagination"];
  return [];
}

function inferPageTitleFromRequest(request: string, businessEntity: string, pageMode: string) {
  const explicit = /生成\s*([^，。；\n]+?页)/.exec(request)?.[1] || /([^，。；\n]{2,18}页)/.exec(request)?.[1];
  if (explicit) return explicit.trim();
  if (businessEntity) {
    if (pageMode === "detail") return `${businessEntity}详情页`;
    if (pageMode === "form") return `${businessEntity}表单页`;
    if (pageMode === "collection") return `${businessEntity}列表页`;
  }
  return "生成页面";
}

function inferFallbackComponentFamilies(pageMode: string, platform: "web" | "mobile_app") {
  const families = platform === "mobile_app" ? ["mobile-page-shell", "mobile-card"] : ["pc-page-shell", "antd-data-display"];
  if (pageMode === "detail") families.push("description-list", "action-bar");
  if (pageMode === "form") families.push("form-controls", "action-bar");
  if (pageMode === "collection") families.push(platform === "mobile_app" ? "card-list" : "data-table");
  if (pageMode === "flow") families.push("steps");
  return families;
}

function createFallbackLayoutIntentRegion(
  region: string,
  entity: string,
  request: string,
  platform: "web" | "mobile_app"
): NonNullable<UiSchemaDraft["artboards"][number]["layoutIntent"]> {
  const normalized = normalizeFallbackRegionName(region);
  if (normalized === "Header") {
    return {
      type: "Toolbar",
      slot: "header",
      align: "between",
      gap: "md",
      children: [
        { type: "Text", text: inferPageTitleFromRequest(request, entity, inferPageModeForFallback("", request)), emphasis: "high" },
        { type: "ActionBar", children: [{ type: "Button", text: platform === "mobile_app" ? "返回" : "返回", priority: "secondary" }] }
      ]
    };
  }
  if (normalized === "Summary") {
    return {
      type: "MetricGroup",
      slot: "summary",
      metrics: [
        { label: `${entity}状态`, value: "正常" },
        { label: "更新时间", value: "2026-05-16" },
        { label: "负责人", value: "负责人 A" }
      ]
    };
  }
  if (normalized === "FilterBar") {
    return {
      type: "FilterBar",
      slot: "filter",
      children: [
        { type: "Input", label: "关键词", text: "请输入关键词" },
        { type: "Select", label: "状态", options: ["全部", "启用", "停用"] },
        { type: "Button", text: "查询", priority: "primary" },
        { type: "Button", text: "重置", priority: "secondary" }
      ]
    };
  }
  if (normalized === "Table") {
    return {
      type: "Table",
      slot: "content",
      columns: [`${entity}名称`, "状态", "更新时间", "操作"],
      rows: [
        [`${entity} A`, "正常", "2026-05-16", "查看"],
        [`${entity} B`, "待处理", "2026-05-15", "查看"]
      ]
    };
  }
  if (normalized === "CardList") {
    return {
      type: "CardList",
      slot: "content",
      children: [
        { type: "ListItem", title: `${entity} A`, text: "状态正常 / 2026-05-16" },
        { type: "ListItem", title: `${entity} B`, text: "待处理 / 2026-05-15" }
      ]
    };
  }
  if (normalized === "Form") {
    return {
      type: "Form",
      slot: "content",
      fields: [`${entity}名称`, `${entity}类型`, "状态", "备注"],
      children: [
        { type: "Input", label: `${entity}名称`, text: `请输入${entity}名称` },
        { type: "Select", label: "状态", options: ["启用", "停用"] }
      ]
    };
  }
  if (normalized === "Steps") {
    return {
      type: "Steps",
      slot: "content",
      items: ["已提交", "处理中", "已完成"]
    };
  }
  if (normalized === "Pagination") {
    return {
      type: "Pagination",
      slot: "footer",
      children: [
        { type: "Text", text: "共 128 条", tone: "muted" },
        { type: "Button", text: "上一页", priority: "secondary" },
        { type: "Button", text: "下一页", priority: "secondary" }
      ]
    };
  }
  if (normalized === "ActionBar") {
    return {
      type: "ActionBar",
      slot: "actions",
      align: "end",
      children: [
        { type: "Button", text: "取消", priority: "secondary" },
        { type: "Button", text: "确认", priority: "primary" }
      ]
    };
  }
  return {
    type: "DescriptionList",
    slot: "detail",
    items: [
      { label: `${entity}编号`, value: "ID-20260516-001" },
      { label: `${entity}名称`, value: `${entity}名称` },
      { label: "当前状态", value: "正常" },
      { label: "创建时间", value: "2026-05-16" },
      { label: "备注", value: "用于展示核心详情信息" }
    ]
  };
}

function isReviewTool(tool: DesignAgentToolCall["tool"]) {
  return tool === "ui.review" || tool === "ui.review_design" || tool === "ui.critic_review";
}

function isRetryableJsonParseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /JSON|Expected ','|Expected '\}'|Unexpected token|Unexpected end|unterminated|parse/i.test(message);
}

function getDesignAgentEventContent(event: DesignAgentStreamEvent) {
  switch (event.type) {
    case "message":
      return event.content;
    case "llm_delta":
      return event.delta;
    case "plan":
      return [event.title, ...event.steps].join("\n");
    case "tool_call_start":
      return `准备执行：${event.toolName}`;
    case "tool_call_result":
      return `${event.success ? "成功" : "失败"} ${event.toolName}：${event.message}`;
    case "schema_patch":
      return `schema patch：${event.action}，节点数 ${event.nodeCount ?? "未知"}`;
    case "review":
      return event.message;
    case "done":
      return event.summary;
    case "error":
      return event.message;
  }
}

function stripLargeDesignEventPayload(event: DesignAgentStreamEvent) {
  if (event.type === "tool_call_result") {
    return {
      ...event,
      result: stripLargePreviewPayload(event.result)
    };
  }
  if (event.type !== "schema_patch" && event.type !== "done") {
    return event;
  }
  return {
    ...event,
    file: event.file ? { id: event.file.id, name: event.file.name, pageCount: event.file.pages.length } : undefined,
    page: event.page ? { id: event.page.id, name: event.page.name, nodeCount: event.page.nodes.length } : undefined
  };
}

function stripLargePreviewPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.previews)) return value;
  return {
    ...record,
    previews: record.previews.map((preview) => {
      if (!preview || typeof preview !== "object" || Array.isArray(preview)) return preview;
      const previewRecord = preview as Record<string, unknown>;
      return {
        ...previewRecord,
        dataUrl: typeof previewRecord.dataUrl === "string" && previewRecord.dataUrl.length > 1_200_000
          ? `[data-url ${previewRecord.dataUrl.length} chars]`
          : previewRecord.dataUrl
      };
    })
  };
}

function extractPreviewImagesFromEventMetadata(metadata: Record<string, unknown>) {
  const eventResult = metadata.result;
  if (!eventResult || typeof eventResult !== "object" || Array.isArray(eventResult)) {
    return undefined;
  }
  const previews = (eventResult as Record<string, unknown>).previews;
  if (!Array.isArray(previews)) {
    return undefined;
  }
  const images = previews
    .map((preview) => {
      if (!preview || typeof preview !== "object" || Array.isArray(preview)) return null;
      const record = preview as Record<string, unknown>;
      const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";
      if (!dataUrl.startsWith("data:image/")) return null;
      return {
        label: typeof record.label === "string" ? record.label : "画板预览",
        dataUrl
      };
    })
    .filter((preview): preview is { label: string; dataUrl: string } => Boolean(preview));
  return images.length > 0 ? images : undefined;
}

function createAgentRunId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractJsonFromModelText(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    const start = Math.min(
      ...[cleaned.indexOf("{"), cleaned.indexOf("[")].filter((index) => index >= 0)
    );
    const objectEnd = cleaned.lastIndexOf("}");
    const arrayEnd = cleaned.lastIndexOf("]");
    const end = Math.max(objectEnd, arrayEnd);
    if (Number.isFinite(start) && start >= 0 && end > start) {
      return cleaned.slice(start, end + 1);
    }
    return cleaned;
  }
}

function classifyDesignAgentTask(message: string) {
  const needUIAgent = /页面|UI|设计|排版|风格|布局|好看|原型|组件|后台|表单|表格|菜单|卡片|导航|视觉|优化/.test(message);
  const needSchemaTools = /新增|添加|插入|修改|调整|删除|复制|生成|创建|重命名|移动|改成|换成|加一个|加个/.test(message);
  const needCurrentSchema = needSchemaTools || /当前|这个|页面|节点|schema|画布|选中/.test(message);
  const needScreenshot = /截图|画布|看起来|预览|识别|参考图|图片/.test(message);
  const needSearch = /联网|搜索|素材|竞品|参考|官网|网页|sketch/.test(message);
  return {
    taskType: needUIAgent ? "ui_design" : needSchemaTools ? "schema_operation" : "answer",
    needUIAgent,
    needSchemaTools,
    needCurrentSchema,
    needScreenshot,
    needSearch
  };
}

function buildDesignQualityContext(message: string) {
  const platform = /小程序|微信/.test(message)
    ? "wechat_mini_program"
    : /app|移动端|手机|ios|android/i.test(message)
      ? "mobile_app"
      : /响应式|responsive/i.test(message)
        ? "responsive_web"
        : "pc_web";
  const platformLabel = {
    pc_web: "PC Web",
    wechat_mini_program: "微信小程序",
    mobile_app: "移动 App",
    responsive_web: "响应式 Web"
  }[platform];
  const industry = /电商|商品|订单|购物|支付|优惠券|营销/.test(message)
    ? "电商/交易"
    : /iot|设备|物联|传感器|告警|能耗|监控/i.test(message)
      ? "IoT/设备管理"
      : /司机|乘客|路线|收益|出行|地图/.test(message)
        ? "出行/本地服务"
        : /任务|项目|协作|团队/.test(message)
          ? "协作/项目管理"
          : /用户|登录|注册|实名|地址|账号/.test(message)
            ? "用户账号体系"
            : "通用业务";
  const interactionTypes = [
    /登录|注册|验证码|绑定/.test(message) ? "登录注册" : "",
    /表单|填写|编辑|新增|保存|设置/.test(message) ? "表单录入" : "",
    /列表|记录|订单|消息|管理/.test(message) ? "列表管理" : "",
    /详情|资料|个人信息|产品详情/.test(message) ? "详情查看" : "",
    /上传|身份证|人脸|实名/.test(message) ? "上传认证" : "",
    /地图|地址|选址|定位/.test(message) ? "地图选址" : "",
    /支付|收益|提现|优惠券|营销/.test(message) ? "交易/收益" : "",
    /设备|告警|监控|趋势/.test(message) ? "状态监控" : ""
  ].filter(Boolean);
  const referenceSystems = platform === "wechat_mini_program"
    ? ["微信小程序官方组件", "iOS/Android 移动端表单模式", "Tailwind 卡片层级"]
    : platform === "mobile_app"
      ? ["iOS Human Interface Guidelines", "Material Design", "移动端卡片/表单模式"]
      : ["Ant Design Pro", "Tailwind SaaS Dashboard", "企业后台信息密度规范"];
  const qualityBar = platform === "pc_web"
    ? [
      "PC 以 1440x1024 或 1920 宽屏信息架构为基准",
      "表格/筛选/操作区必须分层，不允许遮挡",
      "主按钮、次按钮、状态标签和空状态必须明确"
    ]
    : [
      "移动端逻辑宽度 375，单列布局，不允许 PC 表格",
      "卡片与表单必须有 16-24px 安全边距",
      "列表项内容必须拆成独立文本，禁止多字段挤压重叠",
      "底部主操作避开安全区，状态/错误/空态必须可见"
    ];
  const referenceContext = getDesignReferenceContext(message, platform);
  return {
    platform,
    platformLabel,
    industry,
    interactionTypes: interactionTypes.length > 0 ? interactionTypes : ["信息浏览", "主操作"],
    referenceSystems,
    qualityBar,
    designReferences: referenceContext
  };
}

function compactDesignQualityContextForSchema(context: ReturnType<typeof buildDesignQualityContext>) {
  return {
    platform: context.platform,
    platformLabel: context.platformLabel,
    industry: context.industry,
    interactionTypes: context.interactionTypes,
    referenceSystems: context.referenceSystems,
    qualityBar: context.qualityBar,
    designReferences: {
      matchedReferenceIds: context.designReferences.matchedReferenceIds,
      rules: context.designReferences.rules.slice(0, 8),
      references: context.designReferences.references.map((reference) => ({
        id: reference.id,
        name: reference.name,
        category: reference.category,
        page: reference.page,
        layout: reference.layout,
        styleTokens: reference.styleTokens,
        nodeStats: reference.nodeStats,
        keyTexts: reference.keyTexts.slice(0, 12),
        guidance: reference.guidance.slice(0, 4)
      }))
    }
  };
}

function extractPathLikeText(message: string) {
  return /(?:path|文件|图片|imagePath)[:：]?\s*([^\s，。]+)/i.exec(message)?.[1];
}

function formatDesignPagesReply(file: WorkspaceDesignFile) {
  if (file.pages.length === 0) {
    return "当前设计文件里还没有页面。";
  }
  return `当前共有 ${file.pages.length} 个页面：\n${file.pages.map((page, index) => `${index + 1}. ${page.name}（${page.nodeCount ?? page.nodes.length} 个节点）`).join("\n")}`;
}

function formatDesignSchemaReply(page?: WorkspaceDesignPage) {
  if (!page) {
    return "当前没有选中页面。";
  }
  return [
    `当前页面：${page.name}`,
    `节点数量：${page.nodes.length}`,
    `主要节点：${page.nodes.slice(0, 12).map((node) => `${node.name}/${node.type}`).join("、") || "暂无节点"}`
  ].join("\n");
}

function summarizeDesignPageForPrompt(page: WorkspaceDesignPage) {
  return {
    id: page.id,
    name: page.name,
    nodeCount: page.nodes.length,
    nodes: page.nodes.slice(0, 80).map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      text: node.text
    }))
  };
}

function summarizeDesignPageForSchemaPrompt(page: WorkspaceDesignPage) {
  const topLevelNodes = page.nodes.filter((node) => !node.parentId).slice(0, 12);
  return {
    id: page.id,
    name: page.name,
    nodeCount: page.nodes.length,
    topLevelNodes: topLevelNodes.map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height
    })),
    nodeTypeStats: page.nodes.reduce<Record<string, number>>((result, node) => {
      result[node.type] = (result[node.type] ?? 0) + 1;
      return result;
    }, {})
  };
}

function summarizeLocalComponentLibraries(file: WorkspaceDesignFile) {
  const localComponents = (file.importedComponents ?? []).filter((component) => component.sourceFileName === "本地组件集合");
  const libraries = (file.componentLibraries ?? []).length > 0
    ? file.componentLibraries ?? []
    : localComponents.length > 0
      ? [{ id: "__default_local_components__", name: "本地组件库", description: "项目本地组件资产", createdAt: "", updatedAt: "" }]
      : [];
  return libraries.map((library) => {
    const components = localComponents.filter((component) => component.libraryId === library.id);
    const libraryComponents = components.length > 0 || library.id !== "__default_local_components__"
      ? components
      : localComponents;
    return {
      id: library.id,
      name: library.name,
      description: library.description ?? "",
      componentCount: libraryComponents.length,
      styleReference: inferLocalComponentStyleReference(libraryComponents),
      components: libraryComponents.slice(0, 30).map((component) => ({
        id: component.id,
        name: component.name,
        description: component.description ?? "",
        nodeCount: component.nodeCount,
        nodeTypes: Array.from(new Set(component.nodes.map((node) => node.type))).slice(0, 12),
        aliases: inferLocalComponentAliases(component),
        size: summarizeNodeBounds(component.nodes),
        keyTexts: component.nodes
          .map((node) => node.text || node.name)
          .filter(Boolean)
          .slice(0, 10)
      }))
    };
  });
}

function summarizePageTemplatesForAgent(file: WorkspaceDesignFile) {
  return (file.pageTemplates ?? []).slice(0, 12).map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    sourcePageId: template.sourcePageId,
    sourceFrameId: template.sourceFrameId,
    sourceFileName: template.sourceFileName,
    nodeCount: template.nodeCount,
    size: { width: Math.round(template.width), height: Math.round(template.height) },
    platform: template.styleProfile.platform,
    styleProfile: template.styleProfile,
    structureSummary: summarizeTemplateStructure(template.nodes),
    keyTexts: template.nodes
      .map((node) => node.text || node.name)
      .filter(Boolean)
      .filter((text, index, array) => array.indexOf(text) === index)
      .slice(0, 24)
  }));
}

function selectPageTemplateContractForPrompt(
  pageTemplates: ReturnType<typeof summarizePageTemplatesForAgent>,
  userRequest: string,
  targetPlatform: "web" | "mobile_app",
  uiDesignPlan?: UiDesignerPlan
) {
  if (pageTemplates.length === 0) return null;
  const firstSpec = uiDesignPlan?.pageSpecs?.[0];
  const targetMode = firstSpec?.pageMode && firstSpec.pageMode !== "unknown"
    ? firstSpec.pageMode
    : inferPageModeForFallback(firstSpec?.name ?? "", userRequest);
  const targetPlatformName = targetPlatform === "mobile_app" ? "mobile" : "web";
  const requestTokens = new Set(tokenizeTemplatePromptText(`${userRequest} ${firstSpec?.name ?? ""} ${firstSpec?.businessEntity ?? ""}`));
  const ranked = pageTemplates.map((template) => {
    const regions = Array.isArray(template.structureSummary.semanticRegions) ? template.structureSummary.semanticRegions : [];
    const templateText = [
      template.name,
      template.description,
      template.keyTexts.join(" ")
    ].join(" ").toLowerCase();
    const templateTokens = new Set(tokenizeTemplatePromptText(templateText));
    const overlap = Array.from(requestTokens).filter((token) => templateTokens.has(token)).length;
    let score = 0;
    const reasons: string[] = [];
    if (template.platform === targetPlatformName) {
      score += 35;
      reasons.push("平台匹配");
    } else if (template.platform === "unknown") {
      score += 8;
      reasons.push("模板平台未知");
    } else {
      score -= 12;
      reasons.push("平台不一致，仅参考风格");
    }
    const inferredTemplateMode = inferPageModeFromTemplateRegions(regions);
    if (targetMode !== "unknown" && inferredTemplateMode === targetMode) {
      score += 30;
      reasons.push(`页面模式匹配 ${targetMode}`);
    }
    if (overlap > 0) {
      score += Math.min(24, overlap * 4);
      reasons.push(`关键词命中 ${overlap} 个`);
    }
    return { template, score, reasons, inferredTemplateMode, regions };
  }).sort((first, second) => second.score - first.score);
  const best = ranked[0];
  if (!best || best.score <= 0) return null;
  const contractMode = targetMode !== "unknown" ? targetMode : best.inferredTemplateMode;
  const regionOrder = normalizePromptTemplateRegions(best.regions).filter((region) => shouldInheritPromptTemplateRegionForPageMode(region, contractMode));
  return {
    matchedTemplate: {
      id: best.template.id,
      name: best.template.name,
      score: best.score,
      reasons: best.reasons,
      platformPolicy: best.template.platform === targetPlatformName || best.template.platform === "unknown" ? "full" : "style-only"
    },
    templateContract: {
      dimensions: best.template.platform === targetPlatformName || best.template.platform === "unknown" ? best.template.size : undefined,
      pageMode: contractMode,
      requiredRegions: mergePromptRegions(defaultRequiredRegionsForPromptMode(contractMode), regionOrder),
      forbiddenRegions: defaultForbiddenRegionsForPromptMode(contractMode),
      regionOrder,
      styleTokens: {
        colors: best.template.styleProfile.colors,
        typography: best.template.styleProfile.typography,
        spacing: best.template.styleProfile.spacing,
        radius: best.template.styleProfile.radius,
        components: best.template.styleProfile.components
      }
    }
  };
}

function summarizeTemplateStructure(nodes: WorkspaceDesignNode[]) {
  const visibleNodes = nodes.filter((node) => node.visible !== false);
  const topLevelNodes = visibleNodes
    .filter((node) => !node.parentId)
    .slice(0, 8)
    .map((node) => ({
      type: node.type,
      name: node.name,
      width: Math.round(node.width),
      height: Math.round(node.height)
    }));
  const sectionCandidates = visibleNodes
    .filter((node) => node.type === "frame" || node.type === "container" || node.type === "card" || node.type === "table")
    .sort((first, second) => first.y - second.y || first.x - second.x)
    .slice(0, 16)
    .map((node) => ({
      type: node.type,
      name: node.name,
      text: node.text ?? "",
      x: Math.round(node.x),
      y: Math.round(node.y),
      width: Math.round(node.width),
      height: Math.round(node.height)
    }));
  const semanticRegions = Array.from(new Set(visibleNodes.flatMap((node) => inferTemplateSemanticRegions(node)))).slice(0, 16);
  return {
    nodeTypeStats: visibleNodes.reduce<Record<string, number>>((result, node) => {
      result[node.type] = (result[node.type] ?? 0) + 1;
      return result;
    }, {}),
    topLevelNodes,
    sectionCandidates,
    semanticRegions,
    density: {
      textCount: visibleNodes.filter((node) => node.type === "text" || Boolean(node.text)).length,
      buttonCount: visibleNodes.filter((node) => node.type === "button").length,
      inputCount: visibleNodes.filter((node) => node.type === "input").length,
      tableCount: visibleNodes.filter((node) => node.type === "table").length,
      cardLikeCount: visibleNodes.filter((node) => node.type === "card" || /card|卡片|面板|panel/i.test(`${node.name} ${node.text ?? ""}`)).length
    }
  };
}

function inferPageModeFromTemplateRegions(regions: string[]): z.infer<typeof pageModeSchema> {
  const text = regions.join(" ");
  if (/Table|List|FilterBar/i.test(text)) return "collection";
  if (/Form/i.test(text)) return "form";
  if (/DescriptionList|Detail/i.test(text)) return "detail";
  if (/Timeline|Steps/i.test(text)) return "flow";
  if (/Summary|Metric/i.test(text)) return "dashboard";
  return "unknown";
}

function normalizePromptTemplateRegions(regions: string[]) {
  return Array.from(new Set(regions.map((region) => {
    if (/Header|NavBar/i.test(region)) return "Header";
    if (/Summary|Metric/i.test(region)) return "Summary";
    if (/FilterBar/i.test(region)) return "FilterBar";
    if (/Form/i.test(region)) return "Form";
    if (/DescriptionList/i.test(region)) return "DescriptionList";
    if (/Table/i.test(region)) return "Table";
    if (/List/i.test(region)) return "CardList";
    if (/ActionBar|Button/i.test(region)) return "ActionBar";
    if (/Timeline|Steps/i.test(region)) return "Steps";
    if (/Footer|Pagination/i.test(region)) return "Pagination";
    return "";
  }).filter(Boolean)));
}

function shouldInheritPromptTemplateRegionForPageMode(region: string, mode: string) {
  if (mode === "detail") return !["Table", "CardList", "FilterBar", "Pagination"].includes(region);
  if (mode === "form" || mode === "auth") return !["Table", "CardList", "Pagination"].includes(region);
  if (mode === "collection") return !["DescriptionList", "DetailPanel"].includes(region);
  return !["Table", "Pagination"].includes(region);
}

function defaultRequiredRegionsForPromptMode(mode: string) {
  if (mode === "collection") return ["Header", "Content"];
  if (mode === "detail") return ["Header", "DescriptionList"];
  if (mode === "form") return ["Form", "ActionBar"];
  if (mode === "dashboard") return ["Summary", "Content"];
  if (mode === "auth") return ["Form", "ActionBar"];
  if (mode === "flow") return ["Steps", "ActionBar"];
  return ["Content"];
}

function defaultForbiddenRegionsForPromptMode(mode: string) {
  if (mode === "detail") return ["FilterBar", "Table", "Pagination"];
  if (mode === "collection") return ["DescriptionList", "DetailPanel"];
  if (mode === "form" || mode === "auth") return ["Table", "Pagination"];
  return [];
}

function mergePromptRegions(...lists: string[][]) {
  return Array.from(new Set(lists.flat().filter(Boolean)));
}

function tokenizeTemplatePromptText(value: string) {
  const normalized = value.toLowerCase();
  const parts = normalized.split(/[\s,，、;；/|:：()[\]{}"'`]+/).filter(Boolean);
  const chinese = normalized.match(/[\u4e00-\u9fff]{2,8}/g) ?? [];
  return Array.from(new Set([...parts, ...chinese].map((part) => part.trim()).filter((part) => part.length >= 2))).slice(0, 80);
}

function inferTemplateSemanticRegions(node: WorkspaceDesignNode) {
  const label = `${node.type} ${node.name} ${node.text ?? ""}`;
  const regions: string[] = [];
  if (/nav|navbar|顶部|导航|标题栏|header/i.test(label)) regions.push("Header/NavBar");
  if (/summary|metric|统计|指标|摘要|状态/i.test(label)) regions.push("Summary/Metric");
  if (/filter|search|query|筛选|搜索|查询/i.test(label)) regions.push("FilterBar");
  if (/form|field|input|表单|字段|输入|上传/i.test(label) || node.type === "input") regions.push("Form");
  if (/detail|description|详情|信息|资料|明细/i.test(label)) regions.push("DescriptionList");
  if (/table|列表|表格|数据/i.test(label) || node.type === "table") regions.push("Table/List");
  if (/action|button|操作|按钮|保存|提交|确认|取消|返回/i.test(label) || node.type === "button") regions.push("ActionBar/Button");
  if (/timeline|steps|流程|步骤|进度|物流/i.test(label)) regions.push("Timeline/Steps");
  if (/footer|底部|页脚/i.test(label)) regions.push("Footer");
  return regions;
}

function summarizeNodeBounds(nodes: WorkspaceDesignNode[]) {
  if (nodes.length === 0) return { width: 1, height: 1 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return { width: Math.max(1, Math.round(maxX - minX)), height: Math.max(1, Math.round(maxY - minY)) };
}

function inferLocalComponentStyleReference(components: WorkspaceDesignComponent[]) {
  const nodes = components.flatMap((component) => component.nodes).filter((node) => node.visible !== false);
  return {
    fills: topValues(nodes.map((node) => node.fill).filter(isUsefulStyleValue), 8),
    strokes: topValues(nodes.map((node) => node.stroke).filter(isUsefulStyleValue), 6),
    textColors: topValues(nodes.map((node) => node.textColor).filter(isUsefulStyleValue), 6),
    fontSizes: topNumericValues(nodes.map((node) => node.fontSize), 6),
    radii: topNumericValues(nodes.map((node) => node.radius), 6),
    shadows: topValues(nodes.map((node) => node.shadow).filter(isUsefulStyleValue), 4),
    controlHeights: topNumericValues(nodes.filter((node) => node.type === "button" || node.type === "input").map((node) => node.height), 6),
    buttonHeights: topNumericValues(nodes.filter((node) => node.type === "button").map((node) => node.height), 4),
    inputHeights: topNumericValues(nodes.filter((node) => node.type === "input").map((node) => node.height), 4),
    tableSizes: nodes
      .filter((node) => node.type === "table")
      .slice(0, 4)
      .map((node) => ({ width: Math.round(node.width), height: Math.round(node.height) })),
    componentDensity: components.slice(0, 12).map((component) => ({
      name: component.name,
      nodeCount: component.nodeCount,
      size: summarizeNodeBounds(component.nodes)
    }))
  };
}

function isUsefulStyleValue(value: string | undefined): value is string {
  const text = value?.trim();
  return Boolean(text && text !== "transparent" && text !== "none" && !/^rgba?\([^)]*,\s*0(?:\.0+)?\)$/i.test(text));
}

function topValues(values: string[], limit: number) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return Array.from(counts.entries())
    .sort((first, second) => second[1] - first[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function topNumericValues(values: Array<number | undefined>, limit: number) {
  const counts = new Map<number, number>();
  values
    .filter((value): value is number => Number.isFinite(value))
    .map((value) => Math.round(value))
    .forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return Array.from(counts.entries())
    .sort((first, second) => second[1] - first[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function inferLocalComponentAliases(component: WorkspaceDesignComponent) {
  const aliases = new Set<string>();
  const text = [component.name, component.description ?? "", ...component.nodes.flatMap((node) => [node.type, node.name, node.text ?? ""])].join(" ");
  component.nodes.forEach((node) => {
    if (node.type === "table") ["表格", "数据表", "列表", "table"].forEach((item) => aliases.add(item));
    if (node.type === "input") ["输入框", "搜索框", "查询条件", "input"].forEach((item) => aliases.add(item));
    if (node.type === "button") ["按钮", "操作按钮", "button"].forEach((item) => aliases.add(item));
    if (/状态|标签|tag|上架|下架|启用|停用|审核/.test(`${node.name} ${node.text ?? ""}`)) ["状态", "状态标签", "tag", "status"].forEach((item) => aliases.add(item));
  });
  if (/查询|搜索|筛选/.test(text)) ["查询区", "搜索区", "筛选区"].forEach((item) => aliases.add(item));
  if (/分页|上一页|下一页/.test(text)) ["分页", "pagination"].forEach((item) => aliases.add(item));
  return Array.from(aliases).slice(0, 20);
}

function createInitialWorkspaceDesignFile(projectName: string): WorkspaceDesignFile {
  const now = nowIso();
  return {
    id: createDesignId("design"),
    name: `${projectName} AI Design`,
    prdText: "这里承载当前项目的 PRD 草稿。后续 AI 会根据 PRD 生成页面清单、UI Schema 和可编辑画布。",
    updatedAt: now,
    componentLibraries: [],
    pageTemplates: [],
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
  const isVectorContainer = isSketchVectorContainerLayer(layer);
  if (!isVectorContainer || childLayers.length === 0) {
    return node;
  }
  if (shouldRenderSketchLayerAsPaintedBox(layer)) {
    return node;
  }
  if (node.svgPath) {
    return node;
  }

  // Sketch vector containers describe the composed vector through children.
  // Drawing their frame as a filled rectangle creates black blocks.
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
  const ownStyle = safeObject(layer.style);
  if (hasRenderableSketchStyle(ownStyle)) {
    return layer;
  }
  return {
    ...layer,
    style: mergeSketchStyles(inheritedStyle, ownStyle)
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

function getSketchLayers(layer: unknown): AnyLayer[] {
  if (!layer || typeof layer !== "object") {
    return [];
  }
  return toArray((layer as { layers?: unknown }).layers)
    .filter((child): child is AnyLayer => Boolean(child) && typeof child === "object");
}

function getSketchRenderableLayers(layer: unknown): AnyLayer[] {
  return getSketchLayers(layer);
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

function collectMissingSketchGradientNodes(
  pageLike: unknown,
  existingNodes: WorkspaceDesignNode[],
  context: {
    assetByRef?: Map<string | undefined, WorkspaceDesignAsset>;
  }
) {
  const existingSourceIds = new Set(existingNodes.map((node) => node.sourceLayerId).filter(Boolean));
  const fallbackNodes: WorkspaceDesignNode[] = [];
  const visit = (
    layer: Record<string, unknown>,
    state: { parentX: number; parentY: number; depth: number; parentZIndex: number }
  ) => {
    if (layer.isVisible === false || shouldSkipSketchLayer(layer)) {
      return;
    }
    const layerId = getStringProp(layer, "do_objectID");
    const layerClass = getStringProp(layer, "_class");
    const frame = readSketchFrame(layer);
    const nodeX = state.parentX + frame.x;
    const nodeY = state.parentY + frame.y;
    const nodeWidth = Math.max(1, Math.round(frame.width));
    const nodeHeight = Math.max(1, Math.round(frame.height));
    if (layerId && !existingSourceIds.has(layerId) && hasSketchGradientFill(layer)) {
      const fill = readSketchFill(layer, "container", context.assetByRef);
      if (fill.includes("gradient(")) {
        const nodeType = mapSketchLayerType(layerClass, getStringProp(layer, "name"));
        fallbackNodes.push(createDesignNode(nodeType, {
          id: createDesignId("import-node"),
          depth: state.depth,
          name: getStringProp(layer, "name") || defaultDesignNodeName(nodeType),
          x: Math.round(nodeX),
          y: Math.round(nodeY),
          width: nodeWidth,
          height: nodeHeight,
          fill,
          fills: readSketchPaintLayers(layer, "fills", context.assetByRef),
          stroke: readSketchStroke(layer),
          borders: readSketchPaintLayers(layer, "borders", context.assetByRef),
          strokeWidth: readSketchStrokeWidth(layer),
          strokePosition: readSketchStrokePosition(layer),
          radius: readSketchRadius(layer, nodeType),
          visible: true,
          locked: layer.isLocked === true,
          sourceLayerId: layerId,
          sourceLayerClass: layerClass,
          sourceMeta: readSketchSourceMeta(layer, context.assetByRef),
          opacity: readSketchOpacity(layer),
          rotation: readSketchRotation(layer),
          flippedHorizontal: layer.isFlippedHorizontal === true,
          flippedVertical: layer.isFlippedVertical === true,
          zIndex: state.parentZIndex + 0.5,
          ...readSketchVectorMeta(layer, nodeWidth, nodeHeight)
        }));
      }
    }
    getSketchRenderableLayers(layer).map(safeObject).forEach((child, index) => {
      visit(child, {
        parentX: nodeX,
        parentY: nodeY,
        depth: state.depth + 1,
        parentZIndex: state.parentZIndex + index + 1
      });
    });
  };
  getSketchRenderableLayers(pageLike).map(safeObject).forEach((layer, index) => {
    visit(layer, { parentX: 0, parentY: 0, depth: 0, parentZIndex: index });
  });
  return fallbackNodes;
}

function hasSketchGradientFill(layer: Record<string, unknown>) {
  return toArray(safeObject(layer.style).fills)
    .map(safeObject)
    .some((fill) => fill.isEnabled !== false && toNumber(fill.fillType, 0) === 1 && Object.keys(safeObject(fill.gradient)).length > 0);
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
    inheritedOpacity?: number;
    inheritedRotation?: number;
    transform?: SketchTransformMatrix;
    clipBounds?: WorkspaceDesignNode["clipBounds"];
    clipPath?: WorkspaceDesignNode["clipPath"];
    activeClippingMask?: SketchClippingMaskSourceMeta;
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
      parentX: context.nodeX,
      parentY: context.nodeY,
      scaleX,
      scaleY,
      inheritedOpacity: context.inheritedOpacity,
      inheritedRotation: context.inheritedRotation,
      transform: context.transform,
      assetByRef: context.assetByRef,
      symbolById: context.symbolById,
      sharedStyleMaps: context.sharedStyleMaps,
      clipBounds: context.clipBounds,
      clipPath: context.clipPath,
      activeClippingMask: context.activeClippingMask,
      parentNodeId: context.parentNodeId
    })
  ));
}

function applySketchSymbolOverrides(layers: AnyLayer[], overrideValues: unknown[], sharedStyleMaps?: SketchSharedStyleMaps): AnyLayer[] {
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

  const cloneWithOverrides = (layer: AnyLayer): AnyLayer => {
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
    return nextLayer as AnyLayer;
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

function extractDesignVectorAssetsFromPages(pages: WorkspaceDesignPage[], sourceFileName: string): WorkspaceDesignAsset[] {
  const assetsByRef = new Map<string, WorkspaceDesignAsset>();
  pages.forEach((page) => {
    page.nodes = page.nodes.map((node) => extractDesignVectorAssetsFromNode(node, sourceFileName, assetsByRef));
  });
  return Array.from(assetsByRef.values());
}

function extractDesignVectorAssetsFromNode(
  node: WorkspaceDesignNode,
  sourceFileName: string,
  assetsByRef: Map<string, WorkspaceDesignAsset>
): WorkspaceDesignNode {
  let nextNode = { ...node };
  if (nextNode.svgPath && nextNode.svgPath.length > 240) {
    const ref = registerDesignVectorAsset(assetsByRef, sourceFileName, "svg-path", {
      svgPath: nextNode.svgPath,
      svgFillRule: nextNode.svgFillRule
    });
    nextNode = {
      ...nextNode,
      svgPathAssetRef: ref,
      svgPath: undefined
    };
  }
  if (nextNode.svgPaths?.length) {
    const serializedLength = JSON.stringify(nextNode.svgPaths).length;
    if (serializedLength > 320) {
      const ref = registerDesignVectorAsset(assetsByRef, sourceFileName, "svg-paths", {
        svgPaths: nextNode.svgPaths
      });
      nextNode = {
        ...nextNode,
        svgPathsAssetRef: ref,
        svgPaths: undefined
      };
    }
  }
  if (nextNode.svgTree) {
    const serializedLength = JSON.stringify(nextNode.svgTree).length;
    if (serializedLength > 320) {
      const ref = registerDesignVectorAsset(assetsByRef, sourceFileName, "svg-tree", {
        svgTree: nextNode.svgTree
      });
      nextNode = {
        ...nextNode,
        svgTreeAssetRef: ref,
        svgTree: undefined
      };
    }
  }
  if (nextNode.clipPath?.svgPath && nextNode.clipPath.svgPath.length > 160) {
    const ref = registerDesignVectorAsset(assetsByRef, sourceFileName, "clip-path", {
      svgPath: nextNode.clipPath.svgPath
    });
    nextNode = {
      ...nextNode,
      clipPathSvgAssetRef: ref,
      clipPath: {
        ...nextNode.clipPath,
        svgPath: ""
      }
    };
  }
  return stripUndefinedObject(nextNode) as WorkspaceDesignNode;
}

function registerDesignVectorAsset(
  assetsByRef: Map<string, WorkspaceDesignAsset>,
  sourceFileName: string,
  kind: string,
  payload: Record<string, unknown>
) {
  const json = JSON.stringify({ kind, ...payload });
  const hash = createHash("sha1").update(json).digest("hex");
  const sourceRef = `vector/${kind}/${hash}`;
  if (!assetsByRef.has(sourceRef)) {
    assetsByRef.set(sourceRef, {
      id: createDesignId("import-vector-asset"),
      name: `${kind}-${hash.slice(0, 10)}.json`,
      sourceFileName,
      type: "vector",
      mimeType: "application/json",
      url: `data:application/json;base64,${Buffer.from(json).toString("base64")}`,
      sourceRef
    });
  }
  return sourceRef;
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
      .map(safeObject)
      .filter(isSketchImageFillPaint)
      .map((fill) => fill.image)
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

function isSketchImageFillPaint(fill: Record<string, unknown>) {
  return fill.isEnabled !== false
    && toNumber(fill.fillType, Number.NaN) === 4
    && Boolean(normalizeSketchImageRef(fill.image));
}

function readSketchImageColorControls(layer: Record<string, unknown>): WorkspaceDesignImageColorControls | undefined {
  const controls = safeObject(safeObject(layer.style).colorControls);
  if (controls.isEnabled !== true) {
    return undefined;
  }
  return {
    isEnabled: true,
    brightness: toNumber(controls.brightness, 0),
    contrast: toNumber(controls.contrast, 1),
    hue: toNumber(controls.hue, 0),
    saturation: toNumber(controls.saturation, 1)
  };
}

function sketchImageColorControlsToCssFilter(controls: WorkspaceDesignImageColorControls | undefined) {
  if (!controls?.isEnabled) {
    return undefined;
  }
  const filters: string[] = [];
  if (Math.abs(controls.brightness) > 0.0001) {
    filters.push(`brightness(${formatCssNumber(Math.max(0, 1 + controls.brightness))})`);
  }
  if (Math.abs(controls.contrast - 1) > 0.0001) {
    filters.push(`contrast(${formatCssNumber(Math.max(0, controls.contrast))})`);
  }
  if (Math.abs(controls.saturation - 1) > 0.0001) {
    filters.push(`saturate(${formatCssNumber(Math.max(0, controls.saturation))})`);
  }
  if (Math.abs(controls.hue) > 0.0001) {
    filters.push(`hue-rotate(${formatCssNumber(controls.hue * 360)}deg)`);
  }
  return filters.length > 0 ? filters.join(" ") : undefined;
}

function formatCssNumber(value: number) {
  return Number(value.toFixed(4)).toString();
}

function readSketchImageMeta(layer: Record<string, unknown>, assetByRef?: Map<string | undefined, WorkspaceDesignAsset>) {
  if (getStringProp(layer, "_class") !== "bitmap") {
    return {};
  }
  const ref = normalizeSketchImageRef(layer.image);
  const asset = assetByRef?.get(ref);
  const colorControls = readSketchImageColorControls(layer);
  return stripUndefinedObject({
    imageUrl: asset?.url,
    imageFilter: sketchImageColorControlsToCssFilter(colorControls),
    imageColorControls: colorControls,
    sourceRef: ref || undefined
  });
}

function readSketchRotation(layer: Record<string, unknown>) {
  const rotation = toNumber(layer.rotation, 0);
  if (!Number.isFinite(rotation) || Math.abs(rotation) < 0.0001) {
    return 0;
  }
  return Number(rotation.toFixed(4));
}

function readSketchSourceMeta(
  layer: Record<string, unknown>,
  assetByRef?: Map<string | undefined, WorkspaceDesignAsset>,
  activeClippingMask?: SketchClippingMaskSourceMeta
): WorkspaceDesignNode["sourceMeta"] {
  const layerClass = getStringProp(layer, "_class");
  const imageRef = layerClass === "bitmap"
    ? normalizeSketchImageRef(layer.image)
    : normalizeSketchImageRef(toArray(safeObject(layer.style).fills).map(safeObject).find(isSketchImageFillPaint)?.image);
  return stripUndefinedObject({
    provider: "sketch",
    layerClass,
    layerListExpandedType: numberOrUndefined(layer.layerListExpandedType),
    nameIsFixed: booleanOrUndefined(layer.nameIsFixed),
    isTemplate: booleanOrUndefined(layer.isTemplate),
    isFixedToViewport: booleanOrUndefined(layer.isFixedToViewport),
    maintainScrollPosition: booleanOrUndefined(layer.maintainScrollPosition),
    booleanOperation: numberOrUndefined(layer.booleanOperation),
    rotation: numberOrUndefined(layer.rotation),
    isFlippedHorizontal: booleanOrUndefined(layer.isFlippedHorizontal),
    isFlippedVertical: booleanOrUndefined(layer.isFlippedVertical),
    resizingConstraint: numberOrUndefined(layer.resizingConstraint),
    resizingType: numberOrUndefined(layer.resizingType),
    sharedStyleID: getStringProp(layer, "sharedStyleID") || undefined,
    symbolID: getStringProp(layer, "symbolID") || undefined,
    overrideValues: readSketchOverrideValues(layer),
    groupLayout: sanitizeSketchRecord(layer.groupLayout),
    points: readSketchSourcePoints(layer),
    numberOfPoints: numberOrUndefined(layer.numberOfPoints),
    shapeRadius: numberOrUndefined(layer.radius),
    isClosed: booleanOrUndefined(layer.isClosed),
    pointRadiusBehaviour: numberOrUndefined(layer.pointRadiusBehaviour),
    textBehaviour: numberOrUndefined(layer.textBehaviour),
    lineSpacingBehaviour: numberOrUndefined(layer.lineSpacingBehaviour),
    glyphBounds: getStringProp(layer, "glyphBounds") || undefined,
    imageRef: imageRef || undefined,
    imageColorControls: readSketchImageColorControls(layer),
    clippingMask: getStringProp(layer, "clippingMask") || undefined,
    hasClippingMask: booleanOrUndefined(layer.hasClippingMask),
    activeClippingMask,
    flow: sanitizeSketchRecord(layer.flow),
    exportOptions: sanitizeSketchExportOptions(layer.exportOptions),
    userInfo: sanitizeSketchRecord(layer.userInfo)
  });
}

function readSketchClippingMaskSourceMeta(layer: Record<string, unknown>): SketchClippingMaskSourceMeta {
  return stripUndefinedObject({
    sourceLayerId: getStringProp(layer, "do_objectID") || undefined,
    sourceLayerClass: getStringProp(layer, "_class") || undefined,
    name: getStringProp(layer, "name") || undefined,
    hasClippingMask: true as const
  });
}

function readSketchOverrideValues(layer: Record<string, unknown>) {
  const values = toArray(layer.overrideValues)
    .map(safeObject)
    .map((override) => ({
      overrideName: getStringProp(override, "overrideName") || undefined,
      value: stringifySketchScalar(override.value)
    }))
    .filter((override) => override.overrideName || override.value);
  return values.length > 0 ? values : undefined;
}

function readSketchSourcePoints(layer: Record<string, unknown>) {
  const points = toArray(layer.points)
    .map(safeObject)
    .map((point) => stripUndefinedObject({
      point: getStringProp(point, "point") || undefined,
      curveFrom: getStringProp(point, "curveFrom") || undefined,
      curveTo: getStringProp(point, "curveTo") || undefined,
      hasCurveFrom: booleanOrUndefined(point.hasCurveFrom),
      hasCurveTo: booleanOrUndefined(point.hasCurveTo),
      cornerRadius: numberOrUndefined(point.cornerRadius),
      curveMode: numberOrUndefined(point.curveMode)
    }));
  return points.length > 0 ? points : undefined;
}

function sanitizeSketchExportOptions(value: unknown) {
  const options = sanitizeSketchRecord(value);
  if (!options) return undefined;
  const exportFormats = toArray(options.exportFormats)
    .map(safeObject)
    .map((format) => stripUndefinedObject({
      fileFormat: getStringProp(format, "fileFormat") || undefined,
      name: getStringProp(format, "name") || undefined,
      scale: numberOrUndefined(format.scale),
      visibleScaleType: numberOrUndefined(format.visibleScaleType),
      absoluteSize: numberOrUndefined(format.absoluteSize)
    }));
  return stripUndefinedObject({
    ...options,
    exportFormats: exportFormats.length > 0 ? exportFormats : undefined
  });
}

function readSketchFillImageMeta(layer: Record<string, unknown>, assetByRef?: Map<string | undefined, WorkspaceDesignAsset>): Partial<WorkspaceDesignNode> {
  const enabledFills = toArray(safeObject(layer.style).fills).map(safeObject).filter((fill) => fill.isEnabled !== false);
  const imageFill = enabledFills.find(isSketchImageFillPaint);
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

function readSketchVectorMeta(
  layer: Record<string, unknown>,
  width: number,
  height: number,
  scale: { scaleX: number; scaleY: number } = { scaleX: 1, scaleY: 1 }
): Partial<WorkspaceDesignNode> {
  const layerClass = getStringProp(layer, "_class");
  if (isSketchVectorContainerLayer(layer)) {
    return readSketchShapeGroupVectorMeta(layer, width, height, scale);
  }
  if (layerClass === "rectangle") {
    return {};
  }
  if (!["shapePath", "oval", "polygon", "star", "triangle", "line"].includes(layerClass)) {
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

function readSketchShapeGroupVectorMeta(
  layer: Record<string, unknown>,
  width: number,
  height: number,
  scale: { scaleX: number; scaleY: number }
): Partial<WorkspaceDesignNode> {
  const children = getSketchLayers(layer).map(safeObject).filter((child) => child.isVisible !== false && !shouldSkipSketchLayer(child));
  if (children.length === 0 || !children.every(isSketchShapeVectorChild)) {
    return {};
  }

  const svgTree = buildSketchSvgTree(layer, { root: true, ...scale });
  const paths = svgTree ? flattenSketchSvgTreePaths(svgTree) : [];
  const visiblePaths = paths.filter((path) => !isInvisibleSketchSvgPath(path));
  if (visiblePaths.length === 0) {
    return {};
  }

  const hasPathTransform = visiblePaths.some((path) => path.transform);
  const combinedPath = visiblePaths.map((path) => path.d).join(" ");
  const hasBooleanPath = visiblePaths.some((path) => path.booleanOperation === 1 || path.booleanOperation === 3);
  const windingRule = toNumber(safeObject(layer.style).windingRule, 0);
  const fillRule = windingRule === 1 || hasBooleanPath ? "evenodd" : "nonzero";
  const svgPaths = [{
    d: combinedPath,
    // fillRule
  }]
  return {
    svgPath: combinedPath,
    svgFillRule: fillRule,
    svgTree,
    svgPaths: svgPaths
  };
}

type SketchShapeGroupPath = NonNullable<WorkspaceDesignNode["svgPaths"]>[number] & {
  booleanOperation?: number;
};

type SketchSvgTreeNode = NonNullable<WorkspaceDesignNode["svgTree"]>;
type SketchSvgAttributes = Omit<Extract<SketchSvgTreeNode, { type: "path" }>, "type" | "d">;
type SketchPaintKind = "solid" | "linear-gradient" | "radial-gradient" | "angular-gradient" | "diamond-gradient" | "image";

function buildSketchSvgTree(
  layer: Record<string, unknown>,
  context: { root: boolean; scaleX: number; scaleY: number }
): SketchSvgTreeNode | undefined {
  if (!isSketchVectorContainerLayer(layer)) {
    return undefined;
  }

  const frame = readSketchFrame(layer);
  const children = getSketchLayers(layer)
    .map(safeObject)
    .filter((child) => child.isVisible !== false && !shouldSkipSketchLayer(child))
    .map((child) => {
      if (isSketchVectorContainerLayer(child)) {
        return buildSketchSvgTree(child, { ...context, root: false });
      }
      return convertSketchShapeChildToSvgPath(child, context);
    })
    .filter((child): child is SketchSvgTreeNode => {
      if (!child) {
        return false;
      }
      // return !isInvisibleSketchSvgNode(child);
      return true
    });

  if (children.length === 0) {
    return undefined;
  }

  if (shouldCollapseSketchCompoundShapeGroup(layer, children)) {
    return {
      type: "path",
      d: children.map((child) => child.type === "path" ? child.d : "").join(" "),
      ...readSketchSvgStyleAttributes(layer),
      fillRule: isLikelySketchCompoundCutout(layer, children) ? "evenodd" : readSketchSvgStyleAttributes(layer).fillRule
    };
  }

  return {
    type: "g",
    ...readSketchSvgStyleAttributes(layer, { defaultFill: getStringProp(layer, "_class") === "group" ? "none" : undefined }),
    transform: context.root ? undefined : readSketchGroupSvgTransform(layer, frame, context),
    children
  };
}

function shouldCollapseSketchCompoundShapeGroup(layer: Record<string, unknown>, children: SketchSvgTreeNode[]) {
  if (getStringProp(layer, "_class") !== "shapeGroup") {
    return false;
  }
  const style = safeObject(layer.style);
  if (!hasEnabledSketchFills(style)) {
    return false;
  }
  const parentFill = readSketchFill(layer, "container");
  return children.length > 1 && children.every((child) => (
    child.type === "path"
    && (child.fill === undefined || isSameSketchSvgPaint(child.fill, parentFill))
    && child.stroke === undefined
    && child.opacity === undefined
    && child.transform === undefined
  ));
}

function isLikelySketchCompoundCutout(layer: Record<string, unknown>, children: SketchSvgTreeNode[]) {
  if (toNumber(safeObject(layer.style).windingRule, 0) === 1) {
    return true;
  }
  if (children.some((child) => child.type === "path" && child.fillRule === "evenodd")) {
    return true;
  }
  const layerName = getStringProp(layer, "name").toLowerCase();
  return /circle|radio|checkbox|ring|oval|圆|环/.test(layerName)
    && children.length > 1
    && children.every((child) => child.type === "path");
}

function isSameSketchSvgPaint(first?: string, second?: string) {
  return Boolean(first && second && first.trim().toLowerCase() === second.trim().toLowerCase());
}

function convertSketchShapeChildToSvgPath(
  child: Record<string, unknown>,
  context: { scaleX: number; scaleY: number }
): SketchSvgTreeNode | undefined {
  if (!isSketchShapePrimitive(child)) {
    return undefined;
  }

  const childClass = getStringProp(child, "_class");
  const childFrame = readSketchFrame(child);
  if (childClass !== "line" && (childFrame.width <= 0 || childFrame.height <= 0)) {
    return undefined;
  }

  const scaledFrame = scaleSketchFrame(childFrame, context.scaleX, context.scaleY);
  const width = Math.max(1, scaledFrame.width);
  const height = Math.max(1, scaledFrame.height);
  const d = readSketchSvgPath(child, width, height, scaledFrame.x, scaledFrame.y);
  if (!d) {
    return undefined;
  }

  return {
    type: "path",
    d,
    transform: readSketchLayerSvgTransform(child, scaledFrame),
    ...readSketchSvgStyleAttributes(child)
  };
}

function scaleSketchFrame(
  frame: { x: number; y: number; width: number; height: number },
  scaleX: number,
  scaleY: number
) {
  return {
    x: frame.x * scaleX,
    y: frame.y * scaleY,
    width: frame.width * scaleX,
    height: frame.height * scaleY
  };
}

function readSketchSvgStyleAttributes(
  layer: Record<string, unknown>,
  options: { defaultFill?: string } = {}
): Partial<SketchSvgAttributes> {
  const style = safeObject(layer.style);
  const booleanOperation = toNumber(layer.booleanOperation, -1);
  const windingRule = toNumber(style.windingRule, 0);
  const opacity = readSketchOpacity(layer);
  const attributes: Partial<SketchSvgTreeNode> = {
    fillRule: windingRule === 1 || booleanOperation === 1 || booleanOperation === 3 ? "evenodd" : "nonzero"
  };

  if (hasEnabledSketchFills(style)) {
    attributes.fill = readSketchFill(layer, "container");
  } else if (options.defaultFill) {
    attributes.fill = options.defaultFill;
  }

  if (hasEnabledSketchBorders(style)) {
    attributes.stroke = readSketchStroke(layer);
    attributes.strokeWidth = readSketchStrokeWidth(layer);
    attributes.strokeDashPattern = readSketchStrokeDashPattern(layer);
    attributes.strokeLineCap = readSketchStrokeLineCap(layer);
    attributes.strokeLineJoin = readSketchStrokeLineJoin(layer);
  }

  if (opacity !== 1) {
    attributes.opacity = opacity;
  }

  return attributes;
}

function flattenSketchSvgTreePaths(
  node: SketchSvgTreeNode,
  inherited: Partial<SketchShapeGroupPath> & { offsetX?: number; offsetY?: number } = {}
): SketchShapeGroupPath[] {
  const inheritedOpacity = inherited.opacity ?? 1;
  if (node.type === "path") {
    const offsetX = inherited.offsetX ?? 0;
    const offsetY = inherited.offsetY ?? 0;
    const opacity = node.opacity !== undefined ? inheritedOpacity * node.opacity : inherited.opacity;
    const transform = offsetX || offsetY ? translateSketchSvgTransform(node.transform, offsetX, offsetY) : node.transform;
    return [{
      d: offsetX || offsetY ? translateSketchSvgPath(node.d, offsetX, offsetY) : node.d,
      fill: node.fill ?? inherited.fill,
      stroke: node.stroke ?? inherited.stroke,
      strokeWidth: node.strokeWidth ?? inherited.strokeWidth,
      strokeDashPattern: node.strokeDashPattern ?? inherited.strokeDashPattern,
      strokeLineCap: node.strokeLineCap ?? inherited.strokeLineCap,
      strokeLineJoin: node.strokeLineJoin ?? inherited.strokeLineJoin,
      fillRule: node.fillRule ?? inherited.fillRule,
      opacity,
      transform: composeSketchSvgTransforms(transform)
    }];
  }

  const translate = parseSketchTranslateTransform(node.transform);
  const nodeOpacity = node.opacity !== undefined ? inheritedOpacity * node.opacity : inherited.opacity;
  const nextInherited = {
    fill: node.fill ?? inherited.fill,
    stroke: node.stroke ?? inherited.stroke,
    strokeWidth: node.strokeWidth ?? inherited.strokeWidth,
    strokeDashPattern: node.strokeDashPattern ?? inherited.strokeDashPattern,
    strokeLineCap: node.strokeLineCap ?? inherited.strokeLineCap,
    strokeLineJoin: node.strokeLineJoin ?? inherited.strokeLineJoin,
    fillRule: node.fillRule ?? inherited.fillRule,
    opacity: nodeOpacity,
    offsetX: (inherited.offsetX ?? 0) + translate.x,
    offsetY: (inherited.offsetY ?? 0) + translate.y
  };
  return node.children.flatMap((child) => flattenSketchSvgTreePaths(child, nextInherited));
}

function sketchTranslate(x: number, y: number) {
  const tx = formatPathNumber(x);
  const ty = formatPathNumber(y);
  return x || y ? `translate(${tx} ${ty})` : undefined;
}

function parseSketchTranslateTransform(transform: string | undefined) {
  const match = /translate\(([^)]+)\)/i.exec(transform ?? "");
  if (!match) {
    return { x: 0, y: 0 };
  }
  const [x = 0, y = 0] = match[1].split(/[\s,]+/).map(Number).filter(Number.isFinite);
  return { x, y };
}

function isInvisibleSketchSvgNode(node: SketchSvgTreeNode): boolean {
  if (node.opacity !== undefined && node.opacity <= 0) {
    return true;
  }
  if (node.type === "path") {
    // return isInvisibleSketchSvgPath(node);
  }
  return false;
}

function readSketchLayerSvgTransform(layer: Record<string, unknown>, frame: { x: number; y: number; width: number; height: number }) {
  const transforms: string[] = [];
  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2;
  const rotation = toNumber(layer.rotation, 0);
  const flippedHorizontal = layer.isFlippedHorizontal === true;
  const flippedVertical = layer.isFlippedVertical === true;

  if (rotation) {
    transforms.push(`rotate(${formatPathNumber(rotation)} ${formatPathNumber(centerX)} ${formatPathNumber(centerY)})`);
  }
  if (flippedHorizontal || flippedVertical) {
    transforms.push([
      `translate(${formatPathNumber(centerX)} ${formatPathNumber(centerY)})`,
      `scale(${flippedHorizontal ? -1 : 1} ${flippedVertical ? -1 : 1})`,
      `translate(${formatPathNumber(-centerX)} ${formatPathNumber(-centerY)})`
    ].join(" "));
  }

  return composeSketchSvgTransforms(...transforms);
}

function readSketchGroupSvgTransform(
  layer: Record<string, unknown>,
  frame: { x: number; y: number; width: number; height: number },
  scale: { scaleX: number; scaleY: number }
) {
  const scaledFrame = scaleSketchFrame(frame, scale.scaleX, scale.scaleY);
  const localFrame = {
    x: 0,
    y: 0,
    width: Math.max(1, scaledFrame.width),
    height: Math.max(1, scaledFrame.height)
  };
  return composeSketchSvgTransforms(
    sketchTranslate(scaledFrame.x, scaledFrame.y),
    readSketchLayerSvgTransform(layer, localFrame)
  );
}

function composeSketchSvgTransforms(...transforms: Array<string | undefined>) {
  const value = transforms.map((transform) => transform?.trim()).filter(Boolean).join(" ");
  return value || undefined;
}

function translateSketchSvgTransform(transform: string | undefined, offsetX: number, offsetY: number) {
  if (!transform) {
    return undefined;
  }
  return transform.replace(/(translate|rotate)\(([^)]*)\)/gi, (full, command: string, args: string) => {
    const values = args.split(/[\s,]+/).map(Number).filter(Number.isFinite);
    if (command.toLowerCase() === "translate" && values.length >= 2) {
      const isInverseCenterTranslate = values[0] < 0 || values[1] < 0;
      return `translate(${formatPathNumber(values[0] + (isInverseCenterTranslate ? -offsetX : offsetX))} ${formatPathNumber(values[1] + (isInverseCenterTranslate ? -offsetY : offsetY))})`;
    }
    if (command.toLowerCase() === "rotate" && values.length >= 3) {
      return `rotate(${formatPathNumber(values[0])} ${formatPathNumber(values[1] + offsetX)} ${formatPathNumber(values[2] + offsetY)})`;
    }
    return full;
  });
}

function isInvisibleSketchSvgPath(path: Partial<SketchShapeGroupPath>) {
  if (path.opacity !== undefined && path.opacity <= 0) {
    return true;
  }
  return isTransparentSketchPaint(path.fill) && (!path.stroke || isTransparentSketchPaint(path.stroke) || (path.strokeWidth ?? 0) <= 0);
}

function isTransparentSketchPaint(value: string | undefined) {
  const paint = value?.trim().toLowerCase();
  return !paint
    || paint === "transparent"
    || paint === "none"
    || /rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(paint);
}

function translateSketchSvgPath(path: string, offsetX: number, offsetY: number) {
  const tokens = path.match(/[AaCcHhLlMmQqSsTtVvZz]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/g) ?? [];
  const coordinateCounts: Record<string, number> = {
    A: 7,
    C: 6,
    H: 1,
    L: 2,
    M: 2,
    Q: 4,
    S: 4,
    T: 2,
    V: 1,
    Z: 0
  };
  const output: string[] = [];
  let command = "";
  let numberIndex = 0;

  tokens.forEach((token) => {
    if (/^[AaCcHhLlMmQqSsTtVvZz]$/.test(token)) {
      command = token;
      numberIndex = 0;
      output.push(token);
      return;
    }

    const numeric = Number(token);
    const upperCommand = command.toUpperCase();
    const coordinateCount = coordinateCounts[upperCommand] ?? 0;
    const isRelative = command !== upperCommand;
    const commandIndex = coordinateCount > 0 ? numberIndex % coordinateCount : numberIndex;
    const translated = isRelative
      ? numeric
      : numeric + getSketchSvgPathCoordinateOffset(upperCommand, commandIndex, offsetX, offsetY);
    output.push(String(formatPathNumber(translated)));
    numberIndex += 1;
  });

  return output.join(" ");
}

function getSketchSvgPathCoordinateOffset(command: string, index: number, offsetX: number, offsetY: number) {
  if (command === "H") {
    return offsetX;
  }
  if (command === "V") {
    return offsetY;
  }
  if (command === "A") {
    if (index === 5) return offsetX;
    if (index === 6) return offsetY;
    return 0;
  }
  if (command === "C" || command === "S" || command === "Q" || command === "M" || command === "L" || command === "T") {
    return index % 2 === 0 ? offsetX : offsetY;
  }
  return 0;
}

function collectSketchShapeGroupPaths(
  layer: Record<string, unknown>,
  context: {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    inheritedStyle: Record<string, unknown>;
  }
): SketchShapeGroupPath[] {
  const groupStyle = mergeSketchStyles(context.inheritedStyle, safeObject(layer.style));
  return getSketchLayers(layer)
    .map(safeObject)
    .filter((child) => child.isVisible !== false && !shouldSkipSketchLayer(child))
    .flatMap((child) => convertSketchShapeChildToPath(child, {
      ...context,
      inheritedStyle: groupStyle
    }));
}

function convertSketchShapeChildToPath(
  child: Record<string, unknown>,
  context: {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    inheritedStyle: Record<string, unknown>;
  }
): SketchShapeGroupPath[] {
  const childClass = getStringProp(child, "_class");
  const childFrame = readSketchFrame(child);
  const childStyle = mergeSketchStyles(context.inheritedStyle, safeObject(child.style));

  if (childClass === "shapeGroup") {
    return collectSketchShapeGroupPaths(child, {
      width: Math.max(1, childFrame.width || context.width),
      height: Math.max(1, childFrame.height || context.height),
      offsetX: context.offsetX + childFrame.x,
      offsetY: context.offsetY + childFrame.y,
      inheritedStyle: childStyle
    });
  }

  if (!isSketchShapePrimitive(child)) {
    return [];
  }

  if (childClass !== "line" && (childFrame.width <= 0 || childFrame.height <= 0)) {
    return [];
  }

  const styledChild = {
    ...child,
    style: childStyle
  };
  const pathWidth = Math.max(1, childFrame.width || context.width);
  const pathHeight = Math.max(1, childFrame.height || context.height);
  const pathOffsetX = context.offsetX + childFrame.x;
  const pathOffsetY = context.offsetY + childFrame.y;
  const d = readSketchSvgPath(styledChild, pathWidth, pathHeight, pathOffsetX, pathOffsetY);
  if (!d) {
    return [];
  }

  const booleanOperation = toNumber(child.booleanOperation, -1);
  const windingRule = toNumber(safeObject(childStyle).windingRule, 0);
  return [{
    d,
    fill: hasEnabledSketchFills(childStyle) ? readSketchFill(styledChild, "container") : "transparent",
    stroke: readSketchStroke(styledChild),
    strokeWidth: readSketchStrokeWidth(styledChild),
    strokeDashPattern: readSketchStrokeDashPattern(styledChild),
    strokeLineCap: readSketchStrokeLineCap(styledChild),
    strokeLineJoin: readSketchStrokeLineJoin(styledChild),
    fillRule: windingRule === 1 || booleanOperation === 1 || booleanOperation === 3 ? "evenodd" : "nonzero",
    opacity: readSketchOpacity(styledChild),
    booleanOperation
  }];
}

function hasEnabledSketchFills(style: Record<string, unknown>) {
  return toArray(style.fills).some((fill) => safeObject(fill).isEnabled !== false);
}

function hasEnabledSketchBorders(style: Record<string, unknown>) {
  return toArray(style.borders).some((border) => safeObject(border).isEnabled !== false);
}

function isSketchShapeVectorChild(layer: Record<string, unknown>): boolean {
  return isSketchShapePrimitive(layer) || isSketchVectorContainerLayer(layer);
}

function hasSketchClippingMaskDescendant(layer: Record<string, unknown>): boolean {
  return getSketchLayers(layer)
    .map(safeObject)
    .filter((child) => child.isVisible !== false && !shouldSkipSketchLayer(child))
    .some((child) => child.hasClippingMask === true || hasSketchClippingMaskDescendant(child));
}

function isSketchVectorContainerLayer(layer: Record<string, unknown>): boolean {
  const layerClass = getStringProp(layer, "_class");
  if (layerClass === "shapeGroup") {
    return true;
  }
  if (layerClass !== "group") {
    return false;
  }
  if (hasRenderableSketchStyle(safeObject(layer.style))) {
    return false;
  }
  const children = getSketchLayers(layer).map(safeObject).filter((child) => child.isVisible !== false && !shouldSkipSketchLayer(child));
  return children.length > 0 && children.every(isSketchShapeVectorChild);
}

function hasRenderableSketchStyle(style: Record<string, unknown>) {
  const hasFill = toArray(style.fills).some((fill) => safeObject(fill).isEnabled !== false);
  const hasBorder = toArray(style.borders).some((border) => safeObject(border).isEnabled !== false);
  const hasShadow = toArray(style.shadows).some((shadow) => safeObject(shadow).isEnabled !== false);
  const hasInnerShadow = toArray(style.innerShadows).some((shadow) => safeObject(shadow).isEnabled !== false);
  return hasFill || hasBorder || hasShadow || hasInnerShadow;
}

function shouldRenderSketchClippingMaskLayer(layer: Record<string, unknown>) {
  if (layer.isVisible === false) {
    return false;
  }
  if (normalizeSketchImageRef(layer.image)) {
    return true;
  }
  const style = safeObject(layer.style);
  if (hasRenderableSketchStyle(style)) {
    return true;
  }
  return toArray(style.fills)
    .map(safeObject)
    .some((fill) => fill.isEnabled !== false && normalizeSketchImageRef(fill.image));
}

function readSketchSvgPath(layer: Record<string, unknown>, width: number, height: number, offsetX = 0, offsetY = 0) {
  const layerClass = getStringProp(layer, "_class");
  if (layerClass === "line") {
    return `M ${formatPathNumber(offsetX)} ${formatPathNumber(offsetY)} L ${formatPathNumber(offsetX + width)} ${formatPathNumber(offsetY + height)}`;
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
    const canUseCurve = previous.hasCurveFrom && current.hasCurveTo
      && !sameSketchPathPoint(previous.curveFrom, previous.point)
      && !sameSketchPathPoint(current.curveTo, current.point)
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
    const canCloseWithCurve = last.hasCurveFrom && first.hasCurveTo
      && !sameSketchPathPoint(last.curveFrom, last.point)
      && !sameSketchPathPoint(first.curveTo, first.point)
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

function sameSketchPathPoint(first: { x: number; y: number }, second: { x: number; y: number }) {
  return Math.abs(first.x - second.x) < 0.001 && Math.abs(first.y - second.y) < 0.001;
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
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (Math.abs(value) < 1e-12) {
    return "0";
  }
  return Number(value.toPrecision(15)).toString();
}

function mimeTypeFromSketchImageRef(ref: string) {
  const extension = extname(ref).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".json") return "application/json";
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
  const style = safeObject(layer.style);
  const enabledFills = toArray(style.fills).map(safeObject).filter((fill) => fill.isEnabled !== false);
  const fillLayers = enabledFills.map((fill) => sketchPaintToCss(fill, assetByRef)).filter(Boolean);
  if (fillLayers.length > 0) {
    return sketchPaintLayersToCssBackground(fillLayers);
  }
  if (layerClass === "artboard" && layer.hasBackgroundColor === true) {
    return colorToRgba(layer.backgroundColor);
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
  // return "#f8f8fa";
  return "transparent";
}

function readSketchPaintLayers(
  layer: Record<string, unknown>,
  property: "fills" | "borders",
  assetByRef?: Map<string | undefined, WorkspaceDesignAsset>
): WorkspaceDesignPaint[] | undefined {
  const style = safeObject(layer.style);
  const paints = toArray(style[property])
    .map(safeObject)
    .map((paint, sourceIndex) => sketchPaintToModel(paint, sourceIndex, assetByRef))
    .filter((paint): paint is WorkspaceDesignPaint => Boolean(paint));
  return paints.length > 0 ? paints : undefined;
}

function sketchPaintLayersToCssBackground(layers: string[]) {
  return layers.slice().reverse().join(", ");
}

function sketchPaintToModel(
  paint: Record<string, unknown>,
  sourceIndex: number,
  assetByRef?: Map<string | undefined, WorkspaceDesignAsset>
): WorkspaceDesignPaint | undefined {
  const kind = getSketchPaintKind(paint);
  if (!kind) {
    return undefined;
  }
  const css = sketchPaintToCss(paint, assetByRef);
  const enabled = paint.isEnabled !== false;
  if (kind === "image") {
    const imageRef = normalizeSketchImageRef(paint.image);
    const imageAsset = assetByRef?.get(imageRef);
    return {
      kind: "image",
      enabled,
      sourceIndex,
      css,
      imageRef,
      opacity: readSketchContextOpacity(paint),
      imageUrl: imageAsset?.url
    };
  }
  if (kind === "solid") {
    return {
      kind: "solid",
      enabled,
      sourceIndex,
      css,
      color: paint.color ? colorToRgba(paint.color, readSketchContextOpacity(paint)) : undefined
    };
  }
  const gradient = safeObject(paint.gradient);
  return {
    kind: "gradient",
    enabled,
    sourceIndex,
    css,
    gradient: sketchGradientToModel(gradient, readSketchContextOpacity(paint))
  };
}

function sketchPaintToCss(paint: Record<string, unknown>, assetByRef?: Map<string | undefined, WorkspaceDesignAsset>) {
  const kind = getSketchPaintKind(paint);
  if (!kind) {
    return "";
  }
  const imageRef = normalizeSketchImageRef(paint.image);
  const imageAsset = assetByRef?.get(imageRef);
  if (imageAsset?.url) {
    return `url("${imageAsset.url}") center / 100% 100% no-repeat`;
  }
  const fillType = toNumber(paint.fillType, 0);
  const gradient = safeObject(paint.gradient);
  if (kind !== "solid" && kind !== "image" && fillType === 1 && Object.keys(gradient).length > 0) {
    return sketchGradientToCss(gradient, readSketchContextOpacity(paint));
  }
  if (paint.color) {
    return colorToRgba(paint.color, readSketchContextOpacity(paint));
  }
  return "";
}

function sketchGradientToModel(gradient: Record<string, unknown>, opacityMultiplier = 1): WorkspaceDesignPaint["gradient"] {
  return {
    type: sketchGradientTypeToModelType(toNumber(gradient.gradientType, 0)),
    from: parseSketchPoint(getStringProp(gradient, "from")),
    to: parseSketchPoint(getStringProp(gradient, "to")),
    stops: toArray(gradient.stops).map((stop) => {
      const stopObject = safeObject(stop);
      return {
        color: colorToRgba(stopObject.color, opacityMultiplier),
        position: Math.max(0, Math.min(1, toNumber(stopObject.position, 0)))
      };
    }).sort((first, second) => first.position - second.position)
  };
}

function sketchGradientTypeToModelType(gradientType: number): NonNullable<WorkspaceDesignPaint["gradient"]>["type"] {
  if (gradientType === 1) return "radial";
  if (gradientType === 2) return "angular";
  if (gradientType === 3) return "diamond";
  return "linear";
}

function sketchGradientToCss(gradient: Record<string, unknown>, opacityMultiplier = 1) {
  const stops = toArray(gradient.stops).map((stop) => {
    const stopObject = safeObject(stop);
    return {
      color: colorToRgba(stopObject.color, opacityMultiplier),
      position: Math.max(0, Math.min(1, toNumber(stopObject.position, 0)))
    };
  }).sort((first, second) => first.position - second.position);
  if (stops.length === 0) {
    return "";
  }
  const cssStops = stops.map((stop) => `${stop.color} ${formatCssPercent(stop.position)}%`);
  const gradientType = toNumber(gradient.gradientType, 0);
  const from = parseSketchPoint(getStringProp(gradient, "from"));
  const to = parseSketchPoint(getStringProp(gradient, "to"));
  if (gradientType === 1) {
    return `radial-gradient(circle at ${formatCssPercent(from.x)}% ${formatCssPercent(from.y)}%, ${cssStops.join(", ")})`;
  }
  const angle = normalizeCssAngle(Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI + 90);
  if (gradientType === 2) {
    return `conic-gradient(from ${angle}deg at ${formatCssPercent(from.x)}% ${formatCssPercent(from.y)}%, ${cssStops.join(", ")})`;
  }
  if (gradientType === 3) {
    return `radial-gradient(closest-side at ${formatCssPercent(from.x)}% ${formatCssPercent(from.y)}%, ${cssStops.join(", ")})`;
  }
  return `linear-gradient(${angle}deg, ${cssStops.join(", ")})`;
}

function getSketchPaintKind(paint: Record<string, unknown>): SketchPaintKind | undefined {
  const fillType = toNumber(paint.fillType, 0);
  if (fillType === 4 && normalizeSketchImageRef(paint.image)) {
    return "image";
  }
  if (fillType !== 1) {
    return paint.color ? "solid" : undefined;
  }
  const gradientType = toNumber(safeObject(paint.gradient).gradientType, 0);
  if (gradientType === 1) return "radial-gradient";
  if (gradientType === 2) return "angular-gradient";
  if (gradientType === 3) return "diamond-gradient";
  return "linear-gradient";
}

function normalizeCssAngle(angle: number) {
  const normalized = ((angle % 360) + 360) % 360;
  return Number(normalized.toFixed(2));
}

function formatCssPercent(value: number) {
  const percent = value * 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/\.?0+$/, "");
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
  return sketchPaintToCss(borderObject) || "transparent";
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
  return sketchShadowsToCss(style.shadows, readSketchContextOpacity(style));
}

function readSketchInnerShadow(layer: Record<string, unknown>) {
  const style = safeObject(layer.style);
  return sketchShadowsToCss(style.innerShadows, readSketchContextOpacity(style));
}

function sketchShadowsToCss(value: unknown, opacityMultiplier = 1) {
  const shadows = toArray(value)
    .map(safeObject)
    .filter((shadow) => shadow.isEnabled !== false)
    .map((shadow) => {
      const offsetX = toNumber(shadow.offsetX, 0);
      const offsetY = toNumber(shadow.offsetY, 0);
      const blur = toNumber(shadow.blurRadius, 0);
      const spread = toNumber(shadow.spread, 0);
      return `${offsetX}px ${offsetY}px ${blur}px ${spread}px ${colorToRgba(shadow.color, opacityMultiplier)}`;
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
  const minimumLineHeight = toNumber(paragraphStyle.minimumLineHeight, 0);
  const maximumLineHeight = toNumber(paragraphStyle.maximumLineHeight, 0);
  const lineHeight = minimumLineHeight > 0 ? minimumLineHeight : maximumLineHeight;
  return lineHeight > 0 ? Math.round(lineHeight) : undefined;
}

function readSketchTextAlign(layer: Record<string, unknown>): WorkspaceDesignNode["textAlign"] {
  const alignment = toNumber(readSketchParagraphStyle(layer).alignment, 0);
  if (alignment === 1) return "right";
  if (alignment === 2) return "center";
  if (alignment === 3) return "justify";
  return "left";
}

function readSketchTextVerticalAlign(layer: Record<string, unknown>): WorkspaceDesignNode["textVerticalAlign"] {
  if (getStringProp(layer, "_class") !== "text") {
    return undefined;
  }
  const textStyle = safeObject(safeObject(layer.style).textStyle);
  const encodedAttributes = safeObject(textStyle.encodedAttributes);
  const firstAttribute = safeObject(toArray(safeObject(layer.attributedString).attributes)[0]);
  const firstAttributeAttrs = safeObject(firstAttribute.attributes);
  const verticalAlignment = toNumber(
    encodedAttributes.textStyleVerticalAlignmentKey,
    toNumber(firstAttributeAttrs.textStyleVerticalAlignmentKey, toNumber(textStyle.verticalAlignment, 0))
  );
  if (verticalAlignment === 1) return "middle";
  if (verticalAlignment === 2) return "bottom";
  return "top";
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
  if (layerClass === "artboard" || layerClass === "symbolMaster") return "frame";
  if (layerClass === "symbolInstance") return "card";
  if (layerClass === "group" || layerClass === "shapeGroup") return "card";
  if (layerClass === "slice" || layerClass === "MSImmutableHotspotLayer") return "container";
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

function stripUndefinedObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function numberOrUndefined(value: unknown) {
  const numberValue = toNumber(value, Number.NaN);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function booleanOrUndefined(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function stringifySketchScalar(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || typeof value !== "object") return undefined;
  const ref = normalizeSketchImageRef(value);
  if (ref) return ref;
  return getStringProp(value, "do_objectID") || getStringProp(value, "_ref") || undefined;
}

function sanitizeSketchRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const allowedEntries = Object.entries(record)
    .filter(([, item]) => item === null || ["string", "number", "boolean"].includes(typeof item));
  return allowedEntries.length > 0 ? Object.fromEntries(allowedEntries) : undefined;
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
  const numbers = value.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
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
