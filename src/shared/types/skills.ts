import { z } from "zod";

export const skillStatusValues = ["active", "experimental", "disabled", "deprecated"] as const;

export const skillStageValues = [
  "captured",
  "triaged",
  "clarifying",
  "modeled",
  "prd_ready",
  "wireframe_ready",
  "ui_ready",
  "reviewing",
  "approved",
  "archived",
  "intake",
  "scoring",
  "prd",
  "prd_validation",
  "competitor_analysis",
  "wireframe",
  "wireframe_annotation",
  "ui",
  "task"
] as const;

export const skillSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  name: z.string().min(1).max(120),
  version: z.string(),
  description: z.string().min(1).max(2000),
  status: z.enum(skillStatusValues),
  author: z.string().max(120).optional(),
  tags: z.array(z.string()).default([]),
  triggers: z.array(z.string()).default([]),
  stages: z.array(z.enum(skillStageValues)).min(1),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  files: z.object({
    manifest: z.string().optional(),
    prompt: z.string().optional(),
    template: z.string().optional(),
    notes: z.string().optional()
  }).optional(),
  config: z.record(z.unknown()).default({})
});

export type Skill = z.infer<typeof skillSchema>;
