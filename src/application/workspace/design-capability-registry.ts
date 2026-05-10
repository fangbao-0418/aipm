import type { WorkspaceDesignNode, WorkspaceDesignNodeType } from "../../shared/types/workspace.js";

export type DesignPlatform = "pc_web" | "wechat_mini_program" | "mobile_app" | "responsive_web";

export interface DesignComponentLibraryCapability {
  id: string;
  name: string;
  platforms: DesignPlatform[];
  components: Array<{
    id: string;
    nodeTypes: WorkspaceDesignNodeType[];
    useWhen: string;
    qualityRules: string[];
  }>;
  tokens: {
    colors: {
      background: string;
      surface: string;
      primary: string;
      text: string;
      mutedText: string;
      border: string;
    };
    radius: {
      card: number;
      control: number;
      button: number;
    };
    spacing: number[];
    typography: {
      title: number;
      body: number;
      caption: number;
    };
  };
  styleRules?: DesignComponentStyleRule[];
}

export interface DesignComponentStyleRule {
  id: string;
  description: string;
  match: {
    nodeTypes?: WorkspaceDesignNodeType[];
    nameIncludes?: string[];
    textIncludes?: string[];
  };
  style: Partial<Pick<
    WorkspaceDesignNode,
    | "fill"
    | "stroke"
    | "strokeWidth"
    | "radius"
    | "textColor"
    | "fontSize"
    | "fontWeight"
    | "lineHeight"
    | "textAlign"
    | "textVerticalAlign"
    | "shadow"
  >>;
}

export interface DesignQualityRubric {
  id: string;
  name: string;
  blockingRules: string[];
  minimums: {
    minNodesPerArtboard: number;
    minTextNodesPerArtboard: number;
    minVisualAssetsPerArtboard: number;
    minButtonsPerInteractiveArtboard: number;
    minDistinctFillsPerArtboard: number;
  };
}

export interface DesignAssetCapability {
  id: string;
  type: "icon" | "demo_image" | "illustration";
  provider: "local-svg" | "generated-placeholder" | "external-provider";
  prompt: string;
}

export interface DesignCapabilityProfile {
  platform: DesignPlatform;
  libraries: DesignComponentLibraryCapability[];
  assetCapabilities: DesignAssetCapability[];
  rubric: DesignQualityRubric;
}

const componentLibraries: DesignComponentLibraryCapability[] = [
  {
    id: "antd",
    name: "Ant Design",
    platforms: ["pc_web", "responsive_web"],
    components: [
      {
        id: "antd-page-shell",
        nodeTypes: ["frame", "container", "text", "button"],
        useWhen: "PC 后台/管理台页面的导航、标题、工具栏和内容区组织。",
        qualityRules: ["必须有页面标题、工具栏、内容容器和明确主操作。"]
      },
      {
        id: "antd-form-controls",
        nodeTypes: ["input", "button", "text", "container"],
        useWhen: "PC 表单、筛选、设置页。",
        qualityRules: ["标签、输入框、说明文字和按钮要垂直或栅格对齐，按钮文字必须居中。"]
      },
      {
        id: "antd-data-display",
        nodeTypes: ["table", "card", "text", "button"],
        useWhen: "PC 表格、状态、统计和业务列表。",
        qualityRules: ["表头、行内容、状态、分页/主操作要分层，不允许字段挤压。"]
      }
    ],
    tokens: {
      colors: {
        background: "#f5f7fb",
        surface: "#ffffff",
        primary: "#1677ff",
        text: "#101828",
        mutedText: "#667085",
        border: "#d9e2ec"
      },
      radius: { card: 8, control: 6, button: 6 },
      spacing: [8, 12, 16, 24, 32],
      typography: { title: 24, body: 14, caption: 12 }
    },
    styleRules: [
      {
        id: "antd-frame",
        description: "Ant Design 后台画布背景。",
        match: { nodeTypes: ["frame"] },
        style: { fill: "#f5f5f5", stroke: "#d9d9d9", radius: 0 }
      },
      {
        id: "antd-topbar",
        description: "Ant Design 顶部导航/工具栏。",
        match: { nodeTypes: ["container"], nameIncludes: ["顶部", "导航", "工具栏"] },
        style: { fill: "#ffffff", stroke: "#f0f0f0", strokeWidth: 1, radius: 0 }
      },
      {
        id: "antd-card",
        description: "Ant Design Card 容器。",
        match: { nodeTypes: ["card"], nameIncludes: ["卡片", "列表", "筛选", "数据", "表单", "详情"] },
        style: { fill: "#ffffff", stroke: "#f0f0f0", strokeWidth: 1, radius: 2 }
      },
      {
        id: "antd-table-header",
        description: "Ant Design Table 表头背景。",
        match: { nodeTypes: ["container"], nameIncludes: ["表头"] },
        style: { fill: "#fafafa", stroke: "#f0f0f0", strokeWidth: 1, radius: 0 }
      },
      {
        id: "antd-table-row",
        description: "Ant Design Table 行分隔。",
        match: { nodeTypes: ["container"], nameIncludes: ["数据行"] },
        style: { fill: "#ffffff", stroke: "#f0f0f0", strokeWidth: 1, radius: 0 }
      },
      {
        id: "antd-primary-button",
        description: "Ant Design Primary Button。",
        match: { nodeTypes: ["button"], nameIncludes: ["主", "新增", "新建", "查询", "保存", "提交"] },
        style: { fill: "#1677ff", stroke: "#1677ff", strokeWidth: 1, textColor: "#ffffff", radius: 6, fontSize: 14, textAlign: "center", textVerticalAlign: "middle" }
      },
      {
        id: "antd-default-button",
        description: "Ant Design Default Button。",
        match: { nodeTypes: ["button"], nameIncludes: ["导出", "重置", "取消", "上一页", "下一页", "批量"] },
        style: { fill: "#ffffff", stroke: "#d9d9d9", strokeWidth: 1, textColor: "rgba(0,0,0,0.88)", radius: 6, fontSize: 14, textAlign: "center", textVerticalAlign: "middle" }
      },
      {
        id: "antd-input",
        description: "Ant Design Input。",
        match: { nodeTypes: ["input"] },
        style: { fill: "#ffffff", stroke: "#d9d9d9", strokeWidth: 1, textColor: "rgba(0,0,0,0.45)", radius: 6, fontSize: 14, textVerticalAlign: "middle" }
      },
      {
        id: "antd-page-title",
        description: "Ant Design 页面标题。",
        match: { nodeTypes: ["text"], nameIncludes: ["页面标题", "页面主标题"] },
        style: { fill: "transparent", stroke: "transparent", strokeWidth: 0, textColor: "rgba(0,0,0,0.88)", fontSize: 20, fontWeight: 600, lineHeight: 28 }
      },
      {
        id: "antd-breadcrumb",
        description: "Ant Design 面包屑。",
        match: { nodeTypes: ["text"], nameIncludes: ["面包屑"] },
        style: { fill: "transparent", stroke: "transparent", strokeWidth: 0, textColor: "rgba(0,0,0,0.45)", fontSize: 14, lineHeight: 22 }
      },
      {
        id: "antd-muted-text",
        description: "Ant Design 弱说明文本。",
        match: { nodeTypes: ["text"], nameIncludes: ["说明", "标签", "统计"] },
        style: { fill: "transparent", stroke: "transparent", strokeWidth: 0, textColor: "rgba(0,0,0,0.45)", fontSize: 14, lineHeight: 22 }
      }
    ]
  },
  {
    id: "tailwind-saas",
    name: "Tailwind SaaS",
    platforms: ["pc_web", "responsive_web", "mobile_app", "wechat_mini_program"],
    components: [
      {
        id: "saas-card-grid",
        nodeTypes: ["card", "container", "text", "button", "image"],
        useWhen: "现代 SaaS、移动卡片、概览和内容模块。",
        qualityRules: ["卡片需要标题、说明、状态/数据、图标或图片，不能只有一行文字。"]
      },
      {
        id: "saas-empty-and-state",
        nodeTypes: ["card", "image", "text", "button"],
        useWhen: "空状态、成功/失败状态、引导页。",
        qualityRules: ["必须有视觉资产、状态标题、解释文字和行动按钮。"]
      }
    ],
    tokens: {
      colors: {
        background: "#f8fafc",
        surface: "#ffffff",
        primary: "#2563eb",
        text: "#0f172a",
        mutedText: "#64748b",
        border: "#e2e8f0"
      },
      radius: { card: 16, control: 12, button: 12 },
      spacing: [8, 12, 16, 20, 24],
      typography: { title: 24, body: 14, caption: 12 }
    }
  },
  {
    id: "wechat-mini-program",
    name: "微信小程序组件范式",
    platforms: ["wechat_mini_program", "mobile_app"],
    components: [
      {
        id: "mini-page-shell",
        nodeTypes: ["frame", "container", "text", "button", "image"],
        useWhen: "小程序/移动端单列页面、登录、表单、列表和详情。",
        qualityRules: ["逻辑宽度 375，单列布局，安全边距 16-24，禁止 PC 宽表格。"]
      },
      {
        id: "mini-list-card",
        nodeTypes: ["card", "text", "button", "image"],
        useWhen: "移动端列表、记录、订单、个人资料项。",
        qualityRules: ["列表项必须拆成独立文本、状态、图标/图片和操作，不允许多字段挤在一个文本里。"]
      }
    ],
    tokens: {
      colors: {
        background: "#f6f7f9",
        surface: "#ffffff",
        primary: "#07c160",
        text: "#111827",
        mutedText: "#6b7280",
        border: "#e5e7eb"
      },
      radius: { card: 16, control: 12, button: 16 },
      spacing: [8, 12, 16, 20, 24],
      typography: { title: 22, body: 14, caption: 12 }
    }
  }
];

export function getDesignCapabilityProfile(platform: DesignPlatform, userRequest = ""): DesignCapabilityProfile {
  const libraries = componentLibraries.filter((library) => library.platforms.includes(platform));
  const assetCapabilities = inferDesignAssetCapabilities(userRequest);
  return {
    platform,
    libraries,
    assetCapabilities,
    rubric: {
      id: "aipm-ui-quality-v1",
      name: "AIPM UI 基础质量门槛",
      blockingRules: [
        "允许容器、卡片、背景图与内部内容形成正常层叠；阻塞项只包括文字/按钮/输入框/表格等功能内容互相遮挡、越界、被剪切。",
        "按钮文字必须视觉居中，按钮高度和文字行高必须匹配。",
        "文本必须有足够宽高，不允许截断、挤压或多字段塞入一个文本节点。",
        "每个画板必须有风格 token、主操作、内容层级、图标或图片资产。",
        "页面不能只由大卡片、大表格或占位块组成，必须是可编辑的颗粒化节点。"
      ],
      minimums: {
        minNodesPerArtboard: platform === "pc_web" ? 18 : 14,
        minTextNodesPerArtboard: platform === "pc_web" ? 8 : 7,
        minVisualAssetsPerArtboard: 1,
        minButtonsPerInteractiveArtboard: 1,
        minDistinctFillsPerArtboard: 3
      }
    }
  };
}

export function getCapabilityPrompt(profile: DesignCapabilityProfile) {
  return JSON.stringify({
    platform: profile.platform,
    componentLibraries: profile.libraries.map((library) => ({
      id: library.id,
      name: library.name,
      tokens: library.tokens,
      components: library.components
    })),
    assetCapabilities: profile.assetCapabilities,
    qualityRubric: profile.rubric
  }, null, 2);
}

export function getPrimaryLibrary(profile: DesignCapabilityProfile) {
  return profile.libraries[0] ?? componentLibraries[0];
}

export function inferDesignAssetCapabilities(userRequest: string): DesignAssetCapability[] {
  const assets: DesignAssetCapability[] = [
    { id: "semantic-icons", type: "icon", provider: "local-svg", prompt: "为导航、状态、操作和卡片提供语义 icon。" }
  ];
  if (/登录|注册|实名|认证|空状态|引导|详情|商品|产品|地图|地址|上传|支付|收益/.test(userRequest)) {
    assets.push({ id: "demo-visual", type: "demo_image", provider: "generated-placeholder", prompt: "根据页面主题生成 demo 图片/插画占位，后续可替换为联网图片或图像生成结果。" });
  }
  if (/图片|生成图片|demo|插画|banner|主图|头像|商品/.test(userRequest)) {
    assets.push({ id: "image-generation-provider", type: "illustration", provider: "external-provider", prompt: "预留图像生成/图片搜索 provider，返回 imageUrl 后注入 image 节点。" });
  }
  return assets;
}

export function applyLibraryTokens(node: WorkspaceDesignNode, profile: DesignCapabilityProfile): WorkspaceDesignNode {
  const library = getPrimaryLibrary(profile);
  const tokens = library.tokens;
  let nextNode: WorkspaceDesignNode = node;
  if (node.type === "frame") {
    nextNode = { ...node, fill: node.fill === "#f7f8fb" || !node.fill ? tokens.colors.background : node.fill };
    return applyLibraryStyleRules(nextNode, library);
  }
  if (node.type === "card" || node.type === "container") {
    nextNode = {
      ...node,
      fill: node.fill === "transparent" ? node.fill : node.fill || tokens.colors.surface,
      stroke: node.stroke || tokens.colors.border,
      radius: node.radius || tokens.radius.card
    };
    return applyLibraryStyleRules(nextNode, library);
  }
  if (node.type === "button") {
    nextNode = {
      ...node,
      fill: node.fill || tokens.colors.primary,
      textColor: node.textColor || "#ffffff",
      radius: node.radius || tokens.radius.button,
      textAlign: "center",
      lineHeight: node.height
    };
    return applyLibraryStyleRules(nextNode, library);
  }
  if (node.type === "input") {
    nextNode = {
      ...node,
      fill: node.fill || tokens.colors.surface,
      stroke: node.stroke || tokens.colors.border,
      radius: node.radius || tokens.radius.control,
      textColor: node.textColor || tokens.colors.mutedText
    };
    return applyLibraryStyleRules(nextNode, library);
  }
  if (node.type === "text") {
    nextNode = {
      ...node,
      textColor: node.textColor || tokens.colors.text,
      lineHeight: node.lineHeight || Math.ceil((node.fontSize || tokens.typography.body) * 1.45)
    };
    return applyLibraryStyleRules(nextNode, library);
  }
  return applyLibraryStyleRules(nextNode, library);
}

function applyLibraryStyleRules(node: WorkspaceDesignNode, library: DesignComponentLibraryCapability): WorkspaceDesignNode {
  const rules = library.styleRules ?? [];
  return rules.reduce((nextNode, rule) => {
    if (!matchesStyleRule(nextNode, rule)) return nextNode;
    return {
      ...nextNode,
      ...rule.style,
      lineHeight: rule.style.lineHeight ?? (rule.style.textVerticalAlign === "middle" ? nextNode.height : nextNode.lineHeight)
    };
  }, node);
}

function matchesStyleRule(node: WorkspaceDesignNode, rule: DesignComponentStyleRule) {
  if (rule.match.nodeTypes && !rule.match.nodeTypes.includes(node.type)) return false;
  const nameText = `${node.name ?? ""}`.toLowerCase();
  const contentText = `${node.text ?? ""}`.toLowerCase();
  if (rule.match.nameIncludes?.length && !rule.match.nameIncludes.some((item) => nameText.includes(item.toLowerCase()))) {
    return false;
  }
  if (rule.match.textIncludes?.length && !rule.match.textIncludes.some((item) => contentText.includes(item.toLowerCase()))) {
    return false;
  }
  return true;
}
