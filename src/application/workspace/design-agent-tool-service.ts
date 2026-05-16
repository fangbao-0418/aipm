import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { z } from "zod";
import { WorkspaceProjectRepository } from "../../infrastructure/files/workspace-project-repository.js";
import { getDesignReferenceContext } from "./design-reference-catalog.js";
import {
  applyLibraryTokens,
  getDesignCapabilityProfile,
  type DesignCapabilityProfile,
  type DesignPlatform
} from "./design-capability-registry.js";
import { ImageAssetProvider, type ResolvedDesignImageAsset } from "./image-asset-provider.js";
import { compileLayoutTreeToSceneGraph, compileStitchUiDraftToSceneGraph } from "./design-ui-compiler.js";
import type {
  WorkspaceDesignComponent,
  WorkspaceDesignComponentLibrary,
  WorkspaceDesignFile,
  WorkspaceDesignNode,
  WorkspaceDesignNodeType,
  WorkspaceDesignPage,
  WorkspaceDesignPageTemplate,
  WorkspaceDesignStyleProfile
} from "../../shared/types/workspace.js";
import { nowIso } from "../../shared/utils/time.js";

const nodeTypeSchema = z.enum(["frame", "container", "text", "button", "input", "table", "card", "image"]);
interface LayoutIntentDraftNode {
  type: string;
  name?: string;
  title?: string;
  text?: string;
  label?: string;
  variant?: string;
  role?: string;
  slot?: "nav" | "header" | "summary" | "filter" | "content" | "sidebar" | "detail" | "footer" | "actions";
  layout?: "singleColumn" | "twoColumn" | "masterDetail" | "dashboard" | "form" | "table" | "cards";
  density?: "compact" | "comfortable" | "spacious";
  tone?: "default" | "muted" | "primary" | "warning" | "success" | "danger";
  emphasis?: "low" | "medium" | "high";
  priority?: "primary" | "secondary" | "tertiary";
  align?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  repeat?: number;
  items?: Array<string | Record<string, string>>;
  options?: Array<string | Record<string, string>>;
  direction?: "vertical" | "horizontal";
  gap?: "none" | "xs" | "sm" | "md" | "lg" | "xl";
  padding?: "none" | "xs" | "sm" | "md" | "lg" | "xl";
  width?: "fill" | "hug" | number;
  height?: "fill" | "hug" | number;
  columns?: string[];
  rows?: string[][];
  fields?: string[];
  actions?: string[];
  metrics?: Array<{ label: string; value: string }>;
  children?: LayoutIntentDraftNode[];
  props?: Record<string, unknown>;
}

type DesignReviewIssueCode =
  | "text_overflow"
  | "overlap"
  | "missing_region"
  | "out_of_artboard"
  | "wrong_page_mode"
  | "content_missing";

type DesignReviewIssue = {
  code: DesignReviewIssueCode;
  level: "blocking" | "warning";
  message: string;
  suggestedFix?: Record<string, unknown>;
  targetNodeIds?: string[];
  region?: string;
};

function looseEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return undefined;
    return (values as readonly string[]).includes(value) ? value : undefined;
  }, z.enum(values).optional());
}

const layoutIntentNodeSchema: z.ZodType<LayoutIntentDraftNode, z.ZodTypeDef, unknown> = z.lazy(() => z.object({
  type: z.string(),
  name: z.string().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
  label: z.string().optional(),
  variant: z.string().optional(),
  role: z.string().optional(),
  slot: looseEnum(["nav", "header", "summary", "filter", "content", "sidebar", "detail", "footer", "actions"]),
  layout: looseEnum(["singleColumn", "twoColumn", "masterDetail", "dashboard", "form", "table", "cards"]),
  density: looseEnum(["compact", "comfortable", "spacious"]),
  tone: looseEnum(["default", "muted", "primary", "warning", "success", "danger"]),
  emphasis: looseEnum(["low", "medium", "high"]),
  priority: looseEnum(["primary", "secondary", "tertiary"]),
  align: looseEnum(["start", "center", "end", "between"]),
  wrap: z.boolean().optional(),
  repeat: z.number().int().min(1).max(24).optional(),
  items: z.array(z.union([z.string(), z.record(z.string())])).optional(),
  options: z.array(z.union([z.string(), z.record(z.string())])).optional(),
  direction: looseEnum(["vertical", "horizontal"]),
  gap: looseEnum(["none", "xs", "sm", "md", "lg", "xl"]),
  padding: looseEnum(["none", "xs", "sm", "md", "lg", "xl"]),
  width: z.union([z.literal("fill"), z.literal("hug"), z.number()]).optional(),
  height: z.union([z.literal("fill"), z.literal("hug"), z.number()]).optional(),
  columns: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())).optional(),
  fields: z.array(z.string()).optional(),
  actions: z.array(z.string()).optional(),
  metrics: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  children: z.array(layoutIntentNodeSchema).optional(),
  props: z.record(z.unknown()).optional()
}).passthrough());
const designNodePatchSchema = z.object({
  id: z.string().optional(),
  parentId: z.string().optional(),
  type: nodeTypeSchema.optional(),
  name: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  radius: z.number().optional(),
  text: z.string().optional(),
  textColor: z.string().optional(),
  fontSize: z.number().optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional()
}).passthrough();

const designNodeInputSchema = designNodePatchSchema.extend({
  type: nodeTypeSchema,
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional()
});

export const uiSchemaDraftNodeSchema = z.object({
  refId: z.string(),
  parentRef: z.string().optional(),
  type: nodeTypeSchema,
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  radius: z.number().optional(),
  text: z.string().optional(),
  textColor: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional()
}).passthrough();

export const uiSchemaDraftSchema = z.preprocess((value) => normalizeUiSchemaDraftInput(value), z.object({
  schemaVersion: z.literal("aipm.design.schema.v1").default("aipm.design.schema.v1"),
  intent: z.string().default(""),
  platform: z.enum(["web", "mobile_app"]).default("web"),
  designRationale: z.array(z.string()).default([]),
  artboards: z.array(z.object({
    refId: z.string(),
    name: z.string(),
    width: z.number(),
    height: z.number(),
    layout: z.string().default(""),
    pageMode: looseEnum(["collection", "detail", "form", "dashboard", "auth", "settings", "flow", "landing", "unknown"]).default("unknown"),
    businessEntity: z.string().default(""),
    layoutPattern: looseEnum(["pcTable", "pcDetail", "pcForm", "pcDashboard", "mobileList", "mobileDetail", "mobileForm", "settingsSplit", "authCentered", "flowSteps", "custom"]).default("custom"),
    requiredRegions: z.array(z.string()).default([]),
    forbiddenRegions: z.array(z.string()).default([]),
    componentFamilies: z.array(z.string()).default([]),
    layoutIntent: layoutIntentNodeSchema.optional(),
    nodes: z.array(uiSchemaDraftNodeSchema).default([])
  })).min(1).max(12)
}));

export type UiSchemaDraft = z.infer<typeof uiSchemaDraftSchema>;

interface PageTemplateContract {
  templateId: string;
  templateName: string;
  score: number;
  reasons: string[];
  platformPolicy: "full" | "style-only";
  dimensions?: { width: number; height: number };
  pageMode?: PageInteractionMode;
  requiredRegions: string[];
  forbiddenRegions: string[];
  regionOrder: string[];
  styleTokens: {
    colors: {
      background?: string;
      surface?: string;
      primary?: string;
      text?: string;
      mutedText?: string;
      border?: string;
    };
    radius: {
      card?: number;
      control?: number;
      button?: number;
    };
    spacing: number[];
    typography: {
      title?: number;
      body?: number;
      caption?: number;
    };
  };
  componentStyle: WorkspaceDesignStyleProfile["components"];
}

function normalizeUiSchemaDraftInput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      schemaVersion: "aipm.design.schema.v1",
      intent: "",
      platform: "web",
      designRationale: [],
      artboards: value
        .filter(isRecordLikeForSchema)
        .slice(0, 12)
        .map((artboard, index) => normalizeUiSchemaArtboardInput(artboard, {}, index))
    };
  }
  if (!value || typeof value !== "object") return value;
  const draft = value as Record<string, unknown>;
  const wrapperKeys = ["schemaDraft", "uiSchemaDraft", "draft", "result", "data", "output", "schema", "design", "ui", "payload", "response", "page", "screen", "section", "block", "region", "component", "tree", "layoutTree", "intentTree"];
  for (const key of wrapperKeys) {
    const wrapped = draft[key];
    if (isRecordLikeForSchema(wrapped) && wrapped !== draft) {
      const normalized: unknown = normalizeUiSchemaDraftInput(wrapped);
      if (isRecordLikeForSchema(normalized) && Array.isArray(normalized.artboards)) return normalized;
    }
  }
  if (Array.isArray(draft.artboards)) return {
    ...draft,
    artboards: draft.artboards.map((artboard, index) => normalizeUiSchemaArtboardInput(artboard, draft, index))
  };
  if (Array.isArray(draft.pageSpecs)) {
    return {
      schemaVersion: "aipm.design.schema.v1",
      intent: readStringField(draft, ["intent", "title", "name"], ""),
      platform: normalizeSchemaPlatform(draft.platform),
      designRationale: Array.isArray(draft.designRationale) ? draft.designRationale : [],
      artboards: draft.pageSpecs
        .filter(isRecordLikeForSchema)
        .slice(0, 12)
        .map((pageSpec, index) => normalizePageSpecToArtboardInput(pageSpec, draft, index))
    };
  }
  const pageCandidates = [
    draft.artboard,
    draft.screen,
    draft.section,
    draft.block,
    draft.region,
    draft.component,
    draft.tree,
    draft.layoutIntent,
    draft.intentTree
  ].filter(isRecordLikeForSchema);
  const collectionCandidates = [
    draft.pages,
    draft.screens,
    draft.layouts,
    draft.views,
    draft.routes,
    draft.frames,
    draft.canvases,
    draft.artboardList,
    draft.screenList
  ].find(Array.isArray) as unknown[] | undefined;
  if (collectionCandidates?.length) {
    return {
      schemaVersion: "aipm.design.schema.v1",
      intent: readStringField(draft, ["intent", "title", "name"], ""),
      platform: normalizeSchemaPlatform(draft.platform),
      designRationale: Array.isArray(draft.designRationale) ? draft.designRationale : [],
      artboards: collectionCandidates
        .filter(isRecordLikeForSchema)
        .slice(0, 12)
        .map((page, index) => normalizeUiSchemaArtboardInput(page, draft, index))
    };
  }
  if (pageCandidates.length > 0) {
    const page = pageCandidates[0];
    return {
      schemaVersion: "aipm.design.schema.v1",
      intent: readStringField(draft, ["intent", "title", "name"], readStringField(page, ["intent", "title", "name"], "")),
      platform: normalizeSchemaPlatform(draft.platform ?? page.platform),
      designRationale: Array.isArray(draft.designRationale) ? draft.designRationale : [],
      artboards: [normalizeUiSchemaArtboardInput(page, draft, 0)]
    };
  }
  const blockChildren = readIntentChildrenFromLooseDraft(draft);
  if (blockChildren.length > 0 || looksLikeLooseUiDraft(draft)) {
    return normalizeLooseDraftToSchemaDraft(draft, blockChildren);
  }
  const platform = draft.platform === "mobile_app" ? "mobile_app" : "web";
  const width = platform === "mobile_app" ? 375 : 1440;
  const height = platform === "mobile_app" ? 812 : 1024;
  const layoutIntent = isRecordLikeForSchema(draft.layoutIntent)
    ? draft.layoutIntent
    : typeof draft.type === "string"
      ? draft
      : undefined;
  const layoutChildren = Array.isArray(draft.children) ? draft.children.map((child, index) => normalizePageSpecBlockToIntent(child, index)) : [];
  const nodes = Array.isArray(draft.nodes) ? draft.nodes : [];
  if (!layoutIntent && layoutChildren.length > 0) {
    return {
      schemaVersion: "aipm.design.schema.v1",
      intent: typeof draft.intent === "string" ? draft.intent : typeof draft.title === "string" ? draft.title : "",
      platform,
      designRationale: Array.isArray(draft.designRationale) ? draft.designRationale : [],
      artboards: [{
        refId: typeof draft.refId === "string" ? draft.refId : "page-root",
        name: typeof draft.name === "string" ? draft.name : typeof draft.title === "string" ? draft.title : "生成区块",
        width: typeof draft.width === "number" ? draft.width : width,
        height: typeof draft.height === "number" ? draft.height : height,
        layout: typeof draft.layout === "string" ? draft.layout : "",
        ...readPageContractFields(draft),
        layoutIntent: {
          type: typeof draft.type === "string" ? draft.type : "Section",
          name: typeof draft.name === "string" ? draft.name : typeof draft.title === "string" ? draft.title : "生成区块",
          title: typeof draft.title === "string" ? draft.title : undefined,
          children: layoutChildren
        },
        nodes
      }]
    };
  }
  if (!layoutIntent && nodes.length === 0) return value;
  return {
    schemaVersion: "aipm.design.schema.v1",
    intent: typeof draft.intent === "string" ? draft.intent : typeof draft.title === "string" ? draft.title : "",
    platform,
    designRationale: Array.isArray(draft.designRationale) ? draft.designRationale : [],
    artboards: [{
      refId: typeof draft.refId === "string" ? draft.refId : "page-root",
      name: typeof draft.name === "string" ? draft.name : typeof draft.title === "string" ? draft.title : "生成页面",
      width: typeof draft.width === "number" ? draft.width : width,
      height: typeof draft.height === "number" ? draft.height : height,
      layout: typeof draft.layout === "string" ? draft.layout : "",
      ...readPageContractFields(draft),
      layoutIntent,
      nodes
    }]
  };
}

function readIntentChildrenFromLooseDraft(draft: Record<string, unknown>) {
  const candidates = [
    draft.keyBlocks,
    draft.blocks,
    draft.sections,
    draft.regions,
    draft.components,
    draft.children,
    draft.items,
    draft.content
  ];
  const source = candidates.find(Array.isArray) as unknown[] | undefined;
  if (!source) return [];
  return source
    .slice(0, 48)
    .map((item, index) => normalizePageSpecBlockToIntent(item, index));
}

function looksLikeLooseUiDraft(draft: Record<string, unknown>) {
  return typeof draft.type === "string"
    || typeof draft.name === "string"
    || typeof draft.title === "string"
    || typeof draft.intent === "string"
    || typeof draft.description === "string";
}

function normalizeLooseDraftToSchemaDraft(draft: Record<string, unknown>, children: LayoutIntentDraftNode[]) {
  const platform = normalizeSchemaPlatform(draft.platform);
  const width = platform === "mobile_app" ? 375 : 1440;
  const height = platform === "mobile_app" ? 812 : 1024;
  const title = readStringField(draft, ["name", "title", "pageName", "intent"], "生成页面");
  const rootType = typeof draft.type === "string" ? draft.type : "Page";
  const normalizedChildren = children.length > 0
    ? children
    : [{ type: "Section", title, children: [{ type: "Text", text: title, variant: "title" }] }];
  const layoutIntent = rootType.toLowerCase() === "page" || rootType.toLowerCase() === "screen" || rootType.toLowerCase() === "artboard"
    ? { ...draft, type: "Page", title, children: normalizedChildren }
    : { type: "Page", title, children: [{ ...draft, type: rootType, title, children: normalizedChildren }] };
  return {
    schemaVersion: "aipm.design.schema.v1",
    intent: readStringField(draft, ["intent", "description", "title", "name"], title),
    platform,
    designRationale: Array.isArray(draft.designRationale) ? draft.designRationale : ["Schema normalizer: loose draft converted to artboards"],
    artboards: [{
      refId: readStringField(draft, ["refId", "id"], "page-root"),
      name: title,
      width: typeof draft.width === "number" ? draft.width : width,
      height: typeof draft.height === "number" ? draft.height : height,
      layout: readStringField(draft, ["layout"], ""),
      ...readPageContractFields(draft),
      layoutIntent,
      nodes: Array.isArray(draft.nodes) ? draft.nodes : []
    }]
  };
}

function normalizePageSpecToArtboardInput(value: Record<string, unknown>, root: Record<string, unknown>, index: number) {
  const platform = normalizeSchemaPlatform(value.platform ?? root.platform);
  const width = platform === "mobile_app" ? 375 : 1440;
  const height = platform === "mobile_app" ? 812 : 1024;
  const name = readStringField(value, ["name", "title", "pageName"], `生成页面 ${index + 1}`);
  const keyBlocks = Array.isArray(value.keyBlocks) ? value.keyBlocks : [];
  const children = keyBlocks.length > 0
    ? keyBlocks.map((block, blockIndex) => normalizePageSpecBlockToIntent(block, blockIndex))
    : [{ type: "Section", title: name, children: [{ type: "Text", text: name, variant: "title" }] }];
  return {
    refId: readStringField(value, ["refId", "id"], `page-${index + 1}`),
    name,
    width: typeof value.width === "number" ? value.width : width,
    height: typeof value.height === "number" ? value.height : height,
    layout: readStringField(value, ["layout"], ""),
    ...readPageContractFields(value),
    layoutIntent: {
      type: "Page",
      title: name,
      layout: readStringField(value, ["layout"], "").includes("dashboard") ? "dashboard" : undefined,
      children
    },
    nodes: []
  };
}

function normalizePageSpecBlockToIntent(block: unknown, index: number): LayoutIntentDraftNode {
  if (typeof block === "string") {
    return {
      type: inferIntentTypeFromLabel(block),
      title: block,
      children: [{ type: "Text", text: block }]
    };
  }
  if (!isRecordLikeForSchema(block)) {
    return { type: "Section", title: `区块 ${index + 1}`, children: [{ type: "Text", text: `区块 ${index + 1}` }] };
  }
  const title = readStringField(block, ["name", "title", "label"], `区块 ${index + 1}`);
  const children = Array.isArray(block.children)
    ? block.children.filter(isRecordLikeForSchema).map((child, childIndex) => normalizePageSpecBlockToIntent(child, childIndex))
    : [{ type: "Text", text: title }];
  return {
    type: readStringField(block, ["type"], inferIntentTypeFromLabel(title)),
    name: title,
    title,
    children
  };
}

function inferIntentTypeFromLabel(label: string) {
  if (/筛选|查询|搜索|filter|search/i.test(label)) return "FilterBar";
  if (/指标|统计|摘要|summary|metric/i.test(label)) return "MetricGroup";
  if (/表格|列表|记录|table|list/i.test(label)) return "Table";
  if (/表单|字段|输入|上传|form/i.test(label)) return "Form";
  if (/详情|资料|信息|明细|detail|info/i.test(label)) return "DescriptionList";
  if (/操作|按钮|actions?/i.test(label)) return "ActionBar";
  return "Section";
}

function normalizeUiSchemaArtboardInput(value: unknown, root: Record<string, unknown>, index: number) {
  const artboard = isRecordLikeForSchema(value) ? value : {};
  const platform = normalizeSchemaPlatform(artboard.platform ?? root.platform);
  const width = platform === "mobile_app" ? 375 : 1440;
  const height = platform === "mobile_app" ? 812 : 1024;
  const layoutIntent = isRecordLikeForSchema(artboard.layoutIntent)
    ? artboard.layoutIntent
    : isRecordLikeForSchema(artboard.intentTree)
      ? artboard.intentTree
      : typeof artboard.type === "string"
        ? artboard
        : undefined;
  return {
    refId: readStringField(artboard, ["refId", "id"], `page-${index + 1}`),
    name: readStringField(artboard, ["name", "title"], readStringField(root, ["name", "title"], `生成页面 ${index + 1}`)),
    width: typeof artboard.width === "number" ? artboard.width : width,
    height: typeof artboard.height === "number" ? artboard.height : height,
    layout: readStringField(artboard, ["layout"], ""),
    ...readPageContractFields(artboard),
    layoutIntent,
    nodes: Array.isArray(artboard.nodes) ? artboard.nodes : []
  };
}

function normalizeSchemaPlatform(value: unknown): "web" | "mobile_app" {
  return value === "mobile_app" ? "mobile_app" : "web";
}

function readStringField(record: Record<string, unknown>, keys: string[], fallback: string) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function readPageContractFields(record: Record<string, unknown>) {
  return {
    pageMode: typeof record.pageMode === "string" ? record.pageMode : undefined,
    businessEntity: typeof record.businessEntity === "string" ? record.businessEntity : undefined,
    layoutPattern: typeof record.layoutPattern === "string" ? record.layoutPattern : undefined,
    requiredRegions: normalizeStringArrayLike(record.requiredRegions),
    forbiddenRegions: normalizeStringArrayLike(record.forbiddenRegions),
    componentFamilies: normalizeStringArrayLike(record.componentFamilies)
  };
}

function normalizeStringArrayLike(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (typeof item === "number" || typeof item === "boolean") return String(item);
      if (!item || typeof item !== "object" || Array.isArray(item)) return "";
      const record = item as Record<string, unknown>;
      return [record.name, record.title, record.label, record.type, record.component]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(" / ");
    })
    .filter(Boolean);
}

function isRecordLikeForSchema(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateAndNormalizeUiSchemaDraft(draft: UiSchemaDraft, userRequest: string): {
  draft: UiSchemaDraft;
  issues: string[];
  blockingIssues: string[];
  contractIssues: Array<{ artboardName: string; kind: "missing_required_region" | "forbidden_region_present"; region: string }>;
} {
  const issues: string[] = [];
  const blockingIssues: string[] = [];
  const contractIssues: Array<{ artboardName: string; kind: "missing_required_region" | "forbidden_region_present"; region: string }> = [];
  const platform = draft.platform;
  const isMobile = platform === "mobile_app" || /小程序|移动端|手机|app/i.test(userRequest);
  const artboards = draft.artboards.map((artboard, index) => {
    const isShellDraft = isUiShellDraft(draft, artboard);
    if (!artboard.layoutIntent) {
      if (isShellDraft) {
        issues.push(`画板「${artboard.name || index + 1}」是增量生成外框，允许空内容先落盘`);
        return artboard;
      }
      if (artboard.nodes.length < 4) {
        blockingIssues.push(`画板「${artboard.name || index + 1}」缺少 layoutIntent，且 legacy nodes 过少`);
      } else {
        issues.push(`画板「${artboard.name || index + 1}」仍使用 legacy nodes，无法享受 Layout Engine 约束`);
      }
      return artboard;
    }
    const normalizedIntent = normalizeLayoutIntentForValidation(artboard.layoutIntent, {
      isMobile,
      issues,
      path: artboard.name || `artboard-${index + 1}`
    });
    const declaredMode = artboard.pageMode && artboard.pageMode !== "unknown" && artboard.pageMode !== "landing"
      ? artboard.pageMode
      : undefined;
    const forbiddenRegions = declaredMode
      ? artboard.forbiddenRegions.length > 0
        ? artboard.forbiddenRegions
        : getDefaultForbiddenRegionsForPageMode(declaredMode)
      : [];
    const pruneResult = pruneForbiddenLayoutIntentRegions(normalizedIntent, forbiddenRegions);
    if (pruneResult.removedRegions.length > 0) {
      issues.push(`画板「${artboard.name}」已按页面契约移除禁用区域：${Array.from(new Set(pruneResult.removedRegions)).join("、")}`);
    }
    const sanitizedIntent = pruneResult.root;
    const stats = collectLayoutIntentStats(sanitizedIntent);
    if (stats.nodeCount < 4) {
      blockingIssues.push(`画板「${artboard.name}」layoutIntent 节点过少，不能由 Compiler 凭空补业务内容`);
    }
    if (!stats.hasContent) {
      blockingIssues.push(`画板「${artboard.name}」缺少内容组件，必须重新生成详情/表单/列表等明确语义结构`);
    }
    if (declaredMode) {
      const pageContractIssues = validatePageContract(artboard, sanitizedIntent, stats);
      contractIssues.push(...pageContractIssues);
      blockingIssues.push(...pageContractIssues.map(formatPageContractIssue));
    } else {
      const inferredMode = inferRequestedInteractionMode(`${draft.intent} ${artboard.name} ${artboard.layout} ${userRequest}`);
      if (inferredMode === "unknown") {
        issues.push(`画板「${artboard.name}」缺少 pageMode 契约；Validator 仅执行基础结构检查`);
      } else {
        issues.push(`画板「${artboard.name}」缺少 pageMode 契约，已按 ${inferredMode} 做弱提示；建议由 UI 设计计划显式输出契约`);
        issues.push(...validateMinimumStructureForPageMode(inferredMode, stats, artboard.name));
      }
    }
    if (isMobile && stats.tableCount > 0) {
      issues.push(`移动端画板「${artboard.name}」包含 Table，已转换为 CardList/Grid`);
    }
    return {
      ...artboard,
      layoutIntent: sanitizedIntent
    };
  });
  return {
    draft: {
      ...draft,
      designRationale: issues.length > 0
        ? [...draft.designRationale, `Layout Intent Validator: ${issues.join("；")}`]
        : draft.designRationale,
      artboards
    },
    issues,
    blockingIssues,
    contractIssues
  };
}

function isUiShellDraft(draft: UiSchemaDraft, artboard: UiSchemaDraft["artboards"][number]) {
  const text = `${draft.intent} ${artboard.layout} ${draft.designRationale.join(" ")}`;
  return artboard.nodes.length === 0
    && !artboard.layoutIntent
    && /页面外框|shell|incremental canvas|空画板外框|先创建空画板/i.test(text);
}

function normalizeLayoutIntentForValidation(
  node: LayoutIntentDraftNode,
  context: { isMobile: boolean; issues: string[]; path: string }
): LayoutIntentDraftNode {
  const raw = node as LayoutIntentDraftNode & Record<string, unknown>;
  const { x, y, left, top, right, bottom, position, ...cleanRaw } = raw;
  if ([x, y, left, top, right, bottom, position].some((value) => value !== undefined)) {
    context.issues.push(`${context.path}/${node.type} 包含绝对定位字段，已移除`);
  }
  const normalizedType = context.isMobile && /table|datatable/i.test(node.type) ? "Grid" : node.type;
  const children = node.children?.map((child, index) => normalizeLayoutIntentForValidation(child, {
    ...context,
    path: `${context.path}/${node.type}[${index}]`
  }));
  return {
    ...cleanRaw,
    type: normalizedType,
    children
  };
}

function collectLayoutIntentStats(root: LayoutIntentDraftNode) {
  const stats = {
    nodeCount: 0,
    hasContent: false,
    hasFilter: false,
    hasForm: false,
    hasToolbar: false,
    hasAction: false,
    hasDetailContent: false,
    hasMetric: false,
    hasFeedback: false,
    hasNavigation: false,
    hasSteps: false,
    fieldCount: 0,
    hasCollectionContent: false,
    hasCollectionControl: false,
    tableCount: 0,
    collectionTypes: [] as string[]
  };
  const visit = (node: LayoutIntentDraftNode) => {
    const type = normalizeIntentTypeForValidation(node.type);
    const label = `${node.name ?? ""}${node.title ?? ""}${node.label ?? ""}${node.text ?? ""}`;
    stats.nodeCount += 1;
    const isCollectionContentType = isCollectionIntentContentType(type);
    const isCollectionControlType = isCollectionIntentControlType(type);
    if (isCollectionContentType || /card|content|form|panel|detail|section|descriptionlist/i.test(type) || /内容|列表|表格|卡片|表单|详情|信息|资料/.test(label)) {
      stats.hasContent = true;
    }
    if (/filter|search/i.test(type) || /筛选|查询|搜索/.test(label)) {
      stats.hasFilter = true;
    }
    if (/toolbar|navbar|breadcrumb|tabs|tabbar|sidenav|nav/i.test(type) || /导航|面包屑|顶部|标签页/.test(label)) {
      stats.hasToolbar = true;
      stats.hasNavigation = true;
    }
    if (/actionbar|button|buttongroup|moremenu/i.test(type) || /操作|按钮|保存|提交|确认|取消|返回/.test(label)) {
      stats.hasAction = true;
    }
    if (/form|field|input|select|textarea|upload/i.test(type) || /表单|字段|输入|上传/.test(label)) {
      stats.hasForm = true;
      stats.fieldCount += Array.isArray(node.fields) ? node.fields.length : /form/i.test(type) ? 0 : 1;
    }
    if (/descriptionlist|detail|panel|status|timeline|imagegallery/i.test(type) || /详情|资料|信息|明细|状态|时间线/.test(label)) {
      stats.hasDetailContent = true;
    }
    if (/metric|chart|dashboard|summary|card|grid/i.test(type) || /指标|统计|趋势|图表|看板|摘要/.test(label)) {
      stats.hasMetric = true;
    }
    if (/empty|alert|toast|modal|drawer|loading|feedback/i.test(type) || /空状态|暂无|提示|弹窗|抽屉|加载|反馈/.test(label)) {
      stats.hasFeedback = true;
    }
    if (/steps|stepper|timeline/i.test(type) || /步骤|流程|时间线|进度/.test(label)) {
      stats.hasSteps = true;
    }
    if (isCollectionContentType || /列表|表格|记录/.test(label)) {
      stats.hasCollectionContent = true;
    }
    if (isCollectionControlType || /筛选|查询|搜索|分页|列表|表格/.test(label)) {
      stats.hasCollectionControl = true;
      stats.collectionTypes.push(node.type);
    }
    if (/table|datatable/i.test(type)) {
      stats.tableCount += 1;
    }
    node.children?.forEach(visit);
  };
  visit(root);
  return stats;
}

function isCollectionIntentContentType(type: string) {
  return new Set(["table", "datatable", "list", "cardlist", "grid", "listitem"]).has(type);
}

function isCollectionIntentControlType(type: string) {
  return new Set(["filterbar", "filter", "searchbar", "search", "pagination", "pager", "table", "datatable", "list", "cardlist", "grid"]).has(type);
}

type PageInteractionMode = "detail" | "form" | "collection" | "dashboard" | "auth" | "settings" | "flow" | "unknown";

function inferRequestedInteractionMode(text: string): PageInteractionMode {
  if (/登录|注册|验证码|找回密码|重置密码|auth|login|register|password/i.test(text)) return "auth";
  if (/设置|配置|权限|偏好|通知|账号安全|settings|preferences|permission/i.test(text)) return "settings";
  if (/详情|查看|资料|明细|profile|detail|inspect|read\s*only/i.test(text)) return "detail";
  if (/(流程|步骤|审核流|审批流|流转|进度跟踪|step|flow|checkout|wizard)/i.test(text)) return "flow";
  if (/新增|新建|编辑|修改|创建|录入|提交|保存|表单|上传|认证|form|create|edit|submit/i.test(text)) return "form";
  if (/列表|表格|管理|查询|搜索|筛选|记录|台账|table|list|collection|index/i.test(text)) return "collection";
  if (/看板|仪表盘|统计|趋势|报表|dashboard|analytics|chart/i.test(text)) return "dashboard";
  return "unknown";
}

function validateMinimumStructureForPageMode(
  mode: PageInteractionMode,
  stats: ReturnType<typeof collectLayoutIntentStats>,
  artboardName: string
) {
  const issues: string[] = [];
  if (mode === "collection") {
    if (!stats.hasToolbar && !stats.hasAction) issues.push(`画板「${artboardName}」是列表/管理类页面，但缺少 Toolbar/操作区`);
    if (!stats.hasCollectionContent) issues.push(`画板「${artboardName}」是列表/管理类页面，但缺少 Table/CardList/List/Grid`);
  }
  if (mode === "detail") {
    if (!stats.hasToolbar && !stats.hasAction) issues.push(`画板「${artboardName}」是详情页，但缺少标题/返回/操作区`);
    if (!stats.hasDetailContent && !stats.hasForm) issues.push(`画板「${artboardName}」是详情页，但缺少 DescriptionList/Panel/Form 详情内容`);
  }
  if (mode === "form") {
    if (!stats.hasForm) issues.push(`画板「${artboardName}」是表单页，但缺少 Form/Input/Select/Upload 等字段结构`);
    if (stats.fieldCount < 2) issues.push(`画板「${artboardName}」是表单页，但字段数量不足，至少需要 2 个字段`);
    if (!stats.hasAction) issues.push(`画板「${artboardName}」是表单页，但缺少 ActionBar/保存提交按钮`);
  }
  if (mode === "dashboard") {
    if (!stats.hasMetric) issues.push(`画板「${artboardName}」是看板页，但缺少 MetricGroup/Chart/Card/Grid 指标内容`);
    if (!stats.hasContent) issues.push(`画板「${artboardName}」是看板页，但缺少核心内容区`);
  }
  if (mode === "auth") {
    if (!stats.hasForm || stats.fieldCount < 2) issues.push(`画板「${artboardName}」是登录/注册页，但缺少账号/密码/验证码等表单字段`);
    if (!stats.hasAction) issues.push(`画板「${artboardName}」是登录/注册页，但缺少主按钮`);
    if (stats.hasCollectionContent) issues.push(`画板「${artboardName}」是登录/注册页，但混入了列表/表格结构`);
  }
  if (mode === "settings") {
    if (!stats.hasNavigation && !stats.hasContent) issues.push(`画板「${artboardName}」是设置页，但缺少分组导航或设置分区`);
    if (!stats.hasForm && !stats.hasAction) issues.push(`画板「${artboardName}」是设置页，但缺少配置项、开关或操作控件`);
  }
  if (mode === "flow") {
    if (!stats.hasSteps) issues.push(`画板「${artboardName}」是流程页，但缺少 Steps/Timeline 流程结构`);
    if (!stats.hasAction) issues.push(`画板「${artboardName}」是流程页，但缺少下一步/提交/返回等 ActionBar`);
  }
  return issues;
}

function validatePageContract(
  artboard: UiSchemaDraft["artboards"][number],
  root: LayoutIntentDraftNode,
  stats: ReturnType<typeof collectLayoutIntentStats>
) {
  const issues: Array<{ artboardName: string; kind: "missing_required_region" | "forbidden_region_present"; region: string }> = [];
  const mode = artboard.pageMode;
  const rawRequiredRegions = artboard.requiredRegions.length > 0
    ? artboard.requiredRegions
    : getDefaultRequiredRegionsForPageMode(mode);
  const rawForbiddenRegions = artboard.forbiddenRegions.length > 0
    ? artboard.forbiddenRegions
    : getDefaultForbiddenRegionsForPageMode(mode);
  const forbiddenRegionNames = new Set(rawForbiddenRegions.map(normalizeIntentRegionName).filter(Boolean));
  const requiredRegions = rawRequiredRegions.filter((region) => !forbiddenRegionNames.has(normalizeIntentRegionName(region)));
  const forbiddenRegions = rawForbiddenRegions;

  requiredRegions.forEach((region) => {
    if (!layoutIntentHasRegion(root, region, stats)) {
      issues.push({ artboardName: artboard.name, kind: "missing_required_region", region });
    }
  });
  forbiddenRegions.forEach((region) => {
    if (layoutIntentHasRegion(root, region, stats)) {
      issues.push({ artboardName: artboard.name, kind: "forbidden_region_present", region });
    }
  });
  return issues;
}

function pruneForbiddenLayoutIntentRegions(root: LayoutIntentDraftNode, forbiddenRegions: string[]) {
  const forbidden = new Set(forbiddenRegions.map(normalizeIntentRegionName).filter(Boolean));
  const removedRegions: string[] = [];
  if (forbidden.size === 0) return { root, removedRegions };
  const shouldRemove = (node: LayoutIntentDraftNode) => {
    const type = normalizeIntentTypeForValidation(node.type);
    const slot = typeof node.slot === "string" ? normalizeIntentRegionName(node.slot) : "";
    const label = normalizeIntentRegionName(`${node.name ?? ""} ${node.title ?? ""} ${node.label ?? ""}`);
    for (const region of forbidden) {
      if (typeMatchesRegion(type, region) || slot === region || label === region) {
        removedRegions.push(region);
        return true;
      }
    }
    return false;
  };
  const prune = (node: LayoutIntentDraftNode): LayoutIntentDraftNode => ({
    ...node,
    children: node.children
      ?.filter((child) => !shouldRemove(child))
      .map(prune)
  });
  return { root: prune(root), removedRegions };
}

function formatPageContractIssue(issue: { artboardName: string; kind: "missing_required_region" | "forbidden_region_present"; region: string }) {
  return issue.kind === "missing_required_region"
    ? `画板「${issue.artboardName}」契约要求 ${issue.region}，但 layoutIntent 未包含对应区域`
    : `画板「${issue.artboardName}」契约禁止 ${issue.region}，但 layoutIntent 包含该区域`;
}

function getDefaultRequiredRegionsForPageMode(mode: string) {
  switch (mode) {
    case "collection":
      return ["Header", "Content"];
    case "detail":
      return ["Header", "DescriptionList"];
    case "form":
      return ["Form", "ActionBar"];
    case "dashboard":
      return ["MetricGroup", "Content"];
    case "auth":
      return ["Form", "ActionBar"];
    case "settings":
      return ["Content"];
    case "flow":
      return ["Steps", "ActionBar"];
    default:
      return ["Content"];
  }
}

function getDefaultForbiddenRegionsForPageMode(mode: string) {
  switch (mode) {
    case "collection":
      return ["DescriptionList", "DetailPanel"];
    case "detail":
      return ["FilterBar", "Table", "Pagination"];
    case "form":
    case "auth":
      return ["Table", "Pagination"];
    default:
      return [];
  }
}

function matchPageTemplateContract(
  file: WorkspaceDesignFile,
  userRequest: string,
  platform: "web" | "mobile_app",
  artboard?: UiSchemaDraft["artboards"][number]
): PageTemplateContract | undefined {
  const templates = file.pageTemplates ?? [];
  if (templates.length === 0) return undefined;
  const targetMode = normalizePageModeForTemplateMatch(artboard?.pageMode) || inferRequestedInteractionMode(`${userRequest} ${artboard?.name ?? ""}`);
  const targetEntity = normalizeTemplateMatchText(`${artboard?.businessEntity ?? ""} ${userRequest}`);
  const requestTokens = new Set(tokenizeTemplateMatchText(`${userRequest} ${artboard?.name ?? ""} ${artboard?.businessEntity ?? ""}`));
  const targetPlatform = platform === "mobile_app" ? "mobile" : "web";
  const ranked = templates.map((template) => {
    const contract = buildPageTemplateContract(template, userRequest, platform, targetMode);
    const templateText = normalizeTemplateMatchText([
      template.name,
      template.description ?? "",
      template.nodes.map((node) => `${node.name} ${node.text ?? ""}`).join(" ")
    ].join(" "));
    const templateTokens = new Set(tokenizeTemplateMatchText(templateText));
    const overlap = Array.from(requestTokens).filter((token) => templateTokens.has(token)).length;
    let score = 0;
    const reasons: string[] = [];
    if (template.styleProfile.platform === targetPlatform) {
      score += 35;
      reasons.push("平台匹配");
    } else if (template.styleProfile.platform === "unknown") {
      score += 8;
      reasons.push("模板平台未知，仅弱匹配");
    } else {
      score -= 12;
      reasons.push("平台不一致，仅继承风格 token");
    }
    if (contract.pageMode && targetMode !== "unknown" && contract.pageMode === targetMode) {
      score += 30;
      reasons.push(`页面模式匹配 ${targetMode}`);
    } else if (targetMode !== "unknown" && contract.regionOrder.some((region) => templateRegionMatchesPageMode(region, targetMode))) {
      score += 16;
      reasons.push("模板结构接近页面模式");
    }
    if (overlap > 0) {
      score += Math.min(24, overlap * 4);
      reasons.push(`关键词命中 ${overlap} 个`);
    }
    if (targetEntity && templateText.includes(targetEntity.slice(0, 4))) {
      score += 10;
      reasons.push("业务实体接近");
    }
    const area = template.width * template.height;
    if (platform === "mobile_app" && template.width <= 520) {
      score += 8;
      reasons.push("移动端尺寸匹配");
    }
    if (platform === "web" && area >= 800 * 600) {
      score += 8;
      reasons.push("Web 尺寸匹配");
    }
    return {
      contract: { ...contract, score, reasons },
      score
    };
  }).sort((first, second) => second.score - first.score);
  const best = ranked[0]?.contract;
  return best && best.score > 0 ? best : undefined;
}

function buildPageTemplateContract(
  template: WorkspaceDesignPageTemplate,
  userRequest: string,
  platform: "web" | "mobile_app",
  targetMode: PageInteractionMode
): PageTemplateContract {
  const structure = summarizeTemplateStructureForContract(template.nodes);
  const inferredMode = targetMode !== "unknown" ? targetMode : structure.pageMode;
  const platformPolicy = template.styleProfile.platform === "unknown" || template.styleProfile.platform === (platform === "mobile_app" ? "mobile" : "web")
    ? "full"
    : "style-only";
  const style = template.styleProfile;
  const requiredRegions = mergeRegionLists(
    getDefaultRequiredRegionsForPageMode(inferredMode),
    structure.regionOrder.filter((region) => shouldInheritTemplateRegionForPageMode(region, inferredMode))
  );
  const forbiddenRegions = mergeRegionLists(getDefaultForbiddenRegionsForPageMode(inferredMode), inferredMode === "detail" ? ["Table", "FilterBar", "Pagination"] : []);
  const spacing = [
    style.spacing.itemGap,
    style.spacing.pageMargin,
    style.spacing.sectionGap,
    style.spacing.sectionGap ? style.spacing.sectionGap + Math.max(4, Math.round((style.spacing.itemGap ?? 8) / 2)) : undefined
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return {
    templateId: template.id,
    templateName: template.name,
    score: 0,
    reasons: [],
    platformPolicy,
    dimensions: platformPolicy === "full" ? { width: Math.round(template.width), height: Math.round(template.height) } : undefined,
    pageMode: inferredMode === "unknown" ? undefined : inferredMode,
    requiredRegions,
    forbiddenRegions,
    regionOrder: structure.regionOrder,
    styleTokens: {
      colors: {
        background: style.colors.background,
        surface: style.colors.surface,
        primary: style.colors.primary,
        text: style.colors.text,
        mutedText: style.colors.mutedText,
        border: style.colors.border
      },
      radius: {
        card: style.radius.card,
        control: style.radius.input,
        button: style.radius.button
      },
      spacing: spacing.length > 0 ? Array.from(new Set(spacing.map((value) => Math.round(value)))).sort((a, b) => a - b) : [],
      typography: {
        title: style.typography.title,
        body: style.typography.body,
        caption: style.typography.caption
      }
    },
    componentStyle: style.components
  };
}

function summarizeTemplateStructureForContract(nodes: WorkspaceDesignNode[]) {
  const regions = Array.from(new Set(nodes.flatMap((node) => {
    const label = `${node.type} ${node.name} ${node.text ?? ""}`;
    return [
      /nav|header|顶部|导航|标题栏/i.test(label) ? "Header" : "",
      /summary|metric|统计|指标|摘要|状态/i.test(label) ? "Summary" : "",
      /filter|search|query|筛选|搜索|查询/i.test(label) ? "FilterBar" : "",
      /form|field|input|表单|字段|输入|上传/i.test(label) || node.type === "input" ? "Form" : "",
      /detail|description|详情|信息|资料|明细/i.test(label) ? "DescriptionList" : "",
      /table|表格|数据/i.test(label) || node.type === "table" ? "Table" : "",
      /list|列表|卡片列表|记录/i.test(label) ? "CardList" : "",
      /action|button|操作|按钮|保存|提交|确认|取消|返回/i.test(label) || node.type === "button" ? "ActionBar" : "",
      /timeline|steps|流程|步骤|进度|物流/i.test(label) ? "Steps" : "",
      /footer|底部|页脚|分页/i.test(label) ? "Pagination" : ""
    ].filter(Boolean);
  })));
  const counts = nodes.reduce<Record<string, number>>((result, node) => {
    result[node.type] = (result[node.type] ?? 0) + 1;
    return result;
  }, {});
  const pageMode: PageInteractionMode = regions.includes("Table") || regions.includes("CardList")
    ? "collection"
    : regions.includes("Form")
      ? "form"
      : regions.includes("DescriptionList")
        ? "detail"
        : regions.includes("Steps")
          ? "flow"
          : counts.table > 0
            ? "collection"
            : "unknown";
  return { regionOrder: regions, pageMode };
}

function applyPageTemplateContractToDraft(draft: UiSchemaDraft, contract: PageTemplateContract | undefined): UiSchemaDraft {
  if (!contract) return draft;
  return {
    ...draft,
    designRationale: [
      ...draft.designRationale,
      `Template Matcher: matched ${contract.templateName} (${contract.score}); contract=${contract.platformPolicy}; reasons=${contract.reasons.join("、")}`
    ],
    artboards: draft.artboards.map((artboard) => {
      const inferredPageMode = inferRequestedInteractionMode(`${draft.intent} ${artboard.name} ${artboard.layoutIntent?.name ?? ""} ${artboard.layoutIntent?.title ?? ""}`);
      const explicitPageMode = normalizePageModeForTemplateMatch(artboard.pageMode);
      const pageMode = (explicitPageMode && explicitPageMode !== "unknown" ? explicitPageMode : undefined)
        || (inferredPageMode !== "unknown" ? inferredPageMode : undefined)
        || contract.pageMode
        || "unknown";
      const explicitRequiredRegions = artboard.requiredRegions.length > 0;
      const requiredRegions = explicitRequiredRegions
        ? sanitizeRequiredRegionsForPageMode(artboard.requiredRegions, pageMode)
        : sanitizeRequiredRegionsForPageMode(mergeRegionLists(getDefaultRequiredRegionsForPageMode(pageMode), contract.requiredRegions), pageMode);
      return {
        ...artboard,
        width: contract.platformPolicy === "full" && contract.dimensions ? contract.dimensions.width : artboard.width,
        height: contract.platformPolicy === "full" && contract.dimensions ? contract.dimensions.height : artboard.height,
        pageMode,
        requiredRegions,
        forbiddenRegions: sanitizeForbiddenRegionsForPageMode(mergeRegionLists(artboard.forbiddenRegions, contract.forbiddenRegions), pageMode),
        layoutPattern: artboard.layoutPattern === "custom" && contract.pageMode ? defaultLayoutPatternForMode(contract.pageMode, draft.platform) : artboard.layoutPattern,
        styleTokens: {
          ...(artboard as typeof artboard & { styleTokens?: Record<string, unknown> }).styleTokens,
          pageTemplateContract: {
            templateId: contract.templateId,
            templateName: contract.templateName,
            platformPolicy: contract.platformPolicy,
            colors: contract.styleTokens.colors,
            radius: contract.styleTokens.radius,
            spacing: contract.styleTokens.spacing,
            typography: contract.styleTokens.typography,
            regionOrder: contract.regionOrder
          }
        }
      };
    })
  };
}

function sanitizeRequiredRegionsForPageMode(regions: string[], pageMode: string) {
  const forbidden = new Set(getDefaultForbiddenRegionsForPageMode(pageMode).map(normalizeIntentRegionName));
  return mergeRegionLists(regions).filter((region) => !forbidden.has(normalizeIntentRegionName(region)));
}

function sanitizeForbiddenRegionsForPageMode(regions: string[], pageMode: string) {
  const required = new Set(getDefaultRequiredRegionsForPageMode(pageMode).map(normalizeIntentRegionName));
  return mergeRegionLists(regions).filter((region) => !required.has(normalizeIntentRegionName(region)));
}

function applyPageTemplateContractToProfile(profile: DesignCapabilityProfile, contract: PageTemplateContract | undefined): DesignCapabilityProfile {
  if (!contract || profile.libraries.length === 0) return profile;
  const [primary, ...rest] = profile.libraries;
  const tokens = primary.tokens;
  const colors = contract.styleTokens.colors;
  const radius = contract.styleTokens.radius;
  const typography = contract.styleTokens.typography;
  return {
    ...profile,
    libraries: [{
      ...primary,
      id: `${primary.id}-template-${contract.templateId}`,
      name: `${primary.name} + ${contract.templateName}`,
      tokens: {
        colors: {
          background: colors.background ?? tokens.colors.background,
          surface: colors.surface ?? tokens.colors.surface,
          primary: colors.primary ?? tokens.colors.primary,
          text: colors.text ?? tokens.colors.text,
          mutedText: colors.mutedText ?? tokens.colors.mutedText,
          border: colors.border ?? tokens.colors.border
        },
        radius: {
          card: radius.card ?? tokens.radius.card,
          control: radius.control ?? tokens.radius.control,
          button: radius.button ?? tokens.radius.button
        },
        spacing: contract.styleTokens.spacing.length > 0 ? contract.styleTokens.spacing : tokens.spacing,
        typography: {
          title: typography.title ?? tokens.typography.title,
          body: typography.body ?? tokens.typography.body,
          caption: typography.caption ?? tokens.typography.caption
        }
      }
    }, ...rest]
  };
}

function normalizePageModeForTemplateMatch(value: unknown): PageInteractionMode | undefined {
  const text = typeof value === "string" ? value : "";
  return ["collection", "detail", "form", "dashboard", "auth", "settings", "flow"].includes(text)
    ? text as PageInteractionMode
    : undefined;
}

function defaultLayoutPatternForMode(mode: PageInteractionMode, platform: "web" | "mobile_app") {
  if (mode === "collection") return platform === "mobile_app" ? "mobileList" : "pcTable";
  if (mode === "detail") return platform === "mobile_app" ? "mobileDetail" : "pcDetail";
  if (mode === "form") return platform === "mobile_app" ? "mobileForm" : "pcForm";
  if (mode === "dashboard") return "pcDashboard";
  if (mode === "auth") return "authCentered";
  if (mode === "settings") return "settingsSplit";
  if (mode === "flow") return "flowSteps";
  return "custom";
}

function templateRegionMatchesPageMode(region: string, mode: PageInteractionMode) {
  if (mode === "collection") return ["Table", "CardList", "FilterBar", "Pagination"].includes(region);
  if (mode === "detail") return ["DescriptionList", "Summary"].includes(region);
  if (mode === "form") return ["Form", "ActionBar"].includes(region);
  if (mode === "flow") return ["Steps"].includes(region);
  if (mode === "dashboard") return ["Summary"].includes(region);
  return false;
}

function shouldInheritTemplateRegionForPageMode(region: string, mode: PageInteractionMode) {
  if (mode === "detail") return !["Table", "CardList", "FilterBar", "Pagination"].includes(region);
  if (mode === "form" || mode === "auth") return !["Table", "CardList", "Pagination"].includes(region);
  if (mode === "collection") return !["DescriptionList", "DetailPanel"].includes(region);
  return !["Table", "Pagination"].includes(region);
}

function mergeRegionLists(...lists: string[][]) {
  return Array.from(new Set(lists.flat().map((region) => region.trim()).filter(Boolean)));
}

function normalizeTemplateMatchText(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function tokenizeTemplateMatchText(value: string) {
  const normalized = value.toLowerCase();
  const parts = normalized.split(/[\s,，、;；/|:：()[\]{}"'`]+/).filter(Boolean);
  const chinese = normalized.match(/[\u4e00-\u9fff]{2,8}/g) ?? [];
  return Array.from(new Set([...parts, ...chinese].map((part) => part.trim()).filter((part) => part.length >= 2))).slice(0, 80);
}

function layoutIntentHasRegion(
  root: LayoutIntentDraftNode,
  region: string,
  stats: ReturnType<typeof collectLayoutIntentStats>
) {
  const normalized = normalizeIntentRegionName(region);
  if (!normalized) return false;
  if (normalized === "content") return stats.hasContent;
  if (normalized === "header") return stats.hasToolbar || layoutIntentTreeHasRegion(root, normalized);
  if (normalized === "summary") return stats.hasMetric || layoutIntentTreeHasRegion(root, normalized);
  if (normalized === "filter") return stats.hasFilter;
  if (normalized === "table") return stats.tableCount > 0 || layoutIntentTreeHasRegion(root, normalized);
  if (normalized === "collection") return stats.hasCollectionContent;
  if (normalized === "detail") return stats.hasDetailContent;
  if (normalized === "form") return stats.hasForm;
  if (normalized === "action") return stats.hasAction;
  if (normalized === "pagination") return layoutIntentTreeHasRegion(root, normalized);
  if (normalized === "steps") return stats.hasSteps;
  if (normalized === "navigation") return stats.hasNavigation;
  if (normalized === "feedback") return stats.hasFeedback;
  return layoutIntentTreeHasRegion(root, normalized);
}

function layoutIntentTreeHasRegion(root: LayoutIntentDraftNode, region: string): boolean {
  const visit = (node: LayoutIntentDraftNode): boolean => {
    const type = normalizeIntentTypeForValidation(node.type);
    const slot = typeof node.slot === "string" ? normalizeIntentRegionName(node.slot) : "";
    const label = normalizeIntentRegionName(`${node.name ?? ""} ${node.title ?? ""} ${node.label ?? ""}`);
    if (typeMatchesRegion(type, region) || slot === region || label === region) return true;
    return Boolean(node.children?.some(visit));
  };
  return visit(root);
}

function normalizeIntentRegionName(value: string) {
  const text = value.replace(/[\s_-]+/g, "").toLowerCase();
  if (!text) return "";
  if (/^(header|pageheader|toolbar|topbar|navbar|nav|标题栏|页头|顶部|导航)$/.test(text)) return "header";
  if (/^(summary|metric|metricgroup|overview|摘要|概览|统计|指标)$/.test(text)) return "summary";
  if (/^(filter|filterbar|search|searchbar|query|筛选|搜索|查询)$/.test(text)) return "filter";
  if (/^(table|datatable|dataTable|表格|数据表)$/.test(text)) return "table";
  if (/^(list|cardlist|grid|collection|列表|卡片列表|集合)$/.test(text)) return "collection";
  if (/^(descriptionlist|detail|detailpanel|panel|详情|明细|资料|信息)$/.test(text)) return "detail";
  if (/^(form|field|input|表单|字段|录入)$/.test(text)) return "form";
  if (/^(action|actions|actionbar|button|buttongroup|footer|操作|按钮|底部操作)$/.test(text)) return "action";
  if (/^(pagination|pager|分页)$/.test(text)) return "pagination";
  if (/^(steps|stepper|timeline|flow|流程|步骤|时间线|进度)$/.test(text)) return "steps";
  if (/^(sidebar|sidenav|tabs|tabbar|breadcrumb|navigation|导航|侧边栏|标签页|面包屑)$/.test(text)) return "navigation";
  if (/^(empty|emptystate|alert|toast|modal|drawer|loading|feedback|空状态|提示|弹窗|抽屉|加载)$/.test(text)) return "feedback";
  if (/^(content|section|card|main|body|内容|主体|区块)$/.test(text)) return "content";
  return text;
}

function typeMatchesRegion(type: string, region: string) {
  if (region === "header") return ["toolbar", "pageheader", "topbar", "navbar"].includes(type);
  if (region === "summary") return ["metricgroup", "metric", "summary"].includes(type);
  if (region === "filter") return ["filterbar", "filter", "searchbar", "search"].includes(type);
  if (region === "table") return ["table", "datatable"].includes(type);
  if (region === "collection") return ["list", "cardlist", "grid", "listitem"].includes(type);
  if (region === "detail") return ["descriptionlist", "detail", "detailpanel", "panel"].includes(type);
  if (region === "form") return ["form", "input", "select", "upload", "radiogroup", "checkboxgroup"].includes(type);
  if (region === "action") return ["actionbar", "button", "buttongroup"].includes(type);
  if (region === "pagination") return ["pagination", "pager"].includes(type);
  if (region === "steps") return ["steps", "stepper", "timeline"].includes(type);
  if (region === "navigation") return ["sidebar", "sidenav", "tabs", "tabbar", "breadcrumb"].includes(type);
  if (region === "feedback") return ["emptystate", "empty", "alert", "toast", "modal", "drawer", "loading"].includes(type);
  if (region === "content") return ["page", "section", "stack", "grid", "card", "panel", "content"].includes(type);
  return type === region;
}

function normalizeIntentTypeForValidation(type: string) {
  return type.replace(/[\s_-]+/g, "").toLowerCase();
}

function summarizeSchemaDraftParseFailure(value: unknown, issues: z.ZodIssue[]) {
  const keys = isRecordLikeForSchema(value) ? Object.keys(value).slice(0, 12).join(",") : typeof value;
  const issueText = issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "root"} ${issue.message}`).join("；");
  return `topLevel=${keys || "empty"}；${issueText || "unknown schema parse error"}`;
}

export const designAgentToolNameSchema = z.enum([
  "requirement.parse",
  "flow.generate",
  "asset.resolve",
  "schema.generate_ui_from_requirements",
  "page.list",
  "page.get_schema",
  "page.analyze_structure",
  "page.create",
  "page.rename",
  "page.delete",
  "page.duplicate",
  "product.review_requirements",
  "layout.insert_above",
  "layout.plan_insert",
  "layout.apply_intent_patch",
  "layout.reflow",
  "layout.update_spacing",
  "schema.validate",
  "schema.find_nodes",
  "schema.find_nodes_by_semantic",
  "schema.get_node_tree",
  "schema.create_menu",
  "schema.add_nodes",
  "schema.add_child",
  "schema.insert_before",
  "schema.update_node",
  "schema.delete_node",
  "schema.duplicate_node",
  "schema.generate_from_prompt",
  "component_library.list",
  "component_library.create",
  "page_template.list",
  "component.search",
  "component.insert",
  "component.create_from_nodes",
  "workspace.read_file",
  "canvas.capture",
  "ui.analyze_layout",
  "ui.analyze_spacing",
  "ui.analyze_color",
  "ui.analyze_typography",
  "ui.review",
  "ui.review_design",
  "ui.critic_review",
  "conversation.get_recent_messages",
  "conversation.search_messages",
  "conversation.get_tool_history",
  "conversation.get_last_failed_step",
  "web.search",
  "image.to_schema"
]);

export const designAgentToolCallSchema = z.object({
  tool: designAgentToolNameSchema,
  reason: z.string().default(""),
  input: z.record(z.unknown()).default({})
}).transform((call) => {
  if (call.tool !== "schema.generate_ui_from_requirements") return call;
  const input = { ...call.input };
  const loose = call as typeof call & Record<string, unknown>;
  if (input.schemaDraft === undefined) {
    const candidate = loose.schemaDraft ?? loose.uiSchemaDraft ?? loose.draft ?? loose.schema;
    if (candidate !== undefined) input.schemaDraft = candidate;
  }
  return { ...call, input };
});

export const designAgentPlanSchema = z.object({
  title: z.string().default("AI Design Agent 执行计划"),
  userGoal: z.string().default(""),
  assumptions: z.array(z.string()).default([]),
  mode: z.enum(["answer", "plan", "execute"]).default("execute"),
  reply: z.string().default(""),
  steps: z.array(designAgentToolCallSchema).max(8).default([])
});

export type DesignAgentToolName = z.infer<typeof designAgentToolNameSchema>;
export type DesignAgentToolCall = z.infer<typeof designAgentToolCallSchema>;
export type DesignAgentPlan = z.infer<typeof designAgentPlanSchema>;

export interface DesignAgentToolExecutionContext {
  projectId: string;
  selectedPageId?: string;
  conversationId?: string;
}

export interface DesignAgentToolResult {
  ok: boolean;
  message: string;
  data?: unknown;
  file?: WorkspaceDesignFile;
  page?: WorkspaceDesignPage;
  selectedPageId?: string;
}

export const designAgentToolDescriptions: Array<{
  name: DesignAgentToolName;
  description: string;
  inputSchema: unknown;
}> = [
  {
    name: "requirement.parse",
    description: "把用户自然语言需求解析成结构化模块、功能点、实体、优先级。用于从零生成 UI 稿前的需求理解。",
    inputSchema: { userRequest: "string" }
  },
  {
    name: "flow.generate",
    description: "根据结构化需求生成功能页面清单、用户流程、必要状态。用于 create_new_ui。",
    inputSchema: { userRequest: "string", parsedRequirement: "optional object" }
  },
  {
    name: "asset.resolve",
    description: "素材 Agent 解析图标/图片/插画需求，优先返回本地或内部素材占位信息，不直接随机联网抓图。",
    inputSchema: { userRequest: "string", assetRequests: "optional array" }
  },
  {
    name: "schema.generate_ui_from_requirements",
    description: "根据需求解析、页面清单和流程，在当前画布已有画板右侧追加多张可编辑 UI 画板；优先传 layoutIntent，由本地 Layout Compiler 计算坐标和间距；传 targetFrameId 时改为把 schemaDraft 的节点增量追加到已有画板内。",
    inputSchema: { userRequest: "string", parsedRequirement: "optional object", flowPlan: "optional object", platform: "optional mobile_app | web", pageId: "optional string", gap: "optional number", targetFrameId: "optional string", schemaDraft: "optional aipm.design.schema.v1 with artboard.layoutIntent" }
  },
  {
    name: "page.list",
    description: "查询当前 AI Design 文件的页面列表、页面 ID、节点数量。",
    inputSchema: {}
  },
  {
    name: "page.get_schema",
    description: "获取指定页面或当前页面的完整 schema，适合分析、对比、二次修改前读取上下文。",
    inputSchema: { pageId: "optional string" }
  },
  {
    name: "page.analyze_structure",
    description: "把当前页面 schema 分析成语义结构，识别页面类型、主区域、表格、筛选区、推荐插入点。用于避免只靠 find_nodes 猜节点。",
    inputSchema: { pageId: "optional string", userRequest: "optional string" }
  },
  {
    name: "page.create",
    description: "新建页面，可携带初始 nodes。只有用户明确要求新建/创建页面时使用。",
    inputSchema: { name: "string", nodes: "optional DesignNode[]" }
  },
  {
    name: "page.rename",
    description: "重命名当前页面或指定页面。",
    inputSchema: { pageId: "optional string", name: "string" }
  },
  {
    name: "page.delete",
    description: "删除当前页面或指定页面。只有用户明确要求删除页面时使用，不要用于删除节点。",
    inputSchema: { pageId: "optional string" }
  },
  {
    name: "page.duplicate",
    description: "复制当前页面或指定页面，保留 schema 并生成新的 pageId/nodeId。",
    inputSchema: { pageId: "optional string", name: "optional string" }
  },
  {
    name: "product.review_requirements",
    description: "产品 Agent 根据页面语义和用户目标判断业务字段是否合理，例如列表页搜索条件推荐商品名称、分类、状态等。",
    inputSchema: { pageId: "optional string", userRequest: "string", pageStructure: "optional object" }
  },
  {
    name: "layout.insert_above",
    description: "在目标节点上方插入一个节点组，并自动下移目标节点及其下方内容，避免遮挡。适合在表格上方新增搜索/筛选区。",
    inputSchema: { pageId: "optional string", targetNodeId: "optional string", insertKind: "filter_bar | custom", filters: "optional Filter[]", spacing: "optional number", height: "optional number" }
  },
  {
    name: "layout.plan_insert",
    description: "基于页面语义为插入类任务生成推荐插入计划，不修改 schema。适合先判断插入点、父容器、目标节点和布局补偿策略。",
    inputSchema: { pageId: "optional string", userRequest: "string", insertKind: "optional string" }
  },
  {
    name: "layout.apply_intent_patch",
    description: "按语义意图修改已有画板或区块，支持 reflow、set_gap、move_section、add_table_column、add_form_field、fix_vertical_text、expand_parent、convert_table_to_card_list、normalize_action_bar、remove_irrelevant_section、change_layout、add_required_region、remove_forbidden_region、change_page_contract。change_page_contract 会按新 pageMode 自动移除禁用区域并补齐最低 required region，避免直接坐标微调。",
    inputSchema: { pageId: "optional string", targetNodeId: "optional string", semantic: "optional header | filter_bar | table | form | content | footer | action_bar", operation: "reflow | set_gap | move_section | add_table_column | add_form_field | fix_vertical_text | expand_parent | convert_table_to_card_list | normalize_action_bar | remove_irrelevant_section | change_layout | add_required_region | remove_forbidden_region | change_page_contract", spacing: "optional number", direction: "optional up | down", amount: "optional number", label: "optional string", field: "optional string", column: "optional string", region: "optional string", regions: "optional string[]", pageMode: "optional string", businessEntity: "optional string", layoutPattern: "optional string", layout: "optional single_column | two_column | stack", reason: "optional string" }
  },
  {
    name: "layout.reflow",
    description: "对页面或指定画板做语义重排，按画板内 section/card/table/form 等模块纵向 stack，解决遮挡、重叠和间距不足。",
    inputSchema: { pageId: "optional string", targetNodeId: "optional string", semantic: "optional string", spacing: "optional number" }
  },
  {
    name: "layout.update_spacing",
    description: "调整指定节点与其下方同级节点的垂直间距，避免搜索区和表格贴得过近。",
    inputSchema: { pageId: "optional string", nodeId: "string", marginBottom: "optional number" }
  },
  {
    name: "schema.validate",
    description: "校验页面 schema 是否包含合法节点、尺寸、坐标、父子引用和基础字段。",
    inputSchema: { pageId: "optional string" }
  },
  {
    name: "schema.find_nodes",
    description: "在当前页面或指定页面中查找节点，支持按 type、name、text、position(left/right/top/bottom/center) 粗略定位。修改页面前可先用它定位目标区域。",
    inputSchema: { pageId: "optional string", query: "object: { type?, name?, text?, position? }" }
  },
  {
    name: "schema.find_nodes_by_semantic",
    description: "按页面语义查找节点，例如 table、filter_bar、header、main_content，并返回排序后的候选。用于多个节点命中时做可靠选择。",
    inputSchema: { pageId: "optional string", semantic: "table | filter_bar | header | main_content", userRequest: "optional string" }
  },
  {
    name: "schema.get_node_tree",
    description: "返回当前页面的节点父子树和节点摘要，用于判断容器层级、插入父节点和局部结构。",
    inputSchema: { pageId: "optional string", rootNodeId: "optional string" }
  },
  {
    name: "schema.create_menu",
    description: "确定性创建左侧/右侧菜单组件。用于“添加菜单/导航栏/侧边栏菜单”等任务，不要用 update_node 伪装添加。若已存在菜单，会停止并返回建议。",
    inputSchema: { pageId: "optional string", position: "left | right", items: "optional string[]", title: "optional string" }
  },
  {
    name: "schema.add_nodes",
    description: "向当前页面或指定页面新增一个或多个节点，支持 text、image、card、container、table 等基础类型。可用 position.before/autoLayout 做基础插入补偿。",
    inputSchema: { pageId: "optional string", nodes: "DesignNode[]", position: "optional { type: 'before', targetNodeId: string }", autoLayout: "optional boolean" }
  },
  {
    name: "schema.add_child",
    description: "向指定父节点追加子节点，并自动设置 parentId。适合已有搜索区时追加字段。",
    inputSchema: { pageId: "optional string", parentNodeId: "string", nodes: "DesignNode[]" }
  },
  {
    name: "schema.insert_before",
    description: "在目标节点之前插入节点组，并可自动下移目标及其下方内容。适合没有高阶 layout 工具时的插入兜底。",
    inputSchema: { pageId: "optional string", targetNodeId: "string", nodes: "DesignNode[]", spacing: "optional number", autoLayout: "optional boolean" }
  },
  {
    name: "schema.update_node",
    description: "修改指定节点或按 type/name 匹配节点的局部 schema，例如 table 列、text 文案、image 地址、shape 填充等。",
    inputSchema: { pageId: "optional string", nodeId: "optional string", match: "optional object", patch: "DesignNode patch" }
  },
  {
    name: "schema.delete_node",
    description: "删除当前页面中指定节点或按 type/name 匹配的节点，不删除页面。",
    inputSchema: { pageId: "optional string", nodeId: "optional string", match: "optional object" }
  },
  {
    name: "schema.duplicate_node",
    description: "复制当前页面中指定节点或按 type/name 匹配的节点。",
    inputSchema: { pageId: "optional string", nodeId: "optional string", match: "optional object" }
  },
  {
    name: "schema.generate_from_prompt",
    description: "根据自然语言提示生成一组可编辑 schema nodes。用于新增组件或生成页面局部结构。",
    inputSchema: { prompt: "string", pageId: "optional string" }
  },
  {
    name: "component_library.list",
    description: "读取本地组件库和组件摘要。用于用户要求使用本地组件库、AntD 组件库或项目内沉淀组件时先做资源检索。",
    inputSchema: {}
  },
  {
    name: "component_library.create",
    description: "创建本地组件库，保存到 SQLite。用于项目还没有合适组件库，或需要沉淀一套新的业务/风格组件库时。",
    inputSchema: { name: "string", description: "optional string" }
  },
  {
    name: "page_template.list",
    description: "读取用户从整页/框选区域创建的页面模板摘要，包括 StyleProfile、尺寸、结构区块和关键文本。传 userRequest 时会返回后端 Template Matcher 选中的模板和 Template Contract；模板不是本地组件库，不能直接当组件插入。",
    inputSchema: { userRequest: "optional string", platform: "optional mobile_app | web" }
  },
  {
    name: "component.search",
    description: "按组件库、组件名称、描述、文本内容和节点类型搜索本地组件。用于选择最匹配的组件资产，不直接修改画布。",
    inputSchema: { libraryId: "optional string", libraryName: "optional string", query: "optional string", componentName: "optional string", limit: "optional number" }
  },
  {
    name: "component.insert",
    description: "把本地组件库里的组件插入到当前页面。会克隆节点 id，并按 x/y 或目标区域坐标平移组件，保持组件内部相对位置。",
    inputSchema: { pageId: "optional string", componentId: "optional string", componentName: "optional string", libraryId: "optional string", libraryName: "optional string", query: "optional string", x: "optional number", y: "optional number" }
  },
  {
    name: "component.create_from_nodes",
    description: "把当前页面的一组节点保存为本地组件库组件，保存到 SQLite。组件内部坐标会归零，适合把高质量 UI 稿中的查询区、表格区、卡片、页头等沉淀成模板。",
    inputSchema: { pageId: "optional string", nodeIds: "string[] optional", match: "optional object", libraryId: "optional string", libraryName: "optional string", libraryDescription: "optional string", componentName: "string", componentDescription: "optional string", includeDescendants: "optional boolean" }
  },
  {
    name: "workspace.read_file",
    description: "只读读取当前 project workspace 内的文件，用于参考 PRD、schema、素材说明等，禁止读取 workspace 外路径。",
    inputSchema: { path: "string" }
  },
  {
    name: "canvas.capture",
    description: "对当前画布、选中区域或节点生成可预览截图。当前版本先返回 schema 渲染的 SVG 预览，后续可接浏览器真实截图和视觉模型识别。",
    inputSchema: { pageId: "optional string", nodeId: "optional string", nodeIds: "optional string[]", mode: "optional rightmost_artboards | selected | page", limit: "optional number" }
  },
  {
    name: "ui.analyze_layout",
    description: "基于当前页面 schema 分析布局结构、主要区域、越界/重叠等问题。用于 UI 设计 Agent review。",
    inputSchema: { pageId: "optional string" }
  },
  {
    name: "ui.analyze_spacing",
    description: "基于当前页面 schema 分析组件间距、密度和对齐问题。用于 UI 设计 Agent review。",
    inputSchema: { pageId: "optional string" }
  },
  {
    name: "ui.analyze_color",
    description: "基于当前页面 schema 分析颜色使用、背景层级和主色一致性。用于 UI 设计 Agent review。",
    inputSchema: { pageId: "optional string" }
  },
  {
    name: "ui.analyze_typography",
    description: "基于当前页面 schema 分析字体大小、文本层级和可读性。用于 UI 设计 Agent review。",
    inputSchema: { pageId: "optional string" }
  },
  {
    name: "ui.review",
    description: "对当前页面 schema 做综合 UI review，输出布局、间距、颜色、字体和可编辑性建议，不直接修改 schema。",
    inputSchema: { pageId: "optional string" }
  },
  {
    name: "ui.review_design",
    description: "UI Agent 针对设计目标做专业审核，检查搜索区位置、表格遮挡、间距、对齐和是否有阻塞问题。",
    inputSchema: { pageId: "optional string", userRequest: "optional string" }
  },
  {
    name: "ui.critic_review",
    description: "Critic Agent 对生成后的 UI 稿做需求覆盖、无关内容、页面流程、布局和状态完整性审查。",
    inputSchema: { userRequest: "string", pageIds: "optional string[]" }
  },
  {
    name: "conversation.get_recent_messages",
    description: "获取当前会话最近的消息记录，用于用户说继续、刚才、上次、为什么失败时恢复上下文。",
    inputSchema: { limit: "optional number" }
  },
  {
    name: "conversation.search_messages",
    description: "按关键词搜索当前项目或当前会话消息，用于查找用户之前说过的约束和执行记录。",
    inputSchema: { keyword: "string", conversationId: "optional string", limit: "optional number" }
  },
  {
    name: "conversation.get_tool_history",
    description: "获取当前会话工具调用历史，包括参数、结果、失败原因。",
    inputSchema: { toolName: "optional string", limit: "optional number" }
  },
  {
    name: "conversation.get_last_failed_step",
    description: "获取当前会话最近一次失败工具调用，用于自动修复和继续执行。",
    inputSchema: {}
  },
  {
    name: "web.search",
    description: "联网搜索能力占位。后续接 web search/MCP，用于搜索 Sketch 素材、页面参考、竞品等。",
    inputSchema: { query: "string" }
  },
  {
    name: "image.to_schema",
    description: "图片转 schema 能力占位。后续接视觉模型，将截图、参考图解析成 DesignNode schema。",
    inputSchema: { imagePath: "string" }
  }
];

export class DesignAgentToolService {
  private readonly imageAssets = new ImageAssetProvider();

  constructor(private readonly repository: WorkspaceProjectRepository) {}

  async execute(context: DesignAgentToolExecutionContext, call: DesignAgentToolCall): Promise<DesignAgentToolResult> {
    const normalized = designAgentToolCallSchema.parse(call);
    switch (normalized.tool) {
      case "requirement.parse":
        return this.parseRequirement(context.projectId, normalized.input);
      case "flow.generate":
        return this.generateFlow(context.projectId, normalized.input);
      case "asset.resolve":
        return this.resolveAssets(context.projectId, normalized.input);
      case "schema.generate_ui_from_requirements":
        return this.generateUiFromRequirements(context.projectId, normalized.input, context.selectedPageId);
      case "page.list":
        return this.listPages(context.projectId);
      case "page.get_schema":
        return this.getPageSchema(context.projectId, normalized.input.pageId as string | undefined ?? context.selectedPageId);
      case "page.analyze_structure":
        return this.analyzePageStructure(context.projectId, normalized.input, context.selectedPageId);
      case "page.create":
        return this.createPage(context.projectId, normalized.input);
      case "page.rename":
        return this.renamePage(context.projectId, normalized.input, context.selectedPageId);
      case "page.delete":
        return this.deletePage(context.projectId, normalized.input.pageId as string | undefined ?? context.selectedPageId);
      case "page.duplicate":
        return this.duplicatePage(context.projectId, normalized.input, context.selectedPageId);
      case "product.review_requirements":
        return this.reviewProductRequirements(context.projectId, normalized.input, context.selectedPageId);
      case "layout.insert_above":
        return this.insertAbove(context.projectId, normalized.input, context.selectedPageId);
      case "layout.plan_insert":
        return this.planInsert(context.projectId, normalized.input, context.selectedPageId);
      case "layout.apply_intent_patch":
        return this.applyIntentPatch(context.projectId, normalized.input, context.selectedPageId);
      case "layout.reflow":
        return this.reflowLayout(context.projectId, normalized.input, context.selectedPageId);
      case "layout.update_spacing":
        return this.updateSpacing(context.projectId, normalized.input, context.selectedPageId);
      case "schema.validate":
        return this.validateSchema(context.projectId, normalized.input.pageId as string | undefined ?? context.selectedPageId);
      case "schema.find_nodes":
        return this.findNodes(context.projectId, normalized.input, context.selectedPageId);
      case "schema.find_nodes_by_semantic":
        return this.findNodesBySemantic(context.projectId, normalized.input, context.selectedPageId);
      case "schema.get_node_tree":
        return this.getNodeTree(context.projectId, normalized.input, context.selectedPageId);
      case "schema.create_menu":
        return this.createMenu(context.projectId, normalized.input, context.selectedPageId);
      case "schema.add_nodes":
        return this.addNodes(context.projectId, normalized.input, context.selectedPageId);
      case "schema.add_child":
        return this.addChild(context.projectId, normalized.input, context.selectedPageId);
      case "schema.insert_before":
        return this.insertBefore(context.projectId, normalized.input, context.selectedPageId);
      case "schema.update_node":
        return this.updateNode(context.projectId, normalized.input, context.selectedPageId);
      case "schema.delete_node":
        return this.deleteNode(context.projectId, normalized.input, context.selectedPageId);
      case "schema.duplicate_node":
        return this.duplicateNode(context.projectId, normalized.input, context.selectedPageId);
      case "schema.generate_from_prompt":
        return this.generateSchemaFromPrompt(context.projectId, normalized.input, context.selectedPageId);
      case "component_library.list":
        return this.listComponentLibraries(context.projectId);
      case "component_library.create":
        return this.createComponentLibrary(context.projectId, normalized.input);
      case "page_template.list":
        return this.listPageTemplates(context.projectId, normalized.input);
      case "component.search":
        return this.searchComponents(context.projectId, normalized.input);
      case "component.insert":
        return this.insertComponent(context.projectId, normalized.input, context.selectedPageId);
      case "component.create_from_nodes":
        return this.createComponentFromNodes(context.projectId, normalized.input, context.selectedPageId);
      case "workspace.read_file":
        return this.readWorkspaceFile(context.projectId, normalized.input.path as string | undefined);
      case "canvas.capture":
        return this.captureCanvas(context.projectId, normalized.input, context.selectedPageId);
      case "ui.analyze_layout":
        return this.analyzeUi(context.projectId, normalized.input.pageId as string | undefined ?? context.selectedPageId, "layout");
      case "ui.analyze_spacing":
        return this.analyzeUi(context.projectId, normalized.input.pageId as string | undefined ?? context.selectedPageId, "spacing");
      case "ui.analyze_color":
        return this.analyzeUi(context.projectId, normalized.input.pageId as string | undefined ?? context.selectedPageId, "color");
      case "ui.analyze_typography":
        return this.analyzeUi(context.projectId, normalized.input.pageId as string | undefined ?? context.selectedPageId, "typography");
      case "ui.review":
        return this.analyzeUi(context.projectId, normalized.input.pageId as string | undefined ?? context.selectedPageId, "review");
      case "ui.review_design":
        return this.reviewDesign(context.projectId, normalized.input, context.selectedPageId);
      case "ui.critic_review":
        return this.criticReview(context.projectId, normalized.input, context.selectedPageId);
      case "conversation.get_recent_messages":
        return this.getRecentMessages(context.projectId, context.conversationId, normalized.input.limit as number | undefined);
      case "conversation.search_messages":
        return this.searchMessages(context.projectId, {
          conversationId: normalized.input.conversationId as string | undefined ?? context.conversationId,
          keyword: normalized.input.keyword as string | undefined,
          limit: normalized.input.limit as number | undefined
        });
      case "conversation.get_tool_history":
        return this.getToolHistory(context.projectId, context.conversationId, normalized.input.toolName as string | undefined, normalized.input.limit as number | undefined);
      case "conversation.get_last_failed_step":
        return this.getLastFailedStep(context.projectId, context.conversationId);
      case "web.search":
        return {
          ok: false,
          message: "联网搜索 tool 已注册，但当前版本还没有接真实搜索提供方。后续可以接 web search/MCP。",
          data: { query: normalized.input.query }
        };
      case "image.to_schema":
        return {
          ok: false,
          message: "图片转 schema tool 已注册，但当前版本还没有接视觉模型。后续会把图片识别结果转为 nodes。",
          data: { imagePath: normalized.input.imagePath }
        };
    }
  }

  private async parseRequirement(projectId: string, input: Record<string, unknown>): Promise<DesignAgentToolResult> {
    await this.getFile(projectId);
    const userRequest = String(input.userRequest ?? "");
    const parsed = parseUiRequirement(userRequest);
    return {
      ok: true,
      message: formatRequirementParseMessage(parsed),
      data: parsed
    };
  }

  private async generateFlow(projectId: string, input: Record<string, unknown>): Promise<DesignAgentToolResult> {
    await this.getFile(projectId);
    const parsed = isRecord(input.parsedRequirement) ? input.parsedRequirement : parseUiRequirement(String(input.userRequest ?? ""));
    const flowPlan = generateUiFlowPlan(parsed);
    return {
      ok: true,
      message: [
        `已生成 ${flowPlan.pages.length} 个页面和 ${flowPlan.flows.length} 条用户流程。`,
        flowPlan.pages.length > 0 ? `页面：${flowPlan.pages.map((page) => page.name).join("、")}` : "",
        flowPlan.flows.length > 0 ? `流程：${flowPlan.flows.map((flow) => `${flow.name}(${flow.steps.join(" -> ")})`).join("；")}` : ""
      ].filter(Boolean).join("\n"),
      data: flowPlan
    };
  }

  private async resolveAssets(projectId: string, input: Record<string, unknown>): Promise<DesignAgentToolResult> {
    await this.getFile(projectId);
    const requests = Array.isArray(input.assetRequests) ? input.assetRequests : inferAssetRequests(String(input.userRequest ?? ""));
    const resolvedImageAssets = await this.imageAssets.resolveAssets(requests.map((request) => isRecord(request) ? request : { name: String(request) }), {
      userRequest: String(input.userRequest ?? "")
    });
    const assets = requests.map((request, index) => {
      const item = isRecord(request) ? request : { type: "icon", name: String(request) };
      const type = String(item.type ?? "icon");
      const name = String(item.name ?? item.query ?? `asset_${index + 1}`);
      const id = `${type}_${name}`.replace(/[^\w-]+/g, "_").toLowerCase();
      const resolved = resolvedImageAssets.find((asset) => asset.id === id || asset.name === name);
      return {
        id,
        type: type === "image" || type === "illustration" ? "image" : "svg",
        source: resolved?.source ?? (type === "image" || type === "illustration" ? "internal_asset_placeholder" : "local_icon_library"),
        usage: String(item.usage ?? name),
        license: resolved?.license ?? "internal-placeholder",
        imageUrl: resolved?.imageUrl,
        alt: resolved?.alt,
        width: resolved?.width,
        height: resolved?.height
      };
    });
    return {
      ok: true,
      message: formatAssetResolveMessage(assets),
      data: { assets, strategy: buildAssetStrategy(assets) }
    };
  }

  private async generateUiFromRequirements(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) {
      return {
        ok: false,
        message: "当前没有可追加 UI 画板的画布，请先创建或导入一个设计页面。",
        file
      };
    }
    const gap = numberOr(input.gap, 40);
    const parsedDraft = uiSchemaDraftSchema.safeParse(input.schemaDraft);
    if (!parsedDraft.success) {
      return {
        ok: false,
        message: `缺少有效的 schemaDraft：${summarizeSchemaDraftParseFailure(input.schemaDraft, parsedDraft.error.issues)}。当前主链路不再使用关键词模板兜底，必须先由 Agent 生成符合 aipm.design.schema.v1 的 UI Schema Draft。`,
        file,
        page,
        selectedPageId: page.id,
        data: { issues: parsedDraft.error.issues }
      };
    }
    const userRequest = String(input.userRequest ?? "");
    const initialSchemaDraft = parsedDraft.data;
    const templateContract = matchPageTemplateContract(file, userRequest, initialSchemaDraft.platform, initialSchemaDraft.artboards[0]);
    const contractedDraft = applyPageTemplateContractToDraft(initialSchemaDraft, templateContract);
    const intentValidation = validateAndNormalizeUiSchemaDraft(contractedDraft, userRequest);
    if (intentValidation.blockingIssues.length > 0) {
      return {
        ok: false,
        message: `Layout Intent 校验失败：${intentValidation.blockingIssues.join("；")}。请重新生成 layoutIntent，禁止退回手写坐标 schema。`,
        file,
        page,
        selectedPageId: page.id,
        data: {
          issues: intentValidation.issues,
          blockingIssues: intentValidation.blockingIssues,
          contractIssues: intentValidation.contractIssues
        }
      };
    }
    const schemaDraft = intentValidation.draft;
    const capabilityProfile = applyPageTemplateContractToProfile(
      getDesignCapabilityProfile(toDesignPlatform(schemaDraft.platform, userRequest), userRequest),
      templateContract
    );
    const targetFrameId = typeof input.targetFrameId === "string" ? input.targetFrameId : "";
    if (targetFrameId) {
      const targetFrame = page.nodes.find((node) => node.id === targetFrameId && node.type === "frame");
      if (!targetFrame) {
        return {
          ok: false,
          message: `没有找到可增量追加的目标画板：${targetFrameId}`,
          file,
          page,
          selectedPageId: page.id
        };
      }
      const resolvedImageAssets = await this.imageAssets.resolveAssets(inferAssetRequests(userRequest), {
        userRequest
      });
      const generatedNodes = applyGeneratedUiConstraints(userRequest, enhanceGeneratedUiNodes(
        [targetFrame, ...createUiNodesFromSchemaDraftIntoFrame(schemaDraft, targetFrame, capabilityProfile)],
        capabilityProfile,
        resolvedImageAssets
      )).filter((node) => node.id !== targetFrame.id);
      const irrelevantContent = detectIrrelevantGeneratedBusinessContent(userRequest, generatedNodes);
      const entityMismatch = detectBusinessEntityMismatch(userRequest, generatedNodes.map((node) => `${node.name} ${node.text ?? ""}`).join(" "));
      if (irrelevantContent.length > 0 || entityMismatch.missingEntities.length > 0) {
        return {
          ok: false,
          message: [
            irrelevantContent.length > 0 ? `生成内容包含用户未要求的业务对象：${irrelevantContent.join("、")}` : "",
            entityMismatch.missingEntities.length > 0 ? `生成内容缺少用户要求的业务对象：${entityMismatch.missingEntities.join("、")}` : "",
            "已拦截落盘，请重新生成并严格按原始需求，不要套订单/商品等默认模板。"
          ].filter(Boolean).join("。"),
          file,
          page,
          selectedPageId: page.id,
          data: { irrelevantContent, entityMismatch }
        };
      }
      const nextPage: WorkspaceDesignPage = {
        ...page,
        nodes: [...page.nodes, ...generatedNodes],
        nodeCount: page.nodes.length + generatedNodes.length,
        schemaLoaded: true
      };
      const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
      return {
        ok: true,
        message: `已向画板「${targetFrame.name}」增量追加 ${generatedNodes.length} 个节点。`,
        file: nextFile,
        page: nextPage,
        selectedPageId: nextPage.id,
        data: {
          pageId: nextPage.id,
          targetFrameId,
          generatedFrameIds: [targetFrameId],
          generatedNodeIds: generatedNodes.map((node) => node.id),
          generatedCount: generatedNodes.length,
          schemaDraft: {
            schemaVersion: schemaDraft.schemaVersion,
            intent: schemaDraft.intent,
            platform: schemaDraft.platform,
            layoutIntentIssues: intentValidation.issues,
            pageTemplateContract: templateContract ? {
              templateId: templateContract.templateId,
              templateName: templateContract.templateName,
              score: templateContract.score,
              platformPolicy: templateContract.platformPolicy,
              requiredRegions: templateContract.requiredRegions,
              forbiddenRegions: templateContract.forbiddenRegions
            } : null,
            artboards: schemaDraft.artboards.map((artboard) => ({ refId: artboard.refId, name: artboard.name, nodeCount: artboard.nodes.length, hasLayoutIntent: Boolean(artboard.layoutIntent) }))
          }
        }
      };
    }
    const firstArtboard = schemaDraft.artboards[0];
    const placement = getCanvasAppendPlacement(page, { width: firstArtboard.width, height: firstArtboard.height }, gap);
    const resolvedImageAssets = await this.imageAssets.resolveAssets(inferAssetRequests(userRequest), {
      userRequest
    });
    const generatedNodes = applyGeneratedUiConstraints(
      userRequest,
      enhanceGeneratedUiNodes(createUiNodesFromSchemaDraft(schemaDraft, placement, capabilityProfile), capabilityProfile, resolvedImageAssets)
    );
    const irrelevantContent = detectIrrelevantGeneratedBusinessContent(userRequest, generatedNodes);
    const entityMismatch = detectBusinessEntityMismatch(userRequest, generatedNodes.map((node) => `${node.name} ${node.text ?? ""}`).join(" "));
    if (irrelevantContent.length > 0 || entityMismatch.missingEntities.length > 0) {
      return {
        ok: false,
        message: [
          irrelevantContent.length > 0 ? `生成内容包含用户未要求的业务对象：${irrelevantContent.join("、")}` : "",
          entityMismatch.missingEntities.length > 0 ? `生成内容缺少用户要求的业务对象：${entityMismatch.missingEntities.join("、")}` : "",
          "已拦截落盘，请重新生成并严格按原始需求，不要套订单/商品等默认模板。"
        ].filter(Boolean).join("。"),
        file,
        page,
        selectedPageId: page.id,
        data: { irrelevantContent, entityMismatch }
      };
    }
    const generatedFrameIds = generatedNodes.filter((node) => node.type === "frame" && !node.parentId).map((node) => node.id);
    const nextPage: WorkspaceDesignPage = {
      ...page,
      nodes: [...page.nodes, ...generatedNodes],
      nodeCount: page.nodes.length + generatedNodes.length,
      schemaLoaded: true
    };
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return {
      ok: true,
      message: `已在当前画布「${page.name}」右侧追加 ${generatedFrameIds.length} 个 UI 画板，顶对齐，水平间距 ${gap}px。`,
      file: nextFile,
      page: nextPage,
      selectedPageId: nextPage.id,
      data: {
        pageId: nextPage.id,
        generatedFrameIds,
        generatedCount: generatedFrameIds.length,
        placement,
        schemaDraft: {
          schemaVersion: schemaDraft.schemaVersion,
          intent: schemaDraft.intent,
          platform: schemaDraft.platform,
          layoutIntentIssues: intentValidation.issues,
          pageTemplateContract: templateContract ? {
            templateId: templateContract.templateId,
            templateName: templateContract.templateName,
            score: templateContract.score,
            platformPolicy: templateContract.platformPolicy,
            requiredRegions: templateContract.requiredRegions,
            forbiddenRegions: templateContract.forbiddenRegions
          } : null,
          artboards: schemaDraft.artboards.map((artboard) => ({ refId: artboard.refId, name: artboard.name, nodeCount: artboard.nodes.length, hasLayoutIntent: Boolean(artboard.layoutIntent) }))
        }
      }
    };
  }

  private async criticReview(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const file = await this.getFile(projectId);
    const userRequest = String(input.userRequest ?? "");
    const requiredTopics = inferRequiredTopics(userRequest);
    const requestedPageIds = Array.isArray(input.pageIds) ? input.pageIds.map(String) : [];
    const generatedFrameIds = Array.isArray(input.generatedFrameIds) ? input.generatedFrameIds.map(String).filter(Boolean) : [];
    const candidatePageIds = requestedPageIds.length > 0 ? requestedPageIds : selectedPageId ? [selectedPageId] : file.pages
      .filter((page) => requiredTopics.length === 0 || requiredTopics.some((topic) => page.name.includes(topic)))
      .map((page) => page.id);
    const pageIds = candidatePageIds.length > 0 ? candidatePageIds : file.pages.map((page) => page.id);
    const pages = await Promise.all(pageIds.map((pageId) => this.repository.getDesignPage(projectId, pageId).catch(() => null)));
    const existingPages = pages.filter((page): page is WorkspaceDesignPage => Boolean(page));
    const scopedNodesByPage = existingPages.map((page) => {
      if (generatedFrameIds.length === 0) return { page, nodes: page.nodes };
      const scopeIds = new Set<string>();
      generatedFrameIds.forEach((frameId) => {
        if (page.nodes.some((node) => node.id === frameId)) {
          scopeIds.add(frameId);
          collectDescendantNodeIds(page.nodes, frameId).forEach((id) => scopeIds.add(id));
        }
      });
      return {
        page,
        nodes: scopeIds.size > 0 ? page.nodes.filter((node) => scopeIds.has(node.id)) : page.nodes
      };
    });
    const generatedText = scopedNodesByPage.map(({ page, nodes }) => `${page.name} ${nodes.map((node) => `${node.name} ${node.text ?? ""}`).join(" ")}`).join(" ");
    const coverage = Object.fromEntries(requiredTopics.map((topic) => [topic, generatedText.includes(topic) ? "covered" : "missing"]));
    const generatedNodes = scopedNodesByPage.flatMap(({ nodes }) => nodes);
    const entityMismatch = detectBusinessEntityMismatch(userRequest, generatedText);
    const irrelevantContent = Array.from(new Set([
      ...detectIrrelevantGeneratedBusinessContent(userRequest, generatedNodes),
      ...detectIrrelevantInteractionPatterns(userRequest, generatedNodes),
      ...entityMismatch.unexpectedEntities
    ]));
    const missing = Array.from(new Set([
      ...Object.entries(coverage).filter(([, status]) => status === "missing").map(([topic]) => topic),
      ...entityMismatch.missingEntities
    ]));
    return {
      ok: missing.length === 0 && irrelevantContent.length === 0,
      message: missing.length === 0 && irrelevantContent.length === 0
        ? "Critic Agent 审核通过：需求覆盖和无关内容检查通过。"
        : [
          `Critic Agent 发现 ${missing.length} 个缺失主题、${irrelevantContent.length} 个无关内容。`,
          missing.length > 0 ? `缺失主题：${missing.join("、")}` : "",
          irrelevantContent.length > 0 ? `无关内容：${irrelevantContent.join("、")}` : "",
          generatedFrameIds.length > 0 ? `审查范围：本次生成的 ${generatedFrameIds.length} 个画板。` : `审查范围：${pageIds.length} 个页面。`
        ].filter(Boolean).join("\n"),
      file,
      page: existingPages[0],
      selectedPageId: existingPages[0]?.id,
      data: {
        reviewScope: {
          pageIds,
          generatedFrameIds,
          scopedNodeCount: scopedNodesByPage.reduce((sum, item) => sum + item.nodes.length, 0)
        },
        requirementCoverage: coverage,
        missingTopics: missing,
        irrelevantContent,
        entityMismatch,
        decision: missing.length === 0 && irrelevantContent.length === 0 ? "passed" : "needs_fix"
      }
    };
  }

  private async listPages(projectId: string): Promise<DesignAgentToolResult> {
    const file = await this.getFile(projectId);
    return {
      ok: true,
      message: `当前共有 ${file.pages.length} 个页面。`,
      file,
      data: file.pages.map((page) => ({ id: page.id, name: page.name, nodeCount: page.nodeCount ?? page.nodes.length }))
    };
  }

  private async getPageSchema(projectId: string, pageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, pageId);
    return {
      ok: true,
      message: page ? `已获取页面「${page.name}」schema。` : "当前没有页面。",
      file,
      page,
      selectedPageId: page?.id,
      data: page
    };
  }

  private async createPage(projectId: string, input: Record<string, unknown>): Promise<DesignAgentToolResult> {
    const file = await this.getFile(projectId);
    const nodes = parseNodeInputs(input.nodes);
    const page: WorkspaceDesignPage = {
      id: createDesignId("page"),
      name: String(input.name || `页面 ${file.pages.length + 1}`),
      nodes,
      nodeCount: nodes.length,
      schemaLoaded: true
    };
    const nextFile = await this.savePages(projectId, file, [...file.pages, page]);
    return { ok: true, message: `已新建页面「${page.name}」。`, file: nextFile, page, selectedPageId: page.id };
  }

  private async renamePage(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可重命名的页面。", file };
    const name = String(input.name || "").trim();
    if (!name) return { ok: false, message: "缺少页面名称。", file, page };
    const nextPage = { ...page, name };
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return { ok: true, message: `已重命名页面为「${name}」。`, file: nextFile, page: nextPage, selectedPageId: nextPage.id };
  }

  private async deletePage(projectId: string, pageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, pageId);
    if (!page) return { ok: false, message: "当前没有可删除的页面。", file };
    if (file.pages.length <= 1) return { ok: false, message: "当前只有一个页面，不能删除最后一个页面。", file, page, selectedPageId: page.id };
    const nextPages = file.pages.filter((item) => item.id !== page.id);
    const nextFile = await this.savePages(projectId, file, nextPages);
    return { ok: true, message: `已删除页面「${page.name}」。`, file: nextFile, page: nextPages[0], selectedPageId: nextPages[0]?.id };
  }

  private async duplicatePage(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可复制的页面。", file };
    const nextPage = duplicatePageSchema(page, input.name as string | undefined);
    const nextFile = await this.savePages(projectId, file, [...file.pages, nextPage]);
    return { ok: true, message: `已复制页面「${page.name}」。`, file: nextFile, page: nextPage, selectedPageId: nextPage.id };
  }

  private async analyzePageStructure(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可分析的页面。", file };
    const structure = analyzePageSemantics(page, String(input.userRequest ?? ""));
    return {
      ok: true,
      message: `已分析页面「${page.name}」：${structure.pageType}，识别到 ${structure.mainRegions.length} 个主要区域。`,
      file,
      page,
      selectedPageId: page.id,
      data: structure
    };
  }

  private async reviewProductRequirements(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可做业务审核的页面。", file };
    const structure = analyzePageSemantics(page, String(input.userRequest ?? ""));
    const table = structure.mainRegions.find((region) => region.type === "table");
    if (!table) {
      return {
        ok: false,
        message: `产品 Agent 判断：当前页面「${page.name}」不是列表/表格页，不能臆测为订单列表页，也不应直接添加列表搜索条件。`,
        file,
        page,
        selectedPageId: page.id,
        data: {
          pageType: structure.pageType,
          businessEntity: null,
          recommendedFilters: [],
          decision: "not_applicable",
          reason: "未识别到主表格或列表区域，需要用户指定要修改的区域，或先生成/选择列表页。"
        }
      };
    }
    const entity = table?.businessEntity ?? inferBusinessEntity(page, String(input.userRequest ?? ""));
    const filters = buildRecommendedFilters(entity, table?.columns ?? []);
    return {
      ok: true,
      message: `产品 Agent 已建议 ${filters.length} 个搜索条件，适合 ${entity} 列表页。`,
      file,
      page,
      selectedPageId: page.id,
      data: {
        pageType: structure.pageType,
        businessEntity: entity,
        recommendedFilters: filters,
        actions: ["查询", "重置"],
        businessReview: `符合${entity}列表页常见检索逻辑。`
      }
    };
  }

  private async insertAbove(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可插入布局的页面。", file };
    const structure = analyzePageSemantics(page, String(input.userRequest ?? ""));
    const targetNodeId = typeof input.targetNodeId === "string" ? input.targetNodeId : structure.recommendedInsertionPoints[0]?.beforeNodeId;
    const fallbackMode = typeof input.fallbackMode === "string" ? input.fallbackMode : "";
    const target = targetNodeId
      ? page.nodes.find((node) => node.id === targetNodeId)
      : fallbackMode ? findFallbackInsertionTarget(page, fallbackMode) : undefined;
    if (!target) {
      return {
        ok: false,
        message: fallbackMode
          ? `没有找到可插入前置内容的目标节点，fallbackMode=${fallbackMode} 也未找到安全插入点。`
          : "没有找到可插入前置内容的目标节点。建议先使用 page.analyze_structure 确认主表格或内容区。",
        file,
        page,
        selectedPageId: page.id
      };
    }
    const spacing = numberOr(input.spacing, 16);
    const height = numberOr(input.height, 96);
    const filters = parseFilterInputs(input.filters, buildRecommendedFilters(structure.recommendedInsertionPoints[0]?.businessEntity ?? inferBusinessEntity(page, ""), []));
    const insertNodes = createFilterBarNodes({
      x: target.x,
      y: target.y,
      width: Math.max(target.width, 720),
      height,
      filters
    });
    const shiftY = height + spacing;
    const insertIds = new Set(insertNodes.map((node) => node.id));
    const shiftedNodes = page.nodes.map((node) => {
      if (node.y >= target.y && !insertIds.has(node.id)) {
        return { ...node, y: node.y + shiftY };
      }
      return node;
    });
    const nextPage = {
      ...page,
      nodes: [...shiftedNodes, ...insertNodes],
      nodeCount: shiftedNodes.length + insertNodes.length,
      schemaLoaded: true
    };
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return {
      ok: true,
      message: `已在「${target.name}」上方新增搜索条件区域，并将下方内容下移 ${shiftY}px。`,
      file: nextFile,
      page: nextPage,
      selectedPageId: nextPage.id,
      data: {
        insertedNodeIds: insertNodes.map((node) => node.id),
        targetNodeId: target.id,
        shiftedBy: shiftY,
        filters
      }
    };
  }

  private async planInsert(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可规划插入的页面。", file };
    const userRequest = String(input.userRequest ?? "");
    const structure = analyzePageSemantics(page, userRequest);
    const insertionPoint = structure.recommendedInsertionPoints[0];
    const target = insertionPoint?.beforeNodeId ? page.nodes.find((node) => node.id === insertionPoint.beforeNodeId) : undefined;
    const filters = buildRecommendedFilters(insertionPoint?.businessEntity ?? inferBusinessEntity(page, userRequest), target ? parseTableColumnsFromNode(target) : []);
    return {
      ok: Boolean(insertionPoint),
      message: insertionPoint
        ? `已规划插入点：在「${target?.name ?? insertionPoint.beforeNodeId}」上方新增${input.insertKind ?? "内容"}。`
        : "没有找到可靠插入点，建议先创建或定位主内容区。",
      file,
      page,
      selectedPageId: page.id,
      data: {
        pageType: structure.pageType,
        insertionPoint,
        targetNode: target ? summarizeNode(target) : undefined,
        layoutStrategy: insertionPoint ? {
          tool: "layout.insert_above",
          input: {
            targetNodeId: insertionPoint.beforeNodeId,
            insertKind: input.insertKind ?? "filter_bar",
            spacing: 16,
            height: 96,
            filters
          }
        } : undefined,
        fallbackStrategy: insertionPoint ? {
          tool: "schema.insert_before",
          input: {
            targetNodeId: insertionPoint.beforeNodeId,
            spacing: 16,
            autoLayout: true
          }
        } : undefined
      }
    };
  }

  private async reflowLayout(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可重排的页面。", file };
    const spacing = numberOr(input.spacing, 16);
    const scope = resolveIntentPatchScope(page, input);
    const nextNodes = compileLayoutTreeToSceneGraph(
      reflowSemanticSections(page.nodes, spacing, scope?.id),
      getCapabilityProfileForPageNodes(page.nodes, String(input.userRequest ?? ""))
    );
    const movedCount = nextNodes.filter((node, index) => node.y !== page.nodes[index]?.y).length;
    const nextPage = { ...page, nodes: nextNodes, nodeCount: nextNodes.length, schemaLoaded: true };
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return {
      ok: true,
      message: movedCount > 0 ? `已完成语义布局重排，调整 ${movedCount} 个节点。` : "布局重排完成，未发现需要移动的明显重叠节点。",
      file: nextFile,
      page: nextPage,
      selectedPageId: nextPage.id,
      data: { movedCount, scope: scope ? summarizeNode(scope) : undefined }
    };
  }

  private async applyIntentPatch(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可应用 intent patch 的页面。", file };
    const operation = String(input.operation ?? "reflow");
    const spacing = numberOr(input.spacing, 16);
    const scope = resolveIntentPatchScope(page, input);
    let nextNodes = page.nodes;
    const changes: string[] = [];

    if (operation === "reflow") {
      nextNodes = reflowSemanticSections(nextNodes, spacing, scope?.id);
      changes.push(`reflow spacing=${spacing}`);
    } else if (operation === "set_gap") {
      if (!scope) return { ok: false, message: "set_gap 需要 targetNodeId 或可识别 semantic 区域。", file, page, selectedPageId: page.id };
      nextNodes = applySemanticGap(nextNodes, scope.id, spacing);
      changes.push(`set_gap ${scope.name}=${spacing}`);
    } else if (operation === "move_section") {
      if (!scope) return { ok: false, message: "move_section 需要 targetNodeId 或 semantic。", file, page, selectedPageId: page.id };
      const amount = numberOr(input.amount, spacing);
      const dy = String(input.direction ?? "down") === "up" ? -amount : amount;
      nextNodes = translateSectionWithDescendants(nextNodes, scope.id, 0, dy);
      nextNodes = reflowSemanticSections(nextNodes, spacing, findContainingFrameId(nextNodes, scope));
      changes.push(`move_section ${scope.name} ${dy}px`);
    } else if (operation === "add_table_column") {
      const label = String(input.column ?? input.label ?? input.field ?? "").trim();
      if (!label) return { ok: false, message: "add_table_column 缺少 column/label。", file, page, selectedPageId: page.id };
      const table = scope && isTableLikeNode(scope) ? scope : findPrimaryTableNode(page, input);
      if (!table) return { ok: false, message: "没有找到可追加列的表格区域。", file, page, selectedPageId: page.id };
      nextNodes = addColumnToTableRegion(nextNodes, table, label);
      nextNodes = reflowSemanticSections(nextNodes, spacing, findContainingFrameId(nextNodes, table));
      changes.push(`add_table_column ${label}`);
    } else if (operation === "add_form_field") {
      const label = String(input.field ?? input.label ?? input.column ?? "").trim();
      if (!label) return { ok: false, message: "add_form_field 缺少 field/label。", file, page, selectedPageId: page.id };
      const form = scope ?? findFormLikeNode(page, input);
      if (!form) return { ok: false, message: "没有找到可追加字段的表单/内容区。", file, page, selectedPageId: page.id };
      nextNodes = addFieldToFormRegion(nextNodes, form, label, spacing);
      nextNodes = reflowSemanticSections(nextNodes, spacing, findContainingFrameId(nextNodes, form));
      changes.push(`add_form_field ${label}`);
    } else if (operation === "fix_vertical_text") {
      nextNodes = fixVerticalTextNodes(nextNodes, spacing, scope?.id);
      changes.push("fix_vertical_text");
    } else if (operation === "expand_parent") {
      nextNodes = expandOverflowingParents(nextNodes, spacing, scope?.id);
      changes.push("expand_parent");
    } else if (operation === "convert_table_to_card_list") {
      nextNodes = convertTablesToCardLists(nextNodes, spacing, scope?.id);
      changes.push("convert_table_to_card_list");
    } else if (operation === "normalize_action_bar") {
      nextNodes = normalizeActionBars(nextNodes, spacing, scope?.id);
      changes.push("normalize_action_bar");
    } else if (operation === "remove_irrelevant_section") {
      const beforeCount = nextNodes.length;
      nextNodes = removeIrrelevantSections(nextNodes, input, String(input.userRequest ?? ""), scope?.id);
      changes.push(`remove_irrelevant_section removed=${beforeCount - nextNodes.length}`);
    } else if (operation === "change_layout") {
      nextNodes = changeLayoutByScope(nextNodes, input, spacing, scope?.id);
      changes.push(`change_layout ${String(input.layout ?? "stack")}`);
    } else if (operation === "add_required_region") {
      const regions = readPatchRegions(input);
      if (regions.length === 0) return { ok: false, message: "add_required_region 缺少 region/regions。", file, page, selectedPageId: page.id };
      const patchResult = addRequiredRegionsToPage(nextNodes, regions, spacing, scope?.id, input);
      if (patchResult.createdCount === 0) {
        if (patchResult.alreadySatisfiedCount > 0 && patchResult.skippedRegions.length === 0) {
          return {
            ok: true,
            message: `add_required_region 已检查 ${regions.join("、")}，当前画板已包含对应区域，无需重复补齐。`,
            file,
            page,
            selectedPageId: page.id,
            data: { operation, changes: [`add_required_region already_satisfied ${regions.join(",")}`], movedCount: 0, skippedRegions: [] }
          };
        }
        return {
          ok: false,
          message: `add_required_region 未能安全补齐 ${regions.join("、")}。缺少明确业务实体/页面上下文时不会再生成“文本/按钮”占位。`,
          file,
          page,
          selectedPageId: page.id,
          data: { skippedRegions: patchResult.skippedRegions }
        };
      }
      nextNodes = patchResult.nodes;
      changes.push(`add_required_region ${regions.join(",")}`);
    } else if (operation === "remove_forbidden_region") {
      const regions = readPatchRegions(input);
      if (regions.length === 0) return { ok: false, message: "remove_forbidden_region 缺少 region/regions。", file, page, selectedPageId: page.id };
      const beforeCount = nextNodes.length;
      nextNodes = removeRegionsFromPage(nextNodes, regions, spacing, scope?.id);
      changes.push(`remove_forbidden_region ${regions.join(",")} removed=${beforeCount - nextNodes.length}`);
    } else if (operation === "change_page_contract") {
      const pageMode = String(input.pageMode ?? "").trim();
      const contractNote = [
        pageMode ? `pageMode=${pageMode}` : "",
        input.businessEntity ? `businessEntity=${String(input.businessEntity)}` : "",
        input.layoutPattern ? `layoutPattern=${String(input.layoutPattern)}` : ""
      ].filter(Boolean).join("；");
      if (pageMode) {
        const forbiddenRegions = getDefaultForbiddenRegionsForPageMode(pageMode);
        const requiredRegions = getDefaultRequiredRegionsForPageMode(pageMode);
        if (forbiddenRegions.length > 0) {
          nextNodes = removeRegionsFromPage(nextNodes, forbiddenRegions, spacing, scope?.id);
        }
        if (requiredRegions.length > 0) {
          const patchResult = addRequiredRegionsToPage(nextNodes, requiredRegions, spacing, scope?.id, input);
          nextNodes = patchResult.nodes;
        }
      }
      changes.push(`change_page_contract ${contractNote || "noted"}`);
    } else {
      return { ok: false, message: `不支持的 intent patch operation：${operation}`, file, page, selectedPageId: page.id };
    }

    nextNodes = compileLayoutTreeToSceneGraph(nextNodes, getCapabilityProfileForPageNodes(page.nodes, String(input.userRequest ?? "")));
    const movedCount = nextNodes.filter((node, index) => node.x !== page.nodes[index]?.x || node.y !== page.nodes[index]?.y || node.width !== page.nodes[index]?.width || node.height !== page.nodes[index]?.height || node.text !== page.nodes[index]?.text).length;
    const nextPage = { ...page, nodes: nextNodes, nodeCount: nextNodes.length, schemaLoaded: true };
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return {
      ok: true,
      message: `已应用 Intent Patch：${changes.join("；")}。影响 ${movedCount} 个节点。`,
      file: nextFile,
      page: nextPage,
      selectedPageId: nextPage.id,
      data: { operation, changes, movedCount, scope: scope ? summarizeNode(scope) : undefined }
    };
  }

  private async updateSpacing(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可调整间距的页面。", file };
    const nodeId = typeof input.nodeId === "string" ? input.nodeId : "";
    const target = page.nodes.find((node) => node.id === nodeId);
    if (!target) return { ok: false, message: "没有找到要调整间距的节点。", file, page, selectedPageId: page.id };
    const marginBottom = numberOr(input.marginBottom, 16);
    const desiredNextY = target.y + target.height + marginBottom;
    const nextNodes = page.nodes.map((node) => {
      if (node.id === target.id || node.parentId !== target.parentId || node.y < target.y + target.height) return node;
      const delta = Math.max(0, desiredNextY - node.y);
      return delta > 0 ? { ...node, y: node.y + delta } : node;
    });
    const movedCount = nextNodes.filter((node, index) => node.y !== page.nodes[index]?.y).length;
    const nextPage = { ...page, nodes: nextNodes, nodeCount: nextNodes.length, schemaLoaded: true };
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return {
      ok: true,
      message: movedCount > 0 ? `已将「${target.name}」下方间距调整为至少 ${marginBottom}px。` : `「${target.name}」下方间距已满足 ${marginBottom}px。`,
      file: nextFile,
      page: nextPage,
      selectedPageId: nextPage.id,
      data: { nodeId: target.id, movedCount, marginBottom }
    };
  }

  private async validateSchema(projectId: string, pageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, pageId);
    if (!page) return { ok: false, message: "当前没有可校验的页面。", file };
    const issues = validateDesignPage(page);
    return {
      ok: issues.length === 0,
      message: issues.length === 0 ? `页面「${page.name}」schema 校验通过。` : `页面「${page.name}」存在 ${issues.length} 个 schema 问题。`,
      file,
      page,
      selectedPageId: page.id,
      data: { issues }
    };
  }

  private async findNodes(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可查询的页面。", file };
    const query = input.query as Record<string, unknown> | undefined;
    const matches = findNodesByQuery(page, query).slice(0, 40);
    return {
      ok: true,
      message: `已找到 ${matches.length} 个匹配节点。`,
      file,
      page,
      selectedPageId: page.id,
      data: {
        query,
        nodes: matches.map((node) => ({
          id: node.id,
          type: node.type,
          name: node.name,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          text: node.text
        }))
      }
    };
  }

  private async findNodesBySemantic(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可查询的页面。", file };
    const semantic = String(input.semantic ?? "");
    const structure = analyzePageSemantics(page, String(input.userRequest ?? ""));
    const regionMatches = structure.mainRegions.filter((region) => region.type === semantic);
    const nodes = regionMatches
      .map((region) => page.nodes.find((node) => node.id === region.nodeId))
      .filter((node): node is WorkspaceDesignNode => Boolean(node));
    const fallbackNodes = semantic === "main_content"
      ? findMainContentCandidates(page)
      : [];
    const matches = nodes.length > 0 ? nodes : fallbackNodes;
    return {
      ok: true,
      message: `按语义「${semantic || "未指定"}」找到 ${matches.length} 个候选节点。`,
      file,
      page,
      selectedPageId: page.id,
      data: {
        semantic,
        nodes: matches.map(summarizeNode),
        structure
      }
    };
  }

  private async getNodeTree(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可读取节点树的页面。", file };
    const rootNodeId = typeof input.rootNodeId === "string" ? input.rootNodeId : undefined;
    const root = rootNodeId ? page.nodes.find((node) => node.id === rootNodeId) : undefined;
    const tree = root ? buildNodeTree(page.nodes, root.id) : page.nodes.filter((node) => !node.parentId).map((node) => buildNodeTree(page.nodes, node.id));
    return {
      ok: true,
      message: root ? `已读取节点「${root.name}」的子树。` : `已读取页面「${page.name}」节点树。`,
      file,
      page,
      selectedPageId: page.id,
      data: { tree }
    };
  }

  private async createMenu(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可添加菜单的页面。", file };
    const position = input.position === "right" ? "right" : "left";
    const existing = findMenuLikeNode(page, position);
    if (existing) {
      return {
        ok: false,
        message: `页面「${page.name}」${position === "left" ? "左侧" : "右侧"}已存在疑似菜单节点「${existing.name}」，已停止，避免重复添加或误改。`,
        file,
        page,
        selectedPageId: page.id,
        data: {
          existingNodeId: existing.id,
          suggestion: "如果你要调整它，请明确说“修改现有菜单”；如果要强制新增，请说明新增位置和菜单项。"
        }
      };
    }
    const items = parseStringArray(input.items, ["首页", "项目", "需求", "原型", "设置"]).slice(0, 8);
    const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "菜单";
    const bounds = getPageBounds(page);
    const menuWidth = 220;
    const menuX = position === "right" ? bounds.x + Math.max(bounds.width, 960) - menuWidth : bounds.x;
    const menuY = bounds.y;
    const menuHeight = Math.max(bounds.height, 640);
    const menuId = createDesignId("menu");
    const nodes: WorkspaceDesignNode[] = [
      createDesignNode("container", {
        id: menuId,
        name: position === "left" ? "左侧菜单栏" : "右侧菜单栏",
        x: menuX,
        y: menuY,
        width: menuWidth,
        height: menuHeight,
        fill: "#ffffff",
        stroke: "#eaecf0",
        radius: 16
      }),
      createDesignNode("text", {
        parentId: menuId,
        name: "菜单标题",
        x: menuX + 24,
        y: menuY + 24,
        width: menuWidth - 48,
        height: 28,
        text: title,
        fontSize: 18,
        textColor: "#101828"
      }),
      ...items.map((item, index) => createDesignNode("text", {
        parentId: menuId,
        name: `菜单项 ${item}`,
        x: menuX + 24,
        y: menuY + 76 + index * 44,
        width: menuWidth - 48,
        height: 32,
        text: item,
        fontSize: 14,
        textColor: index === 0 ? "#246bfe" : "#344054"
      }))
    ];
    const nextPage = { ...page, nodes: [...page.nodes, ...nodes], nodeCount: page.nodes.length + nodes.length, schemaLoaded: true };
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return {
      ok: true,
      message: `已在页面「${page.name}」${position === "left" ? "左侧" : "右侧"}新增菜单组件，包含 ${items.length} 个菜单项。`,
      file: nextFile,
      page: nextPage,
      selectedPageId: nextPage.id,
      data: { menuId, items }
    };
  }

  private async addNodes(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可修改的页面。", file };
    const nodes = parseNodeInputs(input.nodes);
    if (isBeforePosition(input.position)) {
      return this.insertBefore(projectId, {
        pageId: input.pageId,
        targetNodeId: input.position.targetNodeId,
        nodes,
        autoLayout: input.autoLayout
      }, selectedPageId);
    }
    const nextPage = { ...page, nodes: [...page.nodes, ...autoPlaceNodes(page, nodes)], schemaLoaded: true };
    nextPage.nodeCount = nextPage.nodes.length;
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return { ok: true, message: `已向页面「${page.name}」新增 ${nodes.length} 个节点。`, file: nextFile, page: nextPage, selectedPageId: nextPage.id };
  }

  private async addChild(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可修改的页面。", file };
    const parentNodeId = typeof input.parentNodeId === "string" ? input.parentNodeId : "";
    const parent = page.nodes.find((node) => node.id === parentNodeId);
    if (!parent) return { ok: false, message: "没有找到可追加子节点的父节点。", file, page, selectedPageId: page.id };
    const nodes = parseNodeInputs(input.nodes).map((node, index) => ({
      ...node,
      parentId: parent.id,
      x: node.x || parent.x + 20 + index * 176,
      y: node.y || parent.y + Math.max(20, parent.height - node.height - 16)
    }));
    const nextPage = { ...page, nodes: [...page.nodes, ...nodes], nodeCount: page.nodes.length + nodes.length, schemaLoaded: true };
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return { ok: true, message: `已向「${parent.name}」追加 ${nodes.length} 个子节点。`, file: nextFile, page: nextPage, selectedPageId: nextPage.id };
  }

  private async insertBefore(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可插入节点的页面。", file };
    const targetNodeId = typeof input.targetNodeId === "string" ? input.targetNodeId : "";
    const target = page.nodes.find((node) => node.id === targetNodeId);
    if (!target) return { ok: false, message: "没有找到插入目标节点。", file, page, selectedPageId: page.id };
    const spacing = numberOr(input.spacing, 16);
    const nodes = parseNodeInputs(input.nodes);
    const prepared = placeNodesBeforeTarget(nodes, target, spacing);
    const insertedHeight = getNodesHeight(prepared);
    const shiftY = input.autoLayout === false ? 0 : insertedHeight + spacing;
    const nextNodes = page.nodes.map((node) => {
      if (shiftY > 0 && node.y >= target.y && node.parentId === target.parentId) {
        return { ...node, y: node.y + shiftY };
      }
      return node;
    });
    const nextPage = { ...page, nodes: [...nextNodes, ...prepared], nodeCount: nextNodes.length + prepared.length, schemaLoaded: true };
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return {
      ok: true,
      message: `已在「${target.name}」前插入 ${prepared.length} 个节点${shiftY > 0 ? `，并下移同级内容 ${shiftY}px` : ""}。`,
      file: nextFile,
      page: nextPage,
      selectedPageId: nextPage.id,
      data: { targetNodeId: target.id, insertedNodeIds: prepared.map((node) => node.id), shiftedBy: shiftY }
    };
  }

  private async updateNode(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可修改的页面。", file };
    const target = findNode(page, input.nodeId as string | undefined, input.match as Record<string, unknown> | undefined);
    if (!target) return { ok: false, message: "没有找到可修改的节点。", file, page, selectedPageId: page.id };
    const patch = designNodePatchSchema.parse(input.patch ?? {});
    const nextPage = {
      ...page,
      nodes: page.nodes.map((node) => node.id === target.id ? normalizePatchedNode({ ...node, ...patch }) : node),
      schemaLoaded: true
    };
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return { ok: true, message: `已修改节点「${target.name}」。`, file: nextFile, page: nextPage, selectedPageId: nextPage.id };
  }

  private async deleteNode(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可修改的页面。", file };
    const target = findNode(page, input.nodeId as string | undefined, input.match as Record<string, unknown> | undefined);
    if (!target) return { ok: false, message: "没有找到可删除的节点。", file, page, selectedPageId: page.id };
    const removeIds = new Set([target.id, ...collectDescendantNodeIds(page.nodes, target.id)]);
    const nextPage = { ...page, nodes: page.nodes.filter((node) => !removeIds.has(node.id)), schemaLoaded: true };
    nextPage.nodeCount = nextPage.nodes.length;
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return { ok: true, message: `已删除节点「${target.name}」。`, file: nextFile, page: nextPage, selectedPageId: nextPage.id };
  }

  private async duplicateNode(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可修改的页面。", file };
    const target = findNode(page, input.nodeId as string | undefined, input.match as Record<string, unknown> | undefined);
    if (!target) return { ok: false, message: "没有找到可复制的节点。", file, page, selectedPageId: page.id };
    const descendants = page.nodes.filter((node) => node.id === target.id || collectDescendantNodeIds(page.nodes, target.id).includes(node.id));
    const copies = duplicateNodes(descendants);
    const nextPage = { ...page, nodes: [...page.nodes, ...copies], schemaLoaded: true };
    nextPage.nodeCount = nextPage.nodes.length;
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return { ok: true, message: `已复制节点「${target.name}」。`, file: nextFile, page: nextPage, selectedPageId: nextPage.id };
  }

  private async generateSchemaFromPrompt(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const prompt = String(input.prompt || "");
    const nodes = createPromptNodes(prompt);
    return this.addNodes(projectId, { pageId: input.pageId, nodes }, selectedPageId);
  }

  private async listComponentLibraries(projectId: string): Promise<DesignAgentToolResult> {
    const file = await this.getFile(projectId);
    const componentLibraries = await this.repository.listDesignComponentLibraries(projectId).catch(() => []);
    const components = await this.repository.listDesignComponents(projectId).catch(() => []);
    return {
      ok: true,
      message: componentLibraries.length > 0
        ? `已读取 ${componentLibraries.length} 个本地组件库、${components.length} 个组件。`
        : "当前项目还没有本地组件库。",
      file,
      data: summarizeComponentLibrariesForAgent(componentLibraries, components)
    };
  }

  private async createComponentLibrary(projectId: string, input: Record<string, unknown>): Promise<DesignAgentToolResult> {
    const file = await this.getFile(projectId);
    const name = String(input.name ?? "").trim();
    if (!name) {
      return { ok: false, message: "缺少组件库名称。", file };
    }
    const existing = await this.repository.listDesignComponentLibraries(projectId).catch(() => []);
    const duplicate = existing.find((library) => library.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      return {
        ok: true,
        message: `组件库「${duplicate.name}」已存在，后续可直接复用。`,
        file,
        data: { library: duplicate, created: false }
      };
    }
    const now = nowIso();
    const library: WorkspaceDesignComponentLibrary = {
      id: createDesignId("component-library"),
      name,
      description: String(input.description ?? "").trim() || undefined,
      createdAt: now,
      updatedAt: now
    };
    await this.repository.upsertDesignComponentLibrary(projectId, library);
    return {
      ok: true,
      message: `已创建本地组件库「${library.name}」。`,
      file: await this.getFile(projectId),
      data: { library, created: true }
    };
  }

  private async listPageTemplates(projectId: string, input: Record<string, unknown> = {}): Promise<DesignAgentToolResult> {
    const file = await this.getFile(projectId);
    const templates = summarizePageTemplatesForTool(file);
    const userRequest = String(input.userRequest ?? "");
    const platform = input.platform === "mobile_app" || /小程序|移动端|手机|app/i.test(userRequest) ? "mobile_app" : "web";
    const contract = userRequest ? matchPageTemplateContract(file, userRequest, platform) : undefined;
    return {
      ok: true,
      message: templates.length > 0
        ? contract
          ? `已读取 ${templates.length} 个页面模板，Template Matcher 命中「${contract.templateName}」，会作为 StyleProfile 和结构契约。`
          : `已读取 ${templates.length} 个页面模板，可作为 StyleProfile 和整页结构参考。`
        : "当前项目还没有页面模板。可以在画布中右击整页画板创建模板。",
      file,
      data: {
        templates,
        matchedTemplateContract: contract ?? null
      }
    };
  }

  private async searchComponents(projectId: string, input: Record<string, unknown>): Promise<DesignAgentToolResult> {
    const file = await this.getFile(projectId);
    const componentLibraries = await this.repository.listDesignComponentLibraries(projectId).catch(() => []);
    const components = await this.repository.listDesignComponents(projectId).catch(() => []);
    const matches = findLocalComponents(componentLibraries, components, input);
    const limit = Math.max(1, Math.min(50, Math.floor(numberOr(input.limit, 12))));
    return {
      ok: true,
      message: `已找到 ${matches.length} 个本地组件候选。`,
      file,
      data: {
        query: {
          libraryId: input.libraryId,
          libraryName: input.libraryName,
          componentName: input.componentName,
          query: input.query
        },
        components: matches.slice(0, limit).map(({ component, library, score }) => summarizeComponentForAgent(component, library, score))
      }
    };
  }

  private async createComponentFromNodes(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可创建组件的页面。", file };

    const componentName = String(input.componentName ?? input.name ?? "").trim();
    if (!componentName) {
      return { ok: false, message: "缺少组件名称 componentName。", file, page, selectedPageId: page.id };
    }

    const libraries = await this.repository.listDesignComponentLibraries(projectId).catch(() => []);
    const library = await this.resolveOrCreateComponentLibrary(projectId, libraries, input);
    const sourceNodes = selectComponentSourceNodes(page, input);
    if (sourceNodes.length === 0) {
      return {
        ok: false,
        message: "没有找到可保存为组件的节点。请传 nodeIds，或传 match 指定 type/name/text/position。",
        file,
        page,
        selectedPageId: page.id
      };
    }

    const componentNodes = createComponentTemplateNodes(sourceNodes);
    const component: WorkspaceDesignComponent = {
      id: createDesignId("component"),
      name: componentName,
      libraryId: library.id,
      description: String(input.componentDescription ?? input.description ?? "").trim() || inferComponentDescription(componentName, componentNodes),
      sourceFileName: "本地组件集合",
      nodeCount: componentNodes.length,
      nodes: componentNodes
    };
    await this.repository.upsertDesignComponent(projectId, component);
    return {
      ok: true,
      message: `已把 ${sourceNodes.length} 个节点保存为组件「${component.name}」，归入组件库「${library.name}」。`,
      file: await this.getFile(projectId),
      page,
      selectedPageId: page.id,
      data: {
        library: { id: library.id, name: library.name },
        component: summarizeComponentForAgent(component, library),
        sourceNodeIds: sourceNodes.map((node) => node.id)
      }
    };
  }

  private async insertComponent(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可插入组件的页面。", file };
    const componentLibraries = await this.repository.listDesignComponentLibraries(projectId).catch(() => []);
    const components = await this.repository.listDesignComponents(projectId).catch(() => []);
    const selected = findLocalComponents(componentLibraries, components, input)[0];
    if (!selected) {
      return {
        ok: false,
        message: "没有找到匹配的本地组件。建议先使用 component_library.list 或 component.search 确认组件名称。",
        file,
        page,
        selectedPageId: page.id,
        data: {
          availableLibraries: summarizeComponentLibrariesForAgent(componentLibraries, components).map((library) => ({
            id: library.id,
            name: library.name,
            componentCount: library.componentCount
          }))
        }
      };
    }
    if (selected.component.nodes.length === 0) {
      return {
        ok: false,
        message: `组件「${selected.component.name}」没有可插入的节点。`,
        file,
        page,
        selectedPageId: page.id
      };
    }
    const target = getComponentInsertTarget(page, input);
    const insertedNodes = instantiateComponentNodes(selected.component, target.x, target.y);
    const nextPage = {
      ...page,
      nodes: [...page.nodes, ...insertedNodes],
      nodeCount: page.nodes.length + insertedNodes.length,
      schemaLoaded: true
    };
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return {
      ok: true,
      message: `已把组件「${selected.component.name}」插入到页面「${page.name}」。`,
      file: nextFile,
      page: nextPage,
      selectedPageId: nextPage.id,
      data: {
        library: selected.library ? { id: selected.library.id, name: selected.library.name } : undefined,
        component: summarizeComponentForAgent(selected.component, selected.library, selected.score),
        insertedNodeIds: insertedNodes.map((node) => node.id),
        x: target.x,
        y: target.y
      }
    };
  }

  private async resolveOrCreateComponentLibrary(
    projectId: string,
    libraries: WorkspaceDesignComponentLibrary[],
    input: Record<string, unknown>
  ) {
    const libraryId = String(input.libraryId ?? "").trim();
    const libraryName = String(input.libraryName ?? "").trim();
    const existingById = libraryId ? libraries.find((library) => library.id === libraryId) : undefined;
    if (existingById) return existingById;
    const existingByName = libraryName
      ? libraries.find((library) => library.name.trim().toLowerCase() === libraryName.toLowerCase())
      : undefined;
    if (existingByName) return existingByName;
    const fallback = libraries[0];
    if (!libraryName && fallback) return fallback;
    const now = nowIso();
    const library: WorkspaceDesignComponentLibrary = {
      id: createDesignId("component-library"),
      name: libraryName || "Agent 组件库",
      description: String(input.libraryDescription ?? "").trim() || "Agent 从高质量 UI 稿中沉淀的本地组件库。",
      createdAt: now,
      updatedAt: now
    };
    await this.repository.upsertDesignComponentLibrary(projectId, library);
    return library;
  }

  private async readWorkspaceFile(projectId: string, filePath?: string): Promise<DesignAgentToolResult> {
    if (!filePath) return { ok: false, message: "缺少文件路径。" };
    const projectRoot = resolve(process.cwd(), "workspace", "projects", projectId);
    const target = resolve(projectRoot, filePath);
    if (relative(projectRoot, target).startsWith("..")) {
      return { ok: false, message: "拒绝读取 workspace 项目空间外的文件。" };
    }
    const content = await readFile(target, "utf8");
    return { ok: true, message: `已读取文件 ${filePath}。`, data: { path: filePath, content: content.slice(0, 20000), truncated: content.length > 20000 } };
  }

  private async captureCanvas(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可截图的页面。", file };
    const nodeIds = Array.isArray(input.nodeIds) ? input.nodeIds.map(String) : [];
    const mode = String(input.mode ?? "");
    const limit = Math.max(1, Math.min(12, numberOr(input.limit, 6)));
    const explicitNodes = [
      ...nodeIds.map((nodeId) => page.nodes.find((item) => item.id === nodeId)).filter((node): node is WorkspaceDesignNode => Boolean(node)),
      input.nodeId ? page.nodes.find((item) => item.id === input.nodeId) : undefined
    ].filter((node): node is WorkspaceDesignNode => Boolean(node));
    const captureTargets = explicitNodes.length > 0
      ? explicitNodes
      : mode === "rightmost_artboards"
        ? getTopLevelArtboards(page).sort((a, b) => b.x - a.x).slice(0, limit).reverse()
        : getTopLevelArtboards(page).slice(0, limit);
    const previews = captureTargets.map((target) => ({
      nodeId: target.id,
      label: target.name,
      width: target.width,
      height: target.height,
      dataUrl: buildNodePreviewSvgDataUrl(page, target)
    }));
    return {
      ok: true,
      message: previews.length > 0
        ? `已生成 ${previews.length} 张画板预览，请在聊天框中逐页确认。`
        : "当前画布没有可预览的顶层画板。",
      file,
      page,
      selectedPageId: page.id,
      data: { page: summarizePage(page), previews }
    };
  }

  private async analyzeUi(projectId: string, pageId: string | undefined, kind: "layout" | "spacing" | "color" | "typography" | "review"): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, pageId);
    if (!page) return { ok: false, message: "当前没有可分析的页面。", file };
    const analysis = buildUiAnalysis(page, kind);
    return {
      ok: true,
      message: analysis.summary,
      file,
      page,
      selectedPageId: page.id,
      data: analysis
    };
  }

  private async reviewDesign(projectId: string, input: Record<string, unknown>, selectedPageId?: string): Promise<DesignAgentToolResult> {
    const { file, page } = await this.getFileAndPage(projectId, input.pageId as string | undefined ?? selectedPageId);
    if (!page) return { ok: false, message: "当前没有可做 UI 审核的页面。", file };
    const request = String(input.userRequest ?? "");
    const generatedFrameIds = Array.isArray(input.generatedFrameIds) ? input.generatedFrameIds.map(String).filter(Boolean) : [];
    const structure = analyzePageSemantics(page, request);
    const capabilityProfile = getDesignCapabilityProfile(/小程序|微信/.test(request) ? "wechat_mini_program" : /移动端|手机|app/i.test(request) ? "mobile_app" : "pc_web", request);
    const issues: DesignReviewIssue[] = [];
    const hasSearchIntent = /(列表|表格|table|list).*(搜索|筛选|查询|filter|search|query)|(搜索|筛选|查询|filter|search|query).*(列表|表格|table|list)/i.test(request);
    const filterRegion = structure.mainRegions.find((region) => region.type === "filter_bar");
    const tableRegion = structure.mainRegions.find((region) => region.type === "table");
    if (hasSearchIntent && !filterRegion) {
      issues.push({
        code: "missing_region",
        level: "blocking",
        message: "用户要求添加搜索条件，但页面没有识别到搜索/筛选区域。",
        region: "FilterBar",
        suggestedFix: { tool: "layout.insert_above", input: { insertKind: "filter_bar" } }
      });
    }
    if (filterRegion && tableRegion && filterRegion.bbox.y >= tableRegion.bbox.y) {
      issues.push({
        code: "wrong_page_mode",
        level: "blocking",
        message: "搜索区没有位于表格上方。",
        region: "FilterBar",
        suggestedFix: { tool: "layout.insert_above", input: { targetNodeId: tableRegion.nodeId, insertKind: "filter_bar" } }
      });
    }
    const scopedNodes = scopeNodesForReview(page.nodes, generatedFrameIds);
    const overlaps = detectMeaningfulOverlaps(scopedNodes);
    if (overlaps.length > 0) {
      issues.push({
        code: "overlap",
        level: "blocking",
        message: `检测到 ${overlaps.length} 处文字或交互控件可能互相遮挡。容器/卡片/背景与内部内容的正常层叠不会计入。`,
        targetNodeIds: overlaps.flat(),
        suggestedFix: { tool: "layout.reflow", input: { spacing: 16 } }
      });
    }
    const frameIssues = reviewArtboardLayout(page, request, generatedFrameIds, capabilityProfile);
    issues.push(...frameIssues);
    const blockingCount = issues.filter((issue) => issue.level === "blocking").length;
    return {
      ok: blockingCount === 0,
      message: blockingCount === 0
        ? `UI Agent 审核通过：已检查 ${generatedFrameIds.length || getTopLevelArtboards(page).length} 个画板，没有发现阻塞问题。`
        : `UI Agent 审核发现 ${blockingCount} 个阻塞问题。`,
      file,
      page,
      selectedPageId: page.id,
      data: {
        passed: blockingCount === 0,
	        issues,
	        issueSummary: summarizeDesignReviewIssues(issues),
        structure,
        reviewScope: {
          generatedFrameIds,
          scopedNodeCount: scopedNodes.length
        },
        designReferences: getDesignReferenceContext(request, /小程序|移动端|手机|app/i.test(request) ? "mobile_app" : "pc_web"),
        designRules: getDesignReviewRules(),
        capabilityProfile
      }
    };
  }

  private async getRecentMessages(projectId: string, conversationId?: string, limit?: number): Promise<DesignAgentToolResult> {
    if (!conversationId) return { ok: false, message: "缺少 conversationId，无法查询最近会话。" };
    const messages = await this.repository.listAgentMessages({ projectId, conversationId, limit: limit ?? 20 });
    return {
      ok: true,
      message: `已读取最近 ${messages.length} 条会话记录。`,
      data: { messages }
    };
  }

  private async searchMessages(projectId: string, input: { conversationId?: string; keyword?: string; limit?: number }): Promise<DesignAgentToolResult> {
    if (!input.keyword?.trim()) return { ok: false, message: "缺少搜索关键词。" };
    const messages = await this.repository.searchAgentMessages({
      projectId,
      conversationId: input.conversationId,
      keyword: input.keyword.trim(),
      limit: input.limit ?? 10
    });
    return {
      ok: true,
      message: `已搜索到 ${messages.length} 条相关会话记录。`,
      data: { messages }
    };
  }

  private async getToolHistory(projectId: string, conversationId?: string, toolName?: string, limit?: number): Promise<DesignAgentToolResult> {
    if (!conversationId) return { ok: false, message: "缺少 conversationId，无法查询工具历史。" };
    const toolCalls = await this.repository.listAgentToolCalls({ projectId, conversationId, toolName, limit: limit ?? 20 });
    return {
      ok: true,
      message: `已读取 ${toolCalls.length} 条工具调用历史。`,
      data: { toolCalls }
    };
  }

  private async getLastFailedStep(projectId: string, conversationId?: string): Promise<DesignAgentToolResult> {
    if (!conversationId) return { ok: false, message: "缺少 conversationId，无法查询失败步骤。" };
    const toolCalls = await this.repository.listAgentToolCalls({ projectId, conversationId, limit: 50 });
    const failed = toolCalls.find((call) => call.status === "failed");
    return {
      ok: true,
      message: failed ? `最近失败工具是 ${failed.toolName}。` : "当前会话没有失败工具调用。",
      data: { failed }
    };
  }

  private async getFile(projectId: string) {
    return this.repository.getDesignFile(projectId);
  }

  private async getFileAndPage(projectId: string, pageId?: string) {
    const file = await this.getFile(projectId);
    const pageMeta = pageId
      ? file.pages.find((page) => page.id === pageId)
      : file.pages[0];
    const page = pageMeta ? await this.repository.getDesignPage(projectId, pageMeta.id).catch(() => pageMeta) : undefined;
    return { file, page };
  }

  private async savePages(projectId: string, file: WorkspaceDesignFile, pages: WorkspaceDesignPage[]) {
    const nextFile = { ...file, pages, updatedAt: nowIso() };
    await this.repository.saveDesignFile(projectId, nextFile);
    return this.repository.getDesignFile(projectId);
  }
}

function summarizeComponentLibrariesForAgent(componentLibraries: WorkspaceDesignComponentLibrary[], components: WorkspaceDesignComponent[]) {
  return componentLibraries.map((library) => {
    const libraryComponents = components.filter((component) => component.libraryId === library.id);
    return {
      id: library.id,
      name: library.name,
      description: library.description ?? "",
      componentCount: libraryComponents.length,
      components: libraryComponents.slice(0, 30).map((component) => summarizeComponentForAgent(component, library))
    };
  });
}

function summarizePageTemplatesForTool(file: WorkspaceDesignFile) {
  return (file.pageTemplates ?? []).slice(0, 12).map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    sourcePageId: template.sourcePageId,
    sourceFrameId: template.sourceFrameId,
    nodeCount: template.nodeCount,
    size: { width: Math.round(template.width), height: Math.round(template.height) },
    platform: template.styleProfile.platform,
    styleProfile: template.styleProfile,
    structureSummary: {
      nodeTypeStats: template.nodes.reduce<Record<string, number>>((result, node) => {
        result[node.type] = (result[node.type] ?? 0) + 1;
        return result;
      }, {}),
      semanticRegions: Array.from(new Set(template.nodes.flatMap((node) => {
        const label = `${node.type} ${node.name} ${node.text ?? ""}`;
        return [
          /nav|header|顶部|导航|标题栏/i.test(label) ? "Header/NavBar" : "",
          /summary|metric|统计|指标|摘要|状态/i.test(label) ? "Summary/Metric" : "",
          /filter|search|query|筛选|搜索|查询/i.test(label) ? "FilterBar" : "",
          /form|field|input|表单|字段|输入|上传/i.test(label) || node.type === "input" ? "Form" : "",
          /detail|description|详情|信息|资料|明细/i.test(label) ? "DescriptionList" : "",
          /table|列表|表格|数据/i.test(label) || node.type === "table" ? "Table/List" : "",
          /action|button|操作|按钮|保存|提交|确认|取消|返回/i.test(label) || node.type === "button" ? "ActionBar/Button" : ""
        ].filter(Boolean);
      }))).slice(0, 16),
      keySections: template.nodes
        .filter((node) => !node.parentId || node.type === "frame" || node.type === "container" || node.type === "card" || node.type === "table")
        .sort((first, second) => first.y - second.y || first.x - second.x)
        .slice(0, 12)
        .map((node) => ({ type: node.type, name: node.name, text: node.text ?? "", width: Math.round(node.width), height: Math.round(node.height) }))
    },
    keyTexts: template.nodes
      .map((node) => node.text || node.name)
      .filter(Boolean)
      .filter((text, index, array) => array.indexOf(text) === index)
      .slice(0, 24)
  }));
}

function summarizeComponentForAgent(component: WorkspaceDesignComponent, library?: WorkspaceDesignComponentLibrary, score?: number) {
  const bounds = getNodesBounds(component.nodes);
  return {
    id: component.id,
    name: component.name,
    libraryId: component.libraryId,
    libraryName: library?.name ?? "",
    description: component.description ?? "",
    nodeCount: component.nodeCount,
    nodeTypes: Array.from(new Set(component.nodes.map((node) => node.type))).slice(0, 12),
    size: { width: Math.round(bounds.width), height: Math.round(bounds.height) },
    layoutHints: inferComponentLayoutHints(component.nodes),
    aliases: inferComponentAliases(component),
    keyTexts: extractComponentKeyTexts(component),
    score
  };
}

function inferComponentLayoutHints(nodes: WorkspaceDesignNode[]) {
  const bounds = getNodesBounds(nodes);
  const hasTable = nodes.some((node) => node.type === "table");
  const hasInputs = nodes.some((node) => node.type === "input");
  const hasButtons = nodes.some((node) => node.type === "button");
  const text = nodes.map((node) => `${node.name} ${node.text ?? ""}`).join(" ");
  return {
    kind: hasTable ? "table-section" : hasInputs && hasButtons ? "query-or-form-section" : /标题|页头|header/i.test(text) ? "page-header" : "generic-component",
    recommendedUse: hasTable
      ? "列表/数据管理页面的主表格区域"
      : hasInputs && hasButtons
        ? "列表页查询区或表单录入区"
        : bounds.width > bounds.height * 3
          ? "横向工具栏/页头区域"
          : "可复用 UI 区块",
    aspectRatio: Number((bounds.width / Math.max(1, bounds.height)).toFixed(2))
  };
}

function inferComponentAliases(component: WorkspaceDesignComponent) {
  const aliases = new Set<string>();
  const text = [
    component.name,
    component.description ?? "",
    ...component.nodes.flatMap((node) => [node.type, node.name, node.text ?? ""])
  ].join(" ").toLowerCase();
  component.nodes.forEach((node) => {
    if (node.type === "table") ["表格", "数据表", "列表", "table"].forEach((item) => aliases.add(item));
    if (node.type === "input") ["输入框", "输入", "搜索框", "查询条件", "input"].forEach((item) => aliases.add(item));
    if (node.type === "button") ["按钮", "操作", "主按钮", "button"].forEach((item) => aliases.add(item));
    if (/状态|tag|标签|上架|下架|启用|停用|成功|失败|审核/.test(`${node.name} ${node.text ?? ""}`)) {
      ["状态", "标签", "状态标签", "tag", "status"].forEach((item) => aliases.add(item));
    }
  });
  if (/查询|搜索|筛选|filter|search/.test(text)) ["查询区", "搜索区", "筛选区", "SearchForm"].forEach((item) => aliases.add(item));
  if (/工具栏|操作栏|toolbar|批量|导出|新增/.test(text)) ["工具栏", "操作栏", "Toolbar"].forEach((item) => aliases.add(item));
  if (/分页|上一页|下一页|pagination/.test(text)) ["分页", "Pagination"].forEach((item) => aliases.add(item));
  return Array.from(aliases).slice(0, 20);
}

function findLocalComponents(
  componentLibraries: WorkspaceDesignComponentLibrary[],
  components: WorkspaceDesignComponent[],
  input: Record<string, unknown>
) {
  type ComponentMatch = { component: WorkspaceDesignComponent; library?: WorkspaceDesignComponentLibrary; score: number };
  const libraryId = typeof input.libraryId === "string" ? input.libraryId.trim() : "";
  const libraryName = typeof input.libraryName === "string" ? input.libraryName.trim().toLowerCase() : "";
  const componentId = typeof input.componentId === "string" ? input.componentId.trim() : "";
  const componentName = typeof input.componentName === "string" ? input.componentName.trim().toLowerCase() : "";
  const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
  const librariesById = new Map(componentLibraries.map((library) => [library.id, library]));
  const matches: ComponentMatch[] = [];
  components.forEach((component) => {
    const library = component.libraryId ? librariesById.get(component.libraryId) : undefined;
    if (componentId && component.id !== componentId) return;
    if (libraryId && component.libraryId !== libraryId) return;
    if (libraryName && !`${library?.name ?? ""} ${library?.description ?? ""}`.toLowerCase().includes(libraryName)) return;
    const searchable = [
      component.name,
      component.description ?? "",
      component.sourceFileName,
      library?.name ?? "",
      library?.description ?? "",
      extractComponentKeyTexts(component).join(" "),
      inferComponentAliases(component).join(" "),
      Array.from(new Set(component.nodes.map((node) => node.type))).join(" ")
    ].join(" ").toLowerCase();
    let score = 0;
    if (componentName) {
      if (component.name.toLowerCase() === componentName) score += 100;
      if (component.name.toLowerCase().includes(componentName)) score += 60;
    }
    if (query) {
      if (searchable.includes(query)) score += 36;
      splitComponentSearchQuery(query).forEach((token) => {
        if (searchable.includes(token)) score += 12;
      });
    }
    if (!componentName && !query && !libraryId && !libraryName && !componentId) score = 1;
    if (score > 0 || componentId) matches.push({ component, library, score });
  });
  return matches.sort((a, b) => b.score - a.score || a.component.name.localeCompare(b.component.name, "zh-CN"));
}

function splitComponentSearchQuery(query: string) {
  const normalized = query.trim().toLowerCase();
  const tokens = new Set(normalized.split(/[\s,，、;；/|]+/).filter(Boolean));
  const phraseWords = normalized.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9_-]{2,}/gi) ?? [];
  phraseWords.forEach((word) => {
    tokens.add(word.toLowerCase());
    if (/[\u4e00-\u9fa5]/.test(word) && word.length > 4) {
      for (let index = 0; index <= word.length - 2; index += 1) {
        tokens.add(word.slice(index, index + 2).toLowerCase());
      }
    }
  });
  Array.from(tokens).forEach((token) => expandComponentSearchToken(token).forEach((item) => tokens.add(item)));
  return Array.from(tokens).slice(0, 40);
}

function expandComponentSearchToken(token: string) {
  const expansions: string[] = [];
  if (/表格|数据表|列表/.test(token)) expansions.push("table", "表格", "数据表");
  if (/状态|标签|tag|status/.test(token)) expansions.push("状态", "标签", "tag", "status");
  if (/输入|搜索框|查询条件|筛选条件/.test(token)) expansions.push("input", "输入框", "查询", "搜索");
  if (/按钮|操作|button/.test(token)) expansions.push("button", "按钮", "操作");
  if (/查询|搜索|筛选|filter|search/.test(token)) expansions.push("SearchForm", "查询区", "搜索区", "input", "button");
  if (/分页|pagination/.test(token)) expansions.push("Pagination", "分页");
  return expansions;
}

function extractComponentKeyTexts(component: WorkspaceDesignComponent) {
  return component.nodes
    .map((node) => node.text?.trim())
    .filter((text): text is string => Boolean(text))
    .filter((text, index, array) => array.indexOf(text) === index)
    .slice(0, 20);
}

function selectComponentSourceNodes(page: WorkspaceDesignPage, input: Record<string, unknown>) {
  const nodeIds = Array.isArray(input.nodeIds) ? input.nodeIds.map(String).filter(Boolean) : [];
  const includeDescendants = input.includeDescendants !== false;
  const selectedIds = new Set<string>();
  nodeIds.forEach((id) => {
    if (!page.nodes.some((node) => node.id === id)) return;
    selectedIds.add(id);
    if (includeDescendants) {
      collectDescendantNodeIds(page.nodes, id).forEach((descendantId) => selectedIds.add(descendantId));
    }
  });
  if (selectedIds.size === 0 && isRecord(input.match)) {
    findNodesByQuery(page, input.match)
      .filter((node) => node.visible !== false && !node.locked)
      .forEach((node) => {
        selectedIds.add(node.id);
        if (includeDescendants) {
          collectDescendantNodeIds(page.nodes, node.id).forEach((descendantId) => selectedIds.add(descendantId));
        }
      });
  }
  if (selectedIds.size === 0 && typeof input.nodeId === "string") {
    selectedIds.add(input.nodeId);
    if (includeDescendants) {
      collectDescendantNodeIds(page.nodes, input.nodeId).forEach((descendantId) => selectedIds.add(descendantId));
    }
  }
  return page.nodes.filter((node) => selectedIds.has(node.id) && node.visible !== false);
}

function createComponentTemplateNodes(sourceNodes: WorkspaceDesignNode[]) {
  if (sourceNodes.length === 0) return [];
  const bounds = getNodesBounds(sourceNodes);
  const idMap = new Map(sourceNodes.map((node) => [node.id, createDesignId("node")]));
  return sourceNodes.map((node, index) => normalizePatchedNode({
    ...translateDesignNode(node, -bounds.x, -bounds.y),
    id: idMap.get(node.id) ?? createDesignId("node"),
    parentId: node.parentId && idMap.has(node.parentId) ? idMap.get(node.parentId) : undefined,
    zIndex: index,
    locked: false,
    visible: node.visible !== false
  }));
}

function inferComponentDescription(componentName: string, nodes: WorkspaceDesignNode[]) {
  const nodeTypes = Array.from(new Set(nodes.map((node) => node.type))).join("、");
  const keyTexts = nodes.map((node) => node.text || node.name).filter(Boolean).slice(0, 8).join("、");
  return [`由 Agent 沉淀的「${componentName}」组件模板。`, nodeTypes ? `节点类型：${nodeTypes}。` : "", keyTexts ? `关键文本：${keyTexts}。` : ""].filter(Boolean).join("");
}

function getComponentInsertTarget(page: WorkspaceDesignPage, input: Record<string, unknown>) {
  const bounds = getPageBounds(page);
  return {
    x: numberOr(input.x, bounds.x + 48),
    y: numberOr(input.y, bounds.y + 48)
  };
}

function instantiateComponentNodes(component: WorkspaceDesignComponent, targetX: number, targetY: number) {
  const bounds = getNodesBounds(component.nodes);
  const idMap = new Map(component.nodes.map((node) => [node.id, createDesignId("node")]));
  return component.nodes.map((node, index) => {
    const dx = Math.round(targetX - bounds.x);
    const dy = Math.round(targetY - bounds.y);
    return normalizePatchedNode({
    ...translateDesignNode(node, dx, dy),
    id: idMap.get(node.id) ?? createDesignId("node"),
    parentId: node.parentId ? idMap.get(node.parentId) : undefined,
    name: index === 0 ? component.name : node.name,
    locked: false,
    visible: node.visible !== false
    });
  });
}

function detectIrrelevantGeneratedBusinessContent(userRequest: string, nodes: WorkspaceDesignNode[]) {
  const primaryUserRequest = getPrimaryUserRequestText(userRequest);
  const request = primaryUserRequest.toLowerCase();
  const generatedText = nodes.map((node) => `${node.name} ${node.text ?? ""}`).join(" ");
  const entityMismatch = detectBusinessEntityMismatch(primaryUserRequest, generatedText);
  return Array.from(new Set([
    ...getGeneratedBusinessContentRules(primaryUserRequest)
    .filter((rule) => !rule.allowed && rule.pattern.test(generatedText) && !request.includes(rule.label.toLowerCase()))
      .map((rule) => rule.label),
    ...entityMismatch.unexpectedEntities
  ]));
}

function detectBusinessEntityMismatch(userRequest: string, generatedText: string) {
  const primaryUserRequest = getPrimaryUserRequestText(userRequest);
  const requestedEntities = inferBusinessEntitiesFromText(primaryUserRequest);
  if (requestedEntities.length === 0) {
    return { requestedEntities, generatedEntities: inferBusinessEntitiesFromText(generatedText), identityEntities: inferBusinessIdentityEntitiesFromText(generatedText), missingEntities: [] as string[], unexpectedEntities: [] as string[] };
  }
  const generatedEntities = inferBusinessEntitiesFromText(generatedText);
  const identityEntities = inferBusinessIdentityEntitiesFromText(generatedText);
  const missingEntities = requestedEntities.filter((entity) => !generatedEntities.includes(entity));
  const unexpectedEntities = identityEntities.filter((entity) => !requestedEntities.includes(entity));
  return { requestedEntities, generatedEntities, identityEntities, missingEntities, unexpectedEntities };
}

function detectIrrelevantInteractionPatterns(userRequest: string, nodes: WorkspaceDesignNode[]) {
  const request = userRequest.toLowerCase();
  const generatedText = nodes.map((node) => `${node.name} ${node.text ?? ""}`).join(" ");
  const wantsDetail = /详情|查看|资料|detail|inspect/i.test(userRequest);
  const wantsCollection = /列表|表格|数据表|记录|查询|筛选|搜索|table|list|filter|search/i.test(userRequest);
  const rules = [
    {
      label: "列表/表格结构",
      allowed: wantsCollection && !wantsDetail,
      pattern: /列表|表格|数据行|表头|分页|Table|DataTable/i
    },
    {
      label: "查询/筛选结构",
      allowed: /查询|筛选|搜索|filter|search/i.test(userRequest) && !wantsDetail,
      pattern: /筛选|查询|搜索|FilterBar|SearchBar/i
    }
  ];
  return rules
    .filter((rule) => !rule.allowed && rule.pattern.test(generatedText) && !request.includes(rule.label.toLowerCase()))
    .map((rule) => rule.label);
}

function sanitizeGeneratedBusinessContent(userRequest: string, nodes: WorkspaceDesignNode[]) {
  const disallowedRules = getGeneratedBusinessContentRules(userRequest).filter((rule) => !rule.allowed);
  if (disallowedRules.length === 0) return nodes;
  const removeIds = new Set<string>();
  nodes.forEach((node) => {
    const text = `${node.name} ${node.text ?? ""}`;
    if (disallowedRules.some((rule) => rule.pattern.test(text))) {
      removeIds.add(node.id);
    }
  });
  if (removeIds.size === 0) return nodes;
  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach((node) => {
      if (node.parentId && removeIds.has(node.parentId) && !removeIds.has(node.id)) {
        removeIds.add(node.id);
        changed = true;
      }
    });
  }
  return nodes.filter((node) => !removeIds.has(node.id));
}

function applyGeneratedUiConstraints(userRequest: string, nodes: WorkspaceDesignNode[]) {
  const sanitized = sanitizeGeneratedBusinessContent(userRequest, removeDetailPageListArtifacts(userRequest, removeGeneratedPreviewPlaceholders(nodes)));
  const normalized = sanitized.map((node) => normalizeGeneratedNodeConstraints(node, userRequest));
  const clamped = clampGeneratedNodesToContainers(normalized);
  return expandFramesToFitChildren(clamped.map((node) => node.type === "text" ? expandTextNodeForReadability(node) : node), 16);
}

function removeDetailPageListArtifacts(userRequest: string, nodes: WorkspaceDesignNode[]) {
  if (!/详情|查看|资料|detail|inspect/i.test(userRequest)) return nodes;
  const removeIds = new Set<string>();
  nodes.forEach((node) => {
    const text = `${node.name} ${node.text ?? ""}`;
    if (node.type === "table" || /商品列表|列表卡片|列表标题|数据行|表头|分页|筛选|查询|FilterBar|Table/i.test(text)) {
      removeIds.add(node.id);
    }
  });
  if (removeIds.size === 0) return nodes;
  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach((node) => {
      if (node.parentId && removeIds.has(node.parentId) && !removeIds.has(node.id)) {
        removeIds.add(node.id);
        changed = true;
      }
    });
  }
  return nodes.filter((node) => !removeIds.has(node.id));
}

function removeGeneratedPreviewPlaceholders(nodes: WorkspaceDesignNode[]) {
  const removeIds = new Set<string>();
  nodes.forEach((node) => {
    const text = `${node.name} ${node.text ?? ""}`;
    const isLargeGeneratedPreview = node.type === "image"
      && node.width >= 180
      && node.height >= 100
      && (/Demo 图片|页面缩略图|预览图|generated-placeholder/i.test(text) || /生成.*画板|画板$/.test(text));
    if (isLargeGeneratedPreview) removeIds.add(node.id);
  });
  return nodes.filter((node) => !removeIds.has(node.id) && !(node.parentId && removeIds.has(node.parentId)));
}

function normalizeGeneratedNodeConstraints(node: WorkspaceDesignNode, userRequest: string): WorkspaceDesignNode {
  if (node.type === "button") {
    const isMobile = /小程序|移动端|手机|app/i.test(userRequest);
    const height = Math.max(node.height, isMobile ? 44 : 40);
    return normalizePatchedNode({
      ...node,
      height,
      textAlign: "center",
      textVerticalAlign: "middle",
      lineHeight: height,
      fontSize: Math.max(13, node.fontSize || 14),
      fontWeight: node.fontWeight || 600,
      fill: node.fill && node.fill !== "transparent" ? node.fill : "#246bfe",
      textColor: node.textColor || "#ffffff",
      radius: node.radius || (isMobile ? 16 : 8)
    });
  }
  if (node.type === "input") {
    const isMobile = /小程序|移动端|手机|app/i.test(userRequest);
    const height = Math.max(node.height, isMobile ? 44 : 36);
    return normalizePatchedNode({
      ...node,
      height,
      textVerticalAlign: "middle",
      lineHeight: height,
      fontSize: Math.max(13, node.fontSize || 14),
      radius: node.radius || (isMobile ? 12 : 6),
      fill: node.fill && node.fill !== "transparent" ? node.fill : "#ffffff",
      stroke: node.stroke && node.stroke !== "transparent" ? node.stroke : "#d0d5dd"
    });
  }
  if (node.type === "text") {
    return expandTextNodeForReadability(normalizePatchedNode({
      ...node,
      fontSize: Math.max(11, node.fontSize || 14),
      fill: "transparent",
      stroke: "transparent",
      strokeWidth: 0
    }));
  }
  return normalizePatchedNode(node);
}

function clampGeneratedNodesToContainers(nodes: WorkspaceDesignNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    if (node.type === "frame") return node;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const frame = parent && (parent.type === "frame" || parent.type === "container" || parent.type === "card")
      ? parent
      : nodes.find((candidate) => candidate.type === "frame" && isNodeInsideTarget(node, candidate));
    if (!frame) return node;
    const padding = frame.type === "frame" ? 8 : 4;
    const maxWidth = Math.max(1, frame.width - padding * 2);
    const maxHeight = Math.max(1, frame.height - padding * 2);
    const width = Math.min(node.width, maxWidth);
    const height = Math.min(node.height, maxHeight);
    return {
      ...node,
      width,
      height,
      x: clampNumber(node.x, frame.x + padding, frame.x + frame.width - width - padding),
      y: clampNumber(node.y, frame.y + padding, frame.y + frame.height - height - padding)
    };
  });
}

function clampNumber(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function getGeneratedBusinessContentRules(userRequest: string) {
  const primaryUserRequest = getPrimaryUserRequestText(userRequest);
  const requestedEntities = inferBusinessEntitiesFromText(primaryUserRequest);
  const allows = (entity: string, fallback: RegExp) => requestedEntities.includes(entity) || fallback.test(primaryUserRequest);
  return [
    { label: "订单", allowed: allows("订单", /交易|支付|退款|发货|电商|商城/), pattern: /订单(详情页|列表页|管理页|页面|画板)|订单管理|订单列表/i },
    { label: "商品", allowed: allows("商品", /电商|商城/), pattern: /商品(详情页|列表页|管理页|页面|画板)|商品管理|商品列表/i },
    { label: "客户", allowed: allows("客户", /CRM|会员|用户/), pattern: /客户(详情页|列表页|管理页|页面|画板)|客户管理|客户列表/i },
    { label: "用户", allowed: allows("用户", /账号|会员|客户/), pattern: /用户(详情页|列表页|管理页|页面|画板)|用户管理|用户列表/i }
  ];
}

function getPrimaryUserRequestText(text: string) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return text.trim();
  const stopIndex = lines.findIndex((line, index) => index > 0 && /上一次|本轮|失败|重试|修复|Validator|schemaDraft|Layout Intent|Critic|审核|契约|要求：|必须以|不要去修改|不要退回/i.test(line));
  return (stopIndex > 0 ? lines.slice(0, stopIndex) : [lines[0]]).join("\n").trim() || text.trim();
}

function inferBusinessEntitiesFromText(text: string) {
  const entityPatterns: Array<{ entity: string; pattern: RegExp }> = [
    { entity: "订单", pattern: /订单|order|交易单|退款单|发货单|支付单/i },
    { entity: "商品", pattern: /商品|产品|product|sku|库存|上架|下架/i },
    { entity: "客户", pattern: /客户|会员|customer|crm/i },
    { entity: "用户", pattern: /用户(列表|详情|管理|页面|画板|账号|资料|中心|权限)|账号|user/i },
    { entity: "服务人员", pattern: /服务人员|家政员|护工|保姆/i },
    { entity: "设备", pattern: /设备|device|iot/i },
    { entity: "任务", pattern: /任务|task/i },
    { entity: "项目", pattern: /项目|project/i }
  ];
  return entityPatterns.filter((item) => item.pattern.test(text)).map((item) => item.entity);
}

function inferBusinessIdentityEntitiesFromText(text: string) {
  const identityPatterns: Array<{ entity: string; pattern: RegExp }> = [
    { entity: "订单", pattern: /订单(详情页|列表页|管理页|页面|画板|标题)|订单管理|订单列表/i },
    { entity: "商品", pattern: /商品(详情页|列表页|管理页|页面|画板|标题)|商品管理|商品列表/i },
    { entity: "客户", pattern: /客户(详情页|列表页|管理页|页面|画板|标题)|客户管理|客户列表/i },
    { entity: "用户", pattern: /用户(详情页|列表页|管理页|页面|画板|标题)|用户管理|用户列表/i },
    { entity: "服务人员", pattern: /服务人员(详情页|列表页|管理页|页面|画板|标题)|服务人员管理|服务人员列表/i },
    { entity: "设备", pattern: /设备(详情页|列表页|管理页|页面|画板|标题)|设备管理|设备列表/i },
    { entity: "任务", pattern: /任务(详情页|列表页|管理页|页面|画板|标题)|任务管理|任务列表/i },
    { entity: "项目", pattern: /项目(详情页|列表页|管理页|页面|画板|标题)|项目管理|项目列表/i }
  ];
  return identityPatterns.filter((item) => item.pattern.test(text)).map((item) => item.entity);
}

function translateDesignNode(node: WorkspaceDesignNode, dx: number, dy: number): WorkspaceDesignNode {
  if (dx === 0 && dy === 0) return node;
  return {
    ...node,
    x: Math.round(node.x + dx),
    y: Math.round(node.y + dy),
    clipBounds: node.clipBounds ? {
      ...node.clipBounds,
      x: Math.round(node.clipBounds.x + dx),
      y: Math.round(node.clipBounds.y + dy)
    } : undefined,
    clipPath: node.clipPath ? {
      ...node.clipPath,
      x: Math.round(node.clipPath.x + dx),
      y: Math.round(node.clipPath.y + dy)
    } : undefined
  };
}

function getNodesBounds(nodes: WorkspaceDesignNode[]) {
  if (nodes.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function parseNodeInputs(value: unknown): WorkspaceDesignNode[] {
  const nodes = Array.isArray(value) ? value : [];
  return nodes.map((item) => createDesignNode(nodeTypeSchema.parse((item as { type?: unknown }).type), designNodeInputSchema.parse(item)));
}

function parseUiRequirement(userRequest: string) {
  const features: Array<{ name: string; type: string; priority: "high" | "medium" | "low"; entities: string[] }> = [];
  const addFeature = (name: string, type: string, entities: string[], priority: "high" | "medium" | "low" = "high") => {
    if (!features.some((feature) => feature.type === type)) {
      features.push({ name, type, priority, entities });
    }
  };
  if (/手机|手机号|验证码|登录|注册/.test(userRequest)) {
    addFeature("手机号验证码登录/注册", "auth_phone", ["手机号", "验证码", "登录", "注册"]);
  }
  if (/微信|支付宝|快捷登录|第三方|绑定/.test(userRequest)) {
    addFeature("第三方快捷登录与账号绑定", "auth_binding", ["微信", "支付宝", "绑定账号"]);
  }
  if (/个人信息|资料|头像|昵称|生日|性别/.test(userRequest)) {
    addFeature("个人信息管理", "profile", ["头像", "昵称", "手机号", "性别", "生日"]);
  }
  if (/实名|身份证|人脸/.test(userRequest)) {
    addFeature("实名认证", "identity_verification", ["身份证", "人脸识别", "账号安全"], "medium");
  }
  if (/地址|地图|选址/.test(userRequest)) {
    addFeature("地址管理", "address", ["地址添加", "编辑", "删除", "地图选址"]);
  }
  if (/产品|商品|详情页|详情|sku|规格|价格|库存|评价/.test(userRequest)) {
    addFeature("产品详情展示", "product_detail", ["产品图片", "产品标题", "价格", "规格", "库存", "评价", "购买操作"]);
  }
  if (features.length === 0) {
    addFeature("核心功能", "generic", ["入口", "详情", "状态"]);
  }
  return {
    module: /产品|商品|sku|规格|价格|库存/.test(userRequest)
      ? "商品产品模块"
      : /用户|登录|注册|个人|实名|地址/.test(userRequest) ? "用户基础模块" : "业务模块",
    platform: /小程序|app|移动|手机|手机号/i.test(userRequest) ? "mobile_app" : "web",
    features,
    nonFunctionalRequirements: inferNonFunctionalRequirements(userRequest),
    interfaceRequirements: inferInterfaceRequirements(userRequest),
    interactionRequirements: inferInteractionRequirements(userRequest)
  };
}

function inferNonFunctionalRequirements(userRequest: string) {
  const items = ["信息结构清晰，核心路径不超过 3 步", "状态反馈完整，包含默认、加载、空、错误、成功状态"];
  if (/实名|身份证|人脸|手机号|登录|注册|账号/.test(userRequest)) {
    items.push("涉及账号与身份信息时必须强调安全、隐私和异常兜底");
  }
  if (/团队|协作|项目|任务/.test(userRequest)) {
    items.push("多人协作场景需要体现权限、变更记录和通知提醒");
  }
  return items;
}

function inferInterfaceRequirements(userRequest: string) {
  const platform = /小程序|app|移动|手机|手机号/i.test(userRequest) ? "mobile_app" : "web";
  const items = platform === "mobile_app"
    ? ["移动端画板基准 750px 设计稿 / 375px 逻辑宽度", "主要操作按钮靠近底部安全区，输入表单保持单列布局"]
    : ["PC 端以 1920px 宽屏为设计基准，内容区建议 1440px 画板", "顶部导航、左侧导航、内容卡片和表格区域需要清晰分层"];
  if (/地图|地址|选址/.test(userRequest)) {
    items.push("地图选址需要明确搜索入口、定位状态、地址卡片和确认按钮");
  }
  return items;
}

function inferInteractionRequirements(userRequest: string) {
  const items = ["每个页面要有明确主行动、返回/取消路径和异常提示"];
  if (/验证码|登录|注册/.test(userRequest)) {
    items.push("验证码需要倒计时、重发、错误提示和登录成功反馈");
  }
  if (/上传|身份证|人脸/.test(userRequest)) {
    items.push("上传流程需要支持重新上传、识别中、失败重试和隐私说明");
  }
  if (/编辑|删除|添加|管理/.test(userRequest)) {
    items.push("列表/表单操作需要二次确认、保存反馈和空状态引导");
  }
  return items;
}

function generateUiFlowPlan(parsedRequirement: Record<string, unknown>) {
  const features = Array.isArray(parsedRequirement.features) ? parsedRequirement.features as Array<Record<string, unknown>> : [];
  const pages: Array<{ id: string; name: string; sourceFeature: string; state?: string }> = [];
  const flows: Array<{ name: string; steps: string[] }> = [];
  const addPage = (id: string, name: string, sourceFeature: string, state?: string) => {
    if (!pages.some((page) => page.id === id)) pages.push({ id, name, sourceFeature, state });
  };
  features.forEach((feature) => {
    const type = String(feature.type ?? "");
    const name = String(feature.name ?? "功能");
    if (type === "auth_phone") {
      addPage("login", "登录/注册页", name);
      addPage("verify_code", "验证码输入页", name);
      addPage("auth_success", "登录成功页", name, "success");
      flows.push({ name: "手机号登录注册流程", steps: ["login", "verify_code", "auth_success"] });
    } else if (type === "auth_binding") {
      addPage("third_party_bind", "第三方账号绑定页", name);
      flows.push({ name: "第三方登录绑定流程", steps: ["login", "third_party_bind", "auth_success"] });
    } else if (type === "profile") {
      addPage("profile", "个人信息页", name);
      addPage("profile_edit", "编辑个人资料页", name);
      flows.push({ name: "个人信息完善流程", steps: ["profile", "profile_edit", "profile"] });
    } else if (type === "identity_verification") {
      addPage("identity", "实名认证页", name);
      addPage("id_card_upload", "身份证上传页", name);
      addPage("face_verify", "人脸识别引导页", name);
      addPage("identity_success", "实名认证成功页", name, "success");
      flows.push({ name: "实名认证流程", steps: ["profile", "identity", "id_card_upload", "face_verify", "identity_success"] });
    } else if (type === "address") {
      addPage("address_list", "地址管理页", name);
      addPage("address_edit", "新增/编辑地址页", name);
      addPage("map_pick", "地图搜索选址页", name);
      addPage("address_empty", "地址空状态页", name, "empty");
      flows.push({ name: "地址新增编辑流程", steps: ["address_list", "address_edit", "map_pick", "address_edit", "address_list"] });
    } else if (type === "product_detail") {
      addPage("product_detail", "产品详情页", name);
      flows.push({ name: "产品详情浏览与转化流程", steps: ["product_detail"] });
    } else {
      addPage("home", "功能入口页", name);
      addPage("detail", "功能详情页", name);
      flows.push({ name: `${name}流程`, steps: ["home", "detail"] });
    }
  });
  return {
    taskType: "create_new_ui",
    module: String(parsedRequirement.module ?? "业务模块"),
    platform: String(parsedRequirement.platform ?? "mobile_app"),
    pages,
    flows,
    states: ["default", "loading", "empty", "error", "success", "disabled"]
  };
}

function createUiPagesFromFlowPlan(flowPlan: Record<string, unknown>, userRequest: string): WorkspaceDesignPage[] {
  const pages = Array.isArray(flowPlan.pages) ? flowPlan.pages as Array<Record<string, unknown>> : [];
  const platform = String(flowPlan.platform ?? "mobile_app");
  const canvas = platform === "mobile_app" ? { width: 375, height: 812 } : { width: 1440, height: 1024 };
  return pages.slice(0, 14).map((pageInput, index) => {
    const pageId = createDesignId("page");
    const pageName = String(pageInput.name ?? `页面 ${index + 1}`);
    const nodes = createSemanticPageNodes(pageName, String(pageInput.id ?? ""), userRequest, canvas, index);
    return {
      id: pageId,
      name: pageName,
      nodes,
      nodeCount: nodes.length,
      schemaLoaded: true
    };
  });
}

function createUiNodesFromFlowPlan(
  flowPlan: Record<string, unknown>,
  userRequest: string,
  canvas: { width: number; height: number },
  placement: { startX: number; topY: number; gap: number }
) {
  const pages = Array.isArray(flowPlan.pages) ? flowPlan.pages as Array<Record<string, unknown>> : [];
  return pages.slice(0, 14).flatMap((pageInput, index) => {
    const pageName = String(pageInput.name ?? `页面 ${index + 1}`);
    const origin = {
      x: placement.startX + index * (canvas.width + placement.gap),
      y: placement.topY
    };
    return createSemanticPageNodes(pageName, String(pageInput.id ?? ""), userRequest, canvas, index, origin);
  });
}

function createUiNodesFromSchemaDraft(schemaDraft: UiSchemaDraft, placement: { startX: number; topY: number; gap: number }, capabilityProfile?: DesignCapabilityProfile) {
  const profile = capabilityProfile ?? getDesignCapabilityProfile(schemaDraft.platform === "mobile_app" ? "mobile_app" : "pc_web");
  const result = compileStitchUiDraftToSceneGraph(schemaDraft, profile, {
    placement,
    userRequest: schemaDraft.intent
  });
  assertCompilerCoverageDiagnostics(result.diagnostics);
  return result.nodes;
}

function createUiNodesFromSchemaDraftIntoFrame(schemaDraft: UiSchemaDraft, targetFrame: WorkspaceDesignNode, capabilityProfile?: DesignCapabilityProfile) {
  const profile = capabilityProfile ?? getDesignCapabilityProfile(schemaDraft.platform === "mobile_app" ? "mobile_app" : "pc_web");
  const result = compileStitchUiDraftToSceneGraph(schemaDraft, profile, {
    targetFrame,
    userRequest: schemaDraft.intent
  });
  assertCompilerCoverageDiagnostics(result.diagnostics);
  return result.nodes;
}

function assertCompilerCoverageDiagnostics(diagnostics: string[]) {
  const coverageDiagnostics = diagnostics.filter((item) => item.startsWith("compiler-coverage:"));
  if (coverageDiagnostics.length === 0) return;
  throw new Error(`Compiler Coverage 诊断失败：layoutIntent 中的信息没有被渲染器完整承接。${coverageDiagnostics.slice(0, 5).join("；")}`);
}

function getCapabilityProfileForPageNodes(nodes: WorkspaceDesignNode[], userRequest = "") {
  const frames = nodes.filter((node) => node.type === "frame");
  const narrowFrame = frames.find((frame) => frame.width <= 480);
  const platform = narrowFrame || /小程序|移动端|手机|app/i.test(userRequest) ? "mobile_app" : "pc_web";
  return getDesignCapabilityProfile(platform, userRequest);
}

function createSemanticPageNodes(
  pageName: string,
  pageKey: string,
  userRequest: string,
  canvas: { width: number; height: number },
  index: number,
  origin?: { x: number; y: number }
) {
  const originX = origin?.x ?? 520 + (index % 4) * (canvas.width + 56);
  const originY = origin?.y ?? 220 + Math.floor(index / 4) * (canvas.height + 80);
  const frameId = createDesignId("frame");
  const nodes: WorkspaceDesignNode[] = [
    createDesignNode("frame", {
      id: frameId,
      name: `${pageName} 画板`,
      x: originX,
      y: originY,
      width: canvas.width,
      height: canvas.height,
      fill: "#f7f8fb",
      stroke: "#e4e7ec",
      radius: 28
    }),
    createDesignNode("text", {
      parentId: frameId,
      name: "页面标题",
      x: originX + 24,
      y: originY + 48,
      width: canvas.width - 48,
      height: 36,
      text: pageName,
      fontSize: 24,
      textColor: "#101828"
    })
  ];
  const addInput = (label: string, y: number, placeholder = `请输入${label}`) => {
    nodes.push(createDesignNode("text", {
      parentId: frameId,
      name: `${label}标签`,
      x: originX + 24,
      y,
      width: canvas.width - 48,
      height: 20,
      text: label,
      fontSize: 13,
      textColor: "#475467"
    }));
    nodes.push(createDesignNode("input", {
      parentId: frameId,
      name: `${label}输入框`,
      x: originX + 24,
      y: y + 26,
      width: canvas.width - 48,
      height: 52,
      text: placeholder,
      radius: 14
    }));
  };
  if (/login|verify|登录|注册|验证码/.test(pageKey + pageName)) {
    addInput("手机号", originY + 132, "请输入手机号");
    addInput("验证码", originY + 220, "请输入验证码");
    nodes.push(createDesignNode("button", { parentId: frameId, name: "登录注册按钮", x: originX + 24, y: originY + 326, width: canvas.width - 48, height: 48, text: "登录 / 注册", radius: 16 }));
    nodes.push(createDesignNode("text", { parentId: frameId, name: "第三方登录", x: originX + 24, y: originY + 430, width: canvas.width - 48, height: 28, text: userRequest.includes("微信") || userRequest.includes("支付宝") ? "微信 / 支付宝快捷登录" : "快捷登录", fontSize: 14, textColor: "#667085" }));
  } else if (/bind|绑定/.test(pageKey + pageName)) {
    nodes.push(createDesignNode("card", { parentId: frameId, name: "账号绑定卡片", x: originX + 24, y: originY + 132, width: canvas.width - 48, height: 180, text: "绑定微信或支付宝账号，保障账号安全" }));
    nodes.push(createDesignNode("button", { parentId: frameId, name: "绑定按钮", x: originX + 24, y: originY + 344, width: canvas.width - 48, height: 48, text: "一键绑定", radius: 16 }));
  } else if (/profile|个人|资料/.test(pageKey + pageName)) {
    ["头像", "昵称", "手机号", "性别", "生日"].forEach((item, itemIndex) => {
      nodes.push(createDesignNode("card", { parentId: frameId, name: `${item}信息项`, x: originX + 24, y: originY + 124 + itemIndex * 64, width: canvas.width - 48, height: 52, text: item, radius: 14 }));
    });
  } else if (/identity|实名|身份证|face/.test(pageKey + pageName)) {
    nodes.push(createDesignNode("card", { parentId: frameId, name: "实名步骤卡片", x: originX + 24, y: originY + 132, width: canvas.width - 48, height: 220, text: "身份证上传 -> 人脸识别 -> 认证完成", radius: 18 }));
    nodes.push(createDesignNode("button", { parentId: frameId, name: "开始认证按钮", x: originX + 24, y: originY + 388, width: canvas.width - 48, height: 48, text: "开始认证", radius: 16 }));
  } else if (/address|地址|map|地图/.test(pageKey + pageName)) {
    nodes.push(createDesignNode("card", { parentId: frameId, name: "地址卡片", x: originX + 24, y: originY + 124, width: canvas.width - 48, height: 104, text: "默认地址 / 收件人 / 手机号", radius: 16 }));
    nodes.push(createDesignNode("button", { parentId: frameId, name: "新增地址按钮", x: originX + 24, y: originY + 260, width: canvas.width - 48, height: 48, text: "新增地址", radius: 16 }));
    if (/map|地图/.test(pageKey + pageName)) {
      nodes.push(createDesignNode("container", { parentId: frameId, name: "地图选址区域", x: originX + 24, y: originY + 124, width: canvas.width - 48, height: 320, fill: "#eaf2ff", stroke: "#b2ccff", radius: 18 }));
    }
  } else if (/product|商品|产品|详情/.test(pageKey + pageName)) {
    if (canvas.width >= 900) {
      nodes.push(createDesignNode("container", { parentId: frameId, name: "产品图片区", x: originX + 48, y: originY + 132, width: 520, height: 520, fill: "#eef2f7", stroke: "#d0d5dd", radius: 24, text: "产品主图" }));
      nodes.push(createDesignNode("text", { parentId: frameId, name: "产品标题", x: originX + 620, y: originY + 132, width: 560, height: 44, text: "高端智能产品名称", fontSize: 28, textColor: "#101828" }));
      nodes.push(createDesignNode("text", { parentId: frameId, name: "产品卖点", x: originX + 620, y: originY + 188, width: 620, height: 28, text: "一句话突出核心卖点、适用人群和差异化价值", fontSize: 15, textColor: "#667085" }));
      nodes.push(createDesignNode("card", { parentId: frameId, name: "价格库存卡片", x: originX + 620, y: originY + 244, width: 620, height: 112, fill: "#fff7ed", stroke: "#fed7aa", radius: 18, text: "¥ 399.00 / 库存充足 / 限时优惠" }));
      nodes.push(createDesignNode("card", { parentId: frameId, name: "规格选择区", x: originX + 620, y: originY + 384, width: 620, height: 156, fill: "#ffffff", stroke: "#e4e7ec", radius: 18, text: "颜色：曜石黑 / 冰川银；规格：标准版 / Pro 版" }));
      nodes.push(createDesignNode("button", { parentId: frameId, name: "加入购物车按钮", x: originX + 620, y: originY + 572, width: 184, height: 52, text: "加入购物车", fill: "#101828", radius: 16 }));
      nodes.push(createDesignNode("button", { parentId: frameId, name: "立即购买按钮", x: originX + 824, y: originY + 572, width: 184, height: 52, text: "立即购买", fill: "#246bfe", radius: 16 }));
      nodes.push(createDesignNode("card", { parentId: frameId, name: "详情评价参数区", x: originX + 48, y: originY + 700, width: canvas.width - 96, height: 240, fill: "#ffffff", stroke: "#e4e7ec", radius: 20, text: "商品详情 / 参数规格 / 用户评价 / 售后保障" }));
    } else {
      nodes.push(createDesignNode("container", { parentId: frameId, name: "产品主图", x: originX, y: originY + 104, width: canvas.width, height: 320, fill: "#eef2f7", stroke: "#d0d5dd", radius: 0, text: "产品主图" }));
      nodes.push(createDesignNode("text", { parentId: frameId, name: "产品标题", x: originX + 24, y: originY + 452, width: canvas.width - 48, height: 36, text: "高端智能产品名称", fontSize: 22, textColor: "#101828" }));
      nodes.push(createDesignNode("text", { parentId: frameId, name: "价格", x: originX + 24, y: originY + 500, width: canvas.width - 48, height: 36, text: "¥ 399.00", fontSize: 26, textColor: "#f04438" }));
      nodes.push(createDesignNode("card", { parentId: frameId, name: "规格选择区", x: originX + 24, y: originY + 556, width: canvas.width - 48, height: 112, text: "已选：曜石黑 / Pro 版 / 1 件", radius: 16 }));
      nodes.push(createDesignNode("card", { parentId: frameId, name: "详情评价区", x: originX + 24, y: originY + 692, width: canvas.width - 48, height: 72, text: "详情 / 参数 / 评价", radius: 16 }));
      nodes.push(createDesignNode("button", { parentId: frameId, name: "底部购买按钮", x: originX + 24, y: originY + canvas.height - 76, width: canvas.width - 48, height: 52, text: "立即购买", fill: "#246bfe", radius: 18 }));
    }
  } else {
    nodes.push(createDesignNode("card", { parentId: frameId, name: "内容区", x: originX + 24, y: originY + 132, width: canvas.width - 48, height: 280, text: pageName, radius: 18 }));
  }
  return nodes;
}

function normalizeDraftNodeForRendering(draftNode: z.infer<typeof uiSchemaDraftNodeSchema>) {
  if (draftNode.type === "button") {
    const text = String(draftNode.text ?? draftNode.name ?? "");
    const fontSize = draftNode.fontSize ?? 14;
    return {
      ...draftNode,
      height: Math.max(draftNode.height, 44),
      fontSize,
      text,
      textAlign: "center" as const,
      lineHeight: Math.max(draftNode.height, 44)
    };
  }
  if (draftNode.type !== "text") {
    return draftNode;
  }
  const text = String(draftNode.text ?? draftNode.name ?? "");
  const fontSize = draftNode.fontSize ?? 14;
  const charsPerLine = Math.max(6, Math.floor(draftNode.width / Math.max(8, fontSize)));
  const estimatedLines = Math.max(1, Math.ceil(text.length / charsPerLine));
  return {
    ...draftNode,
    height: Math.max(draftNode.height, Math.ceil(estimatedLines * fontSize * 1.55))
  };
}

function enhanceGeneratedUiNodes(nodes: WorkspaceDesignNode[], profile: DesignCapabilityProfile, resolvedAssets: ResolvedDesignImageAsset[] = []) {
  let nextNodes = compileLayoutTreeToSceneGraph(nodes, profile);
  nextNodes = replaceGeneratedImagesWithPlaceholders(nextNodes, resolvedAssets);
  nextNodes = addMissingVisualAssets(nextNodes, profile, resolvedAssets);
  nextNodes = compileLayoutTreeToSceneGraph(nextNodes, profile);
  return nextNodes;
}

function replaceGeneratedImagesWithPlaceholders(nodes: WorkspaceDesignNode[], resolvedAssets: ResolvedDesignImageAsset[] = []) {
  let imageIndex = 0;
  const placeholderAssets = resolvedAssets.filter((asset) => asset.imageUrl);
  return nodes.map((node) => {
    if (node.type !== "image" && !node.imageUrl) return node;
    const asset = placeholderAssets[imageIndex % Math.max(1, placeholderAssets.length)];
    imageIndex += 1;
    return {
      ...node,
      imageUrl: asset?.imageUrl ?? buildLocalImagePlaceholderDataUrl(node.name || node.text || "图片占位"),
      fill: node.fill && node.fill !== "transparent" ? node.fill : "#f3f6fb",
      stroke: node.stroke && node.stroke !== "transparent" ? node.stroke : "#dbe4f0"
    };
  });
}

function addMissingVisualAssets(nodes: WorkspaceDesignNode[], profile: DesignCapabilityProfile, resolvedAssets: ResolvedDesignImageAsset[] = []) {
  const nextNodes = [...nodes];
  const artboards = nextNodes.filter((node) => node.type === "frame" && !node.parentId);
  artboards.forEach((frame, index) => {
    const children = nextNodes.filter((node) => node.parentId === frame.id || isNodeInsideTarget(node, frame)).filter((node) => node.id !== frame.id);
    const hasIconOrImage = children.some((node) => node.type === "image" || /icon|图标|插画|图片|主图|avatar|logo/i.test(node.name));
    if (hasIconOrImage) return;
    const isMobile = frame.width <= 480 || profile.platform === "mobile_app" || profile.platform === "wechat_mini_program";
    const iconSize = isMobile ? 36 : 44;
    const iconX = frame.x + (isMobile ? 24 : 32);
    const iconY = frame.y + (isMobile ? 36 : 32);
    const iconAsset = resolvedAssets.find((asset) => asset.type === "icon" && asset.imageUrl);
    nextNodes.push(createDesignNode("image", {
      parentId: frame.id,
      name: "语义图标",
      x: iconX,
      y: iconY,
      width: iconSize,
      height: iconSize,
      fill: "transparent",
      stroke: "transparent",
      radius: 12,
      imageUrl: iconAsset?.imageUrl ?? buildLocalSvgDataUrl({
        label: inferIconLabel(frame.name),
        background: getAssetBackground(index),
        foreground: "#ffffff"
      })
    }));
  });
  return nextNodes;
}

function inferIconLabel(name: string) {
  if (/登录|注册|账号/.test(name)) return "登录";
  if (/实名|认证|安全/.test(name)) return "盾";
  if (/地址|地图/.test(name)) return "位";
  if (/商品|产品/.test(name)) return "品";
  if (/支付|收益|提现/.test(name)) return "¥";
  return "UI";
}

function getAssetBackground(index: number) {
  return ["#2563eb", "#07c160", "#f97316", "#7c3aed", "#0891b2"][index % 5];
}

function buildLocalSvgDataUrl(input: { label: string; background: string; foreground: string }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="24" fill="${input.background}"/><text x="48" y="58" text-anchor="middle" font-size="28" font-weight="700" font-family="Arial, sans-serif" fill="${input.foreground}">${escapeSvgText(input.label).slice(0, 2)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildLocalImagePlaceholderDataUrl(label: string) {
  const safeLabel = escapeSvgText(label).slice(0, 14);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="320" viewBox="0 0 512 320"><rect width="512" height="320" rx="28" fill="#f3f6fb"/><rect x="36" y="36" width="440" height="248" rx="20" fill="none" stroke="#2563eb" stroke-opacity="0.18" stroke-width="2" stroke-dasharray="10 10"/><circle cx="176" cy="132" r="34" fill="#2563eb" fill-opacity="0.16"/><rect x="226" y="108" width="126" height="14" rx="7" fill="#64748b" fill-opacity="0.32"/><rect x="226" y="136" width="172" height="12" rx="6" fill="#64748b" fill-opacity="0.22"/><rect x="116" y="198" width="280" height="12" rx="6" fill="#64748b" fill-opacity="0.2"/><text x="256" y="258" text-anchor="middle" font-size="17" font-weight="700" font-family="Arial, sans-serif" fill="#64748b">IMAGE PLACEHOLDER</text><text x="256" y="282" text-anchor="middle" font-size="14" font-family="Arial, sans-serif" fill="#64748b" fill-opacity="0.78">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createGranularTableNodesFromDraft(
  draftNode: z.infer<typeof uiSchemaDraftNodeSchema>,
  context: {
    nodeId: string;
    parentId?: string;
    originX: number;
    originY: number;
    platform: "web" | "mobile_app";
  }
) {
  const x = context.originX + draftNode.x;
  const y = context.originY + draftNode.y;
  const width = Math.max(160, draftNode.width);
  const height = Math.max(120, draftNode.height);
  const columns = inferColumns(`${draftNode.name} ${draftNode.text ?? ""}`).slice(0, context.platform === "mobile_app" ? 3 : 6);
  const nodes: WorkspaceDesignNode[] = [
    createDesignNode("container", {
      id: context.nodeId,
      parentId: context.parentId,
      name: `${draftNode.name || "数据列表"}容器`,
      x,
      y,
      width,
      height,
      fill: draftNode.fill ?? "#ffffff",
      stroke: draftNode.stroke ?? "#e4e7ec",
      strokeWidth: draftNode.strokeWidth ?? 1,
      radius: draftNode.radius ?? 16
    })
  ];

  if (context.platform === "mobile_app") {
    const rowHeight = 76;
    const rowGap = 10;
    const visibleRows = Math.max(2, Math.min(4, Math.floor((height - 24) / (rowHeight + rowGap))));
    Array.from({ length: visibleRows }).forEach((_, rowIndex) => {
      const rowId = createDesignId("node");
      const rowY = y + 12 + rowIndex * (rowHeight + rowGap);
      nodes.push(createDesignNode("container", {
        id: rowId,
        parentId: context.nodeId,
        name: `列表项 ${rowIndex + 1}`,
        x: x + 12,
        y: rowY,
        width: width - 24,
        height: rowHeight,
        fill: "#ffffff",
        stroke: "#eef0f4",
        radius: 14
      }));
      columns.forEach((column, columnIndex) => {
        nodes.push(createDesignNode("text", {
          parentId: rowId,
          name: `${column}文本`,
          x: x + 28,
          y: rowY + 14 + columnIndex * 21,
          width: width - 56,
          height: 20,
          text: columnIndex === 0 ? column : `${column}：`,
          fontSize: columnIndex === 0 ? 14 : 12,
          textColor: columnIndex === 0 ? "#101828" : "#667085"
        }));
      });
    });
    return nodes;
  }

  const headerHeight = 36;
  const rowHeight = 38;
  const columnWidth = Math.max(72, (width - 24) / columns.length);
  columns.forEach((column, columnIndex) => {
    nodes.push(createDesignNode("container", {
      parentId: context.nodeId,
      name: `${column}表头单元格`,
      x: x + 12 + columnIndex * columnWidth,
      y: y + 12,
      width: columnWidth,
      height: headerHeight,
      fill: "#f2f4f7",
      stroke: "#e4e7ec",
      radius: columnIndex === 0 ? 8 : 0
    }));
    nodes.push(createDesignNode("text", {
      parentId: context.nodeId,
      name: `${column}表头文字`,
      x: x + 24 + columnIndex * columnWidth,
      y: y + 22,
      width: columnWidth - 24,
      height: 18,
      text: column,
      fontSize: 12,
      textColor: "#344054"
    }));
  });
  Array.from({ length: 3 }).forEach((_, rowIndex) => {
    columns.forEach((column, columnIndex) => {
      const cellX = x + 12 + columnIndex * columnWidth;
      const cellY = y + 12 + headerHeight + rowIndex * rowHeight;
      nodes.push(createDesignNode("container", {
        parentId: context.nodeId,
        name: `${column}单元格 ${rowIndex + 1}`,
        x: cellX,
        y: cellY,
        width: columnWidth,
        height: rowHeight,
        fill: "#ffffff",
        stroke: "#eef0f4",
        radius: 0
      }));
      nodes.push(createDesignNode("text", {
        parentId: context.nodeId,
        name: `${column}单元格文字 ${rowIndex + 1}`,
        x: cellX + 12,
        y: cellY + 11,
        width: columnWidth - 24,
        height: 18,
        text: "",
        fontSize: 12,
        textColor: "#475467"
      }));
    });
  });
  return nodes;
}

function inferAssetRequests(userRequest: string) {
  const requests: Array<Record<string, string>> = [];
  if (/微信/.test(userRequest)) requests.push({ type: "icon", name: "wechat", usage: "third_party_login" });
  if (/支付宝/.test(userRequest)) requests.push({ type: "icon", name: "alipay", usage: "third_party_login" });
  if (/实名|身份证|人脸/.test(userRequest)) requests.push({ type: "illustration", name: "identity_security", usage: "identity_page" });
  if (/地图|地址/.test(userRequest)) requests.push({ type: "icon", name: "map_pin", usage: "address_page" });
  if (/商品|产品|详情|主图/.test(userRequest)) requests.push({ type: "image", name: "product_demo", query: "premium product photo", usage: "product_hero" });
  if (/首页|概览|工作台|dashboard/i.test(userRequest)) requests.push({ type: "illustration", name: "dashboard_demo", query: "modern dashboard illustration", usage: "hero_visual" });
  if (/空状态|引导|注册|登录/.test(userRequest)) requests.push({ type: "illustration", name: "onboarding_demo", query: "mobile app onboarding illustration", usage: "empty_or_onboarding" });
  return requests;
}

function toDesignPlatform(platform: string, userRequest = ""): DesignPlatform {
  if (/小程序|微信/.test(userRequest)) return "wechat_mini_program";
  if (platform === "mobile_app" || /移动端|手机|app/i.test(userRequest)) return "mobile_app";
  if (/响应式|responsive/i.test(userRequest)) return "responsive_web";
  return "pc_web";
}

function inferRequiredTopics(userRequest: string) {
  return Array.from(new Set([
    ...inferBusinessEntitiesFromText(userRequest),
    ...["手机号", "验证码", "微信", "支付宝", "绑定", "个人信息", "实名认证", "地址", "地图"].filter((topic) => userRequest.includes(topic))
  ]));
}

function formatRequirementParseMessage(parsed: ReturnType<typeof parseUiRequirement>) {
  return [
    `已解析需求：${parsed.module}，识别到 ${parsed.features.length} 个功能点。`,
    parsed.features.length > 0 ? `功能点：${parsed.features.map((feature) => `${feature.name}(${feature.entities.join("、")})`).join("；")}` : "",
    parsed.nonFunctionalRequirements.length > 0 ? `非功能要求：${parsed.nonFunctionalRequirements.join("；")}` : "",
    parsed.interfaceRequirements.length > 0 ? `界面设计要求：${parsed.interfaceRequirements.join("；")}` : "",
    parsed.interactionRequirements.length > 0 ? `交互要求：${parsed.interactionRequirements.join("；")}` : ""
  ].filter(Boolean).join("\n");
}

function formatAssetResolveMessage(assets: Array<{ id: string; type: string; usage: string; source: string }>) {
  if (assets.length === 0) {
    return [
      "素材 Agent 未识别到必须外部获取的素材。",
      "本次会使用基础组件、系统图标占位和 CSS/SVG 自绘元素，避免随机素材影响 UI 一致性。"
    ].join("\n");
  }
  return [
    `素材 Agent 已解析 ${assets.length} 个素材需求。`,
    `素材清单：${assets.map((asset) => `${asset.id}(${asset.type}，${asset.usage})`).join("、")}`,
    "获取策略：优先使用本地组件库/内置 SVG 占位；外部素材必须走授权来源，不能随机抓图。"
  ].join("\n");
}

function buildAssetStrategy(assets: Array<{ id: string; type: string; usage: string; source: string }>) {
  return {
    mode: assets.length > 0 ? "resolve_or_generate" : "self_draw",
    rules: [
      "优先使用基础组件和内置图标，保证可编辑、可复用。",
      "插画类素材先生成占位容器和语义名称，后续可接图片生成或素材库替换。",
      "外部素材必须记录来源和授权，不允许静默使用不明版权资源。"
    ],
    assets
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function createDesignNode(type: WorkspaceDesignNodeType, overrides: Partial<WorkspaceDesignNode> = {}): WorkspaceDesignNode {
  const node: WorkspaceDesignNode = {
    id: createDesignId("node"),
    type,
    name: defaultNodeName(type),
    x: 520,
    y: 320,
    width: type === "text" ? 240 : type === "table" ? 760 : type === "input" ? 280 : 200,
    height: type === "text" ? 56 : type === "table" ? 280 : type === "button" ? 48 : 140,
    fill: type === "button" ? "#246bfe" : type === "text" ? "transparent" : "#ffffff",
    stroke: type === "text" ? "transparent" : "#d8d8dd",
    strokeWidth: type === "text" ? 0 : 1,
    radius: type === "button" || type === "input" ? 12 : 8,
    text: type === "text" ? "Text" : type === "button" ? "Button" : "",
    textColor: type === "button" ? "#ffffff" : "#171717",
    fontSize: type === "text" ? 22 : 14,
    visible: true,
    locked: false
  };
  return normalizePatchedNode({ ...node, ...overrides });
}

function normalizePatchedNode(node: WorkspaceDesignNode): WorkspaceDesignNode {
  return {
    ...node,
    width: Math.max(1, node.width),
    height: Math.max(1, node.height),
    radius: Math.max(0, node.radius ?? 0),
    visible: node.visible !== false,
    locked: Boolean(node.locked)
  };
}

function autoPlaceNodes(page: WorkspaceDesignPage, nodes: WorkspaceDesignNode[]) {
  if (nodes.length === 0) return nodes;
  const bounds = getPageBounds(page);
  return nodes.map((node, index) => ({
    ...node,
    x: node.x || bounds.x + 48 + index * 24,
    y: node.y || bounds.y + bounds.height + 40 + index * 24
  }));
}

function createPromptNodes(prompt: string) {
  const text = prompt.toLowerCase();
  if (/table|表格|列表/.test(text)) {
    return [
      createDesignNode("table", {
        name: "AI 添加表格",
        width: 820,
        height: 320,
        text: serializeTableColumns(inferColumns(prompt)),
        fill: "#ffffff",
        stroke: "#eaecf0",
        radius: 18
      })
    ];
  }
  if (/button|按钮/.test(text)) {
    return [createDesignNode("button", { name: "AI 添加按钮", text: inferQuotedText(prompt) || "按钮" })];
  }
  if (/text|文字|标题|文案/.test(text)) {
    return [createDesignNode("text", { name: "AI 添加文字", text: inferQuotedText(prompt) || "新文本" })];
  }
  return [createDesignNode("card", { name: "AI 添加区块", text: "" })];
}

function inferColumns(prompt: string) {
  const match = /(?:字段|列|columns?|包含|包括)[:：]?\s*([^\n。；;]+)/i.exec(prompt);
  const columns = match?.[1]
    ?.split(/[、,，|/／\s]+/)
    .map((item) => item.trim())
    .filter((item) => item && !/字段|列|columns?|包含|包括|table|表格/.test(item));
  return columns && columns.length >= 2 ? columns.slice(0, 8) : [];
}

function serializeTableColumns(columns: string[]) {
  return `columns:${columns.join("|")}`;
}

function inferQuotedText(prompt: string) {
  return /[“"']([^“”"']+)[”"']/.exec(prompt)?.[1];
}

function findNode(page: WorkspaceDesignPage, nodeId?: string, match?: Record<string, unknown>) {
  if (nodeId) return page.nodes.find((node) => node.id === nodeId);
  const type = match?.type as WorkspaceDesignNodeType | undefined;
  const name = typeof match?.name === "string" ? match.name : undefined;
  return [...page.nodes].reverse().find((node) => {
    if (type && node.type !== type) return false;
    if (name && !node.name.includes(name)) return false;
    return type || name;
  });
}

function findNodesByQuery(page: WorkspaceDesignPage, query?: Record<string, unknown>) {
  if (!query) return page.nodes;
  const type = query.type as WorkspaceDesignNodeType | undefined;
  const name = typeof query.name === "string" ? query.name.toLowerCase() : "";
  const text = typeof query.text === "string" ? query.text.toLowerCase() : "";
  const position = typeof query.position === "string" ? query.position : "";
  const bounds = getPageBounds(page);
  return page.nodes.filter((node) => {
    if (type && node.type !== type) return false;
    if (name && !node.name.toLowerCase().includes(name)) return false;
    if (text && !(node.text ?? "").toLowerCase().includes(text)) return false;
    if (position === "left" && node.x > bounds.x + bounds.width * 0.35) return false;
    if (position === "right" && node.x + node.width < bounds.x + bounds.width * 0.65) return false;
    if (position === "top" && node.y > bounds.y + bounds.height * 0.35) return false;
    if (position === "bottom" && node.y + node.height < bounds.y + bounds.height * 0.65) return false;
    if (position === "center") {
      const centerX = node.x + node.width / 2;
      const centerY = node.y + node.height / 2;
      if (Math.abs(centerX - (bounds.x + bounds.width / 2)) > bounds.width * 0.25) return false;
      if (Math.abs(centerY - (bounds.y + bounds.height / 2)) > bounds.height * 0.25) return false;
    }
    return true;
  });
}

function findMenuLikeNode(page: WorkspaceDesignPage, position: "left" | "right") {
  const candidates = findNodesByQuery(page, { position });
  return candidates.find((node) => {
    const text = `${node.name} ${node.text ?? ""}`.toLowerCase();
    return /menu|菜单|导航|sidebar|侧边栏/.test(text);
  });
}

function findFallbackInsertionTarget(page: WorkspaceDesignPage, fallbackMode: string) {
  const visibleNodes = page.nodes.filter((node) => node.visible !== false);
  if (fallbackMode === "largest_table_or_list") {
    return visibleNodes
      .filter(isTableLikeNode)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
  }
  if (fallbackMode === "largest_content") {
    return visibleNodes
      .filter((node) => node.type !== "text" && node.type !== "button")
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
  }
  if (fallbackMode === "first_frame_content") {
    const frame = getTopLevelArtboards(page).filter((node) => node.id !== "page-preview-frame").sort((a, b) => a.x - b.x)[0];
    if (!frame) return undefined;
    return visibleNodes
      .filter((node) => node.id !== frame.id && (node.parentId === frame.id || isNodeInsideTarget(node, frame)))
      .sort((a, b) => a.y - b.y)[0] ?? frame;
  }
  return undefined;
}

function parseStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value.map((item) => String(item).trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function collectDescendantNodeIds(nodes: WorkspaceDesignNode[], nodeId: string): string[] {
  const children = nodes.filter((node) => node.parentId === nodeId);
  return children.flatMap((child) => [child.id, ...collectDescendantNodeIds(nodes, child.id)]);
}

function duplicateNodes(nodes: WorkspaceDesignNode[]) {
  const idMap = new Map(nodes.map((node) => [node.id, createDesignId("node")]));
  return nodes.map((node) => ({
    ...node,
    id: idMap.get(node.id) ?? createDesignId("node"),
    parentId: node.parentId ? idMap.get(node.parentId) : undefined,
    name: `${node.name} Copy`,
    x: node.x + 32,
    y: node.y + 32,
    locked: false
  }));
}

function duplicatePageSchema(page: WorkspaceDesignPage, name?: string): WorkspaceDesignPage {
  const nodes = duplicateNodes(page.nodes).map((node) => ({ ...node, name: node.name.replace(/ Copy$/, "") }));
  return { id: createDesignId("page"), name: name || `${page.name} Copy`, nodes, nodeCount: nodes.length, schemaLoaded: true };
}

function validateDesignPage(page: WorkspaceDesignPage) {
  const ids = new Set<string>();
  const issues: Array<{ nodeId?: string; message: string }> = [];
  page.nodes.forEach((node) => {
    if (!node.id) issues.push({ message: "节点缺少 id" });
    if (ids.has(node.id)) issues.push({ nodeId: node.id, message: "节点 id 重复" });
    ids.add(node.id);
    if (node.width <= 0 || node.height <= 0) issues.push({ nodeId: node.id, message: "节点尺寸必须大于 0" });
    if (!node.type) issues.push({ nodeId: node.id, message: "节点缺少 type" });
  });
  page.nodes.forEach((node) => {
    if (node.parentId && !ids.has(node.parentId)) {
      issues.push({ nodeId: node.id, message: `父节点不存在：${node.parentId}` });
    }
  });
  return issues;
}

function summarizePage(page: WorkspaceDesignPage) {
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

function summarizeNode(node: WorkspaceDesignNode) {
  return {
    id: node.id,
    parentId: node.parentId,
    type: node.type,
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    text: node.text
  };
}

function buildNodeTree(nodes: WorkspaceDesignNode[], nodeId: string): Record<string, unknown> {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return {};
  return {
    ...summarizeNode(node),
    children: nodes.filter((item) => item.parentId === node.id).map((child) => buildNodeTree(nodes, child.id))
  };
}

function findMainContentCandidates(page: WorkspaceDesignPage) {
  const bounds = getPageBounds(page);
  return page.nodes
    .filter((node) => node.visible !== false)
    .filter((node) => node.type === "container" || node.type === "frame" || node.type === "card")
    .filter((node) => node.width >= bounds.width * 0.45 && node.height >= 120)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))
    .slice(0, 5);
}

function isBeforePosition(value: unknown): value is { type: "before"; targetNodeId: string } {
  return Boolean(value)
    && typeof value === "object"
    && (value as { type?: unknown }).type === "before"
    && typeof (value as { targetNodeId?: unknown }).targetNodeId === "string";
}

function placeNodesBeforeTarget(nodes: WorkspaceDesignNode[], target: WorkspaceDesignNode, spacing: number) {
  if (nodes.length === 0) return nodes;
  const height = getNodesHeight(nodes);
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const targetY = target.y - height - spacing;
  return nodes.map((node) => ({
    ...node,
    parentId: node.parentId ?? target.parentId,
    x: node.x ? target.x + (node.x - minX) : target.x,
    y: node.y ? targetY + (node.y - minY) : targetY,
    width: node.width || target.width
  }));
}

function getNodesHeight(nodes: WorkspaceDesignNode[]) {
  if (nodes.length === 0) return 0;
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return maxY - minY;
}

function buildUiAnalysis(page: WorkspaceDesignPage, kind: "layout" | "spacing" | "color" | "typography" | "review") {
  const visibleNodes = page.nodes.filter((node) => node.visible !== false);
  const bounds = getPageBounds(page);
  const fills = countBy(visibleNodes.map((node) => node.fill).filter(Boolean));
  const fontSizes = countBy(visibleNodes.map((node) => String(node.fontSize)).filter(Boolean));
  const overlaps = countOverlaps(visibleNodes.slice(0, 160));
  const layoutHints = [
    bounds.width > 0 ? `页面内容范围 ${Math.round(bounds.width)} x ${Math.round(bounds.height)}` : "页面暂无有效内容范围",
    overlaps > 0 ? `检测到约 ${overlaps} 组文字/交互控件可能遮挡，需要确认功能可读可点` : "未发现明显文字/交互遮挡",
    visibleNodes.length > 120 ? `节点数量 ${visibleNodes.length}，建议按区域分组以提升可编辑性` : `节点数量 ${visibleNodes.length}`
  ];
  const spacingHints = inferSpacingHints(visibleNodes);
  const colorHints = [
    `主要填充色：${Object.entries(fills).slice(0, 6).map(([color, count]) => `${color}(${count})`).join("、") || "未识别"}`,
    Object.keys(fills).length > 12 ? "颜色数量较多，建议收敛为主色/背景/边框/状态色" : "颜色数量相对可控"
  ];
  const typographyHints = [
    `字体大小分布：${Object.entries(fontSizes).slice(0, 6).map(([size, count]) => `${size}px(${count})`).join("、") || "未识别"}`,
    Object.keys(fontSizes).length > 6 ? "字号层级偏多，建议压缩为标题/正文/辅助文案" : "字号层级相对清晰"
  ];
  const sections = {
    layout: layoutHints,
    spacing: spacingHints,
    color: colorHints,
    typography: typographyHints,
    review: [...layoutHints, ...spacingHints, ...colorHints, ...typographyHints]
  }[kind];
  return {
    kind,
    summary: `已完成 ${kind} 分析：${sections[0]}`,
    pageId: page.id,
    pageName: page.name,
    bounds,
    suggestions: sections
  };
}

function reviewArtboardLayout(page: WorkspaceDesignPage, userRequest = "", generatedFrameIds: string[] = [], capabilityProfile?: DesignCapabilityProfile): DesignReviewIssue[] {
  const targetFrameIds = new Set(generatedFrameIds);
  const artboards = getTopLevelArtboards(page)
    .filter((node) => node.id !== "page-preview-frame")
    .filter((node) => targetFrameIds.size === 0 || targetFrameIds.has(node.id));
  const issues: DesignReviewIssue[] = [];
  const isMobileRequest = /小程序|移动端|手机|app/i.test(userRequest);
  const profile = capabilityProfile ?? getDesignCapabilityProfile(isMobileRequest ? "mobile_app" : "pc_web", userRequest);
  const minimums = profile.rubric.minimums;
  artboards.forEach((frame) => {
    const children = page.nodes.filter((node) => node.parentId === frame.id || isNodeInsideTarget(node, frame)).filter((node) => node.id !== frame.id);
    const visibleChildren = children.filter((node) => node.visible !== false);
    const textNodes = visibleChildren.filter((node) => node.type === "text");
    const visualAssets = visibleChildren.filter((node) => node.type === "image" || /icon|图标|图片|插画|主图|demo/i.test(node.name));
    const fills = new Set(visibleChildren.map((node) => node.fill).filter((fill) => fill && fill !== "transparent"));
	    if (visibleChildren.length < minimums.minNodesPerArtboard) {
	      issues.push({
	        code: "content_missing",
	        level: "blocking",
	        message: `画板「${frame.name}」只有 ${visibleChildren.length} 个可见节点，低于基础质量门槛 ${minimums.minNodesPerArtboard}，页面会显得粗糙。`,
	        suggestedFix: { tool: "layout.apply_intent_patch", input: { pageId: page.id, targetNodeId: frame.id, operation: "add_required_region", regions: inferRequiredRegionsForReview(userRequest), spacing: 16, userRequest, pageMode: inferPageModeFromReviewRequest(userRequest), businessEntity: inferBusinessEntitiesFromText(userRequest)[0] ?? "" } }
	      });
	    }
	    if (textNodes.length < minimums.minTextNodesPerArtboard) {
	      issues.push({
	        code: "content_missing",
	        level: "blocking",
	        message: `画板「${frame.name}」文本层级不足，只有 ${textNodes.length} 个文本节点，无法形成清晰信息架构。`,
	        suggestedFix: { tool: "layout.apply_intent_patch", input: { pageId: page.id, targetNodeId: frame.id, operation: "add_required_region", regions: inferRequiredRegionsForReview(userRequest), spacing: 16, userRequest, pageMode: inferPageModeFromReviewRequest(userRequest), businessEntity: inferBusinessEntitiesFromText(userRequest)[0] ?? "" } }
	      });
	    }
	    if (visualAssets.length < minimums.minVisualAssetsPerArtboard) {
	      issues.push({
	        code: "content_missing",
	        level: "blocking",
	        message: `画板「${frame.name}」缺少 icon、demo 图片或插画资产，页面内容过于简陋。`
	      });
	    }
	    if (fills.size < minimums.minDistinctFillsPerArtboard) {
	      issues.push({
	        code: "content_missing",
	        level: "blocking",
	        message: `画板「${frame.name}」颜色/层级过少，仅 ${fills.size} 种有效填充，缺少可识别页面风格。`
	      });
	    }
	    if (isMobileRequest && frame.width > 480) {
	      issues.push({
	        code: "wrong_page_mode",
	        level: "blocking",
	        message: `画板「${frame.name}」看起来是 PC 尺寸（${frame.width}x${frame.height}），但用户要求移动端/小程序，需要重新按 375x812 单列规范生成。`
	      });
	    }
	    if (isMobileRequest && children.some((node) => node.type === "table")) {
	      issues.push({
	        code: "wrong_page_mode",
	        level: "blocking",
	        message: `画板「${frame.name}」包含 table 节点，但移动端/小程序应使用卡片列表或行容器，避免文字挤压。`,
	        suggestedFix: { tool: "layout.apply_intent_patch", input: { pageId: page.id, targetNodeId: frame.id, operation: "convert_table_to_card_list", spacing: 16 } }
      });
    }
    const clipped = children.filter((node) => (
      node.x < frame.x ||
      node.y < frame.y ||
      node.x + node.width > frame.x + frame.width ||
      node.y + node.height > frame.y + frame.height
    ));
	    if (clipped.length > 0) {
	      issues.push({
	        code: "out_of_artboard",
	        level: "blocking",
	        message: `画板「${frame.name}」存在 ${clipped.length} 个元素超出画板边界，可能被剪切显示不全。`,
	        targetNodeIds: clipped.map((node) => node.id),
	        suggestedFix: { tool: "layout.reflow", input: { pageId: page.id, spacing: 16 } }
	      });
	    }
    const meaningfulChildren = children.filter((node) => node.visible !== false && node.type !== "text");
	    if (meaningfulChildren.length === 0) {
	      issues.push({
	        code: "content_missing",
	        level: "warning",
	        message: `画板「${frame.name}」缺少可交互或内容组件，需要补充输入、按钮、卡片、列表或状态区。`
	      });
	    }
    const primaryActions = children.filter((node) => node.type === "button");
	    if (primaryActions.length === 0) {
	      issues.push({
	        code: "missing_region",
	        level: "blocking",
	        message: `画板「${frame.name}」没有明确主操作按钮，用户可能不知道下一步做什么。`,
	        region: "ActionBar",
	        suggestedFix: { tool: "layout.apply_intent_patch", input: { pageId: page.id, targetNodeId: frame.id, operation: "add_required_region", region: "ActionBar", spacing: 16, userRequest, pageMode: inferPageModeFromReviewRequest(userRequest), businessEntity: inferBusinessEntitiesFromText(userRequest)[0] ?? "" } }
	      });
	    }
    const badButtons = primaryActions.filter((node) => !isButtonTextCentered(node));
	    if (badButtons.length > 0) {
	      issues.push({
	        code: "text_overflow",
	        level: "blocking",
	        message: `画板「${frame.name}」存在 ${badButtons.length} 个按钮文字没有居中或按钮高度不足。`,
	        targetNodeIds: badButtons.map((node) => node.id),
	        suggestedFix: { tool: "layout.apply_intent_patch", input: { pageId: page.id, targetNodeId: frame.id, operation: "normalize_action_bar", spacing: 16 } }
	      });
    }
    const textOverflows = children.filter((node) => node.type === "text" && mayTextOverflow(node));
	    if (textOverflows.length > 0) {
	      issues.push({
	        code: "text_overflow",
	        level: "blocking",
	        message: `画板「${frame.name}」存在 ${textOverflows.length} 个文本节点高度/宽度不足，可能出现遮挡、换行挤压或显示不全。`,
	        targetNodeIds: textOverflows.map((node) => node.id),
	        suggestedFix: { tool: "layout.apply_intent_patch", input: { pageId: page.id, targetNodeId: frame.id, operation: "expand_parent", spacing: 20 } }
	      });
    }
    const verticalTextNodes = children.filter((node) => node.type === "text" && isLikelyVerticalText(node));
	    if (verticalTextNodes.length > 0) {
	      issues.push({
	        code: "text_overflow",
	        level: "blocking",
	        message: `画板「${frame.name}」存在 ${verticalTextNodes.length} 个疑似竖排文本节点，说明文本宽度过窄或被挤到右侧。`,
	        targetNodeIds: verticalTextNodes.map((node) => node.id),
	        suggestedFix: { tool: "layout.apply_intent_patch", input: { pageId: page.id, targetNodeId: frame.id, operation: "fix_vertical_text", spacing: 20 } }
	      });
    }
    const childOverflows = children.filter((node) => nodeOverflowsParent(node, page.nodes));
	    if (childOverflows.length > 0) {
	      issues.push({
	        code: "out_of_artboard",
	        level: "blocking",
	        message: `画板「${frame.name}」存在 ${childOverflows.length} 个节点超出父容器，可能出现内容被卡片裁剪或右侧越界。`,
	        targetNodeIds: childOverflows.map((node) => node.id),
	        suggestedFix: { tool: "layout.apply_intent_patch", input: { pageId: page.id, targetNodeId: frame.id, operation: "expand_parent", spacing: 20 } }
	      });
    }
    const requestedDetail = /详情|明细|查看|资料|profile|detail/i.test(userRequest);
    const requestedList = /列表|表格|清单|table|list|搜索|筛选|查询/i.test(userRequest);
    const irrelevantListSections = requestedDetail && !requestedList
      ? children.filter((node) => isTableLikeNode(node) || /筛选|搜索|查询|分页|filter|search|pagination/i.test(`${node.name} ${node.text ?? ""}`))
      : [];
	    if (irrelevantListSections.length > 0) {
	      issues.push({
	        code: "wrong_page_mode",
	        level: "blocking",
	        message: `画板「${frame.name}」疑似详情页混入 ${irrelevantListSections.length} 个列表/筛选结构，应移除或改为详情布局。`,
	        targetNodeIds: irrelevantListSections.map((node) => node.id),
	        suggestedFix: { tool: "layout.apply_intent_patch", input: { pageId: page.id, targetNodeId: frame.id, operation: "remove_irrelevant_section", spacing: 20, userRequest } }
	      });
    }
  });
  return issues;
}

function summarizeDesignReviewIssues(issues: DesignReviewIssue[]) {
  const counts = issues.reduce<Record<string, number>>((result, issue) => {
    result[issue.code] = (result[issue.code] ?? 0) + 1;
    return result;
  }, {});
  return {
    counts,
    blockingCodes: Array.from(new Set(issues.filter((issue) => issue.level === "blocking").map((issue) => issue.code))),
    patchableCount: issues.filter((issue) => Boolean(issue.suggestedFix)).length
  };
}

function inferPageModeFromReviewRequest(userRequest: string) {
  if (/详情|明细|查看|资料|detail/i.test(userRequest)) return "detail";
  if (/新增|编辑|创建|表单|录入|form/i.test(userRequest)) return "form";
  if (/列表|表格|管理|查询|搜索|筛选|collection|list|table/i.test(userRequest)) return "collection";
  if (/流程|步骤|进度|timeline|steps/i.test(userRequest)) return "flow";
  return "unknown";
}

function inferRequiredRegionsForReview(userRequest: string) {
  const mode = inferPageModeFromReviewRequest(userRequest);
  if (mode === "detail") return ["Header", "DescriptionList", "ActionBar"];
  if (mode === "form") return ["Form", "ActionBar"];
  if (mode === "collection") return /搜索|筛选|查询|filter|search|query/i.test(userRequest)
    ? ["Header", "FilterBar", "Table", "Pagination"]
    : ["Header", "Table", "Pagination"];
  if (mode === "flow") return ["Steps", "ActionBar"];
  return ["Header", "Content", "ActionBar"];
}

function isButtonTextCentered(node: WorkspaceDesignNode) {
  return node.height >= 40 && node.textAlign === "center" && Math.abs((node.lineHeight ?? node.height) - node.height) <= 4;
}

function scopeNodesForReview(nodes: WorkspaceDesignNode[], generatedFrameIds: string[]) {
  if (generatedFrameIds.length === 0) return nodes;
  const scopeIds = new Set<string>();
  generatedFrameIds.forEach((frameId) => {
    scopeIds.add(frameId);
    collectDescendantNodeIds(nodes, frameId).forEach((id) => scopeIds.add(id));
  });
  return nodes.filter((node) => scopeIds.has(node.id) || generatedFrameIds.some((frameId) => {
    const frame = nodes.find((item) => item.id === frameId);
    return frame ? isNodeInsideTarget(node, frame) : false;
  }));
}

function mayTextOverflow(node: WorkspaceDesignNode) {
  const text = String(node.text ?? "").trim();
  if (!text) return false;
  const fontSize = node.fontSize || 14;
  const charsPerLine = Math.max(4, Math.floor(node.width / Math.max(8, fontSize)));
  const lines = Math.ceil(text.length / charsPerLine);
  const requiredHeight = lines * fontSize * 1.35;
  return requiredHeight > node.height + 2;
}

function isLikelyVerticalText(node: WorkspaceDesignNode) {
  const text = String(node.text ?? "").trim();
  if (text.length < 2) return false;
  const fontSize = node.fontSize || 14;
  return /[\u4e00-\u9fa5]/.test(text) && node.width < fontSize * 2.4;
}

function nodeOverflowsParent(node: WorkspaceDesignNode, nodes: WorkspaceDesignNode[]) {
  if (!node.parentId) return false;
  const parent = nodes.find((item) => item.id === node.parentId);
  if (!parent || parent.type === "frame") return false;
  const tolerance = 2;
  return node.x < parent.x - tolerance
    || node.y < parent.y - tolerance
    || node.x + node.width > parent.x + parent.width + tolerance
    || node.y + node.height > parent.y + parent.height + tolerance;
}

function getDesignReviewRules() {
  return {
    pc: {
      designWidth: 1920,
      artboardWidth: 1440,
      references: ["Ant Design Pro", "Tailwind SaaS Dashboard"],
      layout: "顶部导航 / 左侧导航 / 内容区清晰分层，表格和表单不可互相遮挡。",
      density: "筛选区、表格、卡片、操作栏使用 16-24px 间距，主操作在首屏可见。"
    },
    mobile: {
      designWidth: 750,
      logicalWidth: 375,
      references: ["微信小程序官方组件", "iOS/Android 原生表单"],
      layout: "单列为主，底部主操作避开安全区，表单输入和错误反馈同屏可见。",
      density: "左右安全边距 16-24px，按钮高度 44-52px，列表使用卡片/行容器，不使用 PC 表格。"
    },
    industries: {
      ecommerce: "电商/交易类页面必须覆盖商品/订单/支付/状态/操作反馈，不能用无关业务对象。",
      iot: "IoT 页面必须覆盖设备状态、指标、告警、趋势和远程操作风险提示。",
      account: "账号体系页面必须覆盖安全、隐私、异常兜底、验证码倒计时、实名/地址等关键状态。"
    },
    common: [
      "新增画板顶对齐，横向间距默认 40px。",
      "所有元素必须在所属画板内，禁止被剪切、遮挡或不可点击。",
      "每个页面必须有页面标题、核心内容区、主行动和异常/空状态考虑。",
      "涉及账号、实名、地址等敏感能力时，需要隐私、安全和失败重试说明。",
      "生成 UI 必须是颗粒化可编辑节点，不能用一张大图或一个大表格假装完成。"
    ]
  };
}

function analyzePageSemantics(page: WorkspaceDesignPage, userRequest: string) {
  const bounds = getPageBounds(page);
  const tableNodes = page.nodes.filter(isTableLikeNode).sort((a, b) => (b.width * b.height) - (a.width * a.height));
  const filterNodes = page.nodes.filter(isFilterLikeNode).sort((a, b) => a.y - b.y);
  const entity = inferBusinessEntity(page, userRequest);
  const mainRegions = [
    ...findHeaderRegions(page),
    ...filterNodes.map((node) => ({
      type: "filter_bar" as const,
      nodeId: node.id,
      name: node.name,
      exists: true,
      bbox: nodeToBbox(node)
    })),
    ...tableNodes.map((node) => ({
      type: "table" as const,
      nodeId: node.id,
      name: node.name,
      businessEntity: entity,
      bbox: nodeToBbox(node),
      columns: parseTableColumnsFromNode(node)
    }))
  ];
  const primaryTable = tableNodes[0];
  return {
    pageType: tableNodes.length > 0 ? `${entity}_list` : "unknown_page",
    bounds,
    mainRegions,
    recommendedInsertionPoints: primaryTable ? [{
      purpose: "add_search_conditions",
      position: "above_table",
      parentNodeId: primaryTable.parentId,
      beforeNodeId: primaryTable.id,
      businessEntity: entity,
      reason: "列表页搜索条件通常放在主表格上方。"
    }] : []
  };
}

function isTableLikeNode(node: WorkspaceDesignNode) {
  const text = `${node.type} ${node.name} ${node.text ?? ""}`.toLowerCase();
  return node.type === "table" || /table|列表|表格|grid|list/.test(text);
}

function isFilterLikeNode(node: WorkspaceDesignNode) {
  const text = `${node.type} ${node.name} ${node.text ?? ""}`.toLowerCase();
  return /filter|search|query|筛选|搜索|查询|条件/.test(text) && node.type !== "table";
}

function findHeaderRegions(page: WorkspaceDesignPage) {
  return page.nodes
    .filter((node) => /header|顶部|标题栏|导航/.test(`${node.name} ${node.text ?? ""}`.toLowerCase()) || node.y <= getPageBounds(page).y + 90)
    .slice(0, 3)
    .map((node) => ({
      type: "header" as const,
      nodeId: node.id,
      name: node.name,
      bbox: nodeToBbox(node)
    }));
}

function nodeToBbox(node: WorkspaceDesignNode) {
  return { x: node.x, y: node.y, w: node.width, h: node.height };
}

function inferBusinessEntity(page: WorkspaceDesignPage, userRequest: string) {
  const text = `${page.name} ${userRequest} ${page.nodes.slice(0, 80).map((node) => `${node.name} ${node.text ?? ""}`).join(" ")}`;
  if (/商品|product|sku|库存|价格/.test(text)) return "商品";
  if (/订单|order|支付|金额/.test(text)) return "订单";
  if (/用户|会员|客户|user|customer/.test(text)) return "用户";
  if (/任务|项目|进度|task|project/.test(text)) return "任务";
  return "业务对象";
}

function parseTableColumnsFromNode(node: WorkspaceDesignNode) {
  const serialized = /^columns:(.+)$/i.exec(node.text?.trim() ?? "")?.[1];
  if (serialized) return serialized.split("|").map((item) => item.trim()).filter(Boolean);
  const text = `${node.name} ${node.text ?? ""}`;
  const known = ["商品名称", "价格", "库存", "状态", "操作", "名称", "创建时间", "负责人"];
  return known.filter((column) => text.includes(column));
}

function buildRecommendedFilters(entity: string, columns: string[]) {
  const columnText = columns.join(" ");
  if (entity === "商品" || /商品|价格|库存|状态/.test(columnText)) {
    return [
      { label: "商品名称", component: "input", placeholder: "请输入商品名称" },
      { label: "商品分类", component: "select", placeholder: "请选择分类" },
      { label: "商品状态", component: "select", options: ["上架", "下架"] }
    ];
  }
  if (entity === "订单") {
    return [
      { label: "订单编号", component: "input", placeholder: "请输入订单编号" },
      { label: "订单状态", component: "select", options: ["待处理", "已完成", "已取消"] },
      { label: "创建时间", component: "input", placeholder: "请选择时间范围" }
    ];
  }
  return [
    { label: "名称", component: "input", placeholder: "请输入名称" },
    { label: "状态", component: "select", options: ["启用", "停用"] }
  ];
}

function parseFilterInputs(value: unknown, fallback: Array<Record<string, unknown>>) {
  if (!Array.isArray(value)) return fallback;
  const filters = value
    .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => Boolean(item?.label));
  return filters.length > 0 ? filters : fallback;
}

function createFilterBarNodes(input: {
  x: number;
  y: number;
  width: number;
  height: number;
  filters: Array<Record<string, unknown>>;
}) {
  const containerId = createDesignId("filter");
  const fieldWidth = Math.max(160, Math.floor((input.width - 240) / Math.max(input.filters.length, 1)));
  const nodes: WorkspaceDesignNode[] = [
    createDesignNode("container", {
      id: containerId,
      name: "搜索条件区域",
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      fill: "#ffffff",
      stroke: "#eaecf0",
      radius: 12
    })
  ];
  input.filters.forEach((filter, index) => {
    const label = String(filter.label ?? `条件${index + 1}`);
    const fieldX = input.x + 20 + index * (fieldWidth + 16);
    nodes.push(createDesignNode("text", {
      parentId: containerId,
      name: `${label}标签`,
      x: fieldX,
      y: input.y + 18,
      width: fieldWidth,
      height: 20,
      text: label,
      fontSize: 13,
      textColor: "#344054"
    }));
    nodes.push(createDesignNode("input", {
      parentId: containerId,
      name: `${label}输入`,
      x: fieldX,
      y: input.y + 44,
      width: fieldWidth,
      height: 36,
      text: String(filter.placeholder ?? `请选择${label}`),
      fill: "#ffffff",
      stroke: "#d0d5dd",
      radius: 8
    }));
  });
  nodes.push(
    createDesignNode("button", {
      parentId: containerId,
      name: "查询按钮",
      x: input.x + input.width - 184,
      y: input.y + 44,
      width: 76,
      height: 36,
      text: "查询",
      radius: 8
    }),
    createDesignNode("button", {
      parentId: containerId,
      name: "重置按钮",
      x: input.x + input.width - 96,
      y: input.y + 44,
      width: 76,
      height: 36,
      text: "重置",
      fill: "#ffffff",
      stroke: "#d0d5dd",
      textColor: "#344054",
      radius: 8
    })
  );
  return nodes;
}

function resolveIntentPatchScope(page: WorkspaceDesignPage, input: Record<string, unknown>) {
  const targetNodeId = typeof input.targetNodeId === "string" ? input.targetNodeId : "";
  if (targetNodeId) return page.nodes.find((node) => node.id === targetNodeId);
  const semantic = String(input.semantic ?? "");
  if (semantic) {
    const structure = analyzePageSemantics(page, String(input.userRequest ?? ""));
    const region = structure.mainRegions.find((item) => item.type === semantic || semanticMatchesRegion(semantic, item.type));
    if (region) return page.nodes.find((node) => node.id === region.nodeId);
    if (/content|main/i.test(semantic)) return findMainContentCandidates(page)[0];
    if (/form/i.test(semantic)) return findFormLikeNode(page, input);
  }
  return undefined;
}

function semanticMatchesRegion(semantic: string, regionType: string) {
  if (semantic === regionType) return true;
  if (semantic === "filter" && regionType === "filter_bar") return true;
  if (semantic === "content" && regionType === "table") return true;
  return false;
}

function reflowSemanticSections(nodes: WorkspaceDesignNode[], spacing: number, scopeNodeId?: string) {
  const readableNodes = nodes.map((node) => node.type === "text" ? expandTextNodeForReadability(node) : node);
  const scoped = scopeNodeId ? readableNodes.find((node) => node.id === scopeNodeId) : undefined;
  const targetFrameIds = scoped?.type === "frame"
    ? [scoped.id]
    : scoped
      ? [findContainingFrameId(readableNodes, scoped)].filter((id): id is string => Boolean(id))
      : readableNodes.filter((node) => node.type === "frame").map((node) => node.id);
  let nextNodes = readableNodes;
  targetFrameIds.forEach((frameId) => {
    nextNodes = reflowFrameSections(nextNodes, frameId, spacing, scoped && scoped.type !== "frame" ? scoped.id : undefined);
  });
  return reflowOverlappingNodes(nextNodes, spacing);
}

function reflowFrameSections(nodes: WorkspaceDesignNode[], frameId: string, spacing: number, pinnedSectionId?: string) {
  const frame = nodes.find((node) => node.id === frameId);
  if (!frame) return nodes;
  const modules = collectFrameLayoutModules(nodes, frame, pinnedSectionId);
  if (modules.length < 2) return nodes;
  const sorted = modules.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const shifts = new Map<string, number>();
  let cursorY = Math.max(frame.y + spacing, sorted[0].bounds.y);
  sorted.forEach((module, index) => {
    const minY = index === 0 ? module.bounds.y : cursorY + spacing;
    const dy = Math.max(0, Math.ceil(minY - module.bounds.y));
    if (dy > 0) shifts.set(module.root.id, dy);
    cursorY = module.bounds.y + dy + module.bounds.height;
  });
  return shifts.size > 0 ? translateCanvasModulesAndChildren(nodes, shifts) : nodes;
}

function collectFrameLayoutModules(nodes: WorkspaceDesignNode[], frame: WorkspaceDesignNode, pinnedSectionId?: string) {
  const descendants = nodes.filter((node) => node.id !== frame.id && (node.parentId === frame.id || isNodeInsideTarget(node, frame)));
  const direct = descendants
    .filter((node) => node.parentId === frame.id || !node.parentId)
    .filter((node) => shouldReflowAsIntentSection(node, frame) || node.id === pinnedSectionId);
  const roots = direct.length > 0 ? direct : descendants.filter((node) => shouldReflowAsIntentSection(node, frame));
  return roots.map((root) => {
    const ids = new Set([root.id, ...collectDescendantNodeIds(nodes, root.id)]);
    const owned = nodes.filter((node) => ids.has(node.id));
    return { root, bounds: getNodesBounds(owned.length > 0 ? owned : [root]) };
  });
}

function shouldReflowAsIntentSection(node: WorkspaceDesignNode, frame: WorkspaceDesignNode) {
  if (node.visible === false || node.type === "frame") return false;
  const label = `${node.name} ${node.text ?? ""}`;
  if (/侧边|菜单|Sidebar/i.test(label)) return false;
  if (node.height >= frame.height * 0.82) return false;
  if (/顶部|导航|Toolbar|Header|标题|筛选|搜索|查询|表格|列表|内容|表单|分页|底部|Action/i.test(label)) return true;
  return node.type === "container" || node.type === "card" || node.type === "table";
}

function applySemanticGap(nodes: WorkspaceDesignNode[], targetNodeId: string, spacing: number) {
  const target = nodes.find((node) => node.id === targetNodeId);
  if (!target) return nodes;
  const frameId = findContainingFrameId(nodes, target);
  const frame = frameId ? nodes.find((node) => node.id === frameId) : undefined;
  if (!frame) return nodes;
  const modules = collectFrameLayoutModules(nodes, frame).sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const targetModule = modules.find((module) => module.root.id === targetNodeId || module.root.id === target.parentId || isNodeInsideTarget(target, module.root));
  if (!targetModule) return nodes;
  const desiredY = targetModule.bounds.y + targetModule.bounds.height + spacing;
  const shifts = new Map<string, number>();
  modules.forEach((module) => {
    if (module.bounds.y <= targetModule.bounds.y) return;
    const dy = Math.max(0, desiredY - module.bounds.y);
    if (dy > 0) shifts.set(module.root.id, dy);
  });
  return shifts.size > 0 ? translateCanvasModulesAndChildren(nodes, shifts) : nodes;
}

function translateSectionWithDescendants(nodes: WorkspaceDesignNode[], rootId: string, dx: number, dy: number) {
  const ids = new Set([rootId, ...collectDescendantNodeIds(nodes, rootId)]);
  return nodes.map((node) => ids.has(node.id) ? translateDesignNode(node, dx, dy) : node);
}

function findContainingFrameId(nodes: WorkspaceDesignNode[], node: WorkspaceDesignNode) {
  if (node.type === "frame") return node.id;
  if (node.parentId) {
    const parent = nodes.find((candidate) => candidate.id === node.parentId);
    if (parent?.type === "frame") return parent.id;
    if (parent) return findContainingFrameId(nodes, parent);
  }
  return nodes.find((candidate) => candidate.type === "frame" && isNodeInsideTarget(node, candidate))?.id;
}

function findPrimaryTableNode(page: WorkspaceDesignPage, input: Record<string, unknown>) {
  const target = resolveIntentPatchScope(page, { ...input, semantic: input.semantic ?? "table" });
  if (target && isTableLikeNode(target)) return target;
  return page.nodes.filter(isTableLikeNode).sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

function findFormLikeNode(page: WorkspaceDesignPage, input: Record<string, unknown>) {
  const targetNodeId = typeof input.targetNodeId === "string" ? input.targetNodeId : "";
  if (targetNodeId) return page.nodes.find((node) => node.id === targetNodeId);
  return page.nodes
    .filter((node) => /表单|Form|输入|字段|详情|内容区|Panel|Card/i.test(`${node.name} ${node.text ?? ""}`) && (node.type === "card" || node.type === "container" || node.type === "frame"))
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

function addColumnToTableRegion(nodes: WorkspaceDesignNode[], table: WorkspaceDesignNode, label: string) {
  if (table.type === "table") {
    const columns = parseTableColumnsFromNode(table);
    const nextColumns = Array.from(new Set([...columns, label]));
    return nodes.map((node) => node.id === table.id ? { ...node, text: `columns:${nextColumns.join("|")}` } : node);
  }
  const descendants = nodes.filter((node) => node.parentId === table.id || isNodeInsideTarget(node, table));
  const headerTexts = descendants.filter((node) => node.type === "text" && /表头|列|名称|状态|时间|操作|编号|负责人/.test(`${node.name} ${node.text ?? ""}`));
  const rightMost = headerTexts.sort((a, b) => (b.x + b.width) - (a.x + a.width))[0];
  const x = rightMost ? rightMost.x + Math.min(rightMost.width + 8, 140) : table.x + table.width - 140;
  const y = rightMost ? rightMost.y : table.y + 16;
  const parentId = rightMost?.parentId ?? table.id;
  const newHeader = createDesignNode("text", {
    parentId,
    name: `${label}表头`,
    x: Math.min(x, table.x + table.width - 120),
    y,
    width: 104,
    height: 20,
    text: label,
    fontSize: 13,
    textColor: "#475467"
  });
  return [...nodes, newHeader];
}

function addFieldToFormRegion(nodes: WorkspaceDesignNode[], form: WorkspaceDesignNode, label: string, spacing: number) {
  const descendants = nodes.filter((node) => node.parentId === form.id || isNodeInsideTarget(node, form));
  const bounds = getNodesBounds(descendants.length > 0 ? descendants : [form]);
  const y = Math.max(form.y + spacing, bounds.y + bounds.height + spacing);
  const labelNode = createDesignNode("text", {
    parentId: form.id,
    name: `${label}标签`,
    x: form.x + 24,
    y,
    width: Math.min(120, form.width - 48),
    height: 22,
    text: label,
    fontSize: 14,
    textColor: "#344054"
  });
  const inputNode = createDesignNode("input", {
    parentId: form.id,
    name: `${label}输入`,
    x: form.width > 560 ? form.x + 152 : form.x + 24,
    y: form.width > 560 ? y - 7 : y + 28,
    width: form.width > 560 ? Math.max(180, form.width - 184) : Math.max(180, form.width - 48),
    height: 40,
    text: `请输入${label}`,
    fill: "#ffffff",
    stroke: "#d0d5dd",
    radius: 8
  });
  return expandFramesToFitChildren([...nodes, labelNode, inputNode], spacing);
}

function fixVerticalTextNodes(nodes: WorkspaceDesignNode[], spacing: number, scopeNodeId?: string) {
  const scopedNodes = nodes.filter((node) => isNodeInPatchScope(nodes, node, scopeNodeId));
  const verticalIds = new Set(scopedNodes.filter((node) => node.type === "text" && isLikelyVerticalText(node)).map((node) => node.id));
  if (verticalIds.size === 0) return nodes;
  const nextNodes = nodes.map((node) => {
    if (!verticalIds.has(node.id)) return node;
    const parent = findLayoutParentNode(nodes, node);
    const frame = findContainingFrameId(nodes, node);
    const frameNode = frame ? nodes.find((item) => item.id === frame) : undefined;
    const container = parent ?? frameNode;
    const fontSize = node.fontSize || 14;
    const text = String(node.text ?? "").trim();
    const desiredWidth = Math.max(node.width, Math.min(container ? container.width - spacing * 2 : 220, text.length * fontSize * 1.1, 280), fontSize * 4);
    const desiredHeight = Math.max(node.height, Math.ceil(fontSize * 1.45));
    const minX = container ? container.x + spacing : node.x;
    const maxX = container ? container.x + container.width - desiredWidth - spacing : node.x;
    return {
      ...node,
      x: Math.round(clampNumber(node.x, minX, maxX)),
      width: Math.round(desiredWidth),
      height: desiredHeight,
      lineHeight: Math.max(desiredHeight, Math.round(fontSize * 1.45))
    };
  });
  return expandOverflowingParents(reflowSemanticSections(nextNodes, spacing, scopeNodeId), spacing, scopeNodeId);
}

function expandOverflowingParents(nodes: WorkspaceDesignNode[], spacing: number, scopeNodeId?: string) {
  let nextNodes = [...nodes];
  const containers = nextNodes
    .filter((node) => isNodeInPatchScope(nextNodes, node, scopeNodeId))
    .filter((node) => node.type === "frame" || node.type === "container" || node.type === "card")
    .sort((a, b) => (b.parentId ? 1 : 0) - (a.parentId ? 1 : 0) || b.width * b.height - a.width * a.height);
  containers.forEach((container) => {
    const children = nextNodes.filter((node) => node.id !== container.id && node.parentId === container.id);
    if (children.length === 0) return;
    const bounds = getNodesBounds(children);
    const parentFrameId = findContainingFrameId(nextNodes, container);
    const frame = parentFrameId ? nextNodes.find((node) => node.id === parentFrameId) : undefined;
    const maxWidth = frame && frame.id !== container.id ? Math.max(1, frame.x + frame.width - container.x - spacing) : Number.POSITIVE_INFINITY;
    const nextWidth = Math.min(Math.max(container.width, bounds.x + bounds.width - container.x + spacing), maxWidth);
    const nextHeight = Math.max(container.height, bounds.y + bounds.height - container.y + spacing);
    if (nextWidth === container.width && nextHeight === container.height) return;
    nextNodes = nextNodes.map((node) => node.id === container.id ? {
      ...node,
      width: Math.round(nextWidth),
      height: Math.round(nextHeight)
    } : node);
  });
  return expandFramesToFitChildren(reflowSemanticSections(nextNodes, spacing, scopeNodeId), spacing);
}

function convertTablesToCardLists(nodes: WorkspaceDesignNode[], spacing: number, scopeNodeId?: string) {
  let nextNodes = [...nodes];
  const tables = nextNodes
    .filter((node) => isNodeInPatchScope(nextNodes, node, scopeNodeId) && isTableLikeNode(node))
    .filter((node) => node.type !== "frame" && node.id !== scopeNodeId)
    .filter((node) => node.type === "table" || /表格|列表|table|grid/i.test(`${node.name} ${node.text ?? ""}`));
  tables.forEach((table) => {
    if (!nextNodes.some((node) => node.id === table.id)) return;
    const parentId = table.parentId;
    const frameId = findContainingFrameId(nextNodes, table);
    const frame = frameId ? nextNodes.find((node) => node.id === frameId) : undefined;
    const cardWidth = Math.max(220, Math.min(table.width, (frame?.width ?? table.width) - spacing * 2));
    const columns = parseTableColumnsFromNode(table);
    const labels = columns.length > 0 ? columns.slice(0, 4) : ["标题", "状态", "说明"];
    const descendants = collectDescendantNodeIds(nextNodes, table.id);
    const removeIds = new Set([table.id, ...descendants]);
    const cards = Array.from({ length: 3 }).flatMap((_, rowIndex) => {
      const cardY = table.y + rowIndex * 104;
      const card = createDesignNode("card", {
        parentId,
        name: `${table.name || "列表"}卡片${rowIndex + 1}`,
        x: table.x,
        y: cardY,
        width: cardWidth,
        height: 88,
        fill: "#ffffff",
        stroke: "#e6eaf2",
        radius: 12
      });
      const title = createDesignNode("text", {
        parentId: card.id,
        name: `${card.name}标题`,
        x: card.x + 16,
        y: card.y + 14,
        width: card.width - 32,
        height: 22,
        text: labels[0] ? `${labels[0]} ${rowIndex + 1}` : `项目 ${rowIndex + 1}`,
        fontSize: 15,
        fontWeight: 600,
        textColor: "#111827"
      });
      const meta = createDesignNode("text", {
        parentId: card.id,
        name: `${card.name}信息`,
        x: card.x + 16,
        y: card.y + 44,
        width: card.width - 32,
        height: 22,
        text: labels.slice(1).join(" / ") || "详情信息",
        fontSize: 13,
        textColor: "#667085"
      });
      return [card, title, meta];
    });
    nextNodes = nextNodes.filter((node) => !removeIds.has(node.id)).concat(cards);
  });
  return expandOverflowingParents(reflowSemanticSections(nextNodes, spacing, scopeNodeId), spacing, scopeNodeId);
}

function normalizeActionBars(nodes: WorkspaceDesignNode[], spacing: number, scopeNodeId?: string) {
  let nextNodes = nodes.map((node) => {
    if (node.type !== "button" || !isNodeInPatchScope(nodes, node, scopeNodeId)) return node;
    return {
      ...node,
      height: Math.max(44, node.height),
      textAlign: "center" as const,
      textVerticalAlign: "middle" as const,
      lineHeight: Math.max(44, node.height)
    };
  });
  const frames = nextNodes.filter((node) => node.type === "frame" && isNodeInPatchScope(nextNodes, node, scopeNodeId));
  frames.forEach((frame) => {
    const buttons = nextNodes
      .filter((node) => node.type === "button" && (node.parentId === frame.id || isNodeInsideTarget(node, frame)))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (buttons.length === 0) return;
    const actionRow = buttons.filter((button) => button.y > frame.y + frame.height * 0.72);
    const rowButtons = actionRow.length > 0 ? actionRow : buttons.slice(-Math.min(2, buttons.length));
    const gap = spacing;
    const width = Math.floor((frame.width - spacing * 2 - gap * (rowButtons.length - 1)) / rowButtons.length);
    const y = frame.width <= 480 ? frame.y + frame.height - 72 : Math.min(...rowButtons.map((button) => button.y));
    nextNodes = nextNodes.map((node) => {
      const index = rowButtons.findIndex((button) => button.id === node.id);
      if (index < 0) return node;
      return {
        ...node,
        x: Math.round(frame.x + spacing + index * (width + gap)),
        y: Math.round(y),
        width,
        height: 44,
        textAlign: "center" as const,
        textVerticalAlign: "middle" as const,
        lineHeight: 44
      };
    });
  });
  return expandOverflowingParents(nextNodes, spacing, scopeNodeId);
}

function removeIrrelevantSections(nodes: WorkspaceDesignNode[], input: Record<string, unknown>, userRequest: string, scopeNodeId?: string) {
  const explicitScope = scopeNodeId ? nodes.find((node) => node.id === scopeNodeId) : undefined;
  const requestedDetail = /详情|明细|查看|资料|profile|detail/i.test(userRequest);
  const keepList = /列表|表格|清单|table|list|搜索|筛选|查询/i.test(userRequest);
  const scopedNodes = explicitScope
    ? nodes.filter((node) => node.id !== explicitScope.id && isNodeInPatchScope(nodes, node, explicitScope.id))
    : nodes;
  const candidates = scopedNodes.filter((node) => {
    if (!requestedDetail || keepList) return false;
    const label = `${node.name} ${node.text ?? ""}`;
    return isTableLikeNode(node) || /筛选|搜索|查询|分页|filter|search|pagination/i.test(label);
  });
  const removeIds = new Set<string>();
  candidates.forEach((node) => {
    removeIds.add(node.id);
    collectDescendantNodeIds(nodes, node.id).forEach((id) => removeIds.add(id));
  });
  const preserved = nodes.filter((node) => !removeIds.has(node.id));
  return reflowSemanticSections(preserved, numberOr(input.spacing, 16));
}

function changeLayoutByScope(nodes: WorkspaceDesignNode[], input: Record<string, unknown>, spacing: number, scopeNodeId?: string) {
  const scope = scopeNodeId ? nodes.find((node) => node.id === scopeNodeId) : undefined;
  if (!scope) return reflowSemanticSections(nodes, spacing);
  const children = nodes
    .filter((node) => node.parentId === scope.id)
    .filter((node) => node.visible !== false)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (children.length === 0) return reflowSemanticSections(nodes, spacing, scope.id);
  const layout = String(input.layout ?? "stack");
  const padding = spacing;
  let cursorY = scope.y + padding;
  const nextById = new Map<string, WorkspaceDesignNode>();
  children.forEach((child) => {
    const width = /two_column/i.test(layout)
      ? Math.max(120, Math.floor((scope.width - padding * 3) / 2))
      : Math.max(120, scope.width - padding * 2);
    const columnIndex = /two_column/i.test(layout) ? children.indexOf(child) % 2 : 0;
    const rowIndex = /two_column/i.test(layout) ? Math.floor(children.indexOf(child) / 2) : children.indexOf(child);
    const x = scope.x + padding + columnIndex * (width + padding);
    const y = /two_column/i.test(layout) ? scope.y + padding + rowIndex * (child.height + padding) : cursorY;
    nextById.set(child.id, { ...child, x: Math.round(x), y: Math.round(y), width: Math.round(width) });
    if (!/two_column/i.test(layout)) cursorY += child.height + spacing;
  });
  const shifted = nodes.map((node) => nextById.get(node.id) ?? node);
  return expandOverflowingParents(reflowSemanticSections(shifted, spacing, scope.id), spacing, scope.id);
}

function isNodeInPatchScope(nodes: WorkspaceDesignNode[], node: WorkspaceDesignNode, scopeNodeId?: string) {
  if (!scopeNodeId) return true;
  if (node.id === scopeNodeId) return true;
  const scope = nodes.find((item) => item.id === scopeNodeId);
  if (!scope) return true;
  if (node.parentId === scopeNodeId) return true;
  return collectDescendantNodeIds(nodes, scopeNodeId).includes(node.id) || isNodeInsideTarget(node, scope);
}

function findLayoutParentNode(nodes: WorkspaceDesignNode[], node: WorkspaceDesignNode) {
  if (node.parentId) return nodes.find((candidate) => candidate.id === node.parentId);
  return nodes
    .filter((candidate) => candidate.id !== node.id && (candidate.type === "card" || candidate.type === "container" || candidate.type === "frame"))
    .filter((candidate) => isNodeInsideTarget(node, candidate))
    .sort((a, b) => a.width * a.height - b.width * b.height)[0];
}

function readPatchRegions(input: Record<string, unknown>) {
  const values = Array.isArray(input.regions)
    ? input.regions
    : input.region !== undefined
      ? [input.region]
      : [];
  return values.map(String).map((item) => item.trim()).filter(Boolean);
}

function addRequiredRegionsToPage(nodes: WorkspaceDesignNode[], regions: string[], spacing: number, scopeNodeId?: string, input: Record<string, unknown> = {}) {
  let nextNodes = [...nodes];
  let createdCount = 0;
  let alreadySatisfiedCount = 0;
  const skippedRegions: string[] = [];
  const frames = getPatchTargetFrames(nextNodes, scopeNodeId);
  frames.forEach((frame) => {
    const existingRegions = new Set(collectNodeRegions(nextNodes.filter((node) => node.id === frame.id || isNodeInsideTarget(node, frame))));
    const missing = regions.filter((region) => !existingRegions.has(normalizeIntentRegionName(region)));
    if (missing.length === 0) {
      alreadySatisfiedCount += regions.length;
      return;
    }
    let cursorY = getFrameContentBottom(nextNodes, frame, spacing);
    const context = createRequiredRegionContext(input, frame);
    missing.forEach((region) => {
      const regionNodes = createRequiredRegionNodes(region, frame, cursorY, spacing, context);
      if (regionNodes.length === 0) {
        skippedRegions.push(region);
        return;
      }
      nextNodes.push(...regionNodes);
      createdCount += regionNodes.length;
      cursorY = getNodesBounds(regionNodes).y + getNodesBounds(regionNodes).height + spacing;
    });
  });
  return {
    nodes: expandOverflowingParents(reflowSemanticSections(nextNodes, spacing, scopeNodeId), spacing, scopeNodeId),
    createdCount,
    alreadySatisfiedCount,
    skippedRegions
  };
}

function removeRegionsFromPage(nodes: WorkspaceDesignNode[], regions: string[], spacing: number, scopeNodeId?: string) {
  const targetRegions = new Set(regions.map(normalizeIntentRegionName).filter(Boolean));
  if (targetRegions.size === 0) return nodes;
  const scopedNodes = nodes.filter((node) => isNodeInPatchScope(nodes, node, scopeNodeId));
  const removeIds = new Set<string>();
  scopedNodes.forEach((node) => {
    if (node.type === "frame") return;
    const nodeRegions = collectNodeRegions([node]);
    if (!nodeRegions.some((region) => targetRegions.has(region))) return;
    removeIds.add(node.id);
    collectDescendantNodeIds(nodes, node.id).forEach((id) => removeIds.add(id));
  });
  if (removeIds.size === 0) return nodes;
  return reflowSemanticSections(nodes.filter((node) => !removeIds.has(node.id)), spacing, scopeNodeId);
}

function getPatchTargetFrames(nodes: WorkspaceDesignNode[], scopeNodeId?: string) {
  const scope = scopeNodeId ? nodes.find((node) => node.id === scopeNodeId) : undefined;
  if (scope?.type === "frame") return [scope];
  const frameId = scope ? findContainingFrameId(nodes, scope) : undefined;
  const frame = frameId ? nodes.find((node) => node.id === frameId) : undefined;
  if (frame) return [frame];
  return nodes.filter((node) => node.type === "frame");
}

function getFrameContentBottom(nodes: WorkspaceDesignNode[], frame: WorkspaceDesignNode, spacing: number) {
  const children = nodes.filter((node) => node.id !== frame.id && (node.parentId === frame.id || isNodeInsideTarget(node, frame)));
  if (children.length === 0) return frame.y + spacing;
  const bounds = getNodesBounds(children);
  return Math.max(frame.y + spacing, bounds.y + bounds.height + spacing);
}

type RequiredRegionContext = {
  userRequest: string;
  pageMode: string;
  businessEntity: string;
};

function createRequiredRegionContext(input: Record<string, unknown>, frame: WorkspaceDesignNode): RequiredRegionContext {
  const userRequest = String(input.userRequest ?? input.reason ?? "");
  const pageMode = String(input.pageMode ?? "").trim();
  const explicitEntity = String(input.businessEntity ?? "").trim();
  const inferredEntity = inferBusinessEntitiesFromText(`${explicitEntity} ${userRequest} ${frame.name} ${frame.text ?? ""}`)[0] ?? "";
  return {
    userRequest,
    pageMode,
    businessEntity: explicitEntity || inferredEntity
  };
}

function createRequiredRegionNodes(region: string, frame: WorkspaceDesignNode, y: number, spacing: number, context: RequiredRegionContext) {
  const normalized = normalizeIntentRegionName(region);
  const x = frame.x + spacing;
  const width = Math.max(240, frame.width - spacing * 2);
  if (!context.businessEntity && ["header", "summary", "detail", "form", "action"].includes(normalized)) return [];
  if (normalized === "header") return createHeaderRegionNodes(frame, x, y, width, context);
  if (normalized === "summary") return createSummaryRegionNodes(frame, x, y, width, context);
  if (normalized === "detail") return createDescriptionRegionNodes(frame, x, y, width, context);
  if (normalized === "form") return createFormRegionNodes(frame, x, y, width, context);
  if (normalized === "action") return createActionRegionNodes(frame, x, y, width, context);
  if (normalized === "table" || normalized === "collection") return createTableRegionNodes(frame, x, y, width);
  if (normalized === "pagination") return createPaginationRegionNodes(frame, x, y, width);
  if (normalized === "filter") return createFilterBarNodes({
    x,
    y,
    width,
    height: 96,
    filters: [
      { label: "关键词", placeholder: "请输入关键词" },
      { label: "状态", placeholder: "请选择状态" }
    ]
  }).map((node) => node.parentId ? node : { ...node, parentId: frame.id });
  if (normalized === "steps") return createStepsRegionNodes(frame, x, y, width);
  return [];
}

function createHeaderRegionNodes(frame: WorkspaceDesignNode, x: number, y: number, width: number, context: RequiredRegionContext) {
  const id = createDesignId("region-header");
  const entity = context.businessEntity;
  const title = `${entity}详情页`;
  return [
    createDesignNode("container", { id, parentId: frame.id, name: "Header 区域", x, y, width, height: 72, fill: "#ffffff", stroke: "#e5e7eb", radius: 12 }),
    createDesignNode("text", { parentId: id, name: "页面标题", x: x + 20, y: y + 16, width: width - 220, height: 28, text: title, fontSize: 20, fontWeight: 700, textColor: "#111827" }),
    createDesignNode("button", { parentId: id, name: "返回按钮", x: x + width - 112, y: y + 16, width: 92, height: 40, text: "返回", fill: "#ffffff", stroke: "#d0d5dd", textColor: "#344054", radius: 8 })
  ];
}

function createSummaryRegionNodes(frame: WorkspaceDesignNode, x: number, y: number, width: number, context: RequiredRegionContext) {
  const id = createDesignId("region-summary");
  const summaryItems = getEntitySummaryItems(context.businessEntity);
  const cardWidth = Math.max(160, Math.floor((width - 32) / 3));
  const nodes: WorkspaceDesignNode[] = [
    createDesignNode("container", { id, parentId: frame.id, name: "Summary 摘要区域", x, y, width, height: 112, fill: "#ffffff", stroke: "#e5e7eb", radius: 12 })
  ];
  summaryItems.forEach((item, index) => {
    const cardX = x + 16 + index * (cardWidth + 8);
    nodes.push(createDesignNode("text", { parentId: id, name: `${item.label}标题`, x: cardX, y: y + 20, width: cardWidth, height: 20, text: item.label, fontSize: 13, textColor: "#667085" }));
    nodes.push(createDesignNode("text", { parentId: id, name: `${item.label}值`, x: cardX, y: y + 50, width: cardWidth, height: 28, text: item.value, fontSize: 18, fontWeight: 700, textColor: item.tone === "primary" ? "#246bfe" : "#111827" }));
  });
  return nodes;
}

function createDescriptionRegionNodes(frame: WorkspaceDesignNode, x: number, y: number, width: number, context: RequiredRegionContext) {
  const id = createDesignId("region-detail");
  const fields = getEntityDetailFields(context.businessEntity);
  const rows = Math.ceil(fields.length / 3);
  const nodes: WorkspaceDesignNode[] = [
    createDesignNode("container", { id, parentId: frame.id, name: "DescriptionList 详情区域", x, y, width, height: 76 + rows * 48, fill: "#ffffff", stroke: "#e5e7eb", radius: 12 }),
    createDesignNode("text", { parentId: id, name: "详情标题", x: x + 20, y: y + 18, width: width - 40, height: 24, text: `${context.businessEntity}信息`, fontSize: 16, fontWeight: 700, textColor: "#111827" })
  ];
  fields.forEach((item, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const itemWidth = Math.floor((width - 48) / 3);
    nodes.push(createDesignNode("text", { parentId: id, name: `${item.label}标签`, x: x + 20 + col * itemWidth, y: y + 60 + row * 48, width: 84, height: 20, text: item.label, fontSize: 13, textColor: "#667085" }));
    nodes.push(createDesignNode("text", { parentId: id, name: `${item.label}值`, x: x + 104 + col * itemWidth, y: y + 60 + row * 48, width: itemWidth - 96, height: 20, text: item.value, fontSize: 13, textColor: "#111827" }));
  });
  return nodes;
}

function createFormRegionNodes(frame: WorkspaceDesignNode, x: number, y: number, width: number, context: RequiredRegionContext) {
  const id = createDesignId("region-form");
  const fields = getEntityFormFields(context.businessEntity);
  const nodes: WorkspaceDesignNode[] = [
    createDesignNode("container", { id, parentId: frame.id, name: "Form 表单区域", x, y, width, height: 188, fill: "#ffffff", stroke: "#e5e7eb", radius: 12 })
  ];
  fields.forEach((field, index) => {
    const rowY = y + 20 + index * 52;
    nodes.push(createDesignNode("text", { parentId: id, name: `${field}标签`, x: x + 20, y: rowY + 8, width: 96, height: 20, text: field, fontSize: 13, textColor: "#344054" }));
    nodes.push(createDesignNode("input", { parentId: id, name: `${field}输入`, x: x + 128, y: rowY, width: Math.max(220, width - 160), height: 38, text: `请输入${field}`, fill: "#ffffff", stroke: "#d0d5dd", radius: 8 }));
  });
  return nodes;
}

function createActionRegionNodes(frame: WorkspaceDesignNode, x: number, y: number, width: number, context: RequiredRegionContext) {
  const id = createDesignId("region-actions");
  const actions = getEntityActions(context.businessEntity, context.pageMode);
  return [
    createDesignNode("container", { id, parentId: frame.id, name: "ActionBar 操作区域", x, y, width, height: 72, fill: "#ffffff", stroke: "#e5e7eb", radius: 12 }),
    ...actions.map((action, index) => createDesignNode("button", {
      parentId: id,
      name: `${action}按钮`,
      x: x + width - 20 - (actions.length - index) * 104,
      y: y + 16,
      width: 92,
      height: 40,
      text: action,
      fill: index === actions.length - 1 ? "#246bfe" : "#ffffff",
      stroke: index === actions.length - 1 ? "#246bfe" : "#d0d5dd",
      textColor: index === actions.length - 1 ? "#ffffff" : "#344054",
      radius: 8
    }))
  ];
}

function getEntitySummaryItems(entity: string) {
  if (entity === "订单") {
    return [
      { label: "订单状态", value: "待发货", tone: "primary" },
      { label: "实付金额", value: "¥ 2,368.00", tone: "default" },
      { label: "下单时间", value: "2026-05-14 10:28", tone: "default" }
    ];
  }
  if (entity === "商品") {
    return [
      { label: "商品状态", value: "在售", tone: "primary" },
      { label: "销售价", value: "¥ 199.00", tone: "default" },
      { label: "可用库存", value: "1,280", tone: "default" }
    ];
  }
  if (entity === "客户" || entity === "用户") {
    return [
      { label: "账号状态", value: "正常", tone: "primary" },
      { label: "最近访问", value: "2026-05-14", tone: "default" },
      { label: "风险等级", value: "低", tone: "default" }
    ];
  }
  return [
    { label: `${entity}状态`, value: "正常", tone: "primary" },
    { label: "更新时间", value: "2026-05-14", tone: "default" },
    { label: "负责人", value: "负责人 A", tone: "default" }
  ];
}

function getEntityDetailFields(entity: string) {
  if (entity === "订单") {
    return [
      { label: "订单编号", value: "ORD202605140001" },
      { label: "订单状态", value: "待发货" },
      { label: "支付状态", value: "已支付" },
      { label: "下单用户", value: "张三 / 138****8201" },
      { label: "收货信息", value: "上海市浦东新区" },
      { label: "配送方式", value: "顺丰快递" },
      { label: "商品数量", value: "3 件" },
      { label: "优惠金额", value: "¥ 120.00" },
      { label: "订单备注", value: "工作日配送" }
    ];
  }
  if (entity === "商品") {
    return [
      { label: "商品编号", value: "SKU-20260514-001" },
      { label: "商品名称", value: "基础款长袖衬衫" },
      { label: "商品状态", value: "在售" },
      { label: "商品分类", value: "服饰 / 衬衫" },
      { label: "销售价格", value: "¥ 199.00" },
      { label: "库存数量", value: "1,280" },
      { label: "上架时间", value: "2026-05-01" },
      { label: "供应商", value: "华东仓" },
      { label: "商品描述", value: "透气亲肤，支持日常通勤" }
    ];
  }
  if (entity === "客户" || entity === "用户") {
    return [
      { label: "用户编号", value: "USR202605140001" },
      { label: "用户姓名", value: "张三" },
      { label: "手机号", value: "138****8201" },
      { label: "账号状态", value: "正常" },
      { label: "注册时间", value: "2026-04-18" },
      { label: "最近登录", value: "2026-05-14" }
    ];
  }
  return [
    { label: `${entity}编号`, value: "ID202605140001" },
    { label: `${entity}名称`, value: `${entity}名称` },
    { label: "当前状态", value: "正常" },
    { label: "创建时间", value: "2026-05-14" },
    { label: "负责人", value: "负责人 A" },
    { label: "备注说明", value: "暂无备注" }
  ];
}

function getEntityFormFields(entity: string) {
  if (entity === "订单") return ["订单编号", "收货人", "收货地址", "配送方式"];
  if (entity === "商品") return ["商品名称", "商品分类", "销售价格", "库存数量"];
  if (entity === "客户" || entity === "用户") return ["姓名", "手机号", "账号状态", "备注"];
  return [`${entity}名称`, `${entity}类型`, "状态"];
}

function getEntityActions(entity: string, pageMode: string) {
  if (entity === "订单") return pageMode === "form" ? ["取消", "保存"] : ["返回", "导出", "查看物流"];
  if (entity === "商品") return pageMode === "form" ? ["取消", "保存"] : ["返回", "编辑", "下架"];
  if (entity === "客户" || entity === "用户") return pageMode === "form" ? ["取消", "保存"] : ["返回", "编辑", "禁用"];
  return pageMode === "form" ? ["取消", "保存"] : ["返回", "编辑"];
}

function createTableRegionNodes(frame: WorkspaceDesignNode, x: number, y: number, width: number) {
  return createGranularTableNodesFromDraft({
    refId: "required-table",
    type: "table",
    name: "Table 数据区域",
    x: x - frame.x,
    y: y - frame.y,
    width,
    height: 260,
    text: "columns:名称|状态|时间|操作"
  }, {
    nodeId: createDesignId("region-table"),
    parentId: frame.id,
    originX: frame.x,
    originY: frame.y,
    platform: frame.width <= 480 ? "mobile_app" : "web"
  });
}

function createPaginationRegionNodes(frame: WorkspaceDesignNode, x: number, y: number, width: number) {
  const id = createDesignId("region-pagination");
  return [
    createDesignNode("container", { id, parentId: frame.id, name: "Pagination 分页区域", x, y, width, height: 56, fill: "#ffffff", stroke: "#e5e7eb", radius: 12 }),
    createDesignNode("text", { parentId: id, name: "分页统计", x: x + 20, y: y + 18, width: 180, height: 20, text: "共 128 条", fontSize: 13, textColor: "#667085" }),
    createDesignNode("button", { parentId: id, name: "上一页", x: x + width - 220, y: y + 10, width: 72, height: 36, text: "上一页", fill: "#ffffff", stroke: "#d0d5dd", textColor: "#344054", radius: 8 }),
    createDesignNode("button", { parentId: id, name: "下一页", x: x + width - 136, y: y + 10, width: 72, height: 36, text: "下一页", fill: "#ffffff", stroke: "#d0d5dd", textColor: "#344054", radius: 8 })
  ];
}

function createStepsRegionNodes(frame: WorkspaceDesignNode, x: number, y: number, width: number) {
  const id = createDesignId("region-steps");
  const steps = ["已提交", "处理中", "已完成"];
  const nodes: WorkspaceDesignNode[] = [
    createDesignNode("container", { id, parentId: frame.id, name: "Steps 流程区域", x, y, width, height: 96, fill: "#ffffff", stroke: "#e5e7eb", radius: 12 })
  ];
  steps.forEach((step, index) => {
    const stepX = x + 32 + index * Math.max(120, Math.floor((width - 64) / steps.length));
    nodes.push(createDesignNode("container", { parentId: id, name: `${step}节点`, x: stepX, y: y + 28, width: 18, height: 18, fill: index === 0 ? "#246bfe" : "#e5e7eb", stroke: "transparent", radius: 999 }));
    nodes.push(createDesignNode("text", { parentId: id, name: `${step}文本`, x: stepX + 28, y: y + 26, width: 96, height: 22, text: step, fontSize: 13, textColor: "#344054" }));
  });
  return nodes;
}

function createGenericRegionNodes(frame: WorkspaceDesignNode, x: number, y: number, width: number, region: string) {
  const id = createDesignId("region-generic");
  return [
    createDesignNode("container", { id, parentId: frame.id, name: `${region} 区域`, x, y, width, height: 96, fill: "#ffffff", stroke: "#e5e7eb", radius: 12 }),
    createDesignNode("text", { parentId: id, name: `${region}标题`, x: x + 20, y: y + 20, width: width - 40, height: 24, text: region, fontSize: 16, fontWeight: 700, textColor: "#111827" })
  ];
}

function collectNodeRegions(nodes: WorkspaceDesignNode[]) {
  return Array.from(new Set(nodes.flatMap((node) => {
    const label = `${node.type} ${node.name} ${node.text ?? ""}`;
    const regions = [normalizeIntentRegionName(label)];
    if (node.type === "table") regions.push("table", "collection");
    if (node.type === "input") regions.push("form");
    if (node.type === "button") regions.push("action");
    if (/filter|search|查询|搜索|筛选/i.test(label)) regions.push("filter");
    if (/pagination|pager|分页|上一页|下一页/i.test(label)) regions.push("pagination");
    if (/descriptionlist|detail|详情|明细|资料/i.test(label)) regions.push("detail");
    if (/summary|metric|摘要|统计|指标/i.test(label)) regions.push("summary");
    if (/header|toolbar|标题|页头|顶部/i.test(label)) regions.push("header");
    if (/steps|timeline|流程|步骤|时间线/i.test(label)) regions.push("steps");
    return regions.filter(Boolean);
  })));
}

function reflowOverlappingNodes(nodes: WorkspaceDesignNode[], spacing: number) {
  const readableNodes = nodes.map((node) => node.type === "text" ? expandTextNodeForReadability(node) : node);
  const sorted = [...readableNodes].filter(isReflowMovableNode).sort((a, b) => a.y - b.y || a.x - b.x);
  const yById = new Map<string, number>();
  sorted.forEach((node, index) => {
    let nextY = yById.get(node.id) ?? node.y;
    for (let i = 0; i < index; i += 1) {
      const previous = sorted[i];
      const previousY = yById.get(previous.id) ?? previous.y;
      const horizontalOverlap = node.x < previous.x + previous.width && node.x + node.width > previous.x;
      const verticalOverlap = nextY < previousY + previous.height + spacing && nextY + node.height > previousY;
      if (horizontalOverlap && verticalOverlap && node.parentId === previous.parentId) {
        nextY = previousY + previous.height + spacing;
      }
    }
    yById.set(node.id, nextY);
  });
  const movedNodes = readableNodes.map((node) => ({ ...node, y: yById.get(node.id) ?? node.y }));
  return expandFramesToFitChildren(stabilizeCanvasModuleLayout(movedNodes, spacing), spacing);
}

function stabilizeCanvasModuleLayout(nodes: WorkspaceDesignNode[], spacing: number) {
  let nextNodes = [...nodes];
  const frames = nextNodes.filter((node) => node.type === "frame").sort((a, b) => a.y - b.y || a.x - b.x);
  frames.forEach((frame) => {
    const modules = nextNodes
      .filter((node) => node.parentId === frame.id && shouldReflowAsCanvasModule(node, frame))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (modules.length < 2) return;
    const rows = groupCanvasModulesIntoRows(modules);
    const shifts = new Map<string, number>();
    let cursorBottom = rows[0]?.bounds.y ?? frame.y + spacing;
    rows.forEach((row, index) => {
      const minY = index === 0 ? row.bounds.y : cursorBottom + spacing;
      const dy = Math.max(0, Math.ceil(minY - row.bounds.y));
      if (dy > 0) row.nodes.forEach((node) => shifts.set(node.id, (shifts.get(node.id) ?? 0) + dy));
      cursorBottom = row.bounds.y + dy + row.bounds.height;
    });
    if (shifts.size > 0) nextNodes = translateCanvasModulesAndChildren(nextNodes, shifts);
  });
  return nextNodes;
}

function groupCanvasModulesIntoRows(nodes: WorkspaceDesignNode[]) {
  const rows: Array<{ nodes: WorkspaceDesignNode[]; bounds: ReturnType<typeof getNodesBounds> }> = [];
  nodes.forEach((node) => {
    const nodeBounds = getNodesBounds([node]);
    const row = rows.find((item) => nodeBounds.y < item.bounds.y + item.bounds.height && nodeBounds.y + nodeBounds.height > item.bounds.y);
    if (!row) {
      rows.push({ nodes: [node], bounds: nodeBounds });
      return;
    }
    row.nodes.push(node);
    row.bounds = getNodesBounds(row.nodes);
  });
  return rows.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
}

function translateCanvasModulesAndChildren(nodes: WorkspaceDesignNode[], shifts: Map<string, number>) {
  const childrenByParent = new Map<string, WorkspaceDesignNode[]>();
  nodes.forEach((node) => {
    if (!node.parentId) return;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  });
  const shiftById = new Map<string, number>();
  shifts.forEach((dy, id) => {
    const visit = (nodeId: string) => {
      shiftById.set(nodeId, Math.max(shiftById.get(nodeId) ?? 0, dy));
      (childrenByParent.get(nodeId) ?? []).forEach((child) => visit(child.id));
    };
    visit(id);
  });
  return nodes.map((node) => {
    const dy = shiftById.get(node.id) ?? 0;
    return dy > 0 ? translateDesignNode(node, 0, dy) : node;
  });
}

function shouldReflowAsCanvasModule(node: WorkspaceDesignNode, frame: WorkspaceDesignNode) {
  if (node.visible === false || node.type === "frame") return false;
  if (node.width < 48 || node.height < 16) return false;
  const label = `${node.name} ${node.text ?? ""}`;
  if (/侧边|导航|菜单|顶部|工具栏|TopBar|Sidebar|Navigation/i.test(label)) return false;
  if (node.height >= frame.height * 0.72) return false;
  if (node.width >= frame.width * 0.86 && node.height <= 96) return false;
  return node.type === "container"
    || node.type === "card"
    || node.type === "table"
    || (node.type === "image" && node.width >= 160 && node.height >= 96);
}

function isReflowMovableNode(node: WorkspaceDesignNode) {
  if (node.visible === false) return false;
  if (node.type === "frame" || node.type === "container" || node.type === "card" || node.type === "image") return false;
  return node.type === "text" || node.type === "button" || node.type === "input" || node.type === "table";
}

function expandTextNodeForReadability(node: WorkspaceDesignNode) {
  const text = String(node.text ?? "").trim();
  if (!text) return node;
  const fontSize = node.fontSize || 14;
  const charsPerLine = Math.max(4, Math.floor(node.width / Math.max(8, fontSize)));
  const lines = Math.ceil(text.length / charsPerLine);
  const minHeight = Math.ceil(lines * fontSize * 1.45);
  return minHeight > node.height ? { ...node, height: minHeight } : node;
}

function expandFramesToFitChildren(nodes: WorkspaceDesignNode[], spacing: number) {
  return nodes.map((node) => {
    if (node.type !== "frame" && node.type !== "container" && node.type !== "card") return node;
    const children = nodes.filter((child) => child.id !== node.id && (
      child.parentId === node.id || (node.type === "frame" && isNodeInsideTarget(child, node))
    ));
    if (children.length === 0) return node;
    const bottom = Math.max(...children.map((child) => child.y + child.height));
    const right = Math.max(...children.map((child) => child.x + child.width));
    return {
      ...node,
      height: Math.max(node.height, Math.ceil(bottom - node.y + spacing)),
      width: Math.max(node.width, Math.ceil(right - node.x + spacing))
    };
  });
}

function detectMeaningfulOverlaps(nodes: WorkspaceDesignNode[]) {
  const visible = nodes.filter((node) => node.visible !== false);
  return visible
    .flatMap((node, index, list) => list.slice(index + 1)
      .filter((other) => isMeaningfulOcclusion(node, other))
      .map((other) => [node.id, other.id]))
    .slice(0, 20);
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function inferSpacingHints(nodes: WorkspaceDesignNode[]) {
  const sorted = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 120);
  const gaps: number[] = [];
  sorted.forEach((node, index) => {
    const next = sorted[index + 1];
    if (!next) return;
    const gap = next.y - (node.y + node.height);
    if (gap >= 0 && gap < 120) gaps.push(Math.round(gap));
  });
  if (gaps.length === 0) return ["未识别到稳定的纵向间距。"];
  const average = Math.round(gaps.reduce((sum, item) => sum + item, 0) / gaps.length);
  return [
    `识别到 ${gaps.length} 个相邻纵向间距，平均约 ${average}px`,
    average < 8 ? "组件间距偏密，建议增加区块间距" : "组件间距没有明显过密"
  ];
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function countOverlaps(nodes: WorkspaceDesignNode[]) {
  let count = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (isMeaningfulOcclusion(nodes[i], nodes[j])) count += 1;
      if (count > 40) return count;
    }
  }
  return count;
}

function isMeaningfulOcclusion(a: WorkspaceDesignNode, b: WorkspaceDesignNode) {
  const overlap = getOverlapMetrics(a, b);
  if (!overlap) return false;
  if (isAllowedLayering(a, b, overlap)) return false;
  if (a.type === "text" && b.type === "text") return overlap.minRatio > 0.08 || overlap.area > 180;
  if (a.type === "text" || b.type === "text") return overlap.minRatio > 0.12 || overlap.area > 220;
  if (isInteractiveNode(a) && isInteractiveNode(b)) return overlap.minRatio > 0.1 || overlap.area > 320;
  if (isFunctionalContentNode(a) && isFunctionalContentNode(b)) return overlap.minRatio > 0.16 || overlap.area > 640;
  return false;
}

function isAllowedLayering(a: WorkspaceDesignNode, b: WorkspaceDesignNode, overlap: OverlapMetrics) {
  if (a.id === b.parentId || b.id === a.parentId) return true;
  const firstContainsSecond = containsNode(a, b);
  const secondContainsFirst = containsNode(b, a);
  if ((firstContainsSecond || secondContainsFirst) && (isLayerContainer(a) || isLayerContainer(b))) return true;
  if ((isLayerContainer(a) && !isTextOrInteractiveNode(a)) || (isLayerContainer(b) && !isTextOrInteractiveNode(b))) {
    const layer = isLayerContainer(a) ? a : b;
    const content = layer === a ? b : a;
    if (containsNode(layer, content) || overlap.minRatio > 0.7) return true;
  }
  if ((a.type === "image" || b.type === "image") && overlap.minRatio > 0.7 && (!isInteractiveNode(a) && !isInteractiveNode(b))) return true;
  return false;
}

type OverlapMetrics = {
  area: number;
  minRatio: number;
  aRatio: number;
  bRatio: number;
};

function getOverlapMetrics(a: WorkspaceDesignNode, b: WorkspaceDesignNode): OverlapMetrics | undefined {
  const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (xOverlap <= 0 || yOverlap <= 0) return undefined;
  const area = xOverlap * yOverlap;
  if (area <= 24) return undefined;
  const aArea = Math.max(1, a.width * a.height);
  const bArea = Math.max(1, b.width * b.height);
  const aRatio = area / aArea;
  const bRatio = area / bArea;
  return {
    area,
    aRatio,
    bRatio,
    minRatio: Math.min(aRatio, bRatio)
  };
}

function containsNode(container: WorkspaceDesignNode, child: WorkspaceDesignNode) {
  return child.x >= container.x
    && child.y >= container.y
    && child.x + child.width <= container.x + container.width
    && child.y + child.height <= container.y + container.height;
}

function isLayerContainer(node: WorkspaceDesignNode) {
  return node.type === "frame" || node.type === "container" || node.type === "card" || node.type === "image";
}

function isInteractiveNode(node: WorkspaceDesignNode) {
  return node.type === "button" || node.type === "input";
}

function isTextOrInteractiveNode(node: WorkspaceDesignNode) {
  return node.type === "text" || isInteractiveNode(node);
}

function isFunctionalContentNode(node: WorkspaceDesignNode) {
  return node.type === "button" || node.type === "input" || node.type === "table" || node.type === "text";
}

function getPageBounds(page: WorkspaceDesignPage) {
  if (page.nodes.length === 0) return { x: 520, y: 220, width: 960, height: 0 };
  const minX = Math.min(...page.nodes.map((node) => node.x));
  const minY = Math.min(...page.nodes.map((node) => node.y));
  const maxX = Math.max(...page.nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...page.nodes.map((node) => node.y + node.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function getTopLevelArtboards(page: WorkspaceDesignPage) {
  const frames = page.nodes.filter((node) =>
    node.visible !== false &&
    node.type === "frame" &&
    !node.parentId &&
    node.width >= 240 &&
    node.height >= 320
  );
  if (frames.length > 0) return frames;
  const bounds = getPageBounds(page);
  return page.nodes.length > 0
    ? [createDesignNode("frame", { id: "page-preview-frame", name: page.name, x: bounds.x, y: bounds.y, width: bounds.width || 960, height: bounds.height || 640, fill: "#f7f8fb" })]
    : [];
}

function buildNodePreviewSvgDataUrl(page: WorkspaceDesignPage, target: WorkspaceDesignNode) {
  const children = page.nodes
    .filter((node) => node.id === target.id || node.parentId === target.id || isNodeInsideTarget(node, target))
    .sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
  const body = children.map((node) => renderPreviewNode(node, target)).join("");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(target.width)}" height="${Math.round(target.height)}" viewBox="0 0 ${Math.round(target.width)} ${Math.round(target.height)}">`,
    `<rect width="100%" height="100%" fill="${escapeSvgAttr(target.fill === "transparent" ? "#ffffff" : target.fill || "#ffffff")}"/>`,
    body,
    "</svg>"
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function renderPreviewNode(node: WorkspaceDesignNode, target: WorkspaceDesignNode) {
  const x = Math.round(node.x - target.x);
  const y = Math.round(node.y - target.y);
  const width = Math.max(1, Math.round(node.width));
  const height = Math.max(1, Math.round(node.height));
  if (node.id === target.id) {
    return "";
  }
  if (node.type === "text") {
    return `<text x="${x}" y="${y + Math.max(12, Math.round(node.fontSize ?? 14))}" fill="${escapeSvgAttr(node.textColor || "#101828")}" font-size="${Math.round(node.fontSize ?? 14)}" font-family="PingFang SC, sans-serif">${escapeSvgText(node.text || node.name)}</text>`;
  }
  if (node.type === "image" && node.imageUrl?.startsWith("data:image/")) {
    return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="${escapeSvgAttr(node.imageUrl)}" preserveAspectRatio="xMidYMid slice"/>`;
  }
  const fill = node.fill === "transparent" ? "#ffffff" : node.fill || "#ffffff";
  const stroke = node.stroke === "transparent" ? "#e4e7ec" : node.stroke || "#e4e7ec";
  const label = node.text || (["button", "input", "card", "table"].includes(node.type) ? node.name : "");
  const textX = node.type === "button" || node.textAlign === "center" ? x + width / 2 : x + 14;
  const textAnchor = node.type === "button" || node.textAlign === "center" ? "middle" : "start";
  const textY = node.type === "button" ? y + height / 2 + Math.round((node.fontSize ?? 14) * 0.35) : y + Math.min(height - 10, 28);
  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.round(node.radius ?? 8)}" fill="${escapeSvgAttr(fill)}" stroke="${escapeSvgAttr(stroke)}" stroke-width="${Math.max(0, node.strokeWidth ?? 1)}"/>`,
    label ? `<text x="${textX}" y="${textY}" text-anchor="${textAnchor}" fill="${escapeSvgAttr(node.textColor || (node.type === "button" ? "#ffffff" : "#344054"))}" font-size="${Math.round(node.fontSize ?? 14)}" font-family="PingFang SC, sans-serif">${escapeSvgText(label).slice(0, 80)}</text>` : ""
  ].join("");
}

function isNodeInsideTarget(node: WorkspaceDesignNode, target: WorkspaceDesignNode) {
  if (node.id === target.id) return true;
  return node.x >= target.x
    && node.y >= target.y
    && node.x + node.width <= target.x + target.width
    && node.y + node.height <= target.y + target.height;
}

function escapeSvgText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeSvgAttr(value: string) {
  return escapeSvgText(value).replace(/"/g, "&quot;");
}

function getCanvasAppendPlacement(page: WorkspaceDesignPage, canvas: { width: number; height: number }, gap: number) {
  const artboards = getTopLevelArtboards(page).filter((node) => node.id !== "page-preview-frame");
  const boundsSource = artboards.length > 0 ? artboards : page.nodes.filter((node) => node.visible !== false);
  if (boundsSource.length === 0) {
    return {
      startX: 520,
      topY: 220,
      gap,
      anchor: "empty_canvas"
    };
  }
  const right = Math.max(...boundsSource.map((node) => node.x + node.width));
  const top = Math.min(...boundsSource.map((node) => node.y));
  return {
    startX: Math.round(right + gap),
    topY: Math.round(top),
    gap,
    anchor: artboards.length > 0 ? "right_of_existing_artboards" : "right_of_existing_content"
  };
}

function defaultNodeName(type: WorkspaceDesignNodeType) {
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
