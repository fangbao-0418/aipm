import { z } from "zod";

export const productModelSchema = z.object({
  meta: z.object({
    requirementId: z.string().regex(/^req-[0-9]{3,}$/),
    generatedAt: z.string(),
    version: z.string(),
    generator: z.enum(["ai", "template"]).default("template"),
    model: z.string().optional()
  }),
  positioning: z.object({
    title: z.string(),
    summary: z.string(),
    targetUsers: z.array(z.string()).default([]),
    problem: z.string(),
    valueProposition: z.string()
  }),
  goals: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  features: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string()
  })).default([]),
  flows: z.array(z.object({
    id: z.string(),
    name: z.string(),
    steps: z.array(z.string()).default([])
  })).default([]),
  pages: z.array(z.object({
    id: z.string(),
    name: z.string(),
    purpose: z.string(),
    modules: z.array(z.string()).default([])
  })).default([]),
  designStyle: z.object({
    tone: z.string(),
    keywords: z.array(z.string()).default([])
  }),
  openQuestions: z.array(z.string()).default([])
});

export type ProductModel = z.output<typeof productModelSchema>;
