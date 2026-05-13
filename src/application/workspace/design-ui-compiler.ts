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
    nodes?: StitchUiDraftNode[];
  }>;
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
    diagnostics: collectSceneGraphDiagnostics(normalizedNodes, layoutTree)
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
  const nodes = expandFramesToFitChildren(stabilized, getCompilerSpacing(profile, "md"));
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
  const frame = targetFrame ?? createCompilerNode("frame", {
    id: createCompilerId("frame"),
    name: `${artboard.name || "页面"} 画板`,
    x: options.placement ? options.placement.startX + index * (artboard.width + options.placement.gap) : 520 + index * (artboard.width + 56),
    y: options.placement?.topY ?? 220,
    width: isMobile ? Math.min(430, artboard.width || 375) : Math.max(1180, artboard.width || 1440),
    height: isMobile ? Math.max(760, artboard.height || 812) : Math.max(900, artboard.height || 1024),
    fill: isMobile ? "#f6f7f9" : "#f5f7fb",
    stroke: "#d9e2ec",
    radius: isMobile ? 28 : 0
  });
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
  if (/筛选|查询|搜索|摘要|工具栏|filter|search|toolbar|统计/i.test(text)) return "filters";
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
    const stats = inferStatsForEntity(entity);
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
