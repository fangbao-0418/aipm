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

export type WorkspaceDesignNodeType =
  | "frame"
  | "container"
  | "text"
  | "button"
  | "input"
  | "table"
  | "card"
  | "image";

export interface WorkspaceDesignPoint {
  x: number;
  y: number;
}

export interface WorkspaceDesignColorStop {
  position: number;
  color: string;
}

export interface WorkspaceDesignGradientPaint {
  type: "linear" | "radial" | "angular" | "diamond";
  from: WorkspaceDesignPoint;
  to: WorkspaceDesignPoint;
  stops: WorkspaceDesignColorStop[];
}

export interface WorkspaceDesignPaint {
  kind: "solid" | "gradient" | "image";
  enabled: boolean;
  sourceIndex: number;
  css: string;
  color?: string;
  gradient?: WorkspaceDesignGradientPaint;
  imageRef?: string;
  imageUrl?: string;
  opacity?: number;
}

export interface WorkspaceDesignImageColorControls {
  isEnabled: boolean;
  brightness: number;
  contrast: number;
  hue: number;
  saturation: number;
}

export interface WorkspaceDesignNode {
  /** Stable node id inside the AI PM design schema. */
  id: string;
  /** Parent node id. Nodes are stored as a flat list, and hierarchy is reconstructed through this field. */
  parentId?: string;
  /** Import/render depth. Root canvas children are depth 0. */
  depth?: number;
  /** Normalized AI PM node type used by canvas rendering and agents. */
  type: WorkspaceDesignNodeType;
  /** Human-readable layer/component name. */
  name: string;
  /** Absolute canvas x coordinate after import normalization. */
  x: number;
  /** Absolute canvas y coordinate after import normalization. */
  y: number;
  /** Node width in canvas pixels. */
  width: number;
  /** Node height in canvas pixels. */
  height: number;
  /** CSS-compatible fill. Supports solid color, gradient, image fill, or transparent. */
  fill: string;
  /** Parsed Sketch/Figma fill paint layers. Disabled layers are preserved but not rendered. */
  fills?: WorkspaceDesignPaint[];
  /** CSS-compatible stroke color or gradient. */
  stroke: string;
  /** Parsed Sketch/Figma border paint layers. Disabled layers are preserved but not rendered. */
  borders?: WorkspaceDesignPaint[];
  /** Stroke thickness in canvas pixels. */
  strokeWidth?: number;
  /** Sketch/Figma-like stroke alignment. */
  strokePosition?: "center" | "inside" | "outside";
  /** SVG/CSS stroke dash pattern. */
  strokeDashPattern?: number[];
  /** SVG/CSS stroke line cap. */
  strokeLineCap?: "butt" | "round" | "square";
  /** SVG/CSS stroke line join. */
  strokeLineJoin?: "miter" | "round" | "bevel";
  /** Corner radius. Oval-like nodes use a very large radius. */
  radius: number;
  /** Plain text content for text/button/table-like nodes. */
  text?: string;
  /** Rich text runs preserved from imported attributed text. */
  textRuns?: Array<{
    text: string;
    color?: string;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number;
    letterSpacing?: number;
    underline?: boolean;
    strikethrough?: boolean;
  }>;
  /** Default text color when rich runs are absent. */
  textColor: string;
  /** Default font size when rich runs are absent. */
  fontSize: number;
  /** Line height in canvas pixels. */
  lineHeight?: number;
  /** Horizontal text alignment. */
  textAlign?: "left" | "center" | "right" | "justify";
  /** Vertical text alignment inside the node bounds. Text layers from Sketch often rely on this for menu rows and buttons. */
  textVerticalAlign?: "top" | "middle" | "bottom";
  /** Visibility flag from the design source. Hidden nodes remain in schema but are not rendered. */
  visible: boolean;
  /** Lock flag from the design source. */
  locked: boolean;
  /** Bitmap/image URL resolved into the workspace asset store. */
  imageUrl?: string;
  /** Deprecated legacy field. Color adjustments should use imageColorControls instead of precomputed CSS filters. */
  imageFilter?: string;
  /** Raw Sketch bitmap colorControls values for debugging and downstream renderers. */
  imageColorControls?: WorkspaceDesignImageColorControls;
  /** Image fill URL resolved into the workspace asset store. */
  fillImageUrl?: string;
  /** Image fill rendering mode. */
  fillImageMode?: "stretch" | "fill" | "fit" | "tile";
  /** Image fill tile scale. */
  fillImageScale?: number;
  /** Single SVG path for vector primitives or collapsed shape groups. */
  svgPath?: string;
  /** Reference to an extracted vector asset containing svgPath/svgFillRule. */
  svgPathAssetRef?: string;
  /** Fill rule for svgPath. */
  svgFillRule?: "nonzero" | "evenodd";
  /** Multiple SVG paths when a compound shape needs separate paint metadata. */
  svgPaths?: Array<{
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    strokeDashPattern?: number[];
    strokeLineCap?: "butt" | "round" | "square";
    strokeLineJoin?: "miter" | "round" | "bevel";
    fillRule?: "nonzero" | "evenodd";
    opacity?: number;
    transform?: string;
  }>;
  /** Reference to an extracted vector asset containing svgPaths. */
  svgPathsAssetRef?: string;
  /** Nested SVG tree for shapeGroup/group vector hierarchies. */
  svgTree?: WorkspaceDesignSvgNode;
  /** Reference to an extracted vector asset containing svgTree. */
  svgTreeAssetRef?: string;
  /** Active clipping bounds inherited from Sketch clipping masks. */
  clipBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Active clipping path inherited from Sketch vector masks. */
  clipPath?: {
    x: number;
    y: number;
    width: number;
    height: number;
    svgPath: string;
    fillRule?: "nonzero" | "evenodd";
  };
  /** Reference to an extracted vector asset containing clipPath.svgPath. */
  clipPathSvgAssetRef?: string;
  /** Resolved source asset or source reference id. */
  sourceRef?: string;
  /** Original source layer id, e.g. Sketch do_objectID. */
  sourceLayerId?: string;
  /** Original source layer class, e.g. group, artboard, shapeGroup, text, symbolInstance, bitmap. */
  sourceLayerClass?: string;
  /** Source-specific metadata retained for schema generation and round-trip import debugging. */
  sourceMeta?: {
    provider?: "sketch" | "figma" | "vextra" | string;
    layerClass?: string;
    layerListExpandedType?: number;
    nameIsFixed?: boolean;
    isTemplate?: boolean;
    isFixedToViewport?: boolean;
    maintainScrollPosition?: boolean;
    booleanOperation?: number;
    rotation?: number;
    isFlippedHorizontal?: boolean;
    isFlippedVertical?: boolean;
    resizingConstraint?: number;
    resizingType?: number;
    groupBehavior?: number;
    sharedStyleID?: string;
    symbolID?: string;
    overrideValues?: Array<{ overrideName?: string; value?: string }>;
    groupLayout?: Record<string, unknown>;
    points?: Array<{
      point?: string;
      curveFrom?: string;
      curveTo?: string;
      hasCurveFrom?: boolean;
      hasCurveTo?: boolean;
      cornerRadius?: number;
      curveMode?: number;
    }>;
    numberOfPoints?: number;
    shapeRadius?: number;
    isClosed?: boolean;
    pointRadiusBehaviour?: number;
    textBehaviour?: number;
    lineSpacingBehaviour?: number;
    glyphBounds?: string;
    imageRef?: string;
    imageColorControls?: WorkspaceDesignImageColorControls;
    /** Raw layer opacity before parent opacity is applied. */
    layerOpacity?: number;
    /** Product of parent layer opacities at import time. */
    inheritedOpacity?: number;
    /** Final opacity after parent opacity and layer opacity are multiplied. */
    effectiveOpacity?: number;
    /** Raw layer rotation before parent rotation is applied. */
    localRotation?: number;
    /** Accumulated parent rotation at import time. */
    inheritedRotation?: number;
    /** Final rotation after parent rotation and layer rotation are composed. */
    effectiveRotation?: number;
    clippingMask?: string;
    flow?: Record<string, unknown>;
    exportOptions?: Record<string, unknown>;
    userInfo?: Record<string, unknown>;
    hasClippingMask?: boolean;
    activeClippingMask?: {
      sourceLayerId?: string;
      sourceLayerClass?: string;
      name?: string;
      hasClippingMask: true;
    };
  };
  /** Layer opacity after style context settings are applied. */
  opacity?: number;
  /** Rotation in degrees. */
  rotation?: number;
  /** Blend mode normalized from source style context settings. */
  blendMode?: string;
  /** Blur radius when source blur is enabled. */
  blurRadius?: number;
  /** Font family for text nodes. */
  fontFamily?: string;
  /** Numeric font weight inferred from source font descriptor. */
  fontWeight?: number;
  /** Letter spacing in canvas pixels. */
  letterSpacing?: number;
  /** Optional font stretch descriptor. */
  fontStretch?: string;
  /** Text underline decoration. */
  underline?: boolean;
  /** Text strikethrough decoration. */
  strikethrough?: boolean;
  /** Text transform hint used by generated schemas. */
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  /** Horizontal flip from source layer. */
  flippedHorizontal?: boolean;
  /** Vertical flip from source layer. */
  flippedVertical?: boolean;
  /** CSS box-shadow string for source shadows. */
  shadow?: string;
  /** CSS box-shadow-like string for source inner shadows. */
  innerShadow?: string;
  /** Render order. Higher values render later. */
  zIndex?: number;
}

export type WorkspaceDesignSvgNode = {
  type: "g";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDashPattern?: number[];
  strokeLineCap?: "butt" | "round" | "square";
  strokeLineJoin?: "miter" | "round" | "bevel";
  fillRule?: "nonzero" | "evenodd";
  opacity?: number;
  transform?: string;
  children: WorkspaceDesignSvgNode[];
} | {
  type: "path";
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDashPattern?: number[];
  strokeLineCap?: "butt" | "round" | "square";
  strokeLineJoin?: "miter" | "round" | "bevel";
  fillRule?: "nonzero" | "evenodd";
  opacity?: number;
  transform?: string;
};

export interface WorkspaceDesignPage {
  id: string;
  name: string;
  nodes: WorkspaceDesignNode[];
  nodeCount?: number;
  schemaPath?: string;
  schemaLoaded?: boolean;
}

export interface WorkspaceDesignComponent {
  id: string;
  name: string;
  sourceFileName: string;
  libraryId?: string;
  description?: string;
  nodeCount: number;
  nodes: WorkspaceDesignNode[];
}

export interface WorkspaceDesignComponentLibrary {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDesignStyleProfile {
  platform: "web" | "mobile" | "unknown";
  colors: {
    primary?: string;
    background?: string;
    surface?: string;
    border?: string;
    text?: string;
    mutedText?: string;
  };
  typography: {
    title?: number;
    body?: number;
    caption?: number;
  };
  spacing: {
    pageMargin?: number;
    sectionGap?: number;
    itemGap?: number;
  };
  radius: {
    card?: number;
    button?: number;
    input?: number;
  };
  components: {
    button?: { height?: number; radius?: number; primaryFill?: string; textColor?: string };
    input?: { height?: number; radius?: number; fill?: string; border?: string };
    card?: { radius?: number; fill?: string; border?: string; padding?: number };
  };
}

export interface WorkspaceDesignPageTemplate {
  id: string;
  name: string;
  description?: string;
  sourcePageId: string;
  sourceFrameId: string;
  sourceFileName: string;
  nodeCount: number;
  width: number;
  height: number;
  nodes: WorkspaceDesignNode[];
  styleProfile: WorkspaceDesignStyleProfile;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDesignAsset {
  id: string;
  name: string;
  sourceFileName: string;
  type: "image" | "vector";
  mimeType: string;
  url: string;
  sourceRef?: string;
  width?: number;
  height?: number;
}

export interface WorkspaceDesignFile {
  id: string;
  name: string;
  prdText: string;
  aiSettings?: {
    systemPrompt?: string;
  };
  pages: WorkspaceDesignPage[];
  componentLibraries?: WorkspaceDesignComponentLibrary[];
  pageTemplates?: WorkspaceDesignPageTemplate[];
  importedComponents: WorkspaceDesignComponent[];
  importedAssets: WorkspaceDesignAsset[];
  updatedAt: string;
}

export interface WorkspaceDesignImportResult {
  pages: WorkspaceDesignPage[];
  components: WorkspaceDesignComponent[];
  assets: WorkspaceDesignAsset[];
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
  stageModelRouting: Partial<Record<"capture" | "structure" | "design", string>>;
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

export interface WorkspaceProjectDocument {
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

export interface WorkspaceProjectDocumentMeta {
  id: string;
  projectId: string;
  title: string;
  sortOrder: number;
  deleted: boolean;
  contentFilePath: string;
  htmlFilePath: string;
  textFilePath: string;
  latestVersionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceProjectDocumentVersion {
  id: string;
  documentId: string;
  projectId: string;
  versionNumber: number;
  source: "manual" | "ai" | "import" | "rollback";
  summary: string;
  snapshotFilePath: string;
  createdAt: string;
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
