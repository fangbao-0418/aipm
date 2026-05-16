import type { WorkspaceDesignNode, WorkspaceDesignNodeType } from "../../shared/types/workspace.js";
import { applyLibraryTokens, type DesignCapabilityProfile } from "./design-capability-registry.js";

export type SemanticUiNodeType =
  | "Page"
  | "Toolbar"
  | "SearchBar"
  | "Tabs"
  | "CardList"
  | "Card"
  | "Form"
  | "Field"
  | "ActionBar"
  | "Button"
  | "Text"
  | "Image"
  | "StatusPanel"
  | "Table";

export interface SemanticUiNode {
  type: SemanticUiNodeType;
  id?: string;
  name?: string;
  content?: string;
  variant?: string;
  children?: SemanticUiNode[];
  props?: Record<string, unknown>;
}

export interface LayoutTreeNode {
  id: string;
  type: SemanticUiNodeType;
  layout: "vertical" | "horizontal" | "absolute" | "grid";
  frame: { x: number; y: number; width: number; height: number };
  gap: number;
  padding: number;
  children: LayoutTreeNode[];
  semantic: SemanticUiNode;
}

export interface SceneGraphBuildResult {
  semanticTree: SemanticUiNode;
  layoutTree: LayoutTreeNode;
  nodes: WorkspaceDesignNode[];
  diagnostics: string[];
}

type LayoutBounds = { x: number; y: number; width: number; height: number };

export interface StitchUiSchemaDraft {
  intent?: string;
  platform?: "web" | "mobile_app" | string;
  artboards: Array<{
    refId?: string;
    name: string;
    width: number;
    height: number;
    layout?: string;
    styleTokens?: Record<string, unknown>;
    layoutIntent?: LayoutIntentDraftNode;
    nodes?: StitchUiDraftNode[];
  }>;
}

export interface LayoutIntentDraftNode {
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
  fill?: string;
  stroke?: string;
  radius?: number;
  textColor?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: number | string;
  lineHeight?: number | string;
  textAlign?: "left" | "center" | "right" | "justify";
  decoration?: string;
  columnCount?: number;
  src?: string;
  imageUrl?: string;
  columns?: string[];
  rows?: string[][];
  fields?: string[];
  actions?: string[];
  metrics?: Array<{ label: string; value: string }>;
  children?: LayoutIntentDraftNode[];
  props?: Record<string, unknown>;
}

export interface StitchUiDraftNode {
  refId?: string;
  parentRef?: string;
  type: WorkspaceDesignNodeType;
  name: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  placeholder?: string;
  fill?: string;
  stroke?: string;
  border?: string;
  borderBottom?: string;
  borderTop?: string;
  radius?: number;
  borderRadius?: number | string;
  textColor?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: number | string;
  lineHeight?: number | string;
  textAlign?: "left" | "center" | "right" | "justify";
  src?: string;
  imageUrl?: string;
}

export interface StitchCompileOptions {
  placement?: { startX: number; topY: number; gap: number };
  targetFrame?: WorkspaceDesignNode;
  userRequest?: string;
}

export type SemanticUiTask =
  | "browse"
  | "create"
  | "edit"
  | "inspect"
  | "operate"
  | "monitor"
  | "verify"
  | "checkout";

export type SemanticUiRegionRole =
  | "navigation"
  | "header"
  | "summary"
  | "filter"
  | "content"
  | "action"
  | "feedback"
  | "footer";

export type SemanticUiComponentKind =
  | "Shell"
  | "SidebarNav"
  | "TopBar"
  | "PageHeader"
  | "MetricGroup"
  | "FilterBar"
  | "DataCollection"
  | "CardList"
  | "DetailPanel"
  | "FormPanel"
  | "ActionBar"
  | "Pagination"
  | "EmptyState";

export interface SemanticUiPlan {
  id: string;
  title: string;
  platform: DesignCapabilityProfile["platform"];
  tasks: SemanticUiTask[];
  entity: {
    name: string;
    label: string;
    fields: string[];
    metrics: Array<{ label: string; value: string }>;
    states: string[];
    actions: string[];
  };
  composition: {
    density: "comfortable" | "compact" | "data_dense";
    navigation: "sidebar" | "top" | "none";
    primaryRegion: "collection" | "detail" | "form" | "dashboard" | "feedback";
  };
  regions: SemanticUiRegion[];
}

export interface SemanticUiRegion {
  id: string;
  role: SemanticUiRegionRole;
  importance: "primary" | "secondary";
  allowedComponents: SemanticUiComponentKind[];
}

export interface ResolvedUiComponent {
  id: string;
  kind: SemanticUiComponentKind;
  regionId: string;
  slot: { x: number; y: number; width: number; height: number };
  props: Record<string, unknown>;
}

export function compileLayoutTreeToSceneGraph(
  inputNodes: WorkspaceDesignNode[],
  profile: DesignCapabilityProfile
): WorkspaceDesignNode[] {
  return compileWorkspaceNodesToSceneGraph(normalizeSceneGraphHierarchy(inputNodes), profile).nodes;
}

export function compileStitchUiDraftToSceneGraph(
  schemaDraft: StitchUiSchemaDraft,
  profile: DesignCapabilityProfile,
  options: StitchCompileOptions = {}
): SceneGraphBuildResult {
  const nodes = normalizeSceneGraphHierarchy(schemaDraft.artboards.flatMap((artboard, index) =>
    compileStitchArtboard(artboard, schemaDraft, profile, options, index)
  ));
  const normalizedNodes = compileLayoutTreeToSceneGraph(nodes, profile);
  const semanticTree = buildSemanticTreeFromNodes(normalizedNodes, profile);
  const layoutTree = buildLayoutTreeFromSemanticTree(semanticTree, getSceneCanvasBounds(normalizedNodes), profile);
  return {
    semanticTree,
    layoutTree,
    nodes: normalizedNodes,
    diagnostics: [
      ...collectSceneGraphDiagnostics(normalizedNodes, layoutTree),
      ...collectLayoutIntentCoverageDiagnostics(schemaDraft, normalizedNodes)
    ]
  };
}

export function compileWorkspaceNodesToSceneGraph(
  inputNodes: WorkspaceDesignNode[],
  profile: DesignCapabilityProfile
): SceneGraphBuildResult {
  const tokenized = inputNodes.map((node) => applyLibraryTokens(fixNodeReadability(node), profile));
  const componentNormalized = tokenized.map((node) => normalizeComponentNode(node, profile));
  const clamped = clampNodesIntoArtboards(componentNormalized, profile);
  const stacked = stackFunctionalSiblings(clamped, profile);
  const stabilized = stabilizeArtboardModuleLayout(stacked, profile);
  const measured = measureAndReflowReadableLayout(stabilized, profile);
  const nodes = expandFramesToFitChildren(measured, getCompilerSpacing(profile, "md"));
  const semanticTree = buildSemanticTreeFromNodes(nodes, profile);
  const layoutTree = buildLayoutTreeFromSemanticTree(semanticTree, getSceneCanvasBounds(nodes), profile);
  return {
    semanticTree,
    layoutTree,
    nodes,
    diagnostics: collectSceneGraphDiagnostics(nodes, layoutTree)
  };
}

function compileStitchArtboard(
  artboard: StitchUiSchemaDraft["artboards"][number],
  schemaDraft: StitchUiSchemaDraft,
  profile: DesignCapabilityProfile,
  options: StitchCompileOptions,
  index: number
) {
  const targetFrame = options.targetFrame;
  const request = `${options.userRequest ?? ""} ${schemaDraft.intent ?? ""} ${artboard.name ?? ""} ${(artboard.nodes ?? []).map((node) => `${node.name} ${node.text ?? ""}`).join(" ")}`;
  const isMobile = schemaDraft.platform === "mobile_app" || profile.platform === "mobile_app" || profile.platform === "wechat_mini_program";
  const tokens = profile.libraries[0]?.tokens;
  const frame = targetFrame ?? createCompilerNode("frame", {
    id: createCompilerId("frame"),
    name: `${artboard.name || "页面"} 画板`,
    x: options.placement ? options.placement.startX + index * (artboard.width + options.placement.gap) : 520 + index * (artboard.width + 56),
    y: options.placement?.topY ?? 220,
    width: isMobile ? Math.min(430, artboard.width || 375) : Math.max(1180, artboard.width || 1440),
    height: isMobile ? Math.max(760, artboard.height || 812) : Math.max(900, artboard.height || 1024),
    fill: tokens?.colors.background ?? (isMobile ? "#f6f7f9" : "#f5f7fb"),
    stroke: tokens?.colors.border ?? "#d9e2ec",
    radius: isMobile ? (tokens?.radius.card ?? 28) : 0
  });
  if (artboard.layoutIntent) {
    return compileLayoutIntentArtboard(artboard.layoutIntent, frame, schemaDraft, profile, { includeFrame: !targetFrame });
  }
  if ((artboard.nodes ?? []).length === 0 && /外框|shell|canvas|页面外框/i.test(`${schemaDraft.intent ?? ""} ${artboard.layout ?? ""}`)) {
    return [applyLibraryTokens(frame, profile)];
  }
  if (shouldRespectExplicitDraftNodes(artboard, options)) {
    return compileExplicitDraftNodes(artboard, frame, profile, { includeFrame: !targetFrame });
  }
  const semanticPlan = inferSemanticUiPlan({
    request,
    artboard,
    schemaDraft,
    profile,
    targetSection: options.targetFrame ? inferTargetRegionRole(request, artboard.nodes ?? []) : undefined
  });
  return renderSemanticUiPlan(frame, semanticPlan, profile, { includeFrame: !targetFrame });
}

type StitchSectionKind = "shell" | "header" | "filters" | "main" | "footer";

function shouldRespectExplicitDraftNodes(
  artboard: StitchUiSchemaDraft["artboards"][number],
  options: StitchCompileOptions
) {
  const nodes = artboard.nodes ?? [];
  if (nodes.length < 4) return false;
  const hasConcreteLayout = nodes.some((node) => typeof node.x === "number" && typeof node.y === "number" && typeof node.width === "number" && typeof node.height === "number");
  if (!hasConcreteLayout) return false;
  if (options.targetFrame) return true;
  const hasUiStructure = nodes.some((node) => /导航|标题|菜单|工具栏|筛选|搜索|表格|列表|卡片|按钮|用户|面包屑/i.test(`${node.name} ${node.text ?? ""}`));
  return hasUiStructure;
}

function compileExplicitDraftNodes(
  artboard: StitchUiSchemaDraft["artboards"][number],
  frame: WorkspaceDesignNode,
  profile: DesignCapabilityProfile,
  options: { includeFrame: boolean }
) {
  const refToNodeId = new Map<string, string>();
  if (artboard.refId) refToNodeId.set(artboard.refId, frame.id);
  (artboard.nodes ?? []).forEach((draftNode) => {
    if (draftNode.refId) refToNodeId.set(draftNode.refId, createCompilerId("draft"));
  });
  const nodes = (artboard.nodes ?? []).map((draftNode) => {
    const id = draftNode.refId ? refToNodeId.get(draftNode.refId) ?? createCompilerId("draft") : createCompilerId("draft");
    const parentId = draftNode.parentRef ? refToNodeId.get(draftNode.parentRef) ?? frame.id : frame.id;
    return createExplicitDraftNode(draftNode, {
      id,
      parentId,
      frame,
      profile
    });
  });
  return [
    ...(options.includeFrame ? [applyLibraryTokens(frame, profile)] : []),
    ...nodes.map((node) => applyLibraryTokens(node, profile))
  ];
}

function createExplicitDraftNode(
  draftNode: StitchUiDraftNode,
  context: {
    id: string;
    parentId: string;
    frame: WorkspaceDesignNode;
    profile: DesignCapabilityProfile;
  }
) {
  const type = draftNode.type;
  const width = Math.max(1, toFiniteNumber(draftNode.width, type === "text" ? 160 : 120));
  const height = Math.max(1, toFiniteNumber(draftNode.height, type === "button" ? 36 : type === "input" ? 36 : type === "text" ? 24 : 80));
  const text = draftNode.text ?? draftNode.placeholder ?? (type === "button" || type === "input" ? draftNode.name : undefined);
  const stroke = draftNode.stroke ?? extractCssBorderColor(draftNode.border) ?? extractCssBorderColor(draftNode.borderBottom) ?? extractCssBorderColor(draftNode.borderTop);
  const radius = toFiniteNumber(draftNode.radius, toFiniteNumber(draftNode.borderRadius, type === "button" || type === "input" ? 6 : 0));
  const fontSize = toFiniteNumber(draftNode.fontSize, type === "text" ? 14 : 14);
  const lineHeight = normalizeLineHeight(draftNode.lineHeight, type === "button" ? height : undefined);
  return createCompilerNode(type, {
    id: context.id,
    parentId: context.parentId,
    name: draftNode.name,
    x: context.frame.x + toFiniteNumber(draftNode.x, 0),
    y: context.frame.y + toFiniteNumber(draftNode.y, 0),
    width,
    height,
    fill: draftNode.fill ?? (type === "text" ? "transparent" : type === "button" ? context.profile.libraries[0]?.tokens.colors.primary ?? "#1677ff" : "#ffffff"),
    stroke: stroke ?? (type === "text" ? "transparent" : "#d9e2ec"),
    strokeWidth: stroke ? 1 : type === "text" ? 0 : 1,
    radius,
    text,
    textColor: draftNode.textColor ?? draftNode.color ?? (type === "button" ? "#ffffff" : "#101828"),
    fontSize,
    fontWeight: typeof draftNode.fontWeight === "number" ? draftNode.fontWeight : parseFontWeight(draftNode.fontWeight),
    textAlign: draftNode.textAlign ?? (type === "button" ? "center" : undefined),
    textVerticalAlign: type === "button" || type === "input" ? "middle" : undefined,
    lineHeight: lineHeight ?? (type === "button" ? height : undefined),
    imageUrl: draftNode.imageUrl ?? draftNode.src
  });
}

function compileLayoutIntentArtboard(
  intent: LayoutIntentDraftNode,
  frame: WorkspaceDesignNode,
  schemaDraft: StitchUiSchemaDraft,
  profile: DesignCapabilityProfile,
  options: { includeFrame: boolean }
) {
  const rootIntent = normalizeLayoutIntentRoot(intent, schemaDraft, frame);
  const contentFrame = {
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height
  };
  const nodes = renderLayoutIntentNode(rootIntent, contentFrame, frame.id, profile, 0);
  return [
    ...(options.includeFrame ? [applyLibraryTokens(frame, profile)] : []),
    ...nodes.map((node) => applyLibraryTokens(node, profile))
  ];
}

function normalizeLayoutIntentRoot(
  intent: LayoutIntentDraftNode,
  schemaDraft: StitchUiSchemaDraft,
  frame: WorkspaceDesignNode
): LayoutIntentDraftNode {
  if (/^page$/i.test(intent.type) || /^screen$/i.test(intent.type) || /^artboard$/i.test(intent.type)) {
    return ensureLayoutIntentCoverage({
      ...intent,
      type: "Page",
      title: intent.title ?? frame.name.replace(/\s*画板$/, ""),
      direction: intent.direction ?? "vertical",
      gap: intent.gap ?? "lg",
      padding: intent.padding ?? (schemaDraft.platform === "mobile_app" ? "md" : "lg")
    }, schemaDraft, frame);
  }
  return ensureLayoutIntentCoverage({
    type: "Page",
    title: frame.name.replace(/\s*画板$/, ""),
    direction: "vertical",
    gap: "lg",
    padding: schemaDraft.platform === "mobile_app" ? "md" : "lg",
    children: [intent]
  }, schemaDraft, frame);
}

function ensureLayoutIntentCoverage(
  root: LayoutIntentDraftNode,
  schemaDraft: StitchUiSchemaDraft,
  frame: WorkspaceDesignNode
): LayoutIntentDraftNode {
  const request = `${schemaDraft.intent ?? ""} ${root.title ?? ""} ${root.name ?? ""} ${frame.name}`;
  const children = root.children ?? [];
  const hasContent = children.some((child) => /table|datatable|list|card|grid|content|form/i.test(child.type) || /内容|列表|表格|卡片|表单|详情/.test(`${child.name ?? ""}${child.title ?? ""}`));
  const hasFilter = children.some((child) => /filter|search/i.test(child.type) || /筛选|查询|搜索/.test(`${child.name ?? ""}${child.title ?? ""}`));
  const isDetail = /详情|查看|资料|detail|inspect/i.test(request);
  const isCollection = !isDetail && /列表|管理|查询|搜索|记录|table|list/i.test(request);
  if (children.length >= 3 && hasContent) return root;
  if (!isCollection && hasContent) return root;

  const nextChildren: LayoutIntentDraftNode[] = [];
  const hasHeaderLike = children.some((child) => /toolbar|title|header|action/i.test(child.type) || /标题|顶部|操作/.test(`${child.name ?? ""}${child.title ?? ""}`));
  if (!hasHeaderLike) {
    nextChildren.push({
      type: "Toolbar",
      direction: "horizontal",
      gap: "md",
      padding: "none",
      children: [
        { type: "Text", text: inferPageTitle(request), variant: "title", width: "fill" },
        { type: "ActionBar", direction: "horizontal", gap: "sm", width: "hug", children: [
          { type: "Button", text: inferPrimaryAction(request), variant: "primary" },
          ...(/导出|export/i.test(request) ? [{ type: "Button", text: "导出", variant: "secondary" } satisfies LayoutIntentDraftNode] : [])
        ] }
      ]
    });
  }
  nextChildren.push(...children);
  return {
    ...root,
    children: nextChildren
  };
}

function renderLayoutIntentNode(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile,
  depth: number
): WorkspaceDesignNode[] {
  const normalizedType = normalizeLayoutIntentType(intent.type);
  if (normalizedType === "Repeat") {
    return renderLayoutIntentRepeat(intent, slot, parentId, profile, depth);
  }
  if (normalizedType === "Page" || normalizedType === "Stack" || normalizedType === "Section") {
    return renderLayoutIntentStack(intent, slot, parentId, profile, depth, normalizedType);
  }
  if (normalizedType === "Grid") {
    return renderLayoutIntentGrid(intent, slot, parentId, profile, depth);
  }
  if (normalizedType === "Toolbar" || normalizedType === "ActionBar") {
    return renderLayoutIntentStack({ ...intent, direction: "horizontal", gap: intent.gap ?? "sm" }, slot, parentId, profile, depth, normalizedType);
  }
  if (normalizedType === "FilterBar") {
    return renderLayoutIntentFilterBar(intent, slot, parentId, profile);
  }
  if (normalizedType === "MetricGroup") {
    return renderLayoutIntentMetricGroup(intent, slot, parentId, profile);
  }
  if (normalizedType === "Table") {
    return renderLayoutIntentTable(intent, slot, parentId, profile);
  }
  if (normalizedType === "Form") {
    return renderLayoutIntentForm(intent, slot, parentId, profile);
  }
  if (normalizedType === "Upload") {
    return renderLayoutIntentUpload(intent, slot, parentId, profile);
  }
  if (normalizedType === "Select") {
    return [renderLayoutIntentSelect(intent, slot, parentId, profile)];
  }
  if (normalizedType === "RadioGroup" || normalizedType === "CheckboxGroup") {
    return renderLayoutIntentChoiceGroup(intent, slot, parentId, profile, normalizedType);
  }
  if (normalizedType === "EmptyState") {
    return renderLayoutIntentEmptyState(intent, slot, parentId, profile);
  }
  if (normalizedType === "ListItem") {
    return renderLayoutIntentListItem(intent, slot, parentId, profile);
  }
  if (normalizedType === "CardList") {
    return renderLayoutIntentCardList(intent, slot, parentId, profile, depth);
  }
  if (normalizedType === "Modal" || normalizedType === "Drawer") {
    return renderLayoutIntentOverlay(intent, slot, parentId, profile, depth, normalizedType);
  }
  if (normalizedType === "Steps") {
    return renderLayoutIntentSteps(intent, slot, parentId, profile);
  }
  if (normalizedType === "DescriptionList") {
    return renderLayoutIntentDescriptionList(intent, slot, parentId, profile);
  }
  if (normalizedType === "Tabs") {
    return renderLayoutIntentTabs(intent, slot, parentId, profile);
  }
  if (normalizedType === "Pagination") {
    return renderLayoutIntentPagination(intent, slot, parentId, profile);
  }
  if (normalizedType === "StatusTag") {
    return [renderLayoutIntentStatusTag(intent, slot, parentId)];
  }
  if (normalizedType === "Card" || normalizedType === "Panel") {
    return renderLayoutIntentSurface(intent, slot, parentId, profile, depth, normalizedType);
  }
  return [renderLayoutIntentPrimitive(intent, slot, parentId, profile, normalizedType)];
}

function renderLayoutIntentRepeat(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile,
  depth: number
) {
  const template = intent.children?.[0];
  if (!template) return [];
  const items = normalizeRepeatItems(intent);
  const repeatedChildren = items.map((item, index) => applyRepeatItemToIntent(template, item, index));
  return renderLayoutIntentGrid({
    ...intent,
    type: "Grid",
    children: repeatedChildren,
    props: {
      ...intent.props,
      columns: intent.props?.columns ?? (profile.platform === "pc_web" ? Math.min(4, Math.max(1, repeatedChildren.length)) : 1)
    }
  }, slot, parentId, profile, depth);
}

function computeIntentChildSlots(
  intent: LayoutIntentDraftNode,
  children: LayoutIntentDraftNode[],
  inner: LayoutBounds,
  gap: number,
  profile: DesignCapabilityProfile,
  normalizedType: string,
  direction: "vertical" | "horizontal"
) {
  if (intent.layout === "twoColumn") {
    return computeColumnLayoutSlots(children, inner, gap, profile, [1, 1]);
  }
  if (intent.layout === "masterDetail") {
    return computeColumnLayoutSlots(children, inner, gap, profile, [0.36, 0.64]);
  }
  if (intent.layout === "cards") {
    return computeGridLikeSlots(children, inner, gap, profile, Math.min(4, Math.max(1, Number(intent.props?.columns ?? 3) || 3)));
  }
  if (intent.layout === "dashboard") {
    return computeDashboardSlots(children, inner, gap, profile);
  }
  if (direction === "horizontal") {
    return computeHorizontalIntentSlots(children, inner, gap, profile, normalizedType === "ActionBar" ? "end" : intent.align ?? "start");
  }
  return computeVerticalIntentSlots(children, inner, gap, profile);
}

function renderLayoutIntentStack(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile,
  depth: number,
  normalizedType: string
): WorkspaceDesignNode[] {
  const padding = resolveDensitySpace(resolveIntentSpace(intent.padding, profile, normalizedType === "Page" ? "lg" : "md"), intent.density);
  const gap = resolveDensitySpace(resolveIntentSpace(intent.gap, profile, "md"), intent.density);
  const direction = intent.direction ?? "vertical";
  const children = expandLayoutIntentChildren(intent.children ?? []);
  const container = normalizedType === "Page" ? undefined : createCompilerNode(normalizedType === "Section" ? "container" : "container", {
    parentId,
    name: intent.name ?? intent.title ?? normalizedType,
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    fill: intent.fill ?? (normalizedType === "Toolbar" || normalizedType === "ActionBar" ? "transparent" : "#ffffff"),
    stroke: intent.stroke ?? (normalizedType === "Section" ? "#e6edf5" : "transparent"),
    radius: intent.radius ?? (normalizedType === "Section" ? (profile.platform === "pc_web" ? 8 : 16) : 0)
  });
  const childParentId = container?.id ?? parentId;
  const inner = {
    x: slot.x + padding,
    y: slot.y + padding,
    width: Math.max(1, slot.width - padding * 2),
    height: Math.max(1, slot.height - padding * 2)
  };
  const childSlots = computeIntentChildSlots(intent, children, inner, gap, profile, normalizedType, direction);
  const childNodes = children.flatMap((child, index) => renderLayoutIntentNode(child, childSlots[index], childParentId, profile, depth + 1));
  return container ? [container, ...childNodes] : childNodes;
}

function renderLayoutIntentGrid(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile,
  depth: number
) {
  const children = expandLayoutIntentChildren(intent.children ?? []);
  const padding = resolveDensitySpace(resolveIntentSpace(intent.padding, profile, "md"), intent.density);
  const gap = resolveDensitySpace(resolveIntentSpace(intent.gap, profile, "md"), intent.density);
  const inner = {
    x: slot.x + padding,
    y: slot.y + padding,
    width: Math.max(1, slot.width - padding * 2),
    height: Math.max(1, slot.height - padding * 2)
  };
  if (intent.layout === "twoColumn") {
    const slots = computeColumnLayoutSlots(children, inner, gap, profile, [1, 1]);
    return children.flatMap((child, index) => renderLayoutIntentNode(child, slots[index], parentId, profile, depth + 1));
  }
  if (intent.layout === "masterDetail") {
    const slots = computeColumnLayoutSlots(children, inner, gap, profile, [0.36, 0.64]);
    return children.flatMap((child, index) => renderLayoutIntentNode(child, slots[index], parentId, profile, depth + 1));
  }
  const columns = Math.max(1, Math.min(4, Number(intent.props?.columns ?? intent.columnCount ?? intent.columns?.length ?? 3) || 3));
  const cellWidth = Math.max(80, (inner.width - gap * (columns - 1)) / columns);
  const rows = Math.max(1, Math.ceil(children.length / columns));
  const cellHeight = Math.max(80, (inner.height - gap * (rows - 1)) / rows);
  return children.flatMap((child, index) => renderLayoutIntentNode(child, {
    x: inner.x + (index % columns) * (cellWidth + gap),
    y: inner.y + Math.floor(index / columns) * (cellHeight + gap),
    width: cellWidth,
    height: cellHeight
  }, parentId, profile, depth + 1));
}

function renderLayoutIntentSurface(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile,
  depth: number,
  normalizedType: string
) {
  const surface = createCompilerNode(normalizedType === "Card" ? "card" : "container", {
    parentId,
    name: intent.name ?? intent.title ?? normalizedType,
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    fill: intent.fill ?? getIntentToneFill(intent.tone, "#ffffff"),
    stroke: intent.stroke ?? getIntentToneStroke(intent.tone, "#e6edf5"),
    radius: intent.radius ?? (profile.platform === "pc_web" ? 8 : 16)
  });
  const children = intent.children ?? [];
  if (children.length === 0) return [surface];
  const padding = resolveDensitySpace(resolveIntentSpace(intent.padding, profile, "md"), intent.density);
  const gap = resolveDensitySpace(resolveIntentSpace(intent.gap, profile, "md"), intent.density);
  const childSlots = computeVerticalIntentSlots(children, {
    x: slot.x + padding,
    y: slot.y + padding,
    width: Math.max(1, slot.width - padding * 2),
    height: Math.max(1, slot.height - padding * 2)
  }, gap, profile);
  return [surface, ...children.flatMap((child, index) => renderLayoutIntentNode(child, childSlots[index], surface.id, profile, depth + 1))];
}

function renderLayoutIntentFilterBar(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile
) {
  const isPc = profile.platform === "pc_web" || profile.platform === "responsive_web";
  const fields = intent.fields?.length ? intent.fields : (intent.children ?? []).map((child) => child.label ?? child.title ?? child.name ?? "筛选项").slice(0, 4);
  if (!isPc) {
    return [renderLayoutIntentPrimitive({ type: "Input", text: intent.text ?? `搜索${fields[0] ?? ""}` }, slot, parentId, profile, "Input")];
  }
  const card = createCompilerNode("card", {
    parentId,
    name: intent.name ?? "筛选区域",
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    fill: "#ffffff",
    stroke: "#e6edf5",
    radius: 8
  });
  const gap = resolveIntentSpace("md", profile, "md");
  const inputWidth = Math.max(150, Math.min(220, (slot.width - 48 - 180 - gap * Math.max(0, fields.length - 1)) / Math.max(1, fields.length)));
  const nodes: WorkspaceDesignNode[] = [card];
  fields.slice(0, 4).forEach((field, index) => {
    const x = slot.x + 24 + index * (inputWidth + gap);
    nodes.push(createCompilerNode("input", {
      parentId: card.id,
      name: `${field}筛选`,
      x,
      y: slot.y + Math.max(16, Math.round((slot.height - 36) / 2)),
      width: inputWidth,
      height: 36,
      text: `请输入${field}`,
      fill: "#ffffff",
      stroke: "#d0d5dd",
      radius: 6
    }));
  });
  nodes.push(
    renderLayoutIntentPrimitive({ type: "Button", text: "查询", variant: "primary" }, { x: slot.x + slot.width - 180, y: slot.y + Math.max(16, Math.round((slot.height - 36) / 2)), width: 80, height: 36 }, card.id, profile, "Button"),
    renderLayoutIntentPrimitive({ type: "Button", text: "重置", variant: "secondary" }, { x: slot.x + slot.width - 92, y: slot.y + Math.max(16, Math.round((slot.height - 36) / 2)), width: 68, height: 36 }, card.id, profile, "Button")
  );
  return nodes;
}

function renderLayoutIntentMetricGroup(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile
) {
  const metrics = intent.metrics?.length ? intent.metrics : [
    { label: "总数", value: "8,392" },
    { label: "新增", value: "128" },
    { label: "待处理", value: "42" }
  ];
  const gap = resolveIntentSpace("md", profile, "md");
  const width = Math.max(72, (slot.width - gap * (metrics.length - 1)) / metrics.length);
  return metrics.slice(0, 4).flatMap((metric, index) => {
    const x = slot.x + index * (width + gap);
    const card = createCompilerNode("card", {
      parentId,
      name: `${metric.label}指标`,
      x,
      y: slot.y,
      width,
      height: slot.height,
      fill: "#ffffff",
      stroke: "#eef2f7",
      radius: profile.platform === "pc_web" ? 8 : 14
    });
    return [
      card,
      renderLayoutIntentPrimitive({ type: "Text", text: metric.value, variant: "title" }, { x: x + 16, y: slot.y + 16, width: width - 32, height: 28 }, card.id, profile, "Text"),
      renderLayoutIntentPrimitive({ type: "Text", text: metric.label, variant: "muted" }, { x: x + 16, y: slot.y + 48, width: width - 32, height: 22 }, card.id, profile, "Text")
    ];
  });
}

function renderLayoutIntentTable(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile
) {
  const isPc = profile.platform === "pc_web" || profile.platform === "responsive_web";
  const columns = intent.columns?.length ? intent.columns : ["名称", "状态", "创建时间", "操作"];
  const rows = intent.rows?.length ? intent.rows : [
    ["示例 A", "启用", "2026-05-08", "查看"],
    ["示例 B", "停用", "2026-05-07", "查看"],
    ["示例 C", "异常", "2026-05-06", "查看"]
  ];
  if (!isPc) {
    const gap = resolveIntentSpace("md", profile, "md");
    const cardHeight = 108;
    return rows.slice(0, 4).flatMap((row, rowIndex) => {
      const y = slot.y + rowIndex * (cardHeight + gap);
      const card = createCompilerNode("card", {
        parentId,
        name: `${intent.title ?? intent.name ?? "数据"}卡片${rowIndex + 1}`,
        x: slot.x,
        y,
        width: slot.width,
        height: cardHeight,
        fill: "#ffffff",
        stroke: "#eef2f7",
        radius: 16
      });
      const status = row.find((cell) => /待|已|启用|停用|异常|成功|失败|通过|驳回/.test(cell));
      return [
        card,
        renderLayoutIntentPrimitive({ type: "Text", text: row[0] ?? "记录", variant: "title" }, { x: slot.x + 16, y: y + 14, width: slot.width - 116, height: 24 }, card.id, profile, "Text"),
        status ? renderLayoutIntentStatusTag({ type: "StatusTag", text: status }, { x: slot.x + slot.width - 88, y: y + 14, width: 64, height: 28 }, card.id) : undefined,
        renderLayoutIntentPrimitive({ type: "Text", text: columns.slice(1, 4).map((column, index) => `${column}: ${row[index + 1] ?? "-"}`).join(" / "), variant: "muted" }, { x: slot.x + 16, y: y + 46, width: slot.width - 32, height: 22 }, card.id, profile, "Text"),
        renderLayoutIntentPrimitive({ type: "Text", text: row[row.length - 1] ?? "查看详情" }, { x: slot.x + 16, y: y + 74, width: slot.width - 32, height: 22 }, card.id, profile, "Text")
      ].filter((node): node is WorkspaceDesignNode => Boolean(node));
    });
  }
  const tableCard = createCompilerNode("card", {
    parentId,
    name: intent.name ?? intent.title ?? "数据表格",
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    fill: "#ffffff",
    stroke: "#e6edf5",
    radius: 8
  });
  const nodes: WorkspaceDesignNode[] = [tableCard];
  const titleHeight = intent.title || intent.name ? 52 : 20;
  if (intent.title || intent.name) {
    nodes.push(renderLayoutIntentPrimitive({ type: "Text", text: intent.title ?? intent.name, variant: "title" }, { x: slot.x + 24, y: slot.y + 18, width: 280, height: 28 }, tableCard.id, profile, "Text"));
  }
  const tableX = slot.x + 24;
  const tableY = slot.y + titleHeight;
  const tableWidth = slot.width - 48;
  const columnWidth = Math.max(80, Math.floor(tableWidth / Math.max(1, columns.length)));
  nodes.push(createCompilerNode("container", {
    parentId: tableCard.id,
    name: "表头背景",
    x: tableX,
    y: tableY,
    width: tableWidth,
    height: 44,
    fill: "#f8fafc",
    stroke: "#e6edf5",
    radius: 6
  }));
  columns.forEach((column, index) => {
    nodes.push(renderLayoutIntentPrimitive({ type: "Text", text: column }, {
      x: tableX + index * columnWidth + 16,
      y: tableY + 12,
      width: columnWidth - 24,
      height: 20
    }, tableCard.id, profile, "Text"));
  });
  rows.slice(0, Math.max(3, Math.floor((slot.height - titleHeight - 44) / 56))).forEach((row, rowIndex) => {
    const rowY = tableY + 44 + rowIndex * 56;
    nodes.push(createCompilerNode("container", {
      parentId: tableCard.id,
      name: `数据行${rowIndex + 1}`,
      x: tableX,
      y: rowY,
      width: tableWidth,
      height: 56,
      fill: rowIndex % 2 === 0 ? "#ffffff" : "#fcfcfd",
      stroke: "#eef2f7",
      radius: 0
    }));
    columns.forEach((column, colIndex) => {
      const cell = row[colIndex] ?? "";
      const cellSlot = {
        x: tableX + colIndex * columnWidth + 16,
        y: rowY + 14,
        width: columnWidth - 24,
        height: 28
      };
      nodes.push(/状态|审核|结果/.test(column) || /待|已|启用|停用|异常|成功|失败|通过|驳回/.test(cell)
        ? renderLayoutIntentStatusTag({ type: "StatusTag", text: cell }, { ...cellSlot, width: Math.min(88, cellSlot.width) }, tableCard.id)
        : renderLayoutIntentPrimitive({ type: "Text", text: cell }, { ...cellSlot, y: rowY + 18, height: 20 }, tableCard.id, profile, "Text"));
    });
  });
  return nodes;
}

function renderLayoutIntentForm(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile
) {
  const isPc = profile.platform === "pc_web" || profile.platform === "responsive_web";
  const fields = intent.fields?.length ? intent.fields : (intent.children ?? []).map((child) => child.label ?? child.title ?? child.name ?? "").filter(Boolean);
  const formFields = fields.length > 0 ? fields : ["名称", "类型", "状态", "备注"];
  const panel = createCompilerNode("card", {
    parentId,
    name: intent.name ?? intent.title ?? "表单",
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    fill: "#ffffff",
    stroke: "#e6edf5",
    radius: isPc ? 8 : 16
  });
  const nodes: WorkspaceDesignNode[] = [panel];
  const columns = isPc && slot.width > 720 ? 2 : 1;
  const gap = resolveIntentSpace("md", profile, "md");
  const rowHeight = isPc ? 68 : 64;
  const labelWidth = isPc ? 96 : slot.width - 32;
  const fieldWidth = columns === 2 ? Math.floor((slot.width - 48 - gap) / 2) : slot.width - 32;
  formFields.slice(0, 8).forEach((field, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = slot.x + 24 + column * (fieldWidth + gap);
    const y = slot.y + 24 + row * rowHeight;
    nodes.push(renderLayoutIntentPrimitive({ type: "Text", text: field }, { x, y, width: labelWidth, height: 22 }, panel.id, profile, "Text"));
    nodes.push(renderLayoutIntentPrimitive({ type: /类型|状态|分类|级别/.test(field) ? "Select" : "Input", text: `请输入${field}` }, {
      x: columns === 1 ? x : x + 104,
      y: columns === 1 ? y + 26 : y - 6,
      width: columns === 1 ? fieldWidth : fieldWidth - 104,
      height: isPc ? 36 : 44
    }, panel.id, profile, "Input"));
  });
  const childControls = (intent.children ?? []).filter((child) => !["Text", "Title"].includes(normalizeLayoutIntentType(child.type)));
  const childStartY = slot.y + 24 + Math.ceil(formFields.length / columns) * rowHeight + (childControls.length > 0 ? gap : 0);
  childControls.slice(0, 8).forEach((child, index) => {
    const normalizedChildType = normalizeLayoutIntentType(child.type);
    const controlHeight = getIntentPreferredSize(child, { x: slot.x, y: slot.y, width: fieldWidth, height: slot.height }, profile).height;
    const y = childStartY + index * (controlHeight + gap);
    const label = child.label ?? child.title ?? child.name;
    if (label && normalizedChildType !== "Upload") {
      nodes.push(renderLayoutIntentPrimitive({ type: "Text", text: label, variant: "muted" }, { x: slot.x + 24, y, width: fieldWidth, height: 22 }, panel.id, profile, "Text"));
    }
    const controlY = label && normalizedChildType !== "Upload" ? y + 26 : y;
    nodes.push(...renderLayoutIntentNode(child, {
      x: slot.x + 24,
      y: controlY,
      width: fieldWidth,
      height: normalizedChildType === "RadioGroup" || normalizedChildType === "CheckboxGroup" ? Math.max(56, controlHeight) : controlHeight
    }, panel.id, profile, 1));
  });
  const actions = intent.actions?.length ? intent.actions : ["保存", "取消"];
  const childControlsHeight = childControls.slice(0, 8).reduce((sum, child) => sum + getIntentPreferredSize(child, { x: slot.x, y: slot.y, width: fieldWidth, height: slot.height }, profile).height + gap, 0);
  const actionY = Math.min(slot.y + slot.height - 56, slot.y + 24 + Math.ceil(formFields.length / columns) * rowHeight + childControlsHeight + 8);
  actions.slice(0, 3).forEach((action, index) => {
    nodes.push(renderLayoutIntentPrimitive({ type: "Button", text: action, variant: index === 0 ? "primary" : "secondary" }, {
      x: slot.x + slot.width - 24 - (actions.length - index) * 96,
      y: actionY,
      width: 84,
      height: isPc ? 40 : 44
    }, panel.id, profile, "Button"));
  });
  return nodes;
}

function renderLayoutIntentUpload(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile
) {
  const isPc = profile.platform === "pc_web" || profile.platform === "responsive_web";
  const box = createCompilerNode("card", {
    parentId,
    name: intent.name ?? intent.title ?? intent.label ?? "上传",
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    fill: "#f8fafc",
    stroke: "#d0d5dd",
    radius: isPc ? 8 : 14
  });
  const title = intent.label ?? intent.title ?? intent.text ?? "上传文件";
  return [
    box,
    renderLayoutIntentPrimitive({ type: "Text", text: "+", emphasis: "medium" }, { x: slot.x, y: slot.y + Math.max(12, slot.height * 0.18), width: slot.width, height: 34 }, box.id, profile, "Text"),
    renderLayoutIntentPrimitive({ type: "Text", text: title, variant: "muted" }, { x: slot.x + 12, y: slot.y + Math.max(46, slot.height * 0.52), width: slot.width - 24, height: 24 }, box.id, profile, "Text")
  ];
}

function renderLayoutIntentSelect(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile
) {
  const control = renderLayoutIntentPrimitive({
    ...intent,
    type: "Input",
    text: intent.text ?? intent.label ?? intent.title ?? "请选择"
  }, slot, parentId, profile, "Input");
  return {
    ...control,
    name: intent.name ?? intent.label ?? "选择器",
    text: `${control.text ?? "请选择"}  >`
  };
}

function renderLayoutIntentChoiceGroup(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile,
  normalizedType: "RadioGroup" | "CheckboxGroup"
) {
  const options = normalizeChoiceOptions(intent);
  const isPc = profile.platform === "pc_web" || profile.platform === "responsive_web";
  const gap = resolveDensitySpace(resolveIntentSpace(intent.gap, profile, "sm"), intent.density);
  const nodes: WorkspaceDesignNode[] = [];
  let cursorX = slot.x;
  let cursorY = slot.y;
  const rowHeight = isPc ? 32 : 36;
  options.slice(0, 8).forEach((option, index) => {
    const labelWidth = Math.max(48, Math.min(slot.width, option.length * 14 + 32));
    if (!isPc && cursorX + labelWidth > slot.x + slot.width) {
      cursorX = slot.x;
      cursorY += rowHeight + gap;
    }
    const mark = createCompilerNode("container", {
      parentId,
      name: `${option}${normalizedType === "RadioGroup" ? "单选" : "多选"}`,
      x: cursorX,
      y: cursorY + 8,
      width: 16,
      height: 16,
      fill: index === 0 && normalizedType === "RadioGroup" ? "#246bfe" : "#ffffff",
      stroke: "#d0d5dd",
      radius: normalizedType === "RadioGroup" ? 8 : 4
    });
    nodes.push(mark);
    nodes.push(renderLayoutIntentPrimitive({ type: "Text", text: option }, { x: cursorX + 24, y: cursorY + 4, width: labelWidth - 24, height: 24 }, parentId, profile, "Text"));
    cursorX += labelWidth + gap;
  });
  return nodes;
}

function renderLayoutIntentEmptyState(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile
) {
  const panel = createCompilerNode("card", {
    parentId,
    name: intent.name ?? "空状态",
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    fill: "#ffffff",
    stroke: "#eef2f7",
    radius: profile.platform === "pc_web" ? 8 : 16
  });
  const iconSize = Math.min(64, Math.max(40, slot.height * 0.24));
  const iconX = slot.x + slot.width / 2 - iconSize / 2;
  return [
    panel,
    createCompilerNode("container", { parentId: panel.id, name: "空状态图标", x: iconX, y: slot.y + Math.max(18, slot.height * 0.18), width: iconSize, height: iconSize, fill: "#eff6ff", stroke: "transparent", radius: iconSize / 2 }),
    renderLayoutIntentPrimitive({ type: "Text", text: intent.title ?? intent.text ?? "暂无数据", variant: "title" }, { x: slot.x + 24, y: slot.y + slot.height * 0.55, width: slot.width - 48, height: 28 }, panel.id, profile, "Text"),
    renderLayoutIntentPrimitive({ type: "Text", text: intent.label ?? "稍后再试或调整筛选条件", variant: "muted" }, { x: slot.x + 24, y: slot.y + slot.height * 0.55 + 34, width: slot.width - 48, height: 24 }, panel.id, profile, "Text")
  ];
}

function renderLayoutIntentListItem(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile
) {
  const card = createCompilerNode("card", {
    parentId,
    name: intent.name ?? intent.title ?? "列表项",
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    fill: "#ffffff",
    stroke: "#eef2f7",
    radius: profile.platform === "pc_web" ? 8 : 14
  });
  const title = intent.title ?? intent.label ?? intent.text ?? "列表项";
  const desc = String(intent.props?.description ?? intent.props?.subtitle ?? "");
  const status = String(intent.props?.status ?? "");
  return [
    card,
    renderLayoutIntentPrimitive({ type: "Text", text: title, emphasis: "medium" }, { x: slot.x + 16, y: slot.y + 14, width: slot.width - (status ? 104 : 32), height: 24 }, card.id, profile, "Text"),
    desc ? renderLayoutIntentPrimitive({ type: "Text", text: desc, variant: "muted" }, { x: slot.x + 16, y: slot.y + 42, width: slot.width - 32, height: 22 }, card.id, profile, "Text") : undefined,
    status ? renderLayoutIntentStatusTag({ type: "StatusTag", text: status }, { x: slot.x + slot.width - 88, y: slot.y + 14, width: 64, height: 28 }, card.id) : undefined
  ].filter((node): node is WorkspaceDesignNode => Boolean(node));
}

function renderLayoutIntentCardList(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile,
  depth: number
) {
  const items = intent.children?.length ? intent.children : normalizeRepeatItems(intent).map((item) => ({
    type: "ListItem",
    title: item.label,
    props: { description: item.value }
  }));
  const gap = resolveDensitySpace(resolveIntentSpace(intent.gap, profile, "md"), intent.density);
  const itemHeight = profile.platform === "pc_web" || profile.platform === "responsive_web" ? 88 : 76;
  return items.slice(0, 8).flatMap((item, index) => renderLayoutIntentNode({
    ...item,
    type: normalizeLayoutIntentType(item.type) === "Text" ? "ListItem" : item.type
  }, {
    x: slot.x,
    y: slot.y + index * (itemHeight + gap),
    width: slot.width,
    height: itemHeight
  }, parentId, profile, depth + 1));
}

function renderLayoutIntentOverlay(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile,
  depth: number,
  normalizedType: "Modal" | "Drawer"
) {
  const isDrawer = normalizedType === "Drawer";
  const width = isDrawer ? Math.min(slot.width, profile.platform === "pc_web" ? 420 : slot.width) : Math.min(slot.width - 24, profile.platform === "pc_web" ? 520 : slot.width - 32);
  const height = isDrawer ? slot.height : Math.min(slot.height - 40, profile.platform === "pc_web" ? 420 : 360);
  const x = isDrawer ? slot.x + slot.width - width : slot.x + (slot.width - width) / 2;
  const y = isDrawer ? slot.y : slot.y + Math.max(20, (slot.height - height) / 2);
  return renderLayoutIntentSurface({
    ...intent,
    type: "Panel",
    title: intent.title ?? (isDrawer ? "抽屉" : "弹窗"),
    padding: intent.padding ?? "md"
  }, { x, y, width, height }, parentId, profile, depth, "Panel");
}

function renderLayoutIntentSteps(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile
) {
  const steps = normalizeChoiceOptions(intent);
  const isPc = profile.platform === "pc_web" || profile.platform === "responsive_web";
  const nodes: WorkspaceDesignNode[] = [];
  const count = Math.max(1, steps.length);
  steps.slice(0, 6).forEach((step, index) => {
    const x = isPc ? slot.x + index * (slot.width / count) : slot.x;
    const y = isPc ? slot.y : slot.y + index * 44;
    const dot = createCompilerNode("container", {
      parentId,
      name: `${step}步骤点`,
      x,
      y: y + 4,
      width: 24,
      height: 24,
      fill: index === 0 ? "#246bfe" : "#ffffff",
      stroke: index === 0 ? "transparent" : "#d0d5dd",
      radius: 12
    });
    nodes.push(dot);
    nodes.push(renderLayoutIntentPrimitive({ type: "Text", text: step }, { x: x + 32, y, width: isPc ? Math.max(80, slot.width / count - 40) : slot.width - 32, height: 28 }, parentId, profile, "Text"));
  });
  return nodes;
}

function renderLayoutIntentDescriptionList(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile
) {
  const isPc = profile.platform === "pc_web" || profile.platform === "responsive_web";
  const items = normalizeKeyValueItems(intent);
  const panel = createCompilerNode("card", {
    parentId,
    name: intent.name ?? intent.title ?? "详情信息",
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    fill: getIntentToneFill(intent.tone, "#ffffff"),
    stroke: getIntentToneStroke(intent.tone, "#e6edf5"),
    radius: isPc ? 8 : 16
  });
  const nodes: WorkspaceDesignNode[] = [panel];
  const padding = resolveDensitySpace(resolveIntentSpace(intent.padding, profile, "md"), intent.density);
  const gap = resolveDensitySpace(resolveIntentSpace(intent.gap, profile, "sm"), intent.density);
  const columns = isPc && slot.width > 720 ? 2 : 1;
  const rowHeight = isPc ? 40 : 44;
  const columnWidth = Math.max(120, (slot.width - padding * 2 - gap * (columns - 1)) / columns);
  items.slice(0, 12).forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = slot.x + padding + column * (columnWidth + gap);
    const y = slot.y + padding + row * rowHeight;
    const labelWidth = Math.min(104, Math.max(64, columnWidth * 0.34));
    if (!isPc && item.value.length > 10) {
      const itemY = slot.y + padding + index * 64;
      nodes.push(renderLayoutIntentPrimitive({ type: "Text", text: item.label, variant: "muted" }, { x, y: itemY, width: columnWidth, height: 22 }, panel.id, profile, "Text"));
      nodes.push(renderLayoutIntentPrimitive({ type: "Text", text: item.value, emphasis: item.emphasis }, { x, y: itemY + 26, width: columnWidth, height: 34 }, panel.id, profile, "Text"));
      return;
    }
    nodes.push(renderLayoutIntentPrimitive({ type: "Text", text: item.label, variant: "muted" }, { x, y, width: labelWidth, height: 24 }, panel.id, profile, "Text"));
    nodes.push(renderLayoutIntentPrimitive({ type: "Text", text: item.value, emphasis: item.emphasis }, { x: x + labelWidth + 8, y, width: columnWidth - labelWidth - 8, height: 24 }, panel.id, profile, "Text"));
  });
  return nodes;
}

function renderLayoutIntentTabs(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile
) {
  const tabs = (intent.children ?? []).map((child) => child.label ?? child.title ?? child.name ?? child.text ?? "标签").slice(0, 6);
  const labels = tabs.length > 0 ? tabs : ["全部", "待处理", "已完成"];
  const nodes: WorkspaceDesignNode[] = [];
  let cursorX = slot.x;
  labels.forEach((label, index) => {
    const width = Math.max(64, label.length * 18 + 28);
    nodes.push(createCompilerNode("container", {
      parentId,
      name: `${label}标签页`,
      x: cursorX,
      y: slot.y,
      width,
      height: Math.min(slot.height, 40),
      fill: index === 0 ? "#eff6ff" : "transparent",
      stroke: index === 0 ? "#bfdbfe" : "transparent",
      radius: 6
    }));
    nodes.push(renderLayoutIntentPrimitive({ type: "Text", text: label }, { x: cursorX + 14, y: slot.y + 9, width: width - 28, height: 20 }, parentId, profile, "Text"));
    cursorX += width + resolveIntentSpace("sm", profile, "sm");
  });
  return nodes;
}

function renderLayoutIntentPagination(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile
) {
  const totalText = intent.text ?? "共 128 条记录";
  return [
    renderLayoutIntentPrimitive({ type: "Text", text: totalText, variant: "muted" }, { x: slot.x, y: slot.y + 10, width: 220, height: 24 }, parentId, profile, "Text"),
    renderLayoutIntentPrimitive({ type: "Button", text: "上一页", variant: "secondary" }, { x: slot.x + slot.width - 176, y: slot.y + 6, width: 76, height: 32 }, parentId, profile, "Button"),
    renderLayoutIntentPrimitive({ type: "Button", text: "下一页", variant: "secondary" }, { x: slot.x + slot.width - 88, y: slot.y + 6, width: 76, height: 32 }, parentId, profile, "Button")
  ];
}

function renderLayoutIntentStatusTag(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string
) {
  const text = intent.text ?? intent.label ?? intent.title ?? "状态";
  return createCompilerNode("button", {
    parentId,
    name: `${text}状态标签`,
    x: slot.x,
    y: slot.y,
    width: Math.max(56, Math.min(slot.width, text.length * 14 + 28)),
    height: Math.min(slot.height, 28),
    text,
    fill: getStatusFill(text),
    stroke: "transparent",
    textColor: getStatusColor(text),
    radius: 14,
    fontSize: 13,
    lineHeight: 28,
    textAlign: "center",
    textVerticalAlign: "middle"
  });
}

function renderLayoutIntentPrimitive(
  intent: LayoutIntentDraftNode,
  slot: LayoutBounds,
  parentId: string,
  profile: DesignCapabilityProfile,
  normalizedType: string
): WorkspaceDesignNode {
  const tokens = profile.libraries[0]?.tokens;
  if (normalizedType === "Button") {
    const secondary = intent.variant === "secondary" || intent.variant === "ghost" || intent.priority === "secondary";
    const controlHeight = Math.min(slot.height, profile.platform === "pc_web" ? 40 : 48);
    const fill = intent.fill ?? (secondary ? "#ffffff" : getIntentToneButtonFill(intent.tone, tokens?.colors.primary ?? "#1677ff"));
    return createCompilerNode("button", {
      parentId,
      name: intent.name ?? intent.label ?? intent.text ?? "按钮",
      x: slot.x,
      y: slot.y + Math.max(0, Math.round((slot.height - controlHeight) / 2)),
      width: slot.width,
      height: controlHeight,
      text: intent.text ?? intent.label ?? intent.title ?? "按钮",
      fill,
      stroke: intent.stroke ?? (secondary ? getIntentToneStroke(intent.tone, "#d0d5dd") : "transparent"),
      textColor: intent.textColor ?? intent.color ?? (secondary ? getIntentToneTextColor(intent.tone, "#344054") : "#ffffff"),
      radius: intent.radius ?? tokens?.radius.button ?? (profile.platform === "pc_web" ? 6 : 16),
      fontSize: intent.fontSize ?? 14,
      lineHeight: normalizeLineHeight(intent.lineHeight, controlHeight),
      textAlign: intent.textAlign ?? "center",
      textVerticalAlign: "middle"
    });
  }
  if (normalizedType === "Input" || normalizedType === "Field") {
    const controlHeight = Math.min(slot.height, profile.platform === "pc_web" ? 36 : 44);
    return createCompilerNode("input", {
      parentId,
      name: intent.name ?? intent.label ?? "输入框",
      x: slot.x,
      y: slot.y + Math.max(0, Math.round((slot.height - controlHeight) / 2)),
      width: slot.width,
      height: controlHeight,
      text: intent.text ?? intent.label ?? "请输入",
      fill: intent.fill ?? "#ffffff",
      stroke: intent.stroke ?? tokens?.colors.border ?? "#d0d5dd",
      radius: intent.radius ?? tokens?.radius.control ?? (profile.platform === "pc_web" ? 6 : 14),
      textColor: intent.textColor ?? intent.color ?? "#667085",
      fontSize: intent.fontSize ?? 14,
      lineHeight: normalizeLineHeight(intent.lineHeight, controlHeight),
      textVerticalAlign: "middle"
    });
  }
  if (normalizedType === "Image") {
    return createCompilerNode("image", {
      parentId,
      name: intent.name ?? intent.title ?? "图片",
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      fill: intent.fill ?? "#eef4ff",
      stroke: intent.stroke ?? "transparent",
      radius: intent.radius ?? (profile.platform === "pc_web" ? 8 : 14),
      imageUrl: intent.imageUrl ?? intent.src
    });
  }
  const isTitle = intent.variant === "title" || normalizedType === "Title";
  const isMuted = intent.variant === "muted" || intent.role === "description";
  const fontSize = intent.fontSize ?? (isTitle ? (profile.platform === "pc_web" ? 22 : 20) : 14);
  return createCompilerNode("text", {
    parentId,
    name: intent.name ?? intent.title ?? "文本",
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    text: intent.text ?? intent.title ?? intent.label ?? intent.name ?? "文本",
    fill: "transparent",
    stroke: "transparent",
    strokeWidth: 0,
    textColor: intent.textColor ?? intent.color ?? (isMuted ? "#667085" : getIntentToneTextColor(intent.tone, tokens?.colors.text ?? "#101828")),
    fontSize,
    fontWeight: parseFontWeight(intent.fontWeight) ?? (isTitle || intent.emphasis === "high" ? 700 : intent.emphasis === "medium" ? 600 : undefined),
    lineHeight: normalizeLineHeight(intent.lineHeight, Math.max(fontSize + 8, isTitle ? 30 : 22)),
    textAlign: intent.textAlign ?? "left",
    textVerticalAlign: "top"
  });
}

function getIntentToneFill(tone: LayoutIntentDraftNode["tone"], fallback: string) {
  if (tone === "primary") return "#eff6ff";
  if (tone === "success") return "#ecfdf3";
  if (tone === "warning") return "#fffaeb";
  if (tone === "danger") return "#fef3f2";
  if (tone === "muted") return "#f8fafc";
  return fallback;
}

function getIntentToneStroke(tone: LayoutIntentDraftNode["tone"], fallback: string) {
  if (tone === "primary") return "#bfdbfe";
  if (tone === "success") return "#abefc6";
  if (tone === "warning") return "#fedf89";
  if (tone === "danger") return "#fecdca";
  if (tone === "muted") return "#e4e7ec";
  return fallback;
}

function getIntentToneTextColor(tone: LayoutIntentDraftNode["tone"], fallback: string) {
  if (tone === "primary") return "#175cd3";
  if (tone === "success") return "#067647";
  if (tone === "warning") return "#b54708";
  if (tone === "danger") return "#b42318";
  if (tone === "muted") return "#667085";
  return fallback;
}

function getIntentToneButtonFill(tone: LayoutIntentDraftNode["tone"], fallback: string) {
  if (tone === "success") return "#12b76a";
  if (tone === "warning") return "#f79009";
  if (tone === "danger") return "#f04438";
  return fallback;
}

function expandLayoutIntentChildren(children: LayoutIntentDraftNode[]) {
  return children.flatMap((child) => {
    if (normalizeLayoutIntentType(child.type) !== "Repeat") return [child];
    const template = child.children?.[0];
    if (!template) return [];
    return normalizeRepeatItems(child).map((item, index) => applyRepeatItemToIntent(template, item, index));
  });
}

function normalizeRepeatItems(intent: LayoutIntentDraftNode) {
  if (intent.items?.length) {
    return intent.items.map((item) => typeof item === "string" ? { label: item, value: item } : item);
  }
  const repeat = Math.max(1, Math.min(24, intent.repeat ?? 1));
  return Array.from({ length: repeat }, (_, index) => ({
    label: `${intent.label ?? intent.title ?? intent.name ?? "项目"} ${index + 1}`,
    value: `${index + 1}`
  }));
}

function applyRepeatItemToIntent(
  template: LayoutIntentDraftNode,
  item: Record<string, string>,
  index: number
): LayoutIntentDraftNode {
  const replace = (value: string | undefined) => {
    if (!value) return value;
    return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => item[key] ?? (key === "index" ? String(index + 1) : ""));
  };
  return {
    ...template,
    name: replace(template.name),
    title: replace(template.title),
    text: replace(template.text) ?? item.text ?? item.label ?? template.text,
    label: replace(template.label) ?? item.label ?? template.label,
    children: template.children?.map((child) => applyRepeatItemToIntent(child, item, index))
  };
}

function normalizeKeyValueItems(intent: LayoutIntentDraftNode) {
  if (intent.items?.length) {
    return intent.items.map((item, index) => {
      if (typeof item === "string") return { label: item, value: "-", emphasis: undefined as LayoutIntentDraftNode["emphasis"] };
      const label = item.label ?? item.name ?? item.key ?? `字段 ${index + 1}`;
      const value = item.value ?? item.text ?? item.content ?? "-";
      return { label, value, emphasis: item.emphasis as LayoutIntentDraftNode["emphasis"] };
    });
  }
  if (intent.fields?.length) {
    return intent.fields.map((field) => ({ label: field, value: "-", emphasis: undefined as LayoutIntentDraftNode["emphasis"] }));
  }
  return (intent.children ?? []).map((child, index) => {
    const childTexts = (child.children ?? [])
      .map((item) => item.text ?? item.label ?? item.title ?? item.name)
      .filter((item): item is string => Boolean(item && item.trim()));
    const explicitLabel = child.label ?? child.title ?? child.props?.label?.toString();
    const explicitValue = child.text ?? child.props?.value?.toString();
    if (childTexts.length >= 2) {
      return {
        label: stripKeyValueLabel(explicitLabel ?? childTexts[0]),
        value: childTexts.slice(1).join(" / "),
        emphasis: child.emphasis
      };
    }
    return {
      label: stripKeyValueLabel(explicitLabel ?? child.name ?? `字段 ${index + 1}`),
      value: explicitValue ?? childTexts[0] ?? "-",
      emphasis: child.emphasis
    };
  });
}

function stripKeyValueLabel(label: string) {
  return label.replace(/^(规格项|字段|信息项|详情项)[-_:：\s]*/i, "").replace(/^(规格标签|标签|label)[-_:：\s]*/i, "").replace(/[：:]\s*$/, "：");
}

function estimateTextHeight(intent: LayoutIntentDraftNode, width: number) {
  const text = intent.text ?? intent.title ?? intent.label ?? intent.name ?? "";
  const fontSize = intent.fontSize ?? (intent.variant === "title" ? 22 : 14);
  const lineHeight = normalizeLineHeight(intent.lineHeight, Math.max(fontSize + 8, 22)) ?? 22;
  const charsPerLine = Math.max(8, Math.floor(Math.max(80, width) / Math.max(8, fontSize)));
  const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
  return Math.ceil(lines * lineHeight);
}

function getDescriptionListPreferredHeight(intent: LayoutIntentDraftNode, parent: LayoutBounds, profile: DesignCapabilityProfile) {
  const isPc = profile.platform === "pc_web" || profile.platform === "responsive_web";
  const itemCount = Math.max(1, normalizeKeyValueItems(intent).length);
  const columns = isPc && parent.width > 720 ? 2 : 1;
  const rows = Math.ceil(itemCount / columns);
  const padding = resolveDensitySpace(resolveIntentSpace(intent.padding, profile, "md"), intent.density);
  const rowHeight = isPc ? 40 : 52;
  return Math.max(isPc ? 96 : 120, rows * rowHeight + padding * 2);
}

function normalizeChoiceOptions(intent: LayoutIntentDraftNode) {
  const values = [
    ...(intent.items ?? []).map((item) => typeof item === "string" ? item : item.label ?? item.name ?? item.value ?? ""),
    ...(intent.options ?? [] as unknown[]).map((item) => typeof item === "string" ? item : isRecordLikeIntentValue(item) ? String(item.label ?? item.name ?? item.value ?? "") : ""),
    ...(intent.children ?? []).map((child) => child.label ?? child.title ?? child.name ?? child.text ?? "")
  ].filter((item): item is string => Boolean(item && item.trim()));
  return values.length > 0 ? Array.from(new Set(values)).slice(0, 12) : ["选项一", "选项二", "选项三"];
}

function isRecordLikeIntentValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function computeVerticalIntentSlots(
  children: LayoutIntentDraftNode[],
  slot: LayoutBounds,
  gap: number,
  profile: DesignCapabilityProfile
): LayoutBounds[] {
  const preferred = children.map((child) => getIntentPreferredSize(child, slot, profile).height);
  const fillIndexes = children.map((child, index) => child.height === "fill" || normalizeLayoutIntentType(child.type) === "Table" ? index : -1).filter((index) => index >= 0);
  const fixedTotal = preferred.reduce((sum, height, index) => fillIndexes.includes(index) ? sum : sum + height, 0);
  const gapsTotal = gap * Math.max(0, children.length - 1);
  const fillHeight = fillIndexes.length > 0 ? Math.max(80, (slot.height - fixedTotal - gapsTotal) / fillIndexes.length) : 0;
  let cursorY = slot.y;
  return children.map((child, index) => {
    const height = fillIndexes.includes(index) ? fillHeight : preferred[index];
    const frame = { x: slot.x, y: cursorY, width: slot.width, height: Math.min(height, Math.max(1, slot.y + slot.height - cursorY)) };
    cursorY += height + gap;
    return frame;
  });
}

function computeHorizontalIntentSlots(
  children: LayoutIntentDraftNode[],
  slot: LayoutBounds,
  gap: number,
  profile: DesignCapabilityProfile,
  align: "start" | "center" | "end" | "between" = "start"
): LayoutBounds[] {
  const preferred = children.map((child) => getIntentPreferredSize(child, slot, profile).width);
  const fillIndexes = children.map((child, index) => child.width === "fill" ? index : -1).filter((index) => index >= 0);
  const fixedTotal = preferred.reduce((sum, width, index) => fillIndexes.includes(index) ? sum : sum + width, 0);
  const gapsTotal = gap * Math.max(0, children.length - 1);
  const fillWidth = fillIndexes.length > 0 ? Math.max(64, (slot.width - fixedTotal - gapsTotal) / fillIndexes.length) : 0;
  const widths = children.map((_, index) => fillIndexes.length > 0 && fillIndexes.includes(index) ? fillWidth : preferred[index]);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gapsTotal;
  const betweenGap = align === "between" && children.length > 1
    ? Math.max(gap, (slot.width - widths.reduce((sum, width) => sum + width, 0)) / (children.length - 1))
    : gap;
  let cursorX = slot.x;
  if (align === "end") cursorX = slot.x + Math.max(0, slot.width - totalWidth);
  if (align === "center") cursorX = slot.x + Math.max(0, (slot.width - totalWidth) / 2);
  return children.map((child, index) => {
    const width = widths[index];
    const frame = { x: cursorX, y: slot.y, width: Math.min(width, Math.max(1, slot.x + slot.width - cursorX)), height: slot.height };
    cursorX += width + betweenGap;
    return frame;
  });
}

function computeColumnLayoutSlots(
  children: LayoutIntentDraftNode[],
  slot: LayoutBounds,
  gap: number,
  profile: DesignCapabilityProfile,
  ratios: [number, number]
) {
  if (children.length === 0) return [];
  if (children.length === 1) return [slot];
  const leftWidth = Math.max(120, Math.round((slot.width - gap) * ratios[0] / (ratios[0] + ratios[1])));
  const rightWidth = Math.max(120, slot.width - gap - leftWidth);
  const leftChildren = children.filter((child, index) => child.slot === "sidebar" || (child.slot !== "detail" && index % 2 === 0));
  const rightChildren = children.filter((child, index) => child.slot === "detail" || (child.slot !== "sidebar" && index % 2 === 1));
  const leftSlots = computeVerticalIntentSlots(leftChildren, { x: slot.x, y: slot.y, width: leftWidth, height: slot.height }, gap, profile);
  const rightSlots = computeVerticalIntentSlots(rightChildren, { x: slot.x + leftWidth + gap, y: slot.y, width: rightWidth, height: slot.height }, gap, profile);
  const queue = new Map<LayoutIntentDraftNode, LayoutBounds>();
  leftChildren.forEach((child, index) => queue.set(child, leftSlots[index]));
  rightChildren.forEach((child, index) => queue.set(child, rightSlots[index]));
  return children.map((child) => queue.get(child) ?? slot);
}

function computeGridLikeSlots(
  children: LayoutIntentDraftNode[],
  slot: LayoutBounds,
  gap: number,
  profile: DesignCapabilityProfile,
  columns: number
) {
  const columnCount = profile.platform === "pc_web" || profile.platform === "responsive_web" ? columns : 1;
  const cellWidth = Math.max(80, (slot.width - gap * Math.max(0, columnCount - 1)) / columnCount);
  const rows = Math.max(1, Math.ceil(children.length / columnCount));
  const preferredHeight = Math.max(...children.map((child) => getIntentPreferredSize(child, slot, profile).height), 96);
  const cellHeight = Math.min(Math.max(96, preferredHeight), Math.max(96, (slot.height - gap * Math.max(0, rows - 1)) / rows));
  return children.map((_, index) => ({
    x: slot.x + (index % columnCount) * (cellWidth + gap),
    y: slot.y + Math.floor(index / columnCount) * (cellHeight + gap),
    width: cellWidth,
    height: cellHeight
  }));
}

function computeDashboardSlots(
  children: LayoutIntentDraftNode[],
  slot: LayoutBounds,
  gap: number,
  profile: DesignCapabilityProfile
) {
  const summary = children.filter((child) => child.slot === "summary" || normalizeLayoutIntentType(child.type) === "MetricGroup");
  const rest = children.filter((child) => !summary.includes(child));
  if (summary.length === 0) return computeVerticalIntentSlots(children, slot, gap, profile);
  const summaryHeight = Math.min(120, Math.max(88, slot.height * 0.18));
  const summarySlots = computeGridLikeSlots(summary, { x: slot.x, y: slot.y, width: slot.width, height: summaryHeight }, gap, profile, Math.min(4, Math.max(1, summary.length)));
  const restSlots = computeVerticalIntentSlots(rest, { x: slot.x, y: slot.y + summaryHeight + gap, width: slot.width, height: Math.max(1, slot.height - summaryHeight - gap) }, gap, profile);
  const queue = new Map<LayoutIntentDraftNode, LayoutBounds>();
  summary.forEach((child, index) => queue.set(child, summarySlots[index]));
  rest.forEach((child, index) => queue.set(child, restSlots[index]));
  return children.map((child) => queue.get(child) ?? slot);
}

function getIntentPreferredSize(intent: LayoutIntentDraftNode, parent: LayoutBounds, profile: DesignCapabilityProfile): { width: number; height: number } {
  const normalizedType = normalizeLayoutIntentType(intent.type);
  if ((intent.width === "hug" || normalizedType === "ActionBar") && intent.width !== "fill" && intent.children?.length) {
    const gap = resolveIntentSpace(intent.gap, profile, "sm");
    const childSizes: Array<{ width: number; height: number }> = intent.children.map((child) => getIntentPreferredSize(child, parent, profile));
    return {
      width: childSizes.reduce((sum, size) => sum + size.width, 0) + gap * Math.max(0, childSizes.length - 1),
      height: Math.max(...childSizes.map((size) => size.height), 1)
    };
  }
  const explicitWidth = typeof intent.width === "number" ? intent.width : undefined;
  const explicitHeight = typeof intent.height === "number" ? intent.height : undefined;
  const isPc = profile.platform === "pc_web" || profile.platform === "responsive_web";
  if (!explicitHeight && intent.children?.length && ["Card", "Panel", "Section", "Stack"].includes(normalizedType)) {
    const padding = resolveDensitySpace(resolveIntentSpace(intent.padding, profile, normalizedType === "Section" ? "lg" : "md"), intent.density);
    const gap = resolveDensitySpace(resolveIntentSpace(intent.gap, profile, "md"), intent.density);
    const childSizes = intent.children.map((child) => getIntentPreferredSize(child, parent, profile));
    if (intent.direction === "horizontal") {
      return {
        width: explicitWidth ?? parent.width,
        height: Math.max(80, Math.max(...childSizes.map((size) => size.height), 1) + padding * 2)
      };
    }
    return {
      width: explicitWidth ?? parent.width,
      height: Math.max(80, childSizes.reduce((sum, size) => sum + size.height, 0) + gap * Math.max(0, childSizes.length - 1) + padding * 2)
    };
  }
  if (!explicitHeight && normalizedType === "Grid" && intent.children?.length) {
    const padding = resolveDensitySpace(resolveIntentSpace(intent.padding, profile, "md"), intent.density);
    const gap = resolveDensitySpace(resolveIntentSpace(intent.gap, profile, "md"), intent.density);
    if (intent.layout === "twoColumn" || intent.layout === "masterDetail") {
      const childHeights = intent.children.map((child) => getIntentPreferredSize(child, parent, profile).height);
      return { width: explicitWidth ?? parent.width, height: Math.max(180, Math.max(...childHeights, 1) + padding * 2) };
    }
    const columns = Math.max(1, Math.min(4, Number(intent.props?.columns ?? intent.columnCount ?? intent.columns?.length ?? 3) || 3));
    const rows = Math.max(1, Math.ceil(intent.children.length / columns));
    const childHeight = Math.max(...intent.children.map((child) => getIntentPreferredSize(child, parent, profile).height), 96);
    return { width: explicitWidth ?? parent.width, height: Math.max(180, rows * childHeight + gap * (rows - 1) + padding * 2) };
  }
  const defaults: Record<string, { width: number; height: number }> = {
    Text: { width: parent.width, height: Math.max(intent.variant === "title" ? 32 : 24, estimateTextHeight(intent, parent.width)) },
    Title: { width: parent.width, height: 34 },
    Button: { width: isPc ? 96 : parent.width, height: isPc ? 40 : 48 },
    Input: { width: isPc ? 220 : parent.width, height: isPc ? 36 : 44 },
    Field: { width: parent.width, height: isPc ? 40 : 52 },
    Select: { width: isPc ? 220 : parent.width, height: isPc ? 36 : 44 },
    Upload: { width: parent.width, height: isPc ? 128 : 104 },
    RadioGroup: { width: parent.width, height: isPc ? 40 : 80 },
    CheckboxGroup: { width: parent.width, height: isPc ? 40 : 96 },
    Image: { width: parent.width, height: isPc ? 160 : 120 },
    Toolbar: { width: parent.width, height: isPc ? 56 : 48 },
    ActionBar: { width: parent.width, height: isPc ? 48 : 56 },
    FilterBar: { width: parent.width, height: isPc ? 92 : 44 },
    MetricGroup: { width: parent.width, height: isPc ? 96 : 82 },
    Table: { width: parent.width, height: Math.max(240, parent.height * 0.55) },
    Form: { width: parent.width, height: isPc ? Math.max(280, parent.height * 0.5) : Math.max(320, parent.height * 0.56) },
    DescriptionList: { width: parent.width, height: getDescriptionListPreferredHeight(intent, parent, profile) },
    Tabs: { width: parent.width, height: 44 },
    Pagination: { width: parent.width, height: 44 },
    EmptyState: { width: parent.width, height: isPc ? 220 : 180 },
    ListItem: { width: parent.width, height: isPc ? 88 : 76 },
    CardList: { width: parent.width, height: Math.max(220, parent.height * 0.45) },
    Modal: { width: isPc ? 520 : parent.width, height: isPc ? 420 : 360 },
    Drawer: { width: isPc ? 420 : parent.width, height: parent.height },
    Steps: { width: parent.width, height: isPc ? 56 : 180 },
    StatusTag: { width: 72, height: 28 },
    Card: { width: parent.width, height: isPc ? 148 : 104 },
    Panel: { width: parent.width, height: isPc ? 180 : 128 },
    Section: { width: parent.width, height: isPc ? 160 : 120 },
    Grid: { width: parent.width, height: Math.max(180, parent.height * 0.4) },
    Stack: { width: parent.width, height: Math.max(120, parent.height * 0.3) }
  };
  const fallback = defaults[normalizedType] ?? defaults.Stack;
  return {
    width: explicitWidth ?? fallback.width,
    height: explicitHeight ?? fallback.height
  };
}

function normalizeLayoutIntentType(type: string) {
  const lower = type.toLowerCase().replace(/[\s_-]+/g, "");
  if (["page", "screen", "artboard"].includes(lower)) return "Page";
  if (["stack", "vstack", "hstack", "container", "box", "group"].includes(lower)) return "Stack";
  if (["grid", "cards", "cardgrid"].includes(lower)) return "Grid";
  if (["section"].includes(lower)) return "Section";
  if (["card"].includes(lower)) return "Card";
  if (["panel", "sheet", "detail", "detailpanel", "statuspanel"].includes(lower)) return "Panel";
  if (["toolbar", "topbar", "nav"].includes(lower)) return "Toolbar";
  if (["actionbar", "actions"].includes(lower)) return "ActionBar";
  if (["filterbar", "searchbar", "filters", "querybar"].includes(lower)) return "FilterBar";
  if (["metricgroup", "metrics", "summary"].includes(lower)) return "MetricGroup";
  if (["table", "datatable", "list"].includes(lower)) return "Table";
  if (["cardlist", "listview"].includes(lower)) return "CardList";
  if (["listitem", "cell", "rowitem"].includes(lower)) return "ListItem";
  if (["form", "formpanel"].includes(lower)) return "Form";
  if (["descriptionlist", "descriptions", "keyvalue", "keyvaluelist", "infolist", "fieldlist"].includes(lower)) return "DescriptionList";
  if (["tabs", "tab"].includes(lower)) return "Tabs";
  if (["pagination", "pager"].includes(lower)) return "Pagination";
  if (["emptystate", "empty", "blankstate", "nodata"].includes(lower)) return "EmptyState";
  if (["upload", "uploader", "fileupload", "imageupload"].includes(lower)) return "Upload";
  if (["select", "picker", "dropdown"].includes(lower)) return "Select";
  if (["radiogroup", "radio"].includes(lower)) return "RadioGroup";
  if (["checkboxgroup", "checkbox"].includes(lower)) return "CheckboxGroup";
  if (["modal", "dialog", "popup"].includes(lower)) return "Modal";
  if (["drawer", "sheetdrawer"].includes(lower)) return "Drawer";
  if (["steps", "stepper", "timeline"].includes(lower)) return "Steps";
  if (["repeat", "foreach", "loop"].includes(lower)) return "Repeat";
  if (["statustag", "tag", "badge", "status"].includes(lower)) return "StatusTag";
  if (["button"].includes(lower)) return "Button";
  if (["input", "field", "select", "textarea", "upload"].includes(lower)) return "Input";
  if (["image", "avatar", "illustration", "icon"].includes(lower)) return "Image";
  if (["title", "heading"].includes(lower)) return "Title";
  return "Text";
}

function resolveIntentSpace(
  value: LayoutIntentDraftNode["gap"] | LayoutIntentDraftNode["padding"] | undefined,
  profile: DesignCapabilityProfile,
  fallback: "sm" | "md" | "lg"
) {
  if (value === "none") return 0;
  if (value === "xs") return Math.max(4, Math.round(getCompilerSpacing(profile, "sm") / 2));
  if (value === "sm") return getCompilerSpacing(profile, "sm");
  if (value === "lg") return getCompilerSpacing(profile, "lg");
  if (value === "xl") return getCompilerSpacing(profile, "lg") + getCompilerSpacing(profile, "sm");
  return getCompilerSpacing(profile, fallback);
}

function resolveDensitySpace(value: number, density: LayoutIntentDraftNode["density"]) {
  if (density === "compact") return Math.max(4, Math.round(value * 0.72));
  if (density === "spacious") return Math.round(value * 1.28);
  return value;
}

function normalizeSceneGraphHierarchy(nodes: WorkspaceDesignNode[]) {
  return reparentNodesByContainerBounds(normalizeAbsoluteNodeCoordinates(nodes));
}

function normalizeAbsoluteNodeCoordinates(nodes: WorkspaceDesignNode[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const resolved = new Map<string, WorkspaceDesignNode>();
  const resolveNode = (node: WorkspaceDesignNode): WorkspaceDesignNode => {
    const cached = resolved.get(node.id);
    if (cached) return cached;
    if (!node.parentId || visiting.has(node.id)) {
      resolved.set(node.id, node);
      return node;
    }
    const parent = nodeById.get(node.parentId);
    if (!parent) {
      resolved.set(node.id, node);
      return node;
    }
    visiting.add(node.id);
    const resolvedParent = resolveNode(parent);
    visiting.delete(node.id);
    const looksRelative = node.x >= 0
      && node.y >= 0
      && node.x + node.width <= resolvedParent.width + 2
      && node.y + node.height <= resolvedParent.height + 2
      && (node.x < resolvedParent.x || node.y < resolvedParent.y);
    const nextNode = looksRelative
      ? { ...node, x: resolvedParent.x + node.x, y: resolvedParent.y + node.y }
      : node;
    resolved.set(node.id, nextNode);
    return nextNode;
  };
  return nodes.map(resolveNode);
}

function reparentNodesByContainerBounds(nodes: WorkspaceDesignNode[]) {
  const candidates = nodes
    .filter(isHierarchyContainerNode)
    .sort((a, b) => getNodeArea(a) - getNodeArea(b));
  const hasLocalFrame = candidates.some((candidate) => candidate.type === "frame");
  return nodes.map((node) => {
    if (node.type === "frame") return { ...node, parentId: undefined };
    const currentParent = nodes.find((candidate) => candidate.id === node.parentId);
    const bestParent = selectContainerParentByBounds(node, candidates, currentParent);
    return {
      ...node,
      parentId: bestParent?.id ?? (hasLocalFrame ? undefined : node.parentId)
    };
  });
}

function selectContainerParentByBounds(
  node: WorkspaceDesignNode,
  candidates: WorkspaceDesignNode[],
  currentParent?: WorkspaceDesignNode
) {
  const containingCandidates = candidates.filter((candidate) => {
    if (candidate.id === node.id) return false;
    return canContainHierarchyChild(candidate, node);
  });
  if (containingCandidates.length === 0) return undefined;
  const currentCandidate = currentParent && containingCandidates.find((candidate) => candidate.id === currentParent.id);
  const bestCandidate = containingCandidates[0];
  if (!currentCandidate) return bestCandidate;
  const currentArea = getNodeArea(currentCandidate);
  const bestArea = getNodeArea(bestCandidate);
  return currentArea <= bestArea * 1.08 ? currentCandidate : bestCandidate;
}

function canContainHierarchyChild(parent: WorkspaceDesignNode, child: WorkspaceDesignNode) {
  if (!isHierarchyContainerNode(parent)) return false;
  if (!isNodeInsideTargetWithTolerance(child, parent, 2)) return false;
  if (parent.type === "frame") return true;
  const parentArea = getNodeArea(parent);
  const childArea = getNodeArea(child);
  if (parentArea <= childArea * 1.02) return false;
  return parent.width >= child.width + 1 || parent.height >= child.height + 1;
}

function isHierarchyContainerNode(node: WorkspaceDesignNode) {
  return node.type === "frame" || node.type === "container" || node.type === "card";
}

function getNodeArea(node: WorkspaceDesignNode) {
  return Math.max(1, node.width) * Math.max(1, node.height);
}

function toFiniteNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeLineHeight(value: unknown, fallback?: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseFontWeight(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
    if (value === "bold") return 700;
    if (value === "semibold") return 600;
    if (value === "medium") return 500;
  }
  return undefined;
}

function extractCssBorderColor(value: unknown) {
  if (typeof value !== "string") return undefined;
  const hex = /#[0-9a-f]{3,8}\b/i.exec(value)?.[0];
  if (hex) return hex;
  const rgba = /rgba?\([^)]+\)/i.exec(value)?.[0];
  if (rgba) return rgba;
  return undefined;
}

function inferSemanticUiPlan(input: {
  request: string;
  artboard: StitchUiSchemaDraft["artboards"][number];
  schemaDraft: StitchUiSchemaDraft;
  profile: DesignCapabilityProfile;
  targetSection?: SemanticUiRegionRole;
}): SemanticUiPlan {
  const request = input.request;
  const entityLabel = inferBusinessEntityForStitch(request);
  const tasks = inferSemanticTasks(request);
  const fields = inferInformationFields(entityLabel, request, input.artboard.nodes ?? []);
  const primaryRegion = inferPrimaryRegion(tasks, request);
  const isPc = input.profile.platform === "pc_web" || input.profile.platform === "responsive_web";
  const allRegions = resolveSemanticRegions({
    tasks,
    primaryRegion,
    platform: input.profile.platform,
    targetSection: input.targetSection,
    hasCollection: tasks.includes("browse") || /列表|管理|记录|table|list/i.test(request),
    hasFilters: /筛选|查询|搜索|filter|search|列表|管理/i.test(request),
    hasMetrics: /概览|统计|指标|dashboard|数据看板|报表/i.test(request)
  });
  return {
    id: input.artboard.refId ?? createCompilerId("semantic-plan"),
    title: inferPageTitle(request),
    platform: input.profile.platform,
    tasks,
    entity: {
      name: entityLabel.toLowerCase(),
      label: entityLabel,
      fields,
      metrics: inferStatsForEntity(entityLabel),
      states: inferEntityStates(entityLabel, request),
      actions: inferEntityActions(entityLabel, request)
    },
    composition: {
      density: isPc ? "data_dense" : "comfortable",
      navigation: isPc ? "sidebar" : "top",
      primaryRegion
    },
    regions: allRegions
  };
}

function renderSemanticUiPlan(
  frame: WorkspaceDesignNode,
  plan: SemanticUiPlan,
  profile: DesignCapabilityProfile,
  options: { includeFrame: boolean }
) {
  const slots = createLayoutSlots(frame, plan);
  const components = resolveComponentPlan(plan, slots);
  const nodes = components.flatMap((component) => expandResolvedComponent(component, frame, plan, profile));
  return [
    ...(options.includeFrame ? [applyLibraryTokens(frame, profile)] : []),
    ...nodes.map((node) => applyLibraryTokens(node, profile))
  ];
}

function resolveSemanticRegions(input: {
  tasks: SemanticUiTask[];
  primaryRegion: SemanticUiPlan["composition"]["primaryRegion"];
  platform: DesignCapabilityProfile["platform"];
  targetSection?: SemanticUiRegionRole;
  hasCollection: boolean;
  hasFilters: boolean;
  hasMetrics: boolean;
}) {
  const regions: SemanticUiRegion[] = [];
  const isPc = input.platform === "pc_web" || input.platform === "responsive_web";
  const push = (role: SemanticUiRegionRole, allowedComponents: SemanticUiComponentKind[], importance: "primary" | "secondary" = "secondary") => {
    if (input.targetSection && role !== input.targetSection) return;
    regions.push({ id: `region-${role}`, role, importance, allowedComponents });
  };
  if (isPc) push("navigation", ["SidebarNav"], "secondary");
  push("header", [isPc ? "TopBar" : "TopBar", "PageHeader", "ActionBar"], "primary");
  if (input.hasMetrics) push("summary", ["MetricGroup"], "secondary");
  if (input.hasFilters) push("filter", ["FilterBar"], "secondary");
  if (input.primaryRegion === "form") push("content", ["FormPanel"], "primary");
  else if (input.primaryRegion === "detail") push("content", ["DetailPanel", "CardList"], "primary");
  else if (input.primaryRegion === "feedback") push("content", ["EmptyState", "ActionBar"], "primary");
  else push("content", [isPc && input.hasCollection ? "DataCollection" : "CardList"], "primary");
  push("footer", ["Pagination", "ActionBar"], "secondary");
  return regions;
}

function createLayoutSlots(frame: WorkspaceDesignNode, plan: SemanticUiPlan) {
  const isPc = plan.platform === "pc_web" || plan.platform === "responsive_web";
  const sidebarWidth = isPc && plan.composition.navigation === "sidebar" ? 224 : 0;
  const contentX = frame.x + sidebarWidth + (isPc ? 32 : 16);
  const contentWidth = frame.width - sidebarWidth - (isPc ? 64 : 32);
  const slots = new Map<SemanticUiRegionRole, { x: number; y: number; width: number; height: number }>();
  if (isPc) {
    slots.set("navigation", { x: frame.x, y: frame.y, width: sidebarWidth, height: frame.height });
    slots.set("header", { x: contentX, y: frame.y + 80, width: contentWidth, height: 112 });
    slots.set("summary", { x: contentX, y: frame.y + 208, width: contentWidth, height: 96 });
    slots.set("filter", { x: contentX, y: frame.y + 320, width: contentWidth, height: 92 });
    slots.set("content", { x: contentX, y: frame.y + 436, width: contentWidth, height: Math.max(360, frame.height - 540) });
    slots.set("footer", { x: contentX, y: frame.y + frame.height - 76, width: contentWidth, height: 44 });
    slots.set("action", { x: contentX + contentWidth - 240, y: frame.y + 112, width: 240, height: 40 });
  } else {
    slots.set("header", { x: frame.x + 16, y: frame.y + 44, width: frame.width - 32, height: 56 });
    slots.set("summary", { x: frame.x + 16, y: frame.y + 164, width: frame.width - 32, height: 82 });
    slots.set("filter", { x: frame.x + 16, y: frame.y + 112, width: frame.width - 32, height: 44 });
    slots.set("content", { x: frame.x + 16, y: frame.y + 270, width: frame.width - 32, height: Math.max(280, frame.height - 370) });
    slots.set("footer", { x: frame.x + 16, y: frame.y + frame.height - 76, width: frame.width - 32, height: 52 });
    slots.set("action", { x: frame.x + 16, y: frame.y + frame.height - 76, width: frame.width - 32, height: 52 });
  }
  return slots;
}

function resolveComponentPlan(plan: SemanticUiPlan, slots: Map<SemanticUiRegionRole, { x: number; y: number; width: number; height: number }>) {
  return plan.regions.flatMap((region): ResolvedUiComponent[] => {
    const slot = slots.get(region.role);
    if (!slot) return [];
    return selectComponentsForRegion(region, plan).map((kind) => ({
      id: `${region.id}-${kind}`,
      kind,
      regionId: region.id,
      slot,
      props: {
        title: plan.title,
        entity: plan.entity,
        tasks: plan.tasks,
        density: plan.composition.density,
        navigation: plan.composition.navigation
      }
    }));
  });
}

function selectComponentsForRegion(region: SemanticUiRegion, plan: SemanticUiPlan): SemanticUiComponentKind[] {
  if (region.role === "navigation") return plan.composition.navigation === "sidebar" ? ["SidebarNav"] : [];
  if (region.role === "header") return plan.composition.navigation === "sidebar" ? ["TopBar", "PageHeader", "ActionBar"] : ["TopBar", "PageHeader"];
  if (region.role === "summary") return ["MetricGroup"];
  if (region.role === "filter") return ["FilterBar"];
  if (region.role === "content") {
    if (plan.composition.primaryRegion === "form") return ["FormPanel"];
    if (plan.composition.primaryRegion === "detail") return ["DetailPanel"];
    if (plan.composition.primaryRegion === "feedback") return ["EmptyState"];
    return plan.platform === "pc_web" || plan.platform === "responsive_web" ? ["DataCollection"] : ["CardList"];
  }
  if (region.role === "footer") return plan.platform === "pc_web" || plan.platform === "responsive_web" ? ["Pagination"] : ["ActionBar"];
  return region.allowedComponents.slice(0, 1);
}

function expandResolvedComponent(
  component: ResolvedUiComponent,
  frame: WorkspaceDesignNode,
  plan: SemanticUiPlan,
  profile: DesignCapabilityProfile
) {
  switch (component.kind) {
    case "SidebarNav":
      return expandSidebarNav(component, frame, plan);
    case "TopBar":
      return expandTopBar(component, frame, plan);
    case "PageHeader":
      return expandPageHeader(component, frame, plan);
    case "ActionBar":
      return expandActionBar(component, frame, plan, profile);
    case "MetricGroup":
      return expandMetricGroup(component, frame, plan);
    case "FilterBar":
      return expandFilterBar(component, frame, plan);
    case "DataCollection":
      return expandDataCollection(component, frame, plan, profile);
    case "CardList":
      return expandCardList(component, frame, plan);
    case "DetailPanel":
      return expandDetailPanel(component, frame, plan);
    case "FormPanel":
      return expandFormPanel(component, frame, plan);
    case "Pagination":
      return expandPagination(component, frame);
    case "EmptyState":
      return expandEmptyState(component, frame, plan);
    default:
      return [];
  }
}

function inferTargetRegionRole(request: string, nodes: StitchUiDraftNode[]): SemanticUiRegionRole {
  const text = `${request} ${nodes.map((node) => `${node.name} ${node.text ?? ""}`).join(" ")}`;
  if (/顶部|导航|标题|框架|header|topbar|sidebar|页面框架/i.test(text)) return "header";
  if (/筛选|查询|搜索|filter|search/i.test(text)) return "filter";
  if (/摘要|指标|统计|metric|summary/i.test(text)) return "summary";
  if (/页脚|分页|反馈|footer|pagination/i.test(text)) return "footer";
  return "content";
}

function inferSemanticTasks(request: string): SemanticUiTask[] {
  const tasks: SemanticUiTask[] = [];
  if (/列表|管理|记录|浏览|查询|搜索|browse|list|table/i.test(request)) tasks.push("browse");
  if (/新增|创建|新建|create|add/i.test(request)) tasks.push("create");
  if (/编辑|修改|设置|edit/i.test(request)) tasks.push("edit");
  if (/详情|查看|资料|inspect|detail/i.test(request)) tasks.push("inspect");
  if (/审核|处理|操作|批量|operate/i.test(request)) tasks.push("operate");
  if (/监控|告警|趋势|dashboard|monitor/i.test(request)) tasks.push("monitor");
  if (/认证|实名|校验|verify/i.test(request)) tasks.push("verify");
  if (/支付|结算|提现|checkout/i.test(request)) tasks.push("checkout");
  return tasks.length > 0 ? Array.from(new Set(tasks)) : ["browse"];
}

function inferPrimaryRegion(tasks: SemanticUiTask[], request: string): SemanticUiPlan["composition"]["primaryRegion"] {
  if (tasks.includes("create") || tasks.includes("edit") || /表单|填写|录入|设置/.test(request)) return "form";
  if (tasks.includes("inspect") || /详情/.test(request)) return "detail";
  if (tasks.includes("monitor") || /概览|工作台|dashboard/i.test(request)) return "dashboard";
  if (/空状态|成功|失败|反馈/.test(request)) return "feedback";
  return "collection";
}

function inferInformationFields(entityLabel: string, request: string, nodes: StitchUiDraftNode[]) {
  const requested = nodes.map((node) => String(node.text ?? node.name ?? "")).filter(Boolean);
  const fields = inferTableColumns(entityLabel, request).filter((field) => field !== "操作");
  return Array.from(new Set([...fields, ...requested.filter((item) => item.length <= 8).slice(0, 4)]));
}

function inferEntityStates(entityLabel: string, request: string) {
  if (/审核|认证/.test(request)) return ["待审核", "已通过", "已驳回"];
  return ["启用", "停用", "异常"];
}

function inferEntityActions(entityLabel: string, request: string) {
  const actions = [inferPrimaryAction(request), "查看"];
  if (/导出|报表|数据/.test(request)) actions.push("导出");
  if (/审核|审批|认证/.test(request)) actions.push("审核");
  if (/批量|管理/.test(request)) actions.push("批量处理");
  return Array.from(new Set(actions));
}

function expandSidebarNav(component: ResolvedUiComponent, frame: WorkspaceDesignNode, plan: SemanticUiPlan) {
  const slot = component.slot;
  const sidebarId = createCompilerId("sidebar");
  const nodes: WorkspaceDesignNode[] = [
    createCompilerNode("container", {
      id: sidebarId,
      parentId: frame.id,
      name: "全局导航",
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      fill: "#001529",
      stroke: "transparent",
      radius: 0
    }),
    createCompilerNode("image", {
      parentId: sidebarId,
      name: "品牌图标",
      x: slot.x + 24,
      y: slot.y + 22,
      width: 32,
      height: 32,
      fill: "#1677ff",
      stroke: "transparent",
      radius: 8,
      text: "AI"
    }),
    createCompilerNode("text", {
      parentId: sidebarId,
      name: "产品名称",
      x: slot.x + 68,
      y: slot.y + 24,
      width: slot.width - 88,
      height: 28,
      text: inferProductName(`${plan.entity.label} ${plan.title}`),
      fill: "transparent",
      stroke: "transparent",
      textColor: "#ffffff",
      fontSize: 16,
      fontWeight: 700,
      lineHeight: 24
    })
  ];
  inferAdminNavItems(`${plan.entity.label} ${plan.title}`).forEach((item, index) => {
    const active = plan.title.includes(item.replace("管理", "")) || item.includes(plan.entity.label);
    const y = slot.y + 88 + index * 48;
    nodes.push(
      createCompilerNode("container", {
        parentId: sidebarId,
        name: `${item}导航项`,
        x: slot.x + 12,
        y,
        width: slot.width - 24,
        height: 40,
        fill: active ? "#1677ff" : "transparent",
        stroke: "transparent",
        radius: 6
      }),
      createCompilerNode("image", {
        parentId: sidebarId,
        name: `${item}图标`,
        x: slot.x + 28,
        y: y + 12,
        width: 16,
        height: 16,
        fill: active ? "#ffffff" : "#8aa4c0",
        stroke: "transparent",
        radius: 4
      }),
      createCompilerNode("text", {
        parentId: sidebarId,
        name: `${item}文字`,
        x: slot.x + 56,
        y: y + 9,
        width: slot.width - 82,
        height: 22,
        text: item,
        fill: "transparent",
        stroke: "transparent",
        textColor: active ? "#ffffff" : "#b7c4d4",
        fontSize: 14,
        lineHeight: 22
      })
    );
  });
  return nodes;
}

function expandTopBar(component: ResolvedUiComponent, frame: WorkspaceDesignNode, plan: SemanticUiPlan) {
  const isPc = plan.platform === "pc_web" || plan.platform === "responsive_web";
  if (!isPc) {
    return [createCompilerNode("container", {
      parentId: frame.id,
      name: "移动顶部栏",
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: 96,
      fill: "#ffffff",
      stroke: "#eef2f7",
      radius: 0
    })];
  }
  const sidebarWidth = plan.composition.navigation === "sidebar" ? 224 : 0;
  return [createCompilerNode("container", {
    parentId: frame.id,
    name: "顶部工具栏",
    x: frame.x + sidebarWidth,
    y: frame.y,
    width: frame.width - sidebarWidth,
    height: 64,
    fill: "#ffffff",
    stroke: "#e6edf5",
    radius: 0
  })];
}

function expandPageHeader(component: ResolvedUiComponent, frame: WorkspaceDesignNode, plan: SemanticUiPlan) {
  const slot = component.slot;
  const isPc = plan.platform === "pc_web" || plan.platform === "responsive_web";
  if (!isPc) {
    return [createCompilerNode("text", {
      parentId: frame.id,
      name: "页面标题",
      x: slot.x,
      y: slot.y + 4,
      width: slot.width - 96,
      height: 30,
      text: plan.title,
      fill: "transparent",
      stroke: "transparent",
      textColor: "#111827",
      fontSize: 22,
      fontWeight: 700,
      lineHeight: 30
    })];
  }
  return [
    createCompilerNode("text", {
      parentId: frame.id,
      name: "面包屑",
      x: slot.x,
      y: slot.y,
      width: Math.min(520, slot.width),
      height: 22,
      text: `首页 / ${plan.entity.label}管理 / ${plan.title}`,
      fill: "transparent",
      stroke: "transparent",
      textColor: "#667085",
      fontSize: 13,
      lineHeight: 20
    }),
    createCompilerNode("text", {
      parentId: frame.id,
      name: "页面标题",
      x: slot.x,
      y: slot.y + 30,
      width: 360,
      height: 34,
      text: plan.title,
      fill: "transparent",
      stroke: "transparent",
      textColor: "#101828",
      fontSize: 24,
      fontWeight: 700,
      lineHeight: 32
    }),
    createCompilerNode("text", {
      parentId: frame.id,
      name: "页面说明",
      x: slot.x,
      y: slot.y + 68,
      width: Math.min(680, slot.width - 280),
      height: 24,
      text: buildPlanDescription(plan),
      fill: "transparent",
      stroke: "transparent",
      textColor: "#667085",
      fontSize: 14,
      lineHeight: 22
    })
  ];
}

function expandActionBar(component: ResolvedUiComponent, frame: WorkspaceDesignNode, plan: SemanticUiPlan, profile: DesignCapabilityProfile) {
  const slot = component.slot;
  const isPc = plan.platform === "pc_web" || plan.platform === "responsive_web";
  const actions = plan.entity.actions.slice(0, isPc ? 2 : 1);
  return actions.map((action, index) => {
    const width = isPc ? (index === 0 ? 112 : 88) : slot.width;
    return createCompilerNode("button", {
      parentId: frame.id,
      name: `${action}按钮`,
      x: isPc ? slot.x + slot.width - actions.length * 104 + index * 104 : slot.x,
      y: isPc ? slot.y : slot.y,
      width,
      height: isPc ? 40 : 52,
      text: action,
      fill: index === 0 ? profile.libraries[0]?.tokens.colors.primary ?? "#1677ff" : "#ffffff",
      stroke: index === 0 ? "transparent" : "#d0d5dd",
      textColor: index === 0 ? "#ffffff" : "#344054",
      radius: isPc ? 6 : 18
    });
  });
}

function expandMetricGroup(component: ResolvedUiComponent, frame: WorkspaceDesignNode, plan: SemanticUiPlan) {
  const slot = component.slot;
  const isPc = plan.platform === "pc_web" || plan.platform === "responsive_web";
  const metrics = plan.entity.metrics.slice(0, isPc ? 4 : 3);
  const nodes: WorkspaceDesignNode[] = [];
  if (isPc) {
    nodes.push(createCompilerNode("card", {
      parentId: frame.id,
      name: "指标概览",
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      fill: "#ffffff",
      stroke: "#e6edf5",
      radius: 8
    }));
  }
  metrics.forEach((metric, index) => {
    const width = isPc ? Math.floor((slot.width - 48) / metrics.length) : Math.floor((slot.width - 16) / metrics.length);
    const x = slot.x + (isPc ? 24 : 0) + index * (width + (isPc ? 0 : 8));
    const y = isPc ? slot.y + 20 : slot.y;
    if (!isPc) {
      nodes.push(createCompilerNode("card", {
        parentId: frame.id,
        name: `${metric.label}统计卡`,
        x,
        y,
        width,
        height: slot.height,
        fill: "#ffffff",
        stroke: "#eef2f7",
        radius: 14
      }));
    }
    nodes.push(
      createCompilerNode("text", {
        parentId: frame.id,
        name: `${metric.label}数值`,
        x: x + (isPc ? 0 : 12),
        y: y + (isPc ? 26 : 14),
        width: width - 24,
        height: 30,
        text: metric.value,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#101828",
        fontSize: isPc ? 24 : 18,
        fontWeight: 700,
        lineHeight: isPc ? 30 : 24
      }),
      createCompilerNode("text", {
        parentId: frame.id,
        name: `${metric.label}标签`,
        x: x + (isPc ? 0 : 12),
        y: y + (isPc ? 4 : 46),
        width: width - 24,
        height: 20,
        text: metric.label,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#667085",
        fontSize: 13,
        lineHeight: 20
      })
    );
  });
  return nodes;
}

function expandFilterBar(component: ResolvedUiComponent, frame: WorkspaceDesignNode, plan: SemanticUiPlan) {
  const slot = component.slot;
  const isPc = plan.platform === "pc_web" || plan.platform === "responsive_web";
  if (!isPc) {
    return [createCompilerNode("input", {
      parentId: frame.id,
      name: "搜索输入框",
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      text: `搜索${plan.entity.label}`,
      fill: "#ffffff",
      stroke: "#e5e7eb",
      radius: 14
    })];
  }
  const nodes: WorkspaceDesignNode[] = [createCompilerNode("card", {
    parentId: frame.id,
    name: "筛选区域",
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    fill: "#ffffff",
    stroke: "#e6edf5",
    radius: 8
  })];
  plan.entity.fields.slice(0, 4).forEach((field, index) => {
    const x = slot.x + 24 + index * 238;
    nodes.push(
      createCompilerNode("text", {
        parentId: frame.id,
        name: `${field}筛选标签`,
        x,
        y: slot.y + 18,
        width: 96,
        height: 20,
        text: field,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#344054",
        fontSize: 13,
        lineHeight: 20
      }),
      createCompilerNode("input", {
        parentId: frame.id,
        name: `${field}筛选输入`,
        x,
        y: slot.y + 44,
        width: 210,
        height: 36,
        text: `请输入${field}`,
        fill: "#ffffff",
        stroke: "#d0d5dd",
        radius: 6
      })
    );
  });
  nodes.push(
    createCompilerNode("button", {
      parentId: frame.id,
      name: "查询按钮",
      x: slot.x + slot.width - 204,
      y: slot.y + 44,
      width: 80,
      height: 36,
      text: "查询",
      radius: 6
    }),
    createCompilerNode("button", {
      parentId: frame.id,
      name: "重置按钮",
      x: slot.x + slot.width - 112,
      y: slot.y + 44,
      width: 80,
      height: 36,
      text: "重置",
      fill: "#ffffff",
      stroke: "#d0d5dd",
      textColor: "#344054",
      radius: 6
    })
  );
  return nodes;
}

function expandDataCollection(component: ResolvedUiComponent, frame: WorkspaceDesignNode, plan: SemanticUiPlan, profile: DesignCapabilityProfile) {
  const slot = component.slot;
  const columns = plan.entity.fields.slice(0, 6);
  const rows = inferTableRows(plan.entity.label);
  const nodes: WorkspaceDesignNode[] = [
    createCompilerNode("card", {
      parentId: frame.id,
      name: `${plan.entity.label}数据集合`,
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      fill: "#ffffff",
      stroke: "#e6edf5",
      radius: 8
    }),
    createCompilerNode("text", {
      parentId: frame.id,
      name: "数据集合标题",
      x: slot.x + 24,
      y: slot.y + 22,
      width: 240,
      height: 26,
      text: `${plan.entity.label}列表`,
      fill: "transparent",
      stroke: "transparent",
      textColor: "#101828",
      fontSize: 18,
      fontWeight: 700,
      lineHeight: 26
    })
  ];
  nodes.push(...expandActionBar({
    id: `${component.id}-toolbar`,
    kind: "ActionBar",
    regionId: component.regionId,
    slot: { x: slot.x + slot.width - 240, y: slot.y + 16, width: 216, height: 36 },
    props: component.props
  }, frame, plan, profile));
  const tableX = slot.x + 24;
  const tableY = slot.y + 72;
  const tableWidth = slot.width - 48;
  const columnWidth = Math.floor(tableWidth / columns.length);
  nodes.push(createCompilerNode("container", {
    parentId: frame.id,
    name: "表头背景",
    x: tableX,
    y: tableY,
    width: tableWidth,
    height: 44,
    fill: "#f8fafc",
    stroke: "#e6edf5",
    radius: 6
  }));
  columns.forEach((column, index) => {
    nodes.push(createCompilerNode("text", {
      parentId: frame.id,
      name: `${column}表头`,
      x: tableX + index * columnWidth + 16,
      y: tableY + 12,
      width: columnWidth - 24,
      height: 20,
      text: column,
      fill: "transparent",
      stroke: "transparent",
      textColor: "#475467",
      fontSize: 13,
      fontWeight: 600,
      lineHeight: 20
    }));
  });
  rows.slice(0, 5).forEach((row, rowIndex) => {
    const rowY = tableY + 44 + rowIndex * 56;
    nodes.push(createCompilerNode("container", {
      parentId: frame.id,
      name: `${plan.entity.label}数据行${rowIndex + 1}`,
      x: tableX,
      y: rowY,
      width: tableWidth,
      height: 56,
      fill: rowIndex % 2 === 0 ? "#ffffff" : "#fcfcfd",
      stroke: "#eef2f7",
      radius: 0
    }));
    columns.forEach((column, colIndex) => {
      const cell = row[colIndex] ?? row[row.length - 1] ?? "";
      const isStatus = plan.entity.states.some((state) => cell.includes(state)) || /待|已|退款|启用|停用|上架|下架|异常/.test(cell);
      nodes.push(createCompilerNode(isStatus ? "button" : "text", {
        parentId: frame.id,
        name: `${column}内容${rowIndex + 1}`,
        x: tableX + colIndex * columnWidth + 16,
        y: rowY + (isStatus ? 14 : 18),
        width: isStatus ? 72 : columnWidth - 24,
        height: isStatus ? 28 : 20,
        text: cell,
        fill: isStatus ? getStatusFill(cell) : "transparent",
        stroke: "transparent",
        textColor: isStatus ? getStatusColor(cell) : "#344054",
        fontSize: 13,
        lineHeight: isStatus ? 28 : 20,
        radius: isStatus ? 14 : 0
      }));
    });
  });
  return nodes;
}

function expandCardList(component: ResolvedUiComponent, frame: WorkspaceDesignNode, plan: SemanticUiPlan) {
  const slot = component.slot;
  return inferMobileRows(plan.entity.label).map((row, index) => {
    const y = slot.y + index * 112;
    return [
      createCompilerNode("card", {
        parentId: frame.id,
        name: `${plan.entity.label}卡片${index + 1}`,
        x: slot.x,
        y,
        width: slot.width,
        height: 96,
        fill: "#ffffff",
        stroke: "#eef2f7",
        radius: 16
      }),
      createCompilerNode("text", {
        parentId: frame.id,
        name: `${plan.entity.label}标题${index + 1}`,
        x: slot.x + 16,
        y: y + 16,
        width: slot.width - 120,
        height: 22,
        text: row.title,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#111827",
        fontSize: 15,
        fontWeight: 700,
        lineHeight: 22
      }),
      createCompilerNode("text", {
        parentId: frame.id,
        name: `${plan.entity.label}描述${index + 1}`,
        x: slot.x + 16,
        y: y + 44,
        width: slot.width - 120,
        height: 20,
        text: row.desc,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#6b7280",
        fontSize: 13,
        lineHeight: 20
      }),
      createCompilerNode("button", {
        parentId: frame.id,
        name: `${plan.entity.label}状态${index + 1}`,
        x: slot.x + slot.width - 86,
        y: y + 18,
        width: 64,
        height: 28,
        text: row.status,
        fill: getStatusFill(row.status),
        textColor: getStatusColor(row.status),
        radius: 14
      }),
      createCompilerNode("text", {
        parentId: frame.id,
        name: `${plan.entity.label}元信息${index + 1}`,
        x: slot.x + 16,
        y: y + 68,
        width: slot.width - 32,
        height: 20,
        text: row.meta,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#344054",
        fontSize: 13,
        lineHeight: 20
      })
    ];
  }).flat();
}

function expandDetailPanel(component: ResolvedUiComponent, frame: WorkspaceDesignNode, plan: SemanticUiPlan) {
  const slot = component.slot;
  const nodes: WorkspaceDesignNode[] = [createCompilerNode("card", {
    parentId: frame.id,
    name: `${plan.entity.label}详情`,
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    fill: "#ffffff",
    stroke: "#e6edf5",
    radius: 8
  })];
  plan.entity.fields.slice(0, 8).forEach((field, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = slot.x + 24 + column * Math.floor((slot.width - 48) / 2);
    const y = slot.y + 28 + row * 64;
    nodes.push(
      createCompilerNode("text", {
        parentId: frame.id,
        name: `${field}详情标签`,
        x,
        y,
        width: 140,
        height: 20,
        text: field,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#667085",
        fontSize: 13,
        lineHeight: 20
      }),
      createCompilerNode("text", {
        parentId: frame.id,
        name: `${field}详情值`,
        x,
        y: y + 24,
        width: 260,
        height: 24,
        text: buildFieldDemoValue(field, plan.entity.label, index),
        fill: "transparent",
        stroke: "transparent",
        textColor: "#101828",
        fontSize: 15,
        lineHeight: 22
      })
    );
  });
  return nodes;
}

function expandFormPanel(component: ResolvedUiComponent, frame: WorkspaceDesignNode, plan: SemanticUiPlan) {
  const slot = component.slot;
  const nodes: WorkspaceDesignNode[] = [createCompilerNode("card", {
    parentId: frame.id,
    name: `${plan.entity.label}表单`,
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    fill: "#ffffff",
    stroke: "#e6edf5",
    radius: 8
  })];
  plan.entity.fields.slice(0, 6).forEach((field, index) => {
    const y = slot.y + 32 + index * 68;
    nodes.push(
      createCompilerNode("text", {
        parentId: frame.id,
        name: `${field}表单标签`,
        x: slot.x + 32,
        y,
        width: 120,
        height: 22,
        text: field,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#344054",
        fontSize: 14,
        lineHeight: 22
      }),
      createCompilerNode("input", {
        parentId: frame.id,
        name: `${field}输入`,
        x: slot.x + 168,
        y: y - 8,
        width: Math.min(420, slot.width - 220),
        height: 40,
        text: `请输入${field}`,
        fill: "#ffffff",
        stroke: "#d0d5dd",
        radius: 6
      })
    );
  });
  return nodes;
}

function expandPagination(component: ResolvedUiComponent, frame: WorkspaceDesignNode) {
  const slot = component.slot;
  return [
    createCompilerNode("text", {
      parentId: frame.id,
      name: "分页说明",
      x: slot.x,
      y: slot.y + 10,
      width: 260,
      height: 24,
      text: "共 128 条记录，每页 10 条",
      fill: "transparent",
      stroke: "transparent",
      textColor: "#667085",
      fontSize: 13,
      lineHeight: 22
    }),
    createCompilerNode("button", {
      parentId: frame.id,
      name: "上一页",
      x: slot.x + slot.width - 168,
      y: slot.y + 6,
      width: 76,
      height: 32,
      text: "上一页",
      fill: "#ffffff",
      stroke: "#d0d5dd",
      textColor: "#344054",
      radius: 6
    }),
    createCompilerNode("button", {
      parentId: frame.id,
      name: "下一页",
      x: slot.x + slot.width - 76,
      y: slot.y + 6,
      width: 76,
      height: 32,
      text: "下一页",
      fill: "#ffffff",
      stroke: "#d0d5dd",
      textColor: "#344054",
      radius: 6
    })
  ];
}

function expandEmptyState(component: ResolvedUiComponent, frame: WorkspaceDesignNode, plan: SemanticUiPlan) {
  const slot = component.slot;
  return [
    createCompilerNode("image", {
      parentId: frame.id,
      name: "空状态插画",
      x: slot.x + slot.width / 2 - 80,
      y: slot.y + 48,
      width: 160,
      height: 120,
      fill: "#eef4ff",
      stroke: "transparent",
      radius: 24
    }),
    createCompilerNode("text", {
      parentId: frame.id,
      name: "空状态标题",
      x: slot.x,
      y: slot.y + 196,
      width: slot.width,
      height: 28,
      text: `暂无${plan.entity.label}数据`,
      fill: "transparent",
      stroke: "transparent",
      textColor: "#101828",
      fontSize: 20,
      fontWeight: 700,
      textAlign: "center",
      lineHeight: 28
    })
  ];
}

function buildPlanDescription(plan: SemanticUiPlan) {
  const taskText = plan.tasks.map((task) => ({
    browse: "浏览",
    create: "创建",
    edit: "编辑",
    inspect: "查看",
    operate: "处理",
    monitor: "监控",
    verify: "校验",
    checkout: "结算"
  }[task])).join("、");
  return `用于${taskText}${plan.entity.label}数据，支持${plan.entity.actions.slice(0, 3).join("、")}等关键操作。`;
}

function buildFieldDemoValue(field: string, entityLabel: string, index: number) {
  if (/金额|价格/.test(field)) return "¥128.50";
  if (/状态/.test(field)) return inferEntityStates(entityLabel, "")[index % 3] ?? "启用";
  if (/时间|日期/.test(field)) return "2026-05-08 10:24";
  if (/客户|用户|姓名|负责人/.test(field)) return ["负责人 A", "负责人 B", "负责人 C"][index % 3];
  if (/编号|ID|Id|id/.test(field)) return `${entityLabel.toUpperCase()}-${String(index + 1).padStart(3, "0")}`;
  return `${entityLabel}${index + 1}`;
}

function inferStitchSectionKind(request: string, incremental: boolean, nodes: StitchUiDraftNode[]): StitchSectionKind {
  const text = `${request} ${nodes.map((node) => `${node.name} ${node.text ?? ""}`).join(" ")}`;
  if (!incremental) return "shell";
  if (/顶部|导航|标题|框架|header|topbar|sidebar|页面框架/i.test(text)) return "header";
  if (/筛选|查询|搜索|摘要|工具栏|filter|search|toolbar|统计|概览/i.test(text)) return "filters";
  if (/页脚|分页|反馈|footer|pagination/i.test(text)) return "footer";
  return "main";
}

function createWebAdminStitchPage(frame: WorkspaceDesignNode, request: string, profile: DesignCapabilityProfile) {
  return [
    ...createWebAdminStitchSection(frame, "header", request, profile),
    ...createWebAdminStitchSection(frame, "filters", request, profile),
    ...createWebAdminStitchSection(frame, "main", request, profile),
    ...createWebAdminStitchSection(frame, "footer", request, profile)
  ];
}

function createWebAdminStitchSection(
  frame: WorkspaceDesignNode,
  sectionKind: StitchSectionKind,
  request: string,
  profile: DesignCapabilityProfile
) {
  const tokens = profile.libraries[0]?.tokens;
  const nodes: WorkspaceDesignNode[] = [];
  const sidebarWidth = 224;
  const pageX = frame.x + sidebarWidth;
  const contentX = pageX + 32;
  const contentWidth = frame.width - sidebarWidth - 64;
  const pageTitle = inferPageTitle(request);
  const entity = inferBusinessEntityForStitch(request);
  const frameId = frame.id;
  const isDetail = /详情|查看|资料|detail|inspect/i.test(request);
  if (sectionKind === "header") {
    const sidebarId = createCompilerId("sidebar");
    nodes.push(createCompilerNode("container", {
      id: sidebarId,
      parentId: frameId,
      name: "后台侧边导航",
      x: frame.x,
      y: frame.y,
      width: sidebarWidth,
      height: frame.height,
      fill: "#001529",
      stroke: "transparent",
      radius: 0
    }));
    nodes.push(createCompilerNode("image", {
      parentId: sidebarId,
      name: "品牌图标",
      x: frame.x + 24,
      y: frame.y + 22,
      width: 32,
      height: 32,
      fill: "#1677ff",
      stroke: "transparent",
      radius: 8,
      text: "AI"
    }));
    nodes.push(createCompilerNode("text", {
      parentId: sidebarId,
      name: "产品名称",
      x: frame.x + 68,
      y: frame.y + 24,
      width: 128,
      height: 28,
      text: inferProductName(request),
      fill: "transparent",
      stroke: "transparent",
      textColor: "#ffffff",
      fontSize: 16,
      fontWeight: 700,
      lineHeight: 24
    }));
    inferAdminNavItems(request).forEach((item, index) => {
      const active = item === pageTitle || pageTitle.includes(item.replace("管理", ""));
      const y = frame.y + 88 + index * 48;
      nodes.push(createCompilerNode("container", {
        parentId: sidebarId,
        name: `${item}导航项`,
        x: frame.x + 12,
        y,
        width: sidebarWidth - 24,
        height: 40,
        fill: active ? "#1677ff" : "transparent",
        stroke: "transparent",
        radius: 6
      }));
      nodes.push(createCompilerNode("image", {
        parentId: sidebarId,
        name: `${item}图标`,
        x: frame.x + 28,
        y: y + 12,
        width: 16,
        height: 16,
        fill: active ? "#ffffff" : "#8aa4c0",
        stroke: "transparent",
        radius: 4
      }));
      nodes.push(createCompilerNode("text", {
        parentId: sidebarId,
        name: `${item}文字`,
        x: frame.x + 56,
        y: y + 9,
        width: 130,
        height: 22,
        text: item,
        fill: "transparent",
        stroke: "transparent",
        textColor: active ? "#ffffff" : "#b7c4d4",
        fontSize: 14,
        lineHeight: 22
      }));
    });
    nodes.push(createCompilerNode("container", {
      parentId: frameId,
      name: "顶部工具栏",
      x: pageX,
      y: frame.y,
      width: frame.width - sidebarWidth,
      height: 64,
      fill: "#ffffff",
      stroke: "#e6edf5",
      radius: 0
    }));
    nodes.push(createCompilerNode("text", {
      parentId: frameId,
      name: "面包屑",
      x: contentX,
      y: frame.y + 88,
      width: 360,
      height: 22,
      text: `首页 / ${entity}管理 / ${pageTitle}`,
      fill: "transparent",
      stroke: "transparent",
      textColor: "#667085",
      fontSize: 13,
      lineHeight: 20
    }));
    nodes.push(createCompilerNode("text", {
      parentId: frameId,
      name: "页面标题",
      x: contentX,
      y: frame.y + 118,
      width: 360,
      height: 34,
      text: pageTitle,
      fill: "transparent",
      stroke: "transparent",
      textColor: "#101828",
      fontSize: 24,
      fontWeight: 700,
      lineHeight: 32
    }));
    nodes.push(createCompilerNode("text", {
      parentId: frameId,
      name: "页面说明",
      x: contentX,
      y: frame.y + 154,
      width: 620,
      height: 24,
      text: `管理${entity}数据、处理状态流转，并支持筛选、批量操作和导出。`,
      fill: "transparent",
      stroke: "transparent",
      textColor: "#667085",
      fontSize: 14,
      lineHeight: 22
    }));
    nodes.push(createCompilerNode("button", {
      parentId: frameId,
      name: "主操作按钮",
      x: frame.x + frame.width - 176,
      y: frame.y + 112,
      width: 112,
      height: 40,
      text: inferPrimaryAction(request),
      fill: tokens?.colors.primary ?? "#1677ff",
      radius: 6
    }));
  }
  if (sectionKind === "filters") {
    const filterId = createCompilerId("filters");
    nodes.push(createCompilerNode("card", {
      id: filterId,
      parentId: frameId,
      name: "筛选与概览卡片",
      x: contentX,
      y: frame.y + 208,
      width: contentWidth,
      height: 184,
      fill: "#ffffff",
      stroke: "#e6edf5",
      radius: 8
    }));
    const stats = isDetail
      ? [
        { label: "当前状态", value: "上架中" },
        { label: "库存", value: "1,248" },
        { label: "价格", value: "¥ 299.00" },
        { label: "更新时间", value: "2026-05-08" }
      ]
      : inferStatsForEntity(entity);
    stats.forEach((stat, index) => {
      const x = contentX + 24 + index * 180;
      nodes.push(createCompilerNode("text", {
        parentId: filterId,
        name: `${stat.label}标签`,
        x,
        y: frame.y + 232,
        width: 120,
        height: 20,
        text: stat.label,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#667085",
        fontSize: 13,
        lineHeight: 20
      }));
      nodes.push(createCompilerNode("text", {
        parentId: filterId,
        name: `${stat.label}数值`,
        x,
        y: frame.y + 258,
        width: 140,
        height: 30,
        text: stat.value,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#101828",
        fontSize: 24,
        fontWeight: 700,
        lineHeight: 30
      }));
    });
    if (isDetail) {
      return nodes.map((node) => applyLibraryTokens(node, profile));
    }
    inferFilterFields(entity, request).forEach((field, index) => {
      const x = contentX + 24 + index * 250;
      nodes.push(createCompilerNode("text", {
        parentId: filterId,
        name: `${field}标签`,
        x,
        y: frame.y + 314,
        width: 96,
        height: 20,
        text: field,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#344054",
        fontSize: 13,
        lineHeight: 20
      }));
      nodes.push(createCompilerNode("input", {
        parentId: filterId,
        name: `${field}输入框`,
        x,
        y: frame.y + 340,
        width: 220,
        height: 36,
        text: `请输入${field}`,
        fill: "#ffffff",
        stroke: "#d0d5dd",
        radius: 6
      }));
    });
    nodes.push(createCompilerNode("button", {
      parentId: filterId,
      name: "查询按钮",
      x: contentX + contentWidth - 204,
      y: frame.y + 340,
      width: 80,
      height: 36,
      text: "查询",
      radius: 6
    }));
    nodes.push(createCompilerNode("button", {
      parentId: filterId,
      name: "重置按钮",
      x: contentX + contentWidth - 112,
      y: frame.y + 340,
      width: 80,
      height: 36,
      text: "重置",
      fill: "#ffffff",
      stroke: "#d0d5dd",
      textColor: "#344054",
      radius: 6
    }));
  }
  if (sectionKind === "main") {
    if (isDetail) {
      const detailId = createCompilerId("detail-card");
      nodes.push(createCompilerNode("card", {
        id: detailId,
        parentId: frameId,
        name: `${entity}详情卡片`,
        x: contentX,
        y: frame.y + 416,
        width: contentWidth,
        height: Math.max(360, frame.height - 520),
        fill: "#ffffff",
        stroke: "#e6edf5",
        radius: 8
      }));
      nodes.push(createCompilerNode("text", {
        parentId: detailId,
        name: "详情标题",
        x: contentX + 24,
        y: frame.y + 440,
        width: 260,
        height: 26,
        text: `${entity}详情`,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#101828",
        fontSize: 18,
        fontWeight: 700,
        lineHeight: 26
      }));
      inferDetailFields(entity, request).slice(0, 10).forEach((field, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = contentX + 24 + col * Math.floor((contentWidth - 72) / 2);
        const y = frame.y + 496 + row * 72;
        nodes.push(createCompilerNode("text", {
          parentId: detailId,
          name: `${field}标签`,
          x,
          y,
          width: 140,
          height: 20,
          text: field,
          fill: "transparent",
          stroke: "transparent",
          textColor: "#667085",
          fontSize: 13,
          lineHeight: 20
        }));
        nodes.push(createCompilerNode("text", {
          parentId: detailId,
          name: `${field}值`,
          x,
          y: y + 26,
          width: Math.floor((contentWidth - 72) / 2) - 24,
          height: 24,
          text: inferDetailFieldValue(entity, field, request),
          fill: "transparent",
          stroke: "transparent",
          textColor: "#101828",
          fontSize: 15,
          lineHeight: 22
        }));
      });
      nodes.push(createCompilerNode("button", {
        parentId: detailId,
        name: "编辑按钮",
        x: contentX + contentWidth - 244,
        y: frame.y + 436,
        width: 92,
        height: 36,
        text: "编辑",
        radius: 6
      }));
      nodes.push(createCompilerNode("button", {
        parentId: detailId,
        name: "返回按钮",
        x: contentX + contentWidth - 132,
        y: frame.y + 436,
        width: 92,
        height: 36,
        text: "返回",
        fill: "#ffffff",
        stroke: "#d0d5dd",
        textColor: "#344054",
        radius: 6
      }));
      return nodes.map((node) => applyLibraryTokens(node, profile));
    }
    const tableId = createCompilerId("table-card");
    nodes.push(createCompilerNode("card", {
      id: tableId,
      parentId: frameId,
      name: `${entity}列表卡片`,
      x: contentX,
      y: frame.y + 416,
      width: contentWidth,
      height: Math.max(360, frame.height - 520),
      fill: "#ffffff",
      stroke: "#e6edf5",
      radius: 8
    }));
    nodes.push(createCompilerNode("text", {
      parentId: tableId,
      name: "列表标题",
      x: contentX + 24,
      y: frame.y + 440,
      width: 220,
      height: 26,
      text: `${entity}列表`,
      fill: "transparent",
      stroke: "transparent",
      textColor: "#101828",
      fontSize: 18,
      fontWeight: 700,
      lineHeight: 26
    }));
    nodes.push(createCompilerNode("button", {
      parentId: tableId,
      name: "导出按钮",
      x: contentX + contentWidth - 244,
      y: frame.y + 436,
      width: 92,
      height: 36,
      text: "导出",
      fill: "#ffffff",
      stroke: "#d0d5dd",
      textColor: "#344054",
      radius: 6
    }));
    nodes.push(createCompilerNode("button", {
      parentId: tableId,
      name: "新建按钮",
      x: contentX + contentWidth - 132,
      y: frame.y + 436,
      width: 108,
      height: 36,
      text: inferPrimaryAction(request),
      radius: 6
    }));
    const columns = inferTableColumns(entity, request);
    const tableX = contentX + 24;
    const tableY = frame.y + 496;
    const tableWidth = contentWidth - 48;
    nodes.push(createCompilerNode("container", {
      parentId: tableId,
      name: "表头背景",
      x: tableX,
      y: tableY,
      width: tableWidth,
      height: 44,
      fill: "#f8fafc",
      stroke: "#e6edf5",
      radius: 6
    }));
    columns.forEach((column, index) => {
      const colX = tableX + index * Math.floor(tableWidth / columns.length);
      nodes.push(createCompilerNode("text", {
        parentId: tableId,
        name: `${column}表头`,
        x: colX + 16,
        y: tableY + 12,
        width: Math.floor(tableWidth / columns.length) - 24,
        height: 20,
        text: column,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#475467",
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 20
      }));
    });
    inferTableRows(entity).forEach((row, rowIndex) => {
      const rowY = tableY + 44 + rowIndex * 56;
      nodes.push(createCompilerNode("container", {
        parentId: tableId,
        name: `${entity}数据行${rowIndex + 1}`,
        x: tableX,
        y: rowY,
        width: tableWidth,
        height: 56,
        fill: rowIndex % 2 === 0 ? "#ffffff" : "#fcfcfd",
        stroke: "#eef2f7",
        radius: 0
      }));
      row.forEach((cell, colIndex) => {
        const colX = tableX + colIndex * Math.floor(tableWidth / columns.length);
        const isStatus = /待|已|退款|启用|停用|上架|下架/.test(cell);
        nodes.push(createCompilerNode(isStatus ? "button" : "text", {
          parentId: tableId,
          name: `${columns[colIndex]}内容${rowIndex + 1}`,
          x: colX + 16,
          y: rowY + (isStatus ? 14 : 18),
          width: isStatus ? 72 : Math.floor(tableWidth / columns.length) - 24,
          height: isStatus ? 28 : 20,
          text: cell,
          fill: isStatus ? getStatusFill(cell) : "transparent",
          stroke: isStatus ? "transparent" : "transparent",
          textColor: isStatus ? getStatusColor(cell) : "#344054",
          fontSize: 13,
          lineHeight: isStatus ? 28 : 20,
          radius: isStatus ? 14 : 0
        }));
      });
    });
  }
  if (sectionKind === "footer") {
    nodes.push(createCompilerNode("text", {
      parentId: frameId,
      name: "分页说明",
      x: contentX,
      y: frame.y + frame.height - 64,
      width: 260,
      height: 24,
      text: "共 128 条记录，每页 10 条",
      fill: "transparent",
      stroke: "transparent",
      textColor: "#667085",
      fontSize: 13,
      lineHeight: 22
    }));
    nodes.push(createCompilerNode("button", {
      parentId: frameId,
      name: "上一页",
      x: frame.x + frame.width - 208,
      y: frame.y + frame.height - 70,
      width: 76,
      height: 32,
      text: "上一页",
      fill: "#ffffff",
      stroke: "#d0d5dd",
      textColor: "#344054",
      radius: 6
    }));
    nodes.push(createCompilerNode("button", {
      parentId: frameId,
      name: "下一页",
      x: frame.x + frame.width - 116,
      y: frame.y + frame.height - 70,
      width: 76,
      height: 32,
      text: "下一页",
      fill: "#ffffff",
      stroke: "#d0d5dd",
      textColor: "#344054",
      radius: 6
    }));
  }
  return nodes.map((node) => applyLibraryTokens(node, profile));
}

function createMobileStitchPage(frame: WorkspaceDesignNode, request: string, profile: DesignCapabilityProfile) {
  return [
    ...createMobileStitchSection(frame, "header", request, profile),
    ...createMobileStitchSection(frame, "filters", request, profile),
    ...createMobileStitchSection(frame, "main", request, profile),
    ...createMobileStitchSection(frame, "footer", request, profile)
  ];
}

function createMobileStitchSection(
  frame: WorkspaceDesignNode,
  sectionKind: StitchSectionKind,
  request: string,
  profile: DesignCapabilityProfile
) {
  const nodes: WorkspaceDesignNode[] = [];
  const frameId = frame.id;
  const safeX = frame.x + 16;
  const width = frame.width - 32;
  const title = inferPageTitle(request);
  const entity = inferBusinessEntityForStitch(request);
  if (sectionKind === "header") {
    nodes.push(createCompilerNode("container", {
      parentId: frameId,
      name: "移动端顶部栏",
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: 96,
      fill: "#ffffff",
      stroke: "#eef2f7",
      radius: 0
    }));
    nodes.push(createCompilerNode("text", {
      parentId: frameId,
      name: "页面标题",
      x: safeX,
      y: frame.y + 48,
      width: width - 96,
      height: 30,
      text: title,
      fill: "transparent",
      stroke: "transparent",
      textColor: "#111827",
      fontSize: 22,
      fontWeight: 700,
      lineHeight: 30
    }));
    nodes.push(createCompilerNode("button", {
      parentId: frameId,
      name: "顶部主操作",
      x: frame.x + frame.width - 92,
      y: frame.y + 46,
      width: 76,
      height: 34,
      text: inferPrimaryAction(request).replace("新增", "新建"),
      radius: 17
    }));
  }
  if (sectionKind === "filters") {
    nodes.push(createCompilerNode("input", {
      parentId: frameId,
      name: "搜索输入框",
      x: safeX,
      y: frame.y + 112,
      width,
      height: 44,
      text: `搜索${entity}`,
      fill: "#ffffff",
      stroke: "#e5e7eb",
      radius: 14
    }));
    inferStatsForEntity(entity).slice(0, 3).forEach((stat, index) => {
      const cardWidth = Math.floor((width - 16) / 3);
      const x = safeX + index * (cardWidth + 8);
      nodes.push(createCompilerNode("card", {
        parentId: frameId,
        name: `${stat.label}统计卡`,
        x,
        y: frame.y + 172,
        width: cardWidth,
        height: 74,
        fill: "#ffffff",
        stroke: "#eef2f7",
        radius: 14
      }));
      nodes.push(createCompilerNode("text", {
        parentId: frameId,
        name: `${stat.label}统计值`,
        x: x + 12,
        y: frame.y + 186,
        width: cardWidth - 24,
        height: 24,
        text: stat.value,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#111827",
        fontSize: 18,
        fontWeight: 700,
        lineHeight: 24
      }));
      nodes.push(createCompilerNode("text", {
        parentId: frameId,
        name: `${stat.label}统计名`,
        x: x + 12,
        y: frame.y + 214,
        width: cardWidth - 24,
        height: 20,
        text: stat.label,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#6b7280",
        fontSize: 12,
        lineHeight: 18
      }));
    });
  }
  if (sectionKind === "main") {
    inferMobileRows(entity).forEach((row, index) => {
      const y = frame.y + 270 + index * 112;
      nodes.push(createCompilerNode("card", {
        parentId: frameId,
        name: `${entity}卡片${index + 1}`,
        x: safeX,
        y,
        width,
        height: 96,
        fill: "#ffffff",
        stroke: "#eef2f7",
        radius: 16
      }));
      nodes.push(createCompilerNode("text", {
        parentId: frameId,
        name: `${entity}标题${index + 1}`,
        x: safeX + 16,
        y: y + 16,
        width: width - 120,
        height: 22,
        text: row.title,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#111827",
        fontSize: 15,
        fontWeight: 700,
        lineHeight: 22
      }));
      nodes.push(createCompilerNode("text", {
        parentId: frameId,
        name: `${entity}描述${index + 1}`,
        x: safeX + 16,
        y: y + 44,
        width: width - 120,
        height: 20,
        text: row.desc,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#6b7280",
        fontSize: 13,
        lineHeight: 20
      }));
      nodes.push(createCompilerNode("button", {
        parentId: frameId,
        name: `${entity}状态${index + 1}`,
        x: safeX + width - 86,
        y: y + 18,
        width: 64,
        height: 28,
        text: row.status,
        fill: getStatusFill(row.status),
        textColor: getStatusColor(row.status),
        radius: 14
      }));
      nodes.push(createCompilerNode("text", {
        parentId: frameId,
        name: `${entity}金额${index + 1}`,
        x: safeX + 16,
        y: y + 68,
        width: width - 32,
        height: 20,
        text: row.meta,
        fill: "transparent",
        stroke: "transparent",
        textColor: "#344054",
        fontSize: 13,
        lineHeight: 20
      }));
    });
  }
  if (sectionKind === "footer") {
    nodes.push(createCompilerNode("button", {
      parentId: frameId,
      name: "底部主按钮",
      x: safeX,
      y: frame.y + frame.height - 76,
      width,
      height: 52,
      text: inferPrimaryAction(request),
      radius: 18
    }));
  }
  return nodes.map((node) => applyLibraryTokens(node, profile));
}

function inferProductName(request: string) {
  const entity = inferBusinessEntityForStitch(request);
  return entity !== "业务" ? `${entity}管理系统` : "业务管理系统";
}

function inferPageTitle(request: string) {
  const explicitTitle = extractRequestedPageTitle(request);
  if (explicitTitle) return explicitTitle;
  if (/详情/.test(request)) return "详情页";
  if (/表单|新增|编辑/.test(request)) return "表单编辑";
  if (/登录|注册/.test(request)) return "登录注册";
  const entity = inferBusinessEntityForStitch(request);
  if (/列表|记录|管理|查询|搜索|table|list/i.test(request)) return `${entity}列表`;
  return `${entity}工作台`;
}

function inferBusinessEntityForStitch(request: string) {
  if (/订单|交易|支付|退款/.test(request)) return "订单";
  if (/商品|产品|SKU|库存/i.test(request)) return "商品";
  if (/客户|用户|会员/.test(request)) return "客户";
  if (/设备|告警|IoT/i.test(request)) return "设备";
  return "业务";
}

function inferAdminNavItems(request: string) {
  const entity = inferBusinessEntityForStitch(request);
  const items = ["工作台", `${entity}管理`];
  if (/审核|审批|认证/.test(request)) items.push("审核中心");
  if (/告警|监控|趋势|dashboard|数据|报表/i.test(request)) items.push("数据看板");
  if (/设置|配置|权限|系统/.test(request)) items.push("系统设置");
  return Array.from(new Set(items)).slice(0, 6);
}

function inferPrimaryAction(request: string) {
  if (/导出/.test(request)) return "导出数据";
  if (/审核|审批|认证/.test(request)) return "开始审核";
  if (/编辑|修改|设置/.test(request)) return "保存";
  const entity = inferBusinessEntityForStitch(request);
  return entity !== "业务" ? `新增${entity}` : "新增";
}

function inferStatsForEntity(entity: string) {
  return [
    { label: `总${entity}`, value: "8,392" },
    { label: "新增", value: "128" },
    { label: "待处理", value: "42" },
    { label: "异常", value: "7" }
  ];
}

function inferFilterFields(entity: string, request = "") {
  const requestedFields = extractFieldHintsFromText(request);
  if (requestedFields.length > 0) return requestedFields.slice(0, 4);
  return [`${entity}名称`, "状态", "创建时间", "负责人"];
}

function inferTableColumns(entity: string, request = "") {
  const requestedFields = extractFieldHintsFromText(request);
  const fields = requestedFields.length > 0 ? requestedFields : [`${entity}名称`, "负责人", "状态", "创建时间"];
  return Array.from(new Set([...fields.slice(0, 5), "操作"]));
}

function inferTableRows(entity: string) {
  return [
    [`${entity} A`, "负责人 A", "启用", "2026-05-08", "查看"],
    [`${entity} B`, "负责人 B", "启用", "2026-05-07", "查看"],
    [`${entity} C`, "负责人 C", "停用", "2026-05-06", "查看"]
  ];
}

function inferDetailFields(entity: string, request = "") {
  const requestedFields = extractFieldHintsFromText(request);
  const defaults = entity === "商品"
    ? ["商品名称", "商品编号", "分类", "销售状态", "价格", "库存", "规格", "更新时间", "商品描述", "售后说明"]
    : [`${entity}名称`, `${entity}编号`, "状态", "类型", "负责人", "创建时间", "更新时间", "备注"];
  return Array.from(new Set([...(requestedFields.length > 0 ? requestedFields : defaults)]));
}

function inferDetailFieldValue(entity: string, field: string, request = "") {
  if (/名称|标题/.test(field)) return entity === "商品" ? "智能恒温水杯 Pro" : `${entity}示例名称`;
  if (/编号|ID|编码/.test(field)) return entity === "商品" ? "SPU-20260508-001" : `${entity.toUpperCase()}-20260508`;
  if (/分类|类型/.test(field)) return entity === "商品" ? "智能硬件 / 生活电器" : "标准类型";
  if (/状态/.test(field)) return entity === "商品" ? "上架中" : "启用";
  if (/价格|金额/.test(field)) return "¥ 299.00";
  if (/库存/.test(field)) return "1,248 件";
  if (/规格/.test(field)) return "曜石黑 / 500ml / 标准版";
  if (/时间|日期/.test(field)) return "2026-05-08 10:24";
  if (/负责人/.test(field)) return "负责人 A";
  if (/描述|说明|备注/.test(field)) return entity === "商品" ? "适合日常通勤与办公室使用，支持智能温控与状态提醒。" : "用于展示当前对象的关键详情信息。";
  return `${field}内容`;
}

function inferMobileRows(entity: string) {
  return [
    { title: `${entity}记录 001`, desc: "负责人 A / 2026-05-08 10:24", status: "待处理", meta: "支持查看详情与后续操作" },
    { title: `${entity}记录 002`, desc: "负责人 B / 2026-05-08 09:15", status: "已完成", meta: "支持查看详情与后续操作" },
    { title: `${entity}记录 003`, desc: "负责人 C / 2026-05-07 18:40", status: "异常", meta: "支持查看详情与后续操作" }
  ];
}

function extractRequestedPageTitle(request: string) {
  const quoted = /页面[：「“"]([^」”"\n]{2,24})[」”"]/.exec(request)?.[1]?.trim()
    ?? /本次只生成[^「“"]*[「“"]([^」”"\n]{2,24})[」”"]/.exec(request)?.[1]?.trim();
  if (quoted) return quoted.replace(/\s*画板$/, "");
  const explicit = /([\u4e00-\u9fa5A-Za-z0-9_-]{2,24}(?:页面|页|列表|详情|表单|工作台|看板))/.exec(request)?.[1]?.trim();
  return explicit?.replace(/\s*画板$/, "");
}

function extractFieldHintsFromText(text: string) {
  const fields = new Set<string>();
  const normalized = text.replace(/[，,、；;\n]/g, " ");
  const explicit = normalized.match(/(?:字段|列|表头|筛选项|查询项)[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9_\-\s/]+?)(?:。|$)/)?.[1];
  (explicit ?? "").split(/[\s/]+/).map((item) => item.trim()).filter((item) => item.length >= 2 && item.length <= 8).forEach((item) => fields.add(item));
  ["名称", "状态", "负责人", "创建时间", "更新时间", "类型", "分类", "编号", "手机号", "邮箱", "角色", "地区", "备注"].forEach((field) => {
    if (normalized.includes(field)) fields.add(field);
  });
  return Array.from(fields).slice(0, 6);
}

function getStatusFill(status: string) {
  if (/待|异常|失败|风险|警告/.test(status)) return "#fff7e6";
  if (/已|启用|通过|完成|成功/.test(status)) return "#ecfdf3";
  if (/停用|关闭|禁用/.test(status)) return "#f2f4f7";
  return "#eff6ff";
}

function getStatusColor(status: string) {
  if (/待|异常|失败|风险|警告/.test(status)) return "#b54708";
  if (/已|启用|通过|完成|成功/.test(status)) return "#067647";
  if (/停用|关闭|禁用/.test(status)) return "#667085";
  return "#175cd3";
}

export function buildSemanticTreeFromNodes(nodes: WorkspaceDesignNode[], profile: DesignCapabilityProfile): SemanticUiNode {
  const rootFrames = nodes.filter((node) => node.type === "frame" && !node.parentId);
  const children = (rootFrames.length > 0 ? rootFrames : nodes.filter((node) => !node.parentId)).map((node) =>
    buildSemanticNode(node, nodes, profile)
  );
  return {
    type: "Page",
    id: "semantic-page",
    name: "Semantic Page",
    variant: profile.platform,
    children
  };
}

export function buildLayoutTreeFromSemanticTree(
  semanticTree: SemanticUiNode,
  canvas: { x?: number; y?: number; width: number; height: number },
  profile: DesignCapabilityProfile
): LayoutTreeNode {
  const gap = getCompilerSpacing(profile, "md");
  const padding = getCompilerSpacing(profile, "lg");
  return buildLayoutNode(semanticTree, {
    x: canvas.x ?? 0,
    y: canvas.y ?? 0,
    width: canvas.width,
    height: canvas.height
  }, gap, padding);
}

export function renderSceneGraphFromLayoutTree(
  layoutTree: LayoutTreeNode,
  sourceNodes: WorkspaceDesignNode[] = [],
  profile: DesignCapabilityProfile
): WorkspaceDesignNode[] {
  const sourceById = new Map(sourceNodes.map((node) => [node.id, node]));
  const nodes: WorkspaceDesignNode[] = [];
  renderLayoutNode(layoutTree, sourceById, profile, nodes);
  return compileLayoutTreeToSceneGraph(nodes, profile);
}

export function compileSemanticTreeToSceneGraph(
  semanticTree: SemanticUiNode,
  canvas: { x?: number; y?: number; width: number; height: number },
  profile: DesignCapabilityProfile
): SceneGraphBuildResult {
  const layoutTree = buildLayoutTreeFromSemanticTree(semanticTree, canvas, profile);
  const nodes = renderSceneGraphFromLayoutTree(layoutTree, [], profile);
  return {
    semanticTree,
    layoutTree,
    nodes,
    diagnostics: []
  };
}

export function renderButtonComponent(
  layoutNode: LayoutTreeNode,
  sourceNode: WorkspaceDesignNode | undefined,
  profile: DesignCapabilityProfile
): WorkspaceDesignNode {
  const tokens = profile.libraries[0]?.tokens;
  const height = Math.max(layoutNode.frame.height, profile.platform === "pc_web" ? 40 : 44);
  return createCompilerNode("button", {
    ...sourceNode,
    id: sourceNode?.id ?? layoutNode.id,
    name: sourceNode?.name ?? layoutNode.semantic.name ?? "按钮",
    x: layoutNode.frame.x,
    y: layoutNode.frame.y,
    width: layoutNode.frame.width,
    height,
    text: sourceNode?.text ?? layoutNode.semantic.content ?? layoutNode.semantic.name ?? "按钮",
    fill: sourceNode?.fill ?? tokens?.colors.primary ?? "#1677ff",
    textColor: sourceNode?.textColor ?? "#ffffff",
    radius: sourceNode?.radius ?? tokens?.radius.button ?? 6,
    textAlign: "center",
    textVerticalAlign: "middle",
    lineHeight: height
  });
}

export function renderTextComponent(
  layoutNode: LayoutTreeNode,
  sourceNode: WorkspaceDesignNode | undefined,
  profile: DesignCapabilityProfile
): WorkspaceDesignNode {
  const tokens = profile.libraries[0]?.tokens;
  return createCompilerNode("text", {
    ...sourceNode,
    id: sourceNode?.id ?? layoutNode.id,
    name: sourceNode?.name ?? layoutNode.semantic.name ?? "文本",
    x: layoutNode.frame.x,
    y: layoutNode.frame.y,
    width: layoutNode.frame.width,
    height: layoutNode.frame.height,
    text: sourceNode?.text ?? layoutNode.semantic.content ?? layoutNode.semantic.name ?? "文本",
    fill: "transparent",
    stroke: "transparent",
    strokeWidth: 0,
    textColor: sourceNode?.textColor ?? tokens?.colors.text ?? "#101828",
    fontSize: sourceNode?.fontSize ?? tokens?.typography.body ?? 14,
    lineHeight: sourceNode?.lineHeight ?? Math.ceil((sourceNode?.fontSize ?? tokens?.typography.body ?? 14) * 1.45)
  });
}

export function renderInputComponent(
  layoutNode: LayoutTreeNode,
  sourceNode: WorkspaceDesignNode | undefined,
  profile: DesignCapabilityProfile
): WorkspaceDesignNode {
  const tokens = profile.libraries[0]?.tokens;
  const height = Math.max(layoutNode.frame.height, profile.platform === "pc_web" ? 36 : 44);
  return createCompilerNode("input", {
    ...sourceNode,
    id: sourceNode?.id ?? layoutNode.id,
    name: sourceNode?.name ?? layoutNode.semantic.name ?? "输入框",
    x: layoutNode.frame.x,
    y: layoutNode.frame.y,
    width: layoutNode.frame.width,
    height,
    text: sourceNode?.text ?? layoutNode.semantic.content ?? "",
    fill: sourceNode?.fill ?? tokens?.colors.surface ?? "#ffffff",
    stroke: sourceNode?.stroke ?? tokens?.colors.border ?? "#d9e2ec",
    radius: sourceNode?.radius ?? tokens?.radius.control ?? 6,
    textVerticalAlign: "middle",
    lineHeight: height
  });
}

export function renderImageComponent(
  layoutNode: LayoutTreeNode,
  sourceNode: WorkspaceDesignNode | undefined
): WorkspaceDesignNode {
  return createCompilerNode("image", {
    ...sourceNode,
    id: sourceNode?.id ?? layoutNode.id,
    name: sourceNode?.name ?? layoutNode.semantic.name ?? "图片",
    x: layoutNode.frame.x,
    y: layoutNode.frame.y,
    width: layoutNode.frame.width,
    height: layoutNode.frame.height,
    fill: sourceNode?.fill ?? "#eef4ff",
    stroke: sourceNode?.stroke ?? "transparent",
    radius: sourceNode?.radius ?? 12
  });
}

export function renderCardComponent(
  layoutNode: LayoutTreeNode,
  sourceNode: WorkspaceDesignNode | undefined,
  profile: DesignCapabilityProfile
): WorkspaceDesignNode {
  const tokens = profile.libraries[0]?.tokens;
  return createCompilerNode("card", {
    ...sourceNode,
    id: sourceNode?.id ?? layoutNode.id,
    name: sourceNode?.name ?? layoutNode.semantic.name ?? "卡片",
    x: layoutNode.frame.x,
    y: layoutNode.frame.y,
    width: layoutNode.frame.width,
    height: layoutNode.frame.height,
    fill: sourceNode?.fill ?? tokens?.colors.surface ?? "#ffffff",
    stroke: sourceNode?.stroke ?? tokens?.colors.border ?? "#d9e2ec",
    radius: sourceNode?.radius ?? tokens?.radius.card ?? 8,
    strokeWidth: sourceNode?.strokeWidth ?? 1
  });
}

function buildSemanticNode(
  node: WorkspaceDesignNode,
  allNodes: WorkspaceDesignNode[],
  profile: DesignCapabilityProfile
): SemanticUiNode {
  const children = allNodes
    .filter((child) => child.parentId === node.id)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((child) => buildSemanticNode(child, allNodes, profile));
  return {
    type: inferSemanticType(node, profile),
    id: node.id,
    name: node.name,
    content: node.text,
    variant: node.type,
    props: {
      sourceType: node.type,
      frame: { x: node.x, y: node.y, width: node.width, height: node.height }
    },
    children
  };
}

function inferSemanticType(node: WorkspaceDesignNode, profile: DesignCapabilityProfile): SemanticUiNodeType {
  const label = `${node.name} ${node.text ?? ""}`.toLowerCase();
  if (node.type === "frame") return "Page";
  if (node.type === "button") return "Button";
  if (node.type === "input") return "Field";
  if (node.type === "table") return "Table";
  if (node.type === "image") return "Image";
  if (node.type === "text") return "Text";
  if (/toolbar|工具栏|操作栏|action/.test(label)) return "Toolbar";
  if (/search|查询|筛选|搜索/.test(label)) return "SearchBar";
  if (/tabs?|标签页|tab/.test(label)) return "Tabs";
  if (/form|表单/.test(label)) return "Form";
  if (/status|状态|统计/.test(label)) return "StatusPanel";
  if (node.type === "card") return "Card";
  return profile.platform === "pc_web" ? "CardList" : "Card";
}

function buildLayoutNode(
  semantic: SemanticUiNode,
  frame: { x: number; y: number; width: number; height: number },
  gap: number,
  padding: number
): LayoutTreeNode {
  const children = semantic.children ?? [];
  const layout = inferLayoutMode(semantic);
  const childFrames = computeChildFrames(children, frame, layout, gap, padding);
  return {
    id: semantic.id ?? createCompilerId("layout"),
    type: semantic.type,
    layout,
    frame,
    gap,
    padding,
    semantic,
    children: children.map((child, index) => buildLayoutNode(child, childFrames[index], gap, padding))
  };
}

function computeChildFrames(
  children: SemanticUiNode[],
  frame: { x: number; y: number; width: number; height: number },
  layout: LayoutTreeNode["layout"],
  gap: number,
  padding: number
) {
  if (children.length === 0) return [];
  if (layout === "absolute") {
    return children.map((child, index) => readSemanticFrame(child) ?? {
      x: frame.x + padding,
      y: frame.y + padding + index * (64 + gap),
      width: Math.max(80, frame.width - padding * 2),
      height: 64
    });
  }
  if (layout === "horizontal") {
    const width = Math.max(48, (frame.width - padding * 2 - gap * (children.length - 1)) / children.length);
    return children.map((child, index) => readSemanticFrame(child) ?? {
      x: frame.x + padding + index * (width + gap),
      y: frame.y + padding,
      width,
      height: Math.max(32, frame.height - padding * 2)
    });
  }
  if (layout === "grid") {
    const columns = Math.min(3, Math.max(1, children.length));
    const width = Math.max(80, (frame.width - padding * 2 - gap * (columns - 1)) / columns);
    const height = Math.max(96, Math.min(180, (frame.height - padding * 2) / Math.ceil(children.length / columns)));
    return children.map((child, index) => readSemanticFrame(child) ?? {
      x: frame.x + padding + (index % columns) * (width + gap),
      y: frame.y + padding + Math.floor(index / columns) * (height + gap),
      width,
      height
    });
  }
  const height = Math.max(32, (frame.height - padding * 2 - gap * (children.length - 1)) / children.length);
  return children.map((child, index) => readSemanticFrame(child) ?? {
    x: frame.x + padding,
    y: frame.y + padding + index * (height + gap),
    width: Math.max(80, frame.width - padding * 2),
    height
  });
}

function renderLayoutNode(
  layoutNode: LayoutTreeNode,
  sourceById: Map<string, WorkspaceDesignNode>,
  profile: DesignCapabilityProfile,
  output: WorkspaceDesignNode[],
  parentId?: string
) {
  const sourceNode = sourceById.get(layoutNode.id);
  const node = renderLayoutComponent(layoutNode, sourceNode, profile);
  const withParent = parentId && node.type !== "frame" ? { ...node, parentId } : node;
  output.push(withParent);
  layoutNode.children.forEach((child) => renderLayoutNode(child, sourceById, profile, output, withParent.id));
}

function renderLayoutComponent(
  layoutNode: LayoutTreeNode,
  sourceNode: WorkspaceDesignNode | undefined,
  profile: DesignCapabilityProfile
) {
  if (layoutNode.type === "Button") return renderButtonComponent(layoutNode, sourceNode, profile);
  if (layoutNode.type === "Field" || layoutNode.type === "SearchBar") return renderInputComponent(layoutNode, sourceNode, profile);
  if (layoutNode.type === "Text") return renderTextComponent(layoutNode, sourceNode, profile);
  if (layoutNode.type === "Image") return renderImageComponent(layoutNode, sourceNode);
  if (layoutNode.type === "Card" || layoutNode.type === "StatusPanel" || layoutNode.type === "CardList") {
    return renderCardComponent(layoutNode, sourceNode, profile);
  }
  const nodeType: WorkspaceDesignNodeType = layoutNode.type === "Page" ? "frame" : layoutNode.type === "Table" ? "table" : "container";
  return createCompilerNode(nodeType, {
    ...sourceNode,
    id: sourceNode?.id ?? layoutNode.id,
    name: sourceNode?.name ?? layoutNode.semantic.name ?? layoutNode.type,
    x: layoutNode.frame.x,
    y: layoutNode.frame.y,
    width: layoutNode.frame.width,
    height: layoutNode.frame.height,
    text: sourceNode?.text ?? layoutNode.semantic.content
  });
}

function readSemanticFrame(semantic: SemanticUiNode) {
  const frame = semantic.props?.frame;
  if (!frame || typeof frame !== "object") return undefined;
  const candidate = frame as Partial<{ x: unknown; y: unknown; width: unknown; height: unknown }>;
  if (
    typeof candidate.x !== "number" ||
    typeof candidate.y !== "number" ||
    typeof candidate.width !== "number" ||
    typeof candidate.height !== "number"
  ) return undefined;
  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height
  };
}

function getSceneCanvasBounds(nodes: WorkspaceDesignNode[]) {
  if (nodes.length === 0) return { x: 0, y: 0, width: 1440, height: 900 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function collectSceneGraphDiagnostics(nodes: WorkspaceDesignNode[], layoutTree: LayoutTreeNode) {
  const diagnostics: string[] = [];
  if (nodes.length === 0) diagnostics.push("empty-scene-graph");
  if (!layoutTree.children.length) diagnostics.push("empty-layout-tree");
  const orphanNodes = nodes.filter((node) => node.parentId && !nodes.some((candidate) => candidate.id === node.parentId));
  if (orphanNodes.length > 0) diagnostics.push(`orphan-nodes:${orphanNodes.length}`);
  return diagnostics;
}

function collectLayoutIntentCoverageDiagnostics(schemaDraft: StitchUiSchemaDraft, nodes: WorkspaceDesignNode[]) {
  const diagnostics: string[] = [];
  schemaDraft.artboards.forEach((artboard) => {
    if (!artboard.layoutIntent) return;
    const coverage = collectLayoutIntentCoverage(artboard.layoutIntent);
    const actualCounts = countRenderedCoverageNodes(nodes, artboard.name);
    Object.entries(coverage.expectedNodeCounts).forEach(([type, expected]) => {
      if (expected <= 0) return;
      const actual = actualCounts[type] ?? 0;
      if (actual === 0) {
        diagnostics.push(`compiler-coverage:${artboard.name}:${type}:${actual}/${expected}`);
      } else if (actual < Math.ceil(expected * 0.6)) {
        diagnostics.push(`compiler-coverage-warning:${artboard.name}:${type}:${actual}/${expected}`);
      }
    });
    const missingTexts = coverage.expectedTexts.filter((text) => !isTextCoveredByRenderedNodes(text, nodes));
    if (coverage.expectedTexts.length >= 4 && missingTexts.length >= Math.max(3, Math.ceil(coverage.expectedTexts.length * 0.3))) {
      diagnostics.push(`compiler-coverage:${artboard.name}:text-missing:${coverage.expectedTexts.length - missingTexts.length}/${coverage.expectedTexts.length}:${missingTexts.slice(0, 8).join("|")}`);
    }
    if (coverage.descriptionItems > 0) {
      const renderedTextCount = nodes.filter((node) => node.type === "text" && isNodeLikelyInsideArtboard(node, artboard.name, nodes)).length;
      const expectedTextCount = coverage.descriptionItems * 2;
      if (renderedTextCount < Math.ceil(expectedTextCount * 0.6)) {
        diagnostics.push(`compiler-coverage:${artboard.name}:DescriptionListItems:${renderedTextCount}/${expectedTextCount}`);
      }
    }
  });
  return diagnostics;
}

function collectLayoutIntentCoverage(intent: LayoutIntentDraftNode) {
  const expectedNodeCounts: Record<string, number> = {};
  const expectedTexts: string[] = [];
  let descriptionItems = 0;
  const visit = (node: LayoutIntentDraftNode) => {
    const normalizedType = normalizeLayoutIntentType(node.type);
    const renderedType = getCoverageRenderedType(normalizedType);
    if (renderedType) expectedNodeCounts[renderedType] = (expectedNodeCounts[renderedType] ?? 0) + 1;
    if (normalizedType === "DescriptionList") descriptionItems += normalizeKeyValueItems(node).length;
    collectCoverageTexts(node).forEach((text) => {
      if (!expectedTexts.includes(text)) expectedTexts.push(text);
    });
    (node.children ?? []).forEach(visit);
  };
  visit(intent);
  return { expectedNodeCounts, expectedTexts, descriptionItems };
}

function getCoverageRenderedType(normalizedType: string) {
  if (normalizedType === "Text" || normalizedType === "Title") return "text";
  if (normalizedType === "Button" || normalizedType === "StatusTag") return "button";
  if (normalizedType === "Input" || normalizedType === "Field" || normalizedType === "Select") return "input";
  if (normalizedType === "Image") return "image";
  if (normalizedType === "Table") return "table";
  if (normalizedType === "Card" || normalizedType === "Panel") return "card";
  return undefined;
}

function collectCoverageTexts(intent: LayoutIntentDraftNode) {
  const normalizedType = normalizeLayoutIntentType(intent.type);
  const values: string[] = [];
  if (intent.text) values.push(intent.text);
  if ((normalizedType === "Button" || normalizedType === "Input" || normalizedType === "Select") && intent.label) values.push(intent.label);
  if (normalizedType === "DescriptionList") {
    normalizeKeyValueItems(intent).forEach((item) => {
      values.push(item.label, item.value);
    });
  }
  return values.map(cleanCoverageText).filter(isMeaningfulCoverageText);
}

function cleanCoverageText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isMeaningfulCoverageText(value: string) {
  if (!value || value.length < 2) return false;
  if (/^(文本|按钮|请输入|图片|状态|字段\s*\d+|-)$/.test(value)) return false;
  return true;
}

function countRenderedCoverageNodes(nodes: WorkspaceDesignNode[], artboardName: string) {
  const scopedNodes = nodes.filter((node) => isNodeLikelyInsideArtboard(node, artboardName, nodes));
  return scopedNodes.reduce<Record<string, number>>((counts, node) => {
    counts[node.type] = (counts[node.type] ?? 0) + 1;
    return counts;
  }, {});
}

function isTextCoveredByRenderedNodes(text: string, nodes: WorkspaceDesignNode[]) {
  const expected = cleanCoverageText(text);
  return nodes.some((node) => {
    const actual = cleanCoverageText(String(node.text ?? ""));
    return actual === expected || actual.includes(expected) || expected.includes(actual);
  });
}

function isNodeLikelyInsideArtboard(node: WorkspaceDesignNode, artboardName: string, nodes: WorkspaceDesignNode[]) {
  const frame = nodes.find((candidate) => candidate.type === "frame" && candidate.name.includes(artboardName));
  if (!frame) return true;
  return node.id === frame.id || node.parentId === frame.id || isNodeInsideTargetWithTolerance(node, frame, 4);
}

function inferLayoutMode(semantic: SemanticUiNode): LayoutTreeNode["layout"] {
  if (semantic.type === "Toolbar" || semantic.type === "Tabs" || semantic.type === "ActionBar") return "horizontal";
  if (semantic.type === "CardList") return "grid";
  if (semantic.type === "Page") return "absolute";
  return "vertical";
}

function normalizeComponentNode(node: WorkspaceDesignNode, profile: DesignCapabilityProfile): WorkspaceDesignNode {
  const tokens = profile.libraries[0]?.tokens;
  if (node.type === "button") {
    const height = Math.max(node.height, profile.platform === "pc_web" ? 40 : 44);
    return {
      ...node,
      height,
      radius: node.radius || tokens?.radius.button || 10,
      textAlign: "center",
      textVerticalAlign: "middle",
      lineHeight: height,
      fontSize: Math.max(13, node.fontSize || tokens?.typography.body || 14)
    };
  }
  if (node.type === "input") {
    const height = Math.max(node.height, profile.platform === "pc_web" ? 36 : 44);
    return {
      ...node,
      height,
      radius: node.radius || tokens?.radius.control || 10,
      textVerticalAlign: "middle",
      lineHeight: height,
      fontSize: Math.max(13, node.fontSize || tokens?.typography.body || 14)
    };
  }
  if (node.type === "card" || node.type === "container") {
    return {
      ...node,
      radius: node.radius || tokens?.radius.card || 12,
      strokeWidth: node.strokeWidth ?? 1
    };
  }
  if (node.type === "text") {
    return {
      ...expandTextNodeForReadability(node),
      textVerticalAlign: node.textVerticalAlign || "top",
      lineHeight: node.lineHeight || Math.ceil((node.fontSize || tokens?.typography.body || 14) * 1.45)
    };
  }
  return node;
}

function clampNodesIntoArtboards(nodes: WorkspaceDesignNode[], profile: DesignCapabilityProfile) {
  const padding = getCompilerSpacing(profile, "lg");
  return nodes.map((node) => {
    if (node.type === "frame") return node;
    const frame = nodes.find((candidate) => candidate.type === "frame" && candidate.id !== node.id && (
      node.parentId === candidate.id || isNodeInsideTarget(node, candidate)
    ));
    if (!frame) return node;
    const minX = frame.x + padding;
    const maxX = frame.x + frame.width - padding;
    const minY = frame.y + padding;
    const maxY = frame.y + frame.height - padding;
    const width = Math.min(node.width, Math.max(48, maxX - minX));
    const height = Math.min(node.height, Math.max(24, maxY - minY));
    return {
      ...node,
      parentId: node.parentId || frame.id,
      width,
      height,
      x: clampNumber(node.x, minX, Math.max(minX, maxX - width)),
      y: clampNumber(node.y, minY, Math.max(minY, maxY - height))
    };
  });
}

function stackFunctionalSiblings(nodes: WorkspaceDesignNode[], profile: DesignCapabilityProfile) {
  const gap = getCompilerSpacing(profile, "md");
  const parentIds = Array.from(new Set(nodes.map((node) => node.parentId).filter((id): id is string => Boolean(id))));
  let nextNodes = [...nodes];
  parentIds.forEach((parentId) => {
    const parent = nextNodes.find((node) => node.id === parentId);
    if (!parent) return;
    const siblings = nextNodes
      .filter((node) => node.parentId === parentId && node.visible !== false && isFunctionalContentNode(node) && shouldAutoStackNode(node))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const yById = new Map<string, number>();
    siblings.forEach((node, index) => {
      let y = yById.get(node.id) ?? node.y;
      for (let i = 0; i < index; i += 1) {
        const previous = siblings[i];
        const previousY = yById.get(previous.id) ?? previous.y;
        const horizontalOverlap = node.x < previous.x + previous.width && node.x + node.width > previous.x;
        const verticalConflict = y < previousY + previous.height + gap && y + node.height > previousY;
        if (horizontalOverlap && verticalConflict) {
          y = previousY + previous.height + gap;
        }
      }
      const maxY = parent.y + parent.height - gap - node.height;
      yById.set(node.id, clampNumber(y, parent.y + gap, Math.max(parent.y + gap, maxY)));
    });
    nextNodes = nextNodes.map((node) => yById.has(node.id) ? { ...node, y: yById.get(node.id) ?? node.y } : node);
  });
  return reflowOverlappingNodes(nextNodes, gap);
}

function stabilizeArtboardModuleLayout(nodes: WorkspaceDesignNode[], profile: DesignCapabilityProfile) {
  const frameGap = getCompilerSpacing(profile, "lg");
  let nextNodes = [...nodes];
  const frames = nextNodes
    .filter((node) => node.type === "frame")
    .sort((a, b) => a.y - b.y || a.x - b.x);
  frames.forEach((frame) => {
    const directChildren = nextNodes
      .filter((node) => node.parentId === frame.id && node.visible !== false && shouldStabilizeAsArtboardModule(node, frame))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (directChildren.length < 2) return;
    const rows = groupNodesIntoLayoutRows(directChildren);
    if (rows.length < 2) return;
    const shifts = new Map<string, number>();
    let cursorBottom = Math.max(frame.y + frameGap, rows[0].bounds.y);
    rows.forEach((row, index) => {
      const minY = index === 0 ? row.bounds.y : cursorBottom + frameGap;
      const dy = Math.max(0, Math.ceil(minY - row.bounds.y));
      if (dy > 0) row.nodes.forEach((node) => shifts.set(node.id, (shifts.get(node.id) ?? 0) + dy));
      cursorBottom = row.bounds.y + dy + row.bounds.height;
    });
    if (shifts.size === 0) return;
    nextNodes = translateNodesAndDescendants(nextNodes, shifts);
  });
  return nextNodes;
}

function groupNodesIntoLayoutRows(nodes: WorkspaceDesignNode[]) {
  const rows: Array<{ nodes: WorkspaceDesignNode[]; bounds: LayoutBounds }> = [];
  nodes.forEach((node) => {
    const candidate = getNodeBounds(node);
    const row = rows.find((item) => candidate.y < item.bounds.y + item.bounds.height && candidate.y + candidate.height > item.bounds.y);
    if (row) {
      row.nodes.push(node);
      row.bounds = mergeLayoutBounds(row.bounds, candidate);
      return;
    }
    rows.push({ nodes: [node], bounds: candidate });
  });
  return rows.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
}

function translateNodesAndDescendants(nodes: WorkspaceDesignNode[], rootShifts: Map<string, number>) {
  const childrenByParent = new Map<string, WorkspaceDesignNode[]>();
  nodes.forEach((node) => {
    if (!node.parentId) return;
    const list = childrenByParent.get(node.parentId) ?? [];
    list.push(node);
    childrenByParent.set(node.parentId, list);
  });
  const shiftById = new Map<string, number>();
  rootShifts.forEach((dy, id) => {
    const visit = (nodeId: string) => {
      shiftById.set(nodeId, Math.max(shiftById.get(nodeId) ?? 0, dy));
      (childrenByParent.get(nodeId) ?? []).forEach((child) => visit(child.id));
    };
    visit(id);
  });
  return nodes.map((node) => {
    const dy = shiftById.get(node.id) ?? 0;
    return dy > 0 ? translateCompilerNode(node, 0, dy) : node;
  });
}

function translateCompilerNode(node: WorkspaceDesignNode, dx: number, dy: number): WorkspaceDesignNode {
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

function shouldStabilizeAsArtboardModule(node: WorkspaceDesignNode, frame: WorkspaceDesignNode) {
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

function getNodeBounds(node: WorkspaceDesignNode): LayoutBounds {
  return {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height
  };
}

function mergeLayoutBounds(first: LayoutBounds, second: LayoutBounds): LayoutBounds {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y
  };
}

function reflowOverlappingNodes(nodes: WorkspaceDesignNode[], spacing: number) {
  const readableNodes = nodes.map((node) => node.type === "text" ? expandTextNodeForReadability(node) : node);
  const sorted = [...readableNodes].filter(shouldAutoStackNode).sort((a, b) => a.y - b.y || a.x - b.x);
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
  return expandFramesToFitChildren(movedNodes, spacing);
}

function measureAndReflowReadableLayout(nodes: WorkspaceDesignNode[], profile: DesignCapabilityProfile) {
  const spacing = getCompilerSpacing(profile, "md");
  const padding = profile.platform === "pc_web" || profile.platform === "responsive_web"
    ? getCompilerSpacing(profile, "lg")
    : getCompilerSpacing(profile, "md");
  let nextNodes = nodes.map((node) => repairNodeMeasuredBounds(node, nodes, padding, profile));
  nextNodes = expandContainersToMeasuredChildren(nextNodes, spacing);
  nextNodes = reflowDirectChildrenWithinParents(nextNodes, spacing);
  nextNodes = clampReadableNodesIntoParents(nextNodes, padding);
  nextNodes = expandContainersToMeasuredChildren(nextNodes, spacing);
  return reflowOverlappingNodes(nextNodes, spacing);
}

function repairNodeMeasuredBounds(
  node: WorkspaceDesignNode,
  nodes: WorkspaceDesignNode[],
  padding: number,
  profile: DesignCapabilityProfile
): WorkspaceDesignNode {
  const parent = findNodeLayoutParent(node, nodes);
  if (!parent || node.type === "frame") return fixNodeReadability(node);
  const maxWidth = Math.max(32, parent.width - padding * 2);
  const maxX = parent.x + parent.width - padding;
  const minX = parent.x + padding;
  if (node.type === "text") {
    const text = String(node.text ?? node.name ?? "").trim();
    const fontSize = node.fontSize || (profile.platform === "pc_web" || profile.platform === "responsive_web" ? 14 : 13);
    const lineHeight = node.lineHeight || Math.ceil(fontSize * 1.45);
    const minReadableWidth = getMinimumReadableTextWidth(text, fontSize, maxWidth, profile);
    const width = Math.min(maxWidth, Math.max(node.width, minReadableWidth));
    const x = node.x + width > maxX ? Math.max(minX, maxX - width) : Math.max(minX, node.x);
    const charsPerLine = Math.max(1, Math.floor(width / Math.max(fontSize * 0.72, 7)));
    const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
    return {
      ...node,
      x,
      width,
      height: Math.max(node.height, Math.ceil(lines * lineHeight)),
      fontSize,
      lineHeight,
      textVerticalAlign: node.textVerticalAlign ?? "top"
    };
  }
  const width = Math.min(Math.max(node.width, node.type === "button" || node.type === "input" ? 72 : node.width), maxWidth);
  const x = node.x + width > maxX ? Math.max(minX, maxX - width) : Math.max(minX, node.x);
  return fixNodeReadability({ ...node, x, width });
}

function getMinimumReadableTextWidth(
  text: string,
  fontSize: number,
  maxWidth: number,
  profile: DesignCapabilityProfile
) {
  if (!text) return Math.min(maxWidth, 48);
  const hasCjk = /[\u4e00-\u9fa5]/.test(text);
  const minChars = hasCjk ? Math.min(Math.max(text.length, 2), 12) : Math.min(Math.max(text.length, 4), 16);
  const ideal = Math.ceil(minChars * fontSize * (hasCjk ? 1.05 : 0.62));
  const floor = profile.platform === "pc_web" || profile.platform === "responsive_web" ? 72 : 56;
  return Math.min(maxWidth, Math.max(floor, ideal));
}

function findNodeLayoutParent(node: WorkspaceDesignNode, nodes: WorkspaceDesignNode[]) {
  if (node.parentId) {
    const explicit = nodes.find((item) => item.id === node.parentId);
    if (explicit) return explicit;
  }
  return nodes
    .filter((candidate) => candidate.id !== node.id && (candidate.type === "frame" || candidate.type === "container" || candidate.type === "card"))
    .filter((candidate) => isNodeInsideTarget(node, candidate))
    .sort((a, b) => (a.width * a.height) - (b.width * b.height))[0];
}

function clampReadableNodesIntoParents(nodes: WorkspaceDesignNode[], padding: number) {
  return nodes.map((node) => {
    const parent = findNodeLayoutParent(node, nodes);
    if (!parent || node.type === "frame") return node;
    const maxWidth = Math.max(24, parent.width - padding * 2);
    const width = Math.min(node.width, maxWidth);
    return {
      ...node,
      width,
      x: clampNumber(node.x, parent.x + padding, Math.max(parent.x + padding, parent.x + parent.width - padding - width)),
      y: Math.max(parent.y + padding, node.y)
    };
  });
}

function expandContainersToMeasuredChildren(nodes: WorkspaceDesignNode[], spacing: number) {
  return nodes.map((node) => {
    if (node.type !== "container" && node.type !== "card" && node.type !== "frame") return node;
    const children = nodes.filter((child) => child.id !== node.id && child.parentId === node.id);
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

function reflowDirectChildrenWithinParents(nodes: WorkspaceDesignNode[], spacing: number) {
  let nextNodes = [...nodes];
  const parentIds = Array.from(new Set(nextNodes.map((node) => node.parentId).filter((id): id is string => Boolean(id))));
  parentIds.forEach((parentId) => {
    const children = nextNodes
      .filter((node) => node.parentId === parentId && node.visible !== false && shouldMeasureReflowNode(node))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const yById = new Map<string, number>();
    children.forEach((node, index) => {
      let y = yById.get(node.id) ?? node.y;
      for (let i = 0; i < index; i += 1) {
        const previous = children[i];
        const previousY = yById.get(previous.id) ?? previous.y;
        const horizontalOverlap = node.x < previous.x + previous.width && node.x + node.width > previous.x;
        const verticalConflict = y < previousY + previous.height + spacing && y + node.height > previousY;
        if (horizontalOverlap && verticalConflict) y = previousY + previous.height + spacing;
      }
      yById.set(node.id, y);
    });
    nextNodes = nextNodes.map((node) => yById.has(node.id) ? { ...node, y: yById.get(node.id) ?? node.y } : node);
  });
  return nextNodes;
}

function shouldMeasureReflowNode(node: WorkspaceDesignNode) {
  if (node.type === "frame") return false;
  if (node.type === "button" && node.height <= 56) return false;
  if (node.type === "input" && node.height <= 56) return false;
  return node.type === "text" || node.type === "card" || node.type === "container" || node.type === "image" || node.type === "table";
}

function shouldAutoStackNode(node: WorkspaceDesignNode) {
  const label = `${node.name} ${node.text ?? ""}`;
  if (/表头|数据行|内容\d+|列|单元格|导航项|菜单|筛选|输入|按钮|分页|上一页|下一页|状态|标签|统计|指标|工具栏|用户|头像|Logo/i.test(label)) {
    return false;
  }
  if (node.width < 120 && node.height <= 44) return false;
  return node.type === "text" || node.type === "table";
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

function fixNodeReadability(node: WorkspaceDesignNode): WorkspaceDesignNode {
  if (node.type === "button") {
    const fontSize = node.fontSize || 14;
    const height = Math.max(node.height, 44);
    return {
      ...node,
      height,
      fontSize,
      textAlign: "center",
      textVerticalAlign: "middle",
      lineHeight: height
    };
  }
  if (node.type === "text") {
    return expandTextNodeForReadability({
      ...node,
      lineHeight: node.lineHeight || Math.ceil((node.fontSize || 14) * 1.45)
    });
  }
  if (node.type === "input") {
    const height = Math.max(node.height, 44);
    return {
      ...node,
      height,
      textVerticalAlign: "middle",
      lineHeight: height
    };
  }
  return node;
}

function getCompilerSpacing(profile: DesignCapabilityProfile, size: "sm" | "md" | "lg") {
  const spacing = profile.libraries[0]?.tokens.spacing ?? [8, 12, 16, 24];
  if (size === "sm") return spacing[1] ?? 12;
  if (size === "lg") return spacing[3] ?? spacing[2] ?? 20;
  return spacing[2] ?? 16;
}

function isNodeInsideTarget(node: WorkspaceDesignNode, target: WorkspaceDesignNode) {
  if (node.id === target.id) return true;
  return node.x >= target.x
    && node.y >= target.y
    && node.x + node.width <= target.x + target.width
    && node.y + node.height <= target.y + target.height;
}

function isNodeInsideTargetWithTolerance(node: WorkspaceDesignNode, target: WorkspaceDesignNode, tolerance: number) {
  if (node.id === target.id) return true;
  return node.x >= target.x - tolerance
    && node.y >= target.y - tolerance
    && node.x + node.width <= target.x + target.width + tolerance
    && node.y + node.height <= target.y + target.height + tolerance;
}

function isFunctionalContentNode(node: WorkspaceDesignNode) {
  return node.type === "button" || node.type === "input" || node.type === "table" || node.type === "text";
}

function createCompilerNode(type: WorkspaceDesignNodeType, overrides: Partial<WorkspaceDesignNode> = {}): WorkspaceDesignNode {
  const node: WorkspaceDesignNode = {
    id: createCompilerId("node"),
    type,
    name: defaultNodeName(type),
    x: 0,
    y: 0,
    width: type === "text" ? 240 : type === "table" ? 760 : type === "input" ? 280 : 200,
    height: type === "text" ? 56 : type === "table" ? 280 : type === "button" ? 48 : 140,
    fill: type === "button" ? "#1677ff" : type === "text" ? "transparent" : "#ffffff",
    stroke: type === "text" ? "transparent" : "#d9e2ec",
    strokeWidth: type === "text" ? 0 : 1,
    radius: type === "button" || type === "input" ? 6 : 8,
    text: type === "text" ? "Text" : type === "button" ? "Button" : "",
    textColor: type === "button" ? "#ffffff" : "#101828",
    fontSize: type === "text" ? 14 : 14,
    visible: true,
    locked: false
  };
  return normalizeCompilerNode({ ...node, ...overrides, type });
}

function normalizeCompilerNode(node: WorkspaceDesignNode): WorkspaceDesignNode {
  return {
    ...node,
    width: Math.max(1, node.width),
    height: Math.max(1, node.height),
    radius: Math.max(0, node.radius ?? 0),
    visible: node.visible !== false,
    locked: Boolean(node.locked)
  };
}

function defaultNodeName(type: WorkspaceDesignNodeType) {
  const names: Record<WorkspaceDesignNodeType, string> = {
    frame: "画板",
    container: "容器",
    text: "文本",
    button: "按钮",
    input: "输入框",
    table: "表格",
    card: "卡片",
    image: "图片"
  };
  return names[type];
}

function createCompilerId(prefix: string) {
  return `compiler-${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
