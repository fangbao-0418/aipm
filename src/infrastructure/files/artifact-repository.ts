import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { ProjectContext } from "./project-context.js";
import { readJsonFile, writeJsonFile } from "../../shared/utils/json.js";
import type { ProductModel } from "../../shared/types/product-model.js";
import type { ArtifactStore } from "../../domain/artifact/artifact-store.js";
import type {
  ClarifyQuestionPack,
  CompetitorAnalysis,
  PatchDocument,
  PrdDocument,
  PrdValidation,
  RefineChatSession,
  ReviewResult,
  UiDesign,
  WireframeAnnotationsDocument,
  WireframeSpec
} from "../../shared/types/artifacts.js";
import { nowIso } from "../../shared/utils/time.js";
import { IndexDatabase } from "../db/index-database.js";
import { formatSequentialId } from "../../shared/utils/ids.js";

export class ArtifactRepository implements ArtifactStore {
  private readonly index: IndexDatabase;

  constructor(private readonly context: ProjectContext) {
    this.index = new IndexDatabase(context);
  }

  async ensureReady() {
    await Promise.all([this.context.ensureBaseStructure(), this.index.ensureReady()]);
    await Promise.all([
      mkdir(this.context.path("artifacts"), { recursive: true })
    ]);
  }

  artifactDir(requirementId: string) {
    return this.context.path("artifacts", requirementId);
  }

  contextDir(requirementId: string) {
    return this.context.path("artifacts", requirementId, "context");
  }

  prdDir(requirementId: string) {
    return this.context.path("artifacts", requirementId, "prd");
  }

  wireframeDir(requirementId: string) {
    return this.context.path("artifacts", requirementId, "wireframes");
  }

  uiDir(requirementId: string) {
    return this.context.path("artifacts", requirementId, "ui");
  }

  chatDir(requirementId: string) {
    return this.context.path("artifacts", requirementId, "chat");
  }

  reviewDir(requirementId: string) {
    return this.context.path("artifacts", requirementId, "reviews");
  }

  patchDir(requirementId: string) {
    return this.context.path("artifacts", requirementId, "patches");
  }

  clarifyDir(requirementId: string) {
    return this.context.path("artifacts", requirementId, "clarify");
  }

  clarifyQuestionPackPath(requirementId: string) {
    return this.context.path("artifacts", requirementId, "clarify", "question-pack.json");
  }

  productModelPath(requirementId: string) {
    return this.context.path("artifacts", requirementId, "context", "product-model.json");
  }

  prdDocumentPath(requirementId: string) {
    return this.context.path("artifacts", requirementId, "prd", "prd.json");
  }

  prdPath(requirementId: string) {
    return this.context.path("artifacts", requirementId, "prd", "prd.md");
  }

  prdValidationPath(requirementId: string) {
    return this.context.path("artifacts", requirementId, "prd", "prd-validation.json");
  }

  competitorAnalysisPath(requirementId: string) {
    return this.context.path("artifacts", requirementId, "prd", "competitor-analysis.json");
  }

  wireframeSpecPath(requirementId: string) {
    return this.context.path("artifacts", requirementId, "wireframes", "wireframe-spec.json");
  }

  wireframePagePath(requirementId: string, pageId: string) {
    return this.context.path("artifacts", requirementId, "wireframes", "pages", `${pageId}.html`);
  }

  wireframeAnnotationsPath(requirementId: string) {
    return this.context.path("artifacts", requirementId, "wireframes", "wireframe-annotations.json");
  }

  uiDesignPath(requirementId: string) {
    return this.context.path("artifacts", requirementId, "ui", "design-style.json");
  }

  uiPagePath(requirementId: string, pageId: string) {
    return this.context.path("artifacts", requirementId, "ui", "pages", `${pageId}.html`);
  }

  chatSessionPath(requirementId: string) {
    return this.context.path("artifacts", requirementId, "chat", "chat-history.json");
  }

  reviewPath(requirementId: string, reviewId: string) {
    return this.context.path("artifacts", requirementId, "reviews", `${reviewId}.json`);
  }

  patchPath(requirementId: string, patchId: string) {
    return this.context.path("artifacts", requirementId, "patches", `${patchId}.json`);
  }

  async ensureRequirementArtifactStructure(requirementId: string) {
    await this.ensureReady();
    await Promise.all([
      mkdir(this.contextDir(requirementId), { recursive: true }),
      mkdir(this.clarifyDir(requirementId), { recursive: true }),
      mkdir(this.prdDir(requirementId), { recursive: true }),
      mkdir(this.context.path("artifacts", requirementId, "wireframes", "pages"), { recursive: true }),
      mkdir(this.context.path("artifacts", requirementId, "ui", "pages"), { recursive: true }),
      mkdir(this.chatDir(requirementId), { recursive: true }),
      mkdir(this.reviewDir(requirementId), { recursive: true }),
      mkdir(this.patchDir(requirementId), { recursive: true })
    ]);
  }

  async saveClarifyQuestionPack(requirementId: string, pack: ClarifyQuestionPack) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.clarifyQuestionPackPath(requirementId);
    await writeJsonFile(path, pack);
    await this.index.upsertArtifact(requirementId, "clarify-question-pack", path, nowIso());
  }

  async saveProductModel(requirementId: string, model: ProductModel) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.productModelPath(requirementId);
    await writeJsonFile(path, model);
    await this.index.upsertArtifact(requirementId, "product-model", path, nowIso());
  }

  async savePrdDocument(requirementId: string, document: PrdDocument) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.prdDocumentPath(requirementId);
    await writeJsonFile(path, document);
    await this.index.upsertArtifact(requirementId, "prd-document", path, nowIso());
  }

  async savePrdMarkdown(requirementId: string, markdown: string) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.prdPath(requirementId);
    await writeFile(path, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf-8");
    await this.index.upsertArtifact(requirementId, "prd-markdown", path, nowIso());
  }

  async savePrdValidation(requirementId: string, validation: PrdValidation) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.prdValidationPath(requirementId);
    await writeJsonFile(path, validation);
    await this.index.upsertArtifact(requirementId, "prd-validation", path, nowIso());
  }

  async saveCompetitorAnalysis(requirementId: string, analysis: CompetitorAnalysis) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.competitorAnalysisPath(requirementId);
    await writeJsonFile(path, analysis);
    await this.index.upsertArtifact(requirementId, "competitor-analysis", path, nowIso());
  }

  async saveWireframeSpec(requirementId: string, spec: WireframeSpec) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.wireframeSpecPath(requirementId);
    await writeJsonFile(path, spec);
    await this.index.upsertArtifact(requirementId, "wireframe-spec", path, nowIso());
  }

  async saveWireframePage(requirementId: string, pageId: string, html: string) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.wireframePagePath(requirementId, pageId);
    await writeFile(path, html.endsWith("\n") ? html : `${html}\n`, "utf-8");
    await this.index.upsertArtifact(requirementId, `wireframe-page:${pageId}`, path, nowIso());
  }

  async saveWireframeAnnotations(requirementId: string, annotations: WireframeAnnotationsDocument) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.wireframeAnnotationsPath(requirementId);
    await writeJsonFile(path, annotations);
    await this.index.upsertArtifact(requirementId, "wireframe-annotations", path, nowIso());
  }

  async saveUiDesign(requirementId: string, design: UiDesign) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.uiDesignPath(requirementId);
    await writeJsonFile(path, design);
    await this.index.upsertArtifact(requirementId, "ui-design", path, nowIso());
  }

  async saveUiPage(requirementId: string, pageId: string, html: string) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.uiPagePath(requirementId, pageId);
    await writeFile(path, html.endsWith("\n") ? html : `${html}\n`, "utf-8");
    await this.index.upsertArtifact(requirementId, `ui-page:${pageId}`, path, nowIso());
  }

  async getProductModel(requirementId: string) {
    return readJsonFile<ProductModel>(this.productModelPath(requirementId));
  }

  async getClarifyQuestionPack(requirementId: string) {
    return readJsonFile<ClarifyQuestionPack>(this.clarifyQuestionPackPath(requirementId));
  }

  async getPrdDocument(requirementId: string) {
    return readJsonFile<PrdDocument>(this.prdDocumentPath(requirementId));
  }

  async getPrdMarkdown(requirementId: string) {
    return readFile(this.prdPath(requirementId), "utf-8");
  }

  async getPrdValidation(requirementId: string) {
    return readJsonFile<PrdValidation>(this.prdValidationPath(requirementId));
  }

  async getCompetitorAnalysis(requirementId: string) {
    return readJsonFile<CompetitorAnalysis>(this.competitorAnalysisPath(requirementId));
  }

  async getWireframeSpec(requirementId: string) {
    return readJsonFile<WireframeSpec>(this.wireframeSpecPath(requirementId));
  }

  async getWireframePage(requirementId: string, pageId: string) {
    return readFile(this.wireframePagePath(requirementId, pageId), "utf-8");
  }

  async getWireframeAnnotations(requirementId: string) {
    return readJsonFile<WireframeAnnotationsDocument>(this.wireframeAnnotationsPath(requirementId));
  }

  async getUiDesign(requirementId: string) {
    return readJsonFile<UiDesign>(this.uiDesignPath(requirementId));
  }

  async getUiPage(requirementId: string, pageId: string) {
    return readFile(this.uiPagePath(requirementId, pageId), "utf-8");
  }

  async saveChatSession(requirementId: string, session: RefineChatSession) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.chatSessionPath(requirementId);
    await writeJsonFile(path, session);
    await this.index.upsertArtifact(requirementId, "chat-session", path, nowIso());
  }

  async getChatSession(requirementId: string) {
    return readJsonFile<RefineChatSession>(this.chatSessionPath(requirementId));
  }

  async nextReviewId(requirementId: string) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const entries = await readdir(this.reviewDir(requirementId), { withFileTypes: true });
    const sequence = entries
      .filter((entry) => entry.isFile() && /^review-\d+\.json$/.test(entry.name))
      .map((entry) => Number(entry.name.replace(/^review-/, "").replace(/\.json$/, "")))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => right - left)[0] ?? 0;
    return formatSequentialId("review", sequence + 1);
  }

  async saveReviewResult(requirementId: string, review: ReviewResult) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.reviewPath(requirementId, review.id);
    await writeJsonFile(path, review);
    await this.index.upsertArtifact(requirementId, `review:${review.id}`, path, nowIso());
  }

  async getReviewResult(requirementId: string, reviewId: string) {
    return readJsonFile<ReviewResult>(this.reviewPath(requirementId, reviewId));
  }

  async listReviewResults(requirementId: string) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const entries = await readdir(this.reviewDir(requirementId), { withFileTypes: true });
    const reviews = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /^review-\d+\.json$/.test(entry.name))
        .map((entry) => this.getReviewResult(requirementId, entry.name.replace(/\.json$/, "")))
    );
    return reviews.sort((left, right) => left.id.localeCompare(right.id));
  }

  async nextPatchId(requirementId: string) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const entries = await readdir(this.patchDir(requirementId), { withFileTypes: true });
    const sequence = entries
      .filter((entry) => entry.isFile() && /^patch-\d+\.json$/.test(entry.name))
      .map((entry) => Number(entry.name.replace(/^patch-/, "").replace(/\.json$/, "")))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => right - left)[0] ?? 0;
    return formatSequentialId("patch", sequence + 1);
  }

  async savePatchDocument(requirementId: string, patch: PatchDocument) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const path = this.patchPath(requirementId, patch.id);
    await writeJsonFile(path, patch);
    await this.index.upsertArtifact(requirementId, `patch:${patch.id}`, path, nowIso());
  }

  async getPatchDocument(requirementId: string, patchId: string) {
    return readJsonFile<PatchDocument>(this.patchPath(requirementId, patchId));
  }

  async listPatchDocuments(requirementId: string) {
    await this.ensureRequirementArtifactStructure(requirementId);
    const entries = await readdir(this.patchDir(requirementId), { withFileTypes: true });
    const patches = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /^patch-\d+\.json$/.test(entry.name))
        .map((entry) => this.getPatchDocument(requirementId, entry.name.replace(/\.json$/, "")))
    );
    return patches.sort((left, right) => left.id.localeCompare(right.id));
  }
}
