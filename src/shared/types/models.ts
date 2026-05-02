import { z } from "zod";

export const requirementStatuses = [
  "captured",
  "triaged",
  "clarifying",
  "modeled",
  "prd_ready",
  "wireframe_ready",
  "ui_ready",
  "reviewing",
  "approved",
  "archived"
] as const;

export const priorityLevels = ["P0", "P1", "P2", "P3"] as const;

export const sourceTypes = [
  "boss",
  "customer",
  "sales",
  "operations",
  "product",
  "design",
  "engineering",
  "support",
  "data",
  "market",
  "other"
] as const;

export const sourceChannels = [
  "meeting",
  "chat",
  "email",
  "doc",
  "ticket",
  "call",
  "other"
] as const;

export const personRefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().optional()
});

export const sourceSchema = z.object({
  type: z.enum(sourceTypes),
  name: z.string().min(1),
  channel: z.enum(sourceChannels).optional(),
  externalRef: z.string().optional()
});

export const versionSchema = z.object({
  schemaVersion: z.string(),
  revision: z.number().int().min(1),
  snapshotId: z.string().optional(),
  label: z.string().optional()
});

export const stageEventSchema = z.object({
  from: z.enum(requirementStatuses).nullable(),
  to: z.enum(requirementStatuses),
  reason: z.string().optional(),
  changedAt: z.string(),
  changedBy: personRefSchema.optional(),
  versionRef: z.string().optional()
});

export const requirementSchema = z.object({
  id: z.string().regex(/^req-[0-9]{3,}$/),
  title: z.string().min(1),
  summary: z.string().optional(),
  source: sourceSchema,
  sourceDetail: z.string().optional(),
  rawContent: z.string().min(1),
  context: z.string().optional(),
  problemStatement: z.string().optional(),
  businessBackground: z.string().optional(),
  targetUsers: z.array(z.string()).default([]),
  priorityLevel: z.enum(priorityLevels).nullable().default(null),
  valueScore: z.number().min(0).max(100).nullable().default(null),
  priorityScore: z.number().min(0).max(100).nullable().default(null),
  scoreReasoning: z.string().optional(),
  scoreRef: z.string().optional(),
  status: z.enum(requirementStatuses),
  owner: personRefSchema.optional(),
  reporter: personRefSchema.optional(),
  linkedProjectIds: z.array(z.string()).default([]),
  linkedArtifactIds: z.array(z.string()).default([]),
  relatedRequirementIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  attachments: z.array(z.object({
    name: z.string().min(1),
    path: z.string().min(1),
    mimeType: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional()
  })).default([]),
  decision: z.object({
    outcome: z.enum(["accepted", "deferred", "rejected", "merged", "needs_more_info"]).optional(),
    reason: z.string().optional(),
    decidedAt: z.string().optional(),
    decidedBy: personRefSchema.optional()
  }).optional(),
  stageHistory: z.array(stageEventSchema).default([]),
  customFields: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  version: versionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: personRefSchema.optional(),
  updatedBy: personRefSchema.optional()
});

export const scoreDimensionSchema = z.object({
  direction: z.enum(["positive", "negative"]),
  rawScore: z.number().int().min(1).max(5),
  normalizedScore: z.number().min(0).max(100),
  weight: z.number().positive().max(1),
  rationale: z.string().min(1)
});

export const scoreSchema = z.object({
  id: z.string().regex(/^score-[0-9]{3,}$/),
  requirementId: z.string().regex(/^req-[0-9]{3,}$/),
  modelVersion: z.string(),
  scale: z.object({
    min: z.literal(1),
    max: z.literal(5)
  }),
  dimensions: z.object({
    userValue: scoreDimensionSchema,
    businessValue: scoreDimensionSchema,
    strategicFit: scoreDimensionSchema,
    urgency: scoreDimensionSchema,
    reach: scoreDimensionSchema,
    implementationCost: scoreDimensionSchema,
    deliveryRisk: scoreDimensionSchema
  }),
  computed: z.object({
    positiveScore: z.number().min(0).max(100),
    negativeScore: z.number().min(0).max(100),
    feasibilityScore: z.number().min(0).max(100),
    manualAdjustment: z.number().min(-15).max(15),
    finalPriorityScore: z.number().min(0).max(100)
  }),
  valueScore: z.number().min(0).max(100),
  priorityScore: z.number().min(0).max(100),
  priorityLevel: z.enum(priorityLevels),
  recommendation: z.enum(["do_now", "plan_next", "candidate_pool", "observe_or_archive"]).optional(),
  scoreReasoning: z.string().optional(),
  priorityReasoning: z.string().optional(),
  override: z.object({
    applied: z.boolean().default(false),
    fromLevel: z.enum(priorityLevels).optional(),
    toLevel: z.enum(priorityLevels).optional(),
    reason: z.string().optional(),
    by: personRefSchema.optional(),
    at: z.string().optional()
  }).optional(),
  createdAt: z.string(),
  createdBy: personRefSchema.optional()
});

export type RequirementStatus = (typeof requirementStatuses)[number];
export type PriorityLevel = (typeof priorityLevels)[number];
export type SourceType = (typeof sourceTypes)[number];
export type SourceChannel = (typeof sourceChannels)[number];
export type PersonRef = z.output<typeof personRefSchema>;
export type Requirement = z.output<typeof requirementSchema>;
export type ScoreRecord = z.output<typeof scoreSchema>;
