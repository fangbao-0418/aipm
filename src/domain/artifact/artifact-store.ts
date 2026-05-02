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
import type { ProductModel } from "../../shared/types/product-model.js";

export interface ArtifactStore {
  saveClarifyQuestionPack(requirementId: string, pack: ClarifyQuestionPack): Promise<void>;
  getClarifyQuestionPack(requirementId: string): Promise<ClarifyQuestionPack>;
  saveProductModel(requirementId: string, model: ProductModel): Promise<void>;
  getProductModel(requirementId: string): Promise<ProductModel>;
  savePrdDocument(requirementId: string, document: PrdDocument): Promise<void>;
  getPrdDocument(requirementId: string): Promise<PrdDocument>;
  savePrdMarkdown(requirementId: string, markdown: string): Promise<void>;
  getPrdMarkdown(requirementId: string): Promise<string>;
  savePrdValidation(requirementId: string, validation: PrdValidation): Promise<void>;
  getPrdValidation(requirementId: string): Promise<PrdValidation>;
  saveCompetitorAnalysis(requirementId: string, analysis: CompetitorAnalysis): Promise<void>;
  getCompetitorAnalysis(requirementId: string): Promise<CompetitorAnalysis>;
  saveWireframeSpec(requirementId: string, spec: WireframeSpec): Promise<void>;
  getWireframeSpec(requirementId: string): Promise<WireframeSpec>;
  saveWireframePage(requirementId: string, pageId: string, html: string): Promise<void>;
  getWireframePage(requirementId: string, pageId: string): Promise<string>;
  saveWireframeAnnotations(requirementId: string, annotations: WireframeAnnotationsDocument): Promise<void>;
  getWireframeAnnotations(requirementId: string): Promise<WireframeAnnotationsDocument>;
  saveUiDesign(requirementId: string, design: UiDesign): Promise<void>;
  getUiDesign(requirementId: string): Promise<UiDesign>;
  saveUiPage(requirementId: string, pageId: string, html: string): Promise<void>;
  getUiPage(requirementId: string, pageId: string): Promise<string>;
  nextReviewId(requirementId: string): Promise<string>;
  saveReviewResult(requirementId: string, review: ReviewResult): Promise<void>;
  getReviewResult(requirementId: string, reviewId: string): Promise<ReviewResult>;
  listReviewResults(requirementId: string): Promise<ReviewResult[]>;
  nextPatchId(requirementId: string): Promise<string>;
  savePatchDocument(requirementId: string, patch: PatchDocument): Promise<void>;
  getPatchDocument(requirementId: string, patchId: string): Promise<PatchDocument>;
  listPatchDocuments(requirementId: string): Promise<PatchDocument[]>;
  saveChatSession(requirementId: string, session: RefineChatSession): Promise<void>;
  getChatSession(requirementId: string): Promise<RefineChatSession>;
}
