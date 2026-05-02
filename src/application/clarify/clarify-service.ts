import type { ArtifactStore } from "../../domain/artifact/artifact-store.js";
import type { RequirementStore } from "../../domain/requirement/requirement-store.js";
import {
  clarifyQuestionPackSchema,
  reviewResultSchema,
  type ClarifyQuestion,
  type ClarifyQuestionPack,
  type ReviewResult
} from "../../shared/types/artifacts.js";
import { nowIso } from "../../shared/utils/time.js";

type ClarifyDomain = "dating_app" | "generic_product";
type ClarifyMode = "hard_block" | "warning_only";

export interface ClarifyAnswerInput {
  questionId?: string;
  fieldKey?: string;
  answer: unknown;
  answerSource?: "user" | "ai_inferred" | "manual_editor";
}

export class ClarifyGateError extends Error {
  constructor(
    readonly requirementId: string,
    readonly missingFieldKeys: string[],
    readonly stage: "product_model" | "prd"
  ) {
    super(`Clarify gate blocked for ${stage}: ${missingFieldKeys.join(", ")}`);
    this.name = "ClarifyGateError";
  }
}

export class ClarifyService {
  constructor(
    private readonly requirements: RequirementStore,
    private readonly artifacts: ArtifactStore
  ) {}

  async generateQuestionPack(
    requirementId: string,
    options: { domainHint?: string; mode?: ClarifyMode } = {}
  ) {
    const requirement = await this.requirements.getRequirement(requirementId);
    const generatedAt = nowIso();
    const domain = normalizeDomain(options.domainHint) ?? detectDomain(requirement.title, requirement.rawContent);
    const mode = options.mode ?? "hard_block";

    let existing: ClarifyQuestionPack | null = null;
    try {
      existing = await this.artifacts.getClarifyQuestionPack(requirementId);
    } catch {}

    const nextPack = buildQuestionPack(requirementId, requirement.title, requirement.rawContent, {
      domain,
      mode,
      generatedAt,
      existing,
      seedTargetUsers: requirement.targetUsers
    });

    await this.artifacts.saveClarifyQuestionPack(requirementId, nextPack);
    await this.requirements.appendChangelog({
      type: "clarify.question_pack_generated",
      requirementId,
      domain,
      at: generatedAt
    });

    return nextPack;
  }

  async getQuestionPack(requirementId: string) {
    return this.artifacts.getClarifyQuestionPack(requirementId);
  }

  async ensureQuestionPack(requirementId: string) {
    try {
      return await this.artifacts.getClarifyQuestionPack(requirementId);
    } catch {
      return this.generateQuestionPack(requirementId);
    }
  }

  async upsertAnswers(requirementId: string, answers: ClarifyAnswerInput[]) {
    if (answers.length === 0) {
      throw new Error("At least one clarify answer is required");
    }

    const pack = await this.ensureQuestionPack(requirementId);
    const now = nowIso();
    const nextQuestions = pack.questions.map((question) => {
      const input = answers.find((item) =>
        (item.questionId && item.questionId === question.id)
        || (item.fieldKey && item.fieldKey === question.fieldKey)
      );
      if (!input) {
        return question;
      }

      const normalizedAnswer = normalizeStoredAnswer(input.answer);
      const hasAnswer = isMeaningfulAnswer(normalizedAnswer);
      return {
        ...question,
        answer: normalizedAnswer,
        answerSource: input.answerSource ?? "user",
        status: hasAnswer ? "answered" as const : "unanswered" as const,
        updatedAt: now
      };
    });

    const nextPack = recomputePack({
      ...pack,
      questions: nextQuestions
    });

    await this.artifacts.saveClarifyQuestionPack(requirementId, nextPack);
    await this.syncRequirementFields(requirementId, nextPack);
    await this.requirements.appendChangelog({
      type: "clarify.answers_upserted",
      requirementId,
      fieldKeys: answers.map((item) => item.fieldKey ?? item.questionId).filter(Boolean),
      at: now
    });

    return nextPack;
  }

  async review(requirementId: string) {
    const pack = await this.ensureQuestionPack(requirementId);
    const reviewId = await this.artifacts.nextReviewId(requirementId);
    const generatedAt = nowIso();
    const findings = [];

    for (const fieldKey of pack.gating.missingFieldKeys) {
      const question = pack.questions.find((item) => item.fieldKey === fieldKey);
      findings.push({
        id: `finding-${String(findings.length + 1).padStart(3, "0")}`,
        severity: "critical" as const,
        category: "coverage" as const,
        title: `缺少关键澄清字段：${fieldKey}`,
        message: question
          ? `当前还没有补齐“${question.title}”，系统不应继续进入建模或 PRD 生成。`
          : `当前还没有补齐字段 ${fieldKey}。`,
        suggestion: question?.prompt ?? "请补充该字段后再继续。",
        location: {
          artifactType: "clarify" as const,
          fieldPath: `/answeredFieldMap/${fieldKey}`
        }
      });
    }

    for (const question of pack.questions.filter((item) => item.required && item.status === "needs_review")) {
      findings.push({
        id: `finding-${String(findings.length + 1).padStart(3, "0")}`,
        severity: "major" as const,
        category: "consistency" as const,
        title: `关键回答仍待复核：${question.title}`,
        message: "该回答当前被标记为 needs_review，说明还不能作为稳定输入进入后续阶段。",
        suggestion: "请确认回答是否准确，必要时补充更具体的业务规则。",
        location: {
          artifactType: "clarify" as const,
          fieldPath: `/questions/${question.id}`
        }
      });
    }

    const status = pack.gating.isSatisfied
      ? findings.length > 0 ? "warning" as const : "pass" as const
      : "block" as const;

    const review = reviewResultSchema.parse({
      id: reviewId,
      requirementId,
      stage: "clarify",
      artifactRef: "clarify/question-pack.json",
      reviewer: {
        kind: "rule_engine",
        name: "clarify-gate-reviewer",
        version: "1.0.0"
      },
      status,
      score: pack.gating.isSatisfied ? Math.max(72, 100 - findings.length * 8) : Math.max(35, 70 - findings.length * 10),
      confidence: 0.88,
      summary: pack.gating.isSatisfied
        ? "关键澄清字段已基本补齐，可以进入下一阶段审查。"
        : `仍缺少 ${pack.gating.missingFieldKeys.length} 个关键澄清字段，当前必须阻断建模与 PRD。`,
      canContinue: pack.gating.isSatisfied && findings.length === 0,
      blockingReason: pack.gating.isSatisfied ? undefined : pack.gating.blockingReason,
      findings,
      requiredPatches: [],
      recommendedActions: pack.gating.isSatisfied
        ? [{ label: "进入 product model", action: "go_to_next_stage", reason: "关键字段已补齐。" }]
        : [{ label: "继续澄清", action: "request_clarification", reason: "仍有硬门禁字段缺失。" }],
      generatedAt
    });

    const reviewedPack = clarifyQuestionPackSchema.parse({
      ...pack,
      status: review.canContinue ? "approved" : "blocked",
      reviewNotes: [
        ...pack.reviewNotes,
        {
          id: review.id,
          severity: review.status === "block" ? "blocker" : review.status === "warning" ? "warning" : "info",
          message: review.summary,
          createdAt: generatedAt
        }
      ]
    });

    await this.artifacts.saveClarifyQuestionPack(requirementId, reviewedPack);
    await this.artifacts.saveReviewResult(requirementId, review);
    await this.requirements.appendChangelog({
      type: "clarify.review_completed",
      requirementId,
      reviewId,
      status: review.status,
      at: generatedAt
    });

    return review;
  }

  async assertGateSatisfied(requirementId: string, stage: "product_model" | "prd") {
    const pack = await this.ensureQuestionPack(requirementId);
    if (!pack.gating.isSatisfied) {
      throw new ClarifyGateError(requirementId, pack.gating.missingFieldKeys, stage);
    }
    return pack;
  }

  private async syncRequirementFields(requirementId: string, pack: ClarifyQuestionPack) {
    const requirement = await this.requirements.getRequirement(requirementId);
    const targetUsersAnswer = pack.answeredFieldMap.targetUsers;
    const targetUsers = Array.isArray(targetUsersAnswer)
      ? targetUsersAnswer.map(String).filter(Boolean)
      : typeof targetUsersAnswer === "string" && targetUsersAnswer.trim()
        ? [targetUsersAnswer.trim()]
        : requirement.targetUsers;

    if (JSON.stringify(targetUsers) === JSON.stringify(requirement.targetUsers)) {
      return;
    }

    await this.requirements.saveRequirement({
      ...requirement,
      targetUsers,
      updatedAt: nowIso()
    });
  }
}

function normalizeDomain(domainHint?: string): ClarifyDomain | null {
  if (!domainHint) {
    return null;
  }
  if (domainHint === "dating_app" || domainHint === "generic_product") {
    return domainHint;
  }
  return null;
}

function detectDomain(title: string, rawContent: string): ClarifyDomain {
  const source = `${title}\n${rawContent}`.toLowerCase();
  if (/(交友|dating|婚恋|相亲|陌生人社交|match)/.test(source)) {
    return "dating_app";
  }
  return "generic_product";
}

function buildQuestionPack(
  requirementId: string,
  title: string,
  rawContent: string,
  input: {
    domain: ClarifyDomain;
    mode: ClarifyMode;
    generatedAt: string;
    existing: ClarifyQuestionPack | null;
    seedTargetUsers: string[];
  }
) {
  const questions = questionTemplates(input.domain).map((template, index) => {
    const previous = input.existing?.questions.find((item) => item.fieldKey === template.fieldKey);
    const seededAnswer = !previous?.answer && template.fieldKey === "targetUsers" && input.seedTargetUsers.length > 0
      ? input.seedTargetUsers
      : previous?.answer;
    return {
      id: previous?.id ?? `cq-${String(index + 1).padStart(3, "0")}`,
      fieldKey: template.fieldKey,
      title: template.title,
      prompt: template.prompt.replaceAll("{{title}}", title).replaceAll("{{rawContent}}", rawContent),
      whyNeeded: template.whyNeeded,
      required: template.required,
      priority: template.priority,
      answerFormat: template.answerFormat,
      suggestedOptions: template.suggestedOptions,
      answer: seededAnswer,
      answerSource: previous?.answerSource ?? (seededAnswer ? "manual_editor" : undefined),
      status: seededAnswer ? "answered" as const : "unanswered" as const,
      updatedAt: previous?.updatedAt
    };
  });

  return recomputePack({
    id: input.existing?.id ?? "clarify-pack-001",
    requirementId,
    domain: input.domain,
    version: "1.0.0",
    generatedAt: input.generatedAt,
    generator: input.existing?.generator ?? "template",
    status: input.existing?.status ?? "draft",
    summary: input.domain === "dating_app"
      ? "交友类产品在进入 PRD 前必须先补齐目标用户、匹配机制、变现与安全规则。"
      : "一句话需求需要先补齐用户、场景和首发范围，再进入建模。",
    gating: {
      mode: input.mode,
      requiredFieldKeys: input.domain === "dating_app"
        ? ["targetUsers", "coreScenario", "matchingMode", "monetization", "safetyRules"]
        : ["targetUsers", "coreScenario", "launchScope"],
      missingFieldKeys: [],
      completionScore: 0,
      isSatisfied: false
    },
    questions,
    answeredFieldMap: input.existing?.answeredFieldMap ?? {},
    reviewNotes: input.existing?.reviewNotes ?? []
  });
}

function recomputePack(pack: ClarifyQuestionPack) {
  const answeredFieldMap = Object.fromEntries(
    pack.questions
      .filter((question) => isMeaningfulAnswer(question.answer))
      .map((question) => [question.fieldKey, question.answer])
  );

  const missingFieldKeys = pack.gating.requiredFieldKeys.filter((fieldKey) => !isMeaningfulAnswer(answeredFieldMap[fieldKey]));
  const answeredCount = pack.questions.filter((question) => isMeaningfulAnswer(question.answer)).length;
  const completionScore = pack.questions.length === 0
    ? 0
    : Math.round((answeredCount / pack.questions.length) * 100);
  const isSatisfied = missingFieldKeys.length === 0;

  return clarifyQuestionPackSchema.parse({
    ...pack,
    status: isSatisfied
      ? pack.reviewNotes.some((note) => note.id.startsWith("review-")) ? "ready_for_review" : "ready_for_review"
      : answeredCount > 0 ? "in_progress" : "draft",
    gating: {
      ...pack.gating,
      missingFieldKeys,
      completionScore,
      isSatisfied,
      blockingReason: missingFieldKeys.length > 0
        ? `缺少关键澄清字段：${missingFieldKeys.join("、")}`
        : undefined
    },
    answeredFieldMap
  });
}

function isMeaningfulAnswer(value: unknown) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return true;
}

function normalizeStoredAnswer(value: unknown) {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || Array.isArray(value)
  ) {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return String(value ?? "");
}

function questionTemplates(domain: ClarifyDomain): Array<Omit<ClarifyQuestion, "id" | "answer" | "answerSource" | "status" | "updatedAt">> {
  if (domain === "dating_app") {
    return [
      {
        fieldKey: "targetUsers",
        title: "目标用户",
        prompt: "请明确 {{title}} 的核心目标用户，至少说明年龄段、城市层级和交友目的。",
        whyNeeded: "决定功能优先级、审核力度和视觉表达。",
        required: true,
        priority: "critical",
        answerFormat: "multi_select",
        suggestedOptions: ["18-24 岁一二线城市单身用户", "25-35 岁严肃婚恋用户", "兴趣搭子用户"]
      },
      {
        fieldKey: "coreScenario",
        title: "核心场景",
        prompt: "请说明 {{title}} 首发版本要解决的核心场景，是泛社交、恋爱交友、婚恋，还是兴趣搭子。",
        whyNeeded: "决定产品主流程和首页结构。",
        required: true,
        priority: "critical",
        answerFormat: "single_select",
        suggestedOptions: ["恋爱交友", "严肃婚恋", "泛陌生人社交", "兴趣搭子"]
      },
      {
        fieldKey: "matchingMode",
        title: "匹配机制",
        prompt: "请明确 {{title}} 的匹配机制，是滑卡双向喜欢、问卷匹配、标签推荐，还是 LBS 附近的人。",
        whyNeeded: "这是交友产品的核心引擎，直接影响首页和推荐流。",
        required: true,
        priority: "critical",
        answerFormat: "single_select",
        suggestedOptions: ["双向喜欢", "标签推荐", "问卷匹配", "LBS 附近的人"]
      },
      {
        fieldKey: "monetization",
        title: "变现方式",
        prompt: "请说明 {{title}} 计划如何变现，例如订阅、超级喜欢、曝光加速、礼物或广告。",
        whyNeeded: "决定会员体系、付费点和后续 PRD 范围。",
        required: true,
        priority: "critical",
        answerFormat: "multi_select",
        suggestedOptions: ["订阅会员", "超级喜欢", "曝光加速", "礼物", "广告"]
      },
      {
        fieldKey: "safetyRules",
        title: "安全规则",
        prompt: "请明确 {{title}} 的安全规则，包括实名/真人认证、未成年人限制、举报封禁和内容审核要求。",
        whyNeeded: "交友产品没有安全规则就不应进入正式设计评审。",
        required: true,
        priority: "critical",
        answerFormat: "long_text",
        suggestedOptions: []
      },
      {
        fieldKey: "regionAndCompliance",
        title: "区域与合规",
        prompt: "请说明 {{title}} 首发区域，以及是否存在实名、年龄、隐私、内容审核等合规要求。",
        whyNeeded: "影响审核流程、隐私设计和上线策略。",
        required: false,
        priority: "high",
        answerFormat: "long_text",
        suggestedOptions: []
      },
      {
        fieldKey: "launchScope",
        title: "首发范围",
        prompt: "请定义 {{title}} 第一版一定做什么、不做什么，避免范围继续发散。",
        whyNeeded: "决定 PRD 的 in-scope / out-of-scope。",
        required: true,
        priority: "high",
        answerFormat: "long_text",
        suggestedOptions: []
      }
    ];
  }

  return [
    {
      fieldKey: "targetUsers",
      title: "目标用户",
      prompt: "请明确 {{title}} 的目标用户是谁，他们最核心的需求是什么。",
      whyNeeded: "后续 PRD 和 UI 都需要围绕目标用户组织。",
      required: true,
      priority: "critical",
      answerFormat: "multi_select",
      suggestedOptions: []
    },
    {
      fieldKey: "coreScenario",
      title: "核心场景",
      prompt: "请说明 {{title}} 第一版最核心的使用场景和主流程。",
      whyNeeded: "决定产品主链路。",
      required: true,
      priority: "critical",
      answerFormat: "long_text",
      suggestedOptions: []
    },
    {
      fieldKey: "launchScope",
      title: "首发范围",
      prompt: "请明确 {{title}} 首发版本做什么、不做什么。",
      whyNeeded: "防止 PRD 无限制膨胀。",
      required: true,
      priority: "high",
      answerFormat: "long_text",
      suggestedOptions: []
    },
    {
      fieldKey: "businessGoal",
      title: "业务目标",
      prompt: "请说明 {{title}} 想达成的业务目标，例如增长、转化、留存或效率。",
      whyNeeded: "帮助 PRD 写 success metrics。",
      required: false,
      priority: "medium",
      answerFormat: "long_text",
      suggestedOptions: []
    }
  ];
}
