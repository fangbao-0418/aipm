export type WorkspaceStageType =
  | "requirement-collection"
  | "requirement-structure"
  | "requirement-clarification"
  | "product-model"
  | "prd"
  | "prototype"
  | "prototype-annotation"
  | "ui-draft"
  | "review";

export type WorkspaceStageStatus =
  | "not-started"
  | "in-progress"
  | "pending-review"
  | "completed";

export type WorkspaceOrchestrationStatus =
  | "planning"
  | "executing"
  | "reviewing"
  | "awaiting_user_confirmation"
  | "blocked";

export type WorkspaceArtifactType =
  | "requirement-input"
  | "requirement-structure"
  | "clarification-qa"
  | "product-model"
  | "prd-document"
  | "prototype-canvas"
  | "annotation"
  | "ui-design";

export interface WorkspaceArtifact {
  id: string;
  type: WorkspaceArtifactType;
  name: string;
  content: unknown;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceStage {
  type: WorkspaceStageType;
  name: string;
  description: string;
  status: WorkspaceStageStatus;
  artifacts: WorkspaceArtifact[];
}

export interface WorkspaceStageStateRecord {
  stage: WorkspaceStageType;
  status: WorkspaceStageStatus;
  updatedAt: string;
}

export interface WorkspaceLlmSettings {
  provider: "openai" | "openai-compatible";
  baseUrl?: string;
  modelProfile: "quality" | "balanced" | "cost-saving";
  apiKeyConfigured: boolean;
  stageModelRouting: Partial<Record<"capture" | "structure", string>>;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  description: string;
  industry?: string;
  systemPrompt?: string;
  createdAt: string;
  updatedAt: string;
  currentStage: WorkspaceStageType;
  llmSettings: WorkspaceLlmSettings;
}

export interface WorkspaceSourceFileRecord {
  id: string;
  name: string;
  storedFilename: string;
  relativePath: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  extractionStatus: "parsed" | "metadata-only";
  extractedTextExcerpt?: string;
  note?: string;
}

export interface WorkspaceRequirementSourceRecord {
  id: string;
  content: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRequirementSourceSummary {
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

export interface WorkspaceRequirementPointSection {
  id: string;
  title: string;
  items: string[];
}

export interface WorkspaceRequirementCollection {
  projectName: string;
  rawInputs: string[];
  sourceRecords: WorkspaceRequirementSourceRecord[];
  uploadedFiles: WorkspaceSourceFileRecord[];
  sourceSummaries?: WorkspaceRequirementSourceSummary[];
  requirementPointSections?: WorkspaceRequirementPointSection[];
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

export interface WorkspaceRequirementCollectionVersion {
  id: string;
  createdAt: string;
  source: "ai" | "manual" | "rollback";
  summary: string;
  requirementsDocument: string;
  requirementsDocumentHtml: string;
}

export interface WorkspaceRequirementStructure {
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

export interface WorkspaceRequirementStructureVersion {
  id: string;
  createdAt: string;
  source: "ai" | "manual" | "rollback";
  summary: string;
  documentMarkdown: string;
  documentHtml: string;
}

export interface WorkspaceStageDocumentSection {
  id: string;
  title: string;
  body?: string;
  items?: string[];
}

export interface WorkspaceStageDocument {
  stage: "requirement-clarification" | "product-model" | "prd" | "prototype";
  title: string;
  summary: string;
  documentMarkdown: string;
  documentHtml: string;
  sections: WorkspaceStageDocumentSection[];
  lastGeneratedAt?: string;
  lastEditedAt?: string;
}

export interface WorkspaceStageDocumentVersion {
  id: string;
  createdAt: string;
  source: "ai" | "manual" | "rollback";
  summary: string;
  documentMarkdown: string;
  documentHtml: string;
}

export interface WorkspaceStagePlanInput {
  sourceType:
    | "user_message"
    | "source_record"
    | "uploaded_file"
    | "artifact"
    | "review_result"
    | "constraint";
  sourceId: string;
  label: string;
  required: boolean;
  satisfied: boolean;
  note?: string;
}

export interface WorkspaceStagePlanTask {
  taskId: string;
  title: string;
  description: string;
  taskType:
    | "analyze"
    | "extract"
    | "summarize"
    | "clarify"
    | "model"
    | "draft"
    | "annotate"
    | "review"
    | "patch"
    | "export";
  status: "pending" | "running" | "completed" | "blocked";
  dependsOn?: string[];
  outputTargets: string[];
  doneWhen: string[];
  blockerReason?: string;
}

export interface WorkspaceStageReviewItem {
  id: string;
  label: string;
  required: boolean;
  passed: boolean;
  message?: string;
}

export interface WorkspaceAdvanceGate {
  nextStage?: WorkspaceStageType;
  canAdvance: boolean;
  blockingIssues: string[];
  warnings: string[];
  requiresUserConfirmation: boolean;
}

export interface WorkspaceStageTaskPlan {
  planId: string;
  projectId: string;
  stage: WorkspaceStageType;
  agentType: string;
  generatedAt: string;
  status: "planned" | "running" | "completed" | "blocked";
  stageGoal: string;
  inputs: WorkspaceStagePlanInput[];
  tasks: WorkspaceStagePlanTask[];
  reviewChecklist: WorkspaceStageReviewItem[];
  advanceGate: WorkspaceAdvanceGate;
  recommendedUserActions: string[];
}

export interface WorkspaceMainAgentDecision {
  runId: string;
  currentStage: WorkspaceStageType;
  orchestrationStatus: WorkspaceOrchestrationStatus;
  stageGoal: string;
  shouldRunStageAgent: boolean;
  stageAgentType?: string;
  shouldRunReview: boolean;
  canAdvance: boolean;
  suggestedNextStage?: WorkspaceStageType;
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

export interface WorkspaceMainAgentRunLog {
  id: string;
  projectId: string;
  currentStage: WorkspaceStageType;
  loggedAt: string;
  decision: WorkspaceMainAgentDecision;
  taskPlan: WorkspaceStageTaskPlan;
}

export interface WorkspaceBundle {
  project: WorkspaceProject;
  stages: WorkspaceStage[];
  mainAgentDecision?: WorkspaceMainAgentDecision;
  currentStageTaskPlan?: WorkspaceStageTaskPlan;
}
