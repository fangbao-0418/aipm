import type { WorkspaceRequirementCollection } from "../../shared/types/workspace.js";

export type ChatInputKind =
  | "question"
  | "requirement_description"
  | "modification_instruction"
  | "document_generation_instruction";

export interface ChatDecision {
  decisionSource: "llm" | "fallback";
  mode: "capture" | "suggestion" | "clarify" | "answer";
  shouldCapture: boolean;
  reply: string;
  guidance: string[];
}

export function classifyChatInput(message: string): ChatInputKind {
  const normalized = message.trim();
  if (!normalized) {
    return "question";
  }

  const looksLikeQuestion = /[？?]|\b怎么\b|\b如何\b|\b是否\b|\b为什么\b|\b能不能\b|\b多少\b|\b什么\b|\b区别\b|\b是什么\b/.test(normalized);
  if (looksLikeQuestion) {
    return "question";
  }

  const looksLikeModification = /(改成|修改|补充(到|进)?|加入(到|进)?|加到|删除|替换|改写这段|重写这段|优化这段|润色这段|调整这段|合并进当前文档|并入当前文档|补进当前文档|写进当前文档|同步到当前文档|并入需求点文档|合并进需求点文档|补进需求点文档|写进需求点文档|并入原型|补进原型|写进原型)/.test(normalized);
  if (looksLikeModification) {
    return "modification_instruction";
  }

  const looksLikeDocAction = /(整理一下|整理成|整理为|生成(一份)?|输出成|输出为|产出|导出|开始生成|进入下一阶段|继续到|推进到|生成需求结构化|生成需求澄清|生成产品模型|生成PRD|生成原型|开始做PRD|开始做原型|整理需求文档|整理需求点文档|整理原型|整理PRD)/i.test(normalized);
  if (looksLikeDocAction) {
    return "document_generation_instruction";
  }

  return "requirement_description";
}

export function buildFallbackChatDecision(message: string, collection: WorkspaceRequirementCollection): ChatDecision {
  const kind = classifyChatInput(message);

  if (kind === "question") {
    return {
      decisionSource: "fallback",
      mode: "answer",
      shouldCapture: false,
      reply: `我先直接回答这个问题：${message.trim().replace(/[？?]/g, "")}。如果你愿意，我也可以基于当前阶段内容继续帮你往下分析或整理。`,
      guidance: []
    };
  }

  if (kind === "modification_instruction") {
    return {
      decisionSource: "fallback",
      mode: "capture",
      shouldCapture: true,
      reply: "我会按你的修改要求更新当前阶段文档，更新后你可以直接继续查看和调整。",
      guidance: []
    };
  }

  if (kind === "document_generation_instruction") {
    return {
      decisionSource: "fallback",
      mode: "capture",
      shouldCapture: true,
      reply: "我会根据你当前提供的内容生成或更新对应阶段文档，完成后你可以直接打开查看。",
      guidance: []
    };
  }

  return {
    decisionSource: "fallback",
    mode: "capture",
    shouldCapture: true,
    reply: "我会把这段需求并入当前阶段文档，完成整理后停在当前阶段，交给你继续 review。",
    guidance: []
  };
}
