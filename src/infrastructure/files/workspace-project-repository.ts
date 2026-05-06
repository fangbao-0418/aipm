import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { ProjectContext } from "./project-context.js";
import { IndexDatabase } from "../db/index-database.js";
import { readJsonFile, writeJsonFile } from "../../shared/utils/json.js";
import type {
  WorkspaceBundle,
  WorkspaceDesignFile,
  WorkspaceDesignPage,
  WorkspaceProjectDocument,
  WorkspaceProjectDocumentMeta,
  WorkspaceProjectDocumentVersion,
  WorkspaceLlmSettings,
  WorkspaceMainAgentDecision,
  WorkspaceMainAgentRunLog,
  WorkspaceProject,
  WorkspaceRequirementCollection,
  WorkspaceRequirementCollectionVersion,
  WorkspaceRequirementStructure,
  WorkspaceRequirementStructureVersion,
  WorkspaceStageDocument,
  WorkspaceStageDocumentVersion,
  WorkspaceSourceFileRecord,
  WorkspaceStage,
  WorkspaceStageStateRecord,
  WorkspaceStageTaskPlan,
  WorkspaceStageType
} from "../../shared/types/workspace.js";
import { nowIso } from "../../shared/utils/time.js";

const defaultLlmSettings: WorkspaceLlmSettings = {
  provider: "openai",
  modelProfile: "balanced",
  apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
  stageModelRouting: {
    capture: process.env.OPENAI_MODEL ?? "gpt-5-mini",
    structure: process.env.OPENAI_MODEL ?? "gpt-5.2"
  }
};

const stageTemplates: Array<Pick<WorkspaceStage, "type" | "name" | "description">> = [
  { type: "requirement-collection", name: "需求采集", description: "收集和记录原始需求输入" },
  { type: "requirement-structure", name: "需求结构化", description: "将原始需求整理成结构化需求点" },
  { type: "requirement-clarification", name: "需求澄清", description: "AI 主动识别缺失信息并补全" },
  { type: "product-model", name: "产品模型", description: "建立统一的产品中间模型" },
  { type: "prd", name: "PRD", description: "形成正式产品需求文档" },
  { type: "prototype", name: "原型", description: "输出页面结构和交互骨架" },
  { type: "prototype-annotation", name: "原型标注", description: "补充交互和业务标注" },
  { type: "ui-draft", name: "UI 稿", description: "生成高保真视觉设计稿" },
  { type: "review", name: "Review", description: "版本管理和质量审查" }
];

export class WorkspaceProjectRepository {
  private readonly index: IndexDatabase;

  constructor(private readonly context: ProjectContext) {
    this.index = new IndexDatabase(context);
  }

  async ensureReady() {
    await this.context.ensureBaseStructure();
    await mkdir(this.projectsRoot(), { recursive: true });
  }

  projectsRoot() {
    return this.context.path("workspace", "projects");
  }

  projectDir(projectId: string) {
    return this.context.path("workspace", "projects", projectId);
  }

  projectPath(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "project.json");
  }

  stageStatePath(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "stage-state.json");
  }

  intakePath(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "requirement-collection", "intake.json");
  }

  intakeDocumentPath(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "requirement-collection", "requirements.md");
  }

  intakeDocumentHtmlPath(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "requirement-collection", "requirements.html");
  }

  intakeVersionsDir(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "requirement-collection", "versions");
  }

  requirementStructurePath(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "requirement-structure", "requirement-structure.json");
  }

  requirementStructureMarkdownPath(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "requirement-structure", "requirement-structure.md");
  }

  requirementStructureHtmlPath(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "requirement-structure", "requirement-structure.html");
  }

  requirementStructureVersionsDir(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "requirement-structure", "versions");
  }

  stageDocumentDir(projectId: string, stage: "requirement-clarification" | "product-model" | "prd" | "prototype") {
    return this.context.path("workspace", "projects", projectId, stage);
  }

  stageDocumentJsonPath(projectId: string, stage: "requirement-clarification" | "product-model" | "prd" | "prototype") {
    return this.context.path("workspace", "projects", projectId, stage, `${stage}.json`);
  }

  stageDocumentMarkdownPath(projectId: string, stage: "requirement-clarification" | "product-model" | "prd" | "prototype") {
    return this.context.path("workspace", "projects", projectId, stage, `${stage}.md`);
  }

  stageDocumentHtmlPath(projectId: string, stage: "requirement-clarification" | "product-model" | "prd" | "prototype") {
    return this.context.path("workspace", "projects", projectId, stage, `${stage}.html`);
  }

  stageDocumentVersionsDir(projectId: string, stage: "requirement-clarification" | "product-model" | "prd" | "prototype") {
    return this.context.path("workspace", "projects", projectId, stage, "versions");
  }

  sourceFilesDir(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "requirement-collection", "source-files");
  }

  designAssetsDir(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "design", "assets");
  }

  designPagesDir(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "design", "pages");
  }

  designFilePath(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "design", "file.json");
  }

  designPagePath(projectId: string, pageId: string) {
    return this.context.path("workspace", "projects", projectId, "design", "pages", `${safePathSegment(pageId)}.json`);
  }

  projectSourceFilePath(projectId: string, storedFilename: string) {
    return this.context.path("workspace", "projects", projectId, "requirement-collection", "source-files", storedFilename);
  }

  projectDesignAssetPath(projectId: string, storedFilename: string) {
    return this.context.path("workspace", "projects", projectId, "design", "assets", storedFilename);
  }

  llmSettingsPath(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "settings", "llm.json");
  }

  llmSecretsPath(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "settings", "llm.secrets.json");
  }

  agentDir(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "agent");
  }

  agentRunsDir(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "agent", "runs");
  }

  agentLatestDecisionPath(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "agent", "latest-decision.json");
  }

  llmLogsDir(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "logs", "llm");
  }

  documentsDir(projectId: string) {
    return this.context.path("workspace", "projects", projectId, "documents");
  }

  documentDir(projectId: string, documentId: string) {
    return this.context.path("workspace", "projects", projectId, "documents", documentId);
  }

  documentMetaPath(projectId: string, documentId: string) {
    return this.context.path("workspace", "projects", projectId, "documents", documentId, "meta.json");
  }

  documentContentBlocksPath(projectId: string, documentId: string) {
    return this.context.path("workspace", "projects", projectId, "documents", documentId, "content.blocknote.json");
  }

  documentHtmlPath(projectId: string, documentId: string) {
    return this.context.path("workspace", "projects", projectId, "documents", documentId, "content.html");
  }

  documentTextPath(projectId: string, documentId: string) {
    return this.context.path("workspace", "projects", projectId, "documents", documentId, "content.txt");
  }

  documentVersionsDir(projectId: string, documentId: string) {
    return this.context.path("workspace", "projects", projectId, "documents", documentId, "versions");
  }

  documentVersionPath(projectId: string, documentId: string, versionId: string) {
    return this.context.path("workspace", "projects", projectId, "documents", documentId, "versions", `${versionId}.json`);
  }

  async ensureProjectStructure(projectId: string) {
    await this.ensureReady();
    await Promise.all([
      mkdir(this.projectDir(projectId), { recursive: true }),
      mkdir(this.sourceFilesDir(projectId), { recursive: true }),
      mkdir(this.intakeVersionsDir(projectId), { recursive: true }),
      mkdir(this.context.path("workspace", "projects", projectId, "requirement-structure"), { recursive: true }),
      mkdir(this.requirementStructureVersionsDir(projectId), { recursive: true }),
      mkdir(this.stageDocumentDir(projectId, "requirement-clarification"), { recursive: true }),
      mkdir(this.stageDocumentVersionsDir(projectId, "requirement-clarification"), { recursive: true }),
      mkdir(this.stageDocumentDir(projectId, "product-model"), { recursive: true }),
      mkdir(this.stageDocumentVersionsDir(projectId, "product-model"), { recursive: true }),
      mkdir(this.stageDocumentDir(projectId, "prd"), { recursive: true }),
      mkdir(this.stageDocumentVersionsDir(projectId, "prd"), { recursive: true }),
      mkdir(this.stageDocumentDir(projectId, "prototype"), { recursive: true }),
      mkdir(this.stageDocumentVersionsDir(projectId, "prototype"), { recursive: true }),
      mkdir(this.context.path("workspace", "projects", projectId, "settings"), { recursive: true }),
      mkdir(this.agentRunsDir(projectId), { recursive: true }),
      mkdir(this.llmLogsDir(projectId), { recursive: true }),
      mkdir(this.documentsDir(projectId), { recursive: true }),
      mkdir(this.designAssetsDir(projectId), { recursive: true }),
      mkdir(this.designPagesDir(projectId), { recursive: true })
    ]);
  }

  async saveProject(project: WorkspaceProject) {
    await this.ensureProjectStructure(project.id);
    await writeJsonFile(this.projectPath(project.id), project);
  }

  async deleteProject(projectId: string) {
    await rm(this.projectDir(projectId), { recursive: true, force: true });
  }

  async getProject(projectId: string) {
    return readJsonFile<WorkspaceProject>(this.projectPath(projectId));
  }

  async saveDesignFile(projectId: string, designFile: WorkspaceDesignFile) {
    await this.ensureProjectStructure(projectId);
    const compactPages = await Promise.all(
      designFile.pages.map(async (page) => {
        const pagePath = this.designPagePath(projectId, page.id);
        const existingPage = await readJsonFile<WorkspaceDesignPage>(pagePath).catch(() => null);
        const hasInlineNodes = Array.isArray(page.nodes)
          && (page.nodes.length > 0 || page.nodeCount === 0 || page.schemaLoaded === true || !existingPage);
        const nodes = hasInlineNodes ? page.nodes : existingPage?.nodes ?? [];
        if (hasInlineNodes || !existingPage) {
          await writeJsonFile(pagePath, {
            ...page,
            nodes,
            nodeCount: nodes.length,
            schemaPath: `design/pages/${safePathSegment(page.id)}.json`
          });
        }
        return {
          id: page.id,
          name: page.name,
          nodes: [],
          nodeCount: nodes.length,
          schemaPath: `design/pages/${safePathSegment(page.id)}.json`
        } satisfies WorkspaceDesignPage;
      })
    );
    const data = {
      ...designFile,
      pages: compactPages
    }
    await writeJsonFile(this.designFilePath(projectId), data);
    return data
  }

  async getDesignFile(projectId: string) {
    const designFile = await readJsonFile<WorkspaceDesignFile>(this.designFilePath(projectId));
    const hasInlinePageNodes = designFile.pages.some((page) => Array.isArray(page.nodes) && page.nodes.length > 0);
    const hasMissingPageSchemas = designFile.pages.some((page) => !page.schemaPath);
    if (hasInlinePageNodes || hasMissingPageSchemas) {
      await this.saveDesignFile(projectId, designFile);
      return readJsonFile<WorkspaceDesignFile>(this.designFilePath(projectId));
    }
    return designFile;
  }

  async saveDesignPage(projectId: string, page: WorkspaceDesignPage) {
    await this.ensureProjectStructure(projectId);
    await writeJsonFile(this.designPagePath(projectId, page.id), {
      ...page,
      nodeCount: page.nodes.length,
      schemaPath: `design/pages/${safePathSegment(page.id)}.json`
    });
  }

  async getDesignPage(projectId: string, pageId: string) {
    return readJsonFile<WorkspaceDesignPage>(this.designPagePath(projectId, pageId));
  }

  async upsertAgentConversation(input: {
    id: string;
    projectId: string;
    title: string;
    metadata?: unknown;
    createdAt: string;
    updatedAt: string;
  }) {
    return this.index.upsertAgentConversation(input);
  }

  async saveAgentMessage(input: {
    id: string;
    conversationId: string;
    projectId: string;
    role: string;
    content?: string;
    eventType?: string;
    toolName?: string;
    toolCallId?: string;
    metadata?: unknown;
    createdAt: string;
  }) {
    return this.index.insertAgentMessage(input);
  }

  async listAgentMessages(input: { projectId: string; conversationId: string; limit?: number }) {
    return this.index.listAgentMessages(input);
  }

  async searchAgentMessages(input: { projectId: string; conversationId?: string; keyword: string; limit?: number }) {
    return this.index.searchAgentMessages(input);
  }

  async upsertAgentToolCall(input: {
    id: string;
    conversationId: string;
    projectId: string;
    toolName: string;
    arguments?: unknown;
    result?: unknown;
    status: "running" | "success" | "failed";
    error?: string;
    startedAt: string;
    endedAt?: string;
  }) {
    return this.index.upsertAgentToolCall(input);
  }

  async listAgentToolCalls(input: { projectId: string; conversationId: string; toolName?: string; limit?: number }) {
    return this.index.listAgentToolCalls(input);
  }

  async saveStageState(projectId: string, states: WorkspaceStageStateRecord[]) {
    await this.ensureProjectStructure(projectId);
    await writeJsonFile(this.stageStatePath(projectId), states);
  }

  async getStageState(projectId: string) {
    return readJsonFile<WorkspaceStageStateRecord[]>(this.stageStatePath(projectId));
  }

  async saveRequirementCollection(
    projectId: string,
    collection: WorkspaceRequirementCollection,
    source: WorkspaceRequirementCollectionVersion["source"] = "ai"
  ) {
    await this.ensureProjectStructure(projectId);
    const previous = await this.getRequirementCollection(projectId).catch(() => null);
    await writeJsonFile(this.intakePath(projectId), collection);
    await writeFile(
      this.intakeDocumentPath(projectId),
      collection.requirementsDocument.endsWith("\n") ? collection.requirementsDocument : `${collection.requirementsDocument}\n`,
      "utf-8"
    );
    await writeFile(
      this.intakeDocumentHtmlPath(projectId),
      collection.requirementsDocumentHtml,
      "utf-8"
    );

    const shouldCreateVersion = !previous
      || previous.requirementsDocument !== collection.requirementsDocument
      || previous.requirementsDocumentHtml !== collection.requirementsDocumentHtml
      || previous.aiSummary !== collection.aiSummary;

    if (shouldCreateVersion) {
      const version: WorkspaceRequirementCollectionVersion = {
        id: `${Date.now()}`,
        createdAt: collection.lastEditedAt ?? collection.lastOrganizedAt ?? nowIso(),
        source,
        summary: collection.aiSummary,
        requirementsDocument: collection.requirementsDocument,
        requirementsDocumentHtml: collection.requirementsDocumentHtml
      };
      await writeJsonFile(this.context.path(this.intakeVersionsDir(projectId), `${version.id}.json`), version);
    }
  }

  async saveLlmLog(
    projectId: string,
    payload: {
      stage: WorkspaceStageType | "chat";
      step: string;
      model?: string;
      baseUrl?: string;
      systemPrompt: string;
      userPrompt: string;
      outputText?: string;
      parsedOutput?: unknown;
      error?: string;
      createdAt?: string;
    }
  ) {
    await this.ensureProjectStructure(projectId);
    const createdAt = payload.createdAt ?? nowIso();
    const filename = `${Date.now()}-${payload.step.replace(/[^a-z0-9-_]/gi, "-")}.json`;
    await writeJsonFile(join(this.llmLogsDir(projectId), filename), {
      ...payload,
      createdAt
    });
  }

  async listProjectDocuments(projectId: string) {
    await this.ensureProjectStructure(projectId);
    const metas = await this.index.listWorkspaceDocumentMetas(projectId);
    const documents = await Promise.all(
      metas.map((meta) => this.getProjectDocument(projectId, meta.id))
    );

    return documents.filter((document): document is WorkspaceProjectDocument => Boolean(document));
  }

  async getProjectDocument(projectId: string, documentId: string) {
    await this.ensureProjectStructure(projectId);
    const meta = await this.index.getWorkspaceDocumentMeta(projectId, documentId);
    if (!meta) {
      return null;
    }

    const contentBlocks = await readJsonFile<unknown[]>(this.documentContentBlocksPath(projectId, documentId)).catch(() => []);
    const contentHtml = await readFile(this.documentHtmlPath(projectId, documentId), "utf-8").catch(() => "<p></p>");
    const contentText = await readFile(this.documentTextPath(projectId, documentId), "utf-8").catch(() => "");

    return {
      id: meta.id,
      projectId: meta.projectId,
      title: meta.title,
      sortOrder: meta.sortOrder,
      deleted: meta.deleted,
      contentBlocks,
      contentHtml,
      contentText,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt
    } satisfies WorkspaceProjectDocument;
  }

  async saveProjectDocument(
    document: WorkspaceProjectDocument,
    source: WorkspaceProjectDocumentVersion["source"] = "manual"
  ) {
    await this.ensureProjectStructure(document.projectId);
    await mkdir(this.documentDir(document.projectId, document.id), { recursive: true });
    await mkdir(this.documentVersionsDir(document.projectId, document.id), { recursive: true });

    const previousMeta = await this.index.getWorkspaceDocumentMeta(document.projectId, document.id);
    const previousDocument = previousMeta
      ? await this.getProjectDocument(document.projectId, document.id).catch(() => null)
      : null;

    await writeJsonFile(this.documentMetaPath(document.projectId, document.id), {
      id: document.id,
      projectId: document.projectId,
      title: document.title,
      sortOrder: document.sortOrder,
      deleted: document.deleted,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt
    });
    await writeJsonFile(this.documentContentBlocksPath(document.projectId, document.id), document.contentBlocks);
    await writeFile(this.documentHtmlPath(document.projectId, document.id), document.contentHtml, "utf-8");
    await writeFile(this.documentTextPath(document.projectId, document.id), document.contentText, "utf-8");

    const versionNumber = previousMeta
      ? (await this.index.listWorkspaceDocumentVersions(document.projectId, document.id)).length + 1
      : 1;

    const shouldCreateVersion = !previousDocument
      || previousDocument.title !== document.title
      || previousDocument.contentHtml !== document.contentHtml
      || previousDocument.contentText !== document.contentText
      || JSON.stringify(previousDocument.contentBlocks) !== JSON.stringify(document.contentBlocks);

    let latestVersionId = previousMeta?.latestVersionId;
    if (shouldCreateVersion) {
      const versionId = `${Date.now()}`;
      latestVersionId = versionId;
      const version: WorkspaceProjectDocumentVersion = {
        id: versionId,
        documentId: document.id,
        projectId: document.projectId,
        versionNumber,
        source,
        summary: buildWorkspaceDocumentSummary(document),
        snapshotFilePath: this.documentVersionPath(document.projectId, document.id, versionId),
        createdAt: document.updatedAt
      };
      await writeJsonFile(version.snapshotFilePath, {
        ...document,
        source,
        versionNumber
      });
      await this.index.upsertWorkspaceDocumentVersion(version);
    }

    const meta: WorkspaceProjectDocumentMeta = {
      id: document.id,
      projectId: document.projectId,
      title: document.title,
      sortOrder: document.sortOrder,
      deleted: document.deleted,
      contentFilePath: this.documentContentBlocksPath(document.projectId, document.id),
      htmlFilePath: this.documentHtmlPath(document.projectId, document.id),
      textFilePath: this.documentTextPath(document.projectId, document.id),
      latestVersionId,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt
    };
    await this.index.upsertWorkspaceDocumentMeta(meta);
    return document;
  }

  async deleteProjectDocument(projectId: string, documentId: string) {
    await this.index.deleteWorkspaceDocumentMeta(projectId, documentId);
    await rm(this.documentDir(projectId, documentId), { recursive: true, force: true });
  }

  async saveProjectDocumentOrder(projectId: string, orderedIds: string[]) {
    const metas = await this.index.listWorkspaceDocumentMetas(projectId);
    const metaMap = new Map(metas.map((meta) => [meta.id, meta]));
    await Promise.all(
      orderedIds.map(async (documentId, index) => {
        const meta = metaMap.get(documentId);
        if (!meta) {
          return;
        }
        await this.index.upsertWorkspaceDocumentMeta({
          ...meta,
          sortOrder: index + 1,
          updatedAt: nowIso()
        });
      })
    );
  }

  async listProjectDocumentVersions(projectId: string, documentId: string) {
    await this.ensureProjectStructure(projectId);
    return this.index.listWorkspaceDocumentVersions(projectId, documentId);
  }

  async getProjectDocumentVersion(projectId: string, documentId: string, versionId: string) {
    return readJsonFile<WorkspaceProjectDocument & { source: WorkspaceProjectDocumentVersion["source"]; versionNumber: number }>(
      this.documentVersionPath(projectId, documentId, versionId)
    );
  }

  async getRequirementCollection(projectId: string) {
    return readJsonFile<WorkspaceRequirementCollection>(this.intakePath(projectId));
  }

  async listRequirementCollectionVersions(projectId: string) {
    await this.ensureProjectStructure(projectId);
    const entries = await readdir(this.intakeVersionsDir(projectId)).catch(() => []);
    const versions = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => readJsonFile<WorkspaceRequirementCollectionVersion>(this.context.path(this.intakeVersionsDir(projectId), entry)))
    );

    return versions.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  async getRequirementCollectionVersion(projectId: string, versionId: string) {
    return readJsonFile<WorkspaceRequirementCollectionVersion>(this.context.path(this.intakeVersionsDir(projectId), `${versionId}.json`));
  }

  async saveRequirementStructure(
    projectId: string,
    structure: WorkspaceRequirementStructure,
    source: WorkspaceRequirementStructureVersion["source"] = "ai"
  ) {
    await this.ensureProjectStructure(projectId);
    const previous = await this.getRequirementStructure(projectId).catch(() => null);
    await writeJsonFile(this.requirementStructurePath(projectId), structure);
    await writeFile(
      this.requirementStructureMarkdownPath(projectId),
      structure.documentMarkdown.endsWith("\n") ? structure.documentMarkdown : `${structure.documentMarkdown}\n`,
      "utf-8"
    );
    await writeFile(
      this.requirementStructureHtmlPath(projectId),
      structure.documentHtml,
      "utf-8"
    );

    const shouldCreateVersion = !previous
      || previous.documentMarkdown !== structure.documentMarkdown
      || previous.documentHtml !== structure.documentHtml;

    if (shouldCreateVersion) {
      const version: WorkspaceRequirementStructureVersion = {
        id: `${Date.now()}`,
        createdAt: structure.lastEditedAt ?? structure.lastGeneratedAt ?? nowIso(),
        source,
        summary: structure.coreFunctions.slice(0, 3).join(" / ") || "结构化需求版本",
        documentMarkdown: structure.documentMarkdown,
        documentHtml: structure.documentHtml
      };
      await writeJsonFile(this.context.path(this.requirementStructureVersionsDir(projectId), `${version.id}.json`), version);
    }
  }

  async getRequirementStructure(projectId: string) {
    return readJsonFile<WorkspaceRequirementStructure>(this.requirementStructurePath(projectId));
  }

  async listRequirementStructureVersions(projectId: string) {
    await this.ensureProjectStructure(projectId);
    const entries = await readdir(this.requirementStructureVersionsDir(projectId)).catch(() => []);
    const versions = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => readJsonFile<WorkspaceRequirementStructureVersion>(this.context.path(this.requirementStructureVersionsDir(projectId), entry)))
    );
    return versions.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  async getRequirementStructureVersion(projectId: string, versionId: string) {
    return readJsonFile<WorkspaceRequirementStructureVersion>(
      this.context.path(this.requirementStructureVersionsDir(projectId), `${versionId}.json`)
    );
  }

  async saveStageDocument(
    projectId: string,
    stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
    document: WorkspaceStageDocument,
    source: WorkspaceStageDocumentVersion["source"] = "ai"
  ) {
    await this.ensureProjectStructure(projectId);
    const previous = await this.getStageDocument(projectId, stage).catch(() => null);
    await writeJsonFile(this.stageDocumentJsonPath(projectId, stage), document);
    await writeFile(
      this.stageDocumentMarkdownPath(projectId, stage),
      document.documentMarkdown.endsWith("\n") ? document.documentMarkdown : `${document.documentMarkdown}\n`,
      "utf-8"
    );
    await writeFile(this.stageDocumentHtmlPath(projectId, stage), document.documentHtml, "utf-8");

    const shouldCreateVersion = !previous
      || previous.documentMarkdown !== document.documentMarkdown
      || previous.documentHtml !== document.documentHtml
      || previous.summary !== document.summary;

    if (shouldCreateVersion) {
      const version: WorkspaceStageDocumentVersion = {
        id: `${Date.now()}`,
        createdAt: document.lastEditedAt ?? document.lastGeneratedAt ?? nowIso(),
        source,
        summary: document.summary,
        documentMarkdown: document.documentMarkdown,
        documentHtml: document.documentHtml
      };
      await writeJsonFile(this.context.path(this.stageDocumentVersionsDir(projectId, stage), `${version.id}.json`), version);
    }
  }

  async getStageDocument(projectId: string, stage: "requirement-clarification" | "product-model" | "prd" | "prototype") {
    return readJsonFile<WorkspaceStageDocument>(this.stageDocumentJsonPath(projectId, stage));
  }

  async listStageDocumentVersions(projectId: string, stage: "requirement-clarification" | "product-model" | "prd" | "prototype") {
    await this.ensureProjectStructure(projectId);
    const entries = await readdir(this.stageDocumentVersionsDir(projectId, stage)).catch(() => []);
    const versions = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => readJsonFile<WorkspaceStageDocumentVersion>(this.context.path(this.stageDocumentVersionsDir(projectId, stage), entry)))
    );
    return versions.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  async getStageDocumentVersion(
    projectId: string,
    stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
    versionId: string
  ) {
    return readJsonFile<WorkspaceStageDocumentVersion>(this.context.path(this.stageDocumentVersionsDir(projectId, stage), `${versionId}.json`));
  }

  async saveSourceFile(projectId: string, fileName: string, bytes: Buffer) {
    await this.ensureProjectStructure(projectId);
    const safeName = `${Date.now()}-${basename(fileName).replace(/[^\w.-]+/g, "-")}`;
    const fullPath = this.context.path("workspace", "projects", projectId, "requirement-collection", "source-files", safeName);
    await writeFile(fullPath, bytes);
    return {
      fullPath,
      storedFilename: safeName,
      relativePath: `requirement-collection/source-files/${safeName}`,
      extension: extname(fileName).toLowerCase()
    };
  }

  async readSourceFile(projectId: string, storedFilename: string) {
    return readFile(this.projectSourceFilePath(projectId, storedFilename));
  }

  async saveDesignAsset(projectId: string, fileName: string, bytes: Buffer) {
    await this.ensureProjectStructure(projectId);
    const safeName = `${Date.now()}-${basename(fileName).replace(/[^\w.-]+/g, "-")}`;
    const fullPath = this.projectDesignAssetPath(projectId, safeName);
    await writeFile(fullPath, bytes);
    return {
      fullPath,
      storedFilename: safeName,
      relativePath: `design/assets/${safeName}`,
      extension: extname(fileName).toLowerCase()
    };
  }

  async readDesignAsset(projectId: string, storedFilename: string) {
    return readFile(this.projectDesignAssetPath(projectId, storedFilename));
  }

  async saveLlmSettings(projectId: string, settings: WorkspaceLlmSettings, apiKey?: string) {
    await this.ensureProjectStructure(projectId);
    await writeJsonFile(this.llmSettingsPath(projectId), settings);
    if (apiKey) {
      await writeJsonFile(this.llmSecretsPath(projectId), { apiKey });
    }
  }

  async getLlmSettings(projectId: string) {
    try {
      return await readJsonFile<WorkspaceLlmSettings>(this.llmSettingsPath(projectId));
    } catch {
      return defaultLlmSettings;
    }
  }

  async getStoredApiKey(projectId: string) {
    try {
      const value = await readJsonFile<{ apiKey?: string }>(this.llmSecretsPath(projectId));
      return value.apiKey;
    } catch {
      return undefined;
    }
  }

  async saveMainAgentRun(
    projectId: string,
    decision: WorkspaceMainAgentDecision,
    taskPlan: WorkspaceStageTaskPlan
  ) {
    await this.ensureProjectStructure(projectId);
    const loggedAt = nowIso();
    const safeRunId = decision.runId.replace(/[^\w.-]+/g, "-");
    const log: WorkspaceMainAgentRunLog = {
      id: `${Date.now()}-${safeRunId}`,
      projectId,
      currentStage: decision.currentStage,
      loggedAt,
      decision,
      taskPlan
    };

    await writeJsonFile(this.context.path(this.agentRunsDir(projectId), `${log.id}.json`), log);
    await writeJsonFile(this.agentLatestDecisionPath(projectId), log);
  }

  createDefaultStageState(): WorkspaceStageStateRecord[] {
    const now = nowIso();
    return stageTemplates.map((stage, index) => ({
      stage: stage.type,
      status: index === 0 ? "in-progress" : "not-started",
      updatedAt: now
    }));
  }

  createDefaultProject(input: {
    id: string;
    name: string;
    description: string;
    industry?: string;
    systemPrompt?: string;
    llmSettings?: Partial<WorkspaceLlmSettings>;
  }): WorkspaceProject {
    const now = nowIso();
    return {
      id: input.id,
      name: input.name,
      description: input.description,
      industry: input.industry,
      systemPrompt: input.systemPrompt,
      createdAt: now,
      updatedAt: now,
      currentStage: "requirement-collection",
      llmSettings: {
        ...defaultLlmSettings,
        ...(input.llmSettings ?? {}),
        stageModelRouting: {
          ...defaultLlmSettings.stageModelRouting,
          ...(input.llmSettings?.stageModelRouting ?? {})
        }
      }
    };
  }

  async buildBundle(projectId: string): Promise<WorkspaceBundle> {
    const project = await this.getProject(projectId);
    const stageState = await this.getStageState(projectId);

    let collection: WorkspaceRequirementCollection | null = null;
    let structure: WorkspaceRequirementStructure | null = null;
    let clarification: WorkspaceStageDocument | null = null;
    let productModel: WorkspaceStageDocument | null = null;
    let prd: WorkspaceStageDocument | null = null;
    let prototype: WorkspaceStageDocument | null = null;
    let collectionVersions: WorkspaceRequirementCollectionVersion[] = [];
    let structureVersions: WorkspaceRequirementStructureVersion[] = [];
    let clarificationVersions: WorkspaceStageDocumentVersion[] = [];
    let productModelVersions: WorkspaceStageDocumentVersion[] = [];
    let prdVersions: WorkspaceStageDocumentVersion[] = [];
    let prototypeVersions: WorkspaceStageDocumentVersion[] = [];

    try {
      collection = await this.getRequirementCollection(projectId);
      if (!collection.sourceRecords) {
        collection = {
          ...collection,
          sourceRecords: collection.rawInputs.map((content, index) => ({
            id: `${Date.now()}-legacy-${index}`,
            content,
            createdAt: collection?.lastEditedAt ?? collection?.lastOrganizedAt ?? nowIso(),
            updatedAt: collection?.lastEditedAt ?? collection?.lastOrganizedAt ?? nowIso()
          }))
        };
      }
    } catch {}

    try {
      collectionVersions = await this.listRequirementCollectionVersions(projectId);
    } catch {}

    try {
      structure = await this.getRequirementStructure(projectId);
    } catch {}

    try {
      structureVersions = await this.listRequirementStructureVersions(projectId);
    } catch {}

    try {
      clarification = await this.getStageDocument(projectId, "requirement-clarification");
    } catch {}

    try {
      clarificationVersions = await this.listStageDocumentVersions(projectId, "requirement-clarification");
    } catch {}

    try {
      productModel = await this.getStageDocument(projectId, "product-model");
    } catch {}

    try {
      productModelVersions = await this.listStageDocumentVersions(projectId, "product-model");
    } catch {}

    try {
      prd = await this.getStageDocument(projectId, "prd");
    } catch {}

    try {
      prdVersions = await this.listStageDocumentVersions(projectId, "prd");
    } catch {}

    try {
      prototype = await this.getStageDocument(projectId, "prototype");
    } catch {}

    try {
      prototypeVersions = await this.listStageDocumentVersions(projectId, "prototype");
    } catch {}

    const stages: WorkspaceStage[] = stageTemplates.map((template) => {
      const state = stageState.find((item) => item.stage === template.type);
      const artifacts = [];

      if (template.type === "requirement-collection" && collection) {
        artifacts.push({
          id: "artifact-requirement-collection",
          type: "requirement-input" as const,
          name: "需求点文档",
          content: collection,
          version: Math.max(collectionVersions.length, 1),
          createdAt: collection.lastOrganizedAt,
          updatedAt: collection.lastEditedAt ?? collection.lastOrganizedAt
        });
      }

      if (template.type === "requirement-structure" && structure) {
        artifacts.push({
          id: "artifact-requirement-structure",
          type: "requirement-structure" as const,
          name: "结构化需求文档",
          content: structure,
          version: Math.max(structureVersions.length, 1),
          createdAt: state?.updatedAt ?? project.updatedAt,
          updatedAt: structure.lastEditedAt ?? structure.lastGeneratedAt ?? state?.updatedAt ?? project.updatedAt
        });
      }

      if (template.type === "requirement-clarification" && clarification) {
        artifacts.push({
          id: "artifact-requirement-clarification",
          type: "clarification-qa" as const,
          name: clarification.title,
          content: clarification,
          version: Math.max(clarificationVersions.length, 1),
          createdAt: clarification.lastGeneratedAt ?? state?.updatedAt ?? project.updatedAt,
          updatedAt: clarification.lastEditedAt ?? clarification.lastGeneratedAt ?? state?.updatedAt ?? project.updatedAt
        });
      }

      if (template.type === "product-model" && productModel) {
        artifacts.push({
          id: "artifact-product-model",
          type: "product-model" as const,
          name: productModel.title,
          content: productModel,
          version: Math.max(productModelVersions.length, 1),
          createdAt: productModel.lastGeneratedAt ?? state?.updatedAt ?? project.updatedAt,
          updatedAt: productModel.lastEditedAt ?? productModel.lastGeneratedAt ?? state?.updatedAt ?? project.updatedAt
        });
      }

      if (template.type === "prd" && prd) {
        artifacts.push({
          id: "artifact-prd",
          type: "prd-document" as const,
          name: prd.title,
          content: prd,
          version: Math.max(prdVersions.length, 1),
          createdAt: prd.lastGeneratedAt ?? state?.updatedAt ?? project.updatedAt,
          updatedAt: prd.lastEditedAt ?? prd.lastGeneratedAt ?? state?.updatedAt ?? project.updatedAt
        });
      }

      if (template.type === "prototype" && prototype) {
        artifacts.push({
          id: "artifact-prototype",
          type: "prototype-canvas" as const,
          name: prototype.title,
          content: prototype,
          version: Math.max(prototypeVersions.length, 1),
          createdAt: prototype.lastGeneratedAt ?? state?.updatedAt ?? project.updatedAt,
          updatedAt: prototype.lastEditedAt ?? prototype.lastGeneratedAt ?? state?.updatedAt ?? project.updatedAt
        });
      }

      return {
        ...template,
        status: state?.status ?? "not-started",
        artifacts
      };
    });

    return { project, stages };
  }
}

function buildWorkspaceDocumentSummary(document: WorkspaceProjectDocument) {
  const text = document.contentText.trim().replace(/\s+/g, " ");
  if (!text) {
    return document.title;
  }
  return text.slice(0, 120);
}

function safePathSegment(value: string) {
  return value.replace(/[^a-z0-9._-]/gi, "_").slice(0, 160) || "page";
}
