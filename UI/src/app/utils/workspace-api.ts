import type {
  MainAgentDecision,
  Project,
  RequirementCollectionVersion,
  RequirementStructureVersion,
  Stage,
  StageDocumentVersion,
  StageTaskPlan,
  StageType,
  WorkspaceRequirementDocument,
  WorkspaceRequirementDocumentVersion
} from "../types";

export interface WorkspaceBundleResponse {
  project: Project;
  stages: Stage[];
  mainAgentDecision?: MainAgentDecision;
  currentStageTaskPlan?: StageTaskPlan;
}

export interface WorkspaceLlmSettingsUpdateResponse {
  bundle: WorkspaceBundleResponse;
  validation: {
    ok: boolean;
    model: string;
    baseUrl: string;
    message: string;
  };
}

export type WorkspaceDesignNodeType =
  | "frame"
  | "container"
  | "text"
  | "button"
  | "input"
  | "table"
  | "card"
  | "image";

export interface WorkspaceDesignNode {
  id: string;
  type: WorkspaceDesignNodeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth?: number;
  radius: number;
  text?: string;
  textColor: string;
  fontSize: number;
  lineHeight?: number;
  textAlign?: "left" | "center" | "right" | "justify";
  visible: boolean;
  locked: boolean;
  imageUrl?: string;
  fillImageUrl?: string;
  svgPath?: string;
  svgFillRule?: "nonzero" | "evenodd";
  clipBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  clipPath?: {
    x: number;
    y: number;
    width: number;
    height: number;
    svgPath: string;
    fillRule?: "nonzero" | "evenodd";
  };
  sourceRef?: string;
  sourceLayerClass?: string;
  opacity?: number;
  rotation?: number;
  blendMode?: string;
  blurRadius?: number;
  fontFamily?: string;
  fontWeight?: number;
  letterSpacing?: number;
  flippedHorizontal?: boolean;
  flippedVertical?: boolean;
  shadow?: string;
  zIndex?: number;
}

export interface WorkspaceDesignPage {
  id: string;
  name: string;
  nodes: WorkspaceDesignNode[];
}

export interface WorkspaceDesignComponent {
  id: string;
  name: string;
  sourceFileName: string;
  nodeCount: number;
  nodes: WorkspaceDesignNode[];
}

export interface WorkspaceDesignAsset {
  id: string;
  name: string;
  sourceFileName: string;
  type: "image";
  mimeType: string;
  url: string;
  sourceRef?: string;
  width?: number;
  height?: number;
}

export interface WorkspaceDesignImportResult {
  pages: WorkspaceDesignPage[];
  components: WorkspaceDesignComponent[];
  assets: WorkspaceDesignAsset[];
}

interface WorkspaceDocumentApiRecord {
  id: string;
  projectId: string;
  title: string;
  sortOrder: number;
  deleted: boolean;
  contentBlocks: unknown[];
  contentHtml: string;
  contentText: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceDocumentVersionApiRecord {
  id: string;
  documentId: string;
  projectId: string;
  versionNumber: number;
  source: "manual" | "ai" | "import" | "rollback";
  summary: string;
  snapshotFilePath: string;
  createdAt: string;
}

interface BundleStreamStartedEvent {
  streamId: string;
  projectId: string;
}

interface BundleStatusEvent {
  streamId: string;
  status: string;
}

interface BundleLlmDeltaEvent {
  streamId: string;
  source: "stage-plan" | "main-agent";
  delta: string;
}

interface BundlePayloadEvent {
  streamId: string;
  bundle: WorkspaceBundleResponse;
}

interface BundleEndEvent {
  streamId: string;
  message?: string;
}

interface AssistantModelOutput {
  source: "llm" | "fallback";
  model?: string;
  details: {
    currentStage: StageType;
    chatDecision: {
      mode: "capture" | "suggestion" | "clarify" | "answer";
      shouldCapture: boolean;
      reply: string;
      guidance: string[];
    };
    collectionSummary?: {
      aiSummary?: string;
      followupQuestions?: string[];
      structuredSnapshot?: {
        userGoals?: string[];
        coreScenarios?: string[];
        coreFunctions?: string[];
        constraints?: string[];
      };
    };
    mainAgentDecision?: MainAgentDecision | null;
    currentStageTaskPlan?: StageTaskPlan | null;
  };
}

interface WorkspaceChatResponse {
  bundle: WorkspaceBundleResponse;
  assistant: {
    role: "assistant";
    type: "question" | "review" | "suggestion" | "normal";
    mode: "capture" | "suggestion" | "clarify" | "answer";
    captured: boolean;
    reply: string;
    guidance: string[];
    modelOutput?: AssistantModelOutput;
    collection?: {
      aiSummary?: string;
      rawInputs?: string[];
      uploadedFiles?: Array<{
        id: string;
        name: string;
        storedFilename?: string;
        relativePath?: string;
        mimeType: string;
        size: number;
        uploadedAt: string;
        extractionStatus: "parsed" | "metadata-only";
        extractedTextExcerpt?: string;
        note?: string;
      }>;
      extractedHighlights?: string[];
      structuredSnapshot?: {
        userGoals?: string[];
        coreScenarios?: string[];
        coreFunctions?: string[];
        constraints?: string[];
      };
      followupQuestions?: string[];
    };
  };
}

interface ChatStreamEventPayloads {
  status: { status: string };
  llm_delta: { source: "chat-decision" | "source-summary" | "collection-organize"; delta: string };
  bundle: { bundle: WorkspaceBundleResponse };
  assistant: { assistant: WorkspaceChatResponse["assistant"] };
  done: { ok: true };
  cancelled: { message?: string };
  chat_error: { message?: string };
}

export async function createWorkspaceProject(input: {
  id: string;
  name: string;
  description: string;
  industry?: string;
  systemPrompt?: string;
  llmSettings?: Project["llmSettings"];
  apiKey?: string;
}) {
  return requestJson<WorkspaceBundleResponse>("/api/workspace/projects", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function bootstrapWorkspaceProject(project: Project) {
  return createWorkspaceProject({
    id: project.id,
    name: project.name,
    description: project.description,
    industry: project.industry,
    systemPrompt: project.systemPrompt,
    llmSettings: project.llmSettings
      ? {
          provider: project.llmSettings.provider,
          baseUrl: project.llmSettings.baseUrl,
          modelProfile: project.llmSettings.modelProfile,
          stageModelRouting: project.llmSettings.stageModelRouting
        }
      : undefined
  });
}

export async function getWorkspaceBundle(projectId: string) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/bundle`);
}

export function streamWorkspaceBundle(
  projectId: string,
  handlers: {
    onStreamStarted?: (event: BundleStreamStartedEvent) => void;
    onStatus?: (event: BundleStatusEvent) => void;
    onLlmDelta?: (event: BundleLlmDeltaEvent) => void;
    onBundle?: (bundle: WorkspaceBundleResponse) => void;
    onDone?: () => void;
    onCancelled?: (event: BundleEndEvent) => void;
    onError?: (message: string) => void;
  }
) {
  const controller = new AbortController();
  let streamId: string | null = null;

  const promise = (async () => {
    const response = await fetch(`/api/workspace/projects/${projectId}/bundle?stream=1`, {
      headers: {
        Accept: "text/event-stream"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    if (!response.body) {
      throw new Error("Bundle stream response missing body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let latestBundle: WorkspaceBundleResponse | null = null;

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      let boundary = findSseBoundary(buffer);
      while (boundary) {
        const rawEvent = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const parsed = parseSseEvent(rawEvent);

        if (parsed) {
          switch (parsed.event) {
            case "stream_started": {
              const payload = JSON.parse(parsed.data) as BundleStreamStartedEvent;
              streamId = payload.streamId;
              handlers.onStreamStarted?.(payload);
              break;
            }
            case "status":
              handlers.onStatus?.(JSON.parse(parsed.data) as BundleStatusEvent);
              break;
            case "llm_delta":
              handlers.onLlmDelta?.(JSON.parse(parsed.data) as BundleLlmDeltaEvent);
              break;
            case "bundle": {
              const payload = JSON.parse(parsed.data) as BundlePayloadEvent;
              latestBundle = payload.bundle;
              handlers.onBundle?.(payload.bundle);
              break;
            }
            case "done":
              handlers.onDone?.();
              break;
            case "cancelled": {
              const payload = JSON.parse(parsed.data) as BundleEndEvent;
              handlers.onCancelled?.(payload);
              throw new Error(payload.message ?? "Bundle stream cancelled");
            }
            case "bundle_error": {
              const payload = JSON.parse(parsed.data) as BundleEndEvent;
              handlers.onError?.(payload.message ?? "Bundle stream failed");
              throw new Error(payload.message ?? "Bundle stream failed");
            }
          }
        }

        boundary = findSseBoundary(buffer);
      }

      if (done) {
        break;
      }
    }

    if (!latestBundle) {
      throw new Error("Bundle stream finished without bundle payload");
    }

    return latestBundle;
  })();

  return {
    promise,
    close: () => controller.abort(),
    cancel: async () => {
      controller.abort();
      if (streamId) {
        await requestJson(`/api/workspace/projects/${projectId}/bundle/streams/${streamId}/cancel`, {
          method: "POST"
        });
      }
    }
  };
}

export async function deleteWorkspaceProject(projectId: string) {
  const response = await fetch(`/api/workspace/projects/${projectId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function organizeRequirementInput(projectId: string, message: string) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/intake/message`, {
    method: "POST",
    body: JSON.stringify({ message })
  });
}

export async function chatInWorkspace(
  projectId: string,
  input: {
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  }
) {
  return requestJson<WorkspaceChatResponse>(`/api/workspace/projects/${projectId}/chat`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function streamChatInWorkspace(
  projectId: string,
  input: {
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  },
  handlers: {
    onStatus?: (status: string) => void;
    onLlmDelta?: (event: ChatStreamEventPayloads["llm_delta"]) => void;
    onBundle?: (bundle: WorkspaceBundleResponse) => void;
    onAssistant?: (assistant: WorkspaceChatResponse["assistant"]) => void;
    onDone?: () => void;
    onCancelled?: (message?: string) => void;
    onError?: (message: string) => void;
  }
) {
  const controller = new AbortController();

  const promise = (async () => {
    const response = await fetch(`/api/workspace/projects/${projectId}/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    if (!response.body) {
      throw new Error("Chat stream response missing body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let latestBundle: WorkspaceBundleResponse | null = null;
    let finalAssistant: WorkspaceChatResponse["assistant"] | null = null;

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      let boundary = findSseBoundary(buffer);
      while (boundary) {
        const rawEvent = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const parsed = parseSseEvent(rawEvent);
        if (parsed) {
          const payload = JSON.parse(parsed.data) as ChatStreamEventPayloads[keyof ChatStreamEventPayloads];
          switch (parsed.event) {
            case "status":
              handlers.onStatus?.((payload as ChatStreamEventPayloads["status"]).status);
              break;
            case "llm_delta":
              handlers.onLlmDelta?.(payload as ChatStreamEventPayloads["llm_delta"]);
              break;
            case "bundle":
              latestBundle = (payload as ChatStreamEventPayloads["bundle"]).bundle;
              handlers.onBundle?.(latestBundle);
              break;
            case "assistant":
              finalAssistant = (payload as ChatStreamEventPayloads["assistant"]).assistant;
              handlers.onAssistant?.(finalAssistant);
              break;
            case "done":
              handlers.onDone?.();
              break;
            case "cancelled":
              handlers.onCancelled?.((payload as ChatStreamEventPayloads["cancelled"]).message);
              throw new Error((payload as ChatStreamEventPayloads["cancelled"]).message ?? "Chat stream cancelled");
            case "chat_error":
              handlers.onError?.((payload as ChatStreamEventPayloads["chat_error"]).message ?? "Chat stream failed");
              throw new Error((payload as ChatStreamEventPayloads["chat_error"]).message ?? "Chat stream failed");
          }
        }
        boundary = findSseBoundary(buffer);
      }

      if (done) {
        break;
      }
    }

    if (!latestBundle || !finalAssistant) {
      throw new Error("Chat stream finished without assistant response");
    }

    return {
      bundle: latestBundle,
      assistant: finalAssistant
    };
  })();

  return {
    promise,
    cancel: () => controller.abort()
  };
}

export async function uploadRequirementFiles(projectId: string, files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const response = await fetch(`/api/workspace/projects/${projectId}/intake/files`, {
    method: "POST",
    body: formData
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<WorkspaceBundleResponse>;
}

export async function importAiDesignFile(projectId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`/api/workspace/projects/${projectId}/design/import`, {
    method: "POST",
    body: formData
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<WorkspaceDesignImportResult>;
}

export function getWorkspaceSourceFileUrl(projectId: string, fileId: string) {
  return `/api/workspace/projects/${projectId}/intake/files/${fileId}`;
}

export async function saveRequirementDocument(projectId: string, document: string) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/intake/document`, {
    method: "PUT",
    body: JSON.stringify({ document })
  });
}

export async function createRequirementSourceRecord(
  projectId: string,
  input: { content: string; parentId?: string }
) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/intake/records`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateRequirementSourceRecord(
  projectId: string,
  recordId: string,
  content: string
) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/intake/records/${recordId}`, {
    method: "PUT",
    body: JSON.stringify({ content })
  });
}

export async function deleteRequirementSourceRecord(projectId: string, recordId: string) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/intake/records/${recordId}`, {
    method: "DELETE"
  });
}

export async function getRequirementDocumentHistory(projectId: string) {
  return requestJson<RequirementCollectionVersion[]>(`/api/workspace/projects/${projectId}/intake/history`);
}

export async function rollbackRequirementDocumentVersion(projectId: string, versionId: string) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/intake/history/${versionId}/rollback`, {
    method: "POST"
  });
}

export async function organizeRequirementDocument(projectId: string, instruction?: string) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/intake/document/organize`, {
    method: "POST",
    body: JSON.stringify({ instruction })
  });
}

export async function rollbackWorkspaceStage(projectId: string, stage: StageType) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/stages/${stage}/rollback`, {
    method: "POST"
  });
}

export async function generateRequirementStructure(projectId: string) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/requirement-structure/generate`, {
    method: "POST"
  });
}

export async function confirmAdvanceToNextStage(projectId: string) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/advance`, {
    method: "POST"
  });
}

export async function generateWorkspaceStageDocument(
  projectId: string,
  stage: "requirement-clarification" | "product-model" | "prd" | "prototype"
) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/stages/${stage}/generate`, {
    method: "POST"
  });
}

export async function updateWorkspaceLlmSettings(
  projectId: string,
  input: {
    provider: "openai" | "openai-compatible";
    baseUrl?: string;
    modelProfile: "quality" | "balanced" | "cost-saving";
    stageModelRouting?: Partial<Record<"capture" | "structure", string>>;
    apiKey?: string;
  }
) {
  return requestJson<WorkspaceLlmSettingsUpdateResponse>(`/api/workspace/projects/${projectId}/settings/llm`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function listWorkspaceDocuments(projectId: string) {
  const response = await requestJson<WorkspaceDocumentApiRecord[]>(`/api/workspace/projects/${projectId}/documents`);
  return response.filter((document) => !document.deleted).map(mapWorkspaceDocumentRecord);
}

export async function createWorkspaceDocument(projectId: string, input?: { title?: string }) {
  const response = await requestJson<WorkspaceDocumentApiRecord>(`/api/workspace/projects/${projectId}/documents`, {
    method: "POST",
    body: JSON.stringify(input ?? {})
  });
  return mapWorkspaceDocumentRecord(response);
}

export async function getWorkspaceDocument(projectId: string, documentId: string) {
  const response = await requestJson<WorkspaceDocumentApiRecord>(`/api/workspace/projects/${projectId}/documents/${documentId}`);
  return mapWorkspaceDocumentRecord(response);
}

export async function saveWorkspaceDocument(
  projectId: string,
  documentId: string,
  document: WorkspaceRequirementDocument
) {
  const response = await requestJson<WorkspaceDocumentApiRecord>(`/api/workspace/projects/${projectId}/documents/${documentId}`, {
    method: "PUT",
    body: JSON.stringify({
      title: document.title,
      sortOrder: document.sortOrder ?? 0,
      contentBlocks: document.contentBlocks ?? [{ type: "paragraph", content: "" }],
      contentHtml: document.contentHtml,
      contentText: document.contentText
    })
  });
  return mapWorkspaceDocumentRecord(response);
}

export async function deleteWorkspaceDocument(projectId: string, documentId: string) {
  return requestJson<{ ok: true; projectId: string; documentId: string }>(`/api/workspace/projects/${projectId}/documents/${documentId}`, {
    method: "DELETE"
  });
}

export async function reorderWorkspaceDocuments(projectId: string, orderedIds: string[]) {
  const response = await requestJson<WorkspaceDocumentApiRecord[]>(`/api/workspace/projects/${projectId}/documents/order`, {
    method: "PUT",
    body: JSON.stringify({ orderedIds })
  });
  return response.filter((document) => !document.deleted).map(mapWorkspaceDocumentRecord);
}

export async function listWorkspaceDocumentVersions(projectId: string, documentId: string) {
  const response = await requestJson<WorkspaceDocumentVersionApiRecord[]>(`/api/workspace/projects/${projectId}/documents/${documentId}/versions`);
  return response.map(mapWorkspaceDocumentVersionRecord);
}

export async function getWorkspaceDocumentVersion(projectId: string, documentId: string, versionId: string) {
  const response = await requestJson<WorkspaceDocumentApiRecord & { versionNumber?: number; source?: string }>(
    `/api/workspace/projects/${projectId}/documents/${documentId}/versions/${versionId}`
  );
  return mapWorkspaceDocumentRecord(response);
}

export async function restoreWorkspaceDocumentVersion(projectId: string, documentId: string, versionId: string) {
  const response = await requestJson<WorkspaceDocumentApiRecord>(`/api/workspace/projects/${projectId}/documents/${documentId}/versions/${versionId}/restore`, {
    method: "POST"
  });
  return mapWorkspaceDocumentRecord(response);
}

export async function saveRequirementStructureDocument(projectId: string, document: string) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/requirement-structure/document`, {
    method: "PUT",
    body: JSON.stringify({ document })
  });
}

export async function getRequirementStructureHistory(projectId: string) {
  return requestJson<RequirementStructureVersion[]>(`/api/workspace/projects/${projectId}/requirement-structure/history`);
}

export async function rollbackRequirementStructureVersion(projectId: string, versionId: string) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/requirement-structure/history/${versionId}/rollback`, {
    method: "POST"
  });
}

export async function saveWorkspaceStageDocument(
  projectId: string,
  stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
  document: string
) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/stages/${stage}/document`, {
    method: "PUT",
    body: JSON.stringify({ document })
  });
}

export async function getWorkspaceStageDocumentHistory(
  projectId: string,
  stage: "requirement-clarification" | "product-model" | "prd" | "prototype"
) {
  return requestJson<StageDocumentVersion[]>(`/api/workspace/projects/${projectId}/stages/${stage}/history`);
}

export async function rollbackWorkspaceStageDocumentVersion(
  projectId: string,
  stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
  versionId: string
) {
  return requestJson<WorkspaceBundleResponse>(`/api/workspace/projects/${projectId}/stages/${stage}/history/${versionId}/rollback`, {
    method: "POST"
  });
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const hasJsonBody = typeof init?.body === "string";
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

function parseSseEvent(rawEvent: string) {
  const lines = rawEvent.split(/\r?\n/).filter(Boolean);
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n")
    .trim();

  if (!data) {
    return null;
  }

  return { event, data };
}

function findSseBoundary(buffer: string) {
  const crlfIndex = buffer.indexOf("\r\n\r\n");
  const lfIndex = buffer.indexOf("\n\n");

  if (crlfIndex === -1) {
    return lfIndex >= 0 ? { index: lfIndex, length: 2 } : null;
  }

  if (lfIndex === -1) {
    return { index: crlfIndex, length: 4 };
  }

  return crlfIndex < lfIndex
    ? { index: crlfIndex, length: 4 }
    : { index: lfIndex, length: 2 };
}

function mapWorkspaceDocumentRecord(document: WorkspaceDocumentApiRecord): WorkspaceRequirementDocument {
  return {
    id: document.id,
    title: document.title,
    sortOrder: document.sortOrder,
    contentBlocks: document.contentBlocks,
    contentHtml: document.contentHtml,
    contentText: document.contentText,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

function mapWorkspaceDocumentVersionRecord(version: WorkspaceDocumentVersionApiRecord): WorkspaceRequirementDocumentVersion {
  return {
    id: version.id,
    documentId: version.documentId,
    versionNumber: version.versionNumber,
    source: version.source,
    summary: version.summary,
    createdAt: version.createdAt
  };
}
