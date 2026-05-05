import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { z } from "zod";
import { WorkspaceProjectRepository } from "../../infrastructure/files/workspace-project-repository.js";
import type {
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

export const designAgentToolNameSchema = z.enum([
  "page.list",
  "page.get_schema",
  "page.create",
  "page.rename",
  "page.delete",
  "page.duplicate",
  "schema.validate",
  "schema.find_nodes",
  "schema.create_menu",
  "schema.add_nodes",
  "schema.update_node",
  "schema.delete_node",
  "schema.duplicate_node",
  "schema.generate_from_prompt",
  "workspace.read_file",
  "canvas.capture",
  "ui.analyze_layout",
  "ui.analyze_spacing",
  "ui.analyze_color",
  "ui.analyze_typography",
  "ui.review",
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
    name: "schema.create_menu",
    description: "确定性创建左侧/右侧菜单组件。用于“添加菜单/导航栏/侧边栏菜单”等任务，不要用 update_node 伪装添加。若已存在菜单，会停止并返回建议。",
    inputSchema: { pageId: "optional string", position: "left | right", items: "optional string[]", title: "optional string" }
  },
  {
    name: "schema.add_nodes",
    description: "向当前页面或指定页面新增一个或多个节点，支持 text、image、card、container、table 等基础类型。group/shapeGroup 先映射为 container/card。",
    inputSchema: { pageId: "optional string", nodes: "DesignNode[]" }
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
    name: "workspace.read_file",
    description: "只读读取当前 project workspace 内的文件，用于参考 PRD、schema、素材说明等，禁止读取 workspace 外路径。",
    inputSchema: { path: "string" }
  },
  {
    name: "canvas.capture",
    description: "画布截图/局部节点截图能力占位。当前返回 schema 摘要，后续接真实截图识别。",
    inputSchema: { pageId: "optional string", nodeId: "optional string" }
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
  constructor(private readonly repository: WorkspaceProjectRepository) {}

  async execute(context: DesignAgentToolExecutionContext, call: DesignAgentToolCall): Promise<DesignAgentToolResult> {
    const normalized = designAgentToolCallSchema.parse(call);
    switch (normalized.tool) {
      case "page.list":
        return this.listPages(context.projectId);
      case "page.get_schema":
        return this.getPageSchema(context.projectId, normalized.input.pageId as string | undefined ?? context.selectedPageId);
      case "page.create":
        return this.createPage(context.projectId, normalized.input);
      case "page.rename":
        return this.renamePage(context.projectId, normalized.input, context.selectedPageId);
      case "page.delete":
        return this.deletePage(context.projectId, normalized.input.pageId as string | undefined ?? context.selectedPageId);
      case "page.duplicate":
        return this.duplicatePage(context.projectId, normalized.input, context.selectedPageId);
      case "schema.validate":
        return this.validateSchema(context.projectId, normalized.input.pageId as string | undefined ?? context.selectedPageId);
      case "schema.find_nodes":
        return this.findNodes(context.projectId, normalized.input, context.selectedPageId);
      case "schema.create_menu":
        return this.createMenu(context.projectId, normalized.input, context.selectedPageId);
      case "schema.add_nodes":
        return this.addNodes(context.projectId, normalized.input, context.selectedPageId);
      case "schema.update_node":
        return this.updateNode(context.projectId, normalized.input, context.selectedPageId);
      case "schema.delete_node":
        return this.deleteNode(context.projectId, normalized.input, context.selectedPageId);
      case "schema.duplicate_node":
        return this.duplicateNode(context.projectId, normalized.input, context.selectedPageId);
      case "schema.generate_from_prompt":
        return this.generateSchemaFromPrompt(context.projectId, normalized.input, context.selectedPageId);
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
    const nextPage = { ...page, nodes: [...page.nodes, ...autoPlaceNodes(page, nodes)], schemaLoaded: true };
    nextPage.nodeCount = nextPage.nodes.length;
    const nextFile = await this.savePages(projectId, file, file.pages.map((item) => item.id === page.id ? nextPage : item));
    return { ok: true, message: `已向页面「${page.name}」新增 ${nodes.length} 个节点。`, file: nextFile, page: nextPage, selectedPageId: nextPage.id };
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
    const node = input.nodeId ? page.nodes.find((item) => item.id === input.nodeId) : undefined;
    return {
      ok: true,
      message: "当前版本返回 schema 摘要，真实截图识别会在后续接入。",
      file,
      page,
      selectedPageId: page.id,
      data: { page: summarizePage(page), node }
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

  private async getFile(projectId: string) {
    return this.repository.getDesignFile(projectId);
  }

  private async getFileAndPage(projectId: string, pageId?: string) {
    const file = await this.getFile(projectId);
    const pageMeta = file.pages.find((page) => page.id === pageId) ?? file.pages[0];
    const page = pageMeta ? await this.repository.getDesignPage(projectId, pageMeta.id).catch(() => pageMeta) : undefined;
    return { file, page };
  }

  private async savePages(projectId: string, file: WorkspaceDesignFile, pages: WorkspaceDesignPage[]) {
    const nextFile = { ...file, pages, updatedAt: nowIso() };
    await this.repository.saveDesignFile(projectId, nextFile);
    return this.repository.getDesignFile(projectId);
  }
}

function parseNodeInputs(value: unknown): WorkspaceDesignNode[] {
  const nodes = Array.isArray(value) ? value : [];
  return nodes.map((item) => createDesignNode(nodeTypeSchema.parse((item as { type?: unknown }).type), designNodeInputSchema.parse(item)));
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
  return columns && columns.length >= 2 ? columns.slice(0, 8) : ["名称", "状态", "负责人", "更新时间", "操作"];
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

function buildUiAnalysis(page: WorkspaceDesignPage, kind: "layout" | "spacing" | "color" | "typography" | "review") {
  const visibleNodes = page.nodes.filter((node) => node.visible !== false);
  const bounds = getPageBounds(page);
  const fills = countBy(visibleNodes.map((node) => node.fill).filter(Boolean));
  const fontSizes = countBy(visibleNodes.map((node) => String(node.fontSize)).filter(Boolean));
  const overlaps = countOverlaps(visibleNodes.slice(0, 160));
  const layoutHints = [
    bounds.width > 0 ? `页面内容范围 ${Math.round(bounds.width)} x ${Math.round(bounds.height)}` : "页面暂无有效内容范围",
    overlaps > 0 ? `检测到约 ${overlaps} 组节点可能重叠，需要人工确认层级或布局` : "未发现明显大面积节点重叠",
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
      if (rectsOverlap(nodes[i], nodes[j])) count += 1;
      if (count > 40) return count;
    }
  }
  return count;
}

function rectsOverlap(a: WorkspaceDesignNode, b: WorkspaceDesignNode) {
  const xOverlap = a.x < b.x + b.width && a.x + a.width > b.x;
  const yOverlap = a.y < b.y + b.height && a.y + a.height > b.y;
  if (!xOverlap || !yOverlap) return false;
  const area = Math.min(a.width * a.height, b.width * b.height);
  return area > 400;
}

function getPageBounds(page: WorkspaceDesignPage) {
  if (page.nodes.length === 0) return { x: 520, y: 220, width: 960, height: 0 };
  const minX = Math.min(...page.nodes.map((node) => node.x));
  const minY = Math.min(...page.nodes.map((node) => node.y));
  const maxX = Math.max(...page.nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...page.nodes.map((node) => node.y + node.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
