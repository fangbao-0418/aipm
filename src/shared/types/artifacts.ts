import { z } from "zod";

export const prdDocumentSchema = z.object({
  meta: z.object({
    requirementId: z.string().regex(/^req-[0-9]{3,}$/),
    generatedAt: z.string(),
    version: z.string(),
    generator: z.enum(["ai", "template", "manual"]).default("template"),
    model: z.string().optional()
  }),
  overview: z.object({
    title: z.string(),
    summary: z.string(),
    background: z.string(),
    businessGoal: z.string(),
    successMetrics: z.array(z.string()).default([])
  }),
  targetUsers: z.array(z.object({
    name: z.string(),
    needs: z.array(z.string()).default([]),
    scenarios: z.array(z.string()).default([])
  })).default([]),
  scope: z.object({
    inScope: z.array(z.string()).default([]),
    outOfScope: z.array(z.string()).default([])
  }),
  functionalRequirements: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    acceptanceCriteria: z.array(z.string()).default([])
  })).default([]),
  userFlows: z.array(z.object({
    id: z.string(),
    name: z.string(),
    steps: z.array(z.string()).default([])
  })).default([]),
  pages: z.array(z.object({
    id: z.string(),
    name: z.string(),
    purpose: z.string(),
    keyModules: z.array(z.string()).default([])
  })).default([]),
  risks: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([])
});

export const prdValidationSchema = z.object({
  requirementId: z.string().regex(/^req-[0-9]{3,}$/),
  generatedAt: z.string(),
  generator: z.enum(["ai", "template", "manual"]).default("template"),
  model: z.string().optional(),
  status: z.enum(["pass", "warning", "fail"]),
  readinessScore: z.number().min(0).max(100),
  summary: z.string(),
  findings: z.array(z.object({
    id: z.string(),
    severity: z.enum(["critical", "major", "minor"]),
    title: z.string(),
    detail: z.string(),
    suggestion: z.string()
  })).default([]),
  recommendedNextActions: z.array(z.string()).default([])
});

export const competitorAnalysisSchema = z.object({
  requirementId: z.string().regex(/^req-[0-9]{3,}$/),
  generatedAt: z.string(),
  generator: z.enum(["ai", "template", "manual"]).default("template"),
  model: z.string().optional(),
  summary: z.string(),
  competitors: z.array(z.object({
    name: z.string(),
    positioning: z.string(),
    strengths: z.array(z.string()).default([]),
    gaps: z.array(z.string()).default([]),
    implications: z.array(z.string()).default([])
  })).default([]),
  opportunities: z.array(z.string()).default([]),
  differentiation: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([])
});

export const wireframeSpecSchema = z.object({
  requirementId: z.string().regex(/^req-[0-9]{3,}$/),
  generatedAt: z.string(),
  generator: z.enum(["ai", "template", "manual"]).default("template"),
  model: z.string().optional(),
  pages: z.array(z.object({
    id: z.string(),
    name: z.string(),
    purpose: z.string(),
    layout: z.string(),
    sections: z.array(z.object({
      id: z.string(),
      title: z.string(),
      objective: z.string(),
      notes: z.array(z.string()).default([]),
      primaryAction: z.string().optional()
    })).default([])
  })).default([]),
  userFlows: z.array(z.object({
    id: z.string(),
    name: z.string(),
    steps: z.array(z.string()).default([])
  })).default([])
});

export const wireframeAnnotationSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  sectionId: z.string().optional(),
  kind: z.enum(["interaction", "business", "data", "review", "delivery"]),
  status: z.enum(["open", "resolved"]).default("open"),
  title: z.string(),
  description: z.string(),
  linkedRequirementIds: z.array(z.string()).default([]),
  linkedTaskIds: z.array(z.string()).default([])
});

export const wireframeAnnotationsDocumentSchema = z.object({
  requirementId: z.string().regex(/^req-[0-9]{3,}$/),
  generatedAt: z.string(),
  generator: z.enum(["ai", "template", "manual"]).default("template"),
  model: z.string().optional(),
  annotations: z.array(wireframeAnnotationSchema).default([])
});

export const uiDesignSchema = z.object({
  requirementId: z.string().regex(/^req-[0-9]{3,}$/),
  generatedAt: z.string(),
  generator: z.enum(["ai", "template", "manual"]).default("template"),
  model: z.string().optional(),
  visualThesis: z.string(),
  interactionThesis: z.array(z.string()).default([]),
  designStyle: z.object({
    themeName: z.string(),
    tone: z.string(),
    colorTokens: z.record(z.string()),
    fontFamily: z.string(),
    accentStyle: z.string()
  }),
  pages: z.array(z.object({
    pageId: z.string(),
    name: z.string(),
    notes: z.array(z.string()).default([]),
    htmlPath: z.string()
  })).default([])
});

export const clarifyFieldKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9_.-]{1,80}$/);

export const clarifyQuestionSchema = z.object({
  id: z.string(),
  fieldKey: clarifyFieldKeySchema,
  title: z.string(),
  prompt: z.string(),
  whyNeeded: z.string().optional(),
  required: z.boolean(),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  answerFormat: z.enum(["short_text", "long_text", "single_select", "multi_select", "number", "boolean", "json"]),
  suggestedOptions: z.array(z.string()).default([]),
  answer: z.union([z.string(), z.number(), z.boolean(), z.array(z.any()), z.record(z.any()), z.null()]).optional(),
  answerSource: z.enum(["user", "ai_inferred", "manual_editor"]).optional(),
  status: z.enum(["unanswered", "answered", "assumed", "not_applicable", "needs_review"]),
  updatedAt: z.string().optional()
});

export const clarifyQuestionPackSchema = z.object({
  id: z.string(),
  requirementId: z.string().regex(/^req-[0-9]{3,}$/),
  domain: z.string(),
  version: z.string(),
  generatedAt: z.string(),
  generator: z.enum(["ai", "template", "manual"]),
  status: z.enum(["draft", "in_progress", "ready_for_review", "approved", "blocked"]),
  summary: z.string().optional(),
  gating: z.object({
    mode: z.enum(["hard_block", "warning_only"]),
    requiredFieldKeys: z.array(clarifyFieldKeySchema),
    missingFieldKeys: z.array(clarifyFieldKeySchema).default([]),
    completionScore: z.number().min(0).max(100),
    isSatisfied: z.boolean(),
    blockingReason: z.string().optional()
  }),
  questions: z.array(clarifyQuestionSchema),
  answeredFieldMap: z.record(z.any()).default({}),
  reviewNotes: z.array(z.object({
    id: z.string(),
    severity: z.enum(["blocker", "warning", "info"]),
    message: z.string(),
    createdAt: z.string()
  })).default([])
});

export const patchOperationSchema = z.object({
  op: z.enum(["add", "replace", "remove", "move", "link_task", "resolve_annotation"]),
  path: z.string(),
  from: z.string().optional(),
  value: z.any().optional(),
  reason: z.string().optional(),
  guard: z.object({
    equals: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    exists: z.boolean().optional()
  }).optional()
});

export const patchDocumentSchema = z.object({
  id: z.string(),
  requirementId: z.string().regex(/^req-[0-9]{3,}$/),
  sourceReviewId: z.string().optional(),
  sourceChatMessageId: z.string().optional(),
  target: z.object({
    artifactType: z.enum(["clarify", "product_model", "prd", "wireframe", "annotation", "ui"]),
    artifactPath: z.string().optional(),
    pageId: z.string().optional()
  }),
  summary: z.string().optional(),
  generator: z.enum(["ai", "rule_engine", "manual"]),
  model: z.string().optional(),
  generatedAt: z.string(),
  operations: z.array(patchOperationSchema).min(1)
});

export const reviewFindingSchema = z.object({
  id: z.string(),
  severity: z.enum(["critical", "major", "minor", "info"]),
  category: z.enum(["coverage", "consistency", "compliance", "safety", "usability", "data", "copy", "other"]).optional(),
  title: z.string(),
  message: z.string(),
  suggestion: z.string().optional(),
  location: z.object({
    artifactType: z.enum(["clarify", "product_model", "prd", "wireframe", "annotation", "ui"]),
    fieldPath: z.string().optional(),
    pageId: z.string().optional(),
    sectionId: z.string().optional()
  })
});

export const reviewResultSchema = z.object({
  id: z.string(),
  requirementId: z.string().regex(/^req-[0-9]{3,}$/),
  stage: z.enum(["clarify", "product_model", "prd", "wireframe", "ui", "safety"]),
  artifactRef: z.string().optional(),
  reviewer: z.object({
    kind: z.enum(["ai", "rule_engine", "human"]),
    name: z.string(),
    model: z.string().optional(),
    version: z.string().optional()
  }),
  status: z.enum(["pass", "warning", "block"]),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1).optional(),
  summary: z.string(),
  canContinue: z.boolean(),
  blockingReason: z.string().optional(),
  findings: z.array(reviewFindingSchema).default([]),
  requiredPatches: z.array(patchDocumentSchema).default([]),
  recommendedActions: z.array(z.object({
    label: z.string(),
    action: z.enum(["request_clarification", "regenerate_model", "regenerate_prd", "apply_patch", "run_safety_review", "go_to_next_stage"]),
    reason: z.string().optional()
  })).default([]),
  generatedAt: z.string()
});

export const refineChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  createdAt: z.string()
});

export const refineTaskSeedSchema = z.object({
  title: z.string(),
  type: z.string(),
  priority: z.string(),
  description: z.string(),
  linkedAnnotationIds: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([])
});

export const refineActionSchema = z.object({
  label: z.string(),
  action: z.enum([
    "generate_product_model",
    "generate_prd",
    "validate_prd",
    "compare_prd",
    "generate_wireframe",
    "annotate_wireframe",
    "generate_ui"
  ]),
  reason: z.string()
});

export const refineResponseSchema = z.object({
  reply: z.string(),
  recommendedActions: z.array(refineActionSchema).default([]),
  suggestedTaskSeeds: z.array(refineTaskSeedSchema).default([]),
  annotationSuggestions: z.array(z.object({
    pageId: z.string(),
    sectionId: z.string().optional(),
    kind: z.enum(["interaction", "business", "data", "review", "delivery"]),
    title: z.string(),
    description: z.string()
  })).default([])
});

export const refineChatSessionSchema = z.object({
  requirementId: z.string().regex(/^req-[0-9]{3,}$/),
  updatedAt: z.string(),
  messages: z.array(refineChatMessageSchema).default([]),
  lastAssistantResponse: refineResponseSchema.optional()
});

export type PrdDocument = z.output<typeof prdDocumentSchema>;
export type PrdValidation = z.output<typeof prdValidationSchema>;
export type CompetitorAnalysis = z.output<typeof competitorAnalysisSchema>;
export type WireframeSpec = z.output<typeof wireframeSpecSchema>;
export type WireframeAnnotation = z.output<typeof wireframeAnnotationSchema>;
export type WireframeAnnotationsDocument = z.output<typeof wireframeAnnotationsDocumentSchema>;
export type UiDesign = z.output<typeof uiDesignSchema>;
export type ClarifyQuestionPack = z.output<typeof clarifyQuestionPackSchema>;
export type ClarifyQuestion = z.output<typeof clarifyQuestionSchema>;
export type PatchDocument = z.output<typeof patchDocumentSchema>;
export type PatchOperation = z.output<typeof patchOperationSchema>;
export type ReviewResult = z.output<typeof reviewResultSchema>;
export type RefineChatMessage = z.output<typeof refineChatMessageSchema>;
export type RefineTaskSeed = z.output<typeof refineTaskSeedSchema>;
export type RefineAction = z.output<typeof refineActionSchema>;
export type RefineResponse = z.output<typeof refineResponseSchema>;
export type RefineChatSession = z.output<typeof refineChatSessionSchema>;
