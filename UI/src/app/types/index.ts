// 项目类型定义
export interface Project {
  id: string;
  name: string;
  description: string;
  industry?: string;
  systemPrompt?: string;
  llmSettings?: {
    provider: "openai" | "openai-compatible";
    baseUrl?: string;
    modelProfile: "quality" | "balanced" | "cost-saving";
    apiKeyConfigured?: boolean;
    stageModelRouting?: Partial<Record<"capture" | "structure", string>>;
  };
  createdAt: string;
  updatedAt: string;
  currentStage: StageType;
}

// 阶段类型
export type StageType = 
  | 'requirement-collection'
  | 'requirement-structure'
  | 'requirement-clarification'
  | 'product-model'
  | 'prd'
  | 'prototype'
  | 'prototype-annotation'
  | 'ui-draft'
  | 'review';

// 阶段状态
export type StageStatus = 'not-started' | 'in-progress' | 'pending-review' | 'completed';
export type OrchestrationStatus = 'planning' | 'executing' | 'reviewing' | 'awaiting_user_confirmation' | 'blocked';

// 阶段定义
export interface Stage {
  type: StageType;
  name: string;
  description: string;
  status: StageStatus;
  artifacts: Artifact[];
}

// 产物类型
export type ArtifactType = 
  | 'requirement-input'
  | 'requirement-structure'
  | 'clarification-qa'
  | 'product-model'
  | 'prd-document'
  | 'prototype-canvas'
  | 'annotation'
  | 'ui-design';

// 产物
export interface Artifact {
  id: string;
  type: ArtifactType;
  name: string;
  content: any;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// 聊天消息
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  type?: 'question' | 'review' | 'suggestion' | 'normal';
  parentId?: string;
  mode?: 'capture' | 'suggestion' | 'clarify' | 'answer';
  captured?: boolean;
  editedAt?: string;
  detailsTitle?: string;
  detailsContent?: string;
}

export interface WorkspaceRequirementItem {
  id: string;
  title: string;
  description: string;
  status: "pending" | "confirmed" | "rejected";
  priority: "P0" | "P1" | "P2";
  module: string;
  parentId: string | null;
  order: number;
  type: "feature" | "flow" | "rule";
  tags: string[];
  source: "manual" | "ai" | "file";
  confidence: "manual" | "ai" | "reviewed";
  linkedSourceRecordId?: string;
  customFields?: Record<string, string>;
  deleted?: boolean;
  mindMapStyle?: {
    fillColor?: string;
    textColor?: string;
    width?: number;
    height?: number;
    positionX?: number;
    positionY?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceViewMode = "table" | "tree" | "mindmap" | "business-model" | "documents";

export interface WorkspaceRequirementDocument {
  id: string;
  title: string;
  contentHtml: string;
  contentText: string;
  contentBlocks?: unknown[];
  createdAt: string;
  updatedAt: string;
}

export type BusinessModelMode = "flow" | "state";
export type BusinessModelNodeType = "action" | "state";

export interface WorkspaceBusinessModelNode {
  id: string;
  type: BusinessModelNodeType;
  label: string;
  relatedRequirementIds: string[];
  position: {
    x: number;
    y: number;
  };
  meta?: {
    module?: string;
    priority?: "P0" | "P1" | "P2";
  };
}

export interface WorkspaceBusinessModelEdge {
  id: string;
  source: string;
  target: string;
  action?: string;
}

export interface WorkspaceBusinessModelGraph {
  nodes: WorkspaceBusinessModelNode[];
  edges: WorkspaceBusinessModelEdge[];
  mode: BusinessModelMode;
  version: number;
  updatedAt: string;
  flowSnapshot?: {
    nodes: WorkspaceBusinessModelNode[];
    edges: WorkspaceBusinessModelEdge[];
  };
  stateSnapshot?: {
    nodes: WorkspaceBusinessModelNode[];
    edges: WorkspaceBusinessModelEdge[];
  };
  counterpartMap?: Record<string, string[]>;
}

export type WorkspaceCustomColumnType = "text" | "select";

export interface WorkspaceCustomColumn {
  id: string;
  name: string;
  type: WorkspaceCustomColumnType;
  options?: string[];
  width: number;
  visible: boolean;
}

export interface WorkspaceSavedView {
  id: string;
  name: string;
  preferredViewMode: WorkspaceViewMode;
  searchQuery: string;
  statusFilter: "all" | WorkspaceRequirementItem["status"];
  priorityFilter: "all" | WorkspaceRequirementItem["priority"];
  visibleColumns: {
    status: boolean;
    priority: boolean;
    module: boolean;
    description: boolean;
  };
  columnWidths: {
    control: number;
    title: number;
    status: number;
    priority: number;
    module: number;
    description: number;
  };
  sortKey: "order" | "title" | "status" | "priority" | "module" | "updatedAt";
  sortDirection: "asc" | "desc";
  moduleFilter: string;
}

export interface WorkspaceViewConfig {
  activeViewId: string;
  defaultViewId: string;
  savedViews: WorkspaceSavedView[];
  customColumns: WorkspaceCustomColumn[];
}

export interface UploadedSourceFile {
  id: string;
  name: string;
  storedFilename?: string;
  relativePath?: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  extractionStatus: 'parsed' | 'metadata-only';
  extractedTextExcerpt?: string;
  note?: string;
}

export interface RequirementSourceRecord {
  id: string;
  content: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementSourceSummary {
  id: string;
  title: string;
  sourceType: "record" | "file";
  summary: string;
  keyPoints: string[];
  candidateUserGoals: string[];
  candidateScenarios: string[];
  candidateFunctions: string[];
  candidateConstraints: string[];
  openQuestions: string[];
}

export interface RequirementPointSection {
  id: string;
  title: string;
  items: string[];
}

export interface RequirementCollectionArtifactContent {
  projectName: string;
  rawInputs: string[];
  sourceRecords: RequirementSourceRecord[];
  uploadedFiles: UploadedSourceFile[];
  sourceSummaries?: RequirementSourceSummary[];
  requirementPointSections?: RequirementPointSection[];
  extractedHighlights: string[];
  aiSummary: string;
  requirementsDocument: string;
  requirementsDocumentHtml: string;
  structuredSnapshot: {
    userGoals: string[];
    coreScenarios: string[];
    coreFunctions: string[];
    constraints: string[];
  };
  sourceDirty?: boolean;
  lastSourceUpdatedAt?: string;
  lastOrganizedSourceUpdatedAt?: string;
  followupQuestions: string[];
  lastOrganizedAt: string;
  lastEditedAt?: string;
}

export interface RequirementCollectionVersion {
  id: string;
  createdAt: string;
  source: "ai" | "manual" | "rollback";
  summary: string;
  requirementsDocument: string;
  requirementsDocumentHtml: string;
}

// 需求结构
export interface RequirementStructure {
  userGoals: string[];
  coreScenarios: string[];
  coreFunctions: string[];
  scope: {
    inScope: string[];
    outOfScope: string[];
  };
  risks: string[];
  clarificationNeeded: string[];
  documentMarkdown: string;
  documentHtml: string;
  lastGeneratedAt?: string;
  lastEditedAt?: string;
}

export interface RequirementStructureVersion {
  id: string;
  createdAt: string;
  source: "ai" | "manual" | "rollback";
  summary: string;
  documentMarkdown: string;
  documentHtml: string;
}

export interface StageDocumentSection {
  id: string;
  title: string;
  body?: string;
  items?: string[];
}

export interface StageDocument {
  stage: "requirement-clarification" | "product-model" | "prd" | "prototype";
  title: string;
  summary: string;
  documentMarkdown: string;
  documentHtml: string;
  sections: StageDocumentSection[];
  lastGeneratedAt?: string;
  lastEditedAt?: string;
}

export interface StageDocumentVersion {
  id: string;
  createdAt: string;
  source: "ai" | "manual" | "rollback";
  summary: string;
  documentMarkdown: string;
  documentHtml: string;
}

export interface StagePlanInput {
  sourceType: 'user_message' | 'source_record' | 'uploaded_file' | 'artifact' | 'review_result' | 'constraint';
  sourceId: string;
  label: string;
  required: boolean;
  satisfied: boolean;
  note?: string;
}

export interface StagePlanTask {
  taskId: string;
  title: string;
  description: string;
  taskType: 'analyze' | 'extract' | 'summarize' | 'clarify' | 'model' | 'draft' | 'annotate' | 'review' | 'patch' | 'export';
  status: 'pending' | 'running' | 'completed' | 'blocked';
  dependsOn?: string[];
  outputTargets: string[];
  doneWhen: string[];
  blockerReason?: string;
}

export interface StageReviewItem {
  id: string;
  label: string;
  required: boolean;
  passed: boolean;
  message?: string;
}

export interface AdvanceGate {
  nextStage?: StageType;
  canAdvance: boolean;
  blockingIssues: string[];
  warnings: string[];
  requiresUserConfirmation: boolean;
}

export interface StageTaskPlan {
  planId: string;
  projectId: string;
  stage: StageType;
  agentType: string;
  generatedAt: string;
  status: 'planned' | 'running' | 'completed' | 'blocked';
  stageGoal: string;
  inputs: StagePlanInput[];
  tasks: StagePlanTask[];
  reviewChecklist: StageReviewItem[];
  advanceGate: AdvanceGate;
  recommendedUserActions: string[];
}

export interface MainAgentDecision {
  runId: string;
  currentStage: StageType;
  orchestrationStatus: OrchestrationStatus;
  stageGoal: string;
  shouldRunStageAgent: boolean;
  stageAgentType?: string;
  shouldRunReview: boolean;
  canAdvance: boolean;
  suggestedNextStage?: StageType;
  userConfirmationRequired: boolean;
  blockers: string[];
  warnings: string[];
  suggestedActions: string[];
  responseCard: {
    status: "blocked" | "working" | "ready";
    headline: string;
    summary: string;
    bullets: string[];
    ctaLabel?: string;
  };
  chatResponse: string;
}

// 产品模型
export interface ProductModel {
  targetUsers: {
    name: string;
    description: string;
    needs: string[];
  }[];
  functions: {
    name: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
  }[];
  pages: {
    name: string;
    description: string;
    sections: string[];
  }[];
  flows: {
    name: string;
    steps: string[];
  }[];
  constraints: string[];
}
