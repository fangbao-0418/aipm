import { FormEvent, startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";

type StageTab = "analysis" | "prd" | "wireframe" | "ui";
type WorkspacePanel = "capture" | "structure" | "clarify" | "model" | "prd" | "wireframe" | "annotation" | "ui" | "review";

type Requirement = {
  id: string;
  title: string;
  rawContent: string;
  status: string;
  priorityLevel: string | null;
  priorityScore: number | null;
  source: {
    type: string;
    name: string;
  };
  updatedAt: string;
};

type Task = {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  sourceRequirementIds: string[];
  linkedAnnotationIds: string[];
};

type Skill = {
  id: string;
  name: string;
  description: string;
  stages: string[];
  status: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

type ChatSession = {
  messages: ChatMessage[];
  lastAssistantResponse?: {
    reply: string;
    recommendedActions: Array<{
      label: string;
      action:
        | "generate_product_model"
        | "generate_prd"
        | "validate_prd"
        | "compare_prd"
        | "generate_wireframe"
        | "annotate_wireframe"
        | "generate_ui";
      reason: string;
    }>;
    suggestedTaskSeeds: Array<{
      title: string;
      type: string;
      priority: string;
      description: string;
      linkedAnnotationIds: string[];
      acceptanceCriteria: string[];
    }>;
    annotationSuggestions: Array<{
      pageId: string;
      sectionId?: string;
      kind: string;
      title: string;
      description: string;
    }>;
  };
};

type ClarifyQuestion = {
  id: string;
  fieldKey: string;
  title: string;
  prompt: string;
  whyNeeded?: string;
  required: boolean;
  priority: string;
  answerFormat: "short_text" | "long_text" | "single_select" | "multi_select" | "number" | "boolean" | "json";
  suggestedOptions: string[];
  answer?: unknown;
  status: "unanswered" | "answered" | "assumed" | "not_applicable" | "needs_review";
};

type ClarifyPack = {
  id: string;
  requirementId: string;
  domain: string;
  status: string;
  summary?: string;
  gating: {
    mode: string;
    requiredFieldKeys: string[];
    missingFieldKeys: string[];
    completionScore: number;
    isSatisfied: boolean;
    blockingReason?: string;
  };
  answeredFieldMap: Record<string, unknown>;
  questions: ClarifyQuestion[];
};

type ReviewFinding = {
  id: string;
  severity: "critical" | "major" | "minor" | "info";
  title: string;
  message: string;
  suggestion?: string;
  location: {
    artifactType: string;
    fieldPath?: string;
    pageId?: string;
  };
};

type PatchOperation = {
  op: "add" | "replace" | "remove" | "move" | "link_task" | "resolve_annotation";
  path: string;
  from?: string;
  value?: unknown;
  reason?: string;
};

type PatchDocument = {
  id: string;
  requirementId: string;
  sourceReviewId?: string;
  sourceChatMessageId?: string;
  target: {
    artifactType: "clarify" | "product_model" | "prd" | "wireframe" | "annotation" | "ui";
    pageId?: string;
  };
  summary?: string;
  generator: string;
  generatedAt: string;
  operations: PatchOperation[];
};

type ReviewResult = {
  id: string;
  requirementId: string;
  stage: "clarify" | "product_model" | "prd" | "wireframe" | "ui" | "safety";
  status: "pass" | "warning" | "block";
  score: number;
  summary: string;
  blockingReason?: string;
  findings: ReviewFinding[];
  requiredPatches: PatchDocument[];
};

type ProductModel = {
  positioning?: {
    title?: string;
    summary?: string;
    targetUsers?: string[];
    problem?: string;
    valueProposition?: string;
  };
  features?: Array<{ id: string; name: string; description: string }>;
  flows?: Array<{ id: string; name: string; steps: string[] }>;
};

type Prd = {
  meta: {
    requirementId: string;
    generatedAt: string;
    version: string;
    generator: string;
    model?: string;
  };
  overview?: {
    title?: string;
    summary?: string;
    background?: string;
    businessGoal?: string;
    successMetrics?: string[];
  };
  targetUsers?: Array<{ name: string; needs: string[]; scenarios: string[] }>;
  scope?: {
    inScope: string[];
    outOfScope: string[];
  };
  functionalRequirements?: Array<{ id: string; title: string; description: string; acceptanceCriteria: string[] }>;
  userFlows?: Array<{ id: string; name: string; steps: string[] }>;
  pages?: Array<{ id: string; name: string; purpose: string; keyModules: string[] }>;
  risks?: string[];
  openQuestions?: string[];
};

type Wireframe = {
  requirementId: string;
  generatedAt: string;
  generator: string;
  model?: string;
  pages: Array<{
    id: string;
    name: string;
    purpose: string;
    layout: string;
    sections: Array<{ id: string; title: string; objective: string; notes?: string[]; primaryAction?: string }>;
  }>;
  userFlows: Array<{ id: string; name: string; steps: string[] }>;
};

type AnnotationDoc = {
  requirementId: string;
  generatedAt: string;
  generator: string;
  model?: string;
  annotations: Array<{
    id: string;
    pageId: string;
    sectionId?: string;
    kind: string;
    title: string;
    description: string;
    status: string;
    linkedTaskIds: string[];
  }>;
};

type UiDraft = {
  requirementId: string;
  generatedAt: string;
  generator: string;
  model?: string;
  visualThesis: string;
  interactionThesis: string[];
  designStyle: {
    themeName: string;
    tone: string;
    colorTokens: Record<string, string>;
    fontFamily: string;
    accentStyle: string;
  };
  pages: Array<{ pageId: string; name: string; notes?: string[]; htmlPath?: string }>;
};

type ChatResult = {
  session: ChatSession;
  appliedPatches: Array<{
    patchId: string;
    artifactType: string;
    summary: string;
  }>;
};

type ProjectBundle = {
  requirement: Requirement;
  score: null | {
    priorityLevel: string;
    priorityScore: number;
    valueScore: number;
  };
  tasks: Task[];
  artifacts: {
    clarify: ClarifyPack | null;
    productModel: ProductModel | null;
    prd: Prd | null;
    validation: {
      status: string;
      readinessScore: number;
      summary: string;
      findings: Array<{ id: string; severity: string; title: string; detail: string; suggestion: string }>;
    } | null;
    competitorAnalysis: {
      summary: string;
      recommendations: string[];
    } | null;
    wireframe: Wireframe | null;
    annotations: AnnotationDoc | null;
    ui: UiDraft | null;
    chat: ChatSession | null;
    reviews: ReviewResult[];
    patches: PatchDocument[];
  };
};

type PipelineResult = {
  status: "completed" | "blocked";
  stoppedAt?: string;
  steps: Array<{
    stage: string;
    status: "completed" | "blocked" | "warning" | "skipped";
    summary: string;
    missingFieldKeys?: string[];
  }>;
};

const actionEndpointMap: Record<NonNullable<ChatSession["lastAssistantResponse"]>["recommendedActions"][number]["action"], string> = {
  generate_product_model: "/api/generation/product-model",
  generate_prd: "/api/generation/prd",
  validate_prd: "/api/prd/validate",
  compare_prd: "/api/prd/compare",
  generate_wireframe: "/api/wireframe/generate",
  annotate_wireframe: "/api/wireframe/annotate",
  generate_ui: "/api/ui/generate"
};

export function App() {
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [bundle, setBundle] = useState<ProjectBundle | null>(null);
  const [selectedRequirementId, setSelectedRequirementId] = useState("");
  const [activeStage, setActiveStage] = useState<StageTab>("analysis");
  const [activePanel, setActivePanel] = useState<WorkspacePanel>("capture");
  const [selectedReviewId, setSelectedReviewId] = useState("");
  const [selectedPatchId, setSelectedPatchId] = useState("");
  const [previewPageId, setPreviewPageId] = useState("");
  const [wireframeHtml, setWireframeHtml] = useState("");
  const [uiHtml, setUiHtml] = useState("");
  const [clarifyDraft, setClarifyDraft] = useState<Record<string, string>>({});
  const [prdDraft, setPrdDraft] = useState<Prd | null>(null);
  const [wireframeDraft, setWireframeDraft] = useState<Wireframe | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDoc | null>(null);
  const [uiDraft, setUiDraft] = useState<UiDraft | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [logLines, setLogLines] = useState<string[]>(["Studio ready"]);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [newRequirement, setNewRequirement] = useState({
    title: "",
    sourceName: "",
    content: ""
  });
  const deferredSearch = useDeferredValue(search);

  const filteredRequirements = useMemo(() => {
    const keyword = deferredSearch.trim().toLowerCase();
    if (!keyword) {
      return requirements;
    }
    return requirements.filter((item) =>
      [item.id, item.title, item.source.name, item.rawContent].join(" ").toLowerCase().includes(keyword)
    );
  }, [requirements, deferredSearch]);

  const selectedReview = bundle?.artifacts?.reviews?.find((item) => item.id === selectedReviewId)
    ?? bundle?.artifacts?.reviews?.at(-1)
    ?? null;
  const selectedPatch = bundle?.artifacts?.patches?.find((item) => item.id === selectedPatchId)
    ?? bundle?.artifacts?.patches?.at(-1)
    ?? null;
  const currentChat = bundle?.artifacts.chat ?? null;
  const selectedRequirement = requirements.find((item) => item.id === selectedRequirementId) ?? bundle?.requirement ?? null;
  const stageNodes = useMemo(() => buildStageNodes(bundle), [bundle]);

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    if (!selectedRequirementId && requirements.length > 0) {
      setSelectedRequirementId(requirements[0].id);
    }
  }, [requirements, selectedRequirementId]);

  useEffect(() => {
    if (!selectedRequirementId) {
      return;
    }
    void loadBundle(selectedRequirementId);
  }, [selectedRequirementId]);

  useEffect(() => {
    if (!bundle) {
      return;
    }
    setActiveStage((current) => current || inferStage(bundle));
    setActivePanel((current) => current || inferPanel(bundle));
    setSelectedReviewId((current) => current || bundle?.artifacts?.reviews?.at(-1)?.id || "");
    setSelectedPatchId((current) => current || bundle?.artifacts?.patches?.at(-1)?.id || "");
    const nextPreviewPageId = bundle?.artifacts?.wireframe?.pages?.[0]?.id ?? bundle?.artifacts?.ui?.pages?.[0]?.pageId ?? "";
    setPreviewPageId((current) => current || nextPreviewPageId);
  }, [bundle]);

  useEffect(() => {
    const clarify = bundle?.artifacts.clarify;
    if (!clarify) {
      setClarifyDraft({});
      return;
    }
    setClarifyDraft(Object.fromEntries(
      clarify.questions.map((question) => [question.fieldKey, stringifyAnswer(question.answer, question.answerFormat)])
    ));
  }, [bundle?.artifacts.clarify?.id, bundle?.artifacts.clarify?.status]);

  useEffect(() => {
    setPrdDraft(bundle?.artifacts.prd ? structuredClone(bundle.artifacts.prd) : null);
  }, [bundle?.artifacts.prd]);

  useEffect(() => {
    setWireframeDraft(bundle?.artifacts.wireframe ? structuredClone(bundle.artifacts.wireframe) : null);
  }, [bundle?.artifacts.wireframe]);

  useEffect(() => {
    if (bundle?.artifacts.annotations) {
      setAnnotationDraft(structuredClone(bundle.artifacts.annotations));
      return;
    }
    if (bundle?.artifacts.wireframe) {
      setAnnotationDraft({
        requirementId: bundle.requirement.id,
        generatedAt: new Date().toISOString(),
        generator: "manual",
        annotations: []
      });
      return;
    }
    setAnnotationDraft(null);
  }, [bundle?.artifacts.annotations, bundle?.artifacts.wireframe, bundle?.requirement.id]);

  useEffect(() => {
    setUiDraft(bundle?.artifacts.ui ? structuredClone(bundle.artifacts.ui) : null);
  }, [bundle?.artifacts.ui]);

  useEffect(() => {
    if (!bundle || !previewPageId || !selectedRequirementId) {
      return;
    }
    void Promise.allSettled([
      bundle.artifacts.wireframe ? loadWireframePage(selectedRequirementId, previewPageId) : Promise.resolve(),
      bundle.artifacts.ui ? loadUiPage(selectedRequirementId, previewPageId) : Promise.resolve()
    ]);
  }, [bundle?.artifacts.wireframe, bundle?.artifacts.ui, previewPageId, selectedRequirementId]);

  async function refreshAll() {
    setLoading(true);
    try {
      const [requirementsData, tasksData, skillsData] = await Promise.all([
        fetchJson<Requirement[]>("/api/requirements"),
        fetchJson<Task[]>("/api/tasks"),
        fetchJson<Skill[]>("/api/skills")
      ]);
      startTransition(() => {
        setRequirements(requirementsData);
        setTasks(tasksData);
        setSkills(skillsData);
      });
      appendLog("Workspace refreshed");
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadBundle(requirementId: string) {
    try {
      const data = await fetchJson<ProjectBundle>(`/api/project/${requirementId}/bundle`);
      startTransition(() => {
        setBundle(data);
      });
      setActiveStage(inferStage(data));
      setActivePanel(inferPanel(data));
    } catch (error) {
      setBundle(null);
      setWireframeHtml("");
      setUiHtml("");
      appendLog(error instanceof Error ? error.message : "Load bundle failed");
    }
  }

  async function loadWireframePage(requirementId: string, pageId: string) {
    const data = await fetchJson<{ html: string }>(`/api/project/${requirementId}/wireframe/pages/${pageId}`);
    setWireframeHtml(data.html);
  }

  async function loadUiPage(requirementId: string, pageId: string) {
    const data = await fetchJson<{ html: string }>(`/api/project/${requirementId}/ui/pages/${pageId}`);
    setUiHtml(data.html);
  }

  function updatePrdDraft(mutator: (draft: Prd) => void) {
    setPrdDraft((current) => {
      if (!current) {
        return current;
      }
      const next = structuredClone(current);
      mutator(next);
      return next;
    });
  }

  function updateWireframeDraft(mutator: (draft: Wireframe) => void) {
    setWireframeDraft((current) => {
      if (!current) {
        return current;
      }
      const next = structuredClone(current);
      mutator(next);
      return next;
    });
  }

  function updateAnnotationDraft(mutator: (draft: AnnotationDoc) => void) {
    setAnnotationDraft((current) => {
      if (!current) {
        return current;
      }
      const next = structuredClone(current);
      mutator(next);
      return next;
    });
  }

  function updateUiDraft(mutator: (draft: UiDraft) => void) {
    setUiDraft((current) => {
      if (!current) {
        return current;
      }
      const next = structuredClone(current);
      mutator(next);
      return next;
    });
  }

  async function runAction(label: string, endpoint: string, body: Record<string, unknown>) {
    if (!selectedRequirementId) {
      return;
    }
    setLoading(true);
    appendLog(`${label} started`);
    try {
      await fetchJson(endpoint, {
        method: "POST",
        body: JSON.stringify(body)
      });
      appendLog(`${label} finished`);
      await Promise.all([loadBundle(selectedRequirementId), refreshAll()]);
    } catch (error) {
      appendLog(error instanceof Error ? error.message : `${label} failed`);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newRequirement.title.trim() || !newRequirement.sourceName.trim() || !newRequirement.content.trim()) {
      return;
    }
    setLoading(true);
    try {
      const requirement = await fetchJson<Requirement>("/api/requirements", {
        method: "POST",
        body: JSON.stringify({
          title: newRequirement.title,
          sourceType: "product",
          sourceName: newRequirement.sourceName,
          sourceChannel: "chat",
          content: newRequirement.content
        })
      });
      setNewRequirement({ title: "", sourceName: "", content: "" });
      appendLog(`Requirement ${requirement.id} created`);
      await refreshAll();
      setSelectedRequirementId(requirement.id);
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Create requirement failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateClarifyPack() {
    if (!selectedRequirementId) {
      return;
    }
    setLoading(true);
    try {
      await fetchJson(`/api/requirements/${selectedRequirementId}/clarify/question-pack`, {
        method: "POST",
        body: JSON.stringify({
          domainHint: "generic_product",
          mode: "hard_block"
        })
      });
      appendLog("Clarify question pack generated");
      await loadBundle(selectedRequirementId);
      setActiveStage("analysis");
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Clarify pack failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveClarifyAnswers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clarify = bundle?.artifacts.clarify;
    if (!selectedRequirementId || !clarify) {
      return;
    }

    const answers = clarify.questions.map((question) => ({
      fieldKey: question.fieldKey,
      answer: parseAnswerInput(clarifyDraft[question.fieldKey] ?? "", question.answerFormat),
      answerSource: "user" as const
    })).filter((item) => item.answer !== null && item.answer !== "");

    setLoading(true);
    try {
      await fetchJson(`/api/requirements/${selectedRequirementId}/clarify/answers`, {
        method: "POST",
        body: JSON.stringify({ answers })
      });
      appendLog("Requirement analysis updated");
      await loadBundle(selectedRequirementId);
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Save analysis failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSavePrd() {
    if (!selectedRequirementId || !prdDraft) {
      return;
    }
    setLoading(true);
    try {
      await fetchJson(`/api/project/${selectedRequirementId}/prd`, {
        method: "PUT",
        body: JSON.stringify(prdDraft)
      });
      appendLog("PRD saved");
      await loadBundle(selectedRequirementId);
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Save PRD failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveWireframe() {
    if (!selectedRequirementId || !wireframeDraft) {
      return;
    }
    setLoading(true);
    try {
      await fetchJson(`/api/project/${selectedRequirementId}/wireframe`, {
        method: "PUT",
        body: JSON.stringify({
          spec: wireframeDraft,
          annotations: annotationDraft ?? undefined
        })
      });
      appendLog("Wireframe saved");
      await loadBundle(selectedRequirementId);
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Save wireframe failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveUiDraft() {
    if (!selectedRequirementId || !uiDraft) {
      return;
    }
    setLoading(true);
    try {
      await fetchJson(`/api/project/${selectedRequirementId}/ui`, {
        method: "PUT",
        body: JSON.stringify(uiDraft)
      });
      appendLog("UI Draft saved");
      await loadBundle(selectedRequirementId);
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Save UI failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleRunClarifyReview() {
    if (!selectedRequirementId) {
      return;
    }
    setLoading(true);
    try {
      const review = await fetchJson<ReviewResult>(`/api/requirements/${selectedRequirementId}/clarify/review`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setSelectedReviewId(review.id);
      appendLog(`Clarify review ${review.status}`);
      await loadBundle(selectedRequirementId);
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Clarify review failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleRunStageReview(stage: ReviewResult["stage"]) {
    if (!selectedRequirementId) {
      return;
    }
    setLoading(true);
    try {
      const review = await fetchJson<ReviewResult>(`/api/requirements/${selectedRequirementId}/reviews`, {
        method: "POST",
        body: JSON.stringify({ stage })
      });
      setSelectedReviewId(review.id);
      appendLog(`${stage} review ${review.status}`);
      await loadBundle(selectedRequirementId);
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Review failed");
    } finally {
      setLoading(false);
    }
  }

  async function handlePreviewPatch(reviewId: string, target: PatchDocument["target"]) {
    if (!selectedRequirementId) {
      return;
    }
    setLoading(true);
    try {
      const result = await fetchJson<{ patch: PatchDocument }>(`/api/requirements/${selectedRequirementId}/patches/preview`, {
        method: "POST",
        body: JSON.stringify({
          target,
          source: { kind: "review", reviewId }
        })
      });
      setSelectedPatchId(result.patch.id);
      appendLog(`Patch ${result.patch.id} previewed`);
      await loadBundle(selectedRequirementId);
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Patch preview failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleApplyPatch() {
    if (!selectedRequirementId || !selectedPatch) {
      return;
    }
    setLoading(true);
    try {
      await fetchJson(`/api/requirements/${selectedRequirementId}/patches/${selectedPatch.id}/apply`, {
        method: "POST",
        body: JSON.stringify({})
      });
      appendLog(`Patch ${selectedPatch.id} applied`);
      await loadBundle(selectedRequirementId);
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Patch apply failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleRunPipeline() {
    if (!selectedRequirementId) {
      return;
    }
    setLoading(true);
    try {
      const result = await fetchJson<PipelineResult>(`/api/requirements/${selectedRequirementId}/pipeline/run`, {
        method: "POST",
        body: JSON.stringify({
          fromStage: "clarify",
          toStage: activeStage === "analysis" ? "prd" : activeStage === "prd" ? "prd" : activeStage === "wireframe" ? "wireframe" : "ui",
          mode: "continue_on_warning",
          autoApplyPatches: false
        })
      });
      setPipelineResult(result);
      appendLog(`Pipeline ${result.status}${result.stoppedAt ? ` at ${result.stoppedAt}` : ""}`);
      await loadBundle(selectedRequirementId);
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Pipeline failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRequirementId || !chatInput.trim()) {
      return;
    }
    setLoading(true);
    try {
      const result = await fetchJson<ChatResult>(`/api/project/${selectedRequirementId}/chat`, {
        method: "POST",
        body: JSON.stringify({
          message: chatInput,
          currentStage: activeStage,
          currentPageId: activeStage === "wireframe" || activeStage === "ui" ? previewPageId : undefined
        })
      });
      setBundle((current) => current ? {
        ...current,
        artifacts: {
          ...current.artifacts,
          chat: result.session
        }
      } : current);
      setChatInput("");
      appendLog(result.appliedPatches.length > 0
        ? `Chat applied ${result.appliedPatches.map((item) => item.artifactType).join(", ")} patch`
        : "Chat updated current stage");
      await loadBundle(selectedRequirementId);
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Chat failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleAnnotationTask(annotationId: string, title: string) {
    if (!selectedRequirementId) {
      return;
    }
    setLoading(true);
    try {
      await fetchJson(`/api/project/${selectedRequirementId}/annotations/${annotationId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title,
          type: "product",
          priority: "P1"
        })
      });
      appendLog(`Task created from annotation ${annotationId}`);
      await Promise.all([loadBundle(selectedRequirementId), refreshAll()]);
    } catch (error) {
      appendLog(error instanceof Error ? error.message : "Create task failed");
    } finally {
      setLoading(false);
    }
  }

  function handleSelectPanel(panel: WorkspacePanel) {
    setActivePanel(panel);
    const mappedStage = panelToStage(panel);
    if (mappedStage) {
      setActiveStage(mappedStage);
    }
  }

  return (
    <div className="aipm-shell">
      <aside className="project-pane">
        <section className="project-hero">
          <p className="eyebrow">AIPM Workbench</p>
          <h1>需求到 UI 的 AI PM 工作台</h1>
          <p className="hero-copy">从一句话需求开始，经过需求结构、模型、PRD、原型、标注和 UI Draft 的固定阶段流转，持续沉淀专业产物。</p>
        </section>

        <section className="pane-card">
          <div className="pane-head">
            <div>
              <p className="eyebrow">Projects</p>
              <h3>项目区</h3>
            </div>
            <span className="signal">{requirements.length} projects</span>
          </div>
          <div className="sidebar-search">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目 / requirement" />
          </div>
          <div className="project-list">
            {filteredRequirements.map((item) => (
              <button
                key={item.id}
                className={item.id === selectedRequirementId ? "project-item active" : "project-item"}
                onClick={() => setSelectedRequirementId(item.id)}
              >
                <strong>{item.title}</strong>
                <small>{item.source.name}</small>
                <small>{item.status} · {item.priorityLevel ?? "未评分"}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="pane-card">
          <div className="pane-head">
            <div>
              <p className="eyebrow">New Project</p>
              <h3>新建项目</h3>
            </div>
          </div>
          <form className="capture-form" onSubmit={handleCreateRequirement}>
            <input
              value={newRequirement.title}
              onChange={(event) => setNewRequirement((current) => ({ ...current, title: event.target.value }))}
              placeholder="项目 / 需求标题"
            />
            <input
              value={newRequirement.sourceName}
              onChange={(event) => setNewRequirement((current) => ({ ...current, sourceName: event.target.value }))}
              placeholder="来源人 / 团队"
            />
            <textarea
              value={newRequirement.content}
              onChange={(event) => setNewRequirement((current) => ({ ...current, content: event.target.value }))}
              rows={5}
              placeholder="一句话需求或上传文档后识别出的需求摘要"
            />
            <button className="primary-button" type="submit" disabled={loading}>创建项目</button>
          </form>
        </section>

        <section className="pane-card">
          <div className="pane-head">
            <div>
              <p className="eyebrow">Project Prompt</p>
              <h3>项目级约束</h3>
            </div>
          </div>
          <div className="summary-block">
            <strong>系统提示词</strong>
            <p>项目创建后支持配置系统提示词、默认输出风格和默认审查规则。当前 UI 先保留入口，后续接入真实配置中心。</p>
          </div>
          <div className="chip-row">
            <span className="field-chip ready">system prompt</span>
            <span className="field-chip ready">style rule</span>
            <span className="field-chip missing">review rule</span>
          </div>
        </section>
      </aside>

      <main className="chat-center">
        <section className="chat-hero">
          <div>
            <p className="eyebrow">Chat Workspace</p>
            <h2>{selectedRequirement?.title ?? "选择项目开始协作"}</h2>
            <p className="chat-context">
              {selectedRequirement?.rawContent ?? "在中间聊天区和 AI 产品专家持续沟通，AI 会补全需求、review 当前产物，并推动右侧阶段流转。"}
            </p>
          </div>
          <div className="hero-signals">
            <span className="signal">{bundle?.requirement.status ?? "captured"}</span>
            <span className="signal">{bundle?.score?.priorityLevel ?? selectedRequirement?.priorityLevel ?? "未评分"}</span>
            <span className="signal">{activePanel}</span>
          </div>
        </section>

        <section className="chat-workspace">
          <div className="chat-workspace-head">
            <div>
              <p className="eyebrow">AI Product Partner</p>
              <h3>中间聊天区</h3>
            </div>
            <div className="workspace-actions">
              <button className="ghost-button" onClick={handleGenerateClarifyPack} disabled={!selectedRequirementId || loading}>生成需求结构</button>
              <button className="ghost-button" onClick={handleRunPipeline} disabled={!selectedRequirementId || loading}>运行阶段流转</button>
            </div>
          </div>

          <section className="chat-thread large">
            {currentChat?.messages?.length ? currentChat.messages.map((message) => (
              <article key={message.id} className={message.role === "user" ? "chat-message user" : "chat-message ai"}>
                <span>{message.role}</span>
                <p>{message.content}</p>
              </article>
            )) : (
              <div className="chat-empty">
                <p>从这里开始描述需求、补充文件识别结果，或者要求 AI 修改右侧当前阶段产物。</p>
              </div>
            )}
          </section>

          <section className="chat-suggestions">
            {currentChat?.lastAssistantResponse?.recommendedActions?.length ? currentChat.lastAssistantResponse.recommendedActions.map((item) => (
              <button
                key={`${item.action}-${item.label}`}
                className="suggestion-button"
                onClick={() => runAction(item.label, actionEndpointMap[item.action], item.action === "compare_prd"
                  ? { requirementId: selectedRequirementId, competitors: ["Stitch", "Figma", "Notion"] }
                  : { requirementId: selectedRequirementId })}
              >
                <strong>{item.label}</strong>
                <small>{item.reason}</small>
              </button>
            )) : (
              <div className="suggestion-card">
                <strong>当前建议</strong>
                <small>先完成需求结构和澄清，再推进产品模型与 PRD。</small>
              </div>
            )}
          </section>

          <form className="chat-input-shell" onSubmit={handleChatSubmit}>
            <textarea
              rows={5}
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="例如：根据上传文档整理详细需求点；把当前 PRD 改得更完整；给原型补标注；让 UI 更像成熟工作台。"
            />
            <div className="chat-bottom-bar">
              <div className="chat-meta">
                <span>{tasks.length} tasks</span>
                <span>{skills.length} skills</span>
                <span>当前阶段 {stageLabel(activeStage)}</span>
              </div>
              <button className="primary-button" type="submit" disabled={!selectedRequirementId || loading}>发送给 AIPM</button>
            </div>
          </form>

          <section className="log-surface">
            <p className="eyebrow">Session Log</p>
            <div className="log-list">
              {logLines.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
            </div>
          </section>
        </section>
      </main>

      <aside className="stage-pane">
        <section className="pane-card">
          <div className="pane-head">
            <div>
              <p className="eyebrow">Stage Flow</p>
              <h3>阶段与产物区</h3>
            </div>
            <span className="signal">固定流程</span>
          </div>
          <div className="stage-flow-list">
            {stageNodes.map((node) => (
              <button
                key={node.id}
                className={node.id === activePanel ? "stage-flow-item active" : "stage-flow-item"}
                onClick={() => handleSelectPanel(node.id)}
              >
                <div>
                  <strong>{node.name}</strong>
                  <small>{node.description}</small>
                </div>
                <span className={`status-pill ${node.status}`}>{node.statusLabel}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="pane-card stage-detail-card">
          <div className="pane-head">
            <div>
              <p className="eyebrow">Current Output</p>
              <h3>{panelLabel(activePanel)}</h3>
            </div>
            <div className="panel-actions">
              <button className="ghost-button" onClick={() => handleSelectPanel("review")} disabled={!bundle}>查看 review</button>
              <button className="ghost-button" onClick={() => handleSelectPanel("prd")} disabled={!bundle?.artifacts.prd}>打开 PRD</button>
            </div>
          </div>

          {renderRightPanelWorkspace({
            activePanel,
            bundle,
            clarifyDraft,
            prdDraft,
            wireframeDraft,
            annotationDraft,
            uiDraft,
            previewPageId,
            wireframeHtml,
            uiHtml,
            selectedReview,
            selectedPatch,
            loading,
            pipelineResult,
            onClarifyChange: (fieldKey, value) => setClarifyDraft((current) => ({ ...current, [fieldKey]: value })),
            onSaveAnalysis: handleSaveClarifyAnswers,
            onReviewAnalysis: handleRunClarifyReview,
            onOverviewChange: (field, value) => updatePrdDraft((draft) => {
              draft.overview = {
                title: draft.overview?.title ?? "",
                summary: draft.overview?.summary ?? "",
                background: draft.overview?.background ?? "",
                businessGoal: draft.overview?.businessGoal ?? "",
                successMetrics: draft.overview?.successMetrics ?? [],
                ...draft.overview,
                [field]: value
              };
            }),
            onStringListChange: (field, value) => updatePrdDraft((draft) => {
              if (field === "successMetrics") {
                draft.overview = {
                  title: draft.overview?.title ?? "",
                  summary: draft.overview?.summary ?? "",
                  background: draft.overview?.background ?? "",
                  businessGoal: draft.overview?.businessGoal ?? "",
                  successMetrics: parseLines(value)
                };
                return;
              }
              draft[field] = parseLines(value);
            }),
            onSavePrd: handleSavePrd,
            onRunPrdReview: () => handleRunStageReview("prd"),
            onSelectReview: setSelectedReviewId,
            onPreviewPatch: handlePreviewPatch,
            onSelectPatch: setSelectedPatchId,
            onApplyPatch: handleApplyPatch,
            onSelectPage: setPreviewPageId,
            onPageFieldChange: (pageId, field, value) => updateWireframeDraft((draft) => {
              const page = draft.pages.find((item) => item.id === pageId);
              if (page) {
                page[field] = value;
              }
            }),
            onAnnotationChange: (annotationId, field, value) => updateAnnotationDraft((draft) => {
              const annotation = draft.annotations.find((item) => item.id === annotationId);
              if (!annotation) {
                return;
              }
              if (field === "status" || field === "kind" || field === "title" || field === "description") {
                (annotation as Record<string, unknown>)[field] = value;
              }
            }),
            onSaveWireframe: handleSaveWireframe,
            onGenerateWireframe: () => runAction("Generate wireframe", "/api/wireframe/generate", { requirementId: selectedRequirementId }),
            onAnnotateWireframe: () => runAction("Annotate wireframe", "/api/wireframe/annotate", { requirementId: selectedRequirementId }),
            onCreateTask: handleAnnotationTask,
            onUiFieldChange: (field, value) => updateUiDraft((draft) => {
              (draft as unknown as Record<string, unknown>)[field] = value;
            }),
            onUiInteractionChange: (value) => updateUiDraft((draft) => {
              draft.interactionThesis = parseLines(value);
            }),
            onUiStyleChange: (field, value) => updateUiDraft((draft) => {
              (draft.designStyle as unknown as Record<string, unknown>)[field] = value;
            }),
            onColorTokenChange: (token, value) => updateUiDraft((draft) => {
              draft.designStyle.colorTokens[token] = value;
            }),
            onSaveUi: handleSaveUiDraft,
            onGenerateUi: () => runAction("Generate UI", "/api/ui/generate", { requirementId: selectedRequirementId })
          })}
        </section>
      </aside>
    </div>
  );

  function appendLog(message: string) {
    setLogLines((current) => [`${new Date().toLocaleTimeString()} ${message}`, ...current].slice(0, 14));
  }
}

function renderAnalysisStage(input: {
  bundle: ProjectBundle | null;
  clarifyDraft: Record<string, string>;
  loading: boolean;
  selectedReview: ReviewResult | null;
  pipelineResult: PipelineResult | null;
  onClarifyChange: (fieldKey: string, value: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onReview: () => Promise<void>;
}) {
  const clarify = input.bundle?.artifacts.clarify;

  return (
    <div className="stage-grid">
      <section className="stage-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Requirement Analysis</p>
            <h3>先把不完整需求补全</h3>
          </div>
          {clarify ? <span className={clarify.gating.isSatisfied ? "status-pill pass" : "status-pill block"}>{clarify.status}</span> : null}
        </div>

        {clarify ? (
          <form className="analysis-form" onSubmit={input.onSave}>
            <div className="analysis-summary">
              <div>
                <strong>completion {clarify.gating.completionScore}%</strong>
                <p>{clarify.summary}</p>
              </div>
              <div className="chip-row">
                {clarify.gating.requiredFieldKeys.map((fieldKey) => (
                  <span key={fieldKey} className={clarify.gating.missingFieldKeys.includes(fieldKey) ? "field-chip missing" : "field-chip ready"}>
                    {fieldKey}
                  </span>
                ))}
              </div>
            </div>

            <div className="analysis-fields">
              {clarify.questions.map((question) => (
                <div key={question.id} className="analysis-field">
                  <div className="field-head">
                    <div>
                      <strong>{question.title}</strong>
                      <small>{question.fieldKey}</small>
                    </div>
                    <span className={question.required ? "field-badge required" : "field-badge"}>{question.required ? "required" : question.priority}</span>
                  </div>
                  <p>{question.prompt}</p>
                  {question.whyNeeded ? <small className="muted-copy">{question.whyNeeded}</small> : null}
                  {renderClarifyInput(question, input.clarifyDraft[question.fieldKey] ?? "", (nextValue) => input.onClarifyChange(question.fieldKey, nextValue))}
                </div>
              ))}
            </div>

            <div className="action-row">
              <button className="ghost-button" type="button" onClick={() => void input.onReview()} disabled={input.loading}>运行分析审查</button>
              <button className="primary-button" type="submit" disabled={input.loading}>保存需求分析</button>
            </div>
          </form>
        ) : (
          <div className="empty-state">先生成 Requirement Analysis，系统会把模糊需求拆成结构化需求点。</div>
        )}
      </section>

      <section className="stage-panel secondary">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Current Output</p>
            <h3>分析结果与系统判断</h3>
          </div>
        </div>

        <div className="summary-block">
          <strong>当前输入</strong>
          <p>{input.bundle?.requirement.rawContent ?? "尚未选择需求"}</p>
        </div>

        {clarify?.answeredFieldMap ? (
          <div className="summary-block">
            <strong>已补齐的需求点</strong>
            <ul>
              {Object.entries(clarify.answeredFieldMap).map(([key, value]) => (
                <li key={key}>
                  <b>{key}</b>：{formatAnswer(value)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {input.selectedReview ? (
          <div className="summary-block">
            <strong>最新审查</strong>
            <p>{input.selectedReview.summary}</p>
          </div>
        ) : null}

        {input.pipelineResult ? (
          <div className="summary-block">
            <strong>最近一次编排</strong>
            <ul>
              {input.pipelineResult.steps.map((step) => (
                <li key={`${step.stage}-${step.summary}`}>
                  <b>{step.stage}</b>：{step.status}，{step.summary}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function renderRightPanelWorkspace(input: {
  activePanel: WorkspacePanel;
  bundle: ProjectBundle | null;
  clarifyDraft: Record<string, string>;
  prdDraft: Prd | null;
  wireframeDraft: Wireframe | null;
  annotationDraft: AnnotationDoc | null;
  uiDraft: UiDraft | null;
  previewPageId: string;
  wireframeHtml: string;
  uiHtml: string;
  selectedReview: ReviewResult | null;
  selectedPatch: PatchDocument | null;
  loading: boolean;
  pipelineResult: PipelineResult | null;
  onClarifyChange: (fieldKey: string, value: string) => void;
  onSaveAnalysis: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onReviewAnalysis: () => Promise<void>;
  onOverviewChange: (field: "title" | "summary" | "background" | "businessGoal", value: string) => void;
  onStringListChange: (field: "successMetrics" | "risks" | "openQuestions", value: string) => void;
  onSavePrd: () => Promise<void>;
  onRunPrdReview: () => Promise<void>;
  onSelectReview: (reviewId: string) => void;
  onPreviewPatch: (reviewId: string, target: PatchDocument["target"]) => Promise<void>;
  onSelectPatch: (patchId: string) => void;
  onApplyPatch: () => Promise<void>;
  onSelectPage: (pageId: string) => void;
  onPageFieldChange: (pageId: string, field: "name" | "purpose" | "layout", value: string) => void;
  onAnnotationChange: (annotationId: string, field: "kind" | "title" | "description" | "status", value: string) => void;
  onSaveWireframe: () => Promise<void>;
  onGenerateWireframe: () => Promise<void>;
  onAnnotateWireframe: () => Promise<void>;
  onCreateTask: (annotationId: string, title: string) => Promise<void>;
  onUiFieldChange: (field: "visualThesis", value: string) => void;
  onUiInteractionChange: (value: string) => void;
  onUiStyleChange: (field: "themeName" | "tone" | "fontFamily" | "accentStyle", value: string) => void;
  onColorTokenChange: (token: string, value: string) => void;
  onSaveUi: () => Promise<void>;
  onGenerateUi: () => Promise<void>;
}) {
  const latestReview = input.selectedReview ?? input.bundle?.artifacts.reviews.at(-1) ?? null;
  const currentWireframePage = input.wireframeDraft?.pages.find((page) => page.id === input.previewPageId)
    ?? input.wireframeDraft?.pages[0]
    ?? null;
  const currentAnnotations = input.annotationDraft?.annotations.filter((item) => item.pageId === currentWireframePage?.id) ?? [];

  if (input.activePanel === "capture") {
    return (
      <div className="stage-summary">
        <div className="summary-block">
          <strong>需求采集</strong>
          <p>{input.bundle?.requirement.rawContent ?? "还没有选择项目。先在左侧新建项目，输入一句话需求或上传文档识别结果。"} </p>
        </div>
        <div className="summary-block">
          <strong>当前记录</strong>
          <ul>
            <li>来源：{input.bundle?.requirement.source.name ?? "未选择"}</li>
            <li>状态：{input.bundle?.requirement.status ?? "captured"}</li>
            <li>优先级：{input.bundle?.score?.priorityLevel ?? input.bundle?.requirement.priorityLevel ?? "未评分"}</li>
          </ul>
        </div>
      </div>
    );
  }

  if (input.activePanel === "structure" || input.activePanel === "clarify") {
    const clarify = input.bundle?.artifacts.clarify;
    return clarify ? (
      <form className="stage-summary stage-form" onSubmit={input.onSaveAnalysis}>
        <div className="summary-block">
          <strong>需求结构与澄清</strong>
          <p>{clarify.summary ?? "AI 已经从原始输入中提取出结构化需求点，你可以继续补全。"} </p>
          <div className="chip-row">
            {clarify.gating.requiredFieldKeys.map((fieldKey) => (
              <span key={fieldKey} className={clarify.gating.missingFieldKeys.includes(fieldKey) ? "field-chip missing" : "field-chip ready"}>
                {fieldKey}
              </span>
            ))}
          </div>
        </div>
        <div className="compact-field-list">
          {clarify.questions.slice(0, 6).map((question) => (
            <label key={question.id} className="compact-field">
              <strong>{question.title}</strong>
              <small>{question.prompt}</small>
              {renderClarifyInput(question, input.clarifyDraft[question.fieldKey] ?? "", (nextValue) => input.onClarifyChange(question.fieldKey, nextValue))}
            </label>
          ))}
        </div>
        <div className="panel-actions">
          <button className="ghost-button" type="button" onClick={() => void input.onReviewAnalysis()} disabled={input.loading}>AI Review</button>
          <button className="primary-button" type="submit" disabled={input.loading}>保存需求结构</button>
        </div>
      </form>
    ) : (
      <div className="empty-state">还没有需求结构产物，先在中间聊天区让 AI 整理输入内容。</div>
    );
  }

  if (input.activePanel === "model") {
    const model = input.bundle?.artifacts.productModel;
    return model ? (
      <div className="stage-summary">
        <div className="summary-block">
          <strong>产品模型</strong>
          <p>{model.positioning?.summary ?? "当前项目已进入产品模型阶段。"} </p>
        </div>
        <div className="summary-block">
          <strong>模型输出</strong>
          <ul>
            <li>目标用户：{(model.positioning?.targetUsers ?? []).join("、") || "未定义"}</li>
            <li>功能数量：{model.features?.length ?? 0}</li>
            <li>流程数量：{model.flows?.length ?? 0}</li>
          </ul>
        </div>
      </div>
    ) : (
      <div className="empty-state">产品模型还没有生成。先完成需求结构和澄清，再推进到模型阶段。</div>
    );
  }

  if (input.activePanel === "prd") {
    const prd = input.prdDraft;
    return prd ? (
      <div className="stage-summary">
        <div className="compact-field-list">
          <label className="compact-field">
            <strong>标题</strong>
            <input value={prd.overview?.title ?? ""} onChange={(event) => input.onOverviewChange("title", event.target.value)} />
          </label>
          <label className="compact-field">
            <strong>摘要</strong>
            <textarea rows={5} value={prd.overview?.summary ?? ""} onChange={(event) => input.onOverviewChange("summary", event.target.value)} />
          </label>
          <label className="compact-field">
            <strong>业务目标</strong>
            <textarea rows={4} value={prd.overview?.businessGoal ?? ""} onChange={(event) => input.onOverviewChange("businessGoal", event.target.value)} />
          </label>
          <label className="compact-field">
            <strong>成功指标</strong>
            <textarea rows={4} value={(prd.overview?.successMetrics ?? []).join("\n")} onChange={(event) => input.onStringListChange("successMetrics", event.target.value)} />
          </label>
          <label className="compact-field">
            <strong>风险</strong>
            <textarea rows={4} value={(prd.risks ?? []).join("\n")} onChange={(event) => input.onStringListChange("risks", event.target.value)} />
          </label>
          <label className="compact-field">
            <strong>待确认项</strong>
            <textarea rows={4} value={(prd.openQuestions ?? []).join("\n")} onChange={(event) => input.onStringListChange("openQuestions", event.target.value)} />
          </label>
        </div>
        <div className="panel-actions">
          <button className="ghost-button" onClick={() => void input.onRunPrdReview()} disabled={input.loading}>PRD Review</button>
          <button className="primary-button" onClick={() => void input.onSavePrd()} disabled={input.loading}>保存 PRD</button>
        </div>
      </div>
    ) : (
      <div className="empty-state">PRD 还没有生成。先通过需求结构和产品模型，再进入 PRD 阶段。</div>
    );
  }

  if (input.activePanel === "wireframe" || input.activePanel === "annotation") {
    return input.wireframeDraft ? (
      <div className="stage-summary">
        <div className="page-tabs compact">
          {input.wireframeDraft.pages.map((page) => (
            <button
              key={page.id}
              className={page.id === input.previewPageId ? "page-tab active" : "page-tab"}
              onClick={() => input.onSelectPage(page.id)}
            >
              {page.name}
            </button>
          ))}
        </div>
        <div className="preview-frame compact-frame">
          {input.wireframeHtml ? <iframe title="wireframe-preview" srcDoc={input.wireframeHtml} /> : <div className="empty-state">选择页面后查看原型稿。</div>}
        </div>
        {currentWireframePage ? (
          <div className="compact-field-list">
            <label className="compact-field">
              <strong>页面名称</strong>
              <input value={currentWireframePage.name} onChange={(event) => input.onPageFieldChange(currentWireframePage.id, "name", event.target.value)} />
            </label>
            <label className="compact-field">
              <strong>页面目的</strong>
              <textarea rows={4} value={currentWireframePage.purpose} onChange={(event) => input.onPageFieldChange(currentWireframePage.id, "purpose", event.target.value)} />
            </label>
            {currentAnnotations.length > 0 ? currentAnnotations.slice(0, 2).map((annotation) => (
              <label key={annotation.id} className="compact-field">
                <strong>{annotation.title}</strong>
                <textarea rows={3} value={annotation.description} onChange={(event) => input.onAnnotationChange(annotation.id, "description", event.target.value)} />
              </label>
            )) : null}
          </div>
        ) : null}
        <div className="panel-actions">
          <button className="ghost-button" onClick={() => void input.onGenerateWireframe()}>生成原型</button>
          <button className="ghost-button" onClick={() => void input.onAnnotateWireframe()} disabled={input.loading}>补标注</button>
          <button className="primary-button" onClick={() => void input.onSaveWireframe()} disabled={input.loading}>保存原型</button>
        </div>
      </div>
    ) : (
      <div className="empty-state">原型和标注还没有生成。先完成 PRD，再进入原型阶段。</div>
    );
  }

  if (input.activePanel === "ui") {
    const ui = input.uiDraft;
    return ui ? (
      <div className="stage-summary">
        <div className="page-tabs compact">
          {ui.pages.map((page) => (
            <button
              key={page.pageId}
              className={page.pageId === input.previewPageId ? "page-tab active" : "page-tab"}
              onClick={() => input.onSelectPage(page.pageId)}
            >
              {page.name}
            </button>
          ))}
        </div>
        <div className="preview-frame compact-frame ui-frame">
          {input.uiHtml ? <iframe title="ui-preview" srcDoc={input.uiHtml} /> : <div className="empty-state">选择页面后查看 UI 稿。</div>}
        </div>
        <div className="compact-field-list">
          <label className="compact-field">
            <strong>视觉命题</strong>
            <textarea rows={4} value={ui.visualThesis} onChange={(event) => input.onUiFieldChange("visualThesis", event.target.value)} />
          </label>
          <label className="compact-field">
            <strong>交互原则</strong>
            <textarea rows={4} value={ui.interactionThesis.join("\n")} onChange={(event) => input.onUiInteractionChange(event.target.value)} />
          </label>
          <label className="compact-field">
            <strong>风格语气</strong>
            <textarea rows={3} value={ui.designStyle.tone} onChange={(event) => input.onUiStyleChange("tone", event.target.value)} />
          </label>
        </div>
        <div className="panel-actions">
          <button className="ghost-button" onClick={() => void input.onGenerateUi()}>生成 UI 稿</button>
          <button className="primary-button" onClick={() => void input.onSaveUi()} disabled={input.loading}>保存 UI 稿</button>
        </div>
      </div>
    ) : (
      <div className="empty-state">UI Draft 还没有生成。先完成原型和标注，再进入 UI 阶段。</div>
    );
  }

  return (
    <div className="stage-summary">
      <div className="summary-block">
        <strong>Review / Diff / 回滚</strong>
        <p>{latestReview?.summary ?? "当前还没有 review 结果。后续这里展示 AI review、patch diff 和版本回滚入口。"} </p>
      </div>
      {latestReview ? (
        <div className="summary-block">
          <strong>最近一次 Review</strong>
          <p>{latestReview.stage} · {latestReview.status} · score {latestReview.score}</p>
          {latestReview.findings.length > 0 ? (
            <ul>
              {latestReview.findings.slice(0, 3).map((finding) => <li key={finding.id}>{finding.title}</li>)}
            </ul>
          ) : null}
          {latestReview.requiredPatches.length > 0 ? (
            <div className="patch-buttons">
              {latestReview.requiredPatches.map((patch) => (
                <button key={patch.id} className="ghost-button" onClick={() => void input.onPreviewPatch(latestReview.id, patch.target)}>
                  {patch.summary ?? patch.id}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {input.selectedPatch ? (
        <div className="summary-block">
          <strong>当前 Patch</strong>
          <p>{input.selectedPatch.summary ?? input.selectedPatch.id}</p>
          <button className="primary-button" onClick={() => void input.onApplyPatch()} disabled={input.loading}>应用 Patch</button>
        </div>
      ) : null}
      {input.pipelineResult ? (
        <div className="summary-block">
          <strong>最近一次阶段流转</strong>
          <ul>
            {input.pipelineResult.steps.map((step) => <li key={`${step.stage}-${step.summary}`}>{step.stage} · {step.status}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function renderPrdStage(input: {
  bundle: ProjectBundle | null;
  prdDraft: Prd | null;
  selectedReview: ReviewResult | null;
  selectedPatch: PatchDocument | null;
  loading: boolean;
  onOverviewChange: (field: "title" | "summary" | "background" | "businessGoal", value: string) => void;
  onStringListChange: (field: "successMetrics" | "risks" | "openQuestions", value: string) => void;
  onTargetUserChange: (index: number, field: "name" | "needs" | "scenarios", value: string) => void;
  onAddTargetUser: () => void;
  onFunctionalRequirementChange: (index: number, field: "title" | "description" | "acceptanceCriteria", value: string) => void;
  onAddFunctionalRequirement: () => void;
  onSave: () => Promise<void>;
  onRunReview: () => Promise<void>;
  onSelectReview: (reviewId: string) => void;
  onPreviewPatch: (reviewId: string, target: PatchDocument["target"]) => Promise<void>;
  onSelectPatch: (patchId: string) => void;
  onApplyPatch: () => Promise<void>;
}) {
  const prd = input.prdDraft;

  return (
    <div className="stage-grid">
      <section className="stage-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">PRD</p>
            <h3>直接编辑 PRD 内容</h3>
          </div>
          <div className="panel-actions">
            <button className="ghost-button" onClick={() => void input.onRunReview()} disabled={input.loading || !prd}>运行 PRD 审查</button>
            <button className="primary-button" onClick={() => void input.onSave()} disabled={input.loading || !prd}>保存 PRD</button>
          </div>
        </div>

        {prd ? (
          <div className="document-stack">
            <div className="editor-card">
              <label>标题</label>
              <input value={prd.overview?.title ?? ""} onChange={(event) => input.onOverviewChange("title", event.target.value)} />
            </div>
            <div className="editor-card">
              <label>摘要</label>
              <textarea rows={5} value={prd.overview?.summary ?? ""} onChange={(event) => input.onOverviewChange("summary", event.target.value)} />
            </div>
            <div className="editor-card">
              <label>背景</label>
              <textarea rows={4} value={prd.overview?.background ?? ""} onChange={(event) => input.onOverviewChange("background", event.target.value)} />
            </div>
            <div className="editor-card">
              <label>业务目标</label>
              <textarea rows={4} value={prd.overview?.businessGoal ?? ""} onChange={(event) => input.onOverviewChange("businessGoal", event.target.value)} />
            </div>
            <div className="editor-card">
              <label>成功指标</label>
              <textarea rows={4} value={(prd.overview?.successMetrics ?? []).join("\n")} onChange={(event) => input.onStringListChange("successMetrics", event.target.value)} />
            </div>
            <div className="summary-block">
              <div className="field-head">
                <strong>目标用户</strong>
                <button className="ghost-button" onClick={() => input.onAddTargetUser()}>新增用户</button>
              </div>
              <div className="editor-grid">
                {(prd.targetUsers ?? []).map((user, index) => (
                  <div key={`${user.name}-${index}`} className="editor-card inset">
                    <label>用户名称</label>
                    <input value={user.name} onChange={(event) => input.onTargetUserChange(index, "name", event.target.value)} />
                    <label>需求点</label>
                    <textarea rows={3} value={(user.needs ?? []).join("\n")} onChange={(event) => input.onTargetUserChange(index, "needs", event.target.value)} />
                    <label>场景</label>
                    <textarea rows={3} value={(user.scenarios ?? []).join("\n")} onChange={(event) => input.onTargetUserChange(index, "scenarios", event.target.value)} />
                  </div>
                ))}
              </div>
            </div>
            <div className="summary-block">
              <div className="field-head">
                <strong>功能需求</strong>
                <button className="ghost-button" onClick={() => input.onAddFunctionalRequirement()}>新增功能</button>
              </div>
              <div className="editor-grid">
                {(prd.functionalRequirements ?? []).map((item, index) => (
                  <div key={item.id} className="editor-card inset">
                    <small>{item.id}</small>
                    <label>标题</label>
                    <input value={item.title} onChange={(event) => input.onFunctionalRequirementChange(index, "title", event.target.value)} />
                    <label>描述</label>
                    <textarea rows={4} value={item.description} onChange={(event) => input.onFunctionalRequirementChange(index, "description", event.target.value)} />
                    <label>验收标准</label>
                    <textarea rows={4} value={(item.acceptanceCriteria ?? []).join("\n")} onChange={(event) => input.onFunctionalRequirementChange(index, "acceptanceCriteria", event.target.value)} />
                  </div>
                ))}
              </div>
            </div>
            <div className="editor-card">
              <label>风险</label>
              <textarea rows={4} value={(prd.risks ?? []).join("\n")} onChange={(event) => input.onStringListChange("risks", event.target.value)} />
            </div>
            <div className="editor-card">
              <label>待确认项</label>
              <textarea rows={4} value={(prd.openQuestions ?? []).join("\n")} onChange={(event) => input.onStringListChange("openQuestions", event.target.value)} />
            </div>
          </div>
        ) : (
          <div className="empty-state">先从 Requirement Analysis 推进到 PRD，这里才会出现可编辑的内容结果。</div>
        )}
      </section>

      <section className="stage-panel secondary">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Review & Patch</p>
            <h3>先看问题，再应用修改</h3>
          </div>
        </div>

        <div className="split-stage">
          <div className="side-list">
            {(input.bundle?.artifacts.reviews ?? []).filter((review) => review.stage === "prd" || review.stage === "product_model").map((review) => (
              <button
                key={review.id}
                className={input.selectedReview?.id === review.id ? "side-item active" : "side-item"}
                onClick={() => input.onSelectReview(review.id)}
              >
                <strong>{review.stage}</strong>
                <small>{review.status} · score {review.score}</small>
              </button>
            ))}
          </div>

          <div className="side-detail">
            {input.selectedReview ? (
              <>
                <div className="summary-block">
                  <strong>{input.selectedReview.summary}</strong>
                  {input.selectedReview.blockingReason ? <p>{input.selectedReview.blockingReason}</p> : null}
                </div>

                <div className="finding-list">
                  {input.selectedReview.findings.map((finding) => (
                    <div key={finding.id} className={`finding-card ${finding.severity}`}>
                      <b>{finding.title}</b>
                      <p>{finding.message}</p>
                      {finding.suggestion ? <small>{finding.suggestion}</small> : null}
                    </div>
                  ))}
                </div>

                {input.selectedReview.requiredPatches.length > 0 ? (
                  <div className="summary-block">
                    <strong>可用 patch</strong>
                    <div className="patch-buttons">
                      {input.selectedReview.requiredPatches.map((patch) => (
                        <button
                          key={patch.id}
                          className="ghost-button"
                          onClick={() => void input.onPreviewPatch(input.selectedReview!.id, patch.target)}
                        >
                          {patch.summary ?? patch.id}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {input.selectedPatch ? (
                  <div className="summary-block">
                    <strong>{input.selectedPatch.summary ?? input.selectedPatch.id}</strong>
                    <div className="patch-ops">
                      {input.selectedPatch.operations.map((operation, index) => (
                        <div key={`${operation.path}-${index}`} className="patch-op">
                          <div className="patch-op-head">
                            <b>{operation.op}</b>
                            <span>{operation.path}</span>
                          </div>
                          {operation.reason ? <p>{operation.reason}</p> : null}
                        </div>
                      ))}
                    </div>
                    <button className="primary-button" onClick={() => void input.onApplyPatch()} disabled={input.loading}>应用当前 patch</button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-state">先运行 PRD 审查，系统会在这里给出问题和可应用 patch。</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function renderWireframeStage(input: {
  bundle: ProjectBundle | null;
  wireframeDraft: Wireframe | null;
  annotationDraft: AnnotationDoc | null;
  loading: boolean;
  previewPageId: string;
  wireframeHtml: string;
  onSelectPage: (pageId: string) => void;
  onPageFieldChange: (pageId: string, field: "name" | "purpose" | "layout", value: string) => void;
  onSectionChange: (pageId: string, sectionIndex: number, field: "title" | "objective" | "notes" | "primaryAction", value: string) => void;
  onAddSection: (pageId: string) => void;
  onAnnotationChange: (annotationId: string, field: "kind" | "title" | "description" | "status", value: string) => void;
  onAddAnnotation: (pageId: string) => void;
  onSave: () => Promise<void>;
  onGenerate: () => Promise<void>;
  onAnnotate: () => Promise<void>;
  onCreateTask: (annotationId: string, title: string) => Promise<void>;
}) {
  const wireframe = input.wireframeDraft;
  const annotations = input.annotationDraft?.annotations ?? [];
  const currentPage = wireframe?.pages.find((page) => page.id === input.previewPageId) ?? wireframe?.pages[0] ?? null;
  const pageAnnotations = annotations.filter((annotation) => annotation.pageId === (currentPage?.id ?? ""));

  return (
    <div className="stage-grid">
      <section className="stage-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Wireframe</p>
            <h3>原型稿与页面结构</h3>
          </div>
          <div className="panel-actions">
            <button className="ghost-button" onClick={() => void input.onGenerate()}>生成原型稿</button>
            <button className="ghost-button" onClick={() => void input.onAnnotate()} disabled={!wireframe}>补标注</button>
            <button className="primary-button" onClick={() => void input.onSave()} disabled={!wireframe || input.loading}>保存原型稿</button>
          </div>
        </div>

        {wireframe ? (
          <>
            <div className="page-tabs">
              {wireframe.pages.map((page) => (
                <button
                  key={page.id}
                  className={page.id === input.previewPageId ? "page-tab active" : "page-tab"}
                  onClick={() => input.onSelectPage(page.id)}
                >
                  {page.name}
                </button>
              ))}
            </div>
            <div className="preview-frame">
              {input.wireframeHtml ? <iframe title="wireframe-preview" srcDoc={input.wireframeHtml} /> : <div className="empty-state">选择页面后查看原型稿。</div>}
            </div>
            {currentPage ? (
              <div className="editor-stack">
                <div className="editor-card">
                  <label>页面名称</label>
                  <input value={currentPage.name} onChange={(event) => input.onPageFieldChange(currentPage.id, "name", event.target.value)} />
                </div>
                <div className="editor-card">
                  <label>页面目的</label>
                  <textarea rows={4} value={currentPage.purpose} onChange={(event) => input.onPageFieldChange(currentPage.id, "purpose", event.target.value)} />
                </div>
                <div className="editor-card">
                  <label>页面布局</label>
                  <textarea rows={3} value={currentPage.layout} onChange={(event) => input.onPageFieldChange(currentPage.id, "layout", event.target.value)} />
                </div>
                <div className="summary-block">
                  <div className="field-head">
                    <strong>区块结构</strong>
                    <button className="ghost-button" onClick={() => input.onAddSection(currentPage.id)}>新增区块</button>
                  </div>
                  <div className="editor-grid">
                    {currentPage.sections.map((section, index) => (
                      <div key={section.id} className="editor-card inset">
                        <small>{section.id}</small>
                        <label>区块标题</label>
                        <input value={section.title} onChange={(event) => input.onSectionChange(currentPage.id, index, "title", event.target.value)} />
                        <label>区块目标</label>
                        <textarea rows={3} value={section.objective} onChange={(event) => input.onSectionChange(currentPage.id, index, "objective", event.target.value)} />
                        <label>备注</label>
                        <textarea rows={3} value={(section.notes ?? []).join("\n")} onChange={(event) => input.onSectionChange(currentPage.id, index, "notes", event.target.value)} />
                        <label>主行动</label>
                        <input value={section.primaryAction ?? ""} onChange={(event) => input.onSectionChange(currentPage.id, index, "primaryAction", event.target.value)} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty-state">先生成原型稿，这里会出现页面结构和页面预览。</div>
        )}
      </section>

      <section className="stage-panel secondary">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Annotations</p>
            <h3>带标注的原型说明</h3>
          </div>
        </div>

        {wireframe ? (
          <div className="annotation-list">
            <div className="field-head">
              <strong>当前页面标注</strong>
              {currentPage ? <button className="ghost-button" onClick={() => input.onAddAnnotation(currentPage.id)}>新增标注</button> : null}
            </div>
            {(pageAnnotations.length > 0 ? pageAnnotations : annotations).map((annotation) => (
              <div key={annotation.id} className="annotation-card">
                <div className="field-head">
                  <div>
                    <strong>{annotation.title}</strong>
                    <small>{annotation.kind} · {annotation.pageId}</small>
                  </div>
                  <span className={annotation.status === "resolved" ? "field-badge" : "field-badge required"}>{annotation.status}</span>
                </div>
                <label>类型</label>
                <select value={annotation.kind} onChange={(event) => input.onAnnotationChange(annotation.id, "kind", event.target.value)}>
                  <option value="interaction">interaction</option>
                  <option value="business">business</option>
                  <option value="data">data</option>
                  <option value="review">review</option>
                  <option value="delivery">delivery</option>
                </select>
                <label>标题</label>
                <input value={annotation.title} onChange={(event) => input.onAnnotationChange(annotation.id, "title", event.target.value)} />
                <label>说明</label>
                <textarea rows={4} value={annotation.description} onChange={(event) => input.onAnnotationChange(annotation.id, "description", event.target.value)} />
                <label>状态</label>
                <select value={annotation.status} onChange={(event) => input.onAnnotationChange(annotation.id, "status", event.target.value)}>
                  <option value="open">open</option>
                  <option value="resolved">resolved</option>
                </select>
                <small>linked tasks: {annotation.linkedTaskIds.join(", ") || "none"}</small>
                <button className="ghost-button" onClick={() => void input.onCreateTask(annotation.id, annotation.title)}>从标注创建任务</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">原型稿生成后，这里会显示交互、业务、评审和落地标注。</div>
        )}
      </section>
    </div>
  );
}

function renderUiStage(input: {
  bundle: ProjectBundle | null;
  uiDraft: UiDraft | null;
  loading: boolean;
  previewPageId: string;
  uiHtml: string;
  onSelectPage: (pageId: string) => void;
  onFieldChange: (field: "visualThesis", value: string) => void;
  onInteractionChange: (value: string) => void;
  onDesignStyleChange: (field: "themeName" | "tone" | "fontFamily" | "accentStyle", value: string) => void;
  onColorTokenChange: (token: string, value: string) => void;
  onSave: () => Promise<void>;
  onGenerate: () => Promise<void>;
}) {
  const ui = input.uiDraft;

  return (
    <div className="stage-grid">
      <section className="stage-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">UI Draft</p>
            <h3>图形化 UI 稿</h3>
          </div>
          <div className="panel-actions">
            <button className="primary-button" onClick={() => void input.onGenerate()}>生成图形化 UI 稿</button>
            <button className="ghost-button" onClick={() => void input.onSave()} disabled={!ui || input.loading}>保存 UI Draft</button>
          </div>
        </div>

        {ui ? (
          <>
            <div className="page-tabs">
              {ui.pages.map((page) => (
                <button
                  key={page.pageId}
                  className={page.pageId === input.previewPageId ? "page-tab active" : "page-tab"}
                  onClick={() => input.onSelectPage(page.pageId)}
                >
                  {page.name}
                </button>
              ))}
            </div>
            <div className="preview-frame ui-frame">
              {input.uiHtml ? <iframe title="ui-preview" srcDoc={input.uiHtml} /> : <div className="empty-state">选择页面后查看 UI 稿。</div>}
            </div>
          </>
        ) : (
          <div className="empty-state">这里应该是像 Stitch 那样的图形化页面结果，而不是一段 UI 说明文本。</div>
        )}
      </section>

      <section className="stage-panel secondary">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Design Intent</p>
            <h3>当前 UI 设计方向</h3>
          </div>
        </div>

        {ui ? (
          <div className="document-stack">
            <div className="editor-card">
              <label>视觉命题</label>
              <textarea rows={5} value={ui.visualThesis} onChange={(event) => input.onFieldChange("visualThesis", event.target.value)} />
            </div>
            <div className="editor-card">
              <label>交互原则</label>
              <textarea rows={5} value={ui.interactionThesis.join("\n")} onChange={(event) => input.onInteractionChange(event.target.value)} />
            </div>
            <div className="editor-card">
              <label>主题名</label>
              <input value={ui.designStyle.themeName} onChange={(event) => input.onDesignStyleChange("themeName", event.target.value)} />
            </div>
            <div className="editor-card">
              <label>风格语气</label>
              <textarea rows={4} value={ui.designStyle.tone} onChange={(event) => input.onDesignStyleChange("tone", event.target.value)} />
            </div>
            <div className="editor-grid">
              <div className="editor-card inset">
                <label>字体</label>
                <input value={ui.designStyle.fontFamily} onChange={(event) => input.onDesignStyleChange("fontFamily", event.target.value)} />
              </div>
              <div className="editor-card inset">
                <label>强调风格</label>
                <input value={ui.designStyle.accentStyle} onChange={(event) => input.onDesignStyleChange("accentStyle", event.target.value)} />
              </div>
            </div>
            <div className="summary-block">
              <strong>Color Tokens</strong>
              <div className="editor-grid">
                {Object.entries(ui.designStyle.colorTokens).map(([token, value]) => (
                  <div key={token} className="editor-card inset">
                    <label>{token}</label>
                    <input value={value} onChange={(event) => input.onColorTokenChange(token, event.target.value)} />
                  </div>
                ))}
              </div>
            </div>
            <div className="summary-note">
              <b>继续修改方式</b>
              <p>直接在右侧聊天区说布局、风格、组件和层级要求，系统会立即回写到当前 UI Draft。</p>
            </div>
          </div>
        ) : (
          <div className="empty-state">UI 稿生成后，这里展示设计方向、交互要点和可继续修改的重点。</div>
        )}
      </section>
    </div>
  );
}

function renderClarifyInput(
  question: ClarifyQuestion,
  value: string,
  onChange: (value: string) => void
) {
  if ((question.answerFormat === "single_select" || question.answerFormat === "boolean") && question.suggestedOptions.length > 0) {
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择</option>
        {question.suggestedOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  return (
    <textarea
      rows={question.answerFormat === "multi_select" ? 4 : 5}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={question.answerFormat === "multi_select" ? "一行一个，或逗号分隔" : "输入当前阶段内容"}
    />
  );
}

function stringifyAnswer(value: unknown, answerFormat: ClarifyQuestion["answerFormat"]) {
  if (value === null || value === undefined) {
    return "";
  }
  if (answerFormat === "multi_select" && Array.isArray(value)) {
    return value.map(String).join("\n");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function parseLines(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAnswerInput(value: string, answerFormat: ClarifyQuestion["answerFormat"]) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (answerFormat === "multi_select") {
    return trimmed.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  }
  if (answerFormat === "number") {
    return Number(trimmed);
  }
  if (answerFormat === "boolean") {
    return trimmed === "true" || trimmed === "是";
  }
  if (answerFormat === "json") {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function formatAnswer(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(String).join("、");
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function panelLabel(panel: WorkspacePanel) {
  switch (panel) {
    case "capture":
      return "需求采集";
    case "structure":
      return "需求结构化";
    case "clarify":
      return "需求澄清 / 补全";
    case "model":
      return "产品模型";
    case "prd":
      return "PRD";
    case "wireframe":
      return "原型";
    case "annotation":
      return "原型标注";
    case "ui":
      return "UI Draft";
    case "review":
      return "Review / Diff / 回滚";
  }
}

function panelToStage(panel: WorkspacePanel): StageTab | null {
  switch (panel) {
    case "capture":
    case "structure":
    case "clarify":
    case "model":
    case "review":
      return "analysis";
    case "prd":
      return "prd";
    case "wireframe":
    case "annotation":
      return "wireframe";
    case "ui":
      return "ui";
  }
}

function inferStage(bundle: ProjectBundle): StageTab {
  if (bundle.artifacts.ui) {
    return "ui";
  }
  if (bundle.artifacts.wireframe) {
    return "wireframe";
  }
  if (bundle.artifacts.prd) {
    return "prd";
  }
  return "analysis";
}

function inferPanel(bundle: ProjectBundle): WorkspacePanel {
  if (bundle.artifacts.ui) {
    return "ui";
  }
  if (bundle.artifacts.annotations) {
    return "annotation";
  }
  if (bundle.artifacts.wireframe) {
    return "wireframe";
  }
  if (bundle.artifacts.prd) {
    return "prd";
  }
  if (bundle.artifacts.productModel) {
    return "model";
  }
  if (bundle.artifacts.clarify) {
    return bundle.artifacts.clarify.gating.isSatisfied ? "structure" : "clarify";
  }
  return "capture";
}

function stageLabel(stage: StageTab) {
  switch (stage) {
    case "analysis":
      return "Requirement Analysis";
    case "prd":
      return "PRD";
    case "wireframe":
      return "Wireframe";
    case "ui":
      return "UI Draft";
  }
}

function buildStageNodes(bundle: ProjectBundle | null) {
  const latestReview = bundle?.artifacts.reviews.at(-1) ?? null;
  return [
    {
      id: "capture" as const,
      name: "需求采集",
      description: "输入一句话需求或上传文档",
      status: bundle?.requirement.rawContent ? "pass" : "warning",
      statusLabel: bundle?.requirement.rawContent ? "已记录" : "待开始"
    },
    {
      id: "structure" as const,
      name: "需求结构",
      description: "整理用户目标、场景、功能点",
      status: bundle?.artifacts.clarify ? "pass" : "warning",
      statusLabel: bundle?.artifacts.clarify ? "已生成" : "待生成"
    },
    {
      id: "clarify" as const,
      name: "需求澄清",
      description: "补全缺失信息并 review",
      status: bundle?.artifacts.clarify
        ? bundle.artifacts.clarify.gating.isSatisfied ? "pass" : "block"
        : "warning",
      statusLabel: bundle?.artifacts.clarify
        ? bundle.artifacts.clarify.gating.isSatisfied ? "通过" : "待补全"
        : "待开始"
    },
    {
      id: "model" as const,
      name: "产品模型",
      description: "统一用户、功能、流程、页面",
      status: bundle?.artifacts.productModel ? "pass" : "warning",
      statusLabel: bundle?.artifacts.productModel ? "已输出" : "待生成"
    },
    {
      id: "prd" as const,
      name: "PRD",
      description: "正式产品需求文档",
      status: bundle?.artifacts.prd ? "pass" : "warning",
      statusLabel: bundle?.artifacts.prd ? "可编辑" : "待生成"
    },
    {
      id: "wireframe" as const,
      name: "原型",
      description: "页面结构与交互骨架",
      status: bundle?.artifacts.wireframe ? "pass" : "warning",
      statusLabel: bundle?.artifacts.wireframe ? "已生成" : "待生成"
    },
    {
      id: "annotation" as const,
      name: "原型标注",
      description: "交互、业务、数据、评审标注",
      status: bundle?.artifacts.annotations?.annotations?.length ? "pass" : "warning",
      statusLabel: bundle?.artifacts.annotations?.annotations?.length ? "已标注" : "待标注"
    },
    {
      id: "ui" as const,
      name: "UI Draft",
      description: "高保真视觉稿 / 图形化 UI",
      status: bundle?.artifacts.ui ? "pass" : "warning",
      statusLabel: bundle?.artifacts.ui ? "已生成" : "待生成"
    },
    {
      id: "review" as const,
      name: "Review / Diff",
      description: "审查、差异、回滚",
      status: latestReview ? latestReview.status : "warning",
      statusLabel: latestReview ? `${latestReview.stage} ${latestReview.status}` : "待审查"
    }
  ];
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const data = await response.json() as { message?: string; missingFieldKeys?: string[] };
      message = data.message ?? message;
      if (data.missingFieldKeys?.length) {
        message = `${message} (${data.missingFieldKeys.join(", ")})`;
      }
    } catch {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
