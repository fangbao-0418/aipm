import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createAppRuntime } from "../application/runtime.js";
import type { PriorityLevel, RequirementStatus, SourceChannel, SourceType } from "../shared/types/models.js";
import type { TaskStatus, TaskType } from "../shared/types/tasks.js";
import { ClarifyGateError } from "../application/clarify/clarify-service.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

interface WorkspaceServerOptions {
  host?: string;
  port?: number;
  open?: boolean;
}

export async function startWorkspaceServer(options: WorkspaceServerOptions = {}) {
  const app = Fastify({ logger: true });
  const activeBundleStreams = new Map<string, AbortController>();
  const runtime = createAppRuntime();
  const {
    context,
    requirementRepository,
    artifactRepository,
    requirementService,
    scoringService,
    skillService,
    taskService,
    clarifyService,
    reviewService,
    patchService,
    pipelineService,
    generationService,
    refinementService,
    stageEditorService,
    workspaceProjectService
  } = runtime;

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ClarifyGateError) {
      reply.code(409).send({
        error: error.name,
        message: "Clarify gate not satisfied",
        requirementId: error.requirementId,
        stage: error.stage,
        missingFieldKeys: error.missingFieldKeys
      });
      return;
    }

    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const statusCode = typeof (normalizedError as Error & { statusCode?: number }).statusCode === "number"
      ? (normalizedError as Error & { statusCode: number }).statusCode
      : 500;
    reply.code(statusCode).send({
      error: normalizedError.name,
      message: normalizedError.message
    });
  });

  const clientRoots = [
    resolve(context.rootDir, "dist", "workspace-client"),
    resolve(context.rootDir, "dist", "studio-client")
  ];
  const clientRoot = await getFirstAccessibleClientRoot(clientRoots);
  const hasBuiltClient = Boolean(clientRoot);

  if (hasBuiltClient) {
    await app.register(fastifyStatic, {
      root: clientRoot!,
      prefix: "/"
    });
  }

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 10
    }
  });

  app.get("/health", async () => {
    return { ok: true, service: "aipm-workspace" };
  });

  app.get("/api/requirements", async (request) => {
    const query = request.query as {
      status?: RequirementStatus;
      priority?: PriorityLevel;
      source?: SourceType;
      project?: string;
    };

    return requirementService.list({
      status: query.status,
      priority: query.priority,
      sourceType: query.source,
      projectId: query.project
    });
  });

  app.get("/api/requirements/:id", async (request) => {
    const params = request.params as { id: string };
    const requirement = await requirementService.get(params.id);

    let score = null;
    try {
      score = await requirementRepository.getScore(params.id);
    } catch {
      score = null;
    }

    return { requirement, score };
  });

  app.post("/api/requirements", async (request, reply) => {
    const body = request.body as {
      title: string;
      sourceType: SourceType;
      sourceName: string;
      sourceChannel?: SourceChannel;
      sourceDetail?: string;
      content: string;
      priorityLevel?: PriorityLevel;
      ownerName?: string;
      projectId?: string;
      tags?: string[];
    };

    const requirement = await requirementService.add(body);
    reply.code(201);
    return requirement;
  });

  app.post("/api/requirements/:id/stage", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as { to: RequirementStatus; reason?: string };
    return requirementService.stage(params.id, body);
  });

  app.post("/api/requirements/:id/score", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as {
      userValue: number;
      businessValue: number;
      strategicFit: number;
      urgency: number;
      reach: number;
      implementationCost: number;
      deliveryRisk: number;
      reason?: string;
      overrideLevel?: PriorityLevel;
      overrideReason?: string;
    };

    return scoringService.scoreRequirement({
      requirementId: params.id,
      scores: {
        userValue: body.userValue,
        businessValue: body.businessValue,
        strategicFit: body.strategicFit,
        urgency: body.urgency,
        reach: body.reach,
        implementationCost: body.implementationCost,
        deliveryRisk: body.deliveryRisk
      },
      reason: body.reason,
      overrideLevel: body.overrideLevel,
      overrideReason: body.overrideReason
    });
  });

  app.get("/api/tasks", async () => {
    return taskService.list();
  });

  app.get("/api/tasks/:id", async (request) => {
    const params = request.params as { id: string };
    return taskService.get(params.id);
  });

  app.post("/api/tasks", async (request, reply) => {
    const body = request.body as {
      title: string;
      description?: string;
      type: TaskType;
      priority: PriorityLevel;
      sourceRequirementIds: string[];
      sourceVersionId?: string;
      linkedAnnotationIds?: string[];
      ownerName?: string;
      assigneeNames?: string[];
      dependencies?: string[];
      acceptanceCriteria?: string[];
      dueDate?: string;
      labels?: string[];
    };

    const task = await taskService.create(body);
    reply.code(201);
    return task;
  });

  app.post("/api/tasks/:id/update", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as {
      status?: TaskStatus;
      priority?: PriorityLevel;
      ownerName?: string;
      addLinkedAnnotationId?: string[];
      removeLinkedAnnotationId?: string[];
      addDependency?: string[];
      removeDependency?: string[];
      appendComment?: string;
      dueDate?: string;
    };
    return taskService.update(params.id, body);
  });

  app.get("/api/skills", async (request) => {
    const query = request.query as { stage?: string };
    return skillService.list(query.stage);
  });

  app.get("/api/skills/:id", async (request) => {
    const params = request.params as { id: string };
    return skillService.get(params.id);
  });

  app.post("/api/workspace/projects", async (request, reply) => {
    const body = request.body as {
      id: string;
      name: string;
      description: string;
      industry?: string;
      systemPrompt?: string;
      llmSettings?: {
        provider: "openai" | "openai-compatible";
        baseUrl?: string;
        modelProfile: "quality" | "balanced" | "cost-saving";
        stageModelRouting?: Partial<Record<"capture" | "structure", string>>;
      };
      apiKey?: string;
    };

    const bundle = await workspaceProjectService.createProject(body);
    reply.code(201);
    return bundle;
  });

  app.get("/api/workspace/projects/:id/bundle", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { stream?: string };
    const acceptHeader = request.headers.accept ?? "";
    const wantsSse = query.stream === "1" || acceptHeader.includes("text/event-stream");

    if (!wantsSse) {
      return workspaceProjectService.getBundle(params.id);
    }

    const streamId = `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const controller = new AbortController();
    activeBundleStreams.set(streamId, controller);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const sendEvent = (event: string, data: unknown) => {
      if (reply.raw.writableEnded || reply.raw.destroyed) {
        return;
      }
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const cleanup = () => {
      activeBundleStreams.delete(streamId);
    };

    reply.raw.on("close", () => {
      if (!controller.signal.aborted) {
        controller.abort(new Error("Client closed bundle stream"));
      }
      cleanup();
    });

    sendEvent("stream_started", { streamId, projectId: params.id });

    try {
      const bundle = await workspaceProjectService.getBundle(params.id, {
        signal: controller.signal,
        onStatus: async (status) => {
          sendEvent("status", { streamId, status });
        },
        onLlmDelta: async ({ source, delta }) => {
          sendEvent("llm_delta", { streamId, source, delta });
        }
      });

      if (!controller.signal.aborted) {
        sendEvent("bundle", { streamId, bundle });
        sendEvent("done", { streamId });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        sendEvent("cancelled", {
          streamId,
          message: error instanceof Error ? error.message : "Bundle stream cancelled"
        });
      } else {
        sendEvent("bundle_error", {
          streamId,
          message: error instanceof Error ? error.message : "Bundle stream failed"
        });
      }
    } finally {
      cleanup();
      reply.raw.end();
    }

    return reply;
  });

  app.post("/api/workspace/projects/:id/bundle/streams/:streamId/cancel", async (request) => {
    const params = request.params as { id: string; streamId: string };
    const controller = activeBundleStreams.get(params.streamId);

    if (!controller) {
      return { ok: true, streamId: params.streamId, cancelled: false };
    }

    controller.abort(new Error("User cancelled bundle stream"));
    activeBundleStreams.delete(params.streamId);
    return { ok: true, streamId: params.streamId, cancelled: true };
  });

  app.delete("/api/workspace/projects/:id", async (request, reply) => {
    const params = request.params as { id: string };
    await workspaceProjectService.deleteProject(params.id);
    reply.code(204);
  });

  app.post("/api/workspace/projects/:id/intake/message", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as { message: string };
    return workspaceProjectService.appendRequirementInput(params.id, body.message);
  });

  app.post("/api/workspace/projects/:id/chat", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as {
      message: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    };
    return workspaceProjectService.chat(params.id, body);
  });

  app.post("/api/workspace/projects/:id/chat/stream", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as {
      message: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    };
    const controller = new AbortController();

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const sendEvent = (event: string, data: unknown) => {
      if (reply.raw.writableEnded || reply.raw.destroyed) {
        return;
      }
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    reply.raw.on("close", () => {
      if (!controller.signal.aborted) {
        controller.abort(new Error("Client closed chat stream"));
      }
    });

    sendEvent("status", { status: "已收到输入，准备开始分析" });

    try {
      const result = await workspaceProjectService.chat(params.id, body, {
        signal: controller.signal,
        onStatus: async (status) => {
          sendEvent("status", { status });
        },
        onLlmDelta: async ({ source, delta }) => {
          sendEvent("llm_delta", { source, delta });
        },
        onAssistantReady: async (assistant) => {
          sendEvent("assistant", { assistant });
        }
      });

      sendEvent("bundle", { bundle: result.bundle });
      sendEvent("done", { ok: true });
    } catch (error) {
      if (controller.signal.aborted) {
        sendEvent("cancelled", {
          message: error instanceof Error ? error.message : "Chat stream cancelled"
        });
      } else {
        sendEvent("chat_error", {
          message: error instanceof Error ? error.message : "Chat stream failed"
        });
      }
    } finally {
      reply.raw.end();
    }

    return reply;
  });

  app.post("/api/workspace/projects/:id/intake/files", async (request) => {
    const params = request.params as { id: string };
    const files = request.files();
    const buffers: Array<{ filename: string; mimeType: string; bytes: Buffer }> = [];

    for await (const file of files) {
      const bytes = await file.toBuffer();
      buffers.push({
        filename: file.filename,
        mimeType: file.mimetype,
        bytes
      });
    }

    return workspaceProjectService.uploadRequirementFiles(params.id, buffers);
  });

  app.get("/api/workspace/projects/:id/intake/files/:fileId", async (request, reply) => {
    const params = request.params as { id: string; fileId: string };
    const result = await workspaceProjectService.getSourceFile(params.id, params.fileId);
    reply.header("Content-Type", result.file.mimeType || "application/octet-stream");
    reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(result.file.name)}"`);
    return reply.send(result.bytes);
  });

  app.put("/api/workspace/projects/:id/intake/document", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as { document: string };
    return workspaceProjectService.updateRequirementDocument(params.id, body.document);
  });

  app.post("/api/workspace/projects/:id/intake/records", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as { content: string; parentId?: string };
    return workspaceProjectService.createRequirementSourceRecord(params.id, body);
  });

  app.put("/api/workspace/projects/:id/intake/records/:recordId", async (request) => {
    const params = request.params as { id: string; recordId: string };
    const body = request.body as { content: string };
    return workspaceProjectService.updateRequirementSourceRecord(params.id, params.recordId, body.content);
  });

  app.delete("/api/workspace/projects/:id/intake/records/:recordId", async (request) => {
    const params = request.params as { id: string; recordId: string };
    return workspaceProjectService.deleteRequirementSourceRecord(params.id, params.recordId);
  });

  app.get("/api/workspace/projects/:id/intake/history", async (request) => {
    const params = request.params as { id: string };
    return workspaceProjectService.listRequirementDocumentVersions(params.id);
  });

  app.post("/api/workspace/projects/:id/intake/history/:versionId/rollback", async (request) => {
    const params = request.params as { id: string; versionId: string };
    return workspaceProjectService.rollbackRequirementDocumentVersion(params.id, params.versionId);
  });

  app.post("/api/workspace/projects/:id/intake/document/organize", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as { instruction?: string };
    return workspaceProjectService.organizeRequirementDocument(params.id, body?.instruction);
  });

  app.post("/api/workspace/projects/:id/stages/:stage/rollback", async (request) => {
    const params = request.params as { id: string; stage: "requirement-collection" | "requirement-structure" | "requirement-clarification" | "product-model" | "prd" | "prototype" | "prototype-annotation" | "ui-draft" | "review" };
    return workspaceProjectService.rollbackStage(params.id, params.stage);
  });

  app.post("/api/workspace/projects/:id/requirement-structure/generate", async (request) => {
    const params = request.params as { id: string };
    return workspaceProjectService.generateRequirementStructure(params.id);
  });

  app.post("/api/workspace/projects/:id/stages/:stage/generate", async (request) => {
    const params = request.params as {
      id: string;
      stage: "requirement-clarification" | "product-model" | "prd" | "prototype";
    };
    return workspaceProjectService.generateStageDocument(params.id, params.stage);
  });

  app.post("/api/workspace/projects/:id/advance", async (request) => {
    const params = request.params as { id: string };
    return workspaceProjectService.confirmAdvanceToNextStage(params.id);
  });

  app.put("/api/workspace/projects/:id/requirement-structure/document", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as { document: string };
    return workspaceProjectService.updateRequirementStructureDocument(params.id, body.document);
  });

  app.get("/api/workspace/projects/:id/requirement-structure/history", async (request) => {
    const params = request.params as { id: string };
    return workspaceProjectService.listRequirementStructureVersions(params.id);
  });

  app.post("/api/workspace/projects/:id/requirement-structure/history/:versionId/rollback", async (request) => {
    const params = request.params as { id: string; versionId: string };
    return workspaceProjectService.rollbackRequirementStructureVersion(params.id, params.versionId);
  });

  app.put("/api/workspace/projects/:id/stages/:stage/document", async (request) => {
    const params = request.params as {
      id: string;
      stage: "requirement-clarification" | "product-model" | "prd" | "prototype";
    };
    const body = request.body as { document: string };
    return workspaceProjectService.updateStageDocument(params.id, params.stage, body.document);
  });

  app.get("/api/workspace/projects/:id/stages/:stage/history", async (request) => {
    const params = request.params as {
      id: string;
      stage: "requirement-clarification" | "product-model" | "prd" | "prototype";
    };
    return workspaceProjectService.listStageDocumentVersions(params.id, params.stage);
  });

  app.post("/api/workspace/projects/:id/stages/:stage/history/:versionId/rollback", async (request) => {
    const params = request.params as {
      id: string;
      stage: "requirement-clarification" | "product-model" | "prd" | "prototype";
      versionId: string;
    };
    return workspaceProjectService.rollbackStageDocumentVersion(params.id, params.stage, params.versionId);
  });

  app.put("/api/workspace/projects/:id/settings/llm", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as {
      provider: "openai" | "openai-compatible";
      baseUrl?: string;
      modelProfile: "quality" | "balanced" | "cost-saving";
      stageModelRouting?: Partial<Record<"capture" | "structure", string>>;
      apiKey?: string;
    };
    return workspaceProjectService.saveLlmSettings(params.id, body);
  });

  app.post("/api/requirements/:id/clarify/question-pack", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as { domainHint?: string; mode?: "hard_block" | "warning_only" };
    return clarifyService.generateQuestionPack(params.id, body ?? {});
  });

  app.get("/api/requirements/:id/clarify/question-pack", async (request) => {
    const params = request.params as { id: string };
    return clarifyService.getQuestionPack(params.id);
  });

  app.post("/api/requirements/:id/clarify/answers", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as {
      answers: Array<{
        questionId?: string;
        fieldKey?: string;
        answer: unknown;
        answerSource?: "user" | "ai_inferred" | "manual_editor";
      }>;
    };
    return clarifyService.upsertAnswers(params.id, body.answers ?? []);
  });

  app.post("/api/requirements/:id/clarify/review", async (request) => {
    const params = request.params as { id: string };
    return clarifyService.review(params.id);
  });

  app.post("/api/generation/product-model", async (request) => {
    const body = request.body as { requirementId: string };
    return generationService.generateProductModel(body.requirementId);
  });

  app.post("/api/generation/prd", async (request) => {
    const body = request.body as { requirementId: string };
    return generationService.generatePrd(body.requirementId);
  });

  app.post("/api/prd/validate", async (request) => {
    const body = request.body as { requirementId: string };
    return generationService.validatePrd(body.requirementId);
  });

  app.post("/api/prd/compare", async (request) => {
    const body = request.body as { requirementId: string; competitors: string[] };
    return generationService.comparePrd(body.requirementId, body.competitors);
  });

  app.post("/api/wireframe/generate", async (request) => {
    const body = request.body as { requirementId: string };
    return generationService.generateWireframe(body.requirementId);
  });

  app.post("/api/wireframe/annotate", async (request) => {
    const body = request.body as { requirementId: string };
    return generationService.annotateWireframe(body.requirementId);
  });

  app.post("/api/ui/generate", async (request) => {
    const body = request.body as { requirementId: string };
    return generationService.generateUi(body.requirementId);
  });

  app.post("/api/requirements/:id/reviews", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as { stage: "clarify" | "product_model" | "prd" | "wireframe" | "ui" | "safety" };
    return reviewService.run(params.id, body.stage);
  });

  app.get("/api/requirements/:id/reviews/:reviewId", async (request) => {
    const params = request.params as { id: string; reviewId: string };
    return reviewService.get(params.id, params.reviewId);
  });

  app.post("/api/requirements/:id/patches/preview", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as {
      target: { artifactType: "clarify" | "product_model" | "prd" | "wireframe" | "annotation" | "ui"; pageId?: string };
      source: { kind: "review" | "chat"; reviewId?: string; messageId?: string };
    };
    return patchService.preview(params.id, body);
  });

  app.get("/api/requirements/:id/patches/:patchId", async (request) => {
    const params = request.params as { id: string; patchId: string };
    return patchService.get(params.id, params.patchId);
  });

  app.post("/api/requirements/:id/patches/:patchId/apply", async (request) => {
    const params = request.params as { id: string; patchId: string };
    return patchService.apply(params.id, params.patchId);
  });

  app.post("/api/requirements/:id/pipeline/run", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as {
      fromStage: "clarify" | "product_model" | "prd" | "wireframe" | "ui";
      toStage: "clarify" | "product_model" | "prd" | "wireframe" | "ui";
      mode?: "stop_on_block" | "continue_on_warning";
      autoApplyPatches?: boolean;
    };
    return pipelineService.run(params.id, body);
  });

  app.get("/api/project/:requirementId/chat", async (request) => {
    const params = request.params as { requirementId: string };
    return refinementService.getChatSession(params.requirementId);
  });

  app.post("/api/project/:requirementId/chat", async (request) => {
    const params = request.params as { requirementId: string };
    const body = request.body as {
      message: string;
      currentStage?: "analysis" | "prd" | "wireframe" | "ui";
      currentPageId?: string;
    };
    return refinementService.chat(params.requirementId, body.message, {
      currentStage: body.currentStage,
      currentPageId: body.currentPageId
    });
  });

  app.post("/api/project/:requirementId/annotations/:annotationId/tasks", async (request, reply) => {
    const params = request.params as { requirementId: string; annotationId: string };
    const body = request.body as { title?: string; type?: TaskType; priority?: PriorityLevel };
    const result = await refinementService.createTaskFromAnnotation(params.requirementId, params.annotationId, body);
    reply.code(201);
    return result;
  });

  app.post("/api/project/:requirementId/annotations/:annotationId/link-task", async (request) => {
    const params = request.params as { requirementId: string; annotationId: string };
    const body = request.body as { taskId: string };
    return refinementService.linkExistingTaskToAnnotation(params.requirementId, params.annotationId, body.taskId);
  });

  app.get("/api/project/:requirementId/bundle", async (request) => {
    const params = request.params as { requirementId: string };
    const requirement = await requirementService.get(params.requirementId);
    const tasks = (await taskService.list()).filter((item) => item.sourceRequirementIds.includes(params.requirementId));

    let score = null;
    let productModel = null;
    let prd = null;
    let validation = null;
    let competitorAnalysis = null;
    let clarify = null;
    let wireframe = null;
    let annotations = null;
    let ui = null;
    let chat = null;
    let reviews: Awaited<ReturnType<typeof reviewService.list>> = [];
    let patches: Awaited<ReturnType<typeof patchService.list>> = [];

    try {
      score = await requirementRepository.getScore(params.requirementId);
    } catch {}
    try {
      clarify = await artifactRepository.getClarifyQuestionPack(params.requirementId);
    } catch {}
    try {
      productModel = await artifactRepository.getProductModel(params.requirementId);
    } catch {}
    try {
      prd = await artifactRepository.getPrdDocument(params.requirementId);
    } catch {}
    try {
      validation = await artifactRepository.getPrdValidation(params.requirementId);
    } catch {}
    try {
      competitorAnalysis = await artifactRepository.getCompetitorAnalysis(params.requirementId);
    } catch {}
    try {
      wireframe = await artifactRepository.getWireframeSpec(params.requirementId);
    } catch {}
    try {
      annotations = await artifactRepository.getWireframeAnnotations(params.requirementId);
    } catch {}
    try {
      ui = await artifactRepository.getUiDesign(params.requirementId);
    } catch {}
    try {
      chat = await refinementService.getChatSession(params.requirementId);
    } catch {}
    try {
      reviews = await reviewService.list(params.requirementId);
    } catch {}
    try {
      patches = await patchService.list(params.requirementId);
    } catch {}

    return {
      requirement,
      score,
      tasks,
      artifacts: {
        clarify,
        productModel,
        prd,
        validation,
        competitorAnalysis,
        wireframe,
        annotations,
        ui,
        chat,
        reviews,
        patches
      }
    };
  });

  app.get("/api/project/:requirementId/clarify", async (request) => {
    const params = request.params as { requirementId: string };
    return clarifyService.getQuestionPack(params.requirementId);
  });

  app.get("/api/project/:requirementId/product-model", async (request) => {
    const params = request.params as { requirementId: string };
    return artifactRepository.getProductModel(params.requirementId);
  });

  app.get("/api/project/:requirementId/prd", async (request) => {
    const params = request.params as { requirementId: string };
    const [document, markdown] = await Promise.all([
      artifactRepository.getPrdDocument(params.requirementId),
      artifactRepository.getPrdMarkdown(params.requirementId)
    ]);
    return { document, markdown };
  });

  app.put("/api/project/:requirementId/prd", async (request) => {
    const params = request.params as { requirementId: string };
    return stageEditorService.updatePrd(params.requirementId, request.body as Parameters<typeof stageEditorService.updatePrd>[1]);
  });

  app.get("/api/project/:requirementId/prd-validation", async (request) => {
    const params = request.params as { requirementId: string };
    return artifactRepository.getPrdValidation(params.requirementId);
  });

  app.get("/api/project/:requirementId/competitor-analysis", async (request) => {
    const params = request.params as { requirementId: string };
    return artifactRepository.getCompetitorAnalysis(params.requirementId);
  });

  app.get("/api/project/:requirementId/wireframe", async (request) => {
    const params = request.params as { requirementId: string };
    return artifactRepository.getWireframeSpec(params.requirementId);
  });

  app.put("/api/project/:requirementId/wireframe", async (request) => {
    const params = request.params as { requirementId: string };
    const body = request.body as { spec: Parameters<typeof stageEditorService.updateWireframe>[1]["spec"]; annotations?: Parameters<typeof stageEditorService.updateWireframe>[1]["annotations"] };
    return stageEditorService.updateWireframe(params.requirementId, body);
  });

  app.get("/api/project/:requirementId/wireframe/annotations", async (request) => {
    const params = request.params as { requirementId: string };
    return artifactRepository.getWireframeAnnotations(params.requirementId);
  });

  app.get("/api/project/:requirementId/wireframe/pages/:pageId", async (request) => {
    const params = request.params as { requirementId: string; pageId: string };
    return { html: await artifactRepository.getWireframePage(params.requirementId, params.pageId) };
  });

  app.get("/api/project/:requirementId/ui", async (request) => {
    const params = request.params as { requirementId: string };
    return artifactRepository.getUiDesign(params.requirementId);
  });

  app.put("/api/project/:requirementId/ui", async (request) => {
    const params = request.params as { requirementId: string };
    return stageEditorService.updateUiDraft(params.requirementId, request.body as Parameters<typeof stageEditorService.updateUiDraft>[1]);
  });

  app.get("/api/project/:requirementId/ui/pages/:pageId", async (request) => {
    const params = request.params as { requirementId: string; pageId: string };
    return { html: await artifactRepository.getUiPage(params.requirementId, params.pageId) };
  });

  if (hasBuiltClient) {
    app.get("/", async (_request, reply) => {
      return reply.sendFile("index.html");
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/")) {
        reply.code(404).send({ error: "Not found" });
        return;
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.get("/", async (_request, reply) => {
      reply.type("text/html").send(`<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8" /><title>AI PM Workspace</title></head>
  <body style="font-family: system-ui; padding: 32px;">
    <h1>Workspace client has not been built yet.</h1>
    <p>Run <code>npm run build</code> first, then refresh this page.</p>
  </body>
</html>`);
    });
  }

  const port = options.port ?? Number(process.env.PORT || 4310);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";

  await app.listen({ port, host });

  if (options.open !== false) {
    openWorkspaceUrl(`http://${host}:${port}`);
  }
}

export const startStudioServer = startWorkspaceServer;

async function canAccess(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function getFirstAccessibleClientRoot(candidates: string[]) {
  for (const candidate of candidates) {
    if (await canAccess(resolve(candidate, "index.html"))) {
      return candidate;
    }
  }

  return null;
}

function openWorkspaceUrl(url: string) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";

  const args =
    process.platform === "win32"
      ? ["/c", "start", "", url]
      : [url];

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch {
    // Ignore browser launch failures and keep the server running.
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) {
  startWorkspaceServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[workspace] ${message}`);
    process.exitCode = 1;
  });
}
