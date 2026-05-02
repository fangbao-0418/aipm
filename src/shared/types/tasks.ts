import { z } from "zod";
import { personRefSchema, priorityLevels, versionSchema } from "./models.js";

export const taskStatuses = [
  "todo",
  "in_progress",
  "blocked",
  "review",
  "done",
  "closed"
] as const;

export const taskTypes = [
  "product",
  "design",
  "frontend",
  "backend",
  "fullstack",
  "qa",
  "ops",
  "data",
  "research",
  "release",
  "other"
] as const;

export const taskStatusEventSchema = z.object({
  from: z.enum(taskStatuses).nullable(),
  to: z.enum(taskStatuses),
  reason: z.string().optional(),
  changedAt: z.string(),
  changedBy: personRefSchema.optional()
});

export const taskSchema = z.object({
  id: z.string().regex(/^task-[0-9]{3,}$/),
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(taskTypes),
  status: z.enum(taskStatuses),
  priority: z.enum(priorityLevels),
  owner: personRefSchema.optional(),
  assignees: z.array(personRefSchema).default([]),
  sourceRequirementIds: z.array(z.string().regex(/^req-[0-9]{3,}$/)).min(1),
  sourceVersionId: z.string().optional(),
  linkedAnnotationIds: z.array(z.string()).default([]),
  linkedArtifacts: z.object({
    prdPath: z.string().optional(),
    wireframePaths: z.array(z.string()).default([]),
    uiPaths: z.array(z.string()).default([])
  }).optional(),
  acceptanceCriteria: z.array(z.string()).default([]),
  dependencies: z.array(z.string().regex(/^task-[0-9]{3,}$/)).default([]),
  estimate: z.object({
    storyPoints: z.number().nonnegative().optional(),
    hours: z.number().nonnegative().optional()
  }).optional(),
  labels: z.array(z.string()).default([]),
  dates: z.object({
    dueDate: z.string().optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional()
  }).optional(),
  blockers: z.array(z.string()).default([]),
  statusHistory: z.array(taskStatusEventSchema).default([]),
  version: versionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: personRefSchema.optional(),
  updatedBy: personRefSchema.optional()
});

export type TaskStatus = (typeof taskStatuses)[number];
export type TaskType = (typeof taskTypes)[number];
export type Task = z.output<typeof taskSchema>;
