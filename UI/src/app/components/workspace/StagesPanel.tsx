import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type {
  RequirementCollectionArtifactContent,
  RequirementCollectionVersion,
  RequirementSourceRecord,
  RequirementStructure,
  RequirementStructureVersion,
  Stage,
  StageDocument,
  StageDocumentVersion,
  StageType,
  UploadedSourceFile
} from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Separator } from "../ui/separator";
import {
  AlertCircle,
  Bold,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Heading1,
  Heading2,
  History,
  List,
  ListOrdered,
  Loader2,
  MoreHorizontal,
  PencilLine,
  Plus,
  Quote,
  Redo2,
  RotateCcw,
  Save,
  Sparkles,
  SplitSquareVertical,
  Trash2,
  Undo2,
  Upload,
  WandSparkles
} from "lucide-react";
import { toast } from "sonner";
import {
  createRequirementSourceRecord,
  deleteRequirementSourceRecord,
  generateRequirementStructure,
  generateWorkspaceStageDocument,
  getRequirementDocumentHistory,
  getRequirementStructureHistory,
  getWorkspaceSourceFileUrl,
  getWorkspaceStageDocumentHistory,
  organizeRequirementDocument,
  rollbackRequirementDocumentVersion,
  rollbackRequirementStructureVersion,
  rollbackWorkspaceStage,
  rollbackWorkspaceStageDocumentVersion,
  saveRequirementDocument,
  saveRequirementStructureDocument,
  saveWorkspaceStageDocument,
  updateRequirementSourceRecord,
  WorkspaceBundleResponse
} from "../../utils/workspace-api";

interface StagesPanelProps {
  projectId: string;
  stages: Stage[];
  currentStage: StageType;
  onBundleUpdate: (bundle: WorkspaceBundleResponse) => void;
  onRefresh: () => void | Promise<void>;
}

type PrimaryStageType =
  | "requirement-collection"
  | "requirement-structure"
  | "requirement-clarification"
  | "product-model"
  | "prd"
  | "prototype";

type HistoryVersion = RequirementCollectionVersion | RequirementStructureVersion | StageDocumentVersion;

const PRIMARY_STAGE_ORDER: PrimaryStageType[] = [
  "requirement-collection",
  "requirement-structure",
  "requirement-clarification",
  "product-model",
  "prd",
  "prototype"
];

const STAGE_LABELS: Record<PrimaryStageType, string> = {
  "requirement-collection": "需求整理",
  "requirement-structure": "需求结构化",
  "requirement-clarification": "需求澄清",
  "product-model": "产品模型",
  "prd": "PRD",
  "prototype": "原型"
};

const STAGE_DESCRIPTIONS: Record<PrimaryStageType, string> = {
  "requirement-collection": "把聊天、评论和上传资料整理成第一份正式需求文档。",
  "requirement-structure": "把需求整理文档提炼成目标、用户、场景、功能和边界等结构化输入。",
  "requirement-clarification": "找出还不清楚的点，沉淀已确认项、待确认项、假设和 blocker。",
  "product-model": "把需求结果转成产品骨架，包括模块、页面、流程和信息架构。",
  "prd": "形成正式产品需求文档，作为评审和交付依据。",
  "prototype": "把产品模型和 PRD 转成页面结构和交互表达。"
};

const NEXT_GENERATION_ACTION: Partial<Record<PrimaryStageType, { target: PrimaryStageType; label: string }>> = {
  "requirement-collection": { target: "requirement-structure", label: "生成需求结构化" },
  "requirement-structure": { target: "requirement-clarification", label: "生成需求澄清" },
  "requirement-clarification": { target: "product-model", label: "生成产品模型" },
  "product-model": { target: "prd", label: "生成 PRD" },
  "prd": { target: "prototype", label: "生成原型" }
};

export function StagesPanel({ projectId, stages, currentStage, onBundleUpdate, onRefresh }: StagesPanelProps) {
  const [selectedStageType, setSelectedStageType] = useState<PrimaryStageType | null>(null);
  const [showWorkspaceDialog, setShowWorkspaceDialog] = useState(false);
  const [editableDocument, setEditableDocument] = useState("");
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [isSavingDoc, setIsSavingDoc] = useState(false);
  const [isGenerating, setIsGenerating] = useState<PrimaryStageType | null>(null);
  const [historyVersions, setHistoryVersions] = useState<HistoryVersion[]>([]);
  const [diffVersionId, setDiffVersionId] = useState<string | null>(null);
  const [isRollingBackVersion, setIsRollingBackVersion] = useState<string | null>(null);
  const [sourceRecordDraft, setSourceRecordDraft] = useState("");
  const [replyingToRecord, setReplyingToRecord] = useState<RequirementSourceRecord | null>(null);
  const [editingSourceRecord, setEditingSourceRecord] = useState<RequirementSourceRecord | null>(null);
  const [deletingSourceRecord, setDeletingSourceRecord] = useState<RequirementSourceRecord | null>(null);
  const [isSavingSourceRecord, setIsSavingSourceRecord] = useState(false);
  const [previewFile, setPreviewFile] = useState<UploadedSourceFile | null>(null);
  const [isSourceSidebarCollapsed, setIsSourceSidebarCollapsed] = useState(false);
  const [selectedPrototypePageIndex, setSelectedPrototypePageIndex] = useState(0);
  const [shouldFocusSourceComposer, setShouldFocusSourceComposer] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const sourceRecordTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const primaryStages = useMemo(
    () => PRIMARY_STAGE_ORDER.map((stageType) => stages.find((stage) => stage.type === stageType)).filter(Boolean) as Stage[],
    [stages]
  );

  const selectedStage = useMemo(
    () => primaryStages.find((stage) => stage.type === selectedStageType) ?? null,
    [primaryStages, selectedStageType]
  );

  const selectedArtifact = selectedStage?.artifacts[0] ?? null;
  const selectedCollection = selectedArtifact?.type === "requirement-input" ? selectedArtifact.content as RequirementCollectionArtifactContent : null;
  const selectedStructure = selectedArtifact?.type === "requirement-structure" ? selectedArtifact.content as RequirementStructure : null;
  const selectedStageDocument = selectedArtifact && ["clarification-qa", "product-model", "prd-document", "prototype-canvas"].includes(selectedArtifact.type)
    ? selectedArtifact.content as StageDocument
    : null;

  const previewUrl = previewFile ? getWorkspaceSourceFileUrl(projectId, previewFile.id) : "";
  const canInlinePreview = previewFile
    ? previewFile.mimeType.startsWith("text/")
      || previewFile.mimeType === "application/pdf"
      || previewFile.mimeType.startsWith("image/")
      || previewFile.name.endsWith(".md")
      || previewFile.name.endsWith(".txt")
      || previewFile.name.endsWith(".json")
      || previewFile.name.endsWith(".csv")
    : false;

  useEffect(() => {
    if (selectedArtifact?.type === "requirement-input") {
      setEditableDocument(selectedCollection?.requirementsDocumentHtml ?? "");
    } else if (selectedArtifact?.type === "requirement-structure") {
      setEditableDocument(selectedStructure?.documentHtml ?? "");
    } else if (selectedStageDocument) {
      setEditableDocument(selectedStageDocument.documentHtml ?? "");
    } else {
      setEditableDocument("");
    }
    setEditorMode("edit");
    setDiffVersionId(null);
    setSelectedPrototypePageIndex(0);
  }, [selectedArtifact?.id, selectedStageDocument?.documentHtml, selectedCollection?.requirementsDocumentHtml, selectedStructure?.documentHtml]);

  useEffect(() => {
    if (editorMode !== "edit") {
      return;
    }

    if (editorRef.current && editorRef.current.innerHTML !== editableDocument) {
      editorRef.current.innerHTML = editableDocument;
    }
  }, [editableDocument, editorMode, selectedArtifact?.id]);

  useEffect(() => {
    if (!selectedStageType || !showWorkspaceDialog) {
      setHistoryVersions([]);
      return;
    }

    void loadHistory(selectedStageType);
  }, [selectedStageType, showWorkspaceDialog]);

  useEffect(() => {
    if (!showWorkspaceDialog || selectedStageType !== "requirement-collection" || !shouldFocusSourceComposer) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setIsSourceSidebarCollapsed(false);
      sourceRecordTextareaRef.current?.focus();
      setShouldFocusSourceComposer(false);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [showWorkspaceDialog, selectedStageType, shouldFocusSourceComposer]);

  const loadHistory = async (stageType: PrimaryStageType) => {
    try {
      if (stageType === "requirement-collection") {
        setHistoryVersions(await getRequirementDocumentHistory(projectId));
        return;
      }

      if (stageType === "requirement-structure") {
        setHistoryVersions(await getRequirementStructureHistory(projectId));
        return;
      }

      setHistoryVersions(await getWorkspaceStageDocumentHistory(projectId, stageType));
    } catch {
      setHistoryVersions([]);
    }
  };

  const getStatusBadge = (status: Stage["status"]) => {
    if (status === "completed") {
      return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">已完成</Badge>;
    }
    if (status === "pending-review") {
      return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">待确认</Badge>;
    }
    if (status === "in-progress") {
      return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">进行中</Badge>;
    }
    return <Badge variant="outline">未开始</Badge>;
  };

  const openStageWorkspace = (stageType: PrimaryStageType) => {
    setSelectedStageType(stageType);
    setShowWorkspaceDialog(true);
  };

  const openRequirementRecordComposer = () => {
    setSelectedStageType("requirement-collection");
    setShowWorkspaceDialog(true);
    setShouldFocusSourceComposer(true);
  };

  const handleGenerateStage = async (targetStage: PrimaryStageType) => {
    try {
      setIsGenerating(targetStage);
      const bundle = targetStage === "requirement-structure"
        ? await generateRequirementStructure(projectId)
        : await generateWorkspaceStageDocument(projectId, targetStage);
      onBundleUpdate(bundle);
      toast.success(`${STAGE_LABELS[targetStage]}已生成`);
      if (selectedStageType === targetStage) {
        await loadHistory(targetStage);
      }
      await Promise.resolve(onRefresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成失败");
    } finally {
      setIsGenerating(null);
    }
  };

  const handleRollbackStage = async (stageType: PrimaryStageType) => {
    try {
      const bundle = await rollbackWorkspaceStage(projectId, stageType);
      onBundleUpdate(bundle);
      toast.success(`已回到${STAGE_LABELS[stageType]}阶段`);
      await Promise.resolve(onRefresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "阶段回退失败");
    }
  };

  const handleSaveDocument = async () => {
    if (!selectedStageType) {
      return;
    }

    try {
      setIsSavingDoc(true);
      const bundle = selectedStageType === "requirement-collection"
        ? await saveRequirementDocument(projectId, editableDocument)
        : selectedStageType === "requirement-structure"
        ? await saveRequirementStructureDocument(projectId, editableDocument)
        : await saveWorkspaceStageDocument(projectId, selectedStageType, editableDocument);
      onBundleUpdate(bundle);
      toast.success(`${STAGE_LABELS[selectedStageType]}已保存`);
      await loadHistory(selectedStageType);
      await Promise.resolve(onRefresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSavingDoc(false);
    }
  };

  const handleOrganizeRequirementDocument = async () => {
    try {
      setIsGenerating("requirement-collection");
      const bundle = await organizeRequirementDocument(projectId);
      onBundleUpdate(bundle);
      toast.success("需求整理文档已重新整理");
      await loadHistory("requirement-collection");
      await Promise.resolve(onRefresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "整理失败");
    } finally {
      setIsGenerating(null);
    }
  };

  const handleRollbackVersion = async (versionId: string) => {
    if (!selectedStageType) {
      return;
    }

    try {
      setIsRollingBackVersion(versionId);
      const bundle = selectedStageType === "requirement-collection"
        ? await rollbackRequirementDocumentVersion(projectId, versionId)
        : selectedStageType === "requirement-structure"
        ? await rollbackRequirementStructureVersion(projectId, versionId)
        : await rollbackWorkspaceStageDocumentVersion(projectId, selectedStageType, versionId);
      onBundleUpdate(bundle);
      toast.success("已回滚到所选历史版本");
      await loadHistory(selectedStageType);
      await Promise.resolve(onRefresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "回滚版本失败");
    } finally {
      setIsRollingBackVersion(null);
    }
  };

  const applyEditorCommand = (
    command: "bold" | "italic" | "insertUnorderedList" | "insertOrderedList" | "formatBlock" | "undo" | "redo",
    value?: string
  ) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setEditableDocument(editorRef.current?.innerHTML ?? "");
  };

  const renderDiffBlocks = (currentText: string, previousText: string) => {
    const currentLines = currentText.split("\n");
    const previousLines = previousText.split("\n");
    const max = Math.max(currentLines.length, previousLines.length);

    return Array.from({ length: max }, (_, index) => {
      const currentLine = currentLines[index] ?? "";
      const previousLine = previousLines[index] ?? "";
      if (currentLine === previousLine) {
        return { type: "same" as const, text: currentLine };
      }
      if (!previousLine && currentLine) {
        return { type: "added" as const, text: currentLine };
      }
      if (previousLine && !currentLine) {
        return { type: "removed" as const, text: previousLine };
      }
      return { type: "changed" as const, text: `旧：${previousLine}\n新：${currentLine}` };
    }).filter((block) => block.text.trim().length > 0);
  };

  const startReplyToSourceRecord = (record: RequirementSourceRecord) => {
    setReplyingToRecord(record);
    setEditingSourceRecord(null);
    setSourceRecordDraft("");
  };

  const startEditSourceRecord = (record: RequirementSourceRecord) => {
    setEditingSourceRecord(record);
    setReplyingToRecord(record.parentId ? null : replyingToRecord);
    setSourceRecordDraft(record.content);
  };

  const resetSourceRecordComposer = () => {
    setSourceRecordDraft("");
    setReplyingToRecord(null);
    setEditingSourceRecord(null);
  };

  const handleSaveSourceRecord = async () => {
    const content = sourceRecordDraft.trim();
    if (!content) {
      toast.info("先输入一条需求点记录");
      return;
    }

    try {
      setIsSavingSourceRecord(true);
      const bundle = editingSourceRecord
        ? await updateRequirementSourceRecord(projectId, editingSourceRecord.id, content)
        : await createRequirementSourceRecord(projectId, { content, parentId: replyingToRecord?.id });
      onBundleUpdate(bundle);
      resetSourceRecordComposer();
      toast.success(editingSourceRecord ? "记录已更新" : replyingToRecord ? "回复已保存" : "记录已保存");
      await loadHistory("requirement-collection");
      await Promise.resolve(onRefresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存记录失败");
    } finally {
      setIsSavingSourceRecord(false);
    }
  };

  const handleDeleteSourceRecord = async () => {
    if (!deletingSourceRecord) {
      return;
    }

    try {
      setIsSavingSourceRecord(true);
      const bundle = await deleteRequirementSourceRecord(projectId, deletingSourceRecord.id);
      onBundleUpdate(bundle);
      setDeletingSourceRecord(null);
      toast.success("记录已删除");
      await Promise.resolve(onRefresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除记录失败");
    } finally {
      setIsSavingSourceRecord(false);
    }
  };

  const renderSourceRecordThread = (records: RequirementSourceRecord[], record: RequirementSourceRecord, depth = 0): ReactNode => {
    const replies = records.filter((item) => item.parentId === record.id);

    return (
      <div key={record.id} className="space-y-2">
        <div className={`rounded-lg border border-[var(--color-border)] bg-white p-3 ${depth > 0 ? "ml-6" : ""}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="whitespace-pre-wrap text-sm leading-6">{record.content}</div>
              <div className="mt-2 text-xs text-[var(--color-text-secondary)]">
                {new Date(record.updatedAt).toLocaleString()}
                {record.updatedAt !== record.createdAt ? " · 已编辑" : ""}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="size-8 shrink-0">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => startReplyToSourceRecord(record)}>回复</DropdownMenuItem>
                <DropdownMenuItem onClick={() => startEditSourceRecord(record)}>编辑</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDeletingSourceRecord(record)}>删除</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {replies.length > 0 ? <div className="space-y-2">{replies.map((reply) => renderSourceRecordThread(records, reply, depth + 1))}</div> : null}
      </div>
    );
  };

  const getCurrentStageDescription = (stageType: PrimaryStageType) => {
    if (stageType === "requirement-collection") {
      return "这一阶段负责把散乱来源整理成第一份正式需求文档。";
    }
    if (stageType === "requirement-structure") {
      return "这一阶段负责把需求整理文档提炼成目标、用户、场景、功能和边界。";
    }
    return STAGE_DESCRIPTIONS[stageType];
  };

  const getWorkspaceDocumentHtml = () => {
    if (selectedStageType === "requirement-collection") {
      return selectedCollection?.requirementsDocumentHtml ?? "";
    }
    if (selectedStageType === "requirement-structure") {
      return selectedStructure?.documentHtml ?? "";
    }
    return selectedStageDocument?.documentHtml ?? "";
  };

  const getWorkspaceDocumentMarkdown = () => {
    if (selectedStageType === "requirement-collection") {
      return selectedCollection?.requirementsDocument ?? "";
    }
    if (selectedStageType === "requirement-structure") {
      return selectedStructure?.documentMarkdown ?? "";
    }
    return selectedStageDocument?.documentMarkdown ?? "";
  };

  const selectedHistoryVersion = diffVersionId
    ? historyVersions.find((item) => item.id === diffVersionId) ?? null
    : null;

  const diffBlocks = selectedHistoryVersion
    ? renderDiffBlocks(getWorkspaceDocumentMarkdown(), selectedHistoryVersion.documentMarkdown)
    : [];

  const renderStageWorkspaceHeaderActions = () => {
    if (!selectedStageType) {
      return null;
    }

    const nextAction = NEXT_GENERATION_ACTION[selectedStageType];
    return (
      <div className="flex items-center gap-2">
        {selectedStageType === "requirement-collection" ? (
          <Button size="sm" variant="outline" onClick={handleOrganizeRequirementDocument} disabled={isGenerating === "requirement-collection"}>
            {isGenerating === "requirement-collection" ? <Loader2 className="mr-1 size-4 animate-spin" /> : <WandSparkles className="mr-1 size-4" />}
            AI 整理
          </Button>
        ) : null}
        {nextAction ? (
          <Button
            size="sm"
            onClick={() => handleGenerateStage(nextAction.target)}
            disabled={isGenerating === nextAction.target}
          >
            {isGenerating === nextAction.target ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Sparkles className="mr-1 size-4" />}
            {nextAction.label}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={handleSaveDocument} disabled={isSavingDoc}>
          {isSavingDoc ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Save className="mr-1 size-4" />}
          保存
        </Button>
      </div>
    );
  };

  const renderEditorToolbar = () => (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-6 py-3">
      <Button size="icon" variant="ghost" onClick={() => applyEditorCommand("undo")}><Undo2 className="size-4" /></Button>
      <Button size="icon" variant="ghost" onClick={() => applyEditorCommand("redo")}><Redo2 className="size-4" /></Button>
      <Separator orientation="vertical" className="mx-1 h-6" />
      <Button size="icon" variant="ghost" onClick={() => applyEditorCommand("bold")}><Bold className="size-4" /></Button>
      <Button size="icon" variant="ghost" onClick={() => applyEditorCommand("italic")}><PencilLine className="size-4" /></Button>
      <Button size="icon" variant="ghost" onClick={() => applyEditorCommand("formatBlock", "<h1>")}><Heading1 className="size-4" /></Button>
      <Button size="icon" variant="ghost" onClick={() => applyEditorCommand("formatBlock", "<h2>")}><Heading2 className="size-4" /></Button>
      <Button size="icon" variant="ghost" onClick={() => applyEditorCommand("insertUnorderedList")}><List className="size-4" /></Button>
      <Button size="icon" variant="ghost" onClick={() => applyEditorCommand("insertOrderedList")}><ListOrdered className="size-4" /></Button>
      <Button size="icon" variant="ghost" onClick={() => applyEditorCommand("formatBlock", "<blockquote>")}><Quote className="size-4" /></Button>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant={editorMode === "edit" ? "default" : "outline"} onClick={() => setEditorMode("edit")}>编辑</Button>
        <Button size="sm" variant={editorMode === "preview" ? "default" : "outline"} onClick={() => setEditorMode("preview")}><SplitSquareVertical className="mr-1 size-4" />预览</Button>
      </div>
    </div>
  );

  const renderWorkspaceMain = () => {
    if (!selectedStageType) {
      return null;
    }

    const emptyState = !selectedArtifact;
    if (emptyState) {
      const nextAction = selectedStageType === "requirement-collection"
        ? null
        : selectedStageType === "requirement-structure"
        ? { label: "生成需求结构化", target: "requirement-structure" as PrimaryStageType }
        : { label: `生成${STAGE_LABELS[selectedStageType]}`, target: selectedStageType };

      return (
        <div className="flex h-full items-center justify-center px-10">
          <div className="max-w-xl space-y-4 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-[var(--color-muted)]">
              <FileText className="size-8 text-[var(--color-text-secondary)]" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold">{STAGE_LABELS[selectedStageType]}还没有正式产物</h3>
              <p className="text-sm leading-6 text-[var(--color-text-secondary)]">{getCurrentStageDescription(selectedStageType)}</p>
            </div>
            {nextAction ? (
              <Button onClick={() => handleGenerateStage(nextAction.target)} disabled={isGenerating === nextAction.target}>
                {isGenerating === nextAction.target ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Sparkles className="mr-1 size-4" />}
                {nextAction.label}
              </Button>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 min-w-0">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-4">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">{selectedArtifact.name}</h3>
              <p className="text-sm text-[var(--color-text-secondary)]">{getCurrentStageDescription(selectedStageType)}</p>
            </div>
            {renderStageWorkspaceHeaderActions()}
          </div>
          {renderEditorToolbar()}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {editorMode === "edit" ? (
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                dangerouslySetInnerHTML={{ __html: editableDocument }}
                onInput={(event) => setEditableDocument((event.target as HTMLDivElement).innerHTML)}
                className="min-h-full rounded-xl border border-[var(--color-border)] bg-white p-6 text-sm leading-7 outline-none"
              />
            ) : selectedStageType === "prototype" && selectedStageDocument ? (
              renderPrototypePreview(selectedStageDocument)
            ) : (
              <div
                className="prose prose-sm max-w-none rounded-xl border border-[var(--color-border)] bg-white p-6"
                dangerouslySetInnerHTML={{ __html: editableDocument }}
              />
            )}
          </div>
        </div>
        {selectedStageType === "requirement-collection"
          ? renderCollectionSidebar()
          : renderHistorySidebar()
        }
      </div>
    );
  };

  const renderCollectionSidebar = () => {
    const records = selectedCollection?.sourceRecords ?? [];
    const topLevelRecords = records.filter((record) => !record.parentId);
    const files = selectedCollection?.uploadedFiles ?? [];

    return (
      <>
        <div
          className={`relative shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] transition-all duration-200 ${
            isSourceSidebarCollapsed ? "w-0 overflow-hidden border-l-0" : "w-[360px]"
          }`}
        >
          {!isSourceSidebarCollapsed ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-start justify-between border-b border-[var(--color-border)] px-4 py-3">
                <div style={{ display: 'none' }}>
                  <div className="text-sm font-semibold">来源与版本</div>
                  <div className="text-xs text-[var(--color-text-secondary)]">需求点记录、上传文件和文档历史</div>
                </div>
                <Button size="icon" variant="ghost" className="size-8" onClick={() => setIsSourceSidebarCollapsed(true)}>
                  <ChevronRight className="size-4" />
                </Button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }} className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto_minmax(0,220px)]">
                <ScrollArea style={{ flex: 1 }} className="min-h-0">
                  <div className="space-y-6 p-4">
                    <section className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">需求点记录</div>
                        <Badge variant="outline">{records.length}</Badge>
                      </div>
                      <div className="space-y-3">
                        {topLevelRecords.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-secondary)]">
                            还没有需求点记录，可以在这里补一条来源。
                          </div>
                        ) : topLevelRecords.map((record) => renderSourceRecordThread(records, record))}
                      </div>
                    </section>

                    <section className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">上传文件</div>
                        <Badge variant="outline">{files.length}</Badge>
                      </div>
                      <div className="space-y-2">
                        {files.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-secondary)]">
                            暂无上传文件。
                          </div>
                        ) : files.map((file) => (
                          <button
                            key={file.id}
                            type="button"
                            className="w-full rounded-lg border border-[var(--color-border)] bg-white p-3 text-left transition-colors hover:border-[var(--color-accent)]"
                            onClick={() => setPreviewFile(file)}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{file.name}</div>
                                <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                                  {Math.max(1, Math.round(file.size / 1024))} KB · {file.extractionStatus === "parsed" ? "可预览" : "保留文件"}
                                </div>
                              </div>
                              <Eye className="size-4 text-[var(--color-text-secondary)]" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                </ScrollArea>

                <div className="border-t border-[var(--color-border)] bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold">
                      {editingSourceRecord ? "编辑需求点记录" : replyingToRecord ? "回复记录" : "新增需求点记录"}
                    </div>
                    {(replyingToRecord || editingSourceRecord || sourceRecordDraft) ? (
                      <Button size="sm" variant="ghost" onClick={resetSourceRecordComposer}>
                        取消
                      </Button>
                    ) : null}
                  </div>
                  <textarea
                    ref={sourceRecordTextareaRef}
                    value={sourceRecordDraft}
                    onChange={(event) => setSourceRecordDraft(event.target.value)}
                    className="min-h-[96px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none"
                    placeholder="记录一条新的需求点、评论或补充说明..."
                  />
                  <div className="mt-3 flex justify-end">
                    <Button onClick={handleSaveSourceRecord} disabled={isSavingSourceRecord}>
                      {isSavingSourceRecord ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Plus className="mr-1 size-4" />}
                      保存记录
                    </Button>
                  </div>
                </div>

                <div style={{ display: "none" }} className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold">历史版本</div>
                    <History className="size-4 text-[var(--color-text-secondary)]" />
                  </div>
                  <div className="space-y-2 overflow-y-auto">
                    {historyVersions.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-secondary)]">
                        当前还没有历史版本。
                      </div>
                    ) : historyVersions.slice(0, 4).map((version) => (
                      <div key={version.id} className="rounded-lg border border-[var(--color-border)] bg-white p-3">
                        <div className="text-sm font-medium">{version.summary}</div>
                        <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                          {new Date(version.createdAt).toLocaleString()}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <Button size="sm" variant={diffVersionId === version.id ? "default" : "outline"} onClick={() => setDiffVersionId((current) => current === version.id ? null : version.id)}>
                            对比
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleRollbackVersion(version.id)} disabled={isRollingBackVersion === version.id}>
                            {isRollingBackVersion === version.id ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {isSourceSidebarCollapsed ? (
          <button
            type="button"
            onClick={() => setIsSourceSidebarCollapsed(false)}
            className="absolute right-4 top-24 z-20 rounded-full border border-[var(--color-border)] bg-white p-2 shadow-sm transition-colors hover:border-[var(--color-accent)]"
          >
            <ChevronLeft className="size-4" />
          </button>
        ) : null}
      </>
    );
  };

  const renderHistorySidebar = () => (
    <div className="w-[340px] shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div>
          <div className="text-sm font-semibold">历史版本</div>
          <div className="text-xs text-[var(--color-text-secondary)]">查看、对比并回滚当前阶段文档</div>
        </div>
        <History className="size-4 text-[var(--color-text-secondary)]" />
      </div>
      <div className="grid h-[calc(100%-57px)] grid-rows-[minmax(0,1fr)_220px]">
        <ScrollArea className="min-h-0">
          <div className="space-y-3 p-4">
            {historyVersions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-secondary)]">
                当前还没有历史版本。
              </div>
            ) : historyVersions.map((version) => (
              <div key={version.id} className="rounded-lg border border-[var(--color-border)] bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{version.summary}</div>
                    <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      {new Date(version.createdAt).toLocaleString()} · {version.source}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant={diffVersionId === version.id ? "default" : "outline"} onClick={() => setDiffVersionId((current) => current === version.id ? null : version.id)}>
                      对比
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleRollbackVersion(version.id)} disabled={isRollingBackVersion === version.id}>
                      {isRollingBackVersion === version.id ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="border-t border-[var(--color-border)] bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <SplitSquareVertical className="size-4" />
            版本差异
          </div>
          <div className="h-[160px] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs leading-6">
            {diffBlocks.length === 0 ? (
              <div className="text-[var(--color-text-secondary)]">选择一个历史版本查看差异。</div>
            ) : diffBlocks.map((block, index) => (
              <div
                key={`${block.type}-${index}`}
                className={
                  block.type === "added"
                    ? "rounded bg-emerald-50 px-2 py-1 text-emerald-700"
                    : block.type === "removed"
                    ? "rounded bg-rose-50 px-2 py-1 text-rose-700"
                    : block.type === "changed"
                    ? "rounded bg-amber-50 px-2 py-1 text-amber-800 whitespace-pre-wrap"
                    : "px-2 py-1 text-[var(--color-text-secondary)]"
                }
              >
                {block.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderPrototypePreview = (document: StageDocument) => {
    const pageSection = document.sections.find((section) => /页面列表|页面结构|页面/.test(section.title));
    const flowSection = document.sections.find((section) => /流转|流程/.test(section.title));
    const noteSection = document.sections.find((section) => /说明|标注/.test(section.title));
    const pageEntries = (pageSection?.items?.length ? pageSection.items : extractPrototypePages(document.documentMarkdown)).slice(0, 6).map((item, index) => buildPrototypePageCard(item, index));
    const flowItems = (flowSection?.items?.length ? flowSection.items : extractPrototypeFlows(document.documentMarkdown)).slice(0, 6);
    const noteItems = (noteSection?.items?.length ? noteSection.items : []).slice(0, 6);
    const selectedPage = pageEntries[selectedPrototypePageIndex] ?? pageEntries[0] ?? null;

    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-[var(--color-border)] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-base font-semibold">页面化原型画布</div>
              <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                点击页面卡片即可切换查看该页结构、流程与标注建议。
              </div>
            </div>
            <Badge variant="outline">{pageEntries.length || 1} 页</Badge>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <div className="overflow-x-auto pb-2">
                <div className="flex min-w-max items-stretch gap-0">
                  {(pageEntries.length > 0 ? pageEntries : [buildPrototypePageCard("首页：展示产品当前状态与核心入口", 0)]).map((page, index) => {
                    const isSelected = index === selectedPrototypePageIndex;
                    return (
                      <div key={`${page.title}-${index}`} className="flex items-stretch">
                        <button
                          type="button"
                          onClick={() => setSelectedPrototypePageIndex(index)}
                          className={`relative w-[260px] shrink-0 rounded-2xl border p-4 text-left transition-all ${
                            isSelected
                              ? "border-[var(--color-accent)] bg-[linear-gradient(180deg,#ffffff_0%,#eef5ff_100%)] shadow-lg shadow-slate-200 ring-2 ring-[var(--color-accent)]/20"
                              : "border-[var(--color-border)] bg-[linear-gradient(180deg,#ffffff_0%,#f7f7fb_100%)] shadow-sm hover:border-[var(--color-accent)]"
                          }`}
                        >
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{page.title}</div>
                              <div className="mt-1 text-xs text-[var(--color-text-secondary)]">页面卡片</div>
                            </div>
                            <Badge className={isSelected ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent)]" : "bg-slate-100 text-slate-700 hover:bg-slate-100"}>
                              {isSelected ? "当前" : `Page ${index + 1}`}
                            </Badge>
                          </div>
                          <div className="space-y-2 rounded-xl border border-dashed border-[var(--color-border)] bg-white/80 p-3">
                            <div className="h-6 rounded bg-slate-100" />
                            <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
                              <div className="space-y-2">
                                <div className="h-18 rounded bg-slate-100" />
                                <div className="h-10 rounded bg-slate-100" />
                              </div>
                              <div className="space-y-2">
                                <div className="h-14 rounded bg-slate-100" />
                                <div className="h-14 rounded bg-slate-100" />
                                <div className="h-18 rounded bg-slate-100" />
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 text-xs leading-5 text-[var(--color-text-secondary)]">
                            {page.summary}
                          </div>
                        </button>
                        {index < pageEntries.length - 1 ? (
                          <div className="flex w-10 shrink-0 items-center justify-center text-[var(--color-accent)]">
                            <div className="flex w-full items-center gap-1">
                              <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-accent)]/60 to-transparent" />
                              <ArrowRight className="size-4 shrink-0" />
                              <div className="h-px flex-1 bg-gradient-to-l from-[var(--color-accent)] via-[var(--color-accent)]/60 to-transparent" />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--color-border)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold">当前选中页面</div>
                  <Badge variant="outline">{selectedPage ? selectedPage.title : "未选择"}</Badge>
                </div>
                {selectedPage ? (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                    <div className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <div className="text-base font-semibold">{selectedPage.title}</div>
                          <div className="mt-1 text-sm text-[var(--color-text-secondary)]">{selectedPage.summary}</div>
                        </div>
                        <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">可点击画布</Badge>
                      </div>
                      <div className="space-y-3 rounded-2xl border border-dashed border-[var(--color-border)] bg-[linear-gradient(180deg,#fbfbff_0%,#f4f7ff_100%)] p-4">
                        <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
                          <span>页面布局</span>
                          <span>点击卡片切换页面</span>
                        </div>
                        <div className="space-y-3">
                          <div className="h-8 rounded-md bg-white shadow-sm" />
                          <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
                            <div className="space-y-3">
                              <div className="h-24 rounded-md bg-white shadow-sm" />
                              <div className="h-14 rounded-md bg-white shadow-sm" />
                            </div>
                            <div className="space-y-3">
                              <div className="h-16 rounded-md bg-white shadow-sm" />
                              <div className="h-16 rounded-md bg-white shadow-sm" />
                              <div className="h-24 rounded-md bg-white shadow-sm" />
                            </div>
                          </div>
                          <div className="rounded-md border border-dashed border-[var(--color-border)] bg-white p-3 text-sm text-[var(--color-text-secondary)]">
                            {selectedPage.description}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
                        <div className="text-sm font-semibold">页面模块</div>
                        <div className="mt-3 space-y-2">
                          {(selectedPage.modules.length > 0 ? selectedPage.modules : ["页面头部", "核心内容区", "操作区"]).map((module, index) => (
                            <div key={`${module}-${index}`} className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
                              {module}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
                        <div className="text-sm font-semibold">交互提示</div>
                        <div className="mt-3 space-y-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                          {(selectedPage.notes.length > 0 ? selectedPage.notes : [
                            "点击页面卡片切换当前画布。",
                            "这里展示页面的核心承接关系和可点击结构。",
                            "后续可继续补更多点击点和状态。"
                          ]).map((item, index) => (
                            <div key={`${item}-${index}`} className="rounded-lg bg-[var(--color-surface)] px-3 py-2">
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[var(--color-border)] p-6 text-sm text-[var(--color-text-secondary)]">
                    暂无页面内容。
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
                <div className="mb-3 text-sm font-semibold">页面流转</div>
                <div className="space-y-2">
                  {(flowItems.length > 0 ? flowItems : ["进入首页 -> 查看状态 -> 执行核心动作 -> 返回结果"]).map((item, index) => (
                    <button key={`${item}-${index}`} type="button" className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left text-sm transition-colors hover:border-[var(--color-accent)]">
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
                <div className="mb-3 text-sm font-semibold">原型标注建议</div>
                <div className="space-y-2">
                  {(noteItems.length > 0 ? noteItems : [
                    "补充关键交互说明",
                    "标注主流程入口和返回路径",
                    "标注异常状态和待确认规则"
                  ]).map((item, index) => (
                    <div key={`${item}-${index}`} className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
                <div className="mb-2 text-sm font-semibold">原型文档摘要</div>
                <div className="text-sm leading-6 text-[var(--color-text-secondary)]">
                  {document.summary}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
          <div className="mb-3 text-sm font-semibold">原型原文</div>
          <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: document.documentHtml }}
          />
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="flex min-h-0 w-[360px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] px-4 py-4">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-[var(--color-accent)]" />
            <h2 className="font-semibold">阶段与产物</h2>
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
            六阶段主流程的正式产物都从这里进入，全屏工作区里继续编辑、生成和回滚。
          </p>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-4">
            {primaryStages.map((stage) => {
              const stageType = stage.type as PrimaryStageType;
              const hasArtifact = stage.artifacts.length > 0;
              const nextAction = NEXT_GENERATION_ACTION[stageType];
              const isCurrent = currentStage === stageType;

              return (
                <div key={stage.type} className="rounded-xl border border-[var(--color-border)] bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">{STAGE_LABELS[stageType]}</div>
                      <p className="text-xs leading-5 text-[var(--color-text-secondary)]">{STAGE_DESCRIPTIONS[stageType]}</p>
                    </div>
                    {getStatusBadge(stage.status)}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant={hasArtifact ? "default" : "outline"} onClick={() => openStageWorkspace(stageType)}>
                      {hasArtifact ? "打开产物" : "打开工作区"}
                    </Button>
                    {stageType === "requirement-collection" ? (
                      <Button size="sm" variant="outline" onClick={openRequirementRecordComposer}>
                        <Plus className="mr-1 size-4" />
                        补录需求点
                      </Button>
                    ) : null}
                    {isCurrent && nextAction ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleGenerateStage(nextAction.target)}
                        disabled={isGenerating === nextAction.target}
                      >
                        {isGenerating === nextAction.target ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Sparkles className="mr-1 size-4" />}
                        {nextAction.label}
                      </Button>
                    ) : null}
                    {!isCurrent && (stage.status === "completed" || hasArtifact) ? (
                      <Button size="sm" variant="ghost" onClick={() => handleRollbackStage(stageType)}>
                        <RotateCcw className="mr-1 size-4" />
                        回到此阶段
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      <Dialog open={showWorkspaceDialog} onOpenChange={setShowWorkspaceDialog}>
        <DialogContent className="!left-0 !top-0 !h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 rounded-none border-0 p-0">
          <DialogHeader className="border-b border-[var(--color-border)] px-6 py-4">
            <DialogTitle>{selectedStageType ? `${STAGE_LABELS[selectedStageType]}工作区` : "阶段工作区"}</DialogTitle>
            <DialogDescription>
              {selectedStageType ? STAGE_DESCRIPTIONS[selectedStageType] : "查看并编辑当前阶段正式产物。"}
            </DialogDescription>
          </DialogHeader>
          <div className="relative h-[calc(100vh-73px)]">{renderWorkspaceMain()}</div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewFile)} onOpenChange={(open) => !open && setPreviewFile(null)}>
        <DialogContent className="!max-w-5xl">
          <DialogHeader>
            <DialogTitle>{previewFile?.name ?? "文件预览"}</DialogTitle>
            <DialogDescription>支持原文件预览；Office 类型会尽量展示提取到的正文片段。</DialogDescription>
          </DialogHeader>
          {previewFile ? (
            <div className="grid max-h-[75vh] gap-4 md:grid-cols-[1.3fr_0.7fr]">
              <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white">
                {canInlinePreview ? (
                  previewFile.mimeType.startsWith("image/") ? (
                    <img src={previewUrl} alt={previewFile.name} className="h-[70vh] w-full object-contain" />
                  ) : (
                    <iframe title={previewFile.name} src={previewUrl} className="h-[70vh] w-full" />
                  )
                ) : (
                  <div className="flex h-[70vh] flex-col items-center justify-center gap-3 px-8 text-center">
                    <Upload className="size-8 text-[var(--color-accent)]" />
                    <div className="text-sm font-medium">当前类型不适合浏览器内嵌预览</div>
                    <Button asChild variant="outline">
                      <a href={previewUrl} target="_blank" rel="noreferrer">打开原文件</a>
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-4 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div>
                  <div className="text-xs font-medium text-[var(--color-text-secondary)]">解析状态</div>
                  <div className="mt-1 text-sm">{previewFile.extractionStatus === "parsed" ? "已提取正文片段" : "已保留文件和元数据"}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-[var(--color-text-secondary)]">文件信息</div>
                  <div className="mt-1 text-sm leading-6">
                    <div>类型：{previewFile.mimeType}</div>
                    <div>大小：{Math.max(1, Math.round(previewFile.size / 1024))} KB</div>
                    <div>上传时间：{new Date(previewFile.uploadedAt).toLocaleString()}</div>
                  </div>
                </div>
                {previewFile.note ? (
                  <div>
                    <div className="text-xs font-medium text-[var(--color-text-secondary)]">解析备注</div>
                    <div className="mt-1 text-sm">{previewFile.note}</div>
                  </div>
                ) : null}
                <div>
                  <div className="text-xs font-medium text-[var(--color-text-secondary)]">提取内容片段</div>
                  <div className="mt-2 max-h-[36vh] overflow-y-auto rounded-md border bg-white p-3 text-sm whitespace-pre-wrap">
                    {previewFile.extractedTextExcerpt?.trim() || "当前没有可展示的提取文本片段。"}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deletingSourceRecord)} onOpenChange={(open) => !open && setDeletingSourceRecord(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条需求点记录？</AlertDialogTitle>
            <AlertDialogDescription>删除后只影响来源记录本身，不会自动重整正式文档。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSourceRecord}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function extractPrototypePages(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2))
    .filter((line) => /页|页面|首页|列表|详情|设置/.test(line));
}

function extractPrototypeFlows(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2))
    .filter((line) => /->|流程|进入|查看|执行|返回/.test(line));
}

function buildPrototypePageCard(raw: string, index: number) {
  const [titlePart, ...rest] = raw.split(/[:：]/);
  const title = titlePart?.trim() || `页面 ${index + 1}`;
  const summary = rest.join("：").trim() || "点击后可查看该页的结构、流程和标注建议。";
  const modules = summary
    .split(/[，。,；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
  const notes = modules.length > 0
    ? modules.map((item) => `围绕「${item}」继续补充交互和状态。`)
    : [
        "标注主入口和返回路径。",
        "补充异常状态和空状态。",
        "补充该页面的关键操作。"
      ];

  return {
    title,
    summary,
    description: summary,
    modules,
    notes
  };
}
