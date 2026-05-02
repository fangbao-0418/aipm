import type { ArtifactStore } from "../../domain/artifact/artifact-store.js";
import type { RequirementStore } from "../../domain/requirement/requirement-store.js";
import {
  prdDocumentSchema,
  uiDesignSchema,
  wireframeAnnotationsDocumentSchema,
  wireframeSpecSchema,
  type PrdDocument,
  type UiDesign,
  type WireframeAnnotationsDocument,
  type WireframeSpec
} from "../../shared/types/artifacts.js";
import { renderPrdMarkdown, renderUiHtml, renderWireframeHtml } from "../../infrastructure/renderer/html-renderer.js";
import { nowIso } from "../../shared/utils/time.js";

export class StageEditorService {
  constructor(
    private readonly requirements: RequirementStore,
    private readonly artifacts: ArtifactStore
  ) {}

  async updatePrd(requirementId: string, input: PrdDocument) {
    const document = prdDocumentSchema.parse({
      ...input,
      meta: {
        ...input.meta,
        requirementId,
        generatedAt: nowIso(),
        generator: "manual"
      }
    });

    await this.artifacts.savePrdDocument(requirementId, document);
    await this.artifacts.savePrdMarkdown(requirementId, renderPrdMarkdown(document));
    await this.requirements.appendChangelog({
      type: "editor.prd_updated",
      requirementId,
      at: nowIso()
    });

    return document;
  }

  async updateWireframe(requirementId: string, input: {
    spec: WireframeSpec;
    annotations?: WireframeAnnotationsDocument;
  }) {
    const spec = wireframeSpecSchema.parse({
      ...input.spec,
      requirementId,
      generatedAt: nowIso(),
      generator: "manual"
    });
    await this.artifacts.saveWireframeSpec(requirementId, spec);
    for (const page of spec.pages) {
      await this.artifacts.saveWireframePage(requirementId, page.id, renderWireframeHtml(spec, page.id));
    }

    let annotations: WireframeAnnotationsDocument | null = null;
    if (input.annotations) {
      annotations = wireframeAnnotationsDocumentSchema.parse({
        ...input.annotations,
        requirementId,
        generatedAt: nowIso(),
        generator: "manual"
      });
      await this.artifacts.saveWireframeAnnotations(requirementId, annotations);
    }

    await this.requirements.appendChangelog({
      type: "editor.wireframe_updated",
      requirementId,
      at: nowIso()
    });

    return { spec, annotations };
  }

  async updateUiDraft(requirementId: string, input: UiDesign) {
    const design = uiDesignSchema.parse({
      ...input,
      requirementId,
      generatedAt: nowIso(),
      generator: "manual"
    });

    const [spec, annotations] = await Promise.all([
      this.artifacts.getWireframeSpec(requirementId),
      this.ensureAnnotations(requirementId)
    ]);

    await this.artifacts.saveUiDesign(requirementId, design);
    for (const page of spec.pages) {
      await this.artifacts.saveUiPage(requirementId, page.id, renderUiHtml(spec, design, annotations, page.id));
    }

    await this.requirements.appendChangelog({
      type: "editor.ui_updated",
      requirementId,
      at: nowIso()
    });

    return design;
  }

  private async ensureAnnotations(requirementId: string) {
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
