import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from 'react-router'
import "@blocknote/core/fonts/inter.css";
import "@mantine/core/styles.css";
import "@blocknote/mantine/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import {
  useCreateBlockNote,
} from "@blocknote/react";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type {
  BusinessModelMode,
  RequirementCollectionArtifactContent,
  RequirementPointSection,
  RequirementSourceRecord,
  Stage,
  StageType,
  WorkspaceBusinessModelEdge,
  WorkspaceBusinessModelGraph,
  WorkspaceBusinessModelNode,
  WorkspaceCustomColumn,
  WorkspaceRequirementDocument,
  WorkspaceRequirementDocumentVersion,
  WorkspaceSavedView,
  WorkspaceRequirementItem,
  WorkspaceViewMode
} from "../../types";
import { createDocumentRepository, type DocumentRepository } from "../../repositories/document-repository";
import { saveWorkspaceBusinessModelGraph, saveWorkspaceRequirementItems, getWorkspaceBusinessModelGraph, getWorkspaceRequirementItems, generateId, getProject, getStages, getWorkspaceViewConfig, saveWorkspaceViewConfig } from "../../utils/storage";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Download,
  Ellipsis,
  FileCode2,
  FileText,
  FileSpreadsheet,
  Filter,
  GripVertical,
  Link2,
  ListTree,
  Mail,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Palette,
  Plus,
  PlusCircle,
  Printer,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  SplitSquareVertical,
  Trash2,
  Upload
} from "lucide-react";
import { toast } from "sonner";

interface MyWorkspaceDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  projectName?: string;
  currentStage?: StageType;
  stages?: Stage[];
}
type SortKey = "order" | "title" | "status" | "priority" | "module" | "updatedAt";

const viewOptions: Array<{ id: WorkspaceViewMode; label: string; icon: typeof FileSpreadsheet; description: string }> = [
  { id: "table", label: "需求表格", icon: FileSpreadsheet, description: "像 Notion 一样快速录入与整理需求点" },
  { id: "tree", label: "树形结构", icon: ListTree, description: "整理父子层级和模块归属" },
  { id: "mindmap", label: "思维导图", icon: Network, description: "用 XMind 风格查看需求结构" },
  { id: "business-model", label: "业务建模", icon: FileCode2, description: "用流程图和状态机搭建业务骨架" },
  { id: "documents", label: "需求文档", icon: FileText, description: "管理正式需求文档并直接编辑内容" }
];

const defaultColumnWidths = {
  control: 70,
  title: 320,
  status: 140,
  priority: 120,
  module: 180,
  description: 420
};

const defaultVisibleColumns = {
  status: true,
  priority: true,
  module: true,
  description: true
};

const BUSINESS_NODE_WIDTH = 172;
const BUSINESS_NODE_HEIGHT = 76;
const BUSINESS_SCENE_WIDTH = 4800;
const BUSINESS_SCENE_HEIGHT = 3600;

export function MyWorkspaceView({
  open,
  projectName,
  currentStage,
  stages
}: MyWorkspaceDialogProps) {
  const { projectId = "" } = useParams();
  const documentRepository = useMemo(() => createDocumentRepository(), []);
  const routeProject = useMemo(() => projectId ? getProject(projectId) : null, [projectId]);
  const workspaceOpen = open ?? true;
  const workspaceProjectName = projectName ?? routeProject?.name ?? "我的工作空间";
  const workspaceCurrentStage = currentStage ?? routeProject?.currentStage ?? "requirement-collection";
  const workspaceStages = useMemo(() => stages ?? (projectId ? getStages(projectId) : []), [projectId, stages]);
  const [viewMode, setViewMode] = useState<WorkspaceViewMode>("table");
  const [items, setItems] = useState<WorkspaceRequirementItem[]>([]);
  const [documents, setDocuments] = useState<WorkspaceRequirementDocument[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [documentVersions, setDocumentVersions] = useState<WorkspaceRequirementDocumentVersion[]>([]);
  const [documentVersionsLoading, setDocumentVersionsLoading] = useState(false);
  const [documentHistoryOpen, setDocumentHistoryOpen] = useState(false);
  const [selectedDocumentVersionId, setSelectedDocumentVersionId] = useState<string | null>(null);
  const [documentVersionPreview, setDocumentVersionPreview] = useState<WorkspaceRequirementDocument | null>(null);
  const [documentSaving, setDocumentSaving] = useState(false);
  const [showDocumentList, setShowDocumentList] = useState(true);
  const [documentSearchQuery, setDocumentSearchQuery] = useState("");
  const [documentSortMode, setDocumentSortMode] = useState<"manual" | "updatedAt" | "title">("manual");
  const [draggedDocumentId, setDraggedDocumentId] = useState<string | null>(null);
  const [documentFontFamily, setDocumentFontFamily] = useState<"Inter" | "Georgia" | "JetBrains Mono">("Inter");
  const [documentSelectionContext, setDocumentSelectionContext] = useState<"text" | "table">("text");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [quickInput, setQuickInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | WorkspaceRequirementItem["status"]>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | WorkspaceRequirementItem["priority"]>("all");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("order");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [savedViews, setSavedViews] = useState<WorkspaceSavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string>("default");
  const [defaultViewId, setDefaultViewId] = useState<string>("default");
  const [visibleColumns, setVisibleColumns] = useState(defaultVisibleColumns);
  const [customColumns, setCustomColumns] = useState<WorkspaceCustomColumn[]>([]);
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnType, setNewColumnType] = useState<"text" | "select">("text");
  const [newColumnOptions, setNewColumnOptions] = useState("");
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState(defaultColumnWidths);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<string[]>([]);
  const [mindMapDropTargetId, setMindMapDropTargetId] = useState<string | null>(null);
  const [mindMapDropInvalid, setMindMapDropInvalid] = useState(false);
  const [mindMapNodePreviewPosition, setMindMapNodePreviewPosition] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [mindMapScale, setMindMapScale] = useState(1);
  const [mindMapOffset, setMindMapOffset] = useState({ x: 0, y: 0 });
  const [mindMapDragging, setMindMapDragging] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(true);
  const [businessModelGraph, setBusinessModelGraph] = useState<WorkspaceBusinessModelGraph>({
    nodes: [],
    edges: [],
    mode: "flow",
    version: 1,
    updatedAt: new Date().toISOString()
  });
  const [selectedBusinessNodeId, setSelectedBusinessNodeId] = useState<string | null>(null);
  const [selectedBusinessEdgeId, setSelectedBusinessEdgeId] = useState<string | null>(null);
  const [selectedBusinessNodeIds, setSelectedBusinessNodeIds] = useState<string[]>([]);
  const [businessRequirementQuery, setBusinessRequirementQuery] = useState("");
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  const [linkSourceNodeId, setLinkSourceNodeId] = useState<string | null>(null);
  const [businessLinkPreview, setBusinessLinkPreview] = useState<{ x: number; y: number } | null>(null);
  const [businessLinkHoverTargetId, setBusinessLinkHoverTargetId] = useState<string | null>(null);
  const [businessSelectionRect, setBusinessSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [businessReconnectState, setBusinessReconnectState] = useState<{ edgeId: string; end: "source" | "target" } | null>(null);
  const [businessCanvasScale, setBusinessCanvasScale] = useState(1);
  const [businessCanvasOffset, setBusinessCanvasOffset] = useState({ x: 0, y: 0 });
  const [businessSnapGuides, setBusinessSnapGuides] = useState<{ x: number[]; y: number[] } | null>(null);
  const [businessSpacePanActive, setBusinessSpacePanActive] = useState(false);
  const [businessFlashNodeIds, setBusinessFlashNodeIds] = useState<string[]>([]);
  const [businessDragPreviewPositions, setBusinessDragPreviewPositions] = useState<Record<string, { x: number; y: number }> | null>(null);
  const mindMapViewportRef = useRef<HTMLDivElement | null>(null);
  const mindMapOffsetRef = useRef({ x: 0, y: 0 });
  const mindMapRafRef = useRef<number | null>(null);
  const mindMapNodePreviewRafRef = useRef<number | null>(null);
  const mindMapNodePreviewNextRef = useRef<{ nodeId: string; x: number; y: number } | null>(null);
  const mindMapNodeDragStateRef = useRef<{
    nodeId: string;
    moved: boolean;
    offsetX: number;
    offsetY: number;
    startSceneX: number;
    startSceneY: number;
  } | null>(null);
  const mindMapNodeResizeStateRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);
  const mindMapDragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const columnResizeStateRef = useRef<{
    key: keyof typeof defaultColumnWidths;
    startX: number;
    originWidth: number;
  } | null>(null);
  const selectionDragStateRef = useRef<{
    active: boolean;
    shouldSelect: boolean;
  } | null>(null);
  const businessCanvasRef = useRef<HTMLDivElement | null>(null);
  const businessNodeDragStateRef = useRef<{
    nodeId: string;
    offsetX: number;
    offsetY: number;
    additive: boolean;
    movedNodeIds: string[];
    originPositions: Record<string, { x: number; y: number }>;
  } | null>(null);
  const businessEdgeDragStateRef = useRef<{
    sourceNodeId: string;
  } | null>(null);
  const businessSelectionStateRef = useRef<{
    startX: number;
    startY: number;
  } | null>(null);
  const businessCanvasPanStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const businessClipboardRef = useRef<{
    nodes: WorkspaceBusinessModelNode[];
    edges: WorkspaceBusinessModelEdge[];
  } | null>(null);
  const businessFlashTimeoutRef = useRef<number | null>(null);
  const documentFileInputRef = useRef<HTMLInputElement | null>(null);
  const documentsRef = useRef<WorkspaceRequirementDocument[]>([]);
  const documentSaveTimerRef = useRef<number | null>(null);

  const requirementCollection = useMemo(() => {
    const artifact = workspaceStages
      ?.find((stage) => stage.type === "requirement-collection")
      ?.artifacts.find((item) => item.type === "requirement-input");
    return (artifact?.content as RequirementCollectionArtifactContent | undefined) ?? null;
  }, [workspaceStages]);

  useEffect(() => {
    if (!workspaceOpen || !projectId) {
      return;
    }

    let cancelled = false;

    const loadWorkspace = async () => {
      const existing = getWorkspaceRequirementItems(projectId);
      const nextItems = mergeWorkspaceItems(existing, requirementCollection);
      if (cancelled) {
        return;
      }

      setItems(nextItems);
      saveWorkspaceRequirementItems(projectId, nextItems);

      const savedViewConfig = getWorkspaceViewConfig(projectId);
      if (savedViewConfig) {
        const normalizedViews = normalizeSavedViews(savedViewConfig.savedViews);
        const nextDefaultViewId = savedViewConfig.defaultViewId || normalizedViews[0]?.id || "default";
        const nextActiveViewId = savedViewConfig.activeViewId || nextDefaultViewId;
        setSavedViews(normalizedViews);
        setDefaultViewId(nextDefaultViewId);
        setActiveViewId(nextActiveViewId);
        const activeView = normalizedViews.find((view) => view.id === nextActiveViewId) ?? normalizedViews[0]!;
        applySavedView(activeView);
        setCustomColumns(savedViewConfig.customColumns ?? []);
      } else {
        const defaultViews = createDefaultSavedViews();
        setSavedViews(defaultViews);
        setDefaultViewId(defaultViews[0]!.id);
        setActiveViewId(defaultViews[0]!.id);
        applySavedView(defaultViews[0]!);
      }

      const visibleNextItems = nextItems.filter((item) => !item.deleted);
      setSelectedItemId((current) => current && visibleNextItems.some((item) => item.id === current) ? current : visibleNextItems[0]?.id ?? null);
      setSelectedRowIds([]);

      const existingDocuments = await documentRepository.list(projectId);
      if (cancelled) {
        return;
      }
      const nextDocuments = existingDocuments.length > 0
        ? existingDocuments
        : await seedInitialWorkspaceDocuments(projectId, workspaceProjectName, requirementCollection, documentRepository);
      if (cancelled) {
        return;
      }
      setDocuments(nextDocuments);
      setSelectedDocumentId((current) => current && nextDocuments.some((document) => document.id === current) ? current : nextDocuments[0]?.id ?? null);

      const storedBusinessGraph = getWorkspaceBusinessModelGraph(projectId);
      if (storedBusinessGraph) {
        setBusinessModelGraph(storedBusinessGraph);
        setSelectedBusinessNodeId(storedBusinessGraph.nodes[0]?.id ?? null);
        setSelectedBusinessEdgeId(null);
      } else {
        const seededGraph = createInitialBusinessModelGraph(nextItems.filter((item) => !item.deleted));
        setBusinessModelGraph(seededGraph);
        saveWorkspaceBusinessModelGraph(projectId, seededGraph);
        setSelectedBusinessNodeId(seededGraph.nodes[0]?.id ?? null);
        setSelectedBusinessEdgeId(null);
      }
    };

    void loadWorkspace();

    return () => {
      cancelled = true;
    };
  }, [documentRepository, projectId, requirementCollection, workspaceOpen, workspaceProjectName]);

  useEffect(() => {
    if (!workspaceOpen || !projectId) {
      return;
    }
    saveWorkspaceViewConfig(projectId, {
      activeViewId,
      defaultViewId,
      savedViews,
      customColumns
    });
  }, [activeViewId, customColumns, defaultViewId, projectId, savedViews, workspaceOpen]);

  useEffect(() => {
    if (!workspaceOpen || !projectId) {
      return;
    }
    saveWorkspaceBusinessModelGraph(projectId, businessModelGraph);
  }, [businessModelGraph, projectId, workspaceOpen]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);


  useEffect(() => {
    mindMapOffsetRef.current = mindMapOffset;
  }, [mindMapOffset]);

  useEffect(() => () => {
    if (mindMapNodePreviewRafRef.current !== null) {
      window.cancelAnimationFrame(mindMapNodePreviewRafRef.current);
    }
    if (businessFlashTimeoutRef.current !== null) {
      window.clearTimeout(businessFlashTimeoutRef.current);
    }
    if (documentSaveTimerRef.current !== null) {
      window.clearTimeout(documentSaveTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (viewMode !== "table" || !selectedItemId) {
      return;
    }

    const row = document.querySelector(`[data-workspace-row-id="${selectedItemId}"]`);
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
  }, [selectedItemId, viewMode]);

  useEffect(() => {
    if (viewMode !== "tree" || !selectedItemId) {
      return;
    }

    const row = document.querySelector(`[data-workspace-tree-id="${selectedItemId}"]`);
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
  }, [selectedItemId, viewMode]);

  useEffect(() => {
    if (!workspaceOpen || !selectedDocumentId || !projectId) {
      setDocumentVersions([]);
      setSelectedDocumentVersionId(null);
      setDocumentVersionPreview(null);
      return;
    }

    let cancelled = false;
    setDocumentVersionsLoading(true);

    void documentRepository.listVersions(projectId, selectedDocumentId)
      .then((versions) => {
        if (!cancelled) {
          setDocumentVersions(versions);
          setSelectedDocumentVersionId((current) => (
            current && versions.some((version) => version.id === current)
              ? current
              : versions[0]?.id ?? null
          ));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDocumentVersions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDocumentVersionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documentRepository, projectId, selectedDocumentId, workspaceOpen]);

  useEffect(() => {
    if (!documentHistoryOpen || !selectedDocumentId || !selectedDocumentVersionId) {
      setDocumentVersionPreview(null);
      return;
    }

    let cancelled = false;
    setDocumentVersionPreview(null);
    void documentRepository.getVersion(projectId, selectedDocumentId, selectedDocumentVersionId)
      .then((versionDocument) => {
        if (!cancelled) {
          setDocumentVersionPreview(versionDocument);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documentHistoryOpen, documentRepository, projectId, selectedDocumentId, selectedDocumentVersionId]);

  const businessGraphNodesForRender = useMemo(() => (
    businessDragPreviewPositions
      ? businessModelGraph.nodes.map((node) => (
          businessDragPreviewPositions[node.id]
            ? {
                ...node,
                position: businessDragPreviewPositions[node.id]!
              }
            : node
        ))
      : businessModelGraph.nodes
  ), [businessDragPreviewPositions, businessModelGraph.nodes]);
  useEffect(() => {
    if (viewMode !== "business-model" || !selectedItemId || !businessCanvasRef.current) {
      return;
    }

    const linkedNodeIds = businessModelGraph.nodes
      .filter((node) => node.relatedRequirementIds.includes(selectedItemId))
      .map((node) => node.id);

    if (linkedNodeIds.length === 0) {
      return;
    }

    setSelectedBusinessNodeIds(linkedNodeIds);
    setSelectedBusinessNodeId(linkedNodeIds[0] ?? null);
    setSelectedBusinessEdgeId(null);
    setBusinessFlashNodeIds(linkedNodeIds);
    if (businessFlashTimeoutRef.current !== null) {
      window.clearTimeout(businessFlashTimeoutRef.current);
    }
    businessFlashTimeoutRef.current = window.setTimeout(() => {
      setBusinessFlashNodeIds([]);
      businessFlashTimeoutRef.current = null;
    }, 1400);

    const targetNode = businessGraphNodesForRender.find((node) => node.id === linkedNodeIds[0]);
    if (!targetNode) {
      return;
    }

    const rect = businessCanvasRef.current.getBoundingClientRect();
    setBusinessCanvasOffset({
      x: rect.width / 2 - (targetNode.position.x + BUSINESS_NODE_WIDTH / 2) * businessCanvasScale,
      y: rect.height / 2 - (targetNode.position.y + BUSINESS_NODE_HEIGHT / 2) * businessCanvasScale
    });
  }, [businessCanvasScale, businessGraphNodesForRender, businessModelGraph.nodes, selectedItemId, viewMode]);
  
  const visibleItems = useMemo(() => items.filter((item) => !item.deleted), [items]);

  useEffect(() => {
    if (viewMode !== "mindmap" || !selectedItemId) {
      return;
    }

    const ancestorIds = new Set<string>();
    let current = items.find((item) => item.id === selectedItemId) ?? null;
    while (current?.parentId) {
      ancestorIds.add(current.parentId);
      current = items.find((item) => item.id === current?.parentId) ?? null;
    }

    if (ancestorIds.size > 0) {
      setCollapsedNodeIds((currentIds) => currentIds.filter((id) => !ancestorIds.has(id)));
    }
    
    const timeout = window.setTimeout(() => {
      const viewport = mindMapViewportRef.current;
      if (!viewport) {
        return;
      }

      const expandedNodes = buildMindMapNodes(visibleItems, collapsedNodeIds.filter((id) => !ancestorIds.has(id)));
      const targetNode = expandedNodes.find((node) => node.id === selectedItemId);
      if (!targetNode) {
        return;
      }

      const rect = viewport.getBoundingClientRect();
      setMindMapOffset({
        x: rect.width / 2 - (targetNode.x + targetNode.width / 2) * mindMapScale,
        y: rect.height / 2 - (targetNode.y + targetNode.height / 2) * mindMapScale
      });
    }, 80);

    return () => window.clearTimeout(timeout);
  }, [collapsedNodeIds, items, mindMapScale, selectedItemId, viewMode, visibleItems]);

  const filteredItems = useMemo(() => {
    return [...visibleItems]
      .filter((item) => {
        if (statusFilter !== "all" && item.status !== statusFilter) {
          return false;
        }
        if (priorityFilter !== "all" && item.priority !== priorityFilter) {
          return false;
        }
        if (moduleFilter !== "all" && item.module !== moduleFilter) {
          return false;
        }
        if (!searchQuery.trim()) {
          return true;
        }
        const keyword = searchQuery.trim().toLowerCase();
        return [
          item.title,
          item.description,
          item.module,
          item.tags.join(" ")
        ].join(" ").toLowerCase().includes(keyword);
      })
      .sort((left, right) => sortWorkspaceItems(left, right, sortKey, sortDirection));
  }, [moduleFilter, priorityFilter, searchQuery, sortDirection, sortKey, statusFilter, visibleItems]);

  const selectedItem = visibleItems.find((item) => item.id === selectedItemId) ?? null;
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) ?? null;
  const selectedDocumentVersion = documentVersions.find((version) => version.id === selectedDocumentVersionId) ?? null;
  const filteredDocuments = useMemo(() => {
    const keyword = documentSearchQuery.trim().toLowerCase();
    const searched = !keyword
      ? documents
      : documents.filter((document) => (
          `${document.title} ${document.contentText}`.toLowerCase().includes(keyword)
        ));

    const sorted = [...searched];
    if (documentSortMode === "title") {
      sorted.sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
    } else if (documentSortMode === "updatedAt") {
      sorted.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    } else {
      sorted.sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
    }

    return sorted;
  }, [documentSearchQuery, documentSortMode, documents]);
  const selectedBusinessNode = businessModelGraph.nodes.find((node) => node.id === selectedBusinessNodeId) ?? null;
  const selectedBusinessEdge = businessModelGraph.edges.find((edge) => edge.id === selectedBusinessEdgeId) ?? null;
  const canManualReorderDocuments = documentSortMode === "manual" && !documentSearchQuery.trim();
  const relatedBusinessNodeIds = useMemo(() => (
    selectedItemId
      ? businessGraphNodesForRender.filter((node) => node.relatedRequirementIds.includes(selectedItemId)).map((node) => node.id)
      : []
  ), [businessGraphNodesForRender, selectedItemId]);
  const businessCounterpartNodeIds = useMemo(() => (
    selectedBusinessNodeId
      ? businessModelGraph.counterpartMap?.[selectedBusinessNodeId] ?? []
      : []
  ), [businessModelGraph.counterpartMap, selectedBusinessNodeId]);
  const groupedModules = Array.from(new Set(visibleItems.map((item) => item.module).filter(Boolean)));
  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedRowIds.includes(item.id));
  const hasSelection = selectedRowIds.length > 0;
  const visibleTableColumns = [
    { key: "control", label: "", width: columnWidths.control, resizable: false, alwaysVisible: true },
    { key: "title", label: "需求标题", width: columnWidths.title, resizable: true, alwaysVisible: true },
    { key: "status", label: "状态", width: columnWidths.status, resizable: true, alwaysVisible: false },
    { key: "priority", label: "优先级", width: columnWidths.priority, resizable: true, alwaysVisible: false },
    { key: "module", label: "模块", width: columnWidths.module, resizable: true, alwaysVisible: false },
    { key: "description", label: "描述", width: columnWidths.description, resizable: true, alwaysVisible: false }
  ].filter((column) => column.alwaysVisible || visibleColumns[column.key as keyof typeof visibleColumns]);
  const visibleCustomColumns = customColumns.filter((column) => column.visible);
  const tableGridTemplate = visibleTableColumns.map((column) => `${column.width}px`).join(" ");
  const tableGridWithCustomTemplate = `${tableGridTemplate}${visibleCustomColumns.map((column) => ` ${column.width}px`).join("")}`;

  const persistItems = (nextItems: WorkspaceRequirementItem[]) => {
    setItems(nextItems);
    saveWorkspaceRequirementItems(projectId, nextItems);
  };

  const persistDocuments = (nextDocuments: WorkspaceRequirementDocument[]) => {
    setDocuments(nextDocuments);
  };

  const updateDocumentLocal = (documentId: string, updater: (document: WorkspaceRequirementDocument) => WorkspaceRequirementDocument) => {
    setDocuments((current) => current.map((document) => (
      document.id === documentId ? updater(document) : document
    )));
  };

  const queueDocumentSave = (documentId = selectedDocumentId) => {
    if (!documentId) {
      return;
    }
    if (documentSaveTimerRef.current !== null) {
      window.clearTimeout(documentSaveTimerRef.current);
    }
    documentSaveTimerRef.current = window.setTimeout(() => {
      void saveSelectedDocumentFromEditor(documentId);
    }, 700);
  };

  const documentEditor = useCreateBlockNote({}, [selectedDocumentId]);
  const loadedDocumentIdRef = useRef<string | null>(null);
  const documentEditorViewReadyRef = useRef(false);

  const isDocumentEditorViewUnavailable = (error: unknown) => (
    error instanceof Error && error.message.includes("editor view is not available")
  );

  const waitForDocumentEditorView = async (attempts = 12) => {
    for (let index = 0; index < attempts; index += 1) {
      if (documentEditorViewReadyRef.current) {
        return true;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return documentEditorViewReadyRef.current;
  };

  const runWithDocumentEditorView = <T,>(action: () => T, fallback?: T) => {
    if (!documentEditorViewReadyRef.current) {
      return fallback;
    }

    try {
      return action();
    } catch (error) {
      if (isDocumentEditorViewUnavailable(error)) {
        return fallback;
      }
      throw error;
    }
  };

  useEffect(() => {
    documentEditorViewReadyRef.current = false;
    const readyTimer = window.setTimeout(() => {
      documentEditorViewReadyRef.current = true;
    }, 0);

    return () => {
      window.clearTimeout(readyTimer);
      documentEditorViewReadyRef.current = false;
    };
  }, [documentEditor, selectedDocument?.id, workspaceOpen]);

  const saveSelectedDocumentFromEditor = async (documentId = selectedDocumentId) => {
    if (!documentId) {
      return;
    }
    if (documentSaveTimerRef.current !== null) {
      window.clearTimeout(documentSaveTimerRef.current);
      documentSaveTimerRef.current = null;
    }

    const currentDocument = documentsRef.current.find((document) => document.id === documentId);
    if (!currentDocument) {
      return;
    }

    setDocumentSaving(true);
    const contentHtml = await documentEditor.blocksToFullHTML(documentEditor.document);
    const contentText = await documentEditor.blocksToMarkdownLossy(documentEditor.document);
    const contentBlocks = JSON.parse(JSON.stringify(documentEditor.document));
    const nextDocument: WorkspaceRequirementDocument = {
      ...currentDocument,
      contentHtml,
      contentText,
      contentBlocks,
      updatedAt: new Date().toISOString()
    };

    try {
      const saved = await documentRepository.save(projectId, nextDocument);
      updateDocumentLocal(documentId, () => saved);
      if (selectedDocumentId === documentId) {
        const versions = await documentRepository.listVersions(projectId, documentId);
        setDocumentVersions(versions);
      }
      return saved;
    } finally {
      setDocumentSaving(false);
    }
  };

  useEffect(() => {
    let active = true;

    const syncDocument = async () => {
      if (!documentEditor) {
        return;
      }

      if (!selectedDocument?.id) {
        loadedDocumentIdRef.current = null;
        return;
      }

      if (loadedDocumentIdRef.current === selectedDocument.id) {
        return;
      }

      const nextBlocks = Array.isArray(selectedDocument.contentBlocks) && selectedDocument.contentBlocks.length > 0
        ? JSON.parse(JSON.stringify(selectedDocument.contentBlocks))
        : selectedDocument.contentHtml?.trim()
        ? await documentEditor.tryParseHTMLToBlocks(selectedDocument.contentHtml)
        : [{ type: "paragraph", content: "" }];

      if (!active) {
        return;
      }

      const ready = await waitForDocumentEditorView();
      if (!active || !ready) {
        return;
      }

      try {
        documentEditor.replaceBlocks(documentEditor.document, nextBlocks);
      } catch (error) {
        if (isDocumentEditorViewUnavailable(error)) {
          return;
        }
        throw error;
      }
      loadedDocumentIdRef.current = selectedDocument.id;
      syncDocumentSelectionContext();
    };

    void syncDocument();

    return () => {
      active = false;
    };
  }, [documentEditor, selectedDocument?.id]);

  const syncDocumentSelectionContext = () => {
    const currentBlock = runWithDocumentEditorView(
      () => documentEditor.getSelection()?.blocks?.[0] ?? documentEditor.getTextCursorPosition().block,
      undefined
    );
    setDocumentSelectionContext(currentBlock?.type === "table" ? "table" : "text");
  };

  const handleInsertDocumentTable = () => {
    const anchorBlock = runWithDocumentEditorView(
      () => documentEditor.getTextCursorPosition().block,
      undefined
    );
    if (!anchorBlock) {
      toast.error("编辑器还在初始化，请稍后再试");
      return;
    }

    const inserted = documentEditor.insertBlocks([
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: ["", "", ""] },
            { cells: ["", "", ""] }
          ]
        }
      }
    ], anchorBlock, "after");
    if (inserted[0]) {
      runWithDocumentEditorView(() => {
        documentEditor.setTextCursorPosition(inserted[0]);
      });
    }
    syncDocumentSelectionContext();
    toast.success("已插入表格");
  };

  const applySavedView = (view: WorkspaceSavedView) => {
    setSearchQuery(view.searchQuery);
    setStatusFilter(view.statusFilter);
    setPriorityFilter(view.priorityFilter);
    setVisibleColumns(view.visibleColumns);
    setColumnWidths(view.columnWidths);
    setSortKey(view.sortKey);
    setSortDirection(view.sortDirection);
    setModuleFilter(view.moduleFilter);
    setViewMode(view.preferredViewMode);
  };

  const buildCurrentViewSnapshot = (id: string, name: string): WorkspaceSavedView => ({
    id,
    name,
    preferredViewMode: viewMode,
    searchQuery,
    statusFilter,
    priorityFilter,
    visibleColumns,
    columnWidths,
    sortKey,
    sortDirection,
    moduleFilter
  });

  const handleSwitchSavedView = (viewId: string) => {
    const targetView = savedViews.find((view) => view.id === viewId);
    if (!targetView) {
      return;
    }
    setActiveViewId(viewId);
    applySavedView(targetView);
  };

  const handleSaveCurrentView = () => {
    setSavedViews((current) => current.map((view) => view.id === activeViewId ? buildCurrentViewSnapshot(view.id, view.name) : view));
  };

  const handleCreateSavedView = () => {
    const nextIndex = savedViews.length + 1;
    const newView = buildCurrentViewSnapshot(generateId(), `新视图 ${nextIndex}`);
    setSavedViews((current) => [...current, newView]);
    setActiveViewId(newView.id);
  };

  const handleCreateDocument = async () => {
    const created = await documentRepository.create(projectId, {
      title: `未命名文档 ${documents.length + 1}`
    });
    const reordered = await documentRepository.reorder(projectId, [created.id, ...documents.map((document) => document.id)]);
    persistDocuments(reordered);
    setSelectedDocumentId(created.id);
    setViewMode("documents");
    toast.success("已新建需求文档");
  };

  const handleDeleteDocument = async (documentId: string) => {
    await documentRepository.delete(projectId, documentId);
    const nextDocuments = documents.filter((document) => document.id !== documentId);
    persistDocuments(nextDocuments);
    setSelectedDocumentId((current) => {
      if (current !== documentId) {
        return current;
      }
      return nextDocuments[0]?.id ?? null;
    });
    if (selectedDocumentId === documentId) {
      setDocumentVersions([]);
    }
    toast.success("文档已删除");
  };

  const handleDuplicateDocument = async (documentId: string) => {
    const source = documents.find((document) => document.id === documentId);
    if (!source) {
      return;
    }
    const created = await documentRepository.create(projectId, {
      title: `${source.title} 副本`
    });
    const nextDocument = await documentRepository.save(projectId, {
      ...created,
      title: `${source.title} 副本`,
      contentHtml: source.contentHtml,
      contentText: source.contentText,
      contentBlocks: source.contentBlocks ? JSON.parse(JSON.stringify(source.contentBlocks)) : source.contentBlocks
    });
    const reordered = await documentRepository.reorder(projectId, [nextDocument.id, ...documents.map((document) => document.id)]);
    persistDocuments(reordered);
    setSelectedDocumentId(nextDocument.id);
    toast.success("已复制文档");
  };

  const handleUpdateDocumentTitle = (documentId: string, title: string) => {
    updateDocumentLocal(documentId, (document) => ({
      ...document,
      title,
      updatedAt: new Date().toISOString()
    }));
    queueDocumentSave(documentId);
  };

  const handleDocumentDrop = async (targetDocumentId: string) => {
    if (!draggedDocumentId || draggedDocumentId === targetDocumentId) {
      setDraggedDocumentId(null);
      return;
    }

    const ordered = [...documents];
    const sourceIndex = ordered.findIndex((document) => document.id === draggedDocumentId);
    const targetIndex = ordered.findIndex((document) => document.id === targetDocumentId);
    if (sourceIndex < 0 || targetIndex < 0) {
      setDraggedDocumentId(null);
      return;
    }

    const [moved] = ordered.splice(sourceIndex, 1);
    ordered.splice(targetIndex, 0, moved);
    const normalized = ordered.map((document, index) => ({
      ...document,
      sortOrder: index + 1
    }));
    persistDocuments(normalized);
    await documentRepository.reorder(projectId, normalized.map((document) => document.id));
    setDraggedDocumentId(null);
  };

  const handleRestoreDocumentVersion = async (versionId: string) => {
    if (!selectedDocumentId) {
      return;
    }
    const restored = await documentRepository.restoreVersion(projectId, selectedDocumentId, versionId);
    updateDocumentLocal(selectedDocumentId, () => restored);
    const nextBlocks = Array.isArray(restored.contentBlocks) && restored.contentBlocks.length > 0
      ? JSON.parse(JSON.stringify(restored.contentBlocks))
      : restored.contentHtml?.trim()
      ? await documentEditor.tryParseHTMLToBlocks(restored.contentHtml)
      : [{ type: "paragraph", content: "" }];
    const ready = await waitForDocumentEditorView();
    if (ready) {
      runWithDocumentEditorView(() => {
        documentEditor.replaceBlocks(documentEditor.document, nextBlocks);
      });
      loadedDocumentIdRef.current = restored.id;
    }
    const versions = await documentRepository.listVersions(projectId, selectedDocumentId);
    setDocumentVersions(versions);
    setSelectedDocumentVersionId(versions[0]?.id ?? null);
    setDocumentHistoryOpen(false);
    toast.success("已回滚到所选版本");
  };

  const handleOpenDocumentHistory = () => {
    if (!selectedDocumentId) {
      return;
    }
    setSelectedDocumentVersionId((current) => current ?? documentVersions[0]?.id ?? null);
    setDocumentHistoryOpen(true);
  };

  const handleExportDocumentPdf = async () => {
    if (!selectedDocument) {
      return;
    }

    const result = await saveSelectedDocumentFromEditor(selectedDocument.id);
    const html = result?.contentHtml ?? selectedDocument.contentHtml;
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1200,height=900");
    if (!printWindow) {
      toast.error("浏览器拦截了打印窗口，请允许弹窗后重试");
      return;
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>${selectedDocument.title}</title>
          <style>
            body { font-family: ${documentFontFamily}, -apple-system, BlinkMacSystemFont, sans-serif; padding: 48px; color: #101010; line-height: 1.75; }
            img { max-width: 100%; }
          </style>
        </head>
        <body>${html}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 180);
  };

  const handleExportDocumentEmailHtml = async () => {
    if (!selectedDocument) {
      return;
    }

    const result = await saveSelectedDocumentFromEditor(selectedDocument.id);
    const html = `<!DOCTYPE html><html><body style="font-family:${documentFontFamily},-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.75;color:#101010;">${result?.contentHtml ?? selectedDocument.contentHtml}</body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    downloadBlob(blob, `${sanitizeFilename(selectedDocument.title)}-email.html`);
    toast.success("已导出 Email HTML");
  };

  const handleExportDocumentDocx = async () => {
    if (!selectedDocument) {
      return;
    }

    const result = await saveSelectedDocumentFromEditor(selectedDocument.id);
    const markdown = result?.contentText ?? selectedDocument.contentText;
    const doc = new Document({
      sections: [
        {
          children: markdownToDocxParagraphs(markdown || selectedDocument.title)
        }
      ]
    });

    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, `${sanitizeFilename(selectedDocument.title)}.docx`);
    toast.success("已导出 DOCX");
  };

  const appendBlocksToDocument = (blocks: Parameters<typeof documentEditor.insertBlocks>[0]) => {
    if (!documentEditorViewReadyRef.current) {
      return;
    }

    if (documentEditor.document.length === 0) {
      runWithDocumentEditorView(() => {
        documentEditor.replaceBlocks(documentEditor.document, blocks);
      });
      return;
    }

    const lastBlock = documentEditor.document[documentEditor.document.length - 1];
    if (!lastBlock) {
      runWithDocumentEditorView(() => {
        documentEditor.replaceBlocks(documentEditor.document, blocks);
      });
      return;
    }
    runWithDocumentEditorView(() => {
      documentEditor.insertBlocks(blocks, lastBlock, "after");
    });
  };

  const handleDuplicateActiveView = () => {
    const activeView = savedViews.find((view) => view.id === activeViewId);
    if (!activeView) {
      return;
    }

    const duplicatedView: WorkspaceSavedView = {
      ...activeView,
      id: generateId(),
      name: `${activeView.name} 副本`
    };

    setSavedViews((current) => {
      const index = current.findIndex((view) => view.id === activeViewId);
      if (index < 0) {
        return [...current, duplicatedView];
      }
      const next = [...current];
      next.splice(index + 1, 0, duplicatedView);
      return next;
    });
    setActiveViewId(duplicatedView.id);
  };

  const handleMoveActiveView = (direction: "up" | "down") => {
    setSavedViews((current) => {
      const index = current.findIndex((view) => view.id === activeViewId);
      if (index < 0) {
        return current;
      }

      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const handleRenameActiveView = (name: string) => {
    setSavedViews((current) => current.map((view) => view.id === activeViewId ? { ...view, name } : view));
  };

  const handleDeleteActiveView = () => {
    if (savedViews.length <= 1) {
      return;
    }

    const remaining = savedViews.filter((view) => view.id !== activeViewId);
    const fallbackView = remaining[0]!;
    setSavedViews(remaining);
    setActiveViewId(fallbackView.id);
    if (defaultViewId === activeViewId) {
      setDefaultViewId(fallbackView.id);
    }
    applySavedView(fallbackView);
  };

  const handleSetDefaultView = () => {
    setDefaultViewId(activeViewId);
  };

  const handleAddCustomColumn = () => {
    const name = newColumnName.trim();
    if (!name) {
      return;
    }

    const column: WorkspaceCustomColumn = {
      id: generateId(),
      name,
      type: newColumnType,
      options: newColumnType === "select"
        ? newColumnOptions.split(",").map((item) => item.trim()).filter(Boolean)
        : undefined,
      width: 180,
      visible: true
    };

    setCustomColumns((current) => [...current, column]);
    setNewColumnName("");
    setNewColumnType("text");
    setNewColumnOptions("");
  };

  const updateCustomFieldValue = (itemId: string, columnId: string, value: string) => {
    updateItem(itemId, {
      customFields: {
        ...(items.find((item) => item.id === itemId)?.customFields ?? {}),
        [columnId]: value
      }
    });
  };

  const handleRenameCustomColumn = (columnId: string, name: string) => {
    setCustomColumns((current) => current.map((column) => column.id === columnId ? { ...column, name } : column));
  };

  const handleDeleteCustomColumn = (columnId: string) => {
    setCustomColumns((current) => current.filter((column) => column.id !== columnId));
    const nextItems = items.map((item) => {
      if (!item.customFields?.[columnId]) {
        return item;
      }
      const nextCustomFields = { ...(item.customFields ?? {}) };
      delete nextCustomFields[columnId];
      return {
        ...item,
        customFields: nextCustomFields,
        updatedAt: new Date().toISOString()
      };
    });
    persistItems(nextItems);
  };

  const handleQuickAdd = () => {
    const rows = quickInput
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (rows.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    const maxOrder = items.reduce((max, item) => Math.max(max, item.order), 0);
    const newItems = rows.map((row, index) => ({
      id: generateId(),
      title: row,
      description: "",
      status: "pending" as const,
      priority: "P1" as const,
      module: "未分类",
      parentId: null,
      order: maxOrder + index + 1,
      type: "feature" as const,
      tags: [],
      source: "manual" as const,
      confidence: "manual" as const,
      createdAt: now,
      updatedAt: now
    }));

    const nextItems = [...items, ...newItems];
    persistItems(nextItems);
    setQuickInput("");
    setSelectedItemId(newItems[0]?.id ?? null);
  };

  const handleCreateEmpty = () => {
    const now = new Date().toISOString();
    const newItem: WorkspaceRequirementItem = {
      id: generateId(),
      title: "新需求点",
      description: "",
      status: "pending",
      priority: "P1",
      module: "未分类",
      parentId: null,
      order: items.reduce((max, item) => Math.max(max, item.order), 0) + 1,
      type: "feature",
      tags: [],
      source: "manual",
      confidence: "manual",
      createdAt: now,
      updatedAt: now
    };
    const nextItems = [...items, newItem];
    persistItems(nextItems);
    setSelectedItemId(newItem.id);
  };

  const handleDeleteItem = (itemId: string) => {
    const now = new Date().toISOString();
    const nextItems = items.map((item) => {
      if (item.id === itemId) {
        return {
          ...item,
          deleted: true,
          updatedAt: now
        };
      }

      if (item.parentId === itemId) {
        return {
          ...item,
          parentId: null,
          updatedAt: now
        };
      }

      return item;
    });
    persistItems(nextItems);
    setSelectedRowIds((current) => current.filter((id) => id !== itemId));
    if (selectedItemId === itemId) {
      setSelectedItemId(nextItems.find((item) => !item.deleted)?.id ?? null);
    }
  };

  const handleBulkDelete = () => {
    if (selectedRowIds.length === 0) {
      return;
    }

    const deletedIds = new Set(selectedRowIds);
    const now = new Date().toISOString();
    const nextItems = items.map((item) => {
      if (deletedIds.has(item.id)) {
        return {
          ...item,
          deleted: true,
          updatedAt: now
        };
      }

      if (deletedIds.has(item.parentId ?? "")) {
        return {
          ...item,
          parentId: null,
          updatedAt: now
        };
      }

      return item;
    });

    persistItems(nextItems);
    setSelectedRowIds([]);
    if (selectedItemId && deletedIds.has(selectedItemId)) {
      setSelectedItemId(nextItems.find((item) => !item.deleted)?.id ?? null);
    }
  };

  const updateItem = (itemId: string, patch: Partial<WorkspaceRequirementItem>) => {
    const nextItems = items.map((item) => item.id === itemId ? {
      ...item,
      ...patch,
      updatedAt: new Date().toISOString()
    } : item);
    persistItems(nextItems);
  };

  const updateMindMapStyle = (
    itemId: string,
    patch: Partial<NonNullable<WorkspaceRequirementItem["mindMapStyle"]>>
  ) => {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }

    updateItem(itemId, {
      mindMapStyle: {
        ...(item.mindMapStyle ?? {}),
        ...patch
      }
    });
  };

  const updateBusinessModelGraph = (
    updater: WorkspaceBusinessModelGraph | ((current: WorkspaceBusinessModelGraph) => WorkspaceBusinessModelGraph)
  ) => {
    setBusinessModelGraph((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      const nextWithSnapshots = {
        ...next,
        flowSnapshot: next.mode === "flow"
          ? {
              nodes: next.nodes,
              edges: next.edges
            }
          : next.flowSnapshot,
        stateSnapshot: next.mode === "state"
          ? {
              nodes: next.nodes,
              edges: next.edges
            }
          : next.stateSnapshot
      };
      return {
        ...nextWithSnapshots,
        version: current.version + 1,
        updatedAt: new Date().toISOString()
      };
    });
  };

  const switchBusinessMode = (mode: BusinessModelMode, focusNodeIds?: string[]) => {
    updateBusinessModelGraph((current) => {
      if (current.mode === mode) {
        return current;
      }

      const snapshot = mode === "flow" ? current.flowSnapshot : current.stateSnapshot;
      if (!snapshot) {
        return {
          ...current,
          mode
        };
      }

      return {
        ...current,
        mode,
        nodes: snapshot.nodes,
        edges: snapshot.edges
      };
    });

    if (focusNodeIds && focusNodeIds.length > 0) {
      setSelectedBusinessNodeIds(focusNodeIds);
      setSelectedBusinessNodeId(focusNodeIds[0] ?? null);
      setSelectedBusinessEdgeId(null);
    } else {
      setSelectedBusinessNodeIds([]);
      setSelectedBusinessNodeId(null);
      setSelectedBusinessEdgeId(null);
    }
  };

  const addRequirementToBusinessModel = (requirement: WorkspaceRequirementItem, position?: { x: number; y: number }) => {
    const nodeId = generateId();
    const nextNode: WorkspaceBusinessModelNode = {
      id: nodeId,
      type: businessModelGraph.mode === "state" ? "state" : "action",
      label: requirement.title,
      relatedRequirementIds: [requirement.id],
      position: position ?? getNextBusinessNodePosition(businessModelGraph.nodes.length),
      meta: {
        module: requirement.module,
        priority: requirement.priority
      }
    };

    updateBusinessModelGraph((current) => ({
      ...current,
      nodes: [...current.nodes, nextNode]
    }));
    setSelectedBusinessNodeId(nodeId);
    setSelectedBusinessEdgeId(null);
    toast.success("需求点已加入业务建模");
  };

  const addEmptyBusinessNode = () => {
    const nodeId = generateId();
    const nextNode: WorkspaceBusinessModelNode = {
      id: nodeId,
      type: businessModelGraph.mode === "state" ? "state" : "action",
      label: businessModelGraph.mode === "state" ? "新状态" : "新步骤",
      relatedRequirementIds: [],
      position: getNextBusinessNodePosition(businessModelGraph.nodes.length)
    };
    updateBusinessModelGraph((current) => ({
      ...current,
      nodes: [...current.nodes, nextNode]
    }));
    setSelectedBusinessNodeId(nodeId);
    setSelectedBusinessEdgeId(null);
  };

  const updateBusinessNode = (nodeId: string, patch: Partial<WorkspaceBusinessModelNode>) => {
    updateBusinessModelGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? {
        ...node,
        ...patch
      } : node)
    }));
  };

  const updateBusinessEdge = (edgeId: string, patch: Partial<WorkspaceBusinessModelEdge>) => {
    updateBusinessModelGraph((current) => ({
      ...current,
      edges: current.edges.map((edge) => edge.id === edgeId ? {
        ...edge,
        ...patch
      } : edge)
    }));
  };

  const deleteBusinessNode = (nodeId: string) => {
    updateBusinessModelGraph((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
    }));
    if (selectedBusinessNodeId === nodeId) {
      setSelectedBusinessNodeId(null);
    }
  };

  const deleteBusinessEdge = (edgeId: string) => {
    updateBusinessModelGraph((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.id !== edgeId)
    }));
    if (selectedBusinessEdgeId === edgeId) {
      setSelectedBusinessEdgeId(null);
    }
  };

  useEffect(() => {
    if (!workspaceOpen || viewMode !== "business-model") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }

      const modifierKey = event.metaKey || event.ctrlKey;
      if (modifierKey && event.key.toLowerCase() === "c") {
        void handleCopySelectedBusinessNodes();
        return;
      }

      if (modifierKey && event.key.toLowerCase() === "v") {
        handlePasteBusinessNodes();
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      if (selectedBusinessNodeIds.length > 0) {
        updateBusinessModelGraph((current) => ({
          ...current,
          nodes: current.nodes.filter((node) => !selectedBusinessNodeIds.includes(node.id)),
          edges: current.edges.filter((edge) => !selectedBusinessNodeIds.includes(edge.source) && !selectedBusinessNodeIds.includes(edge.target))
        }));
        setSelectedBusinessNodeIds([]);
        setSelectedBusinessNodeId(null);
        setSelectedBusinessEdgeId(null);
        return;
      }

      if (selectedBusinessEdgeId) {
        deleteBusinessEdge(selectedBusinessEdgeId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteBusinessEdge, selectedBusinessEdgeId, selectedBusinessNodeIds, viewMode, workspaceOpen]);

  useEffect(() => {
    if (!workspaceOpen || viewMode !== "business-model") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
          return;
        }
        event.preventDefault();
        setBusinessSpacePanActive(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setBusinessSpacePanActive(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [viewMode, workspaceOpen]);

  const createBusinessEdge = (source: string, target: string) => {
    if (source === target) {
      return;
    }
    const exists = businessModelGraph.edges.some((edge) => edge.source === source && edge.target === target);
    if (exists) {
      return;
    }
    const sourceNode = businessModelGraph.nodes.find((node) => node.id === source);
    const targetNode = businessModelGraph.nodes.find((node) => node.id === target);
    const edgeId = generateId();
    const nextEdge: WorkspaceBusinessModelEdge = {
      id: edgeId,
      source,
      target,
      action: businessModelGraph.mode === "state"
        ? inferTransitionAction(sourceNode?.label, targetNode?.label)
        : undefined
    };
    updateBusinessModelGraph((current) => ({
      ...current,
      edges: [...current.edges, nextEdge]
    }));
    setSelectedBusinessEdgeId(edgeId);
    setSelectedBusinessNodeId(null);
  };

  const handleAutoLayoutBusinessModel = () => {
    updateBusinessModelGraph((current) => ({
      ...current,
      nodes: autoLayoutBusinessModelNodes(current.nodes, current.edges)
    }));
    toast.success("已自动整理布局");
  };

  const handleGenerateStateModel = () => {
    const nextGraph = flowToStateGraph(businessModelGraph);
    updateBusinessModelGraph(nextGraph);
    setSelectedBusinessEdgeId(null);
    setSelectedBusinessNodeId(null);
    setSelectedBusinessNodeIds([]);
    toast.success("已根据流程图生成状态机");
  };

  const handleValidateBusinessModel = () => {
    const messages = validateBusinessModelGraph(businessModelGraph);
    setValidationMessages(messages);
    if (messages.length === 0) {
      toast.success("业务建模校验通过");
      return;
    }
    toast.error(`发现 ${messages.length} 条建模问题`);
  };

  function handleCopySelectedBusinessNodes() {
    if (selectedBusinessNodeIds.length === 0) {
      toast.error("请先选择要复制的节点");
      return;
    }

    const copiedNodes = businessModelGraph.nodes.filter((node) => selectedBusinessNodeIds.includes(node.id));
    const copiedEdges = businessModelGraph.edges.filter((edge) => selectedBusinessNodeIds.includes(edge.source) && selectedBusinessNodeIds.includes(edge.target));
    businessClipboardRef.current = {
      nodes: copiedNodes,
      edges: copiedEdges
    };
    toast.success(`已复制 ${copiedNodes.length} 个节点`);
  }

  function handlePasteBusinessNodes() {
    if (!businessClipboardRef.current) {
      toast.error("当前还没有可粘贴的节点");
      return;
    }

    const idMap = new Map<string, string>();
    const pastedNodes = businessClipboardRef.current.nodes.map((node, index) => {
      const nextId = generateId();
      idMap.set(node.id, nextId);
      return {
        ...node,
        id: nextId,
        position: {
          x: node.position.x + 36 + index * 8,
          y: node.position.y + 36 + index * 8
        }
      };
    });
    const pastedEdges = businessClipboardRef.current.edges
      .map((edge) => ({
        ...edge,
        id: generateId(),
        source: idMap.get(edge.source) ?? "",
        target: idMap.get(edge.target) ?? ""
      }))
      .filter((edge) => edge.source && edge.target);

    updateBusinessModelGraph((current) => ({
      ...current,
      nodes: [...current.nodes, ...pastedNodes],
      edges: [...current.edges, ...pastedEdges]
    }));
    setSelectedBusinessNodeIds(pastedNodes.map((node) => node.id));
    setSelectedBusinessNodeId(pastedNodes[0]?.id ?? null);
    setSelectedBusinessEdgeId(null);
    toast.success(`已粘贴 ${pastedNodes.length} 个节点`);
  }

  const handleBusinessCanvasDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const requirementId = event.dataTransfer.getData("text/aipm-requirement-id");
    if (!requirementId) {
      return;
    }
    const requirement = filteredItems.find((item) => item.id === requirementId) ?? visibleItems.find((item) => item.id === requirementId);
    if (!requirement || !businessCanvasRef.current) {
      return;
    }
    const rect = businessCanvasRef.current.getBoundingClientRect();
    const scenePoint = toBusinessScenePoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
      businessCanvasOffset,
      businessCanvasScale
    );
    addRequirementToBusinessModel(requirement, {
      x: scenePoint.x - 90,
      y: scenePoint.y - 30
    });
  };

  const handleBusinessNodePointerDown = (event: React.PointerEvent<HTMLDivElement>, nodeId: string) => {
    event.stopPropagation();
    if (!businessCanvasRef.current) {
      return;
    }
    if (businessSpacePanActive || event.altKey || event.button === 1) {
      businessCanvasPanStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: businessCanvasOffset.x,
        originY: businessCanvasOffset.y
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const rect = businessCanvasRef.current.getBoundingClientRect();
    const node = businessModelGraph.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return;
    }
    const scenePoint = toBusinessScenePoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
      businessCanvasOffset,
      businessCanvasScale
    );
    businessNodeDragStateRef.current = {
      nodeId,
      offsetX: scenePoint.x - node.position.x,
      offsetY: scenePoint.y - node.position.y,
      additive: event.shiftKey || event.metaKey,
      movedNodeIds: [],
      originPositions: {}
    };
    setSelectedBusinessNodeIds((current) => {
      let nextSelectedIds: string[];
      if (event.shiftKey || event.metaKey) {
        nextSelectedIds = current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId];
      } else {
        nextSelectedIds = current.includes(nodeId) ? current : [nodeId];
      }
      const movedNodeIds = nextSelectedIds.includes(nodeId) && nextSelectedIds.length > 1
        ? nextSelectedIds
        : [nodeId];
      businessNodeDragStateRef.current = {
        ...businessNodeDragStateRef.current!,
        movedNodeIds,
        originPositions: Object.fromEntries(
          businessModelGraph.nodes
            .filter((entry) => movedNodeIds.includes(entry.id))
            .map((entry) => [entry.id, { ...entry.position }])
        )
      };
      return nextSelectedIds;
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleBusinessEdgeHandlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    sourceNodeId: string
  ) => {
    event.stopPropagation();
    const canvas = businessCanvasRef.current;
    if (!canvas) {
      return;
    }
    if (businessSpacePanActive || event.altKey || event.button === 1) {
      businessCanvasPanStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: businessCanvasOffset.x,
        originY: businessCanvasOffset.y
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    businessEdgeDragStateRef.current = {
      sourceNodeId
    };
    const rect = canvas.getBoundingClientRect();
    const scenePoint = toBusinessScenePoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
      businessCanvasOffset,
      businessCanvasScale
    );
    setBusinessLinkPreview({
      x: scenePoint.x,
      y: scenePoint.y
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleBusinessCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const canvas = businessCanvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();

    const dragState = businessNodeDragStateRef.current;
    if (dragState) {
      const scenePoint = toBusinessScenePoint(
        event.clientX - rect.left,
        event.clientY - rect.top,
        businessCanvasOffset,
        businessCanvasScale
      );
      const movedNodeIds = dragState.movedNodeIds.length > 0 ? dragState.movedNodeIds : [dragState.nodeId];
      const originNode = businessGraphNodesForRender.find((node) => node.id === dragState.nodeId);
      if (!originNode) {
        return;
      }
      const snapped = getBusinessSnappedPosition(
        scenePoint.x - dragState.offsetX,
        scenePoint.y - dragState.offsetY,
        businessGraphNodesForRender,
        dragState.nodeId
      );
      setBusinessSnapGuides(snapped.guides);
      const anchorOrigin = dragState.originPositions[dragState.nodeId] ?? originNode.position;
      const deltaX = snapped.x - anchorOrigin.x;
      const deltaY = snapped.y - anchorOrigin.y;
      const previewPositions = Object.fromEntries(
        movedNodeIds.map((id) => {
          const origin = dragState.originPositions[id] ?? businessGraphNodesForRender.find((node) => node.id === id)?.position ?? { x: 0, y: 0 };
          return [
            id,
            {
              x: origin.x + deltaX,
              y: origin.y + deltaY
            }
          ];
        })
      );
      setBusinessDragPreviewPositions(previewPositions);
      return;
    }

    const panState = businessCanvasPanStateRef.current;
    if (panState) {
      setBusinessCanvasOffset({
        x: panState.originX + (event.clientX - panState.startX),
        y: panState.originY + (event.clientY - panState.startY)
      });
      return;
    }

    const edgeDragState = businessEdgeDragStateRef.current;
    if (edgeDragState) {
      const scenePoint = toBusinessScenePoint(
        event.clientX - rect.left,
        event.clientY - rect.top,
        businessCanvasOffset,
        businessCanvasScale
      );
      const hoverNode = businessModelGraph.nodes.find((node) => {
        const withinX = scenePoint.x >= node.position.x && scenePoint.x <= node.position.x + 172;
        const withinY = scenePoint.y >= node.position.y && scenePoint.y <= node.position.y + 76;
        return withinX && withinY && node.id !== edgeDragState.sourceNodeId;
      });
      setBusinessLinkHoverTargetId(hoverNode?.id ?? null);
      setBusinessLinkPreview({
        x: scenePoint.x,
        y: scenePoint.y
      });
      return;
    }

    const selectionState = businessSelectionStateRef.current;
    if (selectionState) {
      const scenePoint = toBusinessScenePoint(
        event.clientX - rect.left,
        event.clientY - rect.top,
        businessCanvasOffset,
        businessCanvasScale
      );
      setBusinessSelectionRect({
        x: Math.min(selectionState.startX, scenePoint.x),
        y: Math.min(selectionState.startY, scenePoint.y),
        width: Math.abs(scenePoint.x - selectionState.startX),
        height: Math.abs(scenePoint.y - selectionState.startY)
      });
    }
  };

  const handleBusinessCanvasPointerUp = () => {
    const dragState = businessNodeDragStateRef.current;
    if (dragState && businessDragPreviewPositions) {
      updateBusinessModelGraph((current) => ({
        ...current,
        nodes: current.nodes.map((node) => (
          businessDragPreviewPositions[node.id]
            ? {
                ...node,
                position: businessDragPreviewPositions[node.id]!
              }
            : node
        ))
      }));
    }
    businessNodeDragStateRef.current = null;
    setBusinessDragPreviewPositions(null);
    businessCanvasPanStateRef.current = null;
    if (businessEdgeDragStateRef.current && businessLinkHoverTargetId) {
      if (businessReconnectState) {
        updateBusinessModelGraph((current) => ({
          ...current,
          edges: current.edges.map((edge) => edge.id === businessReconnectState.edgeId
            ? {
                ...edge,
                [businessReconnectState.end]: businessLinkHoverTargetId
              }
            : edge)
        }));
        setBusinessReconnectState(null);
      } else {
        createBusinessEdge(businessEdgeDragStateRef.current.sourceNodeId, businessLinkHoverTargetId);
      }
    }
    businessEdgeDragStateRef.current = null;
    setBusinessLinkPreview(null);
    setBusinessLinkHoverTargetId(null);
    if (businessSelectionStateRef.current && businessSelectionRect) {
      const selectedIds = businessModelGraph.nodes
        .filter((node) => intersectsRect(node.position.x, node.position.y, 172, 76, businessSelectionRect))
        .map((node) => node.id);
      setSelectedBusinessNodeIds(selectedIds);
      setSelectedBusinessNodeId(selectedIds[0] ?? null);
      setSelectedBusinessEdgeId(null);
    }
    businessSelectionStateRef.current = null;
    setBusinessSelectionRect(null);
    setBusinessSnapGuides(null);
  };

  const toggleRowSelection = (itemId: string, checked: boolean) => {
    setSelectedRowIds((current) => checked
      ? Array.from(new Set([...current, itemId]))
      : current.filter((id) => id !== itemId)
    );
  };

  const toggleAllFilteredRows = (checked: boolean) => {
    setSelectedRowIds((current) => {
      if (checked) {
        return Array.from(new Set([...current, ...filteredItems.map((item) => item.id)]));
      }

      const filteredSet = new Set(filteredItems.map((item) => item.id));
      return current.filter((id) => !filteredSet.has(id));
    });
  };

  const handleAddBelow = (afterItemId?: string) => {
    const now = new Date().toISOString();
    const baseOrder = afterItemId
      ? items.find((item) => item.id === afterItemId)?.order ?? items.length
      : items.reduce((max, item) => Math.max(max, item.order), 0);

    const newItem: WorkspaceRequirementItem = {
      id: generateId(),
      title: "新需求点",
      description: "",
      status: "pending",
      priority: "P1",
      module: "未分类",
      parentId: null,
      order: baseOrder + 0.5,
      type: "feature",
      tags: [],
      source: "manual",
      confidence: "manual",
      createdAt: now,
      updatedAt: now
    };

    const nextItems = normalizeItemOrders([...items, newItem]);
    persistItems(nextItems);
    setSelectedItemId(newItem.id);
  };

  const handleRowDrop = (targetId: string) => {
    if (!draggedRowId || draggedRowId === targetId) {
      setDraggedRowId(null);
      return;
    }

    const ordered = [...items].sort((left, right) => left.order - right.order);
    const sourceIndex = ordered.findIndex((item) => item.id === draggedRowId);
    const targetIndex = ordered.findIndex((item) => item.id === targetId);

    if (sourceIndex < 0 || targetIndex < 0) {
      setDraggedRowId(null);
      return;
    }

    const [moved] = ordered.splice(sourceIndex, 1);
    ordered.splice(targetIndex, 0, moved);
    persistItems(normalizeItemOrders(ordered));
    setDraggedRowId(null);
  };

  const handleSelectionDragStart = (itemId: string, checked: boolean) => {
    selectionDragStateRef.current = {
      active: true,
      shouldSelect: checked
    };
    toggleRowSelection(itemId, checked);

    const handlePointerUp = () => {
      selectionDragStateRef.current = null;
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleSelectionDragEnter = (itemId: string) => {
    const dragState = selectionDragStateRef.current;
    if (!dragState?.active) {
      return;
    }
    toggleRowSelection(itemId, dragState.shouldSelect);
  };

  const handleToggleNodeCollapse = (nodeId: string) => {
    setCollapsedNodeIds((current) => current.includes(nodeId)
      ? current.filter((id) => id !== nodeId)
      : [...current, nodeId]
    );
  };

  const handleColumnResizeStart = (
    event: React.PointerEvent<HTMLDivElement>,
    key: keyof typeof defaultColumnWidths
  ) => {
    event.preventDefault();
    event.stopPropagation();

    columnResizeStateRef.current = {
      key,
      startX: event.clientX,
      originWidth: columnWidths[key]
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const resizeState = columnResizeStateRef.current;
      if (!resizeState) {
        return;
      }

      const deltaX = moveEvent.clientX - resizeState.startX;
      setColumnWidths((current) => ({
        ...current,
        [resizeState.key]: Math.max(90, resizeState.originWidth + deltaX)
      }));
    };

    const handlePointerUp = () => {
      columnResizeStateRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const renderTableView = () => (
    <div className="flex h-[calc(100vh-220px)] min-h-0 flex-col rounded-3xl bg-white px-3 py-3 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Select value={activeViewId} onValueChange={handleSwitchSavedView}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="选择视图" />
            </SelectTrigger>
            <SelectContent>
              {savedViews.map((view) => (
                <SelectItem key={view.id} value={view.id}>
                  {view.name}{view.id === defaultViewId ? " · 默认" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={handleSaveCurrentView}>
            保存视图
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleCreateSavedView}>
            新建视图
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                视图管理
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 space-y-3 p-3">
              <DropdownMenuLabel className="px-0">当前视图管理</DropdownMenuLabel>
              <Input
                value={savedViews.find((view) => view.id === activeViewId)?.name ?? ""}
                onChange={(event) => handleRenameActiveView(event.target.value)}
                placeholder="视图名称"
              />
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="flex-1" onClick={handleDuplicateActiveView}>
                  复制视图
                </Button>
                <Button type="button" variant="outline" size="sm" className="flex-1" onClick={handleSetDefaultView}>
                  设为默认
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={savedViews.findIndex((view) => view.id === activeViewId) <= 0}
                  onClick={() => handleMoveActiveView("up")}
                >
                  上移
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={savedViews.findIndex((view) => view.id === activeViewId) >= savedViews.length - 1}
                  onClick={() => handleMoveActiveView("down")}
                >
                  下移
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-[var(--color-border)] bg-slate-50 px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
                <div>
                  <div className="font-medium text-slate-700">搜索</div>
                  <div className="truncate">{searchQuery || "未设置"}</div>
                </div>
                <div>
                  <div className="font-medium text-slate-700">状态</div>
                  <div>{statusFilter === "all" ? "全部" : statusFilter}</div>
                </div>
                <div>
                  <div className="font-medium text-slate-700">优先级</div>
                  <div>{priorityFilter === "all" ? "全部" : priorityFilter}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 text-rose-600"
                  disabled={savedViews.length <= 1}
                  onClick={handleDeleteActiveView}
                >
                  删除视图
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-2">
                <SlidersHorizontal className="size-4" />
                列设置
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>显示列</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={visibleColumns.status} onCheckedChange={(checked) => setVisibleColumns((current) => ({ ...current, status: Boolean(checked) }))}>
                状态
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleColumns.priority} onCheckedChange={(checked) => setVisibleColumns((current) => ({ ...current, priority: Boolean(checked) }))}>
                优先级
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleColumns.module} onCheckedChange={(checked) => setVisibleColumns((current) => ({ ...current, module: Boolean(checked) }))}>
                模块
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleColumns.description} onCheckedChange={(checked) => setVisibleColumns((current) => ({ ...current, description: Boolean(checked) }))}>
                描述
              </DropdownMenuCheckboxItem>
              {customColumns.length > 0 ? <DropdownMenuSeparator /> : null}
              {customColumns.map((column) => (
                <div key={column.id} className="space-y-2 px-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <DropdownMenuCheckboxItem
                      checked={column.visible}
                      onCheckedChange={(checked) => setCustomColumns((current) => current.map((item) => item.id === column.id ? { ...item, visible: Boolean(checked) } : item))}
                      className="flex-1"
                    >
                      显示
                    </DropdownMenuCheckboxItem>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-rose-600"
                      onClick={() => handleDeleteCustomColumn(column.id)}
                    >
                      删除
                    </Button>
                  </div>
                  <Input
                    value={column.name}
                    onChange={(event) => handleRenameCustomColumn(column.id, event.target.value)}
                    placeholder="列名称"
                    className="h-8"
                  />
                  <div className="text-[11px] text-[var(--color-text-secondary)]">
                    {column.type === "select"
                      ? `单选列 · ${(column.options ?? []).join(" / ")}`
                      : "文本列"}
                  </div>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-2">
                <ChevronsUpDown className="size-4" />
                排序
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>排序字段</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
                <DropdownMenuRadioItem value="order">录入顺序</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="title">标题</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="status">状态</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="priority">优先级</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="module">模块</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="updatedAt">更新时间</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={sortDirection} onValueChange={(value) => setSortDirection(value as "asc" | "desc")}>
                <DropdownMenuRadioItem value="asc">升序</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="desc">降序</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-[170px]">
              <Filter className="mr-2 size-4 text-[var(--color-text-secondary)]" />
              <SelectValue placeholder="模块筛选" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部模块</SelectItem>
              {groupedModules.map((module) => (
                <SelectItem key={module} value={module}>{module}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-2">
                <Palette className="size-4" />
                新增列
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80 space-y-3 p-3">
              <DropdownMenuLabel className="px-0">数据库列配置</DropdownMenuLabel>
              <Input value={newColumnName} onChange={(event) => setNewColumnName(event.target.value)} placeholder="列名称，如 负责人、版本、来源类型" />
              <Select value={newColumnType} onValueChange={(value) => setNewColumnType(value as "text" | "select")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">文本列</SelectItem>
                  <SelectItem value="select">单选列</SelectItem>
                </SelectContent>
              </Select>
              {newColumnType === "select" ? (
                <Input value={newColumnOptions} onChange={(event) => setNewColumnOptions(event.target.value)} placeholder="用逗号分隔选项，如 未开始,进行中,已完成" />
              ) : null}
              <Button type="button" className="w-full" onClick={handleAddCustomColumn}>
                添加列
              </Button>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {hasSelection ? (
        <div className="mb-3 flex items-center justify-between rounded-2xl bg-slate-950 px-4 py-3 text-white">
          <div className="text-sm font-medium">已选择 {selectedRowIds.length} 条需求点</div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedRowIds([])}>
              取消选择
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={handleBulkDelete}>
              <Trash2 className="mr-1 size-4" />
              批量删除
            </Button>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[1250px]">
          <div
            className="group grid items-center px-2 py-2 text-xs font-medium text-[var(--color-text-secondary)]"
            style={{ gridTemplateColumns: tableGridWithCustomTemplate }}
          >
            {visibleTableColumns.map((column) => (
              <div key={column.key} className="relative flex h-10 items-center px-3">
                {column.key === "control" ? (
                  <div className={`transition-opacity ${hasSelection || hoveredRowId ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                    <Checkbox checked={allFilteredSelected} onCheckedChange={(checked) => toggleAllFilteredRows(Boolean(checked))} />
                  </div>
                ) : (
                  <span>{column.label}</span>
                )}
                {column.resizable ? (
                  <div
                    className="absolute right-0 top-1/2 h-6 w-3 -translate-y-1/2 cursor-col-resize"
                    onPointerDown={(event) => handleColumnResizeStart(event, column.key as keyof typeof defaultColumnWidths)}
                  >
                    <div className="mx-auto h-full w-px bg-slate-200" />
                  </div>
                ) : null}
              </div>
            ))}
            {visibleCustomColumns.map((column) => (
              <div key={column.id} className="relative flex h-10 items-center px-3">
                <span>{column.name}</span>
              </div>
            ))}
          </div>
          <div className="space-y-0.5">
            {filteredItems.length === 0 ? (
              <div className="px-6 py-10 text-sm text-[var(--color-text-secondary)]">
                暂无需求点，先在顶部快速输入，或点击“新增需求点”开始。
              </div>
            ) : filteredItems.map((item) => {
              const isSelected = item.id === selectedItemId;
              const isChecked = selectedRowIds.includes(item.id);
              const isHovered = hoveredRowId === item.id;
              const isDragTarget = draggedRowId === item.id;

              return (
                <div
                  key={item.id}
                  data-workspace-row-id={item.id}
                  draggable
                  onClick={() => {
                    setSelectedItemId(item.id);
                    const linkedNodeIds = businessModelGraph.nodes
                      .filter((node) => node.relatedRequirementIds.includes(item.id))
                      .map((node) => node.id);
                    setSelectedBusinessNodeIds(linkedNodeIds);
                    setSelectedBusinessNodeId(linkedNodeIds[0] ?? null);
                    setSelectedBusinessEdgeId(null);
                  }}
                  onDragStart={() => setDraggedRowId(item.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleRowDrop(item.id)}
                  onDragEnd={() => setDraggedRowId(null)}
                  onMouseEnter={() => setHoveredRowId(item.id)}
                  onMouseLeave={() => setHoveredRowId((current) => current === item.id ? null : current)}
                  className={`group grid items-center rounded-2xl px-2 py-1 transition-all ${
                    isSelected ? "bg-slate-50" : "hover:bg-slate-50/80"
                  } ${isDragTarget ? "opacity-50" : ""}`}
                  style={{ gridTemplateColumns: tableGridWithCustomTemplate }}
                >
                  <div className="flex items-center gap-1 px-3">
                    <button
                      type="button"
                      onClick={() => handleAddBelow(item.id)}
                      className={`rounded-md p-1 text-slate-400 transition hover:bg-white hover:text-slate-700 ${
                        isHovered || isChecked ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <PlusCircle className="size-4" />
                    </button>
                    <div className={`transition-opacity ${isHovered || isChecked ? "opacity-100" : "opacity-0"}`}>
                      <Checkbox
                        checked={isChecked}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          handleSelectionDragStart(item.id, !isChecked);
                        }}
                        onCheckedChange={(checked) => toggleRowSelection(item.id, Boolean(checked))}
                      />
                    </div>
                    <GripVertical className={`size-4 text-slate-300 transition ${isHovered ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} />
                  </div>
                  <div className="px-3 py-2" onPointerEnter={() => handleSelectionDragEnter(item.id)}>
                    <Input
                      value={item.title}
                      onFocus={() => setSelectedItemId(item.id)}
                      onChange={(event) => updateItem(item.id, { title: event.target.value })}
                      className="h-9 border-transparent bg-transparent px-0 text-sm font-medium text-slate-900 shadow-none focus-visible:border-transparent focus-visible:ring-0"
                    />
                    <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      {item.tags.length > 0 ? item.tags.join(" · ") : "无标签"}
                    </div>
                  </div>
                  {visibleColumns.status ? (
                    <div className="px-3 py-2" onPointerEnter={() => handleSelectionDragEnter(item.id)}>
                      <Select value={item.status} onValueChange={(value) => updateItem(item.id, { status: value as WorkspaceRequirementItem["status"] })}>
                        <SelectTrigger className="h-9 border-transparent bg-transparent px-0 text-sm shadow-none focus:ring-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">待确认</SelectItem>
                          <SelectItem value="confirmed">已确认</SelectItem>
                          <SelectItem value="rejected">已排除</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {visibleColumns.priority ? (
                    <div className="px-3 py-2" onPointerEnter={() => handleSelectionDragEnter(item.id)}>
                      <Select value={item.priority} onValueChange={(value) => updateItem(item.id, { priority: value as WorkspaceRequirementItem["priority"] })}>
                        <SelectTrigger className="h-9 border-transparent bg-transparent px-0 text-sm shadow-none focus:ring-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="P0">P0</SelectItem>
                          <SelectItem value="P1">P1</SelectItem>
                          <SelectItem value="P2">P2</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {visibleColumns.module ? (
                    <div className="px-3 py-2" onPointerEnter={() => handleSelectionDragEnter(item.id)}>
                      <Input
                        value={item.module}
                        onFocus={() => setSelectedItemId(item.id)}
                        onChange={(event) => updateItem(item.id, { module: event.target.value })}
                        className="h-9 border-transparent bg-transparent px-0 text-sm text-slate-700 shadow-none focus-visible:border-transparent focus-visible:ring-0"
                      />
                    </div>
                  ) : null}
                  {visibleColumns.description ? (
                    <div className="px-3 py-2" onPointerEnter={() => handleSelectionDragEnter(item.id)}>
                      <Input
                        value={item.description}
                        onFocus={() => setSelectedItemId(item.id)}
                        onChange={(event) => updateItem(item.id, { description: event.target.value })}
                        placeholder="补充需求说明、规则、评论和来源要点"
                        className="h-9 border-transparent bg-transparent px-0 text-sm text-[var(--color-text-secondary)] shadow-none focus-visible:border-transparent focus-visible:ring-0"
                      />
                    </div>
                  ) : null}
                  {visibleCustomColumns.map((column) => (
                    <div key={column.id} className="px-3 py-2" onPointerEnter={() => handleSelectionDragEnter(item.id)}>
                      {column.type === "select" ? (
                        <Select
                          value={item.customFields?.[column.id] ?? ""}
                          onValueChange={(value) => updateCustomFieldValue(item.id, column.id, value)}
                        >
                          <SelectTrigger className={`h-9 border-transparent px-0 text-sm shadow-none focus:ring-0 ${getSelectToneClass(item.customFields?.[column.id]) || "bg-transparent"}`}>
                            <SelectValue placeholder="请选择" />
                          </SelectTrigger>
                          <SelectContent>
                            {(column.options ?? []).map((option) => (
                              <SelectItem key={option} value={option}>{option}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={item.customFields?.[column.id] ?? ""}
                          onFocus={() => setSelectedItemId(item.id)}
                          onChange={(event) => updateCustomFieldValue(item.id, column.id, event.target.value)}
                          className="h-9 border-transparent bg-transparent px-0 text-sm text-slate-700 shadow-none focus-visible:border-transparent focus-visible:ring-0"
                        />
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  const renderDocumentsView = () => (
    <div className="flex h-[calc(100%)] min-h-0 min-w-0 gap-6">
      {showDocumentList ? (
        <div className="flex w-[280px] shrink-0 flex-col rounded-3xl border border-[var(--color-border)] bg-white shadow-sm">
          <div className="border-b border-[var(--color-border)] px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">文档列表</div>
                <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                  管理当前项目的正式需求文档。
                </div>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowDocumentList(false)}>
                <PanelRightClose className="size-4" />
              </Button>
            </div>
            <div className="mt-3">
              <Button type="button" size="sm" onClick={handleCreateDocument}>
                <Plus className="mr-1 size-4" />
                新建
              </Button>
            </div>
            <div className="mt-3">
              <Input
                value={documentSearchQuery}
                onChange={(event) => setDocumentSearchQuery(event.target.value)}
                placeholder="搜索文档标题或内容"
              />
            </div>
            <div className="mt-3">
              <Select value={documentSortMode} onValueChange={(value) => setDocumentSortMode(value as typeof documentSortMode)}>
                <SelectTrigger>
                  <SelectValue placeholder="排序方式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">手动排序</SelectItem>
                  <SelectItem value="updatedAt">最近更新</SelectItem>
                  <SelectItem value="title">按标题排序</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="space-y-2 p-3">
              {filteredDocuments.length > 0 ? filteredDocuments.map((document) => {
                const active = document.id === selectedDocumentId;
                return (
                  <button
                    key={document.id}
                    type="button"
                    draggable={canManualReorderDocuments}
                    onClick={() => setSelectedDocumentId(document.id)}
                    onDragStart={() => {
                      if (!canManualReorderDocuments) {
                        return;
                      }
                      setDraggedDocumentId(document.id);
                    }}
                    onDragOver={(event) => {
                      if (!canManualReorderDocuments) {
                        return;
                      }
                      event.preventDefault();
                    }}
                    onDrop={() => {
                      if (!canManualReorderDocuments) {
                        return;
                      }
                      void handleDocumentDrop(document.id);
                    }}
                    onDragEnd={() => setDraggedDocumentId(null)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                      active
                        ? "border-slate-300 bg-slate-100 text-slate-950"
                        : "border-transparent bg-white text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                    } ${draggedDocumentId === document.id ? "opacity-50" : ""}`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <GripVertical className="size-4 shrink-0 text-slate-300" />
                      <div className="min-w-0 flex-1 truncate text-sm font-medium">{document.title}</div>
                    </div>
                    <div className="mt-2 truncate text-[11px] text-[var(--color-text-secondary)]">
                      {new Date(document.updatedAt).toLocaleString()}
                    </div>
                  </button>
                );
              }) : (
                <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-slate-50 px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                  {documents.length > 0 ? "没有匹配到文档。" : "还没有需求文档，先新建一份开始编辑。"}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 items-start">
          <Button type="button" variant="outline" className="rounded-full" onClick={() => setShowDocumentList(true)}>
            <PanelRightOpen className="mr-2 size-4" />
          </Button>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-3xl border border-[var(--color-border)] bg-white shadow-sm">
        {selectedDocument ? (
          <>
            <div className="border-b border-[var(--color-border)] px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <Input
                  value={selectedDocument.title}
                  onChange={(event) => handleUpdateDocumentTitle(selectedDocument.id, event.target.value)}
                  className="border-none px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
                  placeholder="输入文档标题"
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="icon">
                      <Ellipsis className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent style={{ width: 160 }} align="end">
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => handleDuplicateDocument(selectedDocument.id)}
                    >
                      <Copy className="mr-2 size-4" />
                      复制文档
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-start text-rose-600"
                      onClick={() => handleDeleteDocument(selectedDocument.id)}
                    >
                      <Trash2 className="mr-2 size-4" />
                      删除文档
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={handleOpenDocumentHistory}
                    >
                      <RefreshCcw className="mr-2 size-4" />
                      历史版本
                    </Button>
                    <Button type="button" variant="ghost" className="w-full justify-start" onClick={handleExportDocumentPdf}>
                      <Printer className="mr-2 size-4" />
                      导出 PDF
                    </Button>
                    <Button type="button" variant="ghost" className="w-full justify-start" onClick={handleExportDocumentDocx}>
                      <Download className="mr-2 size-4" />
                      导出 DOCX
                    </Button>
                    <Button type="button" variant="ghost" className="w-full justify-start" onClick={handleExportDocumentEmailHtml}>
                      <Mail className="mr-2 size-4" />
                      导出 HTML
                    </Button>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
          </div>
            <div className="min-h-0 flex-1 overflow-auto px-1 pb-2" style={{ fontFamily: documentFontFamily }}>
              <BlockNoteView
                editor={documentEditor}
                theme="light"
                className="workspace-document-editor min-h-full"
                slashMenu
                filePanel
                onSelectionChange={() => {
                  syncDocumentSelectionContext();
                }}
                onChange={() => {
                  queueDocumentSave();
                }}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[var(--color-text-secondary)]">
            从左侧选择一份文档开始编辑，或者先新建一份需求文档。
          </div>
        )}
      </div>
    </div>
  );

  const renderTreeNodes = (parentId: string | null, depth = 0): ReactNode[] => {
    return filteredItems
      .filter((item) => item.parentId === parentId)
      .sort((left, right) => left.order - right.order)
      .flatMap((item) => {
        const isSelected = item.id === selectedItemId;
        return [
          <button
            key={item.id}
            type="button"
            data-workspace-tree-id={item.id}
            onClick={() => {
              setSelectedItemId(item.id);
              const linkedNodeIds = businessModelGraph.nodes
                .filter((node) => node.relatedRequirementIds.includes(item.id))
                .map((node) => node.id);
              setSelectedBusinessNodeIds(linkedNodeIds);
              setSelectedBusinessNodeId(linkedNodeIds[0] ?? null);
              setSelectedBusinessEdgeId(null);
            }}
            className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
              isSelected ? "border-[var(--color-accent)] bg-sky-50" : "border-[var(--color-border)] bg-white hover:bg-slate-50"
            }`}
            style={{ marginLeft: depth * 24 }}
          >
            <ChevronRight className="size-4 text-[var(--color-text-secondary)]" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-900">{item.title}</div>
              <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {item.module} · {item.priority}
              </div>
            </div>
            <StatusBadge status={item.status} />
          </button>,
          ...renderTreeNodes(item.id, depth + 1)
        ];
      });
  };

  const renderTreeView = () => (
    <ScrollArea className="h-[calc(100vh-220px)] rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
      <div className="space-y-3">
        {renderTreeNodes(null).length > 0 ? renderTreeNodes(null) : (
          <div className="px-2 py-8 text-sm text-[var(--color-text-secondary)]">暂无树形结构，可先在表格里新增需求点。</div>
        )}
      </div>
    </ScrollArea>
  );

  const renderBusinessModelView = () => {
    const businessPoolItems = filteredItems.filter((item) => {
      if (!businessRequirementQuery.trim()) {
        return true;
      }
      const keyword = businessRequirementQuery.trim().toLowerCase();
      return [item.title, item.description, item.module, item.tags.join(" ")].join(" ").toLowerCase().includes(keyword);
    });
    const nodeMap = new Map(businessGraphNodesForRender.map((node) => [node.id, node]));
    const businessTransform = `translate(${businessCanvasOffset.x}px, ${businessCanvasOffset.y}px) scale(${businessCanvasScale})`;

    return (
      <div className="flex h-[calc(100vh-220px)] min-h-0 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-white shadow-sm">
        <aside className="flex w-[280px] shrink-0 select-none flex-col border-r border-[var(--color-border)] bg-slate-50/80">
          <div className="border-b border-[var(--color-border)] px-4 py-4">
            <div className="text-sm font-semibold text-slate-900">需求池</div>
            <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
              拖入画布生成节点，节点会保留和需求点的关联。
            </div>
            <Input
              className="mt-3"
              value={businessRequirementQuery}
              onChange={(event) => setBusinessRequirementQuery(event.target.value)}
              placeholder="搜索需求点"
            />
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-3">
              {businessPoolItems.map((item) => {
                const related = selectedBusinessNode?.relatedRequirementIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/aipm-requirement-id", item.id)}
                    className={`rounded-2xl border px-3 py-3 transition ${
                      related
                        ? "border-sky-300 bg-sky-50"
                        : "border-[var(--color-border)] bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 break-all text-sm font-medium leading-5 text-slate-900">{item.title}</div>
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-text-secondary)]">{item.description || "暂无描述"}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <PriorityBadge priority={item.priority} />
                          <Badge variant="outline">{item.module}</Badge>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => addRequirementToBusinessModel(item)}>
                        <Plus className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
            <Tabs value={businessModelGraph.mode} onValueChange={(value) => switchBusinessMode(value as BusinessModelMode)}>
              <TabsList>
                <TabsTrigger value="flow">流程</TabsTrigger>
                <TabsTrigger value="state">状态</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={addEmptyBusinessNode}>
                <Plus className="mr-1 size-4" />
                新建节点
              </Button>
              <Button size="sm" variant="outline" onClick={handleAutoLayoutBusinessModel}>
                <RefreshCcw className="mr-1 size-4" />
                自动布局
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBusinessCanvasScale((current) => Math.max(0.6, Number((current * 0.92).toFixed(2))))}>
                缩小
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBusinessCanvasScale((current) => Math.min(1.8, Number((current * 1.08).toFixed(2))))}>
                放大
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setBusinessCanvasScale(1);
                  setBusinessCanvasOffset({ x: 0, y: 0 });
                }}
              >
                还原
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={businessModelGraph.mode !== "flow"}
                onClick={handleGenerateStateModel}
              >
                <ArrowRight className="mr-1 size-4" />
                生成状态机
              </Button>
              <Button size="sm" variant="outline" onClick={handleValidateBusinessModel}>
                校验
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={selectedBusinessNodeIds.length === 0}
                onClick={() => void handleCopySelectedBusinessNodes()}
              >
                <Copy className="mr-1 size-4" />
                复制节点
              </Button>
              <Button size="sm" variant="outline" onClick={handlePasteBusinessNodes}>
                粘贴节点
              </Button>
              <Button
                size="sm"
                variant={linkSourceNodeId ? "default" : "outline"}
                disabled={!selectedBusinessNode}
                onClick={() => setLinkSourceNodeId((current) => current === selectedBusinessNodeId ? null : selectedBusinessNodeId)}
              >
                <Link2 className="mr-1 size-4" />
                {linkSourceNodeId ? "取消连线" : "开始连线"}
              </Button>
              {selectedBusinessNodeIds.length > 0 ? (
                <>
                  <div className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                    已选 {selectedBusinessNodeIds.length} 个节点，可拖动任意选中节点整体移动
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelectedBusinessNodeIds([]);
                      setSelectedBusinessNodeId(null);
                      setSelectedBusinessEdgeId(null);
                    }}
                  >
                    取消选择
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-rose-600"
                    onClick={() => {
                      updateBusinessModelGraph((current) => ({
                        ...current,
                        nodes: current.nodes.filter((node) => !selectedBusinessNodeIds.includes(node.id)),
                        edges: current.edges.filter((edge) => !selectedBusinessNodeIds.includes(edge.source) && !selectedBusinessNodeIds.includes(edge.target))
                      }));
                      setSelectedBusinessNodeIds([]);
                      setSelectedBusinessNodeId(null);
                      setSelectedBusinessEdgeId(null);
                    }}
                  >
                    <Trash2 className="mr-1 size-4" />
                    批量删除
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          <div
            ref={businessCanvasRef}
            className={`relative min-h-0 flex-1 select-none overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] ${
              businessSpacePanActive ? "cursor-grab" : ""
            }`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleBusinessCanvasDrop}
            onPointerDown={(event) => {
              if (!businessCanvasRef.current) {
                return;
              }
              const target = event.target as HTMLElement | null;
              const isInteractiveTarget = Boolean(
                target?.closest("[data-business-node='true'], [data-business-edge='true'], button, input, textarea")
              );
              if ((businessSpacePanActive || event.altKey || event.button === 1) && !isInteractiveTarget) {
                businessCanvasPanStateRef.current = {
                  startX: event.clientX,
                  startY: event.clientY,
                  originX: businessCanvasOffset.x,
                  originY: businessCanvasOffset.y
                };
                return;
              }
              if (isInteractiveTarget) {
                return;
              }
              const rect = businessCanvasRef.current.getBoundingClientRect();
              const scenePoint = toBusinessScenePoint(
                event.clientX - rect.left,
                event.clientY - rect.top,
                businessCanvasOffset,
                businessCanvasScale
              );
              businessSelectionStateRef.current = {
                startX: scenePoint.x,
                startY: scenePoint.y
              };
              setBusinessSelectionRect({
                x: scenePoint.x,
                y: scenePoint.y,
                width: 0,
                height: 0
              });
            }}
            onPointerMove={handleBusinessCanvasPointerMove}
            onPointerUp={handleBusinessCanvasPointerUp}
            onPointerLeave={handleBusinessCanvasPointerUp}
            onWheel={(event) => {
              event.preventDefault();
              const rect = businessCanvasRef.current?.getBoundingClientRect();
              if (!rect) {
                return;
              }
              const cursorX = event.clientX - rect.left;
              const cursorY = event.clientY - rect.top;
              const sceneX = (cursorX - businessCanvasOffset.x) / businessCanvasScale;
              const sceneY = (cursorY - businessCanvasOffset.y) / businessCanvasScale;
              const nextScale = Math.min(1.8, Math.max(0.6, Number((businessCanvasScale * (event.deltaY < 0 ? 1.08 : 0.92)).toFixed(2))));
              setBusinessCanvasScale(nextScale);
              setBusinessCanvasOffset({
                x: cursorX - sceneX * nextScale,
                y: cursorY - sceneY * nextScale
              });
            }}
            onClick={() => {
              setSelectedBusinessNodeId(null);
              setSelectedBusinessEdgeId(null);
              setLinkSourceNodeId(null);
              setSelectedBusinessNodeIds([]);
            }}
          >
            <div className="absolute left-0 top-0 origin-top-left" style={{ transform: businessTransform, width: BUSINESS_SCENE_WIDTH, height: BUSINESS_SCENE_HEIGHT }}>
            <svg className="pointer-events-none absolute left-0 top-0" width={BUSINESS_SCENE_WIDTH} height={BUSINESS_SCENE_HEIGHT}>
              {businessModelGraph.edges.map((edge) => {
                const source = nodeMap.get(edge.source);
                const target = nodeMap.get(edge.target);
                if (!source || !target) {
                  return null;
                }
                const startX = source.position.x + 172;
                const startY = source.position.y + 36;
                const endX = target.position.x;
                const endY = target.position.y + 36;
                const selected = edge.id === selectedBusinessEdgeId;
                return (
                  <g key={edge.id}>
                    <path
                      d={`M ${startX} ${startY} C ${startX + 60} ${startY}, ${endX - 60} ${endY}, ${endX} ${endY}`}
                      fill="none"
                      stroke={selected ? "#0284c7" : "#cbd5e1"}
                      strokeWidth={selected ? 3 : 2}
                      strokeLinecap="round"
                    />
                    <circle cx={endX} cy={endY} r={4} fill={selected ? "#0284c7" : "#94a3b8"} />
                    {selected ? (
                      <>
                        <circle
                          cx={startX}
                          cy={startY}
                          r={7}
                          fill="#ffffff"
                          stroke="#0ea5e9"
                          strokeWidth={2}
                          className="pointer-events-auto cursor-crosshair"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            businessEdgeDragStateRef.current = { sourceNodeId: edge.source };
                            setBusinessReconnectState({ edgeId: edge.id, end: "source" });
                            setBusinessLinkPreview({ x: startX, y: startY });
                          }}
                        />
                        <circle
                          cx={endX}
                          cy={endY}
                          r={7}
                          fill="#ffffff"
                          stroke="#0ea5e9"
                          strokeWidth={2}
                          className="pointer-events-auto cursor-crosshair"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            businessEdgeDragStateRef.current = { sourceNodeId: edge.source };
                            setBusinessReconnectState({ edgeId: edge.id, end: "target" });
                            setBusinessLinkPreview({ x: endX, y: endY });
                          }}
                        />
                      </>
                    ) : null}
                    <path
                      d={`M ${startX} ${startY} C ${startX + 60} ${startY}, ${endX - 60} ${endY}, ${endX} ${endY}`}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={18}
                      className="pointer-events-auto cursor-pointer"
                      data-business-edge="true"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedBusinessEdgeId(edge.id);
                        setSelectedBusinessNodeId(null);
                        setSelectedBusinessNodeIds([]);
                      }}
                    />
                    {businessModelGraph.mode === "state" && edge.action ? (
                      <foreignObject
                        x={(startX + endX) / 2 - 56}
                        y={(startY + endY) / 2 - 14}
                        width={112}
                        height={32}
                      >
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedBusinessEdgeId(edge.id);
                            setSelectedBusinessNodeId(null);
                          }}
                          className="pointer-events-auto flex h-8 w-full items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 shadow-sm"
                        >
                          {edge.action}
                        </button>
                      </foreignObject>
                    ) : null}
                  </g>
                );
              })}
              {businessEdgeDragStateRef.current && businessLinkPreview ? (() => {
                const reconnectSourceId = businessReconnectState?.end === "source"
                  ? businessLinkHoverTargetId || businessEdgeDragStateRef.current.sourceNodeId
                  : businessEdgeDragStateRef.current.sourceNodeId;
                const sourceNode = nodeMap.get(reconnectSourceId);
                if (!sourceNode) {
                  return null;
                }
                const startX = sourceNode.position.x + BUSINESS_NODE_WIDTH;
                const startY = sourceNode.position.y + BUSINESS_NODE_HEIGHT / 2;
                return (
                  <path
                    d={`M ${startX} ${startY} C ${startX + 60} ${startY}, ${businessLinkPreview.x - 60} ${businessLinkPreview.y}, ${businessLinkPreview.x} ${businessLinkPreview.y}`}
                    fill="none"
                    stroke="#0ea5e9"
                    strokeWidth={2.5}
                    strokeDasharray="6 6"
                    strokeLinecap="round"
                  />
                );
              })() : null}
              {businessEdgeDragStateRef.current && businessLinkPreview ? (
                <foreignObject
                  x={businessLinkPreview.x + 12}
                  y={businessLinkPreview.y - 18}
                  width={220}
                  height={42}
                >
                  <div
                    xmlns="http://www.w3.org/1999/xhtml"
                    className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium shadow-sm ${
                      businessLinkHoverTargetId
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-500"
                    }`}
                  >
                    {businessLinkHoverTargetId
                      ? `${businessReconnectState ? "重连到" : "连接到"} ${nodeMapLabel(businessModelGraph.nodes, businessLinkHoverTargetId)}`
                      : "拖到目标节点上进行连接"}
                  </div>
                </foreignObject>
              ) : null}
              {businessSnapGuides?.x.map((guideX) => (
                <g key={`guide-x-${guideX}`}>
                  <line
                    x1={guideX}
                    y1={0}
                    x2={guideX}
                    y2={BUSINESS_SCENE_HEIGHT}
                    stroke="rgba(14,165,233,0.18)"
                    strokeWidth={6}
                  />
                  <line
                    x1={guideX}
                    y1={0}
                    x2={guideX}
                    y2={BUSINESS_SCENE_HEIGHT}
                    stroke="#0ea5e9"
                    strokeDasharray="6 6"
                    strokeWidth={1.5}
                  />
                </g>
              )) ?? null}
              {businessSnapGuides?.y.map((guideY) => (
                <g key={`guide-y-${guideY}`}>
                  <line
                    x1={0}
                    y1={guideY}
                    x2={BUSINESS_SCENE_WIDTH}
                    y2={guideY}
                    stroke="rgba(14,165,233,0.18)"
                    strokeWidth={6}
                  />
                  <line
                    x1={0}
                    y1={guideY}
                    x2={BUSINESS_SCENE_WIDTH}
                    y2={guideY}
                    stroke="#0ea5e9"
                    strokeDasharray="6 6"
                    strokeWidth={1.5}
                  />
                </g>
              )) ?? null}
            </svg>

            {businessGraphNodesForRender.map((node) => {
              const selected = selectedBusinessNodeIds.includes(node.id) || node.id === selectedBusinessNodeId;
              const linkedToCurrentRequirement = relatedBusinessNodeIds.includes(node.id);
              const isLinkHoverTarget = businessLinkHoverTargetId === node.id;
              const isFlashHighlighted = businessFlashNodeIds.includes(node.id);
              return (
                <div
                  key={node.id}
                  data-business-node="true"
                  className={`absolute w-[172px] select-none rounded-2xl border px-4 py-3 shadow-sm transition ${
                    businessModelGraph.mode === "state"
                      ? "bg-amber-50/95"
                      : "bg-white"
                  } ${
                    isFlashHighlighted
                      ? "border-fuchsia-500 shadow-[0_0_0_5px_rgba(217,70,239,0.2),0_0_0_10px_rgba(217,70,239,0.08),0_10px_24px_rgba(217,70,239,0.18)]"
                      : selected
                      ? "border-sky-500 shadow-[0_0_0_4px_rgba(14,165,233,0.18),0_10px_24px_rgba(14,165,233,0.18)]"
                        : linkedToCurrentRequirement
                        ? "border-emerald-400 shadow-[0_0_0_3px_rgba(16,185,129,0.18),0_8px_18px_rgba(16,185,129,0.12)]"
                          : isLinkHoverTarget
                          ? "border-violet-400 shadow-[0_0_0_3px_rgba(139,92,246,0.14)]"
                          : "border-[var(--color-border)]"
                  }`}
                  style={{
                    left: node.position.x,
                    top: node.position.y
                  }}
                  onPointerDown={(event) => handleBusinessNodePointerDown(event, node.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (linkSourceNodeId && linkSourceNodeId !== node.id) {
                      createBusinessEdge(linkSourceNodeId, node.id);
                      setLinkSourceNodeId(null);
                      return;
                    }
                    setSelectedBusinessNodeId(node.id);
                    setSelectedBusinessEdgeId(null);
                    setSelectedBusinessNodeIds((event.shiftKey || event.metaKey)
                      ? (selectedBusinessNodeIds.includes(node.id)
                        ? selectedBusinessNodeIds.filter((id) => id !== node.id)
                        : [...selectedBusinessNodeIds, node.id])
                      : [node.id]);
                    setSelectedItemId(node.relatedRequirementIds[0] ?? null);
                  }}
                  onPointerEnter={() => {
                    if (businessEdgeDragStateRef.current && businessEdgeDragStateRef.current.sourceNodeId !== node.id) {
                      setBusinessLinkHoverTargetId(node.id);
                    }
                  }}
                  onPointerLeave={() => {
                    if (businessLinkHoverTargetId === node.id) {
                      setBusinessLinkHoverTargetId(null);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="absolute -left-2 top-1/2 z-10 h-3 w-3 -translate-y-1/2 rounded-full border border-white bg-slate-300 shadow"
                    onPointerUp={(event) => {
                      event.stopPropagation();
                      if (businessEdgeDragStateRef.current && businessEdgeDragStateRef.current.sourceNodeId !== node.id) {
                        createBusinessEdge(businessEdgeDragStateRef.current.sourceNodeId, node.id);
                        businessEdgeDragStateRef.current = null;
                        setBusinessLinkPreview(null);
                        setBusinessLinkHoverTargetId(null);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="absolute -right-2 top-1/2 z-10 h-3 w-3 -translate-y-1/2 rounded-full border border-white bg-sky-500 shadow"
                    onPointerDown={(event) => handleBusinessEdgeHandlePointerDown(event, node.id)}
                  />
                  <div className="text-xs font-medium uppercase tracking-[0.08em] text-slate-400">
                    {node.type === "state" ? "State" : "Action"}
                  </div>
                  <div className="mt-1 text-sm font-semibold leading-6 text-slate-900">{node.label}</div>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                      {node.meta?.priority ? <PriorityBadge priority={node.meta.priority} /> : null}
                      {node.meta?.module ? <Badge variant="outline">{node.meta.module}</Badge> : null}
                    </div>
                    {businessCounterpartNodeIds.includes(node.id) ? (
                      <div className="mt-2 text-[11px] font-medium text-violet-600">对应另一视图节点</div>
                    ) : null}
                  </div>
                );
              })}

            {businessSelectionRect ? (
              <div
                className="pointer-events-none absolute border border-sky-400 bg-sky-100/30"
                style={{
                  left: businessSelectionRect.x,
                  top: businessSelectionRect.y,
                  width: businessSelectionRect.width,
                  height: businessSelectionRect.height
                }}
              />
            ) : null}
            </div>

            {businessModelGraph.nodes.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white/90 px-8 py-10 text-center shadow-sm">
                  <div className="text-lg font-semibold text-slate-900">从左侧拖入需求点，开始业务建模</div>
                  <div className="mt-2 text-sm text-[var(--color-text-secondary)]">
                    先搭流程，再一键生成状态机，后面可以作为 PRD 的骨架继续往下走。
                  </div>
                  <div className="mt-3 text-xs text-slate-500">
                    按住 <span className="font-semibold">Alt</span> 或中键可平移画布，滚轮可缩放，支持复制/粘贴节点。
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const renderMindMapView = () => {
    const nodes = buildMindMapNodes(filteredItems, collapsedNodeIds);
    const displayNodes = mindMapNodePreviewPosition
      ? nodes.map((node) => node.id === mindMapNodePreviewPosition.nodeId
          ? { ...node, x: mindMapNodePreviewPosition.x, y: mindMapNodePreviewPosition.y }
          : node)
      : nodes;
    const nodeMap = new Map(displayNodes.map((node) => [node.id, node]));
    const transform = `translate(${mindMapOffset.x} ${mindMapOffset.y}) scale(${mindMapScale})`;
    const dropTargetNode = mindMapDropTargetId ? displayNodes.find((node) => node.id === mindMapDropTargetId) ?? null : null;
    const draggedNode = mindMapNodePreviewPosition ? displayNodes.find((node) => node.id === mindMapNodePreviewPosition.nodeId) ?? null : null;
    const mountTargetMeta = draggedNode
      ? resolveMindMapMountTarget(displayNodes, draggedNode.x + draggedNode.width, draggedNode.y + draggedNode.height / 2, draggedNode.id, draggedNode)
      : null;
    const mountLine = draggedNode && dropTargetNode
      ? {
          startX: draggedNode.x + draggedNode.width,
          startY: draggedNode.y + draggedNode.height / 2,
          endX: dropTargetNode.x + dropTargetNode.width,
          endY: dropTargetNode.y + dropTargetNode.height / 2
        }
      : null;
    const mountBar = mountTargetMeta
      ? {
          x: mountTargetMeta.anchorX + 10,
          y: mountTargetMeta.anchorY - 26,
          width: 4,
          height: 52,
          tone: mindMapDropInvalid
            ? { fill: "#fb7185", glow: "rgba(244,63,94,0.22)" }
            : { fill: "#14b8a6", glow: "rgba(20,184,166,0.26)" }
        }
      : null;

    const handleMindMapPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-mindmap-node='true']")) {
        return;
      }

      mindMapDragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: mindMapOffset.x,
        originY: mindMapOffset.y
      };
      setMindMapDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleMindMapPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
      const nodeDragState = mindMapNodeDragStateRef.current;
      const nodeResizeState = mindMapNodeResizeStateRef.current;
      if (nodeResizeState) {
        const deltaX = (event.clientX - nodeResizeState.startX) / mindMapScale;
        const deltaY = (event.clientY - nodeResizeState.startY) / mindMapScale;
        updateMindMapStyle(nodeResizeState.nodeId, {
          width: Math.max(180, Math.round(nodeResizeState.originWidth + deltaX)),
          height: Math.max(72, Math.round(nodeResizeState.originHeight + deltaY))
        });
        return;
      }

      if (nodeDragState) {
        const viewport = mindMapViewportRef.current;
        if (!viewport) {
          return;
        }

        const rect = viewport.getBoundingClientRect();
        const sceneX = (event.clientX - rect.left - mindMapOffsetRef.current.x) / mindMapScale;
        const sceneY = (event.clientY - rect.top - mindMapOffsetRef.current.y) / mindMapScale;
        const currentNode = nodeMap.get(nodeDragState.nodeId);
        const hasExceededDragThreshold = Math.abs(sceneX - nodeDragState.startSceneX) > 2 || Math.abs(sceneY - nodeDragState.startSceneY) > 2;

        if (!hasExceededDragThreshold && !nodeDragState.moved) {
          return;
        }

        const rawPreviewX = sceneX - nodeDragState.offsetX;
        const rawPreviewY = sceneY - nodeDragState.offsetY;
        const previewTarget = currentNode
          ? resolveMindMapMountTarget(
              displayNodes,
              rawPreviewX + currentNode.width,
              rawPreviewY + currentNode.height / 2,
              nodeDragState.nodeId,
              currentNode
            )
          : null;
        const invalid = previewTarget ? isDescendant(items, nodeDragState.nodeId, previewTarget.node.id) : false;
        setMindMapDropTargetId(previewTarget?.node.id ?? null);
        setMindMapDropInvalid(invalid);
        if (currentNode) {
          const nextX = previewTarget && !invalid ? previewTarget.snapX : rawPreviewX;
          const nextY = previewTarget && !invalid ? previewTarget.snapY : rawPreviewY;
          const nextPreview = {
            nodeId: nodeDragState.nodeId,
            x: nextX,
            y: nextY
          };
          mindMapNodePreviewNextRef.current = nextPreview;
          if (mindMapNodePreviewRafRef.current === null) {
            mindMapNodePreviewRafRef.current = window.requestAnimationFrame(() => {
              const preview = mindMapNodePreviewNextRef.current;
              if (preview) {
                setMindMapNodePreviewPosition((currentPreview) => (
                  currentPreview
                  && currentPreview.nodeId === preview.nodeId
                  && Math.abs(currentPreview.x - preview.x) < 0.5
                  && Math.abs(currentPreview.y - preview.y) < 0.5
                    ? currentPreview
                    : preview
                ));
              }
              mindMapNodePreviewRafRef.current = null;
            });
          }
        }
        nodeDragState.moved = true;
        return;
      }

      const dragState = mindMapDragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      mindMapOffsetRef.current = {
        x: dragState.originX + deltaX,
        y: dragState.originY + deltaY
      };

      if (mindMapRafRef.current !== null) {
        return;
      }

      mindMapRafRef.current = window.requestAnimationFrame(() => {
        setMindMapOffset(mindMapOffsetRef.current);
        mindMapRafRef.current = null;
      });
    };

    const handleMindMapPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
      const nodeDragState = mindMapNodeDragStateRef.current;
      const nodeResizeState = mindMapNodeResizeStateRef.current;
      if (nodeResizeState) {
        mindMapNodeResizeStateRef.current = null;
      }
      if (nodeDragState) {
        const viewport = mindMapViewportRef.current;
        if (viewport) {
          const rect = viewport.getBoundingClientRect();
          const currentNode = nodeMap.get(nodeDragState.nodeId);
          const previewPosition = mindMapNodePreviewPosition?.nodeId === nodeDragState.nodeId
            ? mindMapNodePreviewPosition
            : null;
          const dropTarget = currentNode && previewPosition
            ? resolveMindMapMountTarget(
                displayNodes,
                previewPosition.x + currentNode.width,
                previewPosition.y + currentNode.height / 2,
                nodeDragState.nodeId,
                currentNode
              )
            : null;
          const movedItem = items.find((item) => item.id === nodeDragState.nodeId);
          const nextParentId = dropTarget && !isDescendant(items, nodeDragState.nodeId, dropTarget.node.id)
            ? (dropTarget.node.id === "root" ? null : dropTarget.node.id)
            : movedItem?.parentId ?? null;

          if (movedItem && nodeDragState.moved) {
            updateItem(nodeDragState.nodeId, {
              parentId: nextParentId,
              mindMapStyle: {
                ...(movedItem.mindMapStyle ?? {}),
                positionX: previewPosition?.x ?? movedItem.mindMapStyle?.positionX,
                positionY: previewPosition?.y ?? movedItem.mindMapStyle?.positionY
              }
            });
          }
        }

        mindMapNodeDragStateRef.current = null;
        setMindMapDropTargetId(null);
        setMindMapDropInvalid(false);
        setMindMapNodePreviewPosition(null);
        mindMapNodePreviewNextRef.current = null;
        if (mindMapNodePreviewRafRef.current !== null) {
          window.cancelAnimationFrame(mindMapNodePreviewRafRef.current);
          mindMapNodePreviewRafRef.current = null;
        }
      }

      const dragState = mindMapDragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      mindMapDragStateRef.current = null;
      setMindMapDragging(false);
      if (mindMapRafRef.current !== null) {
        window.cancelAnimationFrame(mindMapRafRef.current);
        mindMapRafRef.current = null;
      }
      setMindMapOffset(mindMapOffsetRef.current);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    };

    const handleMindMapWheel = (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();

      const viewport = mindMapViewportRef.current;
      if (!viewport) {
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const zoomFactor = event.deltaY < 0 ? 1.08 : 0.92;

      setMindMapScale((currentScale) => {
        const nextScale = Math.min(2.4, Math.max(0.55, Number((currentScale * zoomFactor).toFixed(3))));
        const scaleRatio = nextScale / currentScale;

        setMindMapOffset((currentOffset) => ({
          x: cursorX - (cursorX - currentOffset.x) * scaleRatio,
          y: cursorY - (cursorY - currentOffset.y) * scaleRatio
        }));

        return nextScale;
      });
    };

    const handleCopyMindMapOutline = async (scope: "all" | "selected") => {
      const outlineText = buildMindMapOutlineText(
        filteredItems,
        scope === "selected" ? selectedItemId : undefined,
        workspaceProjectName
      );

      if (!outlineText.trim()) {
        toast.error(scope === "selected" ? "当前节点没有可复制的分支" : "当前没有可复制的导图内容");
        return;
      }

      try {
        await navigator.clipboard.writeText(outlineText);
        toast.success(scope === "selected" ? "当前分支已复制，可直接粘贴到 XMind" : "导图大纲已复制，可直接粘贴到 XMind");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "复制失败");
      }
    };

    return (
      <div className="relative h-[calc(100vh-220px)]">
        <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[radial-gradient(circle_at_center,_rgba(186,230,253,0.2),_transparent_55%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] shadow-sm">
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/95 px-2 py-2 shadow-sm backdrop-blur">
            <Button type="button" size="sm" variant="ghost" onClick={() => setMindMapScale((current) => Math.max(0.55, Number((current * 0.92).toFixed(3))))}>
              缩小
            </Button>
            <div className="min-w-[56px] text-center text-xs font-medium text-slate-600">
              {Math.round(mindMapScale * 100)}%
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMindMapScale((current) => Math.min(2.4, Number((current * 1.08).toFixed(3))))}>
              放大
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setMindMapScale(1);
                setMindMapOffset({ x: 0, y: 0 });
              }}
            >
              还原
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void handleCopyMindMapOutline("all")}>
              <Copy className="mr-1 size-4" />
              复制到 XMind
            </Button>
          </div>
          <div
            ref={mindMapViewportRef}
            className={`h-full w-full touch-none ${mindMapDragging ? "cursor-grabbing" : "cursor-grab"}`}
            onPointerDown={handleMindMapPointerDown}
            onPointerMove={handleMindMapPointerMove}
            onPointerUp={handleMindMapPointerEnd}
            onPointerCancel={handleMindMapPointerEnd}
            onWheel={handleMindMapWheel}
          >
            <svg viewBox="0 0 1200 760" className="h-full w-full">
              <g transform={transform}>
                {displayNodes.map((node) => node.parentId ? (
                  <path
                    key={`link-${node.id}`}
                    d={buildBezierPath(displayNodes.find((item) => item.id === node.parentId)!, node)}
                    fill="none"
                    stroke={node.id === selectedItemId ? "#0284c7" : "#cbd5e1"}
                    strokeWidth={node.id === selectedItemId ? 3 : 2}
                    strokeLinecap="round"
                  />
                ) : null)}
                {mountLine ? (
                  <path
                    d={`M ${mountLine.startX} ${mountLine.startY} C ${mountLine.startX + 36} ${mountLine.startY}, ${mountLine.endX - 36} ${mountLine.endY}, ${mountLine.endX} ${mountLine.endY}`}
                    fill="none"
                    stroke={mindMapDropInvalid ? "#fb7185" : "#14b8a6"}
                    strokeWidth={3}
                    strokeDasharray="8 8"
                    strokeLinecap="round"
                  />
                ) : null}
                <defs>
                  {displayNodes.map((node) => (
                    <clipPath key={`clip-${node.id}`} id={`mindmap-node-clip-${node.id}`}>
                      <rect
                        x={node.x + 16}
                        y={node.y + 12}
                        width={Math.max(0, node.width - 32)}
                        height={Math.max(0, node.height - 24)}
                        rx={14}
                        ry={14}
                      />
                    </clipPath>
                  ))}
                </defs>
                {displayNodes.map((node) => {
                  const isSelected = node.id === selectedItemId;
                  return (
                    <g
                      key={node.id}
                      data-mindmap-node="true"
                      onClick={() => setSelectedItemId(node.id)}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (node.id === "root") {
                          mindMapDragStateRef.current = {
                            pointerId: event.pointerId,
                            startX: event.clientX,
                            startY: event.clientY,
                            originX: mindMapOffset.x,
                            originY: mindMapOffset.y
                          };
                          setMindMapDragging(true);
                          if ("setPointerCapture" in event.currentTarget) {
                            event.currentTarget.setPointerCapture(event.pointerId);
                          }
                          return;
                        }
                        const viewport = mindMapViewportRef.current;
                        const rect = viewport?.getBoundingClientRect();
                        const sceneX = rect ? (event.clientX - rect.left - mindMapOffsetRef.current.x) / mindMapScale : node.x;
                        const sceneY = rect ? (event.clientY - rect.top - mindMapOffsetRef.current.y) / mindMapScale : node.y;
                        mindMapNodeDragStateRef.current = {
                          nodeId: node.id,
                          moved: false,
                          offsetX: sceneX - node.x,
                          offsetY: sceneY - node.y,
                          startSceneX: sceneX,
                          startSceneY: sceneY
                        };
                        if ("setPointerCapture" in event.currentTarget) {
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }
                      }}
                      style={{ cursor: "pointer", userSelect: "none", WebkitUserSelect: "none" }}
                    >
                      <rect
                        x={node.x}
                        y={node.y}
                        rx={20}
                        ry={20}
                        width={node.width}
                        height={node.height}
                        fill={items.find((item) => item.id === node.id)?.mindMapStyle?.fillColor || "#EEEBEE"}
                        stroke={mindMapDropTargetId === node.id ? (mindMapDropInvalid ? "#ef4444" : "#14b8a6") : isSelected ? "#101010" : "#EEEBEE"}
                        strokeWidth={mindMapDropTargetId === node.id ? 3.5 : isSelected ? 2.5 : 1.5}
                        filter="drop-shadow(0 8px 16px rgba(16,16,16,0.08))"
                      />
                      <foreignObject
                        x={node.x + 16}
                        y={node.y + 12}
                        width={Math.max(0, node.width - 32)}
                        height={Math.max(0, node.height - 24)}
                        style={{ pointerEvents: "none" }}
                      >
                        <div
                          xmlns="http://www.w3.org/1999/xhtml"
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: Math.max(1, Math.floor((node.height - 24) / 20)),
                            overflow: "hidden",
                            wordBreak: "break-word",
                            overflowWrap: "anywhere",
                            lineHeight: "20px",
                            fontSize: "15px",
                            fontWeight: 600,
                            color: items.find((item) => item.id === node.id)?.mindMapStyle?.textColor || "#101010",
                            userSelect: "none",
                            WebkitUserSelect: "none"
                          }}
                        >
                          {node.title}
                        </div>
                      </foreignObject>
                      {node.collapsible ? (
                        <g
                          data-mindmap-node="true"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleToggleNodeCollapse(node.id);
                          }}
                        >
                          <circle
                            cx={node.x + node.width - 16}
                            cy={node.y + 16}
                            r={11}
                            fill="#ffffff"
                            stroke="#d6d0d6"
                            strokeWidth={1.5}
                          />
                          <text
                            x={node.x + node.width - 20}
                            y={node.y + 21}
                            fontSize="16"
                            fontWeight="700"
                            fill="#595259"
                            style={{ userSelect: "none", WebkitUserSelect: "none" }}
                          >
                            {node.collapsed ? "+" : "−"}
                          </text>
                        </g>
                      ) : null}
                      {isSelected && node.id !== "root" ? (
                        <g
                          data-mindmap-node="true"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            mindMapNodeResizeStateRef.current = {
                              nodeId: node.id,
                              startX: event.clientX,
                              startY: event.clientY,
                              originWidth: node.width,
                              originHeight: node.height
                            };
                          }}
                        >
                          <rect
                            x={node.x + node.width - 12}
                            y={node.y + node.height - 12}
                            width={12}
                            height={12}
                            rx={4}
                            ry={4}
                            fill="#101010"
                            opacity={0.72}
                          />
                        </g>
                      ) : null}
                    </g>
                  );
                })}
                {mountBar ? (
                  <g>
                    <rect
                      x={mountBar.x - 6}
                      y={mountBar.y - 4}
                      rx={10}
                      ry={10}
                      width={mountBar.width + 12}
                      height={mountBar.height + 8}
                      fill={mountBar.tone.glow}
                      opacity={0.9}
                    />
                    <rect
                      x={mountBar.x}
                      y={mountBar.y}
                      rx={999}
                      ry={999}
                      width={mountBar.width}
                      height={mountBar.height}
                      fill={mountBar.tone.fill}
                    >
                    </rect>
                  </g>
                ) : null}
              </g>
            </svg>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="!left-0 !top-0 !h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 rounded-none border-0 p-0">
        <div className="border-b border-[var(--color-border)] px-6 py-4">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div>我的工作空间</div>
              <div>
                根据第一阶段 PRD 提供表格、树形和思维导图三种视图，围绕当前项目做需求点整理与 review。
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline">当前阶段：{stageLabel(workspaceCurrentStage)}</Badge>
              <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                <CheckCircle2 className="mr-1 size-3.5" />
                Stage-1 工作区
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex h-[calc(100vh-78px)] min-h-0 min-w-0 bg-[#fbfbfd]">
          <aside className="flex w-[250px] shrink-0 flex-col border-r border-[var(--color-border)] bg-white">
            <div className="px-5 py-5">
              <div className="text-sm font-semibold">{workspaceProjectName}</div>
              <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                用 Notion 风格表格整理需求点，再用 XMind 风格导图理解结构。
              </div>
            </div>
            <div className="space-y-1 px-3">
              {viewOptions.map((view) => {
                const Icon = view.icon;
                const active = view.id === viewMode;
                return (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => setViewMode(view.id)}
                    className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
                      active ? "bg-slate-100 text-slate-950" : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <div className="text-sm font-medium">{view.label}</div>
                      <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{view.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-auto border-t border-[var(--color-border)] px-5 py-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-[var(--color-text-secondary)]">需求点</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{visibleItems.length}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-[var(--color-text-secondary)]">模块</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{groupedModules.length}</div>
                </div>
              </div>
            </div>
          </aside>

          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <>
              {viewMode === "documents" ? (
                <div>
                  {/* <div>
                    <div className="text-sm font-semibold text-slate-900">需求文档工作区</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                      在这里集中管理正式文档，支持新增、编辑和删除。
                    </div>
                  </div>
                  <Button onClick={handleCreateDocument}>
                    <Plus className="mr-1 size-4" />
                    新建文档
                  </Button> */}
                </div>
              ) : (
                <div className="border-b border-[var(--color-border)] bg-white px-6 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative min-w-[260px] flex-1">
                      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                      <Input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="搜索标题、描述、模块或标签"
                        className="pl-9"
                      />
                    </div>
                    <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="状态" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="pending">待确认</SelectItem>
                        <SelectItem value="confirmed">已确认</SelectItem>
                        <SelectItem value="rejected">已排除</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={priorityFilter} onValueChange={(value) => setPriorityFilter(value as typeof priorityFilter)}>
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="优先级" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部优先级</SelectItem>
                        <SelectItem value="P0">P0</SelectItem>
                        <SelectItem value="P1">P1</SelectItem>
                        <SelectItem value="P2">P2</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="outline" onClick={handleCreateEmpty}>
                      <Plus className="mr-1 size-4" />
                      新建需求
                    </Button>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
                    <Input
                      value={quickInput}
                      onChange={(event) => setQuickInput(event.target.value)}
                      placeholder="粘贴或输入多条需求点，支持按换行拆分"
                    />
                    <Button onClick={handleQuickAdd}>
                      <SplitSquareVertical className="mr-1 size-4" />
                      批量录入
                    </Button>
                  </div>
                </div>
              )}
            </>

            <div className="min-h-0 flex-1 p-6">
              {viewMode === "documents"
                ? renderDocumentsView()
                : viewMode === "table"
                ? renderTableView()
                : viewMode === "tree"
                  ? renderTreeView()
                  : viewMode === "mindmap"
                    ? renderMindMapView()
                    : renderBusinessModelView()}
            </div>
            {!showDetailPanel && viewMode !== "documents" ? (
              <div className="absolute right-0 top-1/2 z-20 -translate-y-1/2 pr-3">
                <Button
                  className="h-14 rounded-full border border-[var(--color-border)] bg-white/95 px-4 shadow-sm backdrop-blur"
                  variant="outline"
                  onClick={() => setShowDetailPanel(true)}
                >
                  <PanelRightOpen className="mr-2 size-4" />
                  展开详情面板
                </Button>
              </div>
            ) : null}
          </main>

          {showDetailPanel && viewMode !== "documents" ? (
            <aside className="flex w-[360px] shrink-0 flex-col border-l border-[var(--color-border)] bg-white">
            <div className="border-b border-[var(--color-border)] px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">详情面板</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                    右侧集中编辑字段，保持中间工作区只负责结构浏览和选中。
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => setShowDetailPanel(false)}
                >
                  <PanelRightClose className="size-4" />
                </Button>
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {viewMode === "business-model" ? (
                selectedBusinessNode ? (
                  <div className="space-y-5 p-5">
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">节点标签</div>
                      <Input value={selectedBusinessNode.label} onChange={(event) => updateBusinessNode(selectedBusinessNode.id, { label: event.target.value })} />
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">关联需求点</div>
                      <div className="space-y-2 rounded-2xl border border-[var(--color-border)] bg-slate-50 p-3">
                        {visibleItems.map((item) => {
                          const checked = selectedBusinessNode.relatedRequirementIds.includes(item.id);
                          return (
                            <label key={item.id} className="flex items-start gap-3 text-sm">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(nextChecked) => {
                                  const nextRequirementIds = nextChecked
                                    ? Array.from(new Set([...selectedBusinessNode.relatedRequirementIds, item.id]))
                                    : selectedBusinessNode.relatedRequirementIds.filter((id) => id !== item.id);
                                  updateBusinessNode(selectedBusinessNode.id, { relatedRequirementIds: nextRequirementIds });
                                }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium text-slate-900">{item.title}</span>
                                <span className="block text-xs text-[var(--color-text-secondary)]">{item.module}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">模块</div>
                        <Input
                          value={selectedBusinessNode.meta?.module ?? ""}
                          onChange={(event) => updateBusinessNode(selectedBusinessNode.id, {
                            meta: {
                              ...(selectedBusinessNode.meta ?? {}),
                              module: event.target.value
                            }
                          })}
                        />
                      </div>
                      <div>
                        <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">优先级</div>
                        <Select
                          value={selectedBusinessNode.meta?.priority ?? "P1"}
                          onValueChange={(value) => updateBusinessNode(selectedBusinessNode.id, {
                            meta: {
                              ...(selectedBusinessNode.meta ?? {}),
                              priority: value as WorkspaceRequirementItem["priority"]
                            }
                          })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="P0">P0</SelectItem>
                            <SelectItem value="P1">P1</SelectItem>
                            <SelectItem value="P2">P2</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => {
                          const firstRelatedId = selectedBusinessNode.relatedRequirementIds[0];
                          if (!firstRelatedId) {
                            return;
                          }
                          setSelectedItemId(firstRelatedId);
                          setViewMode("table");
                        }}
                      >
                        在表格中定位
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const firstRelatedId = selectedBusinessNode.relatedRequirementIds[0];
                          if (!firstRelatedId) {
                            return;
                          }
                          setSelectedItemId(firstRelatedId);
                          setViewMode("tree");
                        }}
                      >
                        在树形中定位
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const firstRelatedId = selectedBusinessNode.relatedRequirementIds[0];
                          if (!firstRelatedId) {
                            return;
                          }
                          setSelectedItemId(firstRelatedId);
                          setViewMode("mindmap");
                        }}
                      >
                        在导图中定位
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const sourceNodeId = selectedBusinessNodeId;
                          if (!sourceNodeId) {
                            return;
                          }
                          const nextNodeId = generateId();
                          const nextNode: WorkspaceBusinessModelNode = {
                            id: nextNodeId,
                            type: businessModelGraph.mode === "state" ? "state" : "action",
                            label: businessModelGraph.mode === "state" ? "新状态" : "新步骤",
                            relatedRequirementIds: [],
                            position: {
                              x: selectedBusinessNode.position.x + 260,
                              y: selectedBusinessNode.position.y + 24
                            }
                          };
                          updateBusinessModelGraph((current) => ({
                            ...current,
                            nodes: [...current.nodes, nextNode],
                            edges: [...current.edges, {
                              id: generateId(),
                              source: sourceNodeId,
                              target: nextNodeId,
                              action: current.mode === "state" ? "下一步" : undefined
                            }]
                          }));
                          setSelectedBusinessNodeId(nextNodeId);
                        }}
                      >
                        新建子节点
                      </Button>
                      {businessCounterpartNodeIds.length > 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => switchBusinessMode(
                            businessModelGraph.mode === "flow" ? "state" : "flow",
                            businessCounterpartNodeIds
                          )}
                        >
                          切换并定位到{businessModelGraph.mode === "flow" ? "状态" : "流程"}节点
                        </Button>
                      ) : null}
                    </div>
                    <Button variant="outline" className="w-full justify-center text-rose-600" onClick={() => deleteBusinessNode(selectedBusinessNode.id)}>
                      <Trash2 className="mr-1 size-4" />
                      删除节点
                    </Button>
                  </div>
                ) : selectedBusinessEdge ? (
                  <div className="space-y-5 p-5">
                    <div className="rounded-2xl border border-[var(--color-border)] bg-slate-50 p-4 text-sm text-slate-700">
                      <div>起点：{nodeMapLabel(businessModelGraph.nodes, selectedBusinessEdge.source)}</div>
                      <div className="mt-1">终点：{nodeMapLabel(businessModelGraph.nodes, selectedBusinessEdge.target)}</div>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">动作（State 模式必填）</div>
                      <Input
                        value={selectedBusinessEdge.action ?? ""}
                        onChange={(event) => updateBusinessEdge(selectedBusinessEdge.id, { action: event.target.value })}
                        placeholder="例如：提交 / 审核 / 接单"
                      />
                    </div>
                    <Button variant="outline" className="w-full justify-center text-rose-600" onClick={() => deleteBusinessEdge(selectedBusinessEdge.id)}>
                      <Trash2 className="mr-1 size-4" />
                      删除连线
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4 p-5 text-sm text-[var(--color-text-secondary)]">
                    <div>从左侧拖入需求点到画布，或者先新建节点。</div>
                    {validationMessages.length > 0 ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <div className="mb-2 font-medium text-amber-800">校验结果</div>
                        <ul className="space-y-2 text-xs leading-5 text-amber-700">
                          {validationMessages.map((message, index) => (
                            <li key={`${message}-${index}`}>• {message}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )
              ) : selectedItem ? (
                <div className="space-y-5 p-5">
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">标题</div>
                    <Input value={selectedItem.title} onChange={(event) => updateItem(selectedItem.id, { title: event.target.value })} />
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">描述</div>
                    <textarea
                      value={selectedItem.description}
                      onChange={(event) => updateItem(selectedItem.id, { description: event.target.value })}
                      className="min-h-[150px] w-full rounded-2xl border border-[var(--color-border)] bg-slate-50 px-3 py-3 text-sm outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">状态</div>
                      <Select value={selectedItem.status} onValueChange={(value) => updateItem(selectedItem.id, { status: value as WorkspaceRequirementItem["status"] })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">待确认</SelectItem>
                          <SelectItem value="confirmed">已确认</SelectItem>
                          <SelectItem value="rejected">已排除</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">优先级</div>
                      <Select value={selectedItem.priority} onValueChange={(value) => updateItem(selectedItem.id, { priority: value as WorkspaceRequirementItem["priority"] })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="P0">P0</SelectItem>
                          <SelectItem value="P1">P1</SelectItem>
                          <SelectItem value="P2">P2</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">模块</div>
                    <Input value={selectedItem.module} onChange={(event) => updateItem(selectedItem.id, { module: event.target.value })} />
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">标签</div>
                    <Input
                      value={selectedItem.tags.join(", ")}
                      onChange={(event) => updateItem(selectedItem.id, {
                        tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean)
                      })}
                      placeholder="用逗号分隔多个标签"
                    />
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">父节点</div>
                    <Select
                      value={selectedItem.parentId ?? "root"}
                      onValueChange={(value) => updateItem(selectedItem.id, { parentId: value === "root" ? null : value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="root">顶级节点</SelectItem>
                        {visibleItems.filter((item) => item.id !== selectedItem.id).map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">填充颜色</div>
                      <input
                        type="color"
                        value={selectedItem.mindMapStyle?.fillColor || "#ffffff"}
                        onChange={(event) => updateMindMapStyle(selectedItem.id, { fillColor: event.target.value })}
                        className="h-10 w-full rounded-xl border border-[var(--color-border)] bg-white px-2"
                      />
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">文字颜色</div>
                      <input
                        type="color"
                        value={selectedItem.mindMapStyle?.textColor || "#0f172a"}
                        onChange={(event) => updateMindMapStyle(selectedItem.id, { textColor: event.target.value })}
                        className="h-10 w-full rounded-xl border border-[var(--color-border)] bg-white px-2"
                      />
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--color-border)] bg-slate-50 p-4 text-xs leading-6 text-[var(--color-text-secondary)]">
                    <div>来源：{selectedItem.source}</div>
                    <div>置信度：{selectedItem.confidence}</div>
                    <div>更新时间：{new Date(selectedItem.updatedAt).toLocaleString()}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => setViewMode("table")}>
                      在表格中定位
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(buildMindMapOutlineText(filteredItems, selectedItem.id, workspaceProjectName)).then(() => toast.success("当前分支已复制，可直接粘贴到 XMind")).catch((error) => toast.error(error instanceof Error ? error.message : "复制失败"))}>
                      <Copy className="mr-1 size-4" />
                      复制当前分支
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const now = new Date().toISOString();
                        const newItem: WorkspaceRequirementItem = {
                          id: generateId(),
                          title: `${selectedItem.title} - 子节点`,
                          description: "",
                          status: "pending",
                          priority: "P1",
                          module: selectedItem.module,
                          parentId: selectedItem.id,
                          order: items.reduce((max, item) => Math.max(max, item.order), 0) + 1,
                          type: "feature",
                          tags: [],
                          source: "manual",
                          confidence: "manual",
                          customFields: {},
                          createdAt: now,
                          updatedAt: now
                        };
                        persistItems(normalizeItemOrders([...items, newItem]));
                        setSelectedItemId(newItem.id);
                      }}
                    >
                      新建子节点
                    </Button>
                  </div>
                  <Button variant="outline" className="w-full justify-center text-rose-600" onClick={() => handleDeleteItem(selectedItem.id)}>
                    <Trash2 className="mr-1 size-4" />
                    删除需求点
                  </Button>
                </div>
              ) : (
                <div className="p-5 text-sm text-[var(--color-text-secondary)]">从中间选择一条需求点，右侧会显示它的详细字段。</div>
              )}
            </ScrollArea>
            </aside>
          ) : null}
        </div>
      </div>

      <Dialog open={documentHistoryOpen} onOpenChange={setDocumentHistoryOpen}>
        <DialogContent className="!h-[86vh] !w-[90vw] !max-w-[1400px] overflow-hidden rounded-2xl border-0 p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>文档历史版本</DialogTitle>
            <DialogDescription>查看并恢复当前文档的历史版本。</DialogDescription>
          </DialogHeader>
          <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_300px] bg-white">
            <section className="min-h-0 border-r border-[var(--color-border)]">
              <ScrollArea className="h-full">
                <div className="mx-auto max-w-[900px] px-14 py-12">
                  <div className="mb-12 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                    <FileText className="size-4" />
                    <span>{selectedDocument?.title ?? "需求文档"}</span>
                  </div>
                  <h1 className="mb-8 text-5xl font-semibold tracking-normal text-slate-950">
                    {documentVersionPreview?.title ?? selectedDocument?.title ?? "需求文档"}
                  </h1>
                  {documentVersionPreview ? (
                    <div
                      className="workspace-document-history-content text-[17px] leading-8 text-slate-900"
                      dangerouslySetInnerHTML={{ __html: documentVersionPreview.contentHtml || "<p></p>" }}
                    />
                  ) : (
                    <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-slate-50 px-6 py-10 text-sm text-[var(--color-text-secondary)]">
                      正在加载历史版本内容…
                    </div>
                  )}
                </div>
              </ScrollArea>
            </section>

            <aside className="flex min-h-0 flex-col bg-white">
              <div className="border-b border-[var(--color-border)] px-5 py-5">
                <div className="text-xl font-semibold text-slate-950">版本历史</div>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-1 p-4">
                  {documentVersions.map((version) => {
                    const active = version.id === selectedDocumentVersionId;
                    return (
                      <button
                        key={version.id}
                        type="button"
                        onClick={() => setSelectedDocumentVersionId(version.id)}
                        className={`w-full rounded-lg px-4 py-3 text-left transition-colors ${
                          active ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <div className="text-sm font-semibold">{formatDocumentVersionDate(version.createdAt)}</div>
                        <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                          V{version.versionNumber} · {sourceLabel(version.source)}
                        </div>
                      </button>
                    );
                  })}
                  {!documentVersionsLoading && documentVersions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                      还没有历史版本。
                    </div>
                  ) : null}
                </div>
              </ScrollArea>
              <div className="border-t border-[var(--color-border)] px-5 py-4">
                <div className="mb-3 min-h-5 text-xs text-[var(--color-text-secondary)]">
                  {selectedDocumentVersion ? selectedDocumentVersion.summary : ""}
                </div>
                <Button
                  type="button"
                  className="w-full"
                  disabled={!selectedDocumentVersionId}
                  onClick={() => selectedDocumentVersionId ? void handleRestoreDocumentVersion(selectedDocumentVersionId) : undefined}
                >
                  <RefreshCcw className="mr-2 size-4" />
                  恢复
                </Button>
              </div>
            </aside>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function normalizeItemOrders(items: WorkspaceRequirementItem[]) {
  return [...items]
    .sort((left, right) => left.order - right.order)
    .map((item, index) => ({
      ...item,
      order: index + 1,
      updatedAt: item.updatedAt ?? new Date().toISOString()
    }));
}

function createInitialRequirementDocuments(
  projectName: string,
  collection: RequirementCollectionArtifactContent | null
): WorkspaceRequirementDocument[] {
  const now = new Date().toISOString();

  if (collection?.requirementsDocumentHtml || collection?.requirementsDocument) {
    const html = collection.requirementsDocumentHtml || `<p>${escapeHtml(collection.requirementsDocument || "")}</p>`;
    const text = collection.requirementsDocument || extractPlainTextFromHtml(html);
    return [
      {
        id: "requirement-doc-primary",
        title: `${projectName} 需求文档`,
        sortOrder: 1,
        contentHtml: html,
        contentText: text,
        contentBlocks: undefined,
        createdAt: now,
        updatedAt: now
      }
    ];
  }

  return [
    {
      id: "requirement-doc-primary",
      title: `${projectName} 需求文档`,
      sortOrder: 1,
      contentHtml: "<p></p>",
      contentText: "",
      contentBlocks: [{ type: "paragraph", content: "" }],
      createdAt: now,
      updatedAt: now
    }
  ];
}

async function seedInitialWorkspaceDocuments(
  projectId: string,
  projectName: string,
  collection: RequirementCollectionArtifactContent | null,
  repository: DocumentRepository
) {
  const seeds = createInitialRequirementDocuments(projectName, collection);
  const createdDocuments: WorkspaceRequirementDocument[] = [];

  for (const [index, seed] of seeds.entries()) {
    const created = await repository.create(projectId, { title: seed.title });
    const saved = await repository.save(projectId, {
      ...created,
      title: seed.title,
      sortOrder: index + 1,
      contentHtml: seed.contentHtml,
      contentText: seed.contentText,
      contentBlocks: seed.contentBlocks
    });
    createdDocuments.push(saved);
  }

  if (createdDocuments.length > 1) {
    return repository.reorder(projectId, createdDocuments.map((document) => document.id));
  }

  return createdDocuments;
}

function markdownToDocxParagraphs(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const paragraphs: Paragraph[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      paragraphs.push(new Paragraph({}));
      continue;
    }

    if (line.startsWith("### ")) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun(line.replace(/^###\s+/, ""))]
      }));
      continue;
    }

    if (line.startsWith("## ")) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun(line.replace(/^##\s+/, ""))]
      }));
      continue;
    }

    if (line.startsWith("# ")) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun(line.replace(/^#\s+/, ""))]
      }));
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      paragraphs.push(new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun(line.replace(/^[-*]\s+/, ""))]
      }));
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      paragraphs.push(new Paragraph({
        children: [new TextRun(line.replace(/^\d+\.\s+/, ""))]
      }));
      continue;
    }

    paragraphs.push(new Paragraph({
      children: [new TextRun(line)]
    }));
  }

  return paragraphs.length > 0 ? paragraphs : [new Paragraph({ children: [new TextRun("")] })];
}

function sanitizeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").trim() || "document";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function extractPlainTextFromHtml(html: string) {
  if (typeof window !== "undefined") {
    const container = window.document.createElement("div");
    container.innerHTML = html;
    return container.textContent?.trim() ?? "";
  }
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getSelectToneClass(value?: string) {
  if (!value) {
    return "";
  }

  const tones = [
    "bg-sky-50 text-sky-700",
    "bg-emerald-50 text-emerald-700",
    "bg-amber-50 text-amber-700",
    "bg-rose-50 text-rose-700",
    "bg-violet-50 text-violet-700",
    "bg-slate-100 text-slate-700"
  ];

  const seed = Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
  return tones[seed % tones.length] ?? tones[0];
}

function createDefaultSavedViews(): WorkspaceSavedView[] {
  return [
    {
      id: "default",
      name: "默认视图",
      preferredViewMode: "table",
      searchQuery: "",
      statusFilter: "all",
      priorityFilter: "all",
      visibleColumns: defaultVisibleColumns,
      columnWidths: defaultColumnWidths,
      sortKey: "order",
      sortDirection: "asc",
      moduleFilter: "all"
    },
    {
      id: "review",
      name: "评审视图",
      preferredViewMode: "table",
      searchQuery: "",
      statusFilter: "pending",
      priorityFilter: "all",
      visibleColumns: {
        status: true,
        priority: true,
        module: true,
        description: true
      },
      columnWidths: defaultColumnWidths,
      sortKey: "priority",
      sortDirection: "asc",
      moduleFilter: "all"
    },
    {
      id: "mindmap",
      name: "导图视图",
      preferredViewMode: "mindmap",
      searchQuery: "",
      statusFilter: "all",
      priorityFilter: "all",
      visibleColumns: defaultVisibleColumns,
      columnWidths: defaultColumnWidths,
      sortKey: "order",
      sortDirection: "asc",
      moduleFilter: "all"
    },
    {
      id: "business-model",
      name: "业务建模",
      preferredViewMode: "business-model",
      searchQuery: "",
      statusFilter: "all",
      priorityFilter: "all",
      visibleColumns: defaultVisibleColumns,
      columnWidths: defaultColumnWidths,
      sortKey: "order",
      sortDirection: "asc",
      moduleFilter: "all"
    },
    {
      id: "documents",
      name: "需求文档",
      preferredViewMode: "documents",
      searchQuery: "",
      statusFilter: "all",
      priorityFilter: "all",
      visibleColumns: defaultVisibleColumns,
      columnWidths: defaultColumnWidths,
      sortKey: "order",
      sortDirection: "asc",
      moduleFilter: "all"
    }
  ];
}

function normalizeSavedViews(savedViews?: WorkspaceSavedView[]) {
  if (!savedViews || savedViews.length === 0) {
    return createDefaultSavedViews();
  }

  return savedViews.map((view) => ({
    ...view,
    preferredViewMode: view.preferredViewMode ?? "table",
    searchQuery: view.searchQuery ?? "",
    statusFilter: view.statusFilter ?? "all",
    priorityFilter: view.priorityFilter ?? "all",
    visibleColumns: view.visibleColumns ?? defaultVisibleColumns,
    columnWidths: view.columnWidths ?? defaultColumnWidths,
    sortKey: view.sortKey ?? "order",
    sortDirection: view.sortDirection ?? "asc",
    moduleFilter: view.moduleFilter ?? "all"
  }));
}

function isDescendant(items: WorkspaceRequirementItem[], sourceId: string, targetId: string) {
  if (targetId === "root") {
    return false;
  }

  let current = items.find((item) => item.id === targetId) ?? null;
  while (current) {
    if (current.id === sourceId) {
      return true;
    }
    current = current.parentId ? items.find((item) => item.id === current.parentId) ?? null : null;
  }
  return false;
}

function mergeWorkspaceItems(
  existing: WorkspaceRequirementItem[],
  collection: RequirementCollectionArtifactContent | null
) {
  const map = new Map(existing.map((item) => [item.linkedSourceRecordId ?? item.id, item]));
  const imported = buildItemsFromCollection(collection);

  for (const item of imported) {
    if (!map.has(item.linkedSourceRecordId ?? item.id)) {
      map.set(item.linkedSourceRecordId ?? item.id, item);
    }
  }

  return Array.from(map.values()).sort((left, right) => left.order - right.order);
}

function buildItemsFromCollection(collection: RequirementCollectionArtifactContent | null): WorkspaceRequirementItem[] {
  if (!collection) {
    return [];
  }

  if (collection.sourceRecords.length > 0) {
    return collection.sourceRecords.map((record, index) => buildItemFromSourceRecord(record, index));
  }

  return (collection.requirementPointSections ?? []).flatMap((section, sectionIndex) =>
    buildItemsFromSection(section, sectionIndex)
  );
}

function buildItemFromSourceRecord(record: RequirementSourceRecord, index: number): WorkspaceRequirementItem {
  const now = record.updatedAt || record.createdAt;
  return {
    id: record.id,
    title: extractTitle(record.content),
    description: record.content,
    status: "pending",
    priority: "P1",
    module: "未分类",
    parentId: record.parentId ?? null,
    order: index + 1,
    type: "feature",
    tags: [],
    source: "manual",
    confidence: "manual",
    linkedSourceRecordId: record.id,
    createdAt: record.createdAt,
    updatedAt: now
  };
}

function buildItemsFromSection(section: RequirementPointSection, sectionIndex: number): WorkspaceRequirementItem[] {
  return section.items.map((item, itemIndex) => {
    const now = new Date().toISOString();
    return {
      id: `${section.id}-${itemIndex + 1}`,
      title: extractTitle(item),
      description: item,
      status: "pending",
      priority: "P1",
      module: section.title,
      parentId: null,
      order: sectionIndex * 100 + itemIndex + 1,
      type: "feature",
      tags: [],
      source: "ai",
      confidence: "ai",
      createdAt: now,
      updatedAt: now
    };
  });
}

function extractTitle(content: string) {
  const normalized = content.trim();
  if (!normalized) {
    return "未命名需求点";
  }
  const sentence = normalized.split(/[。；;，,\n]/)[0]?.trim() || normalized;
  return sentence.length > 24 ? `${sentence.slice(0, 24)}...` : sentence;
}

function stageLabel(stage: StageType) {
  return {
    "requirement-collection": "需求整理",
    "requirement-structure": "需求结构化",
    "requirement-clarification": "需求澄清",
    "product-model": "产品模型",
    "prd": "PRD",
    "prototype": "原型",
    "prototype-annotation": "原型标注",
    "ui-draft": "UI 稿",
    "review": "Review"
  }[stage];
}

function sourceLabel(source: WorkspaceRequirementDocumentVersion["source"]) {
  return {
    manual: "手动保存",
    ai: "AI 生成",
    import: "导入",
    rollback: "回滚"
  }[source];
}

function formatDocumentVersionDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 · ${date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })}`;
}

function StatusBadge({ status }: { status: WorkspaceRequirementItem["status"] }) {
  const map = {
    pending: "bg-slate-100 text-slate-700 hover:bg-slate-100",
    confirmed: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
    rejected: "bg-rose-100 text-rose-700 hover:bg-rose-100"
  };
  const label = {
    pending: "待确认",
    confirmed: "已确认",
    rejected: "已排除"
  };
  return <Badge className={map[status]}>{label[status]}</Badge>;
}

function PriorityBadge({ priority }: { priority: WorkspaceRequirementItem["priority"] }) {
  const map = {
    P0: "bg-rose-100 text-rose-700 hover:bg-rose-100",
    P1: "bg-amber-100 text-amber-700 hover:bg-amber-100",
    P2: "bg-sky-100 text-sky-700 hover:bg-sky-100"
  };
  return <Badge className={map[priority]}>{priority}</Badge>;
}

function buildMindMapNodes(items: WorkspaceRequirementItem[], collapsedNodeIds: string[]) {
  const horizontalGap = 260;
  const verticalGap = 44;
  const rootX = 72;
  const firstLevelX = 360;
  const topPadding = 88;
  const roots = items.filter((item) => !item.parentId).sort((left, right) => left.order - right.order);

  type MindMapNode = {
    id: string;
    parentId: string | null;
    title: string;
    meta: string;
    titleLines: string[];
    x: number;
    y: number;
    width: number;
    height: number;
    collapsible?: boolean;
    collapsed?: boolean;
  };

  const nodes: MindMapNode[] = [{
    id: "root",
    parentId: null,
    title: "需求点总览",
    meta: `${items.length} 条需求点`,
    titleLines: ["需求点总览"],
    x: rootX,
    y: topPadding + Math.max(0, roots.length - 1) * 18,
    width: 196,
    height: 76
  }];

  const getChildren = (parentId: string) =>
    items
      .filter((item) => item.parentId === parentId)
      .sort((left, right) => left.order - right.order);

  const measureSubtree = (item: WorkspaceRequirementItem): number => {
    const nodeSize = getMindMapNodeSize(item);
    const children = getChildren(item.id);
    if (children.length === 0 || collapsedNodeIds.includes(item.id)) {
      return nodeSize.height;
    }

    const childrenHeight = children.reduce((total, child, index) => total + measureSubtree(child) + (index > 0 ? verticalGap : 0), 0);
    return Math.max(nodeSize.height, childrenHeight);
  };

  const layoutNode = (
    item: WorkspaceRequirementItem,
    level: number,
    topY: number,
    parentId: string | null
  ) => {
    const subtreeHeight = measureSubtree(item);
    const nodeSize = getMindMapNodeSize(item);
    const nodeY = topY + subtreeHeight / 2 - nodeSize.height / 2;
    const children = getChildren(item.id);
    const collapsed = collapsedNodeIds.includes(item.id);

    nodes.push({
      id: item.id,
      parentId,
      title: item.title,
      meta: `${item.module} · ${item.priority}`,
      titleLines: getVisibleNodeTitleLines(item.title, nodeSize.width, nodeSize.height),
      x: item.mindMapStyle?.positionX ?? (firstLevelX + horizontalGap * Math.max(0, level - 1)),
      y: item.mindMapStyle?.positionY ?? nodeY,
      width: nodeSize.width,
      height: nodeSize.height,
      collapsible: children.length > 0,
      collapsed
    });

    if (children.length === 0 || collapsed) {
      return;
    }

    let childTop = topY;
    children.forEach((child) => {
      const childHeight = measureSubtree(child);
      layoutNode(child, level + 1, childTop, item.id);
      childTop += childHeight + verticalGap;
    });
  };

  let rootTop = topPadding;
  roots.forEach((item) => {
    const subtreeHeight = measureSubtree(item);
    layoutNode(item, 1, rootTop, "root");
    rootTop += subtreeHeight + verticalGap;
  });

  return nodes;
}

function buildMindMapOutlineText(
  items: WorkspaceRequirementItem[],
  selectedRootId?: string,
  rootLabel = "需求点总览"
) {
  const sortedItems = [...items].sort((left, right) => left.order - right.order);
  const childrenMap = new Map<string | null, WorkspaceRequirementItem[]>();

  for (const item of sortedItems) {
    const key = item.parentId ?? null;
    const list = childrenMap.get(key) ?? [];
    list.push(item);
    childrenMap.set(key, list);
  }

  const lines: string[] = [];

  const appendBranch = (parentId: string | null, depth: number) => {
    const children = childrenMap.get(parentId) ?? [];
    for (const child of children) {
      lines.push(`${"\t".repeat(depth)}${child.title}`);
      appendBranch(child.id, depth + 1);
    }
  };

  if (selectedRootId) {
    const selected = sortedItems.find((item) => item.id === selectedRootId);
    if (!selected) {
      return "";
    }
    lines.push(selected.title);
    appendBranch(selected.id, 1);
    return lines.join("\n");
  }

  lines.push(rootLabel);
  appendBranch(null, 1);
  return lines.join("\n");
}

function nodeMapLabel(nodes: WorkspaceBusinessModelNode[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId)?.label ?? "未知节点";
}

function intersectsRect(
  x: number,
  y: number,
  width: number,
  height: number,
  rect: { x: number; y: number; width: number; height: number }
) {
  return !(
    x + width < rect.x
    || x > rect.x + rect.width
    || y + height < rect.y
    || y > rect.y + rect.height
  );
}

function getNextBusinessNodePosition(index: number) {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: 56 + column * 240,
    y: 56 + row * 140
  };
}

function getBusinessSnappedPosition(
  x: number,
  y: number,
  nodes: WorkspaceBusinessModelNode[],
  draggingNodeId: string
) {
  const grid = 12;
  let snappedX = Math.round(x / grid) * grid;
  let snappedY = Math.round(y / grid) * grid;
  const guideX = new Set<number>();
  const guideY = new Set<number>();
  const threshold = 16;

  const candidateX = [
    { value: x, apply: (target: number) => { snappedX = target; } },
    { value: x + BUSINESS_NODE_WIDTH / 2, apply: (target: number) => { snappedX = target - BUSINESS_NODE_WIDTH / 2; } },
    { value: x + BUSINESS_NODE_WIDTH, apply: (target: number) => { snappedX = target - BUSINESS_NODE_WIDTH; } }
  ];
  const candidateY = [
    { value: y, apply: (target: number) => { snappedY = target; } },
    { value: y + BUSINESS_NODE_HEIGHT / 2, apply: (target: number) => { snappedY = target - BUSINESS_NODE_HEIGHT / 2; } },
    { value: y + BUSINESS_NODE_HEIGHT, apply: (target: number) => { snappedY = target - BUSINESS_NODE_HEIGHT; } }
  ];

  for (const node of nodes) {
    if (node.id === draggingNodeId) {
      continue;
    }

    const targetXs = [
      node.position.x,
      node.position.x + BUSINESS_NODE_WIDTH / 2,
      node.position.x + BUSINESS_NODE_WIDTH
    ];
    const targetYs = [
      node.position.y,
      node.position.y + BUSINESS_NODE_HEIGHT / 2,
      node.position.y + BUSINESS_NODE_HEIGHT
    ];

    for (const candidate of candidateX) {
      for (const target of targetXs) {
        if (Math.abs(candidate.value - target) <= threshold) {
          candidate.apply(target);
          guideX.add(target);
        }
      }
    }

    for (const candidate of candidateY) {
      for (const target of targetYs) {
        if (Math.abs(candidate.value - target) <= threshold) {
          candidate.apply(target);
          guideY.add(target);
        }
      }
    }
  }

  return {
    x: snappedX,
    y: snappedY,
    guides: {
      x: Array.from(guideX),
      y: Array.from(guideY)
    }
  };
}

function toBusinessScenePoint(
  viewX: number,
  viewY: number,
  offset: { x: number; y: number },
  scale: number
) {
  return {
    x: (viewX - offset.x) / scale,
    y: (viewY - offset.y) / scale
  };
}

function createInitialBusinessModelGraph(items: WorkspaceRequirementItem[]): WorkspaceBusinessModelGraph {
  const nodes = items.slice(0, 6).map((item, index) => ({
    id: generateId(),
    type: "action" as const,
    label: item.title,
    relatedRequirementIds: [item.id],
    position: getNextBusinessNodePosition(index),
    meta: {
      module: item.module,
      priority: item.priority
    }
  }));

  return {
    nodes,
    edges: [],
    mode: "flow",
    version: 1,
    updatedAt: new Date().toISOString()
  };
}

function autoLayoutBusinessModelNodes(
  nodes: WorkspaceBusinessModelNode[],
  edges: WorkspaceBusinessModelEdge[]
) {
  if (nodes.length === 0) {
    return nodes;
  }

  const incomingCount = new Map<string, number>();
  nodes.forEach((node) => incomingCount.set(node.id, 0));
  edges.forEach((edge) => incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1));

  const sortedNodes = [...nodes].sort((left, right) => (incomingCount.get(left.id) ?? 0) - (incomingCount.get(right.id) ?? 0));
  return sortedNodes.map((node, index) => ({
    ...node,
    position: getNextBusinessNodePosition(index)
  }));
}

function inferTransitionAction(sourceLabel?: string, targetLabel?: string) {
  const joined = `${sourceLabel ?? ""} ${targetLabel ?? ""}`;
  if (/提交|提报/.test(joined)) return "提交";
  if (/审核|审批/.test(joined)) return "审核";
  if (/接单/.test(joined)) return "接单";
  if (/完成|结束/.test(joined)) return "完成";
  if (/取消|关闭/.test(joined)) return "取消";
  return "下一步";
}

function toStateLabel(label: string) {
  const normalized = label.trim();
  if (!normalized) {
    return "未命名状态";
  }
  if (/已|中|待/.test(normalized.slice(0, 1))) {
    return normalized;
  }
  if (/提交/.test(normalized)) return "已提交";
  if (/审核/.test(normalized)) return "审核中";
  if (/接单/.test(normalized)) return "已接单";
  if (/完成/.test(normalized)) return "已完成";
  return `已${normalized}`;
}

function flowToStateGraph(graph: WorkspaceBusinessModelGraph): WorkspaceBusinessModelGraph {
  const stateNodeMap = new Map<string, WorkspaceBusinessModelNode>();
  const counterpartMap: Record<string, string[]> = {};
  const flowNodes = graph.mode === "flow" ? graph.nodes : (graph.flowSnapshot?.nodes ?? graph.nodes);
  const flowEdges = graph.mode === "flow" ? graph.edges : (graph.flowSnapshot?.edges ?? graph.edges);

  for (const node of flowNodes) {
    const stateLabel = toStateLabel(node.label);
    if (!stateNodeMap.has(stateLabel)) {
      stateNodeMap.set(stateLabel, {
        ...node,
        id: generateId(),
        type: "state",
        label: stateLabel
      });
    } else {
      const existing = stateNodeMap.get(stateLabel)!;
      existing.relatedRequirementIds = Array.from(new Set([...existing.relatedRequirementIds, ...node.relatedRequirementIds]));
    }
  }

  const stateNodes = Array.from(stateNodeMap.values()).map((node, index) => ({
    ...node,
    position: getNextBusinessNodePosition(index)
  }));
  const stateNodeByLabel = new Map(stateNodes.map((node) => [node.label, node]));

  const edgeNodeByOldId = new Map(flowNodes.map((node) => [node.id, toStateLabel(node.label)]));
  const stateEdges: WorkspaceBusinessModelEdge[] = [];
  const edgeSeen = new Set<string>();

  for (const edge of flowEdges) {
    const sourceLabel = edgeNodeByOldId.get(edge.source);
    const targetLabel = edgeNodeByOldId.get(edge.target);
    if (!sourceLabel || !targetLabel) {
      continue;
    }
    const source = stateNodes.find((node) => node.label === sourceLabel);
    const target = stateNodes.find((node) => node.label === targetLabel);
    if (!source || !target) {
      continue;
    }
    const edgeKey = `${source.id}-${target.id}`;
    if (edgeSeen.has(edgeKey)) {
      continue;
    }
    edgeSeen.add(edgeKey);
    stateEdges.push({
      id: generateId(),
      source: source.id,
      target: target.id,
      action: edge.action || inferTransitionAction(source.label, target.label)
    });
  }

  flowNodes.forEach((node) => {
    const stateLabel = toStateLabel(node.label);
    const mapped = stateNodeByLabel.get(stateLabel);
    if (mapped) {
      counterpartMap[node.id] = [mapped.id];
      counterpartMap[mapped.id] = [...(counterpartMap[mapped.id] ?? []), node.id];
    }
  });

  return {
    nodes: stateNodes,
    edges: stateEdges,
    mode: "state",
    flowSnapshot: {
      nodes: flowNodes,
      edges: flowEdges
    },
    stateSnapshot: {
      nodes: stateNodes,
      edges: stateEdges
    },
    counterpartMap,
    version: graph.version + 1,
    updatedAt: new Date().toISOString()
  };
}

function validateBusinessModelGraph(graph: WorkspaceBusinessModelGraph) {
  const messages: string[] = [];
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();

  graph.nodes.forEach((node) => {
    incoming.set(node.id, 0);
    outgoing.set(node.id, 0);
  });

  graph.edges.forEach((edge) => {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      messages.push("存在引用了无效节点的连线");
      return;
    }
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
    if (graph.mode === "state" && !edge.action?.trim()) {
      messages.push(`状态流转 ${nodeMapLabel(graph.nodes, edge.source)} → ${nodeMapLabel(graph.nodes, edge.target)} 缺少 action`);
    }
    if (graph.mode === "flow" && edge.source === edge.target) {
      messages.push(`流程节点 ${nodeMapLabel(graph.nodes, edge.source)} 存在自循环`);
    }
  });

  graph.nodes.forEach((node) => {
    if ((incoming.get(node.id) ?? 0) === 0 && (outgoing.get(node.id) ?? 0) === 0) {
      messages.push(`节点「${node.label}」是孤立节点`);
    }
  });

  if (graph.mode === "flow") {
    const startCount = graph.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).length;
    const endCount = graph.nodes.filter((node) => (outgoing.get(node.id) ?? 0) === 0).length;
    if (startCount > 1) {
      messages.push("Flow 存在多个起点");
    }
    if (endCount > 1) {
      messages.push("Flow 存在多个终点");
    }
  }

  return Array.from(new Set(messages));
}

function sortWorkspaceItems(
  left: WorkspaceRequirementItem,
  right: WorkspaceRequirementItem,
  sortKey: SortKey,
  sortDirection: "asc" | "desc"
) {
  const directionFactor = sortDirection === "asc" ? 1 : -1;

  const compareValue = (() => {
    switch (sortKey) {
      case "title":
        return left.title.localeCompare(right.title, "zh-Hans-CN");
      case "status":
        return left.status.localeCompare(right.status);
      case "priority":
        return left.priority.localeCompare(right.priority);
      case "module":
        return left.module.localeCompare(right.module, "zh-Hans-CN");
      case "updatedAt":
        return new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
      case "order":
      default:
        return left.order - right.order;
    }
  })();

  if (compareValue !== 0) {
    return compareValue * directionFactor;
  }

  return (left.order - right.order) * directionFactor;
}

function buildBezierPath(
  source: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number; width: number; height: number }
) {
  const startX = source.x + source.width;
  const startY = source.y + source.height / 2;
  const endX = target.x;
  const endY = target.y + target.height / 2;
  const controlX = (startX + endX) / 2;
  return `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`;
}

function wrapTextForNode(text: string, chunkSize: number) {
  if (!text.trim()) {
    return [""];
  }

  const compact = text.replace(/\s+/g, " ").trim();
  const result: string[] = [];
  for (let index = 0; index < compact.length; index += chunkSize) {
    result.push(compact.slice(index, index + chunkSize));
  }
  return result.slice(0, 4);
}

function getNodeCharsPerLine(width?: number) {
  return Math.max(8, Math.floor(((width ?? 188) - 36) / 11));
}

function getVisibleNodeTitleLines(title: string, width?: number, height?: number) {
  const wrappedLines = wrapTextForNode(title, getNodeCharsPerLine(width));
  const maxLines = Math.max(1, Math.floor(((height ?? 76) - 32) / 18));

  if (wrappedLines.length <= maxLines) {
    return wrappedLines;
  }

  const trimmedLines = wrappedLines.slice(0, maxLines);
  const lastLine = trimmedLines[maxLines - 1] ?? "";
  trimmedLines[maxLines - 1] = lastLine.length > 1 ? `${lastLine.slice(0, Math.max(1, lastLine.length - 1))}…` : "…";
  return trimmedLines;
}

function getMindMapNodeSize(item: WorkspaceRequirementItem) {
  const preferredWidth = item.mindMapStyle?.width;
  const titleLines = wrapTextForNode(item.title, getNodeCharsPerLine(preferredWidth));
  const contentWidth = Math.max(
    preferredWidth ?? 0,
    Math.min(
      340,
      Math.max(
        188,
        Math.max(...titleLines.map((line) => line.length), 10) * 11 + 36
      )
    )
  );
  const contentHeight = Math.max(
    item.mindMapStyle?.height ?? 0,
    28 + titleLines.length * 18 + 24
  );

  return {
    width: Math.max(188, contentWidth),
    height: Math.max(76, contentHeight)
  };
}

function resolveMindMapMountTarget<
  T extends {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }
>(
  nodes: T[],
  sceneX: number,
  sceneY: number,
  draggingNodeId: string,
  draggingNode?: { width: number; height: number } | null
) {
  let matchedNode: {
    node: T;
    anchorX: number;
    anchorY: number;
    snapX: number;
    snapY: number;
  } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    if (node.id === draggingNodeId) {
      continue;
    }

    const anchorX = node.x + node.width;
    const anchorY = node.y + node.height / 2;
    const mountZoneStartX = anchorX - 8;
    const mountZoneEndX = anchorX + (node.id === "root" ? 58 : 46);
    const mountZoneTopY = anchorY - 20;
    const mountZoneBottomY = anchorY + 20;

    const inZone = sceneX >= mountZoneStartX
      && sceneX <= mountZoneEndX
      && sceneY >= mountZoneTopY
      && sceneY <= mountZoneBottomY;

    if (!inZone) {
      continue;
    }
    const score = Math.abs(sceneX - anchorX) + Math.abs(sceneY - anchorY) * 2.2;

    if (score < bestScore) {
      bestScore = score;
      matchedNode = {
        node,
        anchorX,
        anchorY,
        snapX: anchorX + 28,
        snapY: anchorY - ((draggingNode?.height ?? 76) / 2)
      };
    }
  }

  return matchedNode;
}
