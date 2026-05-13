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
  WorkspaceDesignPage
} from "../../shared/types/workspace.js";
import { nowIso } from "../../shared/utils/time.js";

const nodeTypeSchema = z.enum(["frame", "container", "text", "button", "input", "table", "card", "image"]);
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

export const uiSchemaDraftSchema = z.object({
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
    nodes: z.array(uiSchemaDraftNodeSchema).default([])
  })).min(1).max(12)
});

export type UiSchemaDraft = z.infer<typeof uiSchemaDraftSchema>;

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
    description: "根据需求解析、页面清单和流程，在当前画布已有画板右侧追加多张可编辑 UI 画板；传 targetFrameId 时改为把 schemaDraft 的节点增量追加到已有画板内。",
    inputSchema: { userRequest: "string", parsedRequirement: "optional object", flowPlan: "optional object", platform: "optional mobile_app | web", pageId: "optional string", gap: "optional number", targetFrameId: "optional string", schemaDraft: "optional aipm.design.schema.v1" }
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
    name: "layout.reflow",
    description: "对页面做基础重排，检测明显重叠并下移后续节点。用于插入内容后的布局补偿。",
    inputSchema: { pageId: "optional string", spacing: "optional number" }
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
        message: "缺少有效的 schemaDraft。当前主链路不再使用关键词模板兜底，必须先由 Agent 生成符合 aipm.design.schema.v1 的 UI Schema Draft。",
        file,
        page,
        selectedPageId: page.id,
        data: { issues: parsedDraft.error.issues }
      };
    }
    const schemaDraft = parsedDraft.data;
    const capabilityProfile = getDesignCapabilityProfile(toDesignPlatform(schemaDraft.platform, String(input.userRequest ?? "")), String(input.userRequest ?? ""));
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
      const resolvedImageAssets = await this.imageAssets.resolveAssets(inferAssetRequests(String(input.userRequest ?? "")), {
        userRequest: String(input.userRequest ?? "")
      });
      const generatedNodes = enhanceGeneratedUiNodes(
        [targetFrame, ...createUiNodesFromSchemaDraftIntoFrame(schemaDraft, targetFrame, capabilityProfile)],
        capabilityProfile,
        resolvedImageAssets
      ).filter((node) => node.id !== targetFrame.id);
      const irrelevantContent = detectIrrelevantGeneratedBusinessContent(String(input.userRequest ?? ""), generatedNodes);
      if (irrelevantContent.length > 0) {
        return {
          ok: false,
          message: `生成内容包含用户未要求的业务对象：${irrelevantContent.join("、")}。已拦截落盘，请重新生成并严格按原始需求，不要套订单/商品等默认模板。`,
          file,
          page,
          selectedPageId: page.id,
          data: { irrelevantContent }
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
            artboards: schemaDraft.artboards.map((artboard) => ({ refId: artboard.refId, name: artboard.name, nodeCount: artboard.nodes.length }))
          }
        }
      };
    }
    const firstArtboard = schemaDraft.artboards[0];
    const placement = getCanvasAppendPlacement(page, { width: firstArtboard.width, height: firstArtboard.height }, gap);
    const resolvedImageAssets = await this.imageAssets.resolveAssets(inferAssetRequests(String(input.userRequest ?? "")), {
      userRequest: String(input.userRequest ?? "")
    });
    const generatedNodes = enhanceGeneratedUiNodes(createUiNodesFromSchemaDraft(schemaDraft, placement, capabilityProfile), capabilityProfile, resolvedImageAssets);
    const irrelevantContent = detectIrrelevantGeneratedBusinessContent(String(input.userRequest ?? ""), generatedNodes);
    if (irrelevantContent.length > 0) {
      return {
        ok: false,
        message: `生成内容包含用户未要求的业务对象：${irrelevantContent.join("、")}。已拦截落盘，请重新生成并严格按原始需求，不要套订单/商品等默认模板。`,
        file,
        page,
        selectedPageId: page.id,
        data: { irrelevantContent }
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
          artboards: schemaDraft.artboards.map((artboard) => ({ refId: artboard.refId, name: artboard.name, nodeCount: artboard.nodes.length }))
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
    const irrelevantContent = ["订单", "商品列表", "搜索筛选区"].filter((topic) => !userRequest.includes(topic) && generatedText.includes(topic));
    const missing = Object.entries(coverage).filter(([, status]) => status === "missing").map(([topic]) => topic);
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
    const nextNodes = reflowOverlappingNodes(page.nodes, spacing);
    const movedCount = nextNodes.filter((node, index) => node.y !== page.nodes[index]?.y).length;
    const nextPage = { ...page, nodes: nextNodes, nodeCount: nextNodes.length, schemaLoaded: true };
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return {
      ok: true,
      message: movedCount > 0 ? `已完成布局重排，调整 ${movedCount} 个节点。` : "布局重排完成，未发现需要移动的明显重叠节点。",
      file: nextFile,
      page: nextPage,
      selectedPageId: nextPage.id,
      data: { movedCount }
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
    const issues: Array<{ level: "blocking" | "warning"; message: string; suggestedFix?: Record<string, unknown> }> = [];
    const hasSearchIntent = /(列表|表格|table|list).*(搜索|筛选|查询|filter|search|query)|(搜索|筛选|查询|filter|search|query).*(列表|表格|table|list)/i.test(request);
    const filterRegion = structure.mainRegions.find((region) => region.type === "filter_bar");
    const tableRegion = structure.mainRegions.find((region) => region.type === "table");
    if (hasSearchIntent && !filterRegion) {
      issues.push({
        level: "blocking",
        message: "用户要求添加搜索条件，但页面没有识别到搜索/筛选区域。",
        suggestedFix: { tool: "layout.insert_above", input: { insertKind: "filter_bar" } }
      });
    }
    if (filterRegion && tableRegion && filterRegion.bbox.y >= tableRegion.bbox.y) {
      issues.push({
        level: "blocking",
        message: "搜索区没有位于表格上方。",
        suggestedFix: { tool: "layout.insert_above", input: { targetNodeId: tableRegion.nodeId, insertKind: "filter_bar" } }
      });
    }
    const scopedNodes = scopeNodesForReview(page.nodes, generatedFrameIds);
    const overlaps = detectMeaningfulOverlaps(scopedNodes);
    if (overlaps.length > 0) {
      issues.push({
        level: "blocking",
        message: `检测到 ${overlaps.length} 处文字或交互控件可能互相遮挡。容器/卡片/背景与内部内容的正常层叠不会计入。`,
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
  const request = userRequest.toLowerCase();
  const generatedText = nodes.map((node) => `${node.name} ${node.text ?? ""}`).join(" ");
  const rules = [
    { label: "订单", allowed: /订单|交易|支付|退款|发货|电商|商城/.test(userRequest), pattern: /订单|退款|发货|ORD\d*/i },
    { label: "商品", allowed: /商品|产品|SKU|库存|电商|商城/.test(userRequest), pattern: /商品|SKU|库存|上架|下架|低库存/i },
    { label: "客户", allowed: /客户|会员|CRM|用户/.test(userRequest), pattern: /客户管理|客户列表|客户等级|会员等级/i }
  ];
  return rules
    .filter((rule) => !rule.allowed && rule.pattern.test(generatedText) && !request.includes(rule.label.toLowerCase()))
    .map((rule) => rule.label);
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
  return compileStitchUiDraftToSceneGraph(schemaDraft, profile, {
    placement,
    userRequest: schemaDraft.intent
  }).nodes;
}

function createUiNodesFromSchemaDraftIntoFrame(schemaDraft: UiSchemaDraft, targetFrame: WorkspaceDesignNode, capabilityProfile?: DesignCapabilityProfile) {
  const profile = capabilityProfile ?? getDesignCapabilityProfile(schemaDraft.platform === "mobile_app" ? "mobile_app" : "pc_web");
  return compileStitchUiDraftToSceneGraph(schemaDraft, profile, {
    targetFrame,
    userRequest: schemaDraft.intent
  }).nodes;
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
  nextNodes = addMissingVisualAssets(nextNodes, profile, resolvedAssets);
  nextNodes = compileLayoutTreeToSceneGraph(nextNodes, profile);
  return nextNodes;
}

function addMissingVisualAssets(nodes: WorkspaceDesignNode[], profile: DesignCapabilityProfile, resolvedAssets: ResolvedDesignImageAsset[] = []) {
  const nextNodes = [...nodes];
  let assetCursor = 0;
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
    if (!isMobile && !children.some((node) => /主图|demo|插画|图片/i.test(node.name))) {
      const visualAssets = resolvedAssets.filter((asset) => asset.type === "image" || asset.type === "illustration");
      const visualAsset = visualAssets[assetCursor % Math.max(visualAssets.length, 1)];
      if (visualAssets.length > 0) assetCursor += 1;
      nextNodes.push(createDesignNode("image", {
        parentId: frame.id,
        name: visualAsset?.source === "openai-image" ? "生成图片" : visualAsset?.source === "unsplash" || visualAsset?.source === "pexels" ? "真实图片" : "Demo 图片",
        x: frame.x + frame.width - 352,
        y: frame.y + 96,
        width: 288,
        height: 180,
        fill: "#eef4ff",
        stroke: "#c7d7fe",
        radius: 18,
        imageUrl: visualAsset?.imageUrl ?? buildDemoImageDataUrl(frame.name),
        sourceRef: visualAsset?.license
      }));
    }
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

function buildDemoImageDataUrl(label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="576" height="360" viewBox="0 0 576 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#dbeafe"/><stop offset="1" stop-color="#f8fafc"/></linearGradient></defs><rect width="576" height="360" rx="32" fill="url(#g)"/><circle cx="104" cy="96" r="36" fill="#2563eb" opacity=".9"/><rect x="172" y="78" width="268" height="28" rx="14" fill="#0f172a" opacity=".86"/><rect x="84" y="172" width="408" height="24" rx="12" fill="#64748b" opacity=".36"/><rect x="84" y="222" width="288" height="24" rx="12" fill="#64748b" opacity=".26"/><text x="84" y="306" font-size="28" font-weight="700" font-family="Arial, sans-serif" fill="#1e3a8a">${escapeSvgText(label).slice(0, 16)}</text></svg>`;
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
  return ["手机号", "验证码", "微信", "支付宝", "绑定", "个人信息", "实名认证", "地址", "地图"].filter((topic) => userRequest.includes(topic));
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

function reviewArtboardLayout(page: WorkspaceDesignPage, userRequest = "", generatedFrameIds: string[] = [], capabilityProfile?: DesignCapabilityProfile): Array<{ level: "blocking" | "warning"; message: string; suggestedFix?: Record<string, unknown> }> {
  const targetFrameIds = new Set(generatedFrameIds);
  const artboards = getTopLevelArtboards(page)
    .filter((node) => node.id !== "page-preview-frame")
    .filter((node) => targetFrameIds.size === 0 || targetFrameIds.has(node.id));
  const issues: Array<{ level: "blocking" | "warning"; message: string; suggestedFix?: Record<string, unknown> }> = [];
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
        level: "blocking",
        message: `画板「${frame.name}」只有 ${visibleChildren.length} 个可见节点，低于基础质量门槛 ${minimums.minNodesPerArtboard}，页面会显得粗糙。`
      });
    }
    if (textNodes.length < minimums.minTextNodesPerArtboard) {
      issues.push({
        level: "blocking",
        message: `画板「${frame.name}」文本层级不足，只有 ${textNodes.length} 个文本节点，无法形成清晰信息架构。`
      });
    }
    if (visualAssets.length < minimums.minVisualAssetsPerArtboard) {
      issues.push({
        level: "blocking",
        message: `画板「${frame.name}」缺少 icon、demo 图片或插画资产，页面内容过于简陋。`
      });
    }
    if (fills.size < minimums.minDistinctFillsPerArtboard) {
      issues.push({
        level: "blocking",
        message: `画板「${frame.name}」颜色/层级过少，仅 ${fills.size} 种有效填充，缺少可识别页面风格。`
      });
    }
    if (isMobileRequest && frame.width > 480) {
      issues.push({
        level: "blocking",
        message: `画板「${frame.name}」看起来是 PC 尺寸（${frame.width}x${frame.height}），但用户要求移动端/小程序，需要重新按 375x812 单列规范生成。`
      });
    }
    if (isMobileRequest && children.some((node) => node.type === "table")) {
      issues.push({
        level: "blocking",
        message: `画板「${frame.name}」包含 table 节点，但移动端/小程序应使用卡片列表或行容器，避免文字挤压。`
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
        level: "blocking",
        message: `画板「${frame.name}」存在 ${clipped.length} 个元素超出画板边界，可能被剪切显示不全。`,
        suggestedFix: { tool: "layout.reflow", input: { pageId: page.id, spacing: 16 } }
      });
    }
    const meaningfulChildren = children.filter((node) => node.visible !== false && node.type !== "text");
    if (meaningfulChildren.length === 0) {
      issues.push({
        level: "warning",
        message: `画板「${frame.name}」缺少可交互或内容组件，需要补充输入、按钮、卡片、列表或状态区。`
      });
    }
    const primaryActions = children.filter((node) => node.type === "button");
    if (primaryActions.length === 0) {
      issues.push({
        level: "blocking",
        message: `画板「${frame.name}」没有明确主操作按钮，用户可能不知道下一步做什么。`
      });
    }
    const badButtons = primaryActions.filter((node) => !isButtonTextCentered(node));
    if (badButtons.length > 0) {
      issues.push({
        level: "blocking",
        message: `画板「${frame.name}」存在 ${badButtons.length} 个按钮文字没有居中或按钮高度不足。`
      });
    }
    const textOverflows = children.filter((node) => node.type === "text" && mayTextOverflow(node));
    if (textOverflows.length > 0) {
      issues.push({
        level: "blocking",
        message: `画板「${frame.name}」存在 ${textOverflows.length} 个文本节点高度/宽度不足，可能出现遮挡、换行挤压或显示不全。`,
        suggestedFix: { tool: "layout.reflow", input: { pageId: page.id, spacing: 16 } }
      });
    }
  });
  return issues;
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
