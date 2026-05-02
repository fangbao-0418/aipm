import type {
  ChatMessage,
  RequirementCollectionArtifactContent,
  UploadedSourceFile
} from "../types";

const TEXT_FILE_PATTERN = /\.(txt|md|markdown|json|csv|tsv|yaml|yml)$/i;

export async function readRequirementSourceFile(file: File): Promise<UploadedSourceFile> {
  const uploadedAt = new Date().toISOString();
  const isTextLike =
    file.type.startsWith("text/") ||
    file.type.includes("json") ||
    file.type.includes("xml") ||
    TEXT_FILE_PATTERN.test(file.name);

  if (isTextLike) {
    const text = (await file.text()).trim();
    return {
      id: createLocalId(file.name),
      name: file.name,
      mimeType: file.type || "text/plain",
      size: file.size,
      uploadedAt,
      extractionStatus: "parsed",
      extractedTextExcerpt: text.slice(0, 1200),
      note: text
        ? "实验版已直接提取可读文本片段，可继续通过聊天整理需求。"
        : "文件已上传，但暂未提取到可读文本。"
    };
  }

  return {
    id: createLocalId(file.name),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    uploadedAt,
    extractionStatus: "metadata-only",
    note:
      "实验版会先记录文件元数据；PDF / DOC / DOCX 的深度解析需要后端模型管线接入。"
  };
}

export function organizeRequirementCollection(params: {
  projectName: string;
  messages: ChatMessage[];
  uploadedFiles: UploadedSourceFile[];
}): RequirementCollectionArtifactContent {
  const rawInputs = params.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean);

  const extractedHighlights = params.uploadedFiles
    .map((file) => file.extractedTextExcerpt?.trim())
    .filter((value): value is string => Boolean(value))
    .flatMap((snippet) => splitFragments(snippet))
    .slice(0, 8);

  const fragments = [...rawInputs.flatMap((item) => splitFragments(item)), ...extractedHighlights].filter(Boolean);

  const userGoals = classifyFragments(fragments, ["目标", "提升", "减少", "希望", "效率", "体验", "增长"]).slice(0, 4);
  const coreScenarios = classifyFragments(fragments, ["场景", "用户", "使用", "流程", "入口", "管理", "查看"]).slice(0, 4);
  const coreFunctions = classifyFragments(fragments, ["功能", "支持", "管理", "上传", "通知", "生成", "编辑", "导出"]).slice(0, 5);
  const constraints = classifyFragments(fragments, ["必须", "需要", "不能", "本地", "导出", "版本", "安全"]).slice(0, 4);

  const fallback = fragments.slice(0, 6);

  const summaryParts = [
    rawInputs.length > 0 ? `已接收 ${rawInputs.length} 条散落需求点` : "当前主要来自上传材料",
    params.uploadedFiles.length > 0 ? `并记录 ${params.uploadedFiles.length} 份上传文档` : "暂未上传文档",
    "实验版已先整理出可继续澄清的需求采集摘要。"
  ];

  const followupQuestions = buildFollowupQuestions({
    hasFiles: params.uploadedFiles.length > 0,
    userGoalsCount: userGoals.length,
    scenarioCount: coreScenarios.length,
    functionCount: coreFunctions.length,
    constraintCount: constraints.length
  });

  return {
    projectName: params.projectName,
    rawInputs,
    uploadedFiles: params.uploadedFiles,
    extractedHighlights,
    aiSummary: summaryParts.join("，"),
    requirementsDocument: buildRequirementsDocument({
      projectName: params.projectName,
      summary: summaryParts.join("，"),
      userGoals: userGoals.length > 0 ? userGoals : fallback.slice(0, 3),
      coreScenarios: coreScenarios.length > 0 ? coreScenarios : fallback.slice(0, 3),
      coreFunctions: coreFunctions.length > 0 ? coreFunctions : fallback.slice(0, 4),
      constraints,
      followupQuestions
    }),
    structuredSnapshot: {
      userGoals: userGoals.length > 0 ? userGoals : fallback.slice(0, 3),
      coreScenarios: coreScenarios.length > 0 ? coreScenarios : fallback.slice(0, 3),
      coreFunctions: coreFunctions.length > 0 ? coreFunctions : fallback.slice(0, 4),
      constraints
    },
    followupQuestions,
    lastOrganizedAt: new Date().toISOString()
  };
}

function createLocalId(seed: string) {
  return `${Date.now()}-${seed.replace(/\W+/g, "-").toLowerCase()}`;
}

function splitFragments(input: string) {
  return input
    .split(/[\n。！？；;•·]/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 6);
}

function classifyFragments(fragments: string[], keywords: string[]) {
  const matches = fragments.filter((fragment) => keywords.some((keyword) => fragment.includes(keyword)));
  return dedupe(matches);
}

function dedupe(items: string[]) {
  return Array.from(new Set(items));
}

function buildFollowupQuestions(params: {
  hasFiles: boolean;
  userGoalsCount: number;
  scenarioCount: number;
  functionCount: number;
  constraintCount: number;
}) {
  const questions: string[] = [];

  if (params.userGoalsCount < 2) {
    questions.push("这次需求最优先要解决的业务目标是什么？");
  }
  if (params.scenarioCount < 2) {
    questions.push("目标用户会在什么具体场景下使用这个产品？");
  }
  if (params.functionCount < 3) {
    questions.push("第一版必须包含的 3 个核心功能分别是什么？");
  }
  if (params.constraintCount < 1) {
    questions.push("有没有必须遵守的约束，比如本地存储、导出、安全或发布时间？");
  }
  if (!params.hasFiles) {
    questions.push("如果你手上有会议纪要、需求文档或竞品材料，可以继续上传帮助我补齐上下文。");
  }

  return questions.slice(0, 4);
}

function buildRequirementsDocument(params: {
  projectName: string;
  summary: string;
  userGoals: string[];
  coreScenarios: string[];
  coreFunctions: string[];
  constraints: string[];
  followupQuestions: string[];
}) {
  const lines = [
    `# ${params.projectName} 需求采集文档`,
    "",
    "## AI 采集摘要",
    params.summary,
    "",
    "## 当前整理的需求点",
    "",
    "### 用户目标",
    ...toBulletLines(params.userGoals),
    "",
    "### 核心场景",
    ...toBulletLines(params.coreScenarios),
    "",
    "### 核心功能",
    ...toBulletLines(params.coreFunctions),
    "",
    "### 约束条件",
    ...(params.constraints.length > 0 ? toBulletLines(params.constraints) : ["- 暂未明确约束条件"]),
    "",
    "## 待补充问题",
    ...toBulletLines(params.followupQuestions)
  ];

  return lines.join("\n");
}

function toBulletLines(items: string[]) {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- 暂无"];
}
