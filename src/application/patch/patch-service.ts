import type { ArtifactStore } from "../../domain/artifact/artifact-store.js";
import type { RequirementStore } from "../../domain/requirement/requirement-store.js";
import {
  clarifyQuestionPackSchema,
  patchDocumentSchema,
  prdDocumentSchema,
  uiDesignSchema,
  wireframeAnnotationsDocumentSchema,
  wireframeSpecSchema,
  type PatchDocument
} from "../../shared/types/artifacts.js";
import { renderPrdMarkdown, renderUiHtml, renderWireframeHtml } from "../../infrastructure/renderer/html-renderer.js";
import { nowIso } from "../../shared/utils/time.js";

export class PatchService {
  constructor(
    private readonly requirements: RequirementStore,
    private readonly artifacts: ArtifactStore
  ) {}

  async preview(
    requirementId: string,
    input: {
      target: { artifactType: PatchDocument["target"]["artifactType"]; pageId?: string };
      source: { kind: "review" | "chat"; reviewId?: string; messageId?: string };
    }
  ) {
    if (input.source.kind !== "review" || !input.source.reviewId) {
      throw new Error("Minimal patch preview currently only supports review-based patches");
    }

    const review = await this.artifacts.getReviewResult(requirementId, input.source.reviewId);
    const patch = review.requiredPatches.find((item) =>
      item.target.artifactType === input.target.artifactType
      && (!input.target.pageId || item.target.pageId === input.target.pageId)
    );

    if (!patch) {
      throw new Error("No previewable patch found for the requested target");
    }

    await this.artifacts.savePatchDocument(requirementId, patch);
    return {
      patch,
      reviewId: review.id
    };
  }

  async get(requirementId: string, patchId: string) {
    return this.artifacts.getPatchDocument(requirementId, patchId);
  }

  async list(requirementId: string) {
    return this.artifacts.listPatchDocuments(requirementId);
  }

  async apply(requirementId: string, patchId: string) {
    const patch = patchDocumentSchema.parse(await this.artifacts.getPatchDocument(requirementId, patchId));
    const patchedAt = nowIso();

    if (patch.target.artifactType === "prd") {
      const current = await this.artifacts.getPrdDocument(requirementId);
      const updated = prdDocumentSchema.parse({
        ...applyOperations(current, patch.operations),
        meta: {
          ...current.meta,
          generatedAt: patchedAt,
          generator: "manual"
        }
      });
      await this.artifacts.savePrdDocument(requirementId, updated);
      await this.artifacts.savePrdMarkdown(requirementId, renderPrdMarkdown(updated));
      await this.requirements.appendChangelog({
        type: "patch.applied",
        requirementId,
        patchId,
        target: "prd",
        at: patchedAt
      });
      return { patch, artifactType: "prd", artifact: updated };
    }

    if (patch.target.artifactType === "wireframe") {
      const current = await this.artifacts.getWireframeSpec(requirementId);
      const updated = wireframeSpecSchema.parse({
        ...applyOperations(current, patch.operations),
        generatedAt: patchedAt,
        generator: "manual"
      });
      await this.artifacts.saveWireframeSpec(requirementId, updated);
      for (const page of updated.pages) {
        await this.artifacts.saveWireframePage(requirementId, page.id, renderWireframeHtml(updated, page.id));
      }
      await this.requirements.appendChangelog({
        type: "patch.applied",
        requirementId,
        patchId,
        target: "wireframe",
        at: patchedAt
      });
      return { patch, artifactType: "wireframe", artifact: updated };
    }

    if (patch.target.artifactType === "annotation") {
      const current = await this.artifacts.getWireframeAnnotations(requirementId);
      const updated = wireframeAnnotationsDocumentSchema.parse({
        ...applyOperations(current, patch.operations),
        generatedAt: patchedAt,
        generator: "manual"
      });
      await this.artifacts.saveWireframeAnnotations(requirementId, updated);
      await this.requirements.appendChangelog({
        type: "patch.applied",
        requirementId,
        patchId,
        target: "annotation",
        at: patchedAt
      });
      return { patch, artifactType: "annotation", artifact: updated };
    }

    if (patch.target.artifactType === "ui") {
      const [current, spec, annotations] = await Promise.all([
        this.artifacts.getUiDesign(requirementId),
        this.artifacts.getWireframeSpec(requirementId),
        this.loadAnnotations(requirementId)
      ]);
      const updated = uiDesignSchema.parse({
        ...applyOperations(current, patch.operations),
        generatedAt: patchedAt,
        generator: "manual"
      });
      await this.artifacts.saveUiDesign(requirementId, updated);
      for (const page of spec.pages) {
        await this.artifacts.saveUiPage(requirementId, page.id, renderUiHtml(spec, updated, annotations, page.id));
      }
      await this.requirements.appendChangelog({
        type: "patch.applied",
        requirementId,
        patchId,
        target: "ui",
        at: patchedAt
      });
      return { patch, artifactType: "ui", artifact: updated };
    }

    if (patch.target.artifactType === "clarify") {
      const current = await this.artifacts.getClarifyQuestionPack(requirementId);
      const updated = clarifyQuestionPackSchema.parse(applyOperations(current, patch.operations));
      await this.artifacts.saveClarifyQuestionPack(requirementId, updated);
      await this.requirements.appendChangelog({
        type: "patch.applied",
        requirementId,
        patchId,
        target: "clarify",
        at: nowIso()
      });
      return { patch, artifactType: "clarify", artifact: updated };
    }

    throw new Error(`Patch apply is not implemented for ${patch.target.artifactType}`);
  }

  private async loadAnnotations(requirementId: string) {
    try {
      return await this.artifacts.getWireframeAnnotations(requirementId);
    } catch {
      return wireframeAnnotationsDocumentSchema.parse({
        requirementId,
        generatedAt: nowIso(),
        generator: "manual",
        annotations: []
      });
    }
  }
}

function applyOperations<T>(source: T, operations: PatchDocument["operations"]): T {
  const root = structuredClone(source) as Record<string, unknown>;

  for (const operation of operations) {
    if (operation.op === "resolve_annotation") {
      const annotationId = lastPointerSegment(operation.path);
      const annotations = getPointerValue(root, "/annotations");
      if (!Array.isArray(annotations)) {
        throw new Error("resolve_annotation requires /annotations array");
      }
      const target = annotations.find((item) => isRecord(item) && item.id === annotationId);
      if (!isRecord(target)) {
        throw new Error(`Annotation not found for resolve_annotation: ${annotationId}`);
      }
      target.status = "resolved";
      continue;
    }

    if (operation.op === "link_task") {
      const annotationId = lastPointerSegment(operation.path);
      const annotations = getPointerValue(root, "/annotations");
      if (!Array.isArray(annotations)) {
        throw new Error("link_task requires /annotations array");
      }
      const target = annotations.find((item) => isRecord(item) && item.id === annotationId);
      if (!isRecord(target)) {
        throw new Error(`Annotation not found for link_task: ${annotationId}`);
      }
      const linkedTaskIds = Array.isArray(target.linkedTaskIds) ? target.linkedTaskIds : [];
      target.linkedTaskIds = Array.from(new Set([...linkedTaskIds, String(operation.value)]));
      continue;
    }

    applyJsonPointerOperation(root, operation);
  }

  return root as T;
}

function applyJsonPointerOperation(
  root: Record<string, unknown>,
  operation: PatchDocument["operations"][number]
) {
  const segments = parsePointer(operation.path);
  if (segments.length === 0) {
    throw new Error("Patch path cannot target the document root");
  }

  const parent = getContainer(root, segments.slice(0, -1));
  const leaf = segments[segments.length - 1];
  if (operation.guard) {
    const current = readContainerValue(parent, leaf);
    if (operation.guard.exists !== undefined && operation.guard.exists !== (current !== undefined)) {
      throw new Error(`Patch guard exists failed at ${operation.path}`);
    }
    if (operation.guard.equals !== undefined && current !== operation.guard.equals) {
      throw new Error(`Patch guard equals failed at ${operation.path}`);
    }
  }

  if (Array.isArray(parent)) {
    applyArrayOperation(parent, leaf, operation);
    return;
  }

  if (operation.op === "remove") {
    delete parent[leaf];
    return;
  }
  if (operation.op === "move") {
    if (!operation.from) {
      throw new Error("move operation requires from");
    }
    const fromSegments = parsePointer(operation.from);
    const fromParent = getContainer(root, fromSegments.slice(0, -1));
    const fromLeaf = fromSegments[fromSegments.length - 1];
    const value = readContainerValue(fromParent, fromLeaf);
    removeContainerValue(fromParent, fromLeaf);
    parent[leaf] = value;
    return;
  }

  parent[leaf] = operation.value;
}

function applyArrayOperation(
  parent: unknown[],
  leaf: string,
  operation: PatchDocument["operations"][number]
) {
  if (operation.op === "add") {
    if (leaf === "-") {
      parent.push(operation.value);
      return;
    }
    parent.splice(Number(leaf), 0, operation.value);
    return;
  }
  if (operation.op === "remove") {
    parent.splice(Number(leaf), 1);
    return;
  }
  if (operation.op === "replace") {
    parent[Number(leaf)] = operation.value;
    return;
  }
  throw new Error(`Unsupported array operation: ${operation.op}`);
}

function getContainer(root: Record<string, unknown>, segments: string[]) {
  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
      continue;
    }
    if (!isRecord(current)) {
      throw new Error(`Invalid patch path segment: ${segment}`);
    }
    if (!(segment in current)) {
      current[segment] = {};
    }
    current = current[segment];
  }

  if (Array.isArray(current) || isRecord(current)) {
    return current;
  }

  throw new Error("Patch path parent is not a container");
}

function getPointerValue(root: Record<string, unknown>, pointer: string) {
  let current: unknown = root;
  for (const segment of parsePointer(pointer)) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
      continue;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function parsePointer(pointer: string) {
  if (!pointer.startsWith("/")) {
    throw new Error(`Only JSON pointer paths are supported: ${pointer}`);
  }
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function readContainerValue(container: Record<string, unknown> | unknown[], leaf: string) {
  return Array.isArray(container) ? container[Number(leaf)] : container[leaf];
}

function removeContainerValue(container: Record<string, unknown> | unknown[], leaf: string) {
  if (Array.isArray(container)) {
    container.splice(Number(leaf), 1);
    return;
  }
  delete container[leaf];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lastPointerSegment(pointer: string) {
  const segments = parsePointer(pointer);
  return segments[segments.length - 1] ?? pointer;
}
