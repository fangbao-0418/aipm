import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  ArrowLeft,
  Bot,
  Box,
  ChevronDown,
  Code2,
  Component,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Frame,
  Hand,
  Image,
  Import,
  Layers,
  Lock,
  MoreHorizontal,
  MousePointer2,
  PanelLeft,
  Play,
  Plus,
  RectangleHorizontal,
  Search,
  Send,
  Share2,
  Settings2,
  Sparkles,
  Table2,
  TextCursorInput,
  Trash2,
  Type,
  Unlock,
  Wand2
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { getProject } from "../../utils/storage";
import { toast } from "sonner";
import {
  getAiDesignFile,
  cancelAiDesignAgentConversation,
  getAiDesignAgentCurrent,
  getAiDesignPage,
  importAiDesignFile,
  streamAiDesignAgent,
  saveAiDesignFile,
  createAiDesignComponent,
  createAiDesignComponentLibrary,
  deleteAiDesignComponent,
  deleteAiDesignComponentLibrary,
  updateAiDesignComponent,
  updateAiDesignComponentLibrary,
  updateWorkspaceLlmSettings,
  type AiDesignAgentStreamEvent,
  type WorkspaceDesignFile,
  type WorkspaceDesignImageColorControls,
  type WorkspaceDesignPage,
  type WorkspaceDesignPageTemplate,
  type WorkspaceDesignPaint,
  type WorkspaceDesignStyleProfile
} from "../../utils/workspace-api";
import { useStopWhellHook } from "../../utils/event";

type DesignLeftTab = "layers" | "components" | "assets" | "ai";
type DesignRightTab = "design" | "prototype" | "d2c";
type DesignTool = "select" | "hand" | "frame" | "rect" | "text";
type DesignNodeType = "frame" | "container" | "text" | "button" | "input" | "table" | "card" | "image";
type ResizeHandle = "nw" | "ne" | "sw" | "se";
type DesignTextTransform = NonNullable<DesignNode["textTransform"]>;

interface DesignNode {
  id: string;
  parentId?: string;
  depth?: number;
  type: DesignNodeType;
  name: string;
  sourceLayerId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  fills?: WorkspaceDesignPaint[];
  stroke: string;
  borders?: WorkspaceDesignPaint[];
  strokeWidth?: number;
  strokePosition?: "center" | "inside" | "outside";
  strokeDashPattern?: number[];
  strokeLineCap?: "butt" | "round" | "square";
  strokeLineJoin?: "miter" | "round" | "bevel";
  radius: number;
  text?: string;
  textRuns?: Array<{
    text: string;
    color?: string;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number;
    letterSpacing?: number;
    underline?: boolean;
    strikethrough?: boolean;
  }>;
  textColor: string;
  fontSize: number;
  lineHeight?: number;
  textAlign?: "left" | "center" | "right" | "justify";
  textVerticalAlign?: "top" | "middle" | "bottom";
  visible: boolean;
  locked: boolean;
  imageUrl?: string;
  imageFilter?: string;
  imageColorControls?: WorkspaceDesignImageColorControls;
  fillImageUrl?: string;
  fillImageMode?: "stretch" | "fill" | "fit" | "tile";
  fillImageScale?: number;
  svgPath?: string;
  svgPathAssetRef?: string;
  svgFillRule?: "nonzero" | "evenodd";
  svgPaths?: Array<{
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    strokeDashPattern?: number[];
    strokeLineCap?: "butt" | "round" | "square";
    strokeLineJoin?: "miter" | "round" | "bevel";
    fillRule?: "nonzero" | "evenodd";
    opacity?: number;
    transform?: string;
  }>;
  svgPathsAssetRef?: string;
  svgTree?: DesignSvgNode;
  svgTreeAssetRef?: string;
  clipBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  clipPath?: {
    x: number;
    y: number;
    width: number;
    height: number;
    svgPath: string;
    fillRule?: "nonzero" | "evenodd";
  };
  clipPathSvgAssetRef?: string;
  sourceRef?: string;
  sourceLayerClass?: string;
  opacity?: number;
  rotation?: number;
  blendMode?: string;
  blurRadius?: number;
  fontFamily?: string;
  fontWeight?: number;
  letterSpacing?: number;
  fontStretch?: string;
  underline?: boolean;
  strikethrough?: boolean;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  flippedHorizontal?: boolean;
  flippedVertical?: boolean;
  shadow?: string;
  innerShadow?: string;
  zIndex?: number;
  sourceMeta?: {
    rotation?: number;
    isFlippedHorizontal?: boolean;
    isFlippedVertical?: boolean;
    layerOpacity?: number;
    inheritedOpacity?: number;
    effectiveOpacity?: number;
    localRotation?: number;
    inheritedRotation?: number;
    effectiveRotation?: number;
    hasClippingMask?: boolean;
    activeClippingMask?: {
      sourceLayerId?: string;
      sourceLayerClass?: string;
      name?: string;
      hasClippingMask: true;
    };
  };
}

type DesignSvgNode = {
  type: "g";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDashPattern?: number[];
  strokeLineCap?: "butt" | "round" | "square";
  strokeLineJoin?: "miter" | "round" | "bevel";
  fillRule?: "nonzero" | "evenodd";
  opacity?: number;
  transform?: string;
  children: DesignSvgNode[];
} | {
  type: "path";
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDashPattern?: number[];
  strokeLineCap?: "butt" | "round" | "square";
  strokeLineJoin?: "miter" | "round" | "bevel";
  fillRule?: "nonzero" | "evenodd";
  opacity?: number;
  transform?: string;
};

interface DesignPage {
  id: string;
  name: string;
  nodes: DesignNode[];
  nodeCount?: number;
  schemaPath?: string;
  schemaLoaded?: boolean;
}

interface ImportedDesignComponent {
  id: string;
  name: string;
  sourceFileName: string;
  libraryId?: string;
  description?: string;
  nodeCount: number;
  nodes: DesignNode[];
}

interface LocalComponentLibrary {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

type PageTemplate = WorkspaceDesignPageTemplate;

interface ImportedDesignAsset {
  id: string;
  name: string;
  sourceFileName: string;
  type: "image" | "vector";
  mimeType: string;
  url: string;
  sourceRef?: string;
  width?: number;
  height?: number;
}

type DesignVectorResource = {
  kind?: string;
  svgPath?: string;
  svgFillRule?: "nonzero" | "evenodd";
  svgPaths?: DesignNode["svgPaths"];
  svgTree?: DesignSvgNode;
};

type AiDesignFile = WorkspaceDesignFile;

interface AiDesignChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentRole?: string;
  previewImages?: Array<{ label: string; dataUrl: string }>;
}

interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResizeSession {
  handle: ResizeHandle;
  startX: number;
  startY: number;
  bounds: RectBounds;
  originals: Array<{ id: string; x: number; y: number; width: number; height: number }>;
}

interface MinimapViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DesignLayerTreeNode {
  node: DesignNode;
  children: DesignLayerTreeNode[];
  depth: number;
}

interface DesignContextMenuState {
  x: number;
  y: number;
  nodeId?: string;
  source: "canvas" | "layer";
}

interface DesignRenderTreeNode {
  node: DesignNode;
  children: DesignRenderTreeNode[];
}

const LOCAL_COMPONENT_SOURCE_NAME = "本地组件集合";
const DEFAULT_LOCAL_COMPONENT_LIBRARY_NAME = "默认组件库";

const componentPresets: Array<{
  type: DesignNodeType;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { type: "container", label: "Container", description: "页面容器和布局块", icon: Box },
  { type: "text", label: "Text", description: "标题、正文、说明文字", icon: Type },
  { type: "button", label: "Button", description: "主按钮、次按钮", icon: RectangleHorizontal },
  { type: "input", label: "Input", description: "表单输入框", icon: TextCursorInput },
  { type: "table", label: "Table", description: "后台列表和数据表", icon: Table2 },
  { type: "card", label: "Card", description: "信息卡片和模块块", icon: Component },
  { type: "image", label: "Image", description: "图片占位和素材", icon: Image }
];

const designFontFamilies = [
  "PingFang SC",
  "Microsoft YaHei",
  "Songti SC",
  "SimSun",
  "Helvetica Neue",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Menlo",
  "SF Mono"
];

const designFontWeights = [
  { label: "Thin", value: 100 },
  { label: "Light", value: 300 },
  { label: "Regular", value: 400 },
  { label: "Medium", value: 500 },
  { label: "Semibold", value: 600 },
  { label: "Bold", value: 700 },
  { label: "Black", value: 900 }
];

const designFontStretches = [
  { label: "窄", value: "condensed" },
  { label: "正常", value: "normal" },
  { label: "宽", value: "expanded" }
];

export function AiDesignView() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryPageId = searchParams.get("node-id") ?? searchParams.get("page-id") ?? "";
  useStopWhellHook();
  const project = useMemo(() => projectId ? getProject(projectId) : null, [projectId]);
  const [file, setFile] = useState<AiDesignFile>(() => createInitialDesignFile(project?.name ?? "未命名设计"));
  const [vectorResourceMap, setVectorResourceMap] = useState<Record<string, DesignVectorResource>>({});
  const [designFileLoaded, setDesignFileLoaded] = useState(false);
  const [loadingPageId, setLoadingPageId] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<DesignLeftTab>("layers");
  const [rightTab, setRightTab] = useState<DesignRightTab>("design");
  const [tool, setTool] = useState<DesignTool>("select");
  const [selectedPageId, setSelectedPageId] = useState(file.pages[0]?.id ?? "");
  const [selectedNodeId, setSelectedNodeId] = useState(file.pages[0]?.nodes[0]?.id ?? "");
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(file.pages[0]?.nodes[0]?.id ? [file.pages[0].nodes[0].id] : []);
  const [zoom, setZoom] = useState(0.64);
  const [pan, setPan] = useState({ x: 240, y: 64 });
  const [layerQuery, setLayerQuery] = useState("");
  const [expandedLayerIds, setExpandedLayerIds] = useState<string[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState("");
  const [contextMenu, setContextMenu] = useState<DesignContextMenuState | null>(null);
  const [componentCollectionView, setComponentCollectionView] = useState<"all" | "libraries" | "library">("all");
  const [selectedComponentLibraryId, setSelectedComponentLibraryId] = useState("");
  const [libraryDialogMode, setLibraryDialogMode] = useState<"create" | "edit" | null>(null);
  const [editingLibraryId, setEditingLibraryId] = useState("");
  const [libraryForm, setLibraryForm] = useState({ name: "", description: "" });
  const [createComponentDialog, setCreateComponentDialog] = useState<{ nodeIds: string[]; defaultName: string } | null>(null);
  const [componentForm, setComponentForm] = useState({ name: "", libraryId: "", description: "" });
  const [editComponentInfo, setEditComponentInfo] = useState<ImportedDesignComponent | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<PageTemplate | null>(null);
  const editingComponentId = searchParams.get("component-id") ?? "";
  const [importingDesignFile, setImportingDesignFile] = useState(false);
  const [aiMessages, setAiMessages] = useState<AiDesignChatMessage[]>([
    {
      id: createId("ai-message"),
      role: "assistant",
      content: "我是当前 AI Design 的页面 Agent。你可以让我查询页面、读取当前页 schema、新建/删除/复制页面，也可以描述一个页面让我生成可编辑 schema。"
    }
  ]);
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiConversationId, setAiConversationId] = useState(() => {
    const storageKey = `aipm-ai-design-conversation:${projectId}`;
    return window.localStorage.getItem(storageKey) || `design-agent-${projectId}`;
  });
  const [aiConversationRunning, setAiConversationRunning] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiSystemPrompt, setAiSystemPrompt] = useState(project?.systemPrompt ?? "");
  const [aiPlanningMode, setAiPlanningMode] = useState<"auto" | "plan">("auto");
  const [aiProvider, setAiProvider] = useState<"openai" | "openai-compatible">(project?.llmSettings?.provider ?? "openai-compatible");
  const [aiBaseUrl, setAiBaseUrl] = useState(project?.llmSettings?.baseUrl ?? "");
  const [aiModel, setAiModel] = useState(project?.llmSettings?.stageModelRouting?.design ?? project?.llmSettings?.stageModelRouting?.structure ?? "");
  const [aiApiKey, setAiApiKey] = useState("");
  const [savingAiSettings, setSavingAiSettings] = useState(false);
  const [previewImageDialog, setPreviewImageDialog] = useState<{ label: string; dataUrl: string } | null>(null);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 800 });

  useEffect(() => {
    if (!projectId) {
      return;
    }
    window.localStorage.setItem(`aipm-ai-design-conversation:${projectId}`, aiConversationId);
    let cancelled = false;
    void getAiDesignAgentCurrent(projectId, aiConversationId, 300)
      .then((current) => {
        if (cancelled) {
          return;
        }
        setAiConversationRunning(current.running);
        if (current.messages.length === 0) {
          setAiMessages([{
            id: createId("ai-message"),
            role: "assistant",
            content: "这是一个新的 AI Design 会话。你可以继续描述要生成或编辑的页面，这个会话会使用新的上下文。"
          }]);
          return;
        }
        setAiMessages(current.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          agentRole: message.agentRole,
          previewImages: message.previewImages
        })));
      })
      .catch((error) => {
        console.warn("[AIPM][AI Design] failed to load chat history", error);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, aiConversationId]);

  useEffect(() => {
    if (!projectId || aiBusy || !aiConversationRunning) {
      return;
    }
    let cancelled = false;
    const refreshCurrentConversation = async () => {
      try {
        const current = await getAiDesignAgentCurrent(projectId, aiConversationId, 300);
        if (cancelled) return;
        setAiConversationRunning(current.running);
        setAiMessages(current.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          agentRole: message.agentRole,
          previewImages: message.previewImages
        })));
      } catch (error) {
        console.warn("[AIPM][AI Design] failed to refresh running conversation", error);
      }
    };
    const intervalId = window.setInterval(() => void refreshCurrentConversation(), 2000);
    void refreshCurrentConversation();
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [projectId, aiConversationId, aiBusy, aiConversationRunning]);
  const [selectionRect, setSelectionRect] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const [dragPreviewNodeIds, setDragPreviewNodeIds] = useState<string[]>([]);
  const aiMessagesViewportRef = useRef<HTMLDivElement | null>(null);
  const aiInputRef = useRef<HTMLTextAreaElement | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const canvasSurfaceRef = useRef<HTMLDivElement | null>(null);
  const canvasOverlayRef = useRef<HTMLDivElement | null>(null);
  const designImportInputRef = useRef<HTMLInputElement | null>(null);
  const applyingRemoteDesignRef = useRef(false);
  const saveDesignTimerRef = useRef<number | null>(null);
  const selectedPageIdRef = useRef(selectedPageId);
  const aiStreamingDeltaMessageIdRef = useRef<string | null>(null);
  const aiStreamControllerRef = useRef<AbortController | null>(null);
  const dragPreviewRef = useRef<{ nodeIds: string[]; dx: number; dy: number } | null>(null);
  const selectionPreviewRef = useRef<HTMLDivElement | null>(null);
  const loadedPageIdsRef = useRef<Set<string>>(new Set(file.pages.filter((page) => page.nodes.length > 0).map((page) => page.id)));
  const nodeDragRef = useRef<{
    nodeIds: string[];
    startX: number;
    startY: number;
    currentDx: number;
    currentDy: number;
    originals: Array<{ id: string; x: number; y: number }>;
  } | null>(null);
  const panDragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  const scrollAiMessagesToBottom = (behavior: ScrollBehavior = "smooth") => {
    window.requestAnimationFrame(() => {
      const viewport = aiMessagesViewportRef.current;
      if (!viewport) return;
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    });
  };

  const scrollAiInputToBottom = () => {
    window.requestAnimationFrame(() => {
      const input = aiInputRef.current;
      if (!input) return;
      input.scrollTop = input.scrollHeight;
    });
  };

  useEffect(() => {
    if (leftTab !== "ai") return;
    scrollAiMessagesToBottom(aiBusy || aiConversationRunning ? "auto" : "smooth");
  }, [aiMessages, aiBusy, aiConversationRunning, leftTab]);

  useEffect(() => {
    const vectorAssets = (file.importedAssets ?? []).filter((asset) => asset.type === "vector" && asset.sourceRef && asset.url);
    if (vectorAssets.length === 0) {
      setVectorResourceMap({});
      return;
    }
    let cancelled = false;
    const loadResources = async () => {
      const entries = await Promise.all(vectorAssets.map(async (asset) => {
        if (!asset.sourceRef) return null;
        try {
          const response = await fetch(asset.url);
          if (!response.ok) return null;
          const payload = await response.json() as DesignVectorResource;
          return [asset.sourceRef, payload] as const;
        } catch (error) {
          console.warn("[AIPM][Design] failed to load vector asset", asset.sourceRef, error);
          return null;
        }
      }));
      if (cancelled) return;
      setVectorResourceMap(Object.fromEntries(entries.filter((entry): entry is readonly [string, DesignVectorResource] => Boolean(entry))));
    };
    void loadResources();
    return () => {
      cancelled = true;
    };
  }, [file.importedAssets]);

  const panPreviewFrameRef = useRef<number | null>(null);
  const selectionDragRef = useRef<{
    append: boolean;
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const resizeDragRef = useRef<ResizeSession | null>(null);

  const selectedPage = file.pages.find((page) => page.id === selectedPageId) ?? file.pages[0]!;
  const resolvedSelectedPageNodes = useMemo(() => hydrateDesignVectorResources(selectedPage.nodes, vectorResourceMap), [selectedPage.nodes, vectorResourceMap]);
  const selectedNode = resolvedSelectedPageNodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedNodes = resolvedSelectedPageNodes.filter((node) => selectedNodeIds.includes(node.id));
  const selectionBounds = getNodesBoundsForSelection(selectedNodes);
  const hoveredNode = hoveredNodeId ? resolvedSelectedPageNodes.find((node) => node.id === hoveredNodeId) ?? null : null;
  const hoverBounds = hoveredNode && !selectedNodeIds.includes(hoveredNode.id) ? nodeToBounds(hoveredNode) : null;
  const visibleNodes = resolvedSelectedPageNodes.filter((node) => node.visible !== false);
  const sceneContentBounds = useMemo(() => expandBounds(getNodesBounds(visibleNodes), 360), [visibleNodes]);
  const visibleSceneBounds = useMemo(() => ({
    x: -pan.x / zoom,
    y: -pan.y / zoom,
    width: viewportSize.width / zoom,
    height: viewportSize.height / zoom
  }), [pan.x, pan.y, viewportSize.height, viewportSize.width, zoom]);
  const minimapBounds = useMemo(() => unionBounds(sceneContentBounds, visibleSceneBounds), [sceneContentBounds, visibleSceneBounds]);
  const renderedNodes = useMemo(() => {
    const padding = Math.max(240, 960 / zoom);
    const sceneViewport = {
      x: visibleSceneBounds.x - padding,
      y: visibleSceneBounds.y - padding,
      width: visibleSceneBounds.width + padding * 2,
      height: visibleSceneBounds.height + padding * 2
    };

    const movingIds = new Set(dragPreviewNodeIds);
    return visibleNodes.filter((node) => !movingIds.has(node.id) && (selectedNodeIds.includes(node.id) || rectsIntersect(sceneViewport, nodeToBounds(node))));
  }, [dragPreviewNodeIds, selectedNodeIds, visibleNodes, visibleSceneBounds, zoom]);
  const effectiveRenderedNodes = useMemo(() => applyEffectiveCanvasOpacity(renderedNodes, resolvedSelectedPageNodes), [renderedNodes, resolvedSelectedPageNodes]);
  const hitTestNodes = useMemo(() => effectiveRenderedNodes.filter((node) => isDesignNodeHitTestable(node)), [effectiveRenderedNodes]);
  const canvasRenderedNodes = effectiveRenderedNodes;
  const dragPreviewNodes = useMemo(() => {
    if (dragPreviewNodeIds.length === 0) return [];
    const movingIds = new Set(dragPreviewNodeIds);
    return resolvedSelectedPageNodes.filter((node) => movingIds.has(node.id));
  }, [dragPreviewNodeIds, resolvedSelectedPageNodes]);
  const layerTree = useMemo(() => buildDesignLayerTree(selectedPage.nodes, layerQuery), [layerQuery, selectedPage.nodes]);
  const localComponents = useMemo(() => (file.importedComponents ?? []).filter((component) => component.sourceFileName === LOCAL_COMPONENT_SOURCE_NAME), [file.importedComponents]);
  const pageTemplates = useMemo(() => file.pageTemplates ?? [], [file.pageTemplates]);
  const externalImportedComponents = useMemo(() => (file.importedComponents ?? []).filter((component) => component.sourceFileName !== LOCAL_COMPONENT_SOURCE_NAME), [file.importedComponents]);
  const componentLibraries = useMemo(() => file.componentLibraries ?? [], [file.componentLibraries]);
  const selectedComponentLibrary = componentLibraries.find((library) => library.id === selectedComponentLibraryId) ?? componentLibraries[0] ?? null;
  const selectedLibraryComponents = selectedComponentLibrary
    ? localComponents.filter((component) => component.libraryId === selectedComponentLibrary.id)
    : [];
  const contextMenuNode = contextMenu?.nodeId ? selectedPage.nodes.find((node) => node.id === contextMenu.nodeId) ?? null : null;

  const syncSelectedPageToQuery = (pageId: string, replace = true) => {
    const nextParams = new URLSearchParams(searchParams);
    if (pageId) {
      nextParams.set("node-id", pageId);
    } else {
      nextParams.delete("node-id");
    }
    nextParams.delete("page-id");
    setSearchParams(nextParams, { replace });
  };

  const selectDesignPage = (pageId: string, pageNodes?: DesignNode[], options: { replace?: boolean } = {}) => {
    setSelectedPageId(pageId);
    selectNodes(pageNodes?.[0]?.id ? [pageNodes[0].id] : []);
    syncSelectedPageToQuery(pageId, options.replace ?? true);
  };

  useEffect(() => {
    selectedPageIdRef.current = selectedPageId;
  }, [selectedPageId]);

  useEffect(() => {
    if (!selectedComponentLibraryId && componentLibraries[0]?.id) {
      setSelectedComponentLibraryId(componentLibraries[0].id);
    }
    if (selectedComponentLibraryId && componentLibraries.length > 0 && !componentLibraries.some((library) => library.id === selectedComponentLibraryId)) {
      setSelectedComponentLibraryId(componentLibraries[0].id);
    }
  }, [componentLibraries, selectedComponentLibraryId]);

  useEffect(() => {
    let cancelled = false;
    setDesignFileLoaded(false);
    void getAiDesignFile(projectId)
      .then((remoteFile) => {
        if (cancelled) {
          return;
        }
        applyingRemoteDesignRef.current = true;
        const nextFile = normalizeDesignFile(remoteFile, project?.name ?? "未命名设计");
        loadedPageIdsRef.current = new Set(nextFile.pages.filter((page) => page.nodes.length > 0).map((page) => page.id));
        const queryPage = nextFile.pages.find((page) => page.id === queryPageId);
        const nextSelectedPage = queryPage ?? nextFile.pages[0];
        setFile(nextFile);
        setAiSystemPrompt(nextFile.aiSettings?.systemPrompt ?? project?.systemPrompt ?? "");
        if (nextSelectedPage) {
          selectDesignPage(nextSelectedPage.id, nextSelectedPage.nodes, { replace: true });
        } else {
          selectNodes([]);
        }
        setDesignFileLoaded(true);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setDesignFileLoaded(true);
        toast.error(error instanceof Error ? error.message : "设计文件加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [project?.name, projectId]);

  useEffect(() => {
    if (!designFileLoaded || !selectedPageId || loadedPageIdsRef.current.has(selectedPageId)) {
      return;
    }

    let cancelled = false;
    setLoadingPageId(selectedPageId);
    void getAiDesignPage(projectId, selectedPageId)
      .then((page) => {
        if (cancelled) {
          return;
        }
        loadedPageIdsRef.current.add(page.id);
        applyingRemoteDesignRef.current = true;
        setFile((current) => ({
          ...current,
          pages: current.pages.map((candidate) => candidate.id === page.id ? { ...page, schemaLoaded: true } : candidate)
        }));
        if (page.id === selectedPageId) {
          selectNodes(page.nodes[0]?.id ? [page.nodes[0].id] : []);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "页面 schema 加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingPageId(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [designFileLoaded, projectId, selectedPageId]);

  useEffect(() => {
    if (!designFileLoaded) {
      return;
    }
    if (applyingRemoteDesignRef.current) {
      applyingRemoteDesignRef.current = false;
      return;
    }
    if (saveDesignTimerRef.current) {
      window.clearTimeout(saveDesignTimerRef.current);
    }
    saveDesignTimerRef.current = window.setTimeout(() => {
      void saveAiDesignFile(projectId, {
        ...file,
        updatedAt: new Date().toISOString()
      }).catch((error) => {
        toast.error(error instanceof Error ? error.message : "设计文件保存失败");
      });
    }, 1200);
    return () => {
      if (saveDesignTimerRef.current) {
        window.clearTimeout(saveDesignTimerRef.current);
      }
    };
  }, [designFileLoaded, file, projectId]);

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) {
      return;
    }

    const updateViewportSize = () => {
      const rect = viewport.getBoundingClientRect();
      setViewportSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height))
      });
    };
    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const initiallyExpanded = selectedPage.nodes
      .filter((node) => (node.depth ?? 0) < 2 && selectedPage.nodes.some((candidate) => candidate.parentId === node.id))
      .map((node) => node.id);
    setExpandedLayerIds(initiallyExpanded);
  }, [selectedPageId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        setIsSpacePressed(true);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelectedNode();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelectedNode();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  });

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [contextMenu]);

  const updateFile = (updater: (current: AiDesignFile) => AiDesignFile) => {
    setFile((current) => updater(current));
  };

  const updateComponentStoreState = (updater: (current: AiDesignFile) => AiDesignFile) => {
    applyingRemoteDesignRef.current = true;
    setFile((current) => updater(current));
  };

  const applyRemoteDesignFile = (nextFile: WorkspaceDesignFile) => {
    applyingRemoteDesignRef.current = true;
    setFile(preserveLoadedDesignPages(normalizeDesignFile(nextFile, project?.name ?? "未命名设计"), file));
  };

  const updateSelectedPage = (updater: (page: DesignPage) => DesignPage) => {
    updateFile((current) => ({
      ...current,
      pages: current.pages.map((page) => {
        if (page.id !== selectedPageId) {
          return page;
        }
        const nextPage = updater(page);
        loadedPageIdsRef.current.add(nextPage.id);
        return {
          ...nextPage,
          nodeCount: nextPage.nodes.length,
          schemaLoaded: true
        };
      })
    }));
  };

  const updateNode = (nodeId: string, patch: Partial<DesignNode>) => {
    updateSelectedPage((page) => ({
      ...page,
      nodes: page.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node)
    }));
  };

  const selectNodes = (ids: string[], primaryId = ids[0] ?? "") => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    setSelectedNodeIds(uniqueIds);
    setSelectedNodeId(primaryId || uniqueIds[0] || "");
  };

  const createPage = () => {
    const nextPage: DesignPage = {
      id: createId("page"),
      name: `页面 ${file.pages.length + 1}`,
      nodes: [],
      nodeCount: 0,
      schemaLoaded: true
    };
    loadedPageIdsRef.current.add(nextPage.id);
    updateFile((current) => ({
      ...current,
      pages: [...current.pages, nextPage]
    }));
    selectDesignPage(nextPage.id, [], { replace: false });
  };

  const deletePage = (pageId: string) => {
    if (file.pages.length <= 1) {
      toast.error("至少保留一个页面");
      return;
    }
    const pageIndex = file.pages.findIndex((page) => page.id === pageId);
    const nextPages = file.pages.filter((page) => page.id !== pageId);
    updateFile((current) => ({
      ...current,
      pages: current.pages.filter((page) => page.id !== pageId)
    }));
    if (selectedPageId === pageId) {
      const nextPage = nextPages[Math.max(0, pageIndex - 1)] ?? nextPages[0];
      selectDesignPage(nextPage.id, nextPage.nodes);
    }
    toast.success("页面已删除");
  };

  const addNode = (type: DesignNodeType) => {
    const nextNode = createNode(type, {
      x: 360 + selectedPage.nodes.length * 24,
      y: 260 + selectedPage.nodes.length * 24
    });
    updateSelectedPage((page) => ({
      ...page,
      nodes: [...page.nodes, nextNode]
    }));
    selectNodes([nextNode.id]);
    setTool("select");
  };

  const saveAiSettings = async () => {
    setSavingAiSettings(true);
    try {
      await updateWorkspaceLlmSettings(projectId, {
        provider: aiProvider,
        baseUrl: aiBaseUrl.trim() || undefined,
        modelProfile: "balanced",
        stageModelRouting: {
          design: aiModel.trim() || undefined
        },
        apiKey: aiApiKey.trim() || undefined,
        systemPrompt: aiSystemPrompt
      });
      updateFile((current) => ({
        ...current,
        aiSettings: {
          ...(current.aiSettings ?? {}),
          systemPrompt: aiSystemPrompt
        }
      }));
      setAiApiKey("");
      toast.success("AI Design 设置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 设置保存失败");
    } finally {
      setSavingAiSettings(false);
    }
  };

  const cancelDesignAgentMessage = async () => {
    aiStreamControllerRef.current?.abort();
    aiStreamControllerRef.current = null;
    setAiBusy(false);
    setAiConversationRunning(false);
    try {
      await cancelAiDesignAgentConversation(projectId, aiConversationId);
      setAiMessages((current) => [...current, {
        id: createId("ai-message"),
        role: "assistant",
        content: "已中断当前会话的执行。你可以在这个会话里继续补充，也可以新开会话重来。",
        agentRole: "负责人 Agent"
      }]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "中断会话失败");
    }
  };

  const startNewDesignAgentConversation = async () => {
    if (aiBusy || aiConversationRunning) {
      await cancelDesignAgentMessage();
    }
    const nextConversationId = `design-agent-${projectId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    aiStreamingDeltaMessageIdRef.current = null;
    setAiConversationId(nextConversationId);
    setAiConversationRunning(false);
    window.localStorage.setItem(`aipm-ai-design-conversation:${projectId}`, nextConversationId);
    setAiMessages([{
      id: createId("ai-message"),
      role: "assistant",
      content: "已新开会话。之前会话已断开，新消息会使用新的上下文。"
    }]);
  };

  const resumeDesignAgentConversation = async () => {
    if (aiBusy || aiConversationRunning) {
      return;
    }
    await runDesignAgentMessage([
      "继续执行上次中断或未完成的 AI Design 任务。",
      "请根据会话上下文、最近工具结果和画布状态续接，不要从零开始重复已完成步骤。",
      "如果首版 UI 还没有真正落到画布，先生成 UI 稿；如果已生成但缺少截图，先执行 canvas.capture 并把截图展示在聊天框；然后再做视觉/交互审核和必要修复。"
    ].join("\n"));
  };

  const runDesignAgentMessage = async (message: string) => {
    const content = message.trim();
    if (!content || aiBusy) {
      return;
    }
    setAiInput("");
    setAiBusy(true);
    setAiConversationRunning(true);
    aiStreamingDeltaMessageIdRef.current = null;
    const controller = new AbortController();
    aiStreamControllerRef.current = controller;
    const userMessage: AiDesignChatMessage = { id: createId("ai-message"), role: "user", content };
    setAiMessages((current) => [...current, userMessage]);
    try {
      const requestPageId = selectedPageIdRef.current || selectedPageId;
      let finalFile: WorkspaceDesignFile | undefined;
      let finalPage: WorkspaceDesignPage | undefined;
      let streamFile: WorkspaceDesignFile = file;
      await streamAiDesignAgent(projectId, {
        message: content,
        pageId: requestPageId,
        systemPrompt: aiSystemPrompt,
        planningMode: aiPlanningMode,
        conversationId: aiConversationId
      }, (event: AiDesignAgentStreamEvent) => {
        if (event.type === "message") {
          setAiMessages((current) => [...current, { id: createId("ai-message"), role: "assistant", content: event.content, agentRole: event.agentRole }]);
          return;
        }
        if (event.type === "llm_delta") {
          const messageId = aiStreamingDeltaMessageIdRef.current ?? createId("ai-message");
          aiStreamingDeltaMessageIdRef.current = messageId;
          setAiMessages((current) => {
            const index = current.findIndex((item) => item.id === messageId);
            const prefix = `模型推理中（${event.source}）：\n`;
            if (index < 0) {
              return [...current, { id: messageId, role: "assistant", content: `${prefix}${event.delta}`, agentRole: event.agentRole }];
            }
            return current.map((item) => item.id === messageId ? { ...item, content: `${item.content}${event.delta}` } : item);
          });
          return;
        }
        if (event.type === "plan") {
          aiStreamingDeltaMessageIdRef.current = null;
          setAiMessages((current) => [...current, { id: createId("ai-message"), role: "assistant", content: [`执行计划：${event.title}`, ...event.steps].join("\n"), agentRole: event.agentRole ?? "负责人 Agent" }]);
          return;
        }
        if (event.type === "tool_call_start") {
          setAiMessages((current) => [...current, { id: createId("ai-message"), role: "assistant", content: `准备执行：${event.toolName}${event.reason ? `\n${event.reason}` : ""}`, agentRole: event.agentRole }]);
          return;
        }
        if (event.type === "tool_call_result") {
          setAiMessages((current) => [...current, {
            id: createId("ai-message"),
            role: "assistant",
            content: `${event.success ? "已完成" : "执行失败"}：${event.toolName}\n${event.message}`,
            agentRole: event.agentRole,
            previewImages: extractAiPreviewImages(event.result)
          }]);
          return;
        }
        if (event.type === "schema_patch" && event.file) {
          const eventPage = resolveAgentEventPage(requestPageId, event.page);
          const nextFile = mergeAgentPageIntoFile(
            preserveLoadedDesignPages(normalizeDesignFile(event.file, project?.name ?? "未命名设计"), streamFile),
            eventPage
          );
          streamFile = nextFile;
          finalFile = nextFile;
          finalPage = eventPage;
          setFile(nextFile);
          if (eventPage) {
            loadedPageIdsRef.current.add(eventPage.id);
          }
          if (selectedPageIdRef.current === requestPageId && event.selectedNodeIds?.length) {
            selectNodes(event.selectedNodeIds);
          }
          return;
        }
        if (event.type === "review") {
          setAiMessages((current) => [...current, { id: createId("ai-message"), role: "assistant", content: `审核结果：${event.message}`, agentRole: event.agentRole ?? "审核 Agent" }]);
          return;
        }
        if (event.type === "error") {
          setAiMessages((current) => [...current, { id: createId("ai-message"), role: "assistant", content: `执行失败：${event.message}`, agentRole: event.agentRole ?? "负责人 Agent" }]);
          return;
        }
        if (event.type === "done") {
          finalFile = preserveLoadedDesignPages(normalizeDesignFile(event.file, project?.name ?? "未命名设计"), streamFile);
          finalPage = resolveAgentEventPage(requestPageId, event.page);
          setAiMessages((current) => [...current, { id: createId("ai-message"), role: "assistant", content: event.summary, agentRole: event.agentRole ?? "负责人 Agent" }]);
        }
      }, { signal: controller.signal });
      if (finalFile) {
        const nextFile = mergeAgentPageIntoFile(
          preserveLoadedDesignPages(finalFile, streamFile),
          finalPage
        );
        setFile(nextFile);
        if (finalPage) {
          loadedPageIdsRef.current.add(finalPage.id);
        }
      }
      setLeftTab("ai");
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      const messageText = error instanceof Error ? error.message : "AI Design Agent 执行失败";
      setAiMessages((current) => [
        ...current,
        { id: createId("ai-message"), role: "assistant", content: messageText }
      ]);
      toast.error(messageText);
    } finally {
      if (aiStreamControllerRef.current === controller) {
        aiStreamControllerRef.current = null;
        setAiBusy(false);
        setAiConversationRunning(false);
      }
    }
  };

  const exportSvg = () => {
    const exportNodes = (selectedNodes.length > 0 ? selectedNodes : visibleNodes)
      .filter((node) => node.visible !== false);
    if (exportNodes.length === 0) {
      toast.error("当前没有可导出的图层");
      return;
    }

    const exportedName = selectedNodes.length === 1
      ? selectedNodes[0].name
      : selectedNodes.length > 1
        ? "selection"
        : selectedPage.name;
    const svg = buildDesignSvgDocument(exportNodes, exportedName);
    const filename = `${sanitizeSvgFileName(file.name)}-${sanitizeSvgFileName(exportedName)}.svg`;
    downloadTextFile(filename, svg, "image/svg+xml;charset=utf-8");
    toast.success(selectedNodes.length > 0 ? "已导出选中图层 SVG" : "已导出当前页面 SVG");
  };

  const deleteSelectedNode = () => {
    if (selectedNodeIds.length === 0) {
      return;
    }
    updateSelectedPage((page) => ({
      ...page,
      nodes: page.nodes.filter((node) => !selectedNodeIds.includes(node.id))
    }));
    selectNodes([]);
  };

  const duplicateSelectedNode = () => {
    if (selectedNodes.length === 0) {
      return;
    }
    const nextNodes = cloneDesignNodesWithNewIds(selectedNodes, (node) => ({
      name: `${node.name} Copy`,
      x: node.x + 28,
      y: node.y + 28,
      locked: false
    }));
    updateSelectedPage((page) => ({
      ...page,
      nodes: [...page.nodes, ...nextNodes]
    }));
    selectNodes(nextNodes.map((node) => node.id));
  };

  const createContainerFromSelection = (anchorNodeId?: string) => {
    const sourceIds = getContextActionNodeIds(anchorNodeId, selectedNodeIds);
    const topLevelIds = getTopLevelNodeIds(sourceIds, selectedPage.nodes);
    const sourceNodes = topLevelIds
      .map((id) => selectedPage.nodes.find((node) => node.id === id))
      .filter((node): node is DesignNode => Boolean(node));
    if (sourceNodes.length === 0) {
      toast.error("请先选择要放入容器的图层");
      return;
    }

    const bounds = getNodesBoundsForSelection(sourceNodes);
    if (!bounds) {
      toast.error("无法计算选中图层范围");
      return;
    }

    const minZIndex = Math.min(...sourceNodes.map((node) => node.zIndex ?? 0));
    const container = createNode("container", {
      name: `容器 ${selectedPage.nodes.filter((node) => node.type === "container").length + 1}`,
      x: Math.round(bounds.x - 16),
      y: Math.round(bounds.y - 16),
      width: Math.round(bounds.width + 32),
      height: Math.round(bounds.height + 32),
      fill: "transparent",
      stroke: "#7c3cff",
      strokeWidth: 1,
      strokeDashPattern: [6, 4],
      zIndex: minZIndex - 1
    });

    const childIdSet = new Set(topLevelIds);
    updateSelectedPage((page) => ({
      ...page,
      nodes: [
        ...page.nodes.map((node) => childIdSet.has(node.id) ? { ...node, parentId: container.id } : node),
        container
      ]
    }));
    setExpandedLayerIds((current) => current.includes(container.id) ? current : [...current, container.id]);
    selectNodes([container.id]);
    setContextMenu(null);
    toast.success(`已创建容器，并挂载 ${sourceNodes.length} 个图层`);
  };

  const openCreateComponentDialog = (anchorNodeId?: string) => {
    const sourceIds = getContextActionNodeIds(anchorNodeId, selectedNodeIds);
    const topLevelIds = getTopLevelNodeIds(sourceIds, selectedPage.nodes);
    if (topLevelIds.length === 0) {
      toast.error("请先框选或选择要创建为组件的图层");
      return;
    }
    const defaultLibrary = componentLibraries[0];
    setComponentForm({
      name: `${selectedPage.nodes.find((node) => node.id === topLevelIds[0])?.name ?? "选区"} 组件`,
      libraryId: defaultLibrary?.id ?? "",
      description: ""
    });
    setCreateComponentDialog({
      nodeIds: topLevelIds,
      defaultName: `${selectedPage.nodes.find((node) => node.id === topLevelIds[0])?.name ?? "选区"} 组件`
    });
    setContextMenu(null);
  };

	  const getTemplateSourceFromSelection = (anchorNodeId?: string) => {
	    const sourceIds = getContextActionNodeIds(anchorNodeId, selectedNodeIds);
    const selectedSet = new Set(sourceIds);
    const directFrames = sourceIds
      .map((id) => selectedPage.nodes.find((node) => node.id === id))
      .filter((node): node is DesignNode => Boolean(node && node.type === "frame"));
    if (directFrames.length > 0) {
      const frame = directFrames.sort((first, second) => (second.width * second.height) - (first.width * first.height))[0];
      return {
        name: frame.name || selectedPage.name,
        sourceFrameId: frame.id,
        width: frame.width,
        height: frame.height,
        nodes: createPageTemplateNodes(selectedPage.nodes, frame)
      };
    }
    const selectedSourceNodes = selectedPage.nodes.filter((node) => selectedSet.has(node.id));
    const selectedBounds = getNodesBoundsForSelection(selectedSourceNodes);
    if (!selectedBounds) {
      return undefined;
    }
    const containingFrame = selectedPage.nodes
      .filter((node) => node.type === "frame")
      .filter((frame) => rectContainsRect(selectedBounds, nodeToRect(frame), 8) || rectContainsRect(nodeToRect(frame), selectedBounds, 8))
      .sort((first, second) => (second.width * second.height) - (first.width * first.height))[0];
    if (containingFrame) {
      return {
        name: containingFrame.name || selectedPage.name,
        sourceFrameId: containingFrame.id,
        width: containingFrame.width,
        height: containingFrame.height,
        nodes: createPageTemplateNodes(selectedPage.nodes, containingFrame)
      };
    }
    const topLevelIds = getTopLevelNodeIds(sourceIds, selectedPage.nodes);
    const nodes = createPageTemplateNodesFromSelection(selectedPage.nodes, topLevelIds, selectedBounds);
    return {
      name: selectedSourceNodes.length === 1 ? selectedSourceNodes[0].name : "选区页面模板",
      sourceFrameId: "",
      width: selectedBounds.width,
      height: selectedBounds.height,
      nodes
	    };
	  };

	  const canCreateTemplateFromContext = (anchorNodeId?: string) => {
	    return getContextActionNodeIds(anchorNodeId, selectedNodeIds).length > 0;
	  };

  const createTemplateFromSelection = (anchorNodeId?: string) => {
    const templateSource = getTemplateSourceFromSelection(anchorNodeId);
    if (!templateSource || templateSource.nodes.length === 0) {
      toast.error("请先框选要创建为页面模板的区域");
      return;
    }
    const templateNodes = templateSource.nodes;
    const now = new Date().toISOString();
    const template: PageTemplate = {
      id: createId("page-template"),
      name: `${templateSource.name || selectedPage.name} 模板`,
      description: "从框选区域创建的页面模板，包含 StyleProfile，可供后续 AI/Renderer 参考。",
      sourcePageId: selectedPage.id,
      sourceFrameId: templateSource.sourceFrameId,
      sourceFileName: file.name,
      nodeCount: templateNodes.length,
      width: Math.max(1, Math.round(templateSource.width)),
      height: Math.max(1, Math.round(templateSource.height)),
      nodes: templateNodes,
      styleProfile: extractStyleProfileFromNodes(templateNodes),
      createdAt: now,
      updatedAt: now
    };
    updateFile((current) => ({
      ...current,
      pageTemplates: [template, ...(current.pageTemplates ?? []).filter((item) => item.id !== template.id)]
    }));
    setPreviewTemplate(template);
    setLeftTab("components");
    setComponentCollectionView("all");
    setContextMenu(null);
    toast.success(`已创建页面模板：${template.name}`);
  };

  const deletePageTemplate = (template: PageTemplate) => {
    const confirmed = window.confirm(`确定删除页面模板「${template.name}」吗？`);
    if (!confirmed) return;
    updateFile((current) => ({
      ...current,
      pageTemplates: (current.pageTemplates ?? []).filter((item) => item.id !== template.id)
    }));
    if (previewTemplate?.id === template.id) {
      setPreviewTemplate(null);
    }
    toast.success(`已删除页面模板：${template.name}`);
  };

  const createComponentLibrary = async (input: { name: string; description?: string }) => {
    const name = input.name.trim();
    if (!name) {
      toast.error("请输入组件库名称");
      return undefined;
    }
    const library = await createAiDesignComponentLibrary(projectId, {
      name,
      description: input.description?.trim() || undefined
    });
    updateComponentStoreState((current) => ({
      ...current,
      componentLibraries: [library, ...(current.componentLibraries ?? []).filter((item) => item.id !== library.id)]
    }));
    if (library) {
      setSelectedComponentLibraryId(library.id);
    }
    return library;
  };

  const openCreateLibraryDialog = () => {
    setLibraryForm({ name: "", description: "" });
    setEditingLibraryId("");
    setLibraryDialogMode("create");
  };

  const openEditLibraryDialog = (library: LocalComponentLibrary) => {
    setLibraryForm({ name: library.name, description: library.description ?? "" });
    setEditingLibraryId(library.id);
    setLibraryDialogMode("edit");
  };

  const closeLibraryDialog = () => {
    setLibraryDialogMode(null);
    setEditingLibraryId("");
    setLibraryForm({ name: "", description: "" });
  };

  const submitLibraryDialog = async () => {
    if (libraryDialogMode === "edit") {
      const name = libraryForm.name.trim();
      if (!name) {
        toast.error("请输入组件库名称");
        return;
      }
      try {
        const library = await updateAiDesignComponentLibrary(projectId, editingLibraryId, {
          name,
          description: libraryForm.description.trim() || undefined
        });
        updateComponentStoreState((current) => ({
          ...current,
          componentLibraries: (current.componentLibraries ?? []).map((item) => item.id === library.id ? library : item)
        }));
        closeLibraryDialog();
        toast.success("组件库信息已更新");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "组件库保存失败");
      }
      return;
    }

    const library = await createComponentLibrary(libraryForm).catch((error) => {
      toast.error(error instanceof Error ? error.message : "组件库创建失败");
      return undefined;
    });
    if (!library) return;
    closeLibraryDialog();
    if (createComponentDialog) {
      setComponentForm((current) => ({ ...current, libraryId: library.id }));
    } else {
      setComponentCollectionView("library");
    }
    toast.success(`已创建组件库：${library.name}`);
  };

  const deleteComponentLibrary = async (library: LocalComponentLibrary) => {
    const count = localComponents.filter((component) => component.libraryId === library.id).length;
    const confirmed = window.confirm(count > 0
      ? `确定删除组件库「${library.name}」吗？库下 ${count} 个组件也会被删除。`
      : `确定删除组件库「${library.name}」吗？`);
    if (!confirmed) {
      return;
    }
    try {
      await deleteAiDesignComponentLibrary(projectId, library.id);
      updateComponentStoreState((current) => ({
        ...current,
        componentLibraries: (current.componentLibraries ?? []).filter((item) => item.id !== library.id),
        importedComponents: (current.importedComponents ?? []).filter((component) => component.libraryId !== library.id)
      }));
      if (selectedComponentLibraryId === library.id) {
        const nextLibrary = componentLibraries.find((item) => item.id !== library.id);
        setSelectedComponentLibraryId(nextLibrary?.id ?? "");
        setComponentCollectionView("libraries");
      }
      toast.success(`已删除组件库：${library.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "组件库删除失败");
    }
  };

  const submitCreateLocalComponent = async () => {
    if (!createComponentDialog) return;
    const library = componentLibraries.find((item) => item.id === componentForm.libraryId);
    if (!library) {
      toast.error("请选择组件库；没有组件库可以先创建一个");
      return;
    }
    const childrenByParentId = new Map<string, DesignNode[]>();
    selectedPage.nodes.forEach((node) => {
      if (!node.parentId) return;
      const children = childrenByParentId.get(node.parentId) ?? [];
      children.push(node);
      childrenByParentId.set(node.parentId, children);
    });
    const componentNodeIds = new Set<string>();
    const collectComponentNode = (nodeId: string) => {
      if (componentNodeIds.has(nodeId)) return;
      componentNodeIds.add(nodeId);
      (childrenByParentId.get(nodeId) ?? []).forEach((child) => collectComponentNode(child.id));
    };
    createComponentDialog.nodeIds.forEach(collectComponentNode);
    const sourceNodes = selectedPage.nodes.filter((node) => componentNodeIds.has(node.id));
    if (sourceNodes.length === 0) {
      toast.error("选区内没有可保存的图层");
      return;
    }
    const componentNodes = createLocalComponentNodes(sourceNodes);
    const component: ImportedDesignComponent = {
      id: createId("component"),
      name: componentForm.name.trim() || createComponentDialog.defaultName,
      description: componentForm.description.trim() || undefined,
      libraryId: library.id,
      sourceFileName: LOCAL_COMPONENT_SOURCE_NAME,
      nodeCount: componentNodes.length,
      nodes: componentNodes
    };
    try {
      const savedComponent = await createAiDesignComponent(projectId, component);
      updateComponentStoreState((current) => ({
        ...current,
        importedComponents: [savedComponent, ...(current.importedComponents ?? []).filter((item) => item.id !== savedComponent.id)]
      }));
      setCreateComponentDialog(null);
      setComponentForm({ name: "", libraryId: "", description: "" });
      setSelectedComponentLibraryId(library.id);
      setLeftTab("components");
      setComponentCollectionView("library");
      toast.success(`已保存到组件库「${library.name}」：${component.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "组件创建失败");
    }
  };

  const insertImportedComponent = (component: ImportedDesignComponent, position?: { x: number; y: number }) => {
    const minX = Math.min(...component.nodes.map((node) => node.x), 0);
    const minY = Math.min(...component.nodes.map((node) => node.y), 0);
    const targetX = Math.round(position?.x ?? 360);
    const targetY = Math.round(position?.y ?? 260);
    const nextNodes = cloneDesignNodesWithNewIds(component.nodes, (node, index) => ({
      name: index === 0 ? component.name : node.name,
      x: Math.round(node.x - minX + targetX),
      y: Math.round(node.y - minY + targetY),
      locked: false,
      visible: true
    }));

    updateSelectedPage((page) => ({
      ...page,
      nodes: [...page.nodes, ...nextNodes]
    }));
    selectNodes(nextNodes.map((node) => node.id));
    toast.success(`已插入组件：${component.name}`);
  };

  const openComponentLayerEditor = (component: ImportedDesignComponent) => {
    const pageId = `component-edit-${component.id}`;
    const editPage: DesignPage = {
      id: pageId,
      name: `编辑组件 / ${component.name}`,
      nodes: createLocalComponentNodes(component.nodes),
      nodeCount: component.nodes.length,
      schemaLoaded: true
    };
    updateFile((current) => ({
      ...current,
      pages: current.pages.some((page) => page.id === pageId)
        ? current.pages.map((page) => page.id === pageId ? editPage : page)
        : [...current.pages, editPage]
    }));
    setLeftTab("layers");
    setSelectedPageId(pageId);
    selectNodes(editPage.nodes[0]?.id ? [editPage.nodes[0].id] : []);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("node-id", pageId);
    nextParams.set("component-id", component.id);
    setSearchParams(nextParams, { replace: false });
  };

  const saveEditingComponentLayer = async () => {
    const component = localComponents.find((item) => item.id === editingComponentId);
    if (!component) {
      toast.error("当前没有正在编辑的组件");
      return;
    }
    const nextNodes = createLocalComponentNodes(selectedPage.nodes);
    try {
      const savedComponent = await updateAiDesignComponent(projectId, component.id, {
        ...component,
        nodeCount: nextNodes.length,
        nodes: nextNodes
      });
      updateComponentStoreState((current) => ({
        ...current,
        importedComponents: (current.importedComponents ?? []).map((item) => item.id === savedComponent.id ? savedComponent : item)
      }));
      toast.success(`已保存组件图层：${component.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "组件图层保存失败");
    }
  };

  const submitEditComponentInfo = async () => {
    if (!editComponentInfo) return;
    const library = componentLibraries.find((item) => item.id === componentForm.libraryId);
    if (!library) {
      toast.error("请选择组件库");
      return;
    }
    try {
      const savedComponent = await updateAiDesignComponent(projectId, editComponentInfo.id, {
        ...editComponentInfo,
        name: componentForm.name.trim() || editComponentInfo.name,
        libraryId: library.id,
        description: componentForm.description.trim() || undefined
      });
      updateComponentStoreState((current) => ({
        ...current,
        importedComponents: (current.importedComponents ?? []).map((component) => component.id === savedComponent.id ? savedComponent : component)
      }));
      setEditComponentInfo(null);
      toast.success("组件信息已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "组件信息保存失败");
    }
  };

  const deleteLocalComponent = async (component: ImportedDesignComponent) => {
    const confirmed = window.confirm(`确定删除组件「${component.name}」吗？`);
    if (!confirmed) {
      return;
    }
    try {
      await deleteAiDesignComponent(projectId, component.id);
      updateComponentStoreState((current) => ({
        ...current,
        importedComponents: (current.importedComponents ?? []).filter((item) => item.id !== component.id)
      }));
      if (editComponentInfo?.id === component.id) {
        setEditComponentInfo(null);
      }
      toast.success(`已删除组件：${component.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "组件删除失败");
    }
  };

  const insertImportedPage = async (page: DesignPage) => {
    let sourcePage = page;
    try {
      sourcePage = page.nodes.length > 0 || loadedPageIdsRef.current.has(page.id)
        ? page
        : await getAiDesignPage(projectId, page.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "页面 schema 加载失败，无法复制页面");
      return;
    }
    const clonedNodes = cloneDesignNodesWithNewIds(sourcePage.nodes, () => ({
      locked: false,
      visible: true
    }));
    const nextPage: DesignPage = {
      ...sourcePage,
      id: createId("page"),
      name: `${sourcePage.name} Copy`,
      nodes: clonedNodes,
      nodeCount: clonedNodes.length,
      schemaLoaded: true
    };
    loadedPageIdsRef.current.add(nextPage.id);
    updateFile((current) => ({
      ...current,
      pages: [...current.pages, nextPage]
    }));
    selectDesignPage(nextPage.id, nextPage.nodes, { replace: false });
    setLeftTab("layers");
    toast.success(`已插入页面：${sourcePage.name}`);
  };

  const insertImportedAsset = (asset: ImportedDesignAsset, position?: { x: number; y: number }) => {
    const nextNode = createNode("image", {
      name: asset.name,
      x: Math.round(position?.x ?? 360 + selectedPage.nodes.length * 20),
      y: Math.round(position?.y ?? 260 + selectedPage.nodes.length * 20),
      width: Math.max(160, asset.width ?? 260),
      height: Math.max(120, asset.height ?? 180),
      imageUrl: asset.url,
      sourceRef: asset.sourceRef,
      text: "",
      fill: "#ffffff"
    });
    updateSelectedPage((page) => ({
      ...page,
      nodes: [...page.nodes, nextNode]
    }));
    selectNodes([nextNode.id]);
    toast.success(`已插入图片：${asset.name}`);
  };

  const startDragPayload = (event: ReactDragEvent<HTMLElement>, payload: unknown) => {
    event.dataTransfer.setData("application/aipm-design", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleCanvasDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const payloadText = event.dataTransfer.getData("application/aipm-design");
    if (!payloadText) {
      return;
    }
    event.preventDefault();
    const scenePoint = getScenePoint(event.clientX, event.clientY);
    try {
      const payload = JSON.parse(payloadText) as
        | { kind: "asset"; asset: ImportedDesignAsset }
        | { kind: "component"; component: ImportedDesignComponent };
      if (payload.kind === "asset") {
        insertImportedAsset(payload.asset, scenePoint);
      }
      if (payload.kind === "component") {
        insertImportedComponent(payload.component, scenePoint);
      }
    } catch {
      toast.error("拖拽内容无法识别");
    }
  };

  const handleImportDesignFile = async (fileList: FileList | null) => {
    const sourceFile = fileList?.[0];
    if (!sourceFile) {
      return;
    }

    setImportingDesignFile(true);
    try {
      const nextFile = normalizeDesignFile(await importAiDesignFile(projectId, sourceFile), project?.name ?? "未命名设计");
      const previousPageIds = new Set(file.pages.map((page) => page.id));
      const insertedPage = nextFile.pages.find((page) => !previousPageIds.has(page.id)) ?? nextFile.pages[nextFile.pages.length - 1];
      applyingRemoteDesignRef.current = true;
      loadedPageIdsRef.current = new Set(nextFile.pages.filter((page) => page.nodes.length > 0).map((page) => page.id));
      setFile(nextFile);
      setLeftTab(nextFile.importedAssets?.length ? "assets" : "components");
      if (insertedPage) {
        selectDesignPage(insertedPage.id, insertedPage.nodes, { replace: false });
      }
      toast.success(`已导入 ${sourceFile.name}，并保存到本地项目空间`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败，请确认文件格式是否为 Sketch/Figma");
    } finally {
      setImportingDesignFile(false);
    }
  };

  const getScenePoint = (clientX: number, clientY: number) => {
    const rect = canvasViewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom
    };
  };

  const resolveInteractiveNodeAtPoint = (point: { x: number; y: number }) => {
    const hitNode = findTopDesignNodeAtPoint(hitTestNodes, point);
    return hitNode ? getCanvasSelectionTarget(hitNode, selectedPage.nodes, selectedNodeIds) : null;
  };

  const resolveDrillNodeAtPoint = (point: { x: number; y: number }) => {
    return findNextDrillNodeAtPoint(hitTestNodes, selectedPage.nodes, point, selectedNodeIds[0]);
  };

  const getDragNodesForSelection = (selectionIds: string[]) => {
    const dragIds = expandSelectionWithDescendants(selectionIds, selectedPage.nodes);
    const selectionSet = new Set(selectionIds);
    return dragIds
      .map((id) => selectedPage.nodes.find((item) => item.id === id))
      .filter((item): item is DesignNode => Boolean(item) && (!item.locked || selectionSet.has(item.id) || hasSelectedAncestor(item, selectionIds, selectedPage.nodes)));
  };

  const clearPanPreviewStyles = () => {
    if (panPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(panPreviewFrameRef.current);
      panPreviewFrameRef.current = null;
    }
    if (canvasSurfaceRef.current) {
      canvasSurfaceRef.current.style.transform = "";
    }
    if (canvasOverlayRef.current) {
      canvasOverlayRef.current.style.transform = "";
    }
    if (canvasViewportRef.current) {
      canvasViewportRef.current.style.backgroundPosition = "";
    }
  };

  const applyPanPreview = (nextPan: { x: number; y: number }) => {
    const session = panDragRef.current;
    if (!session) {
      return;
    }
    session.currentX = nextPan.x;
    session.currentY = nextPan.y;
    if (panPreviewFrameRef.current !== null) {
      return;
    }
    panPreviewFrameRef.current = window.requestAnimationFrame(() => {
      panPreviewFrameRef.current = null;
      const latest = panDragRef.current;
      if (!latest) {
        return;
      }
      const dx = latest.currentX - latest.originX;
      const dy = latest.currentY - latest.originY;
      if (canvasViewportRef.current) {
        canvasViewportRef.current.style.backgroundPosition = `${latest.currentX}px ${latest.currentY}px`;
      }
      if (canvasSurfaceRef.current) {
        canvasSurfaceRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      }
      if (canvasOverlayRef.current) {
        canvasOverlayRef.current.style.transform = `translate(${latest.currentX}px, ${latest.currentY}px) scale(${zoom})`;
      }
    });
  };

  const startNodeDragSession = (selectionIds: string[], scenePoint: { x: number; y: number }) => {
    const dragIds = getDragNodesForSelection(selectionIds);
    nodeDragRef.current = {
      nodeIds: dragIds.map((item) => item.id),
      startX: scenePoint.x,
      startY: scenePoint.y,
      currentDx: 0,
      currentDy: 0,
      originals: dragIds.map((item) => ({ id: item.id, x: item.x, y: item.y }))
    };
    dragPreviewRef.current = { nodeIds: dragIds.map((item) => item.id), dx: 0, dy: 0 };
    setDragPreviewNodeIds(dragIds.map((item) => item.id));
    if (selectionPreviewRef.current) {
      selectionPreviewRef.current.style.transform = "translate3d(0px, 0px, 0)";
    }
  };

  const openNodeContextMenu = (event: ReactMouseEvent<HTMLElement>, node: DesignNode, source: DesignContextMenuState["source"]) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedNodeIds.includes(node.id)) {
      selectNodes([node.id]);
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      nodeId: node.id,
      source
    });
  };

  const handleCanvasContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const scenePoint = getScenePoint(event.clientX, event.clientY);
    const hitNode = resolveInteractiveNodeAtPoint(scenePoint);
    if (!hitNode) {
      setContextMenu(null);
      return;
    }
    if (!selectedNodeIds.includes(hitNode.id)) {
      selectNodes([hitNode.id]);
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      nodeId: hitNode.id,
      source: "canvas"
    });
  };

  const handleCanvasDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (tool !== "select") {
      return;
    }
    const scenePoint = getScenePoint(event.clientX, event.clientY);
    const hitNode = resolveDrillNodeAtPoint(scenePoint);
    if (!hitNode) {
      return;
    }
    selectNodes([hitNode.id], hitNode.id);
    setHoveredNodeId(hitNode.id);
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    if (tool === "hand" || isSpacePressed) {
      panDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: pan.x,
        originY: pan.y,
        currentX: pan.x,
        currentY: pan.y
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (tool === "frame" || tool === "rect" || tool === "text") {
      const scenePoint = getScenePoint(event.clientX, event.clientY);
      const nextNode = createNode(tool === "frame" ? "frame" : tool === "text" ? "text" : "container", {
        x: Math.round(scenePoint.x),
        y: Math.round(scenePoint.y)
      });
      updateSelectedPage((page) => ({
        ...page,
        nodes: [...page.nodes, nextNode]
      }));
      selectNodes([nextNode.id]);
      setTool("select");
      return;
    }

    const scenePoint = getScenePoint(event.clientX, event.clientY);
    const hitNode = resolveInteractiveNodeAtPoint(scenePoint);
    if (hitNode) {
      const append = event.shiftKey || event.metaKey || event.ctrlKey;
      const nextSelection = append
        ? selectedNodeIds.includes(hitNode.id)
          ? selectedNodeIds.filter((id) => id !== hitNode.id)
          : [...selectedNodeIds, hitNode.id]
          : selectedNodeIds.includes(hitNode.id)
            ? selectedNodeIds
            : [hitNode.id];
      selectNodes(nextSelection, hitNode.id);
      const dragSelection = selectedNodeIds.includes(hitNode.id) && !append ? selectedNodeIds : nextSelection;
      if (!hitNode.locked || selectedNodeIds.includes(hitNode.id)) {
        startNodeDragSession(dragSelection, scenePoint);
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (tool === "select" && selectionBounds && selectedNodeIds.length > 0 && rectContainsPoint(selectionBounds, scenePoint)) {
      startNodeDragSession(selectedNodeIds, scenePoint);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    selectionDragRef.current = {
      append: event.shiftKey || event.metaKey || event.ctrlKey,
      start: scenePoint,
      current: scenePoint
    };
    setSelectionRect({ start: scenePoint, current: scenePoint });
    if (!selectionDragRef.current.append) {
      selectNodes([]);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panDragRef.current) {
      applyPanPreview({
        x: panDragRef.current.originX + event.clientX - panDragRef.current.startX,
        y: panDragRef.current.originY + event.clientY - panDragRef.current.startY
      });
      return;
    }

    if (nodeDragRef.current) {
      const scenePoint = getScenePoint(event.clientX, event.clientY);
      const deltaX = scenePoint.x - nodeDragRef.current.startX;
      const deltaY = scenePoint.y - nodeDragRef.current.startY;
      const roundedDx = Math.round(deltaX);
      const roundedDy = Math.round(deltaY);
      nodeDragRef.current.currentDx = roundedDx;
      nodeDragRef.current.currentDy = roundedDy;
      if (dragPreviewRef.current) {
        dragPreviewRef.current.dx = roundedDx;
        dragPreviewRef.current.dy = roundedDy;
      }
      if (selectionPreviewRef.current) {
        selectionPreviewRef.current.style.transform = `translate3d(${roundedDx}px, ${roundedDy}px, 0)`;
      }
      return;
    }

    if (tool === "select") {
      const scenePoint = getScenePoint(event.clientX, event.clientY);
      const hitNode = resolveInteractiveNodeAtPoint(scenePoint);
      setHoveredNodeId(hitNode?.id ?? "");
    }

    if (resizeDragRef.current) {
      const scenePoint = getScenePoint(event.clientX, event.clientY);
      const patchByNodeId = resizeSelectionNodes(resizeDragRef.current, scenePoint);
      updateSelectedPage((page) => ({
        ...page,
        nodes: page.nodes.map((node) => patchByNodeId.get(node.id) ? { ...node, ...patchByNodeId.get(node.id) } : node)
      }));
      return;
    }

    if (selectionDragRef.current && selectionRect) {
      const current = getScenePoint(event.clientX, event.clientY);
      selectionDragRef.current.current = current;
      setSelectionRect({
        ...selectionRect,
        current
      });
    }
  };

  const handleCanvasPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (selectionDragRef.current) {
      selectionDragRef.current.current = getScenePoint(event.clientX, event.clientY);
      const rect = normalizeRect(selectionDragRef.current.start, selectionDragRef.current.current);
      if (rect.width > 3 || rect.height > 3) {
        const matchedIds = selectedPage.nodes
          .filter((node) => node.visible !== false && rectContainsRect(rect, nodeToBounds(node)) && !node.locked)
          .map((node) => node.id);
        const nextIds = Array.from(new Set(matchedIds));
        selectNodes(selectionDragRef.current.append ? Array.from(new Set([...selectedNodeIds, ...nextIds])) : nextIds);
      }
    }
    if (panDragRef.current) {
      const nextPan = {
        x: panDragRef.current.currentX,
        y: panDragRef.current.currentY
      };
      panDragRef.current = null;
      setPan(nextPan);
      window.setTimeout(clearPanPreviewStyles, 0);
    }
    if (nodeDragRef.current) {
      const dragSession = nodeDragRef.current;
      const originalById = new Map(dragSession.originals.map((item) => [item.id, item]));
      if (dragSession.currentDx !== 0 || dragSession.currentDy !== 0) {
        updateSelectedPage((page) => ({
          ...page,
          nodes: page.nodes.map((node) => {
            const original = originalById.get(node.id);
            if (!original) {
              return node;
            }
            return {
              ...translateDesignNode(node, dragSession.currentDx, dragSession.currentDy),
              x: original.x + dragSession.currentDx,
              y: original.y + dragSession.currentDy
            };
          })
        }));
      }
    }
    nodeDragRef.current = null;
    dragPreviewRef.current = null;
    setDragPreviewNodeIds([]);
    if (selectionPreviewRef.current) {
      selectionPreviewRef.current.style.transform = "translate3d(0px, 0px, 0)";
    }
    resizeDragRef.current = null;
    selectionDragRef.current = null;
    setSelectionRect(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleNodePointerDown = (event: ReactPointerEvent<HTMLDivElement>, node: DesignNode) => {
    event.stopPropagation();
    const scenePoint = getScenePoint(event.clientX, event.clientY);
    const interactiveNode = getCanvasSelectionTarget(node, selectedPage.nodes, selectedNodeIds);
    if (!interactiveNode) {
      return;
    }
    if (interactiveNode.locked && !selectedNodeIds.includes(interactiveNode.id)) {
      selectNodes([interactiveNode.id]);
      return;
    }
    const append = event.shiftKey || event.metaKey || event.ctrlKey;
    const nextSelection = append
      ? selectedNodeIds.includes(interactiveNode.id)
        ? selectedNodeIds.filter((id) => id !== interactiveNode.id)
        : [...selectedNodeIds, interactiveNode.id]
      : selectedNodeIds.includes(interactiveNode.id)
        ? selectedNodeIds
        : [interactiveNode.id];
    selectNodes(nextSelection, interactiveNode.id);
    const dragSelection = selectedNodeIds.includes(interactiveNode.id) && !append ? selectedNodeIds : nextSelection;
    if (!interactiveNode.locked || selectedNodeIds.includes(interactiveNode.id)) {
      startNodeDragSession(dragSelection, scenePoint);
    }
    canvasViewportRef.current?.setPointerCapture(event.pointerId);
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>, handle: ResizeHandle) => {
    event.stopPropagation();
    if (!selectionBounds || selectedNodes.length === 0) {
      return;
    }
    const scenePoint = getScenePoint(event.clientX, event.clientY);
    resizeDragRef.current = {
      handle,
      startX: scenePoint.x,
      startY: scenePoint.y,
      bounds: selectionBounds,
      originals: selectedNodes
        .filter((node) => !node.locked)
        .map((node) => ({
          id: node.id,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height
        }))
    };
    canvasViewportRef.current?.setPointerCapture(event.pointerId);
  };

  const clampZoom = (value: number) => Math.min(2.2, Math.max(0.000025, Number(value.toFixed(4))));

  const handleZoom = (nextZoom: number, anchor?: { x: number; y: number }) => {
    const nextClampedZoom = clampZoom(nextZoom);
    const anchorPoint = anchor ?? {
      x: viewportSize.width / 2,
      y: viewportSize.height / 2
    };
    const sceneAnchor = {
      x: (anchorPoint.x - pan.x) / zoom,
      y: (anchorPoint.y - pan.y) / zoom
    };

    setZoom(nextClampedZoom);
    setPan({
      x: anchorPoint.x - sceneAnchor.x * nextClampedZoom,
      y: anchorPoint.y - sceneAnchor.y * nextClampedZoom
    });
  };

  const handleCanvasWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      const rect = event.currentTarget.getBoundingClientRect();
      handleZoom(zoom * (event.deltaY < 0 ? 1.08 : 0.92), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      });
      return;
    }

    const deltaScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportSize.height : 1;
    const deltaX = (event.deltaX || (event.shiftKey ? event.deltaY : 0)) * deltaScale;
    const deltaY = (event.shiftKey ? 0 : event.deltaY) * deltaScale;
    setPan((current) => ({
      x: current.x - deltaX,
      y: current.y - deltaY
    }));
  };

  const activeSelectionRect = selectionRect ? normalizeRect(selectionRect.start, selectionRect.current) : null;
  const showSelectionBounds = selectionBounds && selectedNodeIds.length > 0;
	  const canCreateTemplateForContextMenu = contextMenu ? canCreateTemplateFromContext(contextMenu.nodeId) : false;

  return (
    <>
    <div style={{ overscrollBehavior: 'none' }} className="flex h-screen min-h-0 w-screen flex-col overflow-hidden bg-[#f5f5f6] text-[#171717]">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e6e6e8] bg-white px-4">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="icon" onClick={() => navigate(`/project/${projectId}`)}>
            <ArrowLeft className="size-5" />
          </Button>
          <Button type="button" variant="ghost" size="icon">
            <PanelLeft className="size-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="font-semibold">{file.name}</div>
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">自动保存</Badge>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-2xl border border-[#ececef] bg-[#fafafa] p-1">
          <ToolbarButton active={tool === "select"} label="选择" onClick={() => setTool("select")} icon={MousePointer2} />
          <ToolbarButton active={tool === "hand"} label="平移" onClick={() => setTool("hand")} icon={Hand} />
          <ToolbarButton active={tool === "frame"} label="画板" onClick={() => setTool("frame")} icon={Frame} />
          <ToolbarButton active={tool === "rect"} label="容器" onClick={() => setTool("rect")} icon={RectangleHorizontal} />
          <ToolbarButton active={tool === "text"} label="文字" onClick={() => setTool("text")} icon={Type} />
          <div className="mx-1 h-6 w-px bg-[#dedee2]" />
          <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => addNode("table")}>
            <Table2 className="size-4" />
            Table
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" className="rounded-full gap-2" disabled>
            <Wand2 className="size-4" />
            AI 生成
          </Button>
          <Button type="button" variant="outline" className="rounded-full gap-2" disabled>
            <Code2 className="size-4" />
            D2C
          </Button>
          <Button type="button" variant="outline" className="rounded-full gap-2" onClick={exportSvg}>
            <Download className="size-4" />
            导出 SVG
          </Button>
          <Button type="button" className="rounded-full bg-[#246bfe] px-5 hover:bg-[#1558dc]">
            <Share2 className="mr-2 size-4" />
            分享
          </Button>
          <Button type="button" variant="ghost" size="icon">
            <Play className="size-5" />
          </Button>
          <Select value={String(Math.round(zoom * 100))} onValueChange={(value) => handleZoom(Number(value) / 100)}>
            <SelectTrigger className="h-9 w-[94px] rounded-full border-0 bg-[#f1f1f3]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 64, 75, 100, 125, 150, 200].map((item) => (
                <SelectItem key={item} value={String(item)}>{item}%</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {contextMenu && contextMenuNode ? (
        <div
          className="fixed z-[80] w-[220px] overflow-hidden rounded-2xl border border-[#e5e5e7] bg-white py-2 text-sm shadow-[0_18px_60px_rgba(0,0,0,0.22)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-[#f6f6f7]"
            onClick={() => {
              duplicateSelectedNode();
              setContextMenu(null);
            }}
          >
            <span>复制</span>
            <span className="text-xs text-[#999]">⌘D</span>
          </button>
          <button
            type="button"
            className="flex w-full items-center px-4 py-2.5 text-left hover:bg-[#f6f6f7]"
            onClick={() => createContainerFromSelection(contextMenu.nodeId)}
          >
            创建容器
          </button>
          <button
            type="button"
            className="flex w-full items-center px-4 py-2.5 text-left hover:bg-[#f6f6f7]"
            onClick={() => openCreateComponentDialog(contextMenu.nodeId)}
          >
            创建组件
          </button>
	          {canCreateTemplateForContextMenu ? (
            <button
              type="button"
              className="flex w-full items-center px-4 py-2.5 text-left hover:bg-[#f6f6f7]"
              onClick={() => createTemplateFromSelection(contextMenu.nodeId)}
            >
              创建页面模板
            </button>
          ) : null}
          <div className="my-2 h-px bg-[#eeeeef]" />
          <button
            type="button"
            className="flex w-full items-center px-4 py-2.5 text-left text-red-600 hover:bg-red-50"
            onClick={() => {
              deleteSelectedNode();
              setContextMenu(null);
            }}
          >
            删除图层
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-[#e6e6e8] bg-white">
          <div className="flex h-[54px] shrink-0 items-center border-b border-[#eeeeef] px-4">
            {[
              { id: "layers", label: "图层" },
              { id: "components", label: "组件" },
              { id: "assets", label: "资源" },
              { id: "ai", label: "AI" }
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setLeftTab(tab.id as DesignLeftTab)}
                className={`mr-5 text-sm font-medium ${leftTab === tab.id ? "text-[#171717]" : "text-[#777]"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {leftTab === "layers" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-[#eeeeef] p-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#89898f]" />
                  <Input value={layerQuery} onChange={(event) => setLayerQuery(event.target.value)} placeholder="搜索图层名称" className="h-9 border-0 bg-[#f5f5f7] pl-9" />
                </div>
              </div>
              <div className="border-b border-[#eeeeef] p-3" style={{ height: '50%', overflow: 'auto' }}>
                <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                  <span>页面</span>
                  <Button type="button" variant="ghost" size="icon" className="size-7" onClick={createPage}>
                    <Plus className="size-4" />
                  </Button>
                </div>
                <div className="space-y-1 text-xs">
                  {file.pages.map((page) => (
                    <div
                      key={page.id}
                      className={`group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs ${page.id === selectedPageId ? "bg-[#f0f0f2] font-semibold" : "hover:bg-[#f7f7f8]"}`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          selectDesignPage(page.id, page.nodes, { replace: false });
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <FileText className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{page.name}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`删除 ${page.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          deletePage(page.id);
                        }}
                        className="hidden rounded-lg p-1 text-[#999] hover:bg-white hover:text-red-600 group-hover:block"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="page-layer min-h-0 flex-1 overflow-y-auto p-3" style={{ height: '50%', overflow: 'auto' }}>
                <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                  <span>图层</span>
                  <Layers className="size-4 text-[#888]" />
                </div>
                <div className="space-y-1 text-xs">
                  <DesignLayerTree
                    nodes={layerTree}
                    expandedIds={expandedLayerIds}
                    selectedIds={selectedNodeIds}
                    onToggle={(nodeId) => {
                      setExpandedLayerIds((current) => current.includes(nodeId)
                        ? current.filter((id) => id !== nodeId)
                        : [...current, nodeId]);
                    }}
                    onSelect={(node, append) => {
                      selectNodes(append
                        ? selectedNodeIds.includes(node.id)
                          ? selectedNodeIds.filter((id) => id !== node.id)
                          : [...selectedNodeIds, node.id]
                        : [node.id], node.id);
                    }}
                    onContextMenu={(event, node) => openNodeContextMenu(event, node, "layer")}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {leftTab === "components" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mb-4 text-sm text-[#67676c]">点击插入基础组件，或导入 Sketch / Figma 文件转成可复用组件。</div>
              <input
                ref={designImportInputRef}
                type="file"
                className="hidden"
                accept=".sketch,.fig,.figma,application/octet-stream"
                onChange={(event) => {
                  void handleImportDesignFile(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="mb-4 w-full justify-start rounded-2xl"
                disabled={importingDesignFile}
                onClick={() => designImportInputRef.current?.click()}
              >
                <Import className="mr-2 size-4" />
                {importingDesignFile ? "正在导入 Sketch / Figma..." : "导入 Sketch / Figma 文件"}
              </Button>
              {componentCollectionView === "libraries" ? (
                <div>
                  <Button type="button" variant="ghost" size="sm" className="mb-3 px-0" onClick={() => setComponentCollectionView("all")}>
                    <ArrowLeft className="mr-2 size-4" />
                    返回组件
                  </Button>
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">本地组件库</div>
                      <div className="mt-1 text-xs text-[#777]">组件按组件库管理，并同步给 Agent 使用。</div>
                    </div>
                    <Button type="button" size="sm" className="rounded-full" onClick={openCreateLibraryDialog}>
                      <Plus className="mr-1 size-3.5" />
                      新建
                    </Button>
                  </div>
                  {componentLibraries.length ? (
                    <div className="space-y-2">
                      {componentLibraries.map((library) => {
                        const count = localComponents.filter((component) => component.libraryId === library.id).length;
                        return (
                        <div
                          key={library.id}
                          className="w-full rounded-2xl border border-[#ececef] bg-white p-3 text-left transition hover:border-[#246bfe] hover:bg-[#f7faff]"
                        >
                          <div className="flex items-center gap-2">
                            <Component className="size-4 text-[#6d35d8]" />
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left text-sm font-semibold"
                              onClick={() => {
                                setSelectedComponentLibraryId(library.id);
                                setComponentCollectionView("library");
                              }}
                            >
                              {library.name}
                            </button>
                            <Badge variant="secondary">{count}</Badge>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="flex size-7 items-center justify-center rounded-full hover:bg-[#ececf1]"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <MoreHorizontal className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditLibraryDialog(library)}>修改信息</DropdownMenuItem>
                                <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => deleteComponentLibrary(library)}>删除组件库</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <button
                            type="button"
                            className="mt-1 line-clamp-2 w-full text-left text-xs leading-5 text-[#777]"
                            onClick={() => {
                              setSelectedComponentLibraryId(library.id);
                              setComponentCollectionView("library");
                            }}
                          >
                            {library.description || "暂无描述"}
                          </button>
                        </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-[#d8d8dd] bg-[#fafafa] p-5 text-sm leading-6 text-[#777]">
                      现在还没有组件库。可以先创建组件库，再从画布选区右击创建组件。
                      <Button type="button" size="sm" className="mt-4 rounded-full" onClick={openCreateLibraryDialog}>
                        <Plus className="mr-1 size-3.5" />
                        创建组件库
                      </Button>
                    </div>
                  )}
                </div>
              ) : componentCollectionView === "library" ? (
                <div>
                  <Button type="button" variant="ghost" size="sm" className="mb-3 px-0" onClick={() => setComponentCollectionView("libraries")}>
                    <ArrowLeft className="mr-2 size-4" />
                    返回组件库
                  </Button>
                  <div className="mb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{selectedComponentLibrary?.name ?? "组件库"}</div>
                        <div className="mt-1 text-xs text-[#777]">{selectedLibraryComponents.length} 个组件</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary">本地</Badge>
                        {selectedComponentLibrary ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button type="button" className="flex size-7 items-center justify-center rounded-full hover:bg-[#ececf1]">
                                <MoreHorizontal className="size-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditLibraryDialog(selectedComponentLibrary)}>修改信息</DropdownMenuItem>
                              <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => deleteComponentLibrary(selectedComponentLibrary)}>删除组件库</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    </div>
                    {selectedComponentLibrary?.description ? (
                      <div className="mt-2 line-clamp-2 text-xs leading-5 text-[#777]">{selectedComponentLibrary.description}</div>
                    ) : null}
                  </div>
                  {selectedLibraryComponents.length ? (
                    <div className="space-y-2">
                      {selectedLibraryComponents.map((component) => (
                        <div
                          key={component.id}
                          draggable
                          onDragStart={(event) => startDragPayload(event, { kind: "component", component })}
                          className="w-full rounded-2xl border border-[#ececef] bg-white p-3 text-left transition hover:border-[#246bfe] hover:bg-[#f7faff]"
                        >
                          <div className="flex items-center gap-2">
                            <Component className="size-4 text-[#6d35d8]" />
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{component.name}</span>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="flex size-7 items-center justify-center rounded-full hover:bg-[#ececf1]"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <MoreHorizontal className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openComponentLayerEditor(component)}>修改图层</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => {
                                  setEditComponentInfo(component);
                                  setComponentForm({
                                    name: component.name,
                                    libraryId: component.libraryId ?? selectedComponentLibrary?.id ?? "",
                                    description: component.description ?? ""
                                  });
                                }}>修改信息</DropdownMenuItem>
                                <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => deleteLocalComponent(component)}>删除组件</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <div className="mt-1 text-xs text-[#777]">{component.nodeCount} 个节点，拖拽插入画布</div>
                          {component.description ? (
                            <div className="mt-2 line-clamp-2 text-xs leading-5 text-[#777]">{component.description}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-[#d8d8dd] bg-[#fafafa] p-5 text-sm leading-6 text-[#777]">
                      这个组件库还没有组件。框选画布区域后右击“创建组件”，并选择当前组件库。
                    </div>
                  )}
                </div>
              ) : (
                <>
              <button
                type="button"
                onClick={() => setComponentCollectionView("all")}
                className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-[#ececef] bg-white p-3 text-left"
              >
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#e9f2ff] text-[#246bfe]">
                  <Sparkles className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">页面模板</div>
                  <div className="mt-1 truncate text-xs text-[#777]">{pageTemplates.length} 个模板，框选区域后右击创建</div>
                </div>
              </button>
              {pageTemplates.length ? (
                <div className="mb-5 space-y-2">
                  {pageTemplates.slice(0, 6).map((template) => (
                    <div key={template.id} className="rounded-2xl border border-[#ececef] bg-white p-3">
                      <div className="flex items-center gap-2">
                        <Frame className="size-4 text-[#246bfe]" />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{template.name}</span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="flex size-7 items-center justify-center rounded-full hover:bg-[#ececf1]">
                              <MoreHorizontal className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setPreviewTemplate(template)}>预览模板</DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => deletePageTemplate(template)}>删除模板</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="mt-2 h-24">
                        <DesignMiniPreview nodes={template.nodes} className="h-full" />
                      </div>
                      <div className="mt-2 truncate text-xs text-[#777]">
                        {template.width}x{template.height} · {template.nodeCount} layers · {template.styleProfile.platform}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setComponentCollectionView("libraries")}
                className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-[#ececef] bg-white p-3 text-left transition hover:border-[#246bfe] hover:bg-[#f7faff]"
              >
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#ede7ff] text-[#6d35d8]">
                  <Component className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">本地组件库</div>
                  <div className="mt-1 truncate text-xs text-[#777]">{componentLibraries.length} 个组件库，{localComponents.length} 个组件</div>
                </div>
                <ChevronDown className="-rotate-90 size-4 text-[#999]" />
              </button>
              <div className="grid grid-cols-2 gap-3">
                {componentPresets.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => addNode(item.type)}
                      className="rounded-2xl border border-[#ececef] bg-white p-3 text-left transition hover:border-[#246bfe] hover:bg-[#f7faff]"
                    >
                      <Icon className="mb-3 size-5 text-[#246bfe]" />
                      <div className="text-sm font-semibold">{item.label}</div>
                      <div className="mt-1 text-xs leading-5 text-[#777]">{item.description}</div>
                    </button>
                  );
                })}
              </div>
              {externalImportedComponents.length ? (
                <div className="mt-6">
                  <div className="mb-3 text-sm font-semibold">导入组件</div>
                  <div className="space-y-2">
                    {externalImportedComponents.map((component) => (
                      <button
                        key={component.id}
                        type="button"
                        draggable
                        onDragStart={(event) => startDragPayload(event, { kind: "component", component })}
                        onClick={() => insertImportedComponent(component)}
                        className="w-full rounded-2xl border border-[#ececef] bg-white p-3 text-left transition hover:border-[#246bfe] hover:bg-[#f7faff]"
                      >
                        <div className="flex items-center gap-2">
                          <Component className="size-4 text-[#6d35d8]" />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{component.name}</span>
                        </div>
                        <div className="mt-1 truncate text-xs text-[#777]">
                          {component.sourceFileName} · {component.nodeCount} 个节点
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-6">
              </div>
              </>
              )}
            </div>
          ) : null}

          {leftTab === "assets" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mb-2 text-sm font-semibold">图片资源</div>
              <div className="mb-4 text-xs leading-5 text-[#777]">Sketch 里解析出的 bitmap / assets 会显示在这里。点击插入，或拖到画布指定位置。</div>
              {file.importedAssets?.some((asset) => asset.type === "image") ? (
                <div className="grid grid-cols-2 gap-3">
                  {file.importedAssets.filter((asset) => asset.type === "image").map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      draggable
                      onDragStart={(event) => startDragPayload(event, { kind: "asset", asset })}
                      onClick={() => insertImportedAsset(asset)}
                      className="group rounded-2xl border border-[#ececef] bg-white p-2 text-left transition hover:border-[#246bfe] hover:bg-[#f7faff]"
                    >
                      <div className="flex h-28 items-center justify-center overflow-hidden rounded-xl bg-[linear-gradient(135deg,#f4f6fb,#fff)]">
                        <img src={asset.url} alt={asset.name} className="max-h-full max-w-full object-contain" />
                      </div>
                      <div className="mt-2 truncate text-xs font-semibold">{asset.name}</div>
                      <div className="mt-1 truncate text-[11px] text-[#777]">{asset.sourceRef ?? asset.mimeType}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#d8d8de] bg-white p-5 text-sm leading-6 text-[#777]">
                  还没有解析到图片资源。导入包含 bitmap 的 Sketch 文件后，这里会出现缩略图和图片地址。
                </div>
              )}
            </div>
          ) : null}

          {leftTab === "ai" ? (
            <div className="flex min-h-0 flex-1 flex-col bg-[#fbfbfc]">
              <div className="border-b border-[#eeeeef] bg-white p-3">
                <button
                  type="button"
                  onClick={() => setAiSettingsOpen((open) => !open)}
                  className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-left text-sm font-semibold hover:bg-[#f7f7f8]"
                >
                  <span className="flex items-center gap-2">
                    <Settings2 className="size-4 text-[#246bfe]" />
                    AI 设置
                  </span>
                  <ChevronDown className={`size-4 text-[#777] transition-transform ${aiSettingsOpen ? "" : "-rotate-90"}`} />
                </button>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 flex-1 rounded-xl text-xs"
                    onClick={() => void startNewDesignAgentConversation()}
                  >
                    <Plus className="mr-1 size-3.5" />
                    新会话
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 flex-1 rounded-xl text-xs"
                    disabled={aiBusy || aiConversationRunning}
                    onClick={() => void resumeDesignAgentConversation()}
                  >
                    <Play className="mr-1 size-3.5" />
                    继续
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 flex-1 rounded-xl text-xs"
                    disabled={!aiBusy && !aiConversationRunning}
                    onClick={() => void cancelDesignAgentMessage()}
                  >
                    <Trash2 className="mr-1 size-3.5" />
                    中断
                  </Button>
                </div>
                <div className="mt-2 truncate px-2 text-[11px] text-[#777]">
                  当前会话：{aiConversationId.replace(`design-agent-${projectId}`, "默认会话")}{aiConversationRunning ? " · 运行中" : ""}
                </div>
                {aiSettingsOpen ? (
                  <div className="mt-3 space-y-3">
                    <div>
                      <div className="mb-1 text-xs font-medium text-[#666]">系统提示词</div>
                      <Textarea
                        value={aiSystemPrompt}
                        onChange={(event) => setAiSystemPrompt(event.target.value)}
                        placeholder="约束 AI Design Agent 的设计风格、组件规范、输出格式..."
                        className="h-24 resize-none border-[#e4e4e7] bg-[#fafafa] text-xs leading-5"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={aiProvider} onValueChange={(value) => setAiProvider(value as "openai" | "openai-compatible")}>
                        <SelectTrigger className="h-9 rounded-xl border-[#e4e4e7] bg-white text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openai">OpenAI</SelectItem>
                          <SelectItem value="openai-compatible">兼容接口</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={aiModel}
                        onChange={(event) => setAiModel(event.target.value)}
                        placeholder="设计模型"
                        className="h-9 rounded-xl border-[#e4e4e7] bg-white text-xs"
                      />
                    </div>
                    <Input
                      value={aiBaseUrl}
                      onChange={(event) => setAiBaseUrl(event.target.value)}
                      placeholder="Base URL，例如 https://api.openai.com/v1"
                      className="h-9 rounded-xl border-[#e4e4e7] bg-white text-xs"
                    />
                    <Input
                      value={aiApiKey}
                      onChange={(event) => setAiApiKey(event.target.value)}
                      placeholder={project?.llmSettings?.apiKeyConfigured ? "API Key 已配置，留空保持不变" : "API Key"}
                      type="password"
                      className="h-9 rounded-xl border-[#e4e4e7] bg-white text-xs"
                    />
                    <Button type="button" size="sm" className="w-full rounded-xl" disabled={savingAiSettings} onClick={() => void saveAiSettings()}>
                      {savingAiSettings ? "保存中..." : "保存 AI 设置"}
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* <div className="border-b border-[#eeeeef] bg-white p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Bot className="size-4 text-[#246bfe]" />
                  页面 Agent
                </div>
                <div className="mb-2 flex items-center gap-2 rounded-xl bg-[#f7f7f8] p-1">
                  {[
                    { value: "auto", label: "自动执行" },
                    { value: "plan", label: "规划模式" }
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setAiPlanningMode(item.value as "auto" | "plan")}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold ${aiPlanningMode === item.value ? "bg-white text-[#246bfe] shadow-sm" : "text-[#777]"}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "查询页面", prompt: "查询当前设计文件有哪些页面" },
                    { label: "当前 Schema", prompt: "获取当前页面 schema 信息" },
                    { label: "新建页面", prompt: "新建一个空白页面" },
                    { label: "复制页面", prompt: "复制当前页面" },
                    { label: "删除页面", prompt: "删除当前页面" },
                    { label: "生成表格页", prompt: "生成一个后台表格查询页面，包含筛选区、表格、分页和主操作按钮" }
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      disabled={aiBusy}
                      onClick={() => void runDesignAgentMessage(item.prompt)}
                      className="rounded-xl border border-[#ececef] bg-[#fafafa] px-3 py-2 text-left text-xs font-medium transition hover:border-[#246bfe] hover:bg-[#f7faff] disabled:opacity-60"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div> */}

              <div ref={aiMessagesViewportRef} className="min-h-0 flex-1 overflow-y-auto p-3">
                <div className="space-y-3">
                  {aiMessages.map((message) => (
                    <div key={message.id} className={`rounded-2xl px-3 py-2 text-sm leading-6 ${message.role === "user" ? "ml-6 bg-[#246bfe] text-white" : "mr-6 border border-[#ececef] bg-white text-[#333]"}`}>
                      <div className="mb-1 text-[11px] font-semibold opacity-70">{message.role === "user" ? "你" : message.agentRole ?? "AI Design Agent"}</div>
                      <div className="whitespace-pre-wrap">{message.content}</div>
                      {message.previewImages?.length ? (
                        <div className="mt-2 grid gap-2">
                          {message.previewImages.map((image) => (
                            <figure key={image.dataUrl} className="overflow-hidden rounded-xl border border-[#ececef] bg-[#f7f8fb]">
                              <button
                                type="button"
                                className="block w-full cursor-zoom-in bg-[#f7f8fb]"
                                onClick={() => setPreviewImageDialog(image)}
                              >
                                <img src={image.dataUrl} alt={image.label} className="block max-h-72 w-full object-contain" />
                              </button>
                              <figcaption className="border-t border-[#ececef] px-2 py-1 text-[11px] text-[#777]">{image.label}</figcaption>
                            </figure>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {aiBusy ? (
                    <div className="mr-6 rounded-2xl border border-[#ececef] bg-white px-3 py-2 text-sm text-[#777]">Agent 正在处理页面...</div>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-[#eeeeef] bg-white p-3">
                <Textarea
                  ref={aiInputRef}
                  value={aiInput}
                  onChange={(event) => {
                    setAiInput(event.target.value);
                    scrollAiInputToBottom();
                  }}
                  placeholder="告诉 AI：生成一个后台表格查询页 / 删除当前页 / 获取 schema..."
                  className="h-20 resize-none rounded-2xl border-[#e4e4e7] bg-[#fafafa] text-sm leading-5"
                />
                <Button
                  type="button"
                  className="mt-2 w-full rounded-2xl"
                  disabled={aiBusy || !aiInput.trim()}
                  onClick={() => void runDesignAgentMessage(aiInput)}
                >
                  <Send className="mr-2 size-4" />
                  发送给 Agent
                </Button>
              </div>
            </div>
          ) : null}
        </aside>

        <main className="relative min-h-0 flex-1 overflow-hidden bg-[#f3f3f4]">
          <div
            ref={canvasViewportRef}
            className={`h-full w-full touch-none ${tool === "hand" || isSpacePressed ? "cursor-grab" : tool === "select" ? "cursor-crosshair" : "cursor-default"}`}
            style={{
              backgroundImage: "linear-gradient(rgba(0,0,0,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px)",
              backgroundSize: `${80 * zoom}px ${80 * zoom}px`,
              backgroundPosition: `${pan.x}px ${pan.y}px`
            }}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerEnd}
            onPointerCancel={handleCanvasPointerEnd}
            onContextMenu={handleCanvasContextMenu}
            onDoubleClick={handleCanvasDoubleClick}
            onPointerLeave={() => setHoveredNodeId("")}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleCanvasDrop}
            onWheel={handleCanvasWheel}
          >
            <div ref={canvasSurfaceRef} className="pointer-events-none absolute inset-0 will-change-transform">
              <CanvasDesignRenderer nodes={canvasRenderedNodes} width={viewportSize.width} height={viewportSize.height} pan={pan} zoom={zoom} />
              <CanvasDragPreviewRenderer nodes={dragPreviewNodes} allNodes={resolvedSelectedPageNodes} previewRef={dragPreviewRef} width={viewportSize.width} height={viewportSize.height} pan={pan} zoom={zoom} />
            </div>
            {loadingPageId === selectedPageId ? (
              <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full border border-[#e4e4e7] bg-white/90 px-4 py-2 text-xs font-semibold text-[#555] shadow-sm">
                正在加载当前页面 schema...
              </div>
            ) : null}
            {/* {editingComponentId ? (
              <div className="absolute left-1/2 top-6 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#d8d8dd] bg-white/95 px-4 py-2 text-xs shadow-sm">
                <span className="font-semibold">正在编辑组件图层</span>
                <Button type="button" size="sm" className="h-7 rounded-full px-3" onClick={saveEditingComponentLayer}>保存组件</Button>
              </div>
            ) : null} */}
            <div
              ref={canvasOverlayRef}
              className="pointer-events-none absolute origin-top-left"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
              }}
            >
              {hoverBounds ? (
                <CanvasOutlineBoundsView bounds={hoverBounds} tone="hover" />
              ) : null}
              {showSelectionBounds ? (
                <div ref={selectionPreviewRef} className="absolute left-0 top-0 will-change-transform">
                  <SelectionBoundsView
                    bounds={selectionBounds}
                    onResizePointerDown={handleResizePointerDown}
                  />
                </div>
              ) : null}
              {activeSelectionRect ? (
                <div
                  className="pointer-events-none absolute border border-[#246bfe] bg-[#246bfe]/10"
                  style={{
                    left: activeSelectionRect.x,
                    top: activeSelectionRect.y,
                    width: activeSelectionRect.width,
                    height: activeSelectionRect.height,
                    zIndex: 999999
                  }}
                />
              ) : null}
            </div>
          </div>
          {/* <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-3xl bg-white px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <ToolbarButton active={tool === "select"} label="选择" onClick={() => setTool("select")} icon={MousePointer2} />
            <ToolbarButton active={tool === "hand"} label="平移" onClick={() => setTool("hand")} icon={Hand} />
            <ToolbarButton active={rightTab === "prototype"} label="原型" onClick={() => setRightTab("prototype")} icon={Play} />
            <div className="mx-1 h-7 w-px bg-[#e5e5e7]" />
            <Button type="button" variant="ghost" size="sm" onClick={() => handleZoom(zoom - 0.1)}>缩小</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => handleZoom(zoom + 0.1)}>放大</Button>
          </div> */}
          <DesignMinimap
            nodes={visibleNodes}
            bounds={minimapBounds}
            viewport={visibleSceneBounds}
            onViewportChange={(nextViewport) => {
              setPan({
                x: -nextViewport.x * zoom,
                y: -nextViewport.y * zoom
              });
            }}
          />
        </main>

        <aside className="flex w-[320px] shrink-0 flex-col border-l border-[#e6e6e8] bg-white">
          <div className="flex h-[54px] shrink-0 items-center border-b border-[#eeeeef] px-4">
            {[
              { id: "design", label: "设计" },
              { id: "prototype", label: "原型" },
              { id: "d2c", label: "D2C" }
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setRightTab(tab.id as DesignRightTab)}
                className={`mr-7 text-sm font-semibold ${rightTab === tab.id ? "text-[#171717]" : "text-[#777]"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {rightTab === "design" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {selectedNode ? (
                <div className="divide-y divide-[#eeeeef] text-xs">
                  <InspectorSection title="图层">
                    <div className="mb-1 block text-xs font-medium text-[#777]">{selectedNode.sourceLayerId}</div>
                    <Input value={selectedNode.name} onChange={(event) => updateNode(selectedNode.id, { name: event.target.value })} />
                    <div className="mt-3 flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => updateNode(selectedNode.id, { visible: !selectedNode.visible })}>
                        {selectedNode.visible ? <Eye className="mr-1 size-4" /> : <EyeOff className="mr-1 size-4" />}
                        {selectedNode.visible ? "显示" : "隐藏"}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => updateNode(selectedNode.id, { locked: !selectedNode.locked })}>
                        {selectedNode.locked ? <Lock className="mr-1 size-4" /> : <Unlock className="mr-1 size-4" />}
                        {selectedNode.locked ? "锁定" : "未锁"}
                      </Button>
                    </div>
                  </InspectorSection>
                  <InspectorSection title="位置和尺寸">
                    <div className="grid grid-cols-2 gap-3">
                      <NumberField label="X" value={selectedNode.x} onChange={(value) => updateNode(selectedNode.id, { x: value })} />
                      <NumberField label="Y" value={selectedNode.y} onChange={(value) => updateNode(selectedNode.id, { y: value })} />
                      <NumberField label="W" value={selectedNode.width} onChange={(value) => updateNode(selectedNode.id, { width: value })} />
                      <NumberField label="H" value={selectedNode.height} onChange={(value) => updateNode(selectedNode.id, { height: value })} />
                      <NumberField label="R" value={selectedNode.rotation ?? 0} onChange={(value) => updateNode(selectedNode.id, { rotation: normalizeRotationInput(value) })} />
                      <NumberField label="Z" value={selectedNode.zIndex ?? 0} onChange={(value) => updateNode(selectedNode.id, { zIndex: value })} />
                    </div>
                  </InspectorSection>
                  <InspectorSection title="外观">
                    <ColorField label="填充" value={selectedNode.fill} onChange={(value) => updateNode(selectedNode.id, { fill: value, fills: undefined })} />
                    <PaintLayersView paints={selectedNode.fills} />
                    <ColorField label="描边" value={selectedNode.stroke} onChange={(value) => updateNode(selectedNode.id, { stroke: value, borders: undefined })} />
                    <PaintLayersView paints={selectedNode.borders} />
                    <NumberField label="圆角" value={selectedNode.radius} onChange={(value) => updateNode(selectedNode.id, { radius: value })} />
                  </InspectorSection>
                  {isImageColorAdjustableNode(selectedNode) ? (
                    <InspectorSection title="效果">
                      <ImageColorControlsEditor
                        value={selectedNode.imageColorControls}
                        onChange={(imageColorControls) => updateNode(selectedNode.id, { imageColorControls })}
                      />
                    </InspectorSection>
                  ) : null}
                  <InspectorSection title="文字">
                    <Textarea value={selectedNode.text ?? ""} onChange={(event) => updateNode(selectedNode.id, { text: event.target.value })} className="min-h-24 resize-none" />
                    <div className="mt-4 space-y-3">
                      <div className="grid grid-cols-[1fr_112px] gap-3">
                        <Select value={selectedNode.fontFamily ?? "PingFang SC"} onValueChange={(value) => updateNode(selectedNode.id, { fontFamily: value })}>
                          <SelectTrigger className="h-10 rounded-xl border-[#e4e4e7] bg-[#f4f4f5]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from(new Set([selectedNode.fontFamily ?? "PingFang SC", ...designFontFamilies])).map((fontFamily) => (
                              <SelectItem key={fontFamily} value={fontFamily}>
                                <span style={{ fontFamily }}>{fontFamily}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <NumberField compact label="字号" value={selectedNode.fontSize} onChange={(value) => updateNode(selectedNode.id, { fontSize: Math.max(1, value) })} />
                      </div>

                      <div className="grid grid-cols-[1fr_112px] gap-3">
                        <Select value={`${selectedNode.fontWeight ?? 400}`} onValueChange={(value) => updateNode(selectedNode.id, { fontWeight: Number(value) })}>
                          <SelectTrigger className="h-10 rounded-xl border-[#e4e4e7] bg-[#f4f4f5]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {designFontWeights.map((item) => (
                              <SelectItem key={item.value} value={`${item.value}`}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={selectedNode.fontStretch ?? "normal"} onValueChange={(value) => updateNode(selectedNode.id, { fontStretch: value })}>
                          <SelectTrigger className="h-10 rounded-xl border-[#e4e4e7] bg-[#f4f4f5]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {designFontStretches.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <NumberField compact label="行高" value={selectedNode.lineHeight ?? 0} onChange={(value) => updateNode(selectedNode.id, { lineHeight: value > 0 ? value : undefined })} />
                        <NumberField compact label="字间距" value={selectedNode.letterSpacing ?? 0} onChange={(value) => updateNode(selectedNode.id, { letterSpacing: value })} />
                      </div>

                      <div className="grid grid-cols-4 gap-1 rounded-2xl bg-[#f1f1f2] p-1">
                        {[
                          { label: "左", value: "left" },
                          { label: "中", value: "center" },
                          { label: "右", value: "right" },
                          { label: "齐", value: "justify" }
                        ].map((item) => (
                          <TextStyleButton
                            key={item.value}
                            active={(selectedNode.textAlign ?? "left") === item.value}
                            onClick={() => updateNode(selectedNode.id, { textAlign: item.value as DesignNode["textAlign"] })}
                          >
                            {item.label}
                          </TextStyleButton>
                        ))}
                      </div>

                      <div className="grid grid-cols-4 gap-1 rounded-2xl bg-[#f1f1f2] p-1">
                        {[
                          { label: "文本", value: "none" },
                          { label: "AA", value: "uppercase" },
                          { label: "aa", value: "lowercase" },
                          { label: "Aa", value: "capitalize" }
                        ].map((item) => (
                          <TextStyleButton
                            key={item.value}
                            active={(selectedNode.textTransform ?? "none") === item.value}
                            onClick={() => updateNode(selectedNode.id, { textTransform: item.value as DesignTextTransform })}
                          >
                            {item.label}
                          </TextStyleButton>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <TextStyleButton active={selectedNode.underline === true} onClick={() => updateNode(selectedNode.id, { underline: !selectedNode.underline })}>
                          <span className="underline underline-offset-4">下划线</span>
                        </TextStyleButton>
                        <TextStyleButton active={selectedNode.strikethrough === true} onClick={() => updateNode(selectedNode.id, { strikethrough: !selectedNode.strikethrough })}>
                          <span className="line-through">中划线</span>
                        </TextStyleButton>
                      </div>

                      <ColorField label="颜色" value={selectedNode.textColor} onChange={(value) => updateNode(selectedNode.id, { textColor: value })} />
                    </div>
                  </InspectorSection>
                  <InspectorSection title="操作">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={duplicateSelectedNode}>
                        <Copy className="mr-1 size-4" />
                        复制
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={deleteSelectedNode}>
                        <Trash2 className="mr-1 size-4" />
                        删除
                      </Button>
                    </div>
                  </InspectorSection>
                </div>
              ) : (
                <div className="p-5 text-sm leading-6 text-[#777]">
                  选择画布里的组件后，可以在这里编辑位置、尺寸、颜色、圆角和文字。
                </div>
              )}
            </div>
          ) : null}

          {rightTab === "prototype" ? (
            <div className="p-5">
              <div className="mb-2 text-sm font-semibold">原型交互</div>
              <div className="text-sm leading-6 text-[#777]">第一版先预留页面跳转和弹窗交互入口，后续接入 PRD 到原型的自动生成。</div>
              <Button type="button" variant="outline" className="mt-4 w-full justify-between" disabled>
                点击后跳转
                <ChevronDown className="size-4" />
              </Button>
            </div>
          ) : null}

          {rightTab === "d2c" ? (
            <div className="p-5">
              <div className="mb-2 text-sm font-semibold">React 导出</div>
              <div className="text-sm leading-6 text-[#777]">后续把 UI Schema 映射到 React + Ant Design，目前先保留导出入口。</div>
              <pre className="mt-4 overflow-auto rounded-2xl bg-[#101010] p-4 text-xs leading-6 text-[#d7f7d0]">
{`<Button type="primary">
  ${selectedNode?.text ?? "确认"}
</Button>`}
              </pre>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
    <Dialog open={Boolean(previewImageDialog)} onOpenChange={(open) => !open && setPreviewImageDialog(null)}>
      <DialogContent className="max-h-[92vh] max-w-[92vw] overflow-hidden p-0">
        <DialogHeader className="border-b border-[#eeeeef] px-5 py-4">
          <DialogTitle>{previewImageDialog?.label ?? "画板截图"}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[82vh] overflow-auto bg-[#f5f5f6] p-4">
          {previewImageDialog ? (
            <img
              src={previewImageDialog.dataUrl}
              alt={previewImageDialog.label}
              className="mx-auto block max-w-none rounded-xl bg-white shadow-[0_16px_80px_rgba(0,0,0,0.18)]"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(previewTemplate)} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
      <DialogContent className="max-h-[92vh] max-w-[880px] overflow-hidden p-0">
        <DialogHeader className="border-b border-[#eeeeef] px-5 py-4">
          <DialogTitle>{previewTemplate?.name ?? "页面模板预览"}</DialogTitle>
        </DialogHeader>
        {previewTemplate ? (
          <div className="grid max-h-[82vh] grid-cols-[1fr_260px] overflow-hidden">
            <div className="overflow-auto bg-[#f5f5f6] p-4">
              <DesignMiniPreview nodes={previewTemplate.nodes} className="h-[68vh]" />
            </div>
            <div className="overflow-auto border-l border-[#eeeeef] p-4 text-xs leading-6 text-[#555]">
              <div className="mb-3 text-sm font-semibold text-[#171717]">StyleProfile</div>
              <div>平台：{previewTemplate.styleProfile.platform}</div>
              <div>主色：{previewTemplate.styleProfile.colors.primary ?? "-"}</div>
              <div>背景：{previewTemplate.styleProfile.colors.background ?? "-"}</div>
              <div>卡片圆角：{previewTemplate.styleProfile.radius.card ?? "-"}</div>
              <div>按钮圆角：{previewTemplate.styleProfile.radius.button ?? "-"}</div>
              <div>正文字号：{previewTemplate.styleProfile.typography.body ?? "-"}</div>
              <div>区块间距：{previewTemplate.styleProfile.spacing.sectionGap ?? "-"}</div>
              <div className="mt-4 text-[#777]">{previewTemplate.nodeCount} 个图层 · {previewTemplate.width}x{previewTemplate.height}</div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(libraryDialogMode)} onOpenChange={(open) => !open && closeLibraryDialog()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{libraryDialogMode === "edit" ? "修改组件库信息" : "创建组件库"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={libraryForm.name} onChange={(event) => setLibraryForm((current) => ({ ...current, name: event.target.value }))} placeholder="组件库名称" />
          <Textarea value={libraryForm.description} onChange={(event) => setLibraryForm((current) => ({ ...current, description: event.target.value }))} placeholder="组件库描述，供 Agent 识别风格和用途" className="min-h-24" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={closeLibraryDialog}>取消</Button>
            <Button type="button" onClick={submitLibraryDialog}>{libraryDialogMode === "edit" ? "保存" : "创建"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(createComponentDialog)} onOpenChange={(open) => !open && setCreateComponentDialog(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>创建组件</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={componentForm.name} onChange={(event) => setComponentForm((current) => ({ ...current, name: event.target.value }))} placeholder="组件名称" />
          <Select value={componentForm.libraryId} onValueChange={(value) => {
            if (value === "__create__") {
              openCreateLibraryDialog();
              return;
            }
            setComponentForm((current) => ({ ...current, libraryId: value }));
          }}>
            <SelectTrigger>
              <SelectValue placeholder="选择组件库" />
            </SelectTrigger>
            <SelectContent>
              {componentLibraries.map((library) => (
                <SelectItem key={library.id} value={library.id}>{library.name}</SelectItem>
              ))}
              <SelectItem value="__create__">创建新组件库...</SelectItem>
            </SelectContent>
          </Select>
          <Textarea value={componentForm.description} onChange={(event) => setComponentForm((current) => ({ ...current, description: event.target.value }))} placeholder="组件描述，供 Agent 检索和复用" className="min-h-24" />
          <div className="rounded-xl bg-[#f7f7f8] px-3 py-2 text-xs leading-5 text-[#777]">组件会以局部坐标保存，根节点 x/y 固定为 0；拖拽到画布时按落点插入。</div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateComponentDialog(null)}>取消</Button>
            <Button type="button" onClick={submitCreateLocalComponent}>创建组件</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(editComponentInfo)} onOpenChange={(open) => !open && setEditComponentInfo(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>修改组件信息</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={componentForm.name} onChange={(event) => setComponentForm((current) => ({ ...current, name: event.target.value }))} placeholder="组件名称" />
          <Select value={componentForm.libraryId} onValueChange={(value) => setComponentForm((current) => ({ ...current, libraryId: value }))}>
            <SelectTrigger>
              <SelectValue placeholder="选择组件库" />
            </SelectTrigger>
            <SelectContent>
              {componentLibraries.map((library) => (
                <SelectItem key={library.id} value={library.id}>{library.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea value={componentForm.description} onChange={(event) => setComponentForm((current) => ({ ...current, description: event.target.value }))} placeholder="组件描述" className="min-h-24" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditComponentInfo(null)}>取消</Button>
            <Button type="button" onClick={submitEditComponentInfo}>保存</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

function SelectionBoundsView({
  bounds,
  onResizePointerDown
}: {
  bounds: RectBounds;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>, handle: ResizeHandle) => void;
}) {
  const handles: Array<{ id: ResizeHandle; className: string; cursor: string }> = [
    { id: "nw", className: "-left-1.5 -top-1.5", cursor: "nwse-resize" },
    { id: "ne", className: "-right-1.5 -top-1.5", cursor: "nesw-resize" },
    { id: "sw", className: "-bottom-1.5 -left-1.5", cursor: "nesw-resize" },
    { id: "se", className: "-bottom-1.5 -right-1.5", cursor: "nwse-resize" }
  ];

  return (
    <div
      className="pointer-events-none absolute border border-[#246bfe]"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: 1000000
      }}
    >
      {handles.map((handle) => (
        <div
          key={handle.id}
          className={`pointer-events-auto absolute size-3 rounded-full border border-white bg-[#246bfe] ${handle.className}`}
          style={{ cursor: handle.cursor }}
          onPointerDown={(event) => onResizePointerDown(event, handle.id)}
        />
      ))}
    </div>
  );
}

function CanvasOutlineBoundsView({ bounds, tone }: { bounds: RectBounds; tone: "hover" }) {
  return (
    <div
      className="pointer-events-none absolute border border-dashed border-[#8b5cf6] bg-[#8b5cf6]/5"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: 999998
      }}
      data-tone={tone}
    />
  );
}

const canvasImageCache = new Map<string, { image: HTMLImageElement; loaded: boolean; failed: boolean }>();

function applyEffectiveCanvasOpacity(nodes: DesignNode[], allNodes: DesignNode[]) {
  if (nodes.length === 0) {
    return nodes;
  }
  const nodeById = new Map(allNodes.map((node) => [node.id, node]));
  const opacityById = new Map<string, number>();
  const resolveOpacity = (node: DesignNode, visiting = new Set<string>()): number => {
    const cached = opacityById.get(node.id);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(node.id)) {
      return node.opacity ?? 1;
    }
    visiting.add(node.id);
    const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
    const inherited = parent ? resolveOpacity(parent, visiting) : 1;
    visiting.delete(node.id);
    const opacity = Math.max(0, Math.min(1, inherited * (node.opacity ?? 1)));
    opacityById.set(node.id, opacity);
    return opacity;
  };

  return nodes.map((node) => {
    const opacity = resolveOpacity(node);
    return opacity === (node.opacity ?? 1) ? node : { ...node, opacity };
  });
}

function CanvasDesignRenderer({
  nodes,
  width,
  height,
  pan,
  zoom
}: {
  nodes: DesignNode[];
  width: number;
  height: number;
  pan: { x: number; y: number };
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [, setImageRevision] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(pan.x, pan.y);
    context.scale(zoom, zoom);
    const sortedNodes = [...nodes]
      .sort((first, second) => ((first.zIndex ?? 0) - (second.zIndex ?? 0)));
    sortedNodes.forEach((node) => drawDesignNodeOnCanvas(context, node, () => setImageRevision((current) => current + 1)));
    context.restore();
  }, [height, nodes, pan.x, pan.y, width, zoom]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" />;
}

function CanvasDragPreviewRenderer({
  nodes,
  allNodes,
  previewRef,
  width,
  height,
  pan,
  zoom
}: {
  nodes: DesignNode[];
  allNodes: DesignNode[];
  previewRef: MutableRefObject<{ nodeIds: string[]; dx: number; dy: number } | null>;
  width: number;
  height: number;
  pan: { x: number; y: number };
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [, setImageRevision] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) {
      return;
    }

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let frameId = 0;
    const draw = () => {
      const preview = previewRef.current;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      if (preview) {
        context.save();
        context.translate(pan.x, pan.y);
        context.scale(zoom, zoom);
        context.translate(preview.dx, preview.dy);
        applyEffectiveCanvasOpacity(nodes, allNodes)
          .sort((first, second) => (first.zIndex ?? 0) - (second.zIndex ?? 0))
          .forEach((node) => drawDesignNodeOnCanvas(context, node, () => setImageRevision((current) => current + 1)));
        context.restore();
      }
      frameId = window.requestAnimationFrame(draw);
    };

    frameId = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frameId);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
    };
  }, [allNodes, height, nodes, pan.x, pan.y, previewRef, width, zoom]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" />;
}

function DesignMinimap({
  nodes,
  bounds,
  viewport,
  onViewportChange
}: {
  nodes: DesignNode[];
  bounds: RectBounds;
  viewport: RectBounds;
  onViewportChange: (viewport: MinimapViewport) => void;
}) {
  const minimapWidth = 150;
  const minimapHeight = 80;
  const scale = Math.min(minimapWidth / Math.max(1, bounds.width), minimapHeight / Math.max(1, bounds.height));
  const contentWidth = bounds.width * scale;
  const contentHeight = bounds.height * scale;
  const offsetX = (minimapWidth - contentWidth) / 2;
  const offsetY = (minimapHeight - contentHeight) / 2;
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const toMiniRect = (rect: RectBounds) => ({
    x: offsetX + (rect.x - bounds.x) * scale,
    y: offsetY + (rect.y - bounds.y) * scale,
    width: Math.max(4, rect.width * scale),
    height: Math.max(4, rect.height * scale)
  });
  const viewportRect = toMiniRect(viewport);

  const miniPointToViewport = (clientX: number, clientY: number, target: HTMLDivElement, dragOffset?: { dx: number; dy: number }) => {
    const rect = target.getBoundingClientRect();
    const miniX = clientX - rect.left - offsetX - (dragOffset?.dx ?? viewportRect.width / 2);
    const miniY = clientY - rect.top - offsetY - (dragOffset?.dy ?? viewportRect.height / 2);
    onViewportChange({
      ...viewport,
      x: bounds.x + miniX / scale,
      y: bounds.y + miniY / scale
    });
  };

  return (
    <div className="absolute bottom-6 left-5 z-20 rounded-2xl border border-white/70 bg-white/88 p-2 shadow-[0_18px_45px_rgba(0,0,0,0.18)] backdrop-blur">
      <div
        className="relative overflow-hidden rounded-xl bg-[#f7f7f8]"
        style={{ width: minimapWidth, height: minimapHeight }}
        onPointerDown={(event) => {
          const target = event.currentTarget;
          dragRef.current = { dx: viewportRect.width / 2, dy: viewportRect.height / 2 };
          miniPointToViewport(event.clientX, event.clientY, target);
          target.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) {
            return;
          }
          miniPointToViewport(event.clientX, event.clientY, event.currentTarget, dragRef.current);
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
      >
        <div
          className="absolute"
          style={{
            left: offsetX,
            top: offsetY,
            width: contentWidth,
            height: contentHeight
          }}
        >
          {nodes.slice(0, 1800).map((node) => {
            const rect = toMiniRect(nodeToBounds(node));
            return (
              <div
                key={node.id}
                className="absolute rounded-[1px]"
                style={{
                  left: rect.x - offsetX,
                  top: rect.y - offsetY,
                  width: Math.max(1, rect.width),
                  height: Math.max(1, rect.height),
                  background: getMinimapNodeColor(node),
                  opacity: node.type === "text" ? 0.55 : 0.72
                }}
              />
            );
          })}
        </div>
        <div
          className="absolute rounded border-2 border-[#246bfe] bg-[#246bfe]/10 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
          style={{
            left: viewportRect.x,
            top: viewportRect.y,
            width: viewportRect.width,
            height: viewportRect.height
          }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between px-1 text-[10px] font-medium text-[#777]">
        <span>地图</span>
        <span>{nodes.length} layers</span>
      </div>
    </div>
  );
}

function DesignNodeView({
  node,
  selected,
  onPointerDown
}: {
  node: DesignNode;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const importedSketchNode = Boolean(node.sourceLayerClass);
  const importedSketchText = importedSketchNode && node.type === "text";
  const allowOverflow = shouldAllowDesignNodeOverflow(node);
  const shouldClip = shouldClipDesignNode(node);
  const contentOverflowVisible = (importedSketchText || allowOverflow) && !shouldClip;
  const vectorOnlyNode = hasVectorOnlyPaint(node);
  const baseStyle: CSSProperties = {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    background: vectorOnlyNode ? "transparent" : node.fill || "transparent",
    borderColor: selected ? "#246bfe" : node.stroke,
    borderWidth: selected ? Math.max(1, node.strokeWidth ?? 1) : vectorOnlyNode || node.stroke === "transparent" ? 0 : Math.max(0, node.strokeWidth ?? 1),
    borderRadius: node.radius,
    color: node.textColor,
    fontFamily: getCssFontFamily(node),
    fontWeight: node.fontWeight ?? 400,
    fontStretch: node.fontStretch,
    fontSize: node.fontSize,
    lineHeight: node.lineHeight ? `${node.lineHeight}px` : undefined,
    letterSpacing: node.letterSpacing !== undefined ? `${node.letterSpacing}px` : undefined,
    textAlign: node.textAlign ?? "left",
    textDecorationLine: getNodeTextDecoration(node),
    textTransform: node.textTransform ?? "none",
    opacity: node.opacity ?? 1,
    filter: getDesignNodeCssFilter(node),
    transform: getDesignNodeCssTransform(node),
    transformOrigin: "center center",
    boxShadow: node.shadow || undefined,
    zIndex: node.zIndex,
    clipPath: shouldClip ? getNodeClipPath(node) : undefined,
    overflow: shouldClip ? "hidden" : allowOverflow || (node.type === "text" && importedSketchNode) ? "visible" : undefined
  };

  return (
    <div
      className={`absolute select-none ${selected ? "ring-4 ring-[#246bfe]/20" : ""}`}
      style={baseStyle}
      onPointerDown={onPointerDown}
    >
      <div className={`pointer-events-none flex h-full w-full items-center justify-center text-center font-medium ${contentOverflowVisible ? "overflow-visible" : "overflow-hidden"} ${node.type === "image" || importedSketchNode ? "p-0" : "p-3"}`}>
        {node.svgPath ? (
          <DomSvgPathNode node={node} />
        ) : node.type === "table" && !importedSketchNode ? (
          <div className="h-full w-full overflow-hidden rounded bg-white text-left text-[13px] text-[#333]">
            <div className="grid bg-[#eef1f7] px-3 py-2 font-semibold" style={{ gridTemplateColumns: `repeat(${Math.max(1, getDesignTableColumns(node).length)}, minmax(0, 1fr))` }}>
              {getDesignTableColumns(node).map((column) => (
                <span key={column} className="truncate">{column}</span>
              ))}
            </div>
            {getDesignTableRows(node).map((row, rowIndex) => (
              <div key={rowIndex} className="grid border-t border-[#e5e7eb] px-3 py-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, getDesignTableColumns(node).length)}, minmax(0, 1fr))` }}>
                {getDesignTableColumns(node).map((column, index) => (
                  <span key={`${rowIndex}-${column}`} className="truncate">{row[index] ?? ""}</span>
                ))}
              </div>
            ))}
          </div>
        ) : node.type === "input" && !importedSketchNode ? (
          <div className="w-full rounded-xl border border-[#d7d7dc] bg-white px-4 py-3 text-left text-[#9a9aa0]">{node.text || "请输入内容"}</div>
        ) : node.type === "button" && !importedSketchNode ? (
          <div className="rounded-xl bg-[#246bfe] px-5 py-3 text-white">{node.text || "按钮"}</div>
        ) : node.type === "image" ? (
          node.imageUrl ? (
            <img src={node.imageUrl} alt={node.name} className="h-full w-full rounded-[inherit] object-fill" draggable={false} />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-xl bg-[linear-gradient(135deg,#f0f4ff,#fff)] text-[#6b7280]">Image</div>
          )
        ) : (
          <span className={`${contentOverflowVisible ? "overflow-visible" : "max-h-full overflow-hidden"} w-full whitespace-pre-wrap break-words ${importedSketchNode ? "px-0.5" : ""}`}>{node.text || (importedSketchNode ? "" : node.name)}</span>
        )}
      </div>
      {selected ? (
        <div className="pointer-events-none">
          <div className="absolute -top-8 left-0 rounded-lg bg-[#246bfe] px-2 py-1 text-xs font-semibold text-white">{node.name}</div>
        </div>
      ) : null}
    </div>
  );
}

function DesignMiniPreview({ nodes, className = "" }: { nodes: DesignNode[]; className?: string }) {
  const bounds = getNodesBounds(nodes);
  const scale = Math.min(1, 220 / bounds.width, 120 / bounds.height);

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-[#eeeeef] bg-[#f7f7f8] ${className}`}>
      <div
        className="absolute origin-top-left"
        style={{
          width: bounds.width,
          height: bounds.height,
          transform: `translate(${12 - bounds.x * scale}px, ${12 - bounds.y * scale}px) scale(${scale})`
        }}
      >
        {nodes.filter((node) => node.visible !== false).map((node) => (
          <div
            key={node.id}
            className="absolute overflow-hidden"
            style={{
              left: node.x,
              top: node.y,
              width: node.width,
              height: node.height,
              background: hasVectorOnlyPaint(node) ? "transparent" : node.type === "image" && node.imageUrl ? `url(${node.imageUrl}) center / 100% 100% no-repeat` : getCssPaintBackground(node.fills, node.fill),
              borderColor: node.stroke,
              borderWidth: hasVectorOnlyPaint(node) || node.stroke === "transparent" ? 0 : Math.max(0, node.strokeWidth ?? 1),
              borderRadius: Math.max(2, node.radius),
              color: node.textColor,
              fontFamily: getCssFontFamily(node),
              fontWeight: node.fontWeight ?? 400,
              fontStretch: node.fontStretch,
              fontSize: Math.max(10, node.fontSize),
              lineHeight: node.lineHeight ? `${node.lineHeight}px` : undefined,
              letterSpacing: node.letterSpacing !== undefined ? `${node.letterSpacing}px` : undefined,
              textAlign: node.textAlign ?? "left",
              textDecorationLine: getNodeTextDecoration(node),
              textTransform: node.textTransform ?? "none",
              opacity: node.opacity ?? 1,
              filter: getDesignNodeCssFilter(node),
              transform: getDesignNodeCssTransform(node),
              transformOrigin: "center center",
              boxShadow: node.shadow || undefined,
              zIndex: node.zIndex,
              clipPath: getNodeClipPath(node)
            }}
          >
            {node.svgPath ? (
              <DomSvgPathNode node={node} />
            ) : node.type !== "image" && (node.text || node.name) ? (
              <div className="flex h-full w-full items-center justify-center overflow-hidden p-2 text-center">
                <span className="truncate">{node.text || node.name}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function DomSvgDesignRenderer({ nodes, pan, zoom }: { nodes: DesignNode[]; pan: { x: number; y: number }; zoom: number }) {
  const tree = useMemo(() => buildDesignRenderTree(nodes), [nodes]);
  if (nodes.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute origin-top-left"
      style={{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
      }}
    >
      {tree.map((treeNode) => (
          <DomSvgDesignNode key={treeNode.node.id} treeNode={treeNode} />
        ))}
    </div>
  );
}

function DomSvgDesignNode({ treeNode, parentNode }: { treeNode: DesignRenderTreeNode; parentNode?: DesignNode }) {
  const { node, children } = treeNode;
  const textNode = node.type === "text";
  const imageNode = node.type === "image";
  const importedSketchNode = Boolean(node.sourceLayerClass);
  const allowOverflow = shouldAllowDesignNodeOverflow(node);
  const shouldClip = shouldClipDesignNode(node);
  const imageClip = getImageVisualClip(node);
  const visualX = imageClip ? imageClip.x : node.x;
  const visualY = imageClip ? imageClip.y : node.y;
  const visualWidth = imageClip ? imageClip.width : node.width;
  const visualHeight = imageClip ? imageClip.height : node.height;
  const visualRadius = imageClip?.rounded ? 9999 : node.radius;
  const backgroundStyle = getDomSvgNodeBackgroundStyle(node, parentNode);
  const style: CSSProperties = {
    position: "absolute",
    left: parentNode ? visualX - parentNode.x : visualX,
    top: parentNode ? visualY - parentNode.y : visualY,
    width: visualWidth,
    height: textNode ? "auto" : visualHeight,
    minHeight: textNode ? node.height : undefined,
    overflow: shouldClip ? "hidden" : allowOverflow ? "visible" : imageNode || node.fillImageUrl || (!importedSketchNode && visualRadius > 0) ? "hidden" : "visible",
    ...backgroundStyle,
    borderColor: node.stroke,
    borderStyle: node.stroke !== "transparent" && !node.svgTree && !node.svgPath && !node.svgPaths?.length ? "solid" : undefined,
    borderWidth: node.svgTree || node.svgPath || node.svgPaths?.length || node.stroke === "transparent" ? 0 : Math.max(0, node.strokeWidth ?? 1),
    borderRadius: visualRadius,
    boxShadow: node.shadow || undefined,
    opacity: node.opacity ?? 1,
    filter: getDesignNodeCssFilter(node),
    transform: getDesignNodeCssTransform(node),
    transformOrigin: "center center",
    zIndex: node.zIndex,
    clipPath: shouldClip && !imageClip ? getNodeClipPath(node) : undefined,
    color: node.textColor,
    fontFamily: getCssFontFamily(node),
    fontWeight: node.fontWeight ?? 400,
    fontStretch: node.fontStretch,
    fontSize: node.fontSize,
    lineHeight: node.lineHeight ? `${node.lineHeight}px` : `${Math.round(node.fontSize * 1.35)}px`,
    letterSpacing: node.letterSpacing !== undefined ? `${node.letterSpacing}px` : undefined,
    textAlign: node.textAlign ?? "left",
    textDecorationLine: getNodeTextDecoration(node),
    textTransform: node.textTransform ?? "none",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word"
  };
  return (
    <div style={style}>
      {(node.svgTree || node.svgPath || node.svgPaths?.length) ? (
        <DomSvgPathNode node={node} />
      ) : null}
      {node.type === "image" && node.imageUrl ? (
        <img
          src={node.imageUrl}
          alt={node.name}
          className="block max-w-none rounded-[inherit] object-fill"
          draggable={false}
          loading="lazy"
          style={imageClip ? {
            position: "absolute",
            left: node.x - imageClip.x,
            top: node.y - imageClip.y,
            width: node.width,
            height: node.height,
            borderRadius: 0
          } : {
            width: "100%",
            height: "100%"
          }}
        />
      ) : textNode && isIconFontNode(node) && !node.svgTree && !node.svgPath && !node.svgPaths?.length ? (
        <DomIconFontFallback node={node} />
      ) : textNode && !node.svgTree && !node.svgPath && !node.svgPaths?.length ? (
        <DomSvgTextContent node={node} />
      ) : node.text && !node.svgTree && !node.svgPath && !node.svgPaths?.length ? (
        <div className="flex h-full w-full items-center justify-center px-1 text-center">
          {transformTextContent(node.text, node.textTransform)}
        </div>
      ) : null}
      {children.map((child) => (
        <DomSvgDesignNode key={child.node.id} treeNode={child} parentNode={node} />
      ))}
    </div>
  );
}

function hasVectorOnlyPaint(node: DesignNode) {
  return Boolean((node.svgTree || node.svgPaths?.length || node.svgPath) && !node.fill?.includes("gradient("));
}

function DomIconFontFallback({ node }: { node: DesignNode }) {
  const color = node.textRuns?.[0]?.color ?? node.textColor ?? "#8a8f99";
  const label = `${node.name} ${node.text ?? ""}`.toLowerCase();
  const strokeWidth = Math.max(1.5, Math.min(node.width, node.height) / 12);
  const common = {
    fill: "none",
    stroke: color,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };
  const fillCommon = { fill: color, stroke: "none" };
  let content: ReactNode;
  if (/phone|mobile|tel|手机|电话/.test(label)) {
    content = <path {...common} d="M33 12h30a5 5 0 0 1 5 5v62a5 5 0 0 1-5 5H33a5 5 0 0 1-5-5V17a5 5 0 0 1 5-5Zm7 8h16M44 76h8" />;
  } else if (/left|back|返回|上一|chevron-left/.test(label)) {
    content = <path {...common} d="M58 22 34 48l24 26" />;
  } else if (/right|next|chevron|arrow|更多|进入|下一/.test(label)) {
    content = <path {...common} d="m38 22 24 26-24 26" />;
  } else if (/close|delete|remove|取消|关闭|删除/.test(label)) {
    content = <path {...common} d="M30 30 66 66M66 30 30 66" />;
  } else if (/plus|add|新增|添加|上传/.test(label)) {
    content = <path {...common} d="M48 24v48M24 48h48" />;
  } else if (/check|勾|选中|确认/.test(label)) {
    content = <path {...common} d="M24 50 40 66 72 30" />;
  } else {
    content = <circle {...fillCommon} cx="48" cy="48" r="10" />;
  }
  return (
    <svg className="h-full w-full" viewBox="0 0 96 96" aria-hidden="true">
      {content}
    </svg>
  );
}

function getDomSvgNodeBackgroundStyle(node: DesignNode, parentNode?: DesignNode): CSSProperties {
  if (node.type === "text") {
    return { background: "transparent" };
  }
  const paintBackground = getCssPaintBackground(node.fills, node.fill);
  const baseFill = node.svgTree || node.svgPath || node.svgPaths?.length
    ? "transparent"
    : isTransparentPaint(paintBackground)
      ? getImportedTransparentFallbackFill(node, parentNode) ?? "transparent"
      : paintBackground;
  if (!node.fillImageUrl) {
    return { background: baseFill || "transparent" };
  }
  return {
    backgroundColor: baseFill && baseFill !== "transparent" ? baseFill : undefined,
    backgroundImage: `url("${node.fillImageUrl}")`,
    backgroundRepeat: node.fillImageMode === "tile" ? "repeat" : "no-repeat",
    backgroundPosition: "center",
    backgroundSize: getFillImageBackgroundSize(node)
  };
}

function getCssPaintBackground(paints: WorkspaceDesignPaint[] | undefined, fallback: string | undefined) {
  return getRenderablePaintCssLayers(paints, fallback).join(", ") || fallback || "transparent";
}

function getImportedTransparentFallbackFill(node: DesignNode, parentNode?: DesignNode) {
  if (!parentNode && node.depth === 0 && node.sourceLayerClass === "group") {
    return "#f5f5f5";
  }
  if (isLikelySketchSidebarBackground(node, parentNode)) {
    return "#f8f8fa";
  }
  return undefined;
}

function isLikelySketchSidebarBackground(node: DesignNode, parentNode?: DesignNode) {
  return node.sourceLayerClass === "rectangle"
    && isTransparentPaint(node.fill)
    && node.width >= 160
    && node.width <= 280
    && node.height >= 360
    && (!parentNode || Math.abs(node.x - parentNode.x) <= 1)
    && node.zIndex !== undefined
    && (node.depth ?? 0) <= 3;
}

function isDesignNodeHitTestable(node: DesignNode) {
  if (node.visible === false || node.width <= 0 || node.height <= 0 || (node.opacity ?? 1) <= 0) {
    return false;
  }
  if (node.type === "image") {
    return Boolean(node.imageUrl || node.fillImageUrl);
  }
  if (node.type === "text") {
    return Boolean((node.text ?? "").trim() || node.textRuns?.some((run) => run.text.trim()));
  }
  if (node.svgTree || node.svgPath || node.svgPaths?.length) {
    return true;
  }
  if (node.fillImageUrl) {
    return true;
  }
  if (node.shadow || node.innerShadow) {
    return true;
  }
  const fill = getCssPaintBackground(node.fills, node.fill);
  const stroke = getFirstRenderablePaintCssLayer(node.borders, node.stroke);
  return !isTransparentPaint(fill) || (!isTransparentPaint(stroke) && (node.strokeWidth ?? 0) > 0);
}

function isTransparentPaint(value: string | undefined) {
  const paint = value?.trim().toLowerCase();
  return !paint
    || paint === "transparent"
    || paint === "none"
    || paint === "rgba(0, 0, 0, 0)"
    || paint === "rgba(255, 255, 255, 0)"
    || /rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(paint);
}

function getFillImageBackgroundSize(node: DesignNode) {
  if (node.fillImageMode === "tile") {
    return `${Math.max(1, (node.fillImageScale ?? 1) * 100)}%`;
  }
  if (node.fillImageMode === "fit") {
    return "contain";
  }
  if (node.fillImageMode === "fill") {
    return "cover";
  }
  return "100% 100%";
}

function getImageVisualClip(node: DesignNode) {
  if (node.type !== "image" || !node.imageUrl || !node.clipBounds) {
    return undefined;
  }
  const clip = node.clipBounds;
  if (!rectsIntersect(nodeToBounds(node), clip)) {
    return undefined;
  }
  return {
    ...clip,
    rounded: Boolean(node.clipPath?.svgPath && isEllipseSvgPath(node.clipPath.svgPath, clip.width, clip.height))
  };
}

function isEllipseSvgPath(path: string, width: number, height: number) {
  return path.includes(" A ")
    && path.includes(` ${formatSvgNumber(width)} `)
    && path.includes(` ${formatSvgNumber(height / 2)} `);
}

function DomSvgPathNode({ node }: { node: DesignNode }) {
  if (node.svgTree) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="block h-full w-full overflow-visible"
        viewBox={`0 0 ${Math.max(1, node.width)} ${Math.max(1, node.height)}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {renderDesignSvgTreeNode(node, node.svgTree, "root")}
      </svg>
    );
  }

  const paths = node.svgPaths?.length
    ? node.svgPaths
    : node.svgPath
      ? [{
          d: node.svgPath,
          fill: node.fill,
          stroke: node.stroke,
          strokeWidth: node.strokeWidth,
          strokeDashPattern: node.strokeDashPattern,
          strokeLineCap: node.strokeLineCap,
          strokeLineJoin: node.strokeLineJoin,
          fillRule: node.svgFillRule
        }]
      : [];
  const visiblePaths = paths.filter((path) => !isInvisibleDesignSvgPath(node, path));
  const paints = visiblePaths.map((path, index) => ({
    fill: getSvgPaintDescriptor(node, path.fill ?? node.fill, "fill", "transparent", `${index}`),
    stroke: getSvgPaintDescriptor(node, path.stroke ?? node.stroke, "stroke", "none", `${index}`)
  }));
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="block h-full w-full overflow-visible"
      viewBox={`0 0 ${Math.max(1, node.width)} ${Math.max(1, node.height)}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {paints.some((paint) => paint.fill.definition || paint.stroke.definition) ? (
        <defs>
          {paints.map((paint, index) => (
            <Fragment key={`paint-${index}`}>
              {paint.fill.definition}
              {paint.stroke.definition}
            </Fragment>
          ))}
        </defs>
      ) : null}
      {visiblePaths.map((path, index) => (
        <path
          key={`${node.id}-path-${index}`}
          d={path.d}
          fill={paints[index]?.fill.paint ?? "transparent"}
          fillRule={path.fillRule ?? node.svgFillRule ?? "nonzero"}
          stroke={paints[index]?.stroke.paint ?? "none"}
          strokeWidth={(path.stroke ?? node.stroke) === "transparent" ? 0 : Math.max(0, path.strokeWidth ?? node.strokeWidth ?? 1)}
          strokeDasharray={path.strokeDashPattern?.join(" ")}
          strokeLinecap={path.strokeLineCap ?? "butt"}
          strokeLinejoin={path.strokeLineJoin ?? "miter"}
          opacity={path.opacity}
          transform={path.transform}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function renderDesignSvgTreeNode(owner: DesignNode, svgNode: DesignSvgNode, keyPath: string): ReactNode {
  if (svgNode.opacity !== undefined && svgNode.opacity <= 0) {
    return null;
  }
  const fill = svgNode.fill !== undefined
    ? getSvgPaintDescriptor(owner, svgNode.fill, "fill", "none", keyPath)
    : undefined;
  const stroke = svgNode.stroke !== undefined
    ? getSvgPaintDescriptor(owner, svgNode.stroke, "stroke", "none", keyPath)
    : undefined;
  const definitions = [fill?.definition, stroke?.definition].filter(Boolean);

  if (svgNode.type === "g") {
    if (isCompoundSvgPathGroup(svgNode)) {
      return (
        <Fragment key={keyPath}>
          {definitions.length > 0 ? <defs>{definitions}</defs> : null}
          <path
            d={getCompoundSvgPathData(svgNode)}
            fill={fill?.paint}
            stroke={stroke?.paint}
            strokeWidth={svgNode.strokeWidth}
            strokeDasharray={svgNode.strokeDashPattern?.join(" ")}
            strokeLinecap={svgNode.strokeLineCap}
            strokeLinejoin={svgNode.strokeLineJoin}
            fillRule={svgNode.fillRule}
            opacity={svgNode.opacity}
            transform={svgNode.transform}
            vectorEffect="non-scaling-stroke"
          />
        </Fragment>
      );
    }

    return (
      <Fragment key={keyPath}>
        {definitions.length > 0 ? <defs>{definitions}</defs> : null}
        <g
          fill={fill?.paint}
          stroke={stroke?.paint}
          strokeWidth={svgNode.strokeWidth}
          strokeDasharray={svgNode.strokeDashPattern?.join(" ")}
          strokeLinecap={svgNode.strokeLineCap}
          strokeLinejoin={svgNode.strokeLineJoin}
          fillRule={svgNode.fillRule}
          opacity={svgNode.opacity}
          transform={svgNode.transform}
        >
          {svgNode.children.map((child, index) => renderDesignSvgTreeNode(owner, child, `${keyPath}-${index}`))}
        </g>
      </Fragment>
    );
  }

  return (
    <Fragment key={keyPath}>
      {definitions.length > 0 ? <defs>{definitions}</defs> : null}
      <path
        d={svgNode.d}
        fill={fill?.paint}
        stroke={stroke?.paint}
        strokeWidth={svgNode.strokeWidth}
        strokeDasharray={svgNode.strokeDashPattern?.join(" ")}
        strokeLinecap={svgNode.strokeLineCap}
        strokeLinejoin={svgNode.strokeLineJoin}
        fillRule={svgNode.fillRule}
        opacity={svgNode.opacity}
        transform={svgNode.transform}
        vectorEffect="non-scaling-stroke"
      />
    </Fragment>
  );
}

function buildDesignSvgDocument(nodes: DesignNode[], name: string) {
  const visibleNodes = nodes
    .filter((node) => node.visible !== false && node.width > 0 && node.height > 0)
    .sort((first, second) => (first.zIndex ?? 0) - (second.zIndex ?? 0));
  const bounds = getExactNodesBounds(visibleNodes);
  const defs = new SvgExportDefinitions();
  const content = visibleNodes
    .map((node) => serializeDesignNodeForExport(node, bounds, defs))
    .filter(Boolean)
    .join("\n  ");
  const definitions = defs.toString();

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatSvgNumber(bounds.width)}" height="${formatSvgNumber(bounds.height)}" viewBox="0 0 ${formatSvgNumber(bounds.width)} ${formatSvgNumber(bounds.height)}" fill="none">`,
    `  <title>${escapeXml(name || "AIPM Design Export")}</title>`,
    definitions ? `  <defs>\n${definitions}\n  </defs>` : "",
    `  <g fill="none" stroke="none">`,
    content ? `  ${content}` : "",
    `  </g>`,
    `</svg>`
  ].filter(Boolean).join("\n");
}

function serializeDesignNodeForExport(node: DesignNode, bounds: RectBounds, defs: SvgExportDefinitions) {
  const localContent = serializeDesignNodeLocalContent(node, defs);
  if (!localContent) {
    return "";
  }

  const transforms = [
    `translate(${formatSvgNumber(node.x - bounds.x)} ${formatSvgNumber(node.y - bounds.y)})`,
    node.rotation ? `rotate(${formatSvgNumber(node.rotation)} ${formatSvgNumber(node.width / 2)} ${formatSvgNumber(node.height / 2)})` : "",
    node.flippedHorizontal ? `translate(${formatSvgNumber(node.width)} 0) scale(-1 1)` : "",
    node.flippedVertical ? `translate(0 ${formatSvgNumber(node.height)}) scale(1 -1)` : ""
  ].filter(Boolean);
  const attrs = serializeSvgAttributes({
    id: node.id,
    "data-name": node.name,
    transform: transforms.join(" "),
    opacity: node.opacity !== undefined && node.opacity < 1 ? node.opacity : undefined
  });

  return `<g${attrs}>\n    ${localContent}\n  </g>`;
}

function serializeDesignNodeLocalContent(node: DesignNode, defs: SvgExportDefinitions) {
  if (node.svgTree) {
    return serializeDesignSvgTreeForExport(node, node.svgTree, defs);
  }

  const vectorPaths = node.svgPaths?.length
    ? node.svgPaths
    : node.svgPath
      ? [{
          d: node.svgPath,
          fill: node.fill,
          stroke: node.stroke,
          strokeWidth: node.strokeWidth,
          strokeDashPattern: node.strokeDashPattern,
          strokeLineCap: node.strokeLineCap,
          strokeLineJoin: node.strokeLineJoin,
          fillRule: node.svgFillRule
        }]
      : [];
  const visibleVectorPaths = vectorPaths.filter((path) => !isInvisibleDesignSvgPath(node, path));
  if (visibleVectorPaths.length > 0) {
    return visibleVectorPaths.map((path, index) => {
      const fill = defs.paint(node, path.fill ?? node.fill, "fill", "none", `${index}`);
      const stroke = defs.paint(node, path.stroke ?? node.stroke, "stroke", "none", `${index}`);
      return `<path${serializeSvgAttributes({
        d: path.d,
        fill,
        "fill-rule": path.fillRule ?? node.svgFillRule,
        stroke,
        "stroke-width": path.stroke === "transparent" ? 0 : path.strokeWidth ?? node.strokeWidth,
        "stroke-dasharray": path.strokeDashPattern?.join(" "),
        "stroke-linecap": path.strokeLineCap,
        "stroke-linejoin": path.strokeLineJoin,
        opacity: path.opacity,
        transform: path.transform,
        "vector-effect": "non-scaling-stroke"
      })}/>`;
    }).join("\n    ");
  }

  if (node.type === "image" && node.imageUrl) {
    return `<image${serializeSvgAttributes({
      href: node.imageUrl,
      x: 0,
      y: 0,
      width: node.width,
      height: node.height,
      preserveAspectRatio: "none",
      opacity: node.opacity
    })}/>`;
  }

  if (node.text || node.textRuns?.length) {
    return serializeTextNodeForExport(node);
  }

  const fill = defs.paint(node, node.fill, "fill", "none", "box");
  const stroke = defs.paint(node, node.stroke, "stroke", "none", "box");
  return `<rect${serializeSvgAttributes({
    x: 0,
    y: 0,
    width: node.width,
    height: node.height,
    rx: node.radius,
    fill,
    stroke,
    "stroke-width": node.stroke === "transparent" ? 0 : node.strokeWidth,
    "stroke-dasharray": node.strokeDashPattern?.join(" "),
    "stroke-linecap": node.strokeLineCap,
    "stroke-linejoin": node.strokeLineJoin
  })}/>`;
}

function serializeDesignSvgTreeForExport(owner: DesignNode, svgNode: DesignSvgNode, defs: SvgExportDefinitions): string {
  if (svgNode.opacity !== undefined && svgNode.opacity <= 0) {
    return "";
  }
  if (svgNode.type === "g") {
    if (isCompoundSvgPathGroup(svgNode)) {
      return `<path${serializeSvgAttributes({
        d: getCompoundSvgPathData(svgNode),
        fill: svgNode.fill !== undefined ? defs.paint(owner, svgNode.fill, "fill", "none", "tree") : undefined,
        stroke: svgNode.stroke !== undefined ? defs.paint(owner, svgNode.stroke, "stroke", "none", "tree") : undefined,
        "stroke-width": svgNode.strokeWidth,
        "stroke-dasharray": svgNode.strokeDashPattern?.join(" "),
        "stroke-linecap": svgNode.strokeLineCap,
        "stroke-linejoin": svgNode.strokeLineJoin,
        "fill-rule": svgNode.fillRule,
        opacity: svgNode.opacity,
        transform: svgNode.transform,
        "vector-effect": "non-scaling-stroke"
      })}/>`;
    }

    const attrs = serializeSvgAttributes({
      fill: svgNode.fill !== undefined ? defs.paint(owner, svgNode.fill, "fill", "none", "tree") : undefined,
      stroke: svgNode.stroke !== undefined ? defs.paint(owner, svgNode.stroke, "stroke", "none", "tree") : undefined,
      "stroke-width": svgNode.strokeWidth,
      "stroke-dasharray": svgNode.strokeDashPattern?.join(" "),
      "stroke-linecap": svgNode.strokeLineCap,
      "stroke-linejoin": svgNode.strokeLineJoin,
      "fill-rule": svgNode.fillRule,
      opacity: svgNode.opacity,
      transform: svgNode.transform
    });
    const children = svgNode.children.map((child) => serializeDesignSvgTreeForExport(owner, child, defs)).filter(Boolean);
    return `<g${attrs}>${children.length > 0 ? `\n      ${children.join("\n      ")}\n    ` : ""}</g>`;
  }

  const attrs = serializeSvgAttributes({
    d: svgNode.d,
    fill: svgNode.fill !== undefined ? defs.paint(owner, svgNode.fill, "fill", "none", "tree") : undefined,
    stroke: svgNode.stroke !== undefined ? defs.paint(owner, svgNode.stroke, "stroke", "none", "tree") : undefined,
    "stroke-width": svgNode.strokeWidth,
    "stroke-dasharray": svgNode.strokeDashPattern?.join(" "),
    "stroke-linecap": svgNode.strokeLineCap,
    "stroke-linejoin": svgNode.strokeLineJoin,
    "fill-rule": svgNode.fillRule,
    opacity: svgNode.opacity,
    transform: svgNode.transform,
    "vector-effect": "non-scaling-stroke"
  });
  return `<path${attrs}/>`;
}

function isCompoundSvgPathGroup(svgNode: DesignSvgNode): svgNode is Extract<DesignSvgNode, { type: "g" }> {
  return svgNode.type === "g"
    && svgNode.fill !== undefined
    && svgNode.children.length > 1
    && svgNode.children.every((child) => (
      child.type === "path"
      && child.fill === undefined
      && child.stroke === undefined
      && child.opacity === undefined
    ));
}

function getCompoundSvgPathData(svgNode: Extract<DesignSvgNode, { type: "g" }>) {
  return svgNode.children
    .map((child) => child.type === "path" ? child.d : "")
    .filter(Boolean)
    .join(" ");
}

function serializeTextNodeForExport(node: DesignNode) {
  const lineHeight = node.lineHeight ?? node.fontSize * 1.35;
  const baseAttrs = serializeSvgAttributes({
    x: node.textAlign === "center" ? node.width / 2 : node.textAlign === "right" ? node.width : 0,
    y: Math.max(node.fontSize, lineHeight),
    fill: getSvgPaint(node.textColor, "#171717"),
    "font-family": node.fontFamily ?? "PingFang SC, Microsoft YaHei, sans-serif",
    "font-size": node.fontSize,
    "font-weight": node.fontWeight,
    "letter-spacing": node.letterSpacing,
    "text-anchor": node.textAlign === "center" ? "middle" : node.textAlign === "right" ? "end" : undefined,
    "text-decoration": getNodeTextDecoration(node)
  });

  if (node.textRuns?.length) {
    const runs = node.textRuns.map((run) => `<tspan${serializeSvgAttributes({
      fill: run.color,
      "font-family": run.fontFamily,
      "font-size": run.fontSize,
      "font-weight": run.fontWeight,
      "letter-spacing": run.letterSpacing,
      "text-decoration": [
        run.underline || node.underline ? "underline" : "",
        run.strikethrough || node.strikethrough ? "line-through" : ""
      ].filter(Boolean).join(" ") || undefined
    })}>${escapeXml(transformTextContent(run.text, node.textTransform))}</tspan>`);
    return `<text${baseAttrs}>${runs.join("")}</text>`;
  }

  return `<text${baseAttrs}>${escapeXml(transformTextContent(node.text ?? "", node.textTransform))}</text>`;
}

class SvgExportDefinitions {
  private readonly definitions = new Map<string, string>();
  private counter = 0;

  paint(node: DesignNode, value: string | undefined, kind: "fill" | "stroke", fallback: string, suffix: string) {
    const paint = getFirstCanvasPaintLayer(value);
    if (!paint || paint === "transparent" || paint === "none") {
      return fallback;
    }
    if (paint.startsWith("linear-gradient")) {
      const id = this.nextId(node, kind, suffix);
      this.definitions.set(id, buildSvgLinearGradientDefinition(id, paint));
      return `url(#${id})`;
    }
    if (paint.startsWith("radial-gradient")) {
      const id = this.nextId(node, kind, suffix);
      this.definitions.set(id, buildSvgRadialGradientDefinition(id, paint));
      return `url(#${id})`;
    }
    if (paint.startsWith("url(")) {
      return fallback;
    }
    return getSvgPaint(paint, fallback);
  }

  toString() {
    return Array.from(this.definitions.values()).map((definition) => `    ${definition}`).join("\n");
  }

  private nextId(node: DesignNode, kind: "fill" | "stroke", suffix: string) {
    this.counter += 1;
    return `aipm-${sanitizeSvgId(node.id)}-${kind}-${sanitizeSvgId(suffix)}-${this.counter}`;
  }
}

function buildSvgLinearGradientDefinition(id: string, value: string) {
  const args = extractCssFunctionArgs(value);
  const firstArg = args[0] ?? "";
  const angle = parseCssLinearGradientAngle(firstArg);
  const stops = (isCssLinearGradientDirectionArg(firstArg) ? args.slice(1) : args)
    .map(parseCssColorStop)
    .filter((stop): stop is { color: string; position: number } => Boolean(stop));
  const radians = (angle - 90) * Math.PI / 180;
  const x = Math.cos(radians) / 2;
  const y = Math.sin(radians) / 2;
  return `<linearGradient${serializeSvgAttributes({ id, x1: 0.5 - x, y1: 0.5 - y, x2: 0.5 + x, y2: 0.5 + y })}>${stops.map((stop) => {
    const paint = normalizeSvgGradientStopPaint(stop.color);
    return `<stop${serializeSvgAttributes({ offset: `${Math.round(stop.position * 100)}%`, "stop-color": paint.color, "stop-opacity": paint.opacity })}/>`;
  }).join("")}</linearGradient>`;
}

function buildSvgRadialGradientDefinition(id: string, value: string) {
  const args = extractCssFunctionArgs(value);
  const firstArg = args[0] ?? "";
  const hasShapeArg = isCssRadialGradientShapeArg(firstArg);
  const center = parseCssRadialGradientCenter(firstArg);
  const stops = (hasShapeArg ? args.slice(1) : args)
    .map(parseCssColorStop)
    .filter((stop): stop is { color: string; position: number } => Boolean(stop));
  return `<radialGradient${serializeSvgAttributes({ id, cx: `${formatSvgNumber(center.x * 100)}%`, cy: `${formatSvgNumber(center.y * 100)}%`, r: "70%" })}>${stops.map((stop) => {
    const paint = normalizeSvgGradientStopPaint(stop.color);
    return `<stop${serializeSvgAttributes({ offset: `${Math.round(stop.position * 100)}%`, "stop-color": paint.color, "stop-opacity": paint.opacity })}/>`;
  }).join("")}</radialGradient>`;
}

function serializeSvgAttributes(attributes: Record<string, string | number | boolean | undefined | null>) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ` ${key}="${escapeSvgAttribute(formatSvgAttributeValue(value))}"`)
    .join("");
}

function formatSvgAttributeValue(value: string | number | boolean) {
  return typeof value === "number" ? formatSvgNumber(value) : String(value);
}

function formatSvgNumber(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return String(Number(value.toFixed(3)));
}

function getExactNodesBounds(nodes: DesignNode[]): RectBounds {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function sanitizeSvgFileName(value: string) {
  return (value || "design").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 80) || "design";
}

function sanitizeSvgId(value: string) {
  return (value || "node").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "node";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeSvgAttribute(value: string) {
  return escapeXml(value).replace(/"/g, "&quot;");
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function DomSvgTextContent({ node }: { node: DesignNode }) {
  if (node.textRuns?.length) {
    return (
      <>
        {node.textRuns.map((run, index) => (
          <span
            key={`${index}-${run.text}`}
            style={{
              color: run.color ?? node.textColor,
              fontFamily: run.fontFamily ? `"${run.fontFamily}", ${getCssFontFamily(node)}` : undefined,
              fontSize: run.fontSize,
              fontWeight: run.fontWeight,
              letterSpacing: run.letterSpacing !== undefined ? `${run.letterSpacing}px` : undefined,
              textDecorationLine: [
                run.underline || node.underline ? "underline" : "",
                run.strikethrough || node.strikethrough ? "line-through" : ""
              ].filter(Boolean).join(" ") || undefined
            }}
          >
            {transformTextContent(run.text, node.textTransform)}
          </span>
        ))}
      </>
    );
  }

  return <>{transformTextContent(node.text ?? "", node.textTransform)}</>;
}

function shouldRenderNodeWithDomSvg(node: DesignNode) {
  return Boolean(node.sourceLayerClass);
}

function buildDesignRenderTree(nodes: DesignNode[]): DesignRenderTreeNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParentId = new Map<string, DesignNode[]>();
  const roots: DesignNode[] = [];

  nodes.forEach((node) => {
    const parentId = node.parentId && nodeById.has(node.parentId) ? node.parentId : "";
    if (!parentId) {
      roots.push(node);
      return;
    }
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(node);
    childrenByParentId.set(parentId, siblings);
  });

  const sortByPaintOrder = (items: DesignNode[]) => [...items].sort((first, second) => (first.zIndex ?? 0) - (second.zIndex ?? 0));
  const buildNode = (node: DesignNode): DesignRenderTreeNode => ({
    node,
    children: sortByPaintOrder(childrenByParentId.get(node.id) ?? []).map(buildNode)
  });

  return sortByPaintOrder(roots).map(buildNode);
}

function getDesignNodeCssTransform(node: DesignNode) {
  const transforms = [
    node.rotation ? `rotate(${node.rotation}deg)` : "",
    node.flippedHorizontal ? "scaleX(-1)" : "",
    node.flippedVertical ? "scaleY(-1)" : ""
  ].filter(Boolean);
  return transforms.length > 0 ? transforms.join(" ") : undefined;
}

function getCssFontFamily(node: DesignNode) {
  return node.fontFamily
    ? `"${node.fontFamily}", "PingFang SC", "Microsoft YaHei", sans-serif`
    : `"PingFang SC", "Microsoft YaHei", sans-serif`;
}

function getDesignTableColumns(node: DesignNode) {
  const match = /^columns:(.*)$/im.exec(node.text?.trim() ?? "");
  const columns = match?.[1]
    ?.split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  return columns && columns.length > 0 ? columns.slice(0, 8) : [];
}

function getDesignTableRows(node: DesignNode) {
  const text = node.text?.trim() ?? "";
  const rowsMatch = /^rows:(.+)$/im.exec(text);
  const rows = rowsMatch?.[1]
    ?.split(";")
    .map((row) => row.split("|").map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
  if (rows && rows.length > 0) {
    return rows.slice(0, 20);
  }
  const columnCount = getDesignTableColumns(node).length;
  return Array.from({ length: 4 }, () => Array.from({ length: columnCount }, () => ""));
}

function getNodeTextDecoration(node: DesignNode) {
  return [
    node.underline ? "underline" : "",
    node.strikethrough ? "line-through" : ""
  ].filter(Boolean).join(" ") || undefined;
}

function getDesignNodeCssFilter(node: DesignNode) {
  return [
    node.blurRadius ? `blur(${node.blurRadius}px)` : "",
    isImageColorAdjustableNode(node) ? imageColorControlsToCssFilter(node.imageColorControls) : ""
  ].filter(Boolean).join(" ") || undefined;
}

function isImageColorAdjustableNode(node: DesignNode) {
  return node.type === "image" || node.sourceLayerClass === "bitmap" || Boolean(node.imageUrl);
}

function imageColorControlsToCssFilter(controls: WorkspaceDesignImageColorControls | undefined) {
  if (!controls?.isEnabled) {
    return "";
  }
  const sketchHuePercent = sketchHueToUiPercent(controls.hue ?? 0);
  const cssHueDegrees = sketchHuePercent * 1.8;
  return [
    `hue-rotate(${formatFilterNumber(cssHueDegrees)}deg)`,
    `brightness(${formatFilterNumber(Math.max(0, 1 + controls.brightness))})`,
    `contrast(${formatFilterNumber(Math.max(0, controls.contrast))})`,
    `saturate(${formatFilterNumber(Math.max(0, controls.saturation))})`
  ].join(" ");
}

function formatFilterNumber(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(4)).toString() : "0";
}

function drawDesignNodeOnCanvas(context: CanvasRenderingContext2D, node: DesignNode, requestRedraw: () => void) {
  if (node.visible === false || node.width <= 0 || node.height <= 0) {
    return;
  }

  context.save();
  applyCanvasClip(context, node);
  context.translate(node.x + node.width / 2, node.y + node.height / 2);
  if (node.rotation) {
    context.rotate(node.rotation * Math.PI / 180);
  }
  if (node.flippedHorizontal || node.flippedVertical) {
    context.scale(node.flippedHorizontal ? -1 : 1, node.flippedVertical ? -1 : 1);
  }
  context.translate(-node.width / 2, -node.height / 2);
  context.globalAlpha = node.opacity ?? 1;
  context.globalCompositeOperation = (node.blendMode ?? "source-over") as GlobalCompositeOperation;
  context.filter = getDesignNodeCssFilter(node) ?? "none";

  if (shouldDrawNodeAsGradientBox(node)) {
    drawBoxNode(context, node, requestRedraw);
  } else if (node.svgTree || node.svgPaths?.length || node.svgPath) {
    drawSvgVectorNode(context, node);
  } else if (node.type === "image" && node.imageUrl) {
    drawImageNode(context, node, requestRedraw);
  } else if (node.type === "table") {
    drawTableNode(context, node, requestRedraw);
  } else {
    drawBoxNode(context, node, requestRedraw);
    if (node.text || node.textRuns?.length) {
      if (isIconFontNode(node)) {
        drawIconFontFallback(context, node);
      } else if (node.textRuns?.length) {
        drawRichTextNode(context, node);
      } else {
        drawTextNode(context, node, node.text || node.textRuns?.map((run) => run.text).join("") || "");
      }
    }
  }

  context.restore();
}

function shouldDrawNodeAsGradientBox(node: DesignNode) {
  return node.sourceLayerClass === "rectangle"
    && Boolean(node.svgPath)
    && Boolean(node.fill?.includes("gradient("));
}

function drawTableNode(context: CanvasRenderingContext2D, node: DesignNode, requestRedraw: () => void) {
  drawBoxNode(context, node, requestRedraw);
  const columns = getDesignTableColumns(node);
  const rows = getDesignTableRows(node).slice(0, 4);
  if (columns.length === 0) {
    return;
  }
  const headerHeight = Math.min(48, Math.max(34, node.height * 0.16));
  const rowHeight = Math.max(34, Math.min(46, (node.height - headerHeight) / Math.max(1, rows.length)));
  const columnWidth = node.width / Math.max(1, columns.length);

  context.save();
  context.clip(roundedRectPath(0, 0, node.width, node.height, Math.max(0, node.radius)));
  context.fillStyle = "#f2f4f7";
  context.fillRect(0, 0, node.width, headerHeight);
  context.strokeStyle = "#eaecf0";
  context.lineWidth = 1;
  context.font = `600 13px ${getCssFontFamily(node)}`;
  context.fillStyle = "#344054";
  context.textBaseline = "middle";

  columns.forEach((column, index) => {
    const x = index * columnWidth;
    if (index > 0) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, node.height);
      context.stroke();
    }
    drawCanvasSingleLineText(context, column, x + 14, headerHeight / 2, columnWidth - 24);
  });

  context.font = `400 13px ${getCssFontFamily(node)}`;
  context.fillStyle = "#475467";
  rows.forEach((row, rowIndex) => {
    const y = headerHeight + rowIndex * rowHeight;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(node.width, y);
    context.stroke();
    columns.forEach((column, index) => {
      drawCanvasSingleLineText(context, row[index] ?? "", index * columnWidth + 14, y + rowHeight / 2, columnWidth - 24);
    });
  });
  context.restore();
}

function drawCanvasSingleLineText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  const value = text.trim();
  if (!value) {
    return;
  }
  let output = value;
  while (output.length > 1 && context.measureText(output).width > maxWidth) {
    output = output.slice(0, -1);
  }
  context.fillText(output.length < value.length ? `${output.slice(0, Math.max(1, output.length - 1))}…` : output, x, y);
}

function applyCanvasClip(context: CanvasRenderingContext2D, node: DesignNode) {
  if (!shouldClipDesignNode(node)) {
    return;
  }
  if (node.clipBounds) {
    context.beginPath();
    context.rect(node.clipBounds.x, node.clipBounds.y, node.clipBounds.width, node.clipBounds.height);
    context.clip();
  }

  if (node.clipPath?.svgPath) {
    context.translate(node.clipPath.x, node.clipPath.y);
    try {
      context.clip(new Path2D(node.clipPath.svgPath), node.clipPath.fillRule === "evenodd" ? "evenodd" : "nonzero");
    } catch {
      context.translate(-node.clipPath.x, -node.clipPath.y);
      return;
    }
    context.translate(-node.clipPath.x, -node.clipPath.y);
  }

  if (node.sourceMeta?.hasClippingMask === true && !node.clipBounds && !node.clipPath) {
    context.beginPath();
    context.rect(node.x, node.y, node.width, node.height);
    context.clip();
  }
}

function drawSvgVectorNode(context: CanvasRenderingContext2D, node: DesignNode) {
  if (node.svgTree) {
    drawSvgTreeNodeOnCanvas(context, node, node.svgTree);
    return;
  }
  const paths = node.svgPaths?.length
    ? node.svgPaths
    : node.svgPath
      ? [{
          d: node.svgPath,
          fill: node.fill,
          stroke: node.stroke,
          strokeWidth: node.strokeWidth,
          fillRule: node.svgFillRule
        }]
      : [];
  if (paths.length === 0) {
    drawBoxNode(context, node);
    return;
  }
  paths
    .filter((pathNode) => !isInvisibleDesignSvgPath(node, pathNode))
    .forEach((pathNode) => drawSvgPathOnCanvas(context, node, pathNode));
}

function drawSvgTreeNodeOnCanvas(
  context: CanvasRenderingContext2D,
  owner: DesignNode,
  treeNode: DesignSvgNode,
  inherited: Partial<Extract<DesignSvgNode, { type: "path" }>> = {}
) {
  if (treeNode.opacity !== undefined && treeNode.opacity <= 0) {
    return;
  }
  context.save();
  if (treeNode.opacity !== undefined) {
    context.globalAlpha *= treeNode.opacity;
  }
  if (treeNode.transform) {
    applyCanvasSvgTransform(context, treeNode.transform);
  }
  if (treeNode.type === "path") {
    drawSvgPathOnCanvas(context, owner, { ...inherited, ...treeNode, opacity: treeNode.opacity });
  } else {
    const nextInherited = {
      ...inherited,
      fill: treeNode.fill ?? inherited.fill,
      stroke: treeNode.stroke ?? inherited.stroke,
      strokeWidth: treeNode.strokeWidth ?? inherited.strokeWidth,
      strokeDashPattern: treeNode.strokeDashPattern ?? inherited.strokeDashPattern,
      strokeLineCap: treeNode.strokeLineCap ?? inherited.strokeLineCap,
      strokeLineJoin: treeNode.strokeLineJoin ?? inherited.strokeLineJoin,
      fillRule: treeNode.fillRule ?? inherited.fillRule
    };
    treeNode.children.forEach((child) => drawSvgTreeNodeOnCanvas(context, owner, child, nextInherited));
  }
  context.restore();
}

function drawSvgPathOnCanvas(
  context: CanvasRenderingContext2D,
  node: DesignNode,
  pathNode: {
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    strokeDashPattern?: number[];
    strokeLineCap?: "butt" | "round" | "square";
    strokeLineJoin?: "miter" | "round" | "bevel";
    fillRule?: "nonzero" | "evenodd";
    opacity?: number;
    transform?: string;
  }
) {
  if (isInvisibleDesignSvgPath(node, pathNode)) {
    return;
  }
  try {
    const path = new Path2D(pathNode.d);
    const fillLayers = getCanvasFillStyleLayers(context, node, pathNode.fill ?? node.fill);
    const fill = fillLayers[0] ?? "";
    const stroke = getCanvasFillStyle(context, node, pathNode.stroke ?? node.stroke);
    if (pathNode.opacity !== undefined) {
      context.save();
      context.globalAlpha *= pathNode.opacity;
    }
    if (pathNode.transform) {
      context.save();
      applyCanvasSvgTransform(context, pathNode.transform);
    }
    drawPathShadowLayers(context, path, node, fill || getCanvasPaint(pathNode.fill ?? node.fill));
    fillLayers.slice().reverse().forEach((fillLayer) => {
      context.fillStyle = fillLayer;
      context.fill(path, pathNode.fillRule === "evenodd" ? "evenodd" : "nonzero");
    });
    if (stroke && (pathNode.strokeWidth ?? node.strokeWidth ?? 0) > 0) {
      applyCanvasStrokeStyle(context, {
        ...node,
        strokeWidth: pathNode.strokeWidth ?? node.strokeWidth,
        strokeDashPattern: pathNode.strokeDashPattern ?? node.strokeDashPattern,
        strokeLineCap: pathNode.strokeLineCap ?? node.strokeLineCap,
        strokeLineJoin: pathNode.strokeLineJoin ?? node.strokeLineJoin
      });
      context.strokeStyle = stroke;
      context.stroke(path);
    }
    if (pathNode.transform) {
      context.restore();
    }
    if (pathNode.opacity !== undefined) {
      context.restore();
    }
  } catch {
    if (!node.sourceLayerClass && !node.svgPath && !node.svgPaths?.length && !node.svgTree) {
      drawBoxNode(context, node);
    }
  }
}

function isInvisibleDesignSvgPath(
  node: DesignNode,
  pathNode: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    opacity?: number;
  }
) {
  if (pathNode.opacity !== undefined && pathNode.opacity <= 0) {
    return true;
  }
  const fill = pathNode.fill ?? node.fill;
  const stroke = pathNode.stroke ?? node.stroke;
  const strokeWidth = pathNode.strokeWidth ?? node.strokeWidth ?? 0;
  return isTransparentPaint(fill) && (strokeWidth <= 0 || isTransparentPaint(stroke));
}

function applyCanvasSvgTransform(context: CanvasRenderingContext2D, transform: string) {
  const commands = transform.match(/(?:matrix|translate|scale|rotate)\([^)]*\)/gi) ?? [];
  commands.forEach((command) => {
    const match = /^(matrix|translate|scale|rotate)\(([^)]*)\)$/i.exec(command.trim());
    if (!match) return;
    const values = match[2].split(/[\s,]+/).map(Number).filter(Number.isFinite);
    if (match[1].toLowerCase() === "matrix" && values.length === 6) {
      context.transform(values[0], values[1], values[2], values[3], values[4], values[5]);
      return;
    }
    if (match[1].toLowerCase() === "translate") {
      context.translate(values[0] ?? 0, values[1] ?? 0);
      return;
    }
    if (match[1].toLowerCase() === "scale") {
      context.scale(values[0] ?? 1, values[1] ?? values[0] ?? 1);
      return;
    }
    if (match[1].toLowerCase() === "rotate") {
      const angle = (values[0] ?? 0) * Math.PI / 180;
      if (values.length >= 3) {
        context.translate(values[1], values[2]);
        context.rotate(angle);
        context.translate(-values[1], -values[2]);
        return;
      }
      context.rotate(angle);
    }
  });
}

function drawImageNode(context: CanvasRenderingContext2D, node: DesignNode, requestRedraw: () => void) {
  const imageUrl = node.imageUrl;
  if (!imageUrl) {
    drawImageFallback(context, node);
    return;
  }

  const cached = getCanvasImage(imageUrl, requestRedraw);
  if (cached.loaded) {
    applyFirstCanvasShadow(context, node.shadow);
    context.drawImage(cached.image, 0, 0, node.width, node.height);
    resetCanvasShadow(context);
  } else {
    drawImageFallback(context, node);
  }
}

function drawBoxNode(context: CanvasRenderingContext2D, node: DesignNode, requestRedraw: () => void) {
  const fillLayers = getCanvasFillStyleLayers(context, node, node.fill);
  const fill = fillLayers[0] ?? "";
  const stroke = getCanvasStrokeStyle(context, node);
  const strokeWidth = Math.max(0, node.strokeWidth ?? 0);
  const strokeOffset = node.strokePosition === "inside" ? strokeWidth / 2 : node.strokePosition === "outside" ? -strokeWidth / 2 : 0;
  const path = roundedRectPath(
    strokeOffset,
    strokeOffset,
    node.width - strokeOffset * 2,
    node.height - strokeOffset * 2,
    Math.max(0, node.radius - strokeOffset)
  );
  drawPathShadowLayers(context, path, node, fill || getCanvasPaint(node.fill));
  if (node.fillImageUrl) {
    drawFillImage(context, node, path, requestRedraw);
  }
  fillLayers.slice().reverse().forEach((fillLayer) => {
    context.fillStyle = fillLayer;
    context.fill(path);
  });
  if (stroke && (node.strokeWidth ?? 0) > 0) {
    applyCanvasStrokeStyle(context, node);
    context.strokeStyle = stroke;
    context.stroke(path);
  }
  drawInnerShadowLayers(context, path, node);
}

function applyCanvasStrokeStyle(context: CanvasRenderingContext2D, node: DesignNode) {
  context.lineWidth = Math.max(0, node.strokeWidth ?? 1);
  context.setLineDash(node.strokeDashPattern ?? []);
  context.lineCap = node.strokeLineCap ?? "butt";
  context.lineJoin = node.strokeLineJoin ?? "miter";
}

function drawPathShadowLayers(
  context: CanvasRenderingContext2D,
  path: Path2D,
  node: DesignNode,
  fallbackFill: string | CanvasGradient
) {
  const shadows = parseCanvasShadows(node.shadow);
  if (shadows.length === 0 || !fallbackFill) {
    return;
  }

  shadows.forEach((shadow) => {
    context.save();
    context.shadowOffsetX = shadow.offsetX;
    context.shadowOffsetY = shadow.offsetY;
    context.shadowBlur = shadow.blur;
    context.shadowColor = shadow.color;
    context.fillStyle = fallbackFill;
    context.fill(path, node.svgFillRule === "evenodd" ? "evenodd" : "nonzero");
    context.restore();
  });
}

function drawInnerShadowLayers(context: CanvasRenderingContext2D, path: Path2D, node: DesignNode) {
  const shadows = parseCanvasShadows(node.innerShadow);
  if (shadows.length === 0) {
    return;
  }

  shadows.forEach((shadow) => {
    context.save();
    context.clip(path);
    context.shadowOffsetX = shadow.offsetX;
    context.shadowOffsetY = shadow.offsetY;
    context.shadowBlur = shadow.blur;
    context.shadowColor = shadow.color;
    context.lineWidth = Math.max(node.width, node.height) * 2;
    context.strokeStyle = "rgba(0,0,0,0.01)";
    context.stroke(path);
    context.restore();
  });
}

function applyFirstCanvasShadow(context: CanvasRenderingContext2D, shadow: string | undefined) {
  const [firstShadow] = parseCanvasShadows(shadow);
  if (!firstShadow) {
    resetCanvasShadow(context);
    return;
  }
  context.shadowOffsetX = firstShadow.offsetX;
  context.shadowOffsetY = firstShadow.offsetY;
  context.shadowBlur = firstShadow.blur;
  context.shadowColor = firstShadow.color;
}

function resetCanvasShadow(context: CanvasRenderingContext2D) {
  context.shadowColor = "transparent";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.shadowBlur = 0;
}

function parseCanvasShadows(shadow: string | undefined) {
  return splitCssLayers(shadow)
    .map((shadowLayer) => {
      const shadowMatch = shadowLayer.match(/^(?<x>-?\d+(?:\.\d+)?)px\s+(?<y>-?\d+(?:\.\d+)?)px\s+(?<blur>-?\d+(?:\.\d+)?)px(?:\s+(?<spread>-?\d+(?:\.\d+)?)px)?\s+(?<color>.+)$/);
      if (!shadowMatch?.groups) {
        return undefined;
      }
      return {
        offsetX: Number(shadowMatch.groups.x),
        offsetY: Number(shadowMatch.groups.y),
        blur: Math.max(0, Number(shadowMatch.groups.blur)),
        spread: Number(shadowMatch.groups.spread ?? 0),
        color: shadowMatch.groups.color.trim()
      };
    })
    .filter((shadowLayer): shadowLayer is { offsetX: number; offsetY: number; blur: number; spread: number; color: string } => Boolean(shadowLayer));
}

function drawFillImage(context: CanvasRenderingContext2D, node: DesignNode, path: Path2D, requestRedraw: () => void) {
  const imageUrl = node.fillImageUrl;
  if (!imageUrl) {
    return;
  }
  const cached = getCanvasImage(imageUrl, requestRedraw);
  if (!cached.loaded) {
    return;
  }
  context.save();
  context.clip(path);
  drawImageWithMode(context, cached.image, node.width, node.height, node.fillImageMode ?? "stretch", node.fillImageScale ?? 1);
  context.restore();
}

function drawImageWithMode(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  mode: NonNullable<DesignNode["fillImageMode"]>,
  scale: number
) {
  if (mode === "tile") {
    const pattern = context.createPattern(image, "repeat");
    if (!pattern) {
      return;
    }
    context.save();
    context.scale(Math.max(0.01, scale), Math.max(0.01, scale));
    context.fillStyle = pattern;
    context.fillRect(0, 0, width / Math.max(0.01, scale), height / Math.max(0.01, scale));
    context.restore();
    return;
  }

  const imageRatio = image.width / Math.max(1, image.height);
  const targetRatio = width / Math.max(1, height);
  const useCover = mode === "fill";
  const shouldMatchWidth = useCover ? imageRatio < targetRatio : imageRatio > targetRatio;
  if (mode === "fit" || mode === "fill") {
    const drawWidth = shouldMatchWidth ? width : height * imageRatio;
    const drawHeight = shouldMatchWidth ? width / imageRatio : height;
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    return;
  }

  context.drawImage(image, 0, 0, width, height);
}

function drawImageFallback(context: CanvasRenderingContext2D, node: DesignNode) {
  context.fillStyle = "#f3f4f6";
  context.fill(roundedRectPath(0, 0, node.width, node.height, Math.min(12, node.radius)));
  context.fillStyle = "#9ca3af";
  context.font = "14px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("Image", node.width / 2, node.height / 2);
}

function drawTextNode(context: CanvasRenderingContext2D, node: DesignNode, text: string) {
  const fill = getCanvasPaint(node.textColor) || "#171717";
  const lineHeight = node.lineHeight ?? node.fontSize * 1.35;
  const font = getCanvasFont(node);
  const horizontalPadding = node.type === "text" ? 0 : 6;
  const verticalPadding = node.type === "text" ? 0 : 4;
  const lines = wrapCanvasText(context, transformTextContent(text, node.textTransform), Math.max(8, node.width - horizontalPadding * 2), font);
  context.fillStyle = fill;
  context.font = font;
  if ("letterSpacing" in context) {
    (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = node.letterSpacing ? `${node.letterSpacing}px` : "0px";
  }
  context.textAlign = node.textAlign === "right" ? "right" : node.textAlign === "center" ? "center" : "left";
  context.textBaseline = "top";
  const x = node.textAlign === "right" ? node.width - horizontalPadding : node.textAlign === "center" ? node.width / 2 : horizontalPadding;
  const totalHeight = lines.length * lineHeight;
  const startY = getCanvasTextStartY(node, totalHeight, lineHeight, verticalPadding);
  lines.forEach((line, index) => {
    const lineTop = startY + index * lineHeight;
    const y = lineTop + getCanvasLineGlyphOffset(lineHeight, node.fontSize);
    if (lineTop > node.height) {
      return;
    }
    context.fillText(line, x, y);
    drawCanvasTextDecorations(context, node, line, x, y);
  });
}

function drawRichTextNode(context: CanvasRenderingContext2D, node: DesignNode) {
  const runs = node.textRuns ?? [];
  if (runs.length === 0) {
    return;
  }

  context.save();
  const baseLineHeight = node.lineHeight ?? node.fontSize * 1.35;
  const horizontalPadding = node.type === "text" ? 0 : 6;
  const maxWidth = Math.max(8, node.width - horizontalPadding * 2);
  const lines = layoutRichCanvasText(context, node, runs, maxWidth);
  let lineTop = getCanvasTextStartY(node, lines.length * baseLineHeight, baseLineHeight, node.type === "text" ? 0 : 4);

  lines.forEach((line) => {
    let cursorX = node.textAlign === "right"
      ? node.width - horizontalPadding - line.width
      : node.textAlign === "center"
        ? node.width / 2 - line.width / 2
        : horizontalPadding;

    line.segments.forEach(({ text: segment, run }) => {
      const runFontSize = run.fontSize ?? node.fontSize;
      const cursorY = lineTop + getCanvasLineGlyphOffset(baseLineHeight, runFontSize);
      const font = getCanvasFont({
        ...node,
        fontFamily: run.fontFamily ?? node.fontFamily,
        fontSize: runFontSize,
        fontWeight: run.fontWeight ?? node.fontWeight
      });
      context.font = font;
      context.fillStyle = getCanvasPaint(run.color ?? node.textColor) || "#171717";
      context.textAlign = "left";
      context.textBaseline = "top";
      if ("letterSpacing" in context) {
        (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = run.letterSpacing ? `${run.letterSpacing}px` : "0px";
      }
      const renderedSegment = transformTextContent(segment, node.textTransform);
      context.fillText(renderedSegment, cursorX, cursorY);
      const segmentWidth = measureCanvasTextWithSpacing(context, renderedSegment, run.letterSpacing);
      if (run.underline || run.strikethrough || node.underline || node.strikethrough) {
        drawCanvasTextSegmentDecorations(context, {
          x: cursorX,
          y: cursorY,
          width: segmentWidth,
          fontSize: runFontSize,
          underline: Boolean(run.underline || node.underline),
          strikethrough: Boolean(run.strikethrough || node.strikethrough)
        });
      }
      cursorX += segmentWidth;
    });
    lineTop += baseLineHeight;
  });

  context.restore();
}

function layoutRichCanvasText(
  context: CanvasRenderingContext2D,
  node: DesignNode,
  runs: NonNullable<DesignNode["textRuns"]>,
  maxWidth: number
) {
  type RichSegment = { text: string; run: NonNullable<DesignNode["textRuns"]>[number] };
  const lines: Array<{ segments: RichSegment[]; width: number }> = [];
  let currentSegments: RichSegment[] = [];
  let currentWidth = 0;

  const pushLine = () => {
    lines.push({ segments: currentSegments, width: currentWidth });
    currentSegments = [];
    currentWidth = 0;
  };

  const appendSegment = (text: string, run: NonNullable<DesignNode["textRuns"]>[number], width: number) => {
    const previous = currentSegments[currentSegments.length - 1];
    if (previous && previous.run === run) {
      previous.text += text;
    } else {
      currentSegments.push({ text, run });
    }
    currentWidth += width;
  };

  runs.forEach((run) => {
    const font = getCanvasFont({
      ...node,
      fontFamily: run.fontFamily ?? node.fontFamily,
      fontSize: run.fontSize ?? node.fontSize,
      fontWeight: run.fontWeight ?? node.fontWeight
    });
    context.font = font;
    Array.from(run.text).forEach((char) => {
      if (char === "\n") {
        pushLine();
        return;
      }
      const renderedChar = transformTextContent(char, node.textTransform);
      const charWidth = measureCanvasTextWithSpacing(context, renderedChar, run.letterSpacing);
      if (currentSegments.length > 0 && currentWidth + charWidth > maxWidth) {
        pushLine();
      }
      appendSegment(char, run, charWidth);
    });
  });

  if (currentSegments.length > 0 || lines.length === 0) {
    pushLine();
  }
  return lines;
}

function measureCanvasTextWithSpacing(context: CanvasRenderingContext2D, text: string, letterSpacing?: number) {
  return context.measureText(text).width + Math.max(0, Array.from(text).length - 1) * (letterSpacing ?? 0);
}

function getCanvasLineGlyphOffset(lineHeight: number, fontSize: number) {
  return Math.max(0, (lineHeight - fontSize) / 2);
}

function getCanvasTextStartY(node: DesignNode, totalHeight: number, lineHeight: number, verticalPadding: number) {
  const align = node.textVerticalAlign ?? (node.type === "text" ? "top" : "middle");
  if (align === "bottom") {
    return Math.max(verticalPadding, node.height - totalHeight - verticalPadding);
  }
  if (align === "middle") {
    return Math.max(0, Math.min(Math.max(0, node.height - totalHeight), node.height / 2 - totalHeight / 2));
  }
  return verticalPadding;
}

function isIconFontNode(node: DesignNode) {
  const text = node.text || node.textRuns?.map((run) => run.text).join("") || "";
  const font = `${node.fontFamily ?? ""} ${node.textRuns?.map((run) => run.fontFamily ?? "").join(" ") ?? ""}`.toLowerCase();
  return font.includes("iconfont") || font.includes("anticon") || Array.from(text).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0xe000 && code <= 0xf8ff;
  });
}

function drawIconFontFallback(context: CanvasRenderingContext2D, node: DesignNode) {
  const color = getCanvasPaint(node.textRuns?.[0]?.color ?? node.textColor) || "#8a8f99";
  const size = Math.max(10, Math.min(node.width, node.height, node.fontSize || 14));
  const cx = node.width / 2;
  const cy = node.height / 2;
  const label = `${node.name} ${node.text ?? ""}`.toLowerCase();
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(1.25, size / 12);
  context.lineCap = "round";
  context.lineJoin = "round";

  if (/search|搜索/.test(label)) {
    context.beginPath();
    context.arc(cx - size * 0.1, cy - size * 0.1, size * 0.28, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(cx + size * 0.12, cy + size * 0.12);
    context.lineTo(cx + size * 0.34, cy + size * 0.34);
    context.stroke();
  } else if (/bell|通知|提醒/.test(label)) {
    context.beginPath();
    context.arc(cx, cy + size * 0.32, size * 0.06, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(cx - size * 0.28, cy + size * 0.18);
    context.quadraticCurveTo(cx - size * 0.22, cy - size * 0.28, cx, cy - size * 0.32);
    context.quadraticCurveTo(cx + size * 0.22, cy - size * 0.28, cx + size * 0.28, cy + size * 0.18);
    context.lineTo(cx - size * 0.28, cy + size * 0.18);
    context.stroke();
  } else if (/global|earth| globe|地球|语言/.test(label)) {
    context.beginPath();
    context.arc(cx, cy, size * 0.34, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(cx - size * 0.32, cy);
    context.lineTo(cx + size * 0.32, cy);
    context.moveTo(cx, cy - size * 0.34);
    context.quadraticCurveTo(cx + size * 0.18, cy, cx, cy + size * 0.34);
    context.moveTo(cx, cy - size * 0.34);
    context.quadraticCurveTo(cx - size * 0.18, cy, cx, cy + size * 0.34);
    context.stroke();
  } else if (/user|avatar|个人|用户/.test(label)) {
    context.beginPath();
    context.arc(cx, cy - size * 0.12, size * 0.14, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(cx, cy + size * 0.3, size * 0.28, Math.PI * 1.1, Math.PI * 1.9);
    context.stroke();
  } else if (/dashboard|仪表|gauge/.test(label)) {
    context.beginPath();
    context.arc(cx, cy + size * 0.1, size * 0.32, Math.PI, 0);
    context.stroke();
    context.beginPath();
    context.moveTo(cx, cy + size * 0.1);
    context.lineTo(cx + size * 0.18, cy - size * 0.08);
    context.stroke();
  } else if (/form|表单|edit/.test(label)) {
    context.strokeRect(cx - size * 0.3, cy - size * 0.26, size * 0.5, size * 0.52);
    context.beginPath();
    context.moveTo(cx - size * 0.18, cy - size * 0.08);
    context.lineTo(cx + size * 0.12, cy - size * 0.08);
    context.moveTo(cx - size * 0.18, cy + size * 0.08);
    context.lineTo(cx + size * 0.12, cy + size * 0.08);
    context.stroke();
  } else if (/table|list|列表/.test(label)) {
    for (let index = -1; index <= 1; index += 1) {
      context.beginPath();
      context.rect(cx - size * 0.32, cy + index * size * 0.18 - size * 0.035, size * 0.07, size * 0.07);
      context.fill();
      context.moveTo(cx - size * 0.16, cy + index * size * 0.18);
      context.lineTo(cx + size * 0.34, cy + index * size * 0.18);
      context.stroke();
    }
  } else if (/warning|异常|alert/.test(label)) {
    context.beginPath();
    context.moveTo(cx, cy - size * 0.34);
    context.lineTo(cx + size * 0.34, cy + size * 0.28);
    context.lineTo(cx - size * 0.34, cy + size * 0.28);
    context.closePath();
    context.stroke();
  } else if (/check|result|结果/.test(label)) {
    context.beginPath();
    context.arc(cx, cy, size * 0.32, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(cx - size * 0.16, cy);
    context.lineTo(cx - size * 0.04, cy + size * 0.12);
    context.lineTo(cx + size * 0.18, cy - size * 0.14);
    context.stroke();
  } else if (/phone|mobile|tel|手机|电话/.test(label)) {
    context.strokeRect(cx - size * 0.18, cy - size * 0.34, size * 0.36, size * 0.68);
    context.beginPath();
    context.moveTo(cx - size * 0.08, cy - size * 0.24);
    context.lineTo(cx + size * 0.08, cy - size * 0.24);
    context.moveTo(cx - size * 0.04, cy + size * 0.25);
    context.lineTo(cx + size * 0.04, cy + size * 0.25);
    context.stroke();
  } else if (/left|back|返回|上一|chevron-left/.test(label)) {
    context.beginPath();
    context.moveTo(cx + size * 0.18, cy - size * 0.28);
    context.lineTo(cx - size * 0.14, cy);
    context.lineTo(cx + size * 0.18, cy + size * 0.28);
    context.stroke();
  } else if (/right|next|chevron|arrow|更多|进入|下一/.test(label)) {
    context.beginPath();
    context.moveTo(cx - size * 0.18, cy - size * 0.28);
    context.lineTo(cx + size * 0.14, cy);
    context.lineTo(cx - size * 0.18, cy + size * 0.28);
    context.stroke();
  } else if (/close|delete|remove|取消|关闭|删除/.test(label)) {
    context.beginPath();
    context.moveTo(cx - size * 0.24, cy - size * 0.24);
    context.lineTo(cx + size * 0.24, cy + size * 0.24);
    context.moveTo(cx + size * 0.24, cy - size * 0.24);
    context.lineTo(cx - size * 0.24, cy + size * 0.24);
    context.stroke();
  } else if (/plus|add|新增|添加|上传/.test(label)) {
    context.beginPath();
    context.moveTo(cx, cy - size * 0.32);
    context.lineTo(cx, cy + size * 0.32);
    context.moveTo(cx - size * 0.32, cy);
    context.lineTo(cx + size * 0.32, cy);
    context.stroke();
  } else if (/hand|小手|cursor|pointer/.test(label)) {
    context.beginPath();
    context.moveTo(cx - size * 0.08, cy + size * 0.34);
    context.lineTo(cx - size * 0.18, cy - size * 0.02);
    context.quadraticCurveTo(cx - size * 0.2, cy - size * 0.14, cx - size * 0.08, cy - size * 0.14);
    context.lineTo(cx + size * 0.02, cy + size * 0.06);
    context.lineTo(cx + size * 0.02, cy - size * 0.28);
    context.quadraticCurveTo(cx + size * 0.02, cy - size * 0.38, cx + size * 0.12, cy - size * 0.38);
    context.quadraticCurveTo(cx + size * 0.22, cy - size * 0.38, cx + size * 0.22, cy - size * 0.26);
    context.lineTo(cx + size * 0.22, cy + size * 0.28);
    context.stroke();
  } else {
    context.beginPath();
    context.arc(cx, cy, size * 0.26, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function getFirstRichTextLine(runs: NonNullable<DesignNode["textRuns"]>) {
  const firstLineRuns: NonNullable<DesignNode["textRuns"]> = [];
  for (const run of runs) {
    const [firstSegment] = run.text.split("\n");
    if (firstSegment) {
      firstLineRuns.push({ ...run, text: firstSegment });
    }
    if (run.text.includes("\n")) {
      break;
    }
  }
  return firstLineRuns;
}

function measureRichTextLine(
  context: CanvasRenderingContext2D,
  node: DesignNode,
  lineRuns: NonNullable<DesignNode["textRuns"]>
) {
  return lineRuns.reduce((width, run) => {
    context.font = getCanvasFont({
      ...node,
      fontFamily: run.fontFamily ?? node.fontFamily,
      fontSize: run.fontSize ?? node.fontSize,
      fontWeight: run.fontWeight ?? node.fontWeight
    });
    return width + context.measureText(run.text).width;
  }, 0);
}

function getCanvasFont(node: DesignNode) {
  const family = getCssFontFamily(node);
  return `${node.fontWeight ?? 400} ${node.fontSize}px ${family}`;
}

function drawCanvasTextDecorations(context: CanvasRenderingContext2D, node: DesignNode, line: string, x: number, y: number) {
  if (!node.underline && !node.strikethrough) {
    return;
  }

  const width = context.measureText(line).width;
  const startX = node.textAlign === "center" ? x - width / 2 : node.textAlign === "right" ? x - width : x;
  const lineWidth = Math.max(1, node.fontSize / 16);
  context.save();
  context.strokeStyle = getCanvasPaint(node.textColor) || "#171717";
  context.lineWidth = lineWidth;
  context.setLineDash([]);
  if (node.underline) {
    const underlineY = y + node.fontSize + 2;
    context.beginPath();
    context.moveTo(startX, underlineY);
    context.lineTo(startX + width, underlineY);
    context.stroke();
  }
  if (node.strikethrough) {
    const strikeY = y + node.fontSize * 0.62;
    context.beginPath();
    context.moveTo(startX, strikeY);
    context.lineTo(startX + width, strikeY);
    context.stroke();
  }
  context.restore();
}

function drawCanvasTextSegmentDecorations(
  context: CanvasRenderingContext2D,
  options: { x: number; y: number; width: number; fontSize: number; underline: boolean; strikethrough: boolean }
) {
  context.save();
  context.strokeStyle = context.fillStyle;
  context.lineWidth = Math.max(1, options.fontSize / 16);
  context.setLineDash([]);
  if (options.underline) {
    const underlineY = options.y + options.fontSize + 2;
    context.beginPath();
    context.moveTo(options.x, underlineY);
    context.lineTo(options.x + options.width, underlineY);
    context.stroke();
  }
  if (options.strikethrough) {
    const strikeY = options.y + options.fontSize * 0.62;
    context.beginPath();
    context.moveTo(options.x, strikeY);
    context.lineTo(options.x + options.width, strikeY);
    context.stroke();
  }
  context.restore();
}

function transformTextContent(text: string, transform: DesignTextTransform = "none") {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  if (transform === "capitalize") {
    return text.replace(/\b\p{L}/gu, (char) => char.toUpperCase());
  }
  return text;
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number, font: string) {
  context.font = font;
  const lines: string[] = [];
  text.split("\n").forEach((paragraph) => {
    let current = "";
    Array.from(paragraph).forEach((char) => {
      const next = `${current}${char}`;
      if (current && context.measureText(next).width > maxWidth) {
        lines.push(current);
        current = char;
      } else {
        current = next;
      }
    });
    lines.push(current);
  });
  return lines.length > 0 ? lines : [text];
}

function roundedRectPath(x: number, y: number, width: number, height: number, radius: number) {
  const path = new Path2D();
  const safeWidth = Math.max(0.01, width);
  const safeHeight = Math.max(0.01, height);
  const safeRadius = Math.max(0, Math.min(radius, safeWidth / 2, safeHeight / 2));
  path.moveTo(x + safeRadius, y);
  path.lineTo(x + safeWidth - safeRadius, y);
  path.quadraticCurveTo(x + safeWidth, y, x + safeWidth, y + safeRadius);
  path.lineTo(x + safeWidth, y + safeHeight - safeRadius);
  path.quadraticCurveTo(x + safeWidth, y + safeHeight, x + safeWidth - safeRadius, y + safeHeight);
  path.lineTo(x + safeRadius, y + safeHeight);
  path.quadraticCurveTo(x, y + safeHeight, x, y + safeHeight - safeRadius);
  path.lineTo(x, y + safeRadius);
  path.quadraticCurveTo(x, y, x + safeRadius, y);
  path.closePath();
  return path;
}

function getCanvasImage(url: string, requestRedraw: () => void) {
  const cached = canvasImageCache.get(url);
  if (cached) {
    return cached;
  }

  const image = new window.Image();
  const next = { image, loaded: false, failed: false };
  canvasImageCache.set(url, next);
  image.onload = () => {
    next.loaded = true;
    requestRedraw();
  };
  image.onerror = () => {
    next.failed = true;
    requestRedraw();
  };
  image.src = url;
  return next;
}

function getCanvasPaint(value: string | undefined) {
  const paint = value?.trim();
  if (isTransparentPaint(paint) || paint?.startsWith("linear-gradient") || paint?.startsWith("radial-gradient") || paint?.startsWith("url(")) {
    return "";
  }
  return paint;
}

function getCanvasStrokeStyle(context: CanvasRenderingContext2D, node: DesignNode): string | CanvasGradient {
  const stroke = getFirstRenderablePaintCssLayer(node.borders, node.stroke);
  if (isTransparentPaint(stroke) || stroke?.startsWith("url(")) {
    return "";
  }
  if (stroke.startsWith("linear-gradient")) {
    return createCanvasLinearGradient(context, node, stroke) || "";
  }
  if (stroke.startsWith("radial-gradient")) {
    return createCanvasRadialGradient(context, node, stroke) || "";
  }
  if (stroke.startsWith("conic-gradient")) {
    return createCanvasConicGradient(context, node, stroke) || "";
  }
  return stroke;
}

function getMinimapNodeColor(node: DesignNode) {
  if (node.type === "text") {
    return "#5f6368";
  }
  if (node.type === "image" || node.imageUrl || node.fillImageUrl) {
    return "#9db8ff";
  }
  const paint = node.fill?.trim();
  if (paint && paint !== "transparent" && /^#|rgb|hsl/i.test(paint)) {
    return paint;
  }
  if (node.svgPath) {
    return "#4b5563";
  }
  return "#d8d8dd";
}

function getCanvasFillStyle(context: CanvasRenderingContext2D, node: DesignNode, value: string | undefined): string | CanvasGradient {
  const paint = getFirstRenderableCanvasPaintLayer(value);
  if (isTransparentPaint(paint) || paint?.startsWith("url(")) {
    return "";
  }
  if (paint.startsWith("linear-gradient")) {
    return createCanvasLinearGradient(context, node, paint) || "";
  }
  if (paint.startsWith("radial-gradient")) {
    return createCanvasRadialGradient(context, node, paint) || "";
  }
  if (paint.startsWith("conic-gradient")) {
    return createCanvasConicGradient(context, node, paint) || "";
  }
  return paint;
}

function getCanvasFillStyleLayers(context: CanvasRenderingContext2D, node: DesignNode, value: string | undefined): Array<string | CanvasGradient> {
  if (node.type === "text") {
    return [];
  }
  if (value === undefined || value === node.fill) {
    const structuredLayers = getCanvasStructuredPaintLayers(context, node, node.fills);
    if (structuredLayers.length > 0) {
      return structuredLayers;
    }
  }
  return splitCssLayers(value)
    .map((paint) => paint.trim())
    .filter((paint) => paint && !isTransparentPaint(paint) && !paint.startsWith("url("))
    .map((paint) => getCanvasFillStyle(context, node, paint))
    .filter((paint): paint is string | CanvasGradient => Boolean(paint));
}

function getCanvasStructuredPaintLayers(context: CanvasRenderingContext2D, node: DesignNode, paints: WorkspaceDesignPaint[] | undefined): Array<string | CanvasGradient> {
  if (!paints?.length) {
    return [];
  }
  return paints
    .filter((paint) => paint.enabled !== false)
    .map((paint) => getCanvasStyleFromStructuredPaint(context, node, paint))
    .filter((paint): paint is string | CanvasGradient => Boolean(paint))
    .reverse();
}

function getCanvasStyleFromStructuredPaint(context: CanvasRenderingContext2D, node: DesignNode, paint: WorkspaceDesignPaint) {
  if (paint.kind === "gradient" && paint.gradient) {
    return createCanvasGradientFromPaint(context, node, paint.gradient);
  }
  if (paint.kind === "solid") {
    return paint.color || paint.css;
  }
  return "";
}

function createCanvasGradientFromPaint(context: CanvasRenderingContext2D, node: DesignNode, gradientPaint: NonNullable<WorkspaceDesignPaint["gradient"]>) {
  if (gradientPaint.type === "radial" || gradientPaint.type === "diamond") {
    const centerX = node.width * gradientPaint.from.x;
    const centerY = node.height * gradientPaint.from.y;
    const radius = Math.max(node.width, node.height) / 2;
    const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    addCanvasGradientStops(gradient, gradientPaint.stops);
    return gradient;
  }
  if (gradientPaint.type === "angular" && typeof context.createConicGradient === "function") {
    const angle = Math.atan2(gradientPaint.to.y - gradientPaint.from.y, gradientPaint.to.x - gradientPaint.from.x) + Math.PI / 2;
    const gradient = context.createConicGradient(angle, node.width * gradientPaint.from.x, node.height * gradientPaint.from.y);
    addCanvasGradientStops(gradient, gradientPaint.stops);
    return gradient;
  }
  const startX = node.width * gradientPaint.from.x;
  const startY = node.height * gradientPaint.from.y;
  const endX = node.width * gradientPaint.to.x;
  const endY = node.height * gradientPaint.to.y;
  const gradient = context.createLinearGradient(startX, startY, endX, endY);
  addCanvasGradientStops(gradient, gradientPaint.stops);
  return gradient;
}

function addCanvasGradientStops(gradient: CanvasGradient, stops: Array<{ color: string; position: number }>) {
  stops.forEach((stop) => {
    try {
      gradient.addColorStop(Math.max(0, Math.min(1, stop.position)), stop.color);
    } catch {
      // Ignore malformed imported color stops; falling back would be worse than skipping one stop.
    }
  });
}

function getRenderablePaintCssLayers(paints: WorkspaceDesignPaint[] | undefined, fallback: string | undefined) {
  if (paints?.length) {
    return paints
      .filter((paint) => paint.enabled !== false)
      .map((paint) => paint.css)
      .filter(Boolean)
      .reverse();
  }
  return splitCssLayers(fallback);
}

function getFirstRenderablePaintCssLayer(paints: WorkspaceDesignPaint[] | undefined, fallback: string | undefined) {
  return getRenderablePaintCssLayers(paints, fallback).find((paint) => paint && !paint.startsWith("url("))?.trim() || getFirstCanvasPaintLayer(fallback);
}

function createCanvasLinearGradient(context: CanvasRenderingContext2D, node: DesignNode, value: string) {
  const args = extractCssFunctionArgs(value);
  if (args.length < 2) {
    return undefined;
  }
  const firstArg = args[0];
  const angle = parseCssLinearGradientAngle(firstArg);
  const stops = (isCssLinearGradientDirectionArg(firstArg) ? args.slice(1) : args).map(parseCssColorStop).filter(Boolean) as Array<{ color: string; position: number }>;
  if (stops.length === 0) {
    return undefined;
  }

  const radians = (angle - 90) * Math.PI / 180;
  const length = Math.max(node.width, node.height);
  const centerX = node.width / 2;
  const centerY = node.height / 2;
  const dx = Math.cos(radians) * length / 2;
  const dy = Math.sin(radians) * length / 2;
  const gradient = context.createLinearGradient(centerX - dx, centerY - dy, centerX + dx, centerY + dy);
  stops.forEach((stop) => {
    try {
      gradient.addColorStop(stop.position, stop.color);
    } catch {
      // Ignore malformed imported color stops; falling back would be worse than skipping one stop.
    }
  });
  return gradient;
}

function createCanvasRadialGradient(context: CanvasRenderingContext2D, node: DesignNode, value: string) {
  const args = extractCssFunctionArgs(value);
  const firstArg = args[0] ?? "";
  const hasShapeArg = isCssRadialGradientShapeArg(firstArg);
  const stops = (hasShapeArg ? args.slice(1) : args).map(parseCssColorStop).filter(Boolean) as Array<{ color: string; position: number }>;
  if (stops.length === 0) {
    return undefined;
  }

  const center = parseCssRadialGradientCenter(firstArg);
  const radius = Math.max(node.width, node.height) / 2;
  const centerX = node.width * center.x;
  const centerY = node.height * center.y;
  const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  stops.forEach((stop) => {
    try {
      gradient.addColorStop(stop.position, stop.color);
    } catch {
      // Ignore malformed imported color stops; falling back would be worse than skipping one stop.
    }
  });
  return gradient;
}

function createCanvasConicGradient(context: CanvasRenderingContext2D, node: DesignNode, value: string) {
  if (typeof context.createConicGradient !== "function") {
    return undefined;
  }
  const args = extractCssFunctionArgs(value);
  const firstArg = args[0] ?? "";
  const hasPositionArg = isCssConicGradientPositionArg(firstArg);
  const stops = (hasPositionArg ? args.slice(1) : args).map(parseCssColorStop).filter(Boolean) as Array<{ color: string; position: number }>;
  if (stops.length === 0) {
    return undefined;
  }

  const position = parseCssConicGradientPosition(firstArg);
  const gradient = context.createConicGradient(position.angle * Math.PI / 180, node.width * position.x, node.height * position.y);
  stops.forEach((stop) => {
    try {
      gradient.addColorStop(stop.position, stop.color);
    } catch {
      // Ignore malformed imported color stops; falling back would be worse than skipping one stop.
    }
  });
  return gradient;
}

function isCssLinearGradientDirectionArg(value: string) {
  return /(?:^|\s)(?:-?\d+(?:\.\d+)?deg|to\s+(?:top|bottom|left|right))/i.test(value.trim());
}

function parseCssLinearGradientAngle(value: string) {
  const text = value.trim().toLowerCase();
  const degree = /(-?\d+(?:\.\d+)?)deg/.exec(text);
  if (degree) {
    return Number(degree[1]);
  }
  if (text === "to top") return 0;
  if (text === "to right") return 90;
  if (text === "to bottom") return 180;
  if (text === "to left") return 270;
  if (text === "to top right" || text === "to right top") return 45;
  if (text === "to bottom right" || text === "to right bottom") return 135;
  if (text === "to bottom left" || text === "to left bottom") return 225;
  if (text === "to top left" || text === "to left top") return 315;
  return 180;
}

function isCssRadialGradientShapeArg(value: string) {
  return /^(circle|ellipse|closest|farthest|at\s+)/i.test(value.trim());
}

function isCssConicGradientPositionArg(value: string) {
  return /^(from\s+-?\d+(?:\.\d+)?deg)?(?:\s+at\s+-?\d+(?:\.\d+)?%\s+-?\d+(?:\.\d+)?%)?$/i.test(value.trim());
}

function parseCssConicGradientPosition(value: string) {
  const text = value.trim();
  const angle = /from\s+(-?\d+(?:\.\d+)?)deg/i.exec(text);
  const center = /\bat\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/i.exec(text);
  return {
    angle: angle ? Number(angle[1]) : 0,
    x: center ? Number(center[1]) / 100 : 0.5,
    y: center ? Number(center[2]) / 100 : 0.5
  };
}

function parseCssRadialGradientCenter(value: string) {
  const match = /\bat\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/i.exec(value);
  if (!match) {
    return { x: 0.5, y: 0.5 };
  }
  return {
    x: Number(match[1]) / 100,
    y: Number(match[2]) / 100
  };
}

function extractCssFunctionArgs(value: string) {
  const start = value.indexOf("(");
  const end = findMatchingCssFunctionEnd(value, start);
  if (start < 0 || end <= start) {
    return [];
  }
  const content = value.slice(start + 1, end);
  const args: string[] = [];
  let depth = 0;
  let current = "";
  Array.from(content).forEach((char) => {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      return;
    }
    current += char;
  });
  if (current.trim()) {
    args.push(current.trim());
  }
  return args;
}

function findMatchingCssFunctionEnd(value: string, start: number) {
  if (start < 0) {
    return -1;
  }
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function getFirstCanvasPaintLayer(value: string | undefined) {
  const paint = value?.trim();
  if (!paint) {
    return undefined;
  }
  return splitCssLayers(paint)[0]?.trim() || paint;
}

function getFirstRenderableCanvasPaintLayer(value: string | undefined) {
  return splitCssLayers(value).find((paint) => paint && !paint.startsWith("url("))?.trim() || getFirstCanvasPaintLayer(value);
}

function splitCssLayers(value: string | undefined) {
  if (!value) {
    return [];
  }
  const layers: string[] = [];
  let depth = 0;
  let current = "";
  Array.from(value).forEach((char) => {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      layers.push(current.trim());
      current = "";
      return;
    }
    current += char;
  });
  if (current.trim()) {
    layers.push(current.trim());
  }
  return layers;
}

function parseCssColorStop(value: string) {
  const match = /^(?<color>.+?)\s+(?<position>-?\d+(?:\.\d+)?)%$/.exec(value.trim());
  if (!match?.groups) {
    const color = value.trim();
    return isValidCssColor(color) ? { color, position: 0 } : undefined;
  }
  const color = match.groups.color.trim();
  if (!isValidCssColor(color)) {
    return undefined;
  }
  return {
    color,
    position: Math.max(0, Math.min(1, Number(match.groups.position) / 100))
  };
}

function isValidCssColor(value: string) {
  if (!value || /gradient\s*\(|\)$/.test(value)) {
    return false;
  }
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    return CSS.supports("color", value);
  }
  return /^(#(?:[0-9a-f]{3,8})|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-z]+|currentColor|none)$/i.test(value);
}

function getSvgPaint(value: string | undefined, fallback: string) {
  const paint = value?.trim();
  if (!paint || paint === "transparent") {
    return fallback;
  }
  if (/^(#|rgb|hsl|currentColor|none)/i.test(paint)) {
    return paint;
  }
  return fallback;
}

function getSvgPaintDescriptor(node: DesignNode, value: string | undefined, kind: "fill" | "stroke", fallback: string, idSuffix = "") {
  const paint = getFirstCanvasPaintLayer(value);
  if (kind === "fill" && isTransparentPaint(paint) && isLikelySketchSidebarBackground(node)) {
    return { paint: "#f8f8fa", definition: null as ReactNode };
  }
  if (!paint || paint === "transparent" || paint.startsWith("url(")) {
    return { paint: fallback, definition: null as ReactNode };
  }
  if (paint.startsWith("linear-gradient")) {
    const id = `paint-${node.id}-${kind}${idSuffix ? `-${idSuffix}` : ""}`;
    return {
      paint: `url(#${id})`,
      definition: renderSvgLinearGradient(id, paint)
    };
  }
  if (paint.startsWith("radial-gradient")) {
    const id = `paint-${node.id}-${kind}${idSuffix ? `-${idSuffix}` : ""}`;
    return {
      paint: `url(#${id})`,
      definition: renderSvgRadialGradient(id, paint)
    };
  }
  return { paint: getSvgPaint(paint, fallback), definition: null as ReactNode };
}

function renderSvgLinearGradient(id: string, value: string) {
  const args = extractCssFunctionArgs(value);
  const firstArg = args[0] ?? "";
  const angle = parseCssLinearGradientAngle(firstArg);
  const stops = (isCssLinearGradientDirectionArg(firstArg) ? args.slice(1) : args)
    .map(parseCssColorStop)
    .filter(Boolean) as Array<{ color: string; position: number }>;
  const radians = (angle - 90) * Math.PI / 180;
  const x = Math.cos(radians) / 2;
  const y = Math.sin(radians) / 2;
  return (
    <linearGradient key={id} id={id} x1={0.5 - x} y1={0.5 - y} x2={0.5 + x} y2={0.5 + y}>
      {stops.map((stop, index) => {
        const paint = normalizeSvgGradientStopPaint(stop.color);
        return (
          <stop key={`${id}-${index}`} offset={`${Math.round(stop.position * 100)}%`} stopColor={paint.color} stopOpacity={paint.opacity} />
        );
      })}
    </linearGradient>
  );
}

function renderSvgRadialGradient(id: string, value: string) {
  const args = extractCssFunctionArgs(value);
  const firstArg = args[0] ?? "";
  const hasShapeArg = isCssRadialGradientShapeArg(firstArg);
  const center = parseCssRadialGradientCenter(firstArg);
  const stops = (hasShapeArg ? args.slice(1) : args)
    .map(parseCssColorStop)
    .filter(Boolean) as Array<{ color: string; position: number }>;
  return (
    <radialGradient key={id} id={id} cx={`${formatSvgNumber(center.x * 100)}%`} cy={`${formatSvgNumber(center.y * 100)}%`} r="70%">
      {stops.map((stop, index) => {
        const paint = normalizeSvgGradientStopPaint(stop.color);
        return (
          <stop key={`${id}-${index}`} offset={`${Math.round(stop.position * 100)}%`} stopColor={paint.color} stopOpacity={paint.opacity} />
        );
      })}
    </radialGradient>
  );
}

function normalizeSvgGradientStopPaint(color: string) {
  const match = /^rgba\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d?(?:\.\d+)?)\s*\)$/i.exec(color.trim());
  if (!match) {
    return { color, opacity: undefined };
  }
  return {
    color: `rgb(${Math.round(Number(match[1]))}, ${Math.round(Number(match[2]))}, ${Math.round(Number(match[3]))})`,
    opacity: Math.max(0, Math.min(1, Number(match[4])))
  };
}

function shouldAllowDesignNodeOverflow(node: DesignNode) {
  if (shouldClipDesignNode(node)) {
    return false;
  }
  if (node.type === "image" || node.fillImageUrl || node.imageUrl) {
    return false;
  }
  return node.type === "frame" || node.type === "container" || node.type === "card";
}

function shouldClipDesignNode(node: DesignNode) {
  return node.sourceMeta?.hasClippingMask === true
    || node.sourceMeta?.activeClippingMask?.hasClippingMask === true
    || Boolean(node.clipBounds || node.clipPath);
}

function getNodeClipPath(node: DesignNode) {
  if (node.clipPath?.svgPath) {
    const translatedPath = translateSvgPath(node.clipPath.svgPath, node.clipPath.x - node.x, node.clipPath.y - node.y);
    return `path("${translatedPath}")`;
  }

  const clip = node.clipBounds;
  if (!clip) {
    return undefined;
  }

  const nodeBounds = nodeToBounds(node);
  if (!rectsIntersect(clip, nodeBounds)) {
    return "inset(50% 50% 50% 50%)";
  }

  const top = Math.max(0, clip.y - node.y);
  const left = Math.max(0, clip.x - node.x);
  const right = Math.max(0, node.x + node.width - (clip.x + clip.width));
  const bottom = Math.max(0, node.y + node.height - (clip.y + clip.height));
  return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

function findTopDesignNodeAtPoint(nodes: DesignNode[], point: { x: number; y: number }) {
  return [...nodes]
    .map((node, index) => ({ node, index }))
    .sort((first, second) => (second.node.zIndex ?? second.index) - (first.node.zIndex ?? first.index))
    .find(({ node }) => pointInDesignNode(node, point))?.node ?? null;
}

function findNextDrillNodeAtPoint(
  renderNodes: DesignNode[],
  allNodes: DesignNode[],
  point: { x: number; y: number },
  selectedId?: string
) {
  const hitNode = findTopDesignNodeAtPoint(renderNodes, point);
  if (!hitNode) {
    return null;
  }
  const hitPath = [...getAncestorNodes(hitNode, allNodes)].reverse().concat(hitNode);
  if (!selectedId) {
    return getDefaultClickSelectionTarget(hitNode, allNodes) ?? hitNode;
  }
  const selectedIndex = hitPath.findIndex((node) => node.id === selectedId);
  if (selectedIndex >= 0 && selectedIndex < hitPath.length - 1) {
    return hitPath[selectedIndex + 1];
  }
  const selectedNode = allNodes.find((node) => node.id === selectedId);
  if (selectedNode && pointInDesignNode(selectedNode, point)) {
    const child = findTopDesignNodeAtPoint(
      renderNodes.filter((node) => node.parentId === selectedNode.id),
      point
    );
    if (child) {
      return child;
    }
  }
  return hitNode;
}

function pointInDesignNode(node: DesignNode, point: { x: number; y: number }) {
  if (!rectContainsPoint(nodeToBounds(node), point)) {
    return false;
  }
  if (node.clipBounds && !rectContainsPoint(node.clipBounds, point)) {
    return false;
  }
  if (node.clipPath && !rectContainsPoint(node.clipPath, point)) {
    return false;
  }
  return true;
}

function getCanvasSelectionTarget(hitNode: DesignNode, nodes: DesignNode[], selectedIds: string[]) {
  const selectedNode = selectedIds[0] ? nodes.find((node) => node.id === selectedIds[0]) : undefined;
  if (selectedNode) {
    if (hitNode.id === selectedNode.id || getAncestorNodes(hitNode, nodes).some((ancestor) => ancestor.id === selectedNode.id)) {
      return selectedNode;
    }
    if (hitNode.parentId === selectedNode.parentId && !isHiddenRootNode(hitNode, nodes)) {
      return hitNode;
    }
  }
  return getDefaultClickSelectionTarget(hitNode, nodes);
}

function getDefaultClickSelectionTarget(hitNode: DesignNode, nodes: DesignNode[]) {
  const ancestors = getAncestorNodes(hitNode, nodes);
  const visibleRoot = ancestors[ancestors.length - 1];
  if (visibleRoot && !isHiddenRootNode(visibleRoot, nodes) && isDesignNodeHitTestable(visibleRoot)) {
    return visibleRoot;
  }
  const adjacentTarget = getHiddenRootAdjacentTarget(hitNode, nodes);
  if (adjacentTarget && isDesignNodeHitTestable(adjacentTarget)) {
    return adjacentTarget;
  }
  return [hitNode, ...ancestors].find((node) => !isHiddenRootNode(node, nodes) && isDesignNodeHitTestable(node)) ?? null;
}

function getAncestorNodes(node: DesignNode, nodes: DesignNode[]) {
  const nodeById = new Map(nodes.map((item) => [item.id, item]));
  const ancestors: DesignNode[] = [];
  const visited = new Set<string>();
  let parentId = node.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodeById.get(parentId);
    if (!parent) {
      break;
    }
    ancestors.push(parent);
    parentId = parent.parentId;
  }
  return ancestors;
}

function getDescendantNodeIds(nodeId: string, nodes: DesignNode[]) {
  const childrenByParentId = new Map<string, DesignNode[]>();
  nodes.forEach((node) => {
    if (!node.parentId) {
      return;
    }
    const children = childrenByParentId.get(node.parentId) ?? [];
    children.push(node);
    childrenByParentId.set(node.parentId, children);
  });

  const result: string[] = [];
  const visit = (parentId: string) => {
    (childrenByParentId.get(parentId) ?? []).forEach((child) => {
      result.push(child.id);
      visit(child.id);
    });
  };
  visit(nodeId);
  return result;
}

function getHiddenRootAdjacentTarget(hitNode: DesignNode, nodes: DesignNode[]) {
  const ancestors = getAncestorNodes(hitNode, nodes);
  const root = ancestors[ancestors.length - 1] ?? hitNode;
  if (hitNode.id === root.id && isHiddenRootNode(hitNode, nodes)) {
    return null;
  }
  const pathFromHitToRoot = [hitNode, ...ancestors];
  return pathFromHitToRoot.find((node) => node.parentId === root.id) ?? (isHiddenRootNode(hitNode, nodes) ? null : hitNode);
}

function isHiddenRootNode(node: DesignNode, nodes: DesignNode[]) {
  return !node.parentId && nodes.some((candidate) => candidate.parentId === node.id);
}

function expandSelectionWithDescendants(selectionIds: string[], nodes: DesignNode[]) {
  const ids = new Set(selectionIds);
  selectionIds.forEach((id) => {
    getDescendantNodeIds(id, nodes).forEach((descendantId) => ids.add(descendantId));
  });
  return Array.from(ids);
}

function normalizeSelectionIds(ids: string[], nodes: DesignNode[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const idSet = new Set(uniqueIds);
  return uniqueIds.filter((id) => {
    const node = nodes.find((item) => item.id === id);
    return Boolean(node)
      && !isHiddenRootNode(node!, nodes)
      && !getAncestorNodes(node!, nodes).some((ancestor) => idSet.has(ancestor.id));
  });
}

function hasSelectedAncestor(node: DesignNode, selectedIds: string[], nodes: DesignNode[]) {
  const selectedIdSet = new Set(selectedIds);
  return getAncestorNodes(node, nodes).some((ancestor) => selectedIdSet.has(ancestor.id));
}

function getContextActionNodeIds(anchorNodeId: string | undefined, selectedIds: string[]) {
  if (!anchorNodeId) {
    return selectedIds;
  }
  return selectedIds.includes(anchorNodeId) ? selectedIds : [anchorNodeId];
}

function getTopLevelNodeIds(ids: string[], nodes: DesignNode[]) {
  const idSet = new Set(ids);
  return ids.filter((id) => {
    const node = nodes.find((item) => item.id === id);
    return Boolean(node) && !getAncestorNodes(node!, nodes).some((ancestor) => idSet.has(ancestor.id));
  });
}

function isDescendantOfNode(node: DesignNode, ancestorId: string, nodes: DesignNode[]) {
  return getAncestorNodes(node, nodes).some((ancestor) => ancestor.id === ancestorId);
}

function rectContainsPoint(rect: RectBounds, point: { x: number; y: number }) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function rectContainsRect(outer: RectBounds, inner: RectBounds, tolerance = 0) {
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance;
}

function nodeToRect(node: DesignNode): RectBounds {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

function translateSvgPath(path: string, offsetX: number, offsetY: number) {
  const tokens = path.match(/[AaCcHhLlMmQqSsTtVvZz]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/g) ?? [];
  const coordinateCounts: Record<string, number> = {
    A: 7,
    C: 6,
    H: 1,
    L: 2,
    M: 2,
    Q: 4,
    S: 4,
    T: 2,
    V: 1,
    Z: 0
  };
  const output: string[] = [];
  let command = "";
  let numberIndex = 0;

  tokens.forEach((token) => {
    if (/^[AaCcHhLlMmQqSsTtVvZz]$/.test(token)) {
      command = token;
      numberIndex = 0;
      output.push(token);
      return;
    }

    const numeric = Number(token);
    const upperCommand = command.toUpperCase();
    const coordinateCount = coordinateCounts[upperCommand] ?? 0;
    const isRelative = command !== upperCommand;
    const commandIndex = coordinateCount > 0 ? numberIndex % coordinateCount : numberIndex;
    const translated = isRelative
      ? numeric
      : numeric + getSvgPathCoordinateOffset(upperCommand, commandIndex, offsetX, offsetY);
    output.push(formatSvgNumber(translated));
    numberIndex += 1;
  });

  return output.join(" ");
}

function getSvgPathCoordinateOffset(command: string, index: number, offsetX: number, offsetY: number) {
  if (command === "H") {
    return offsetX;
  }
  if (command === "V") {
    return offsetY;
  }
  if (command === "A") {
    if (index === 5) {
      return offsetX;
    }
    if (index === 6) {
      return offsetY;
    }
    return 0;
  }
  if (command === "C") {
    return index % 2 === 0 ? offsetX : offsetY;
  }
  if (command === "S" || command === "Q") {
    return index % 2 === 0 ? offsetX : offsetY;
  }
  if (command === "M" || command === "L" || command === "T") {
    return index % 2 === 0 ? offsetX : offsetY;
  }
  return 0;
}

function getNodesBounds(nodes: DesignNode[]) {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 220, height: 120 };
  }
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(120, maxX - minX + 24),
    height: Math.max(80, maxY - minY + 24)
  };
}

function expandBounds(bounds: RectBounds, padding: number): RectBounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2
  };
}

function unionBounds(first: RectBounds, second: RectBounds): RectBounds {
  const minX = Math.min(first.x, second.x);
  const minY = Math.min(first.y, second.y);
  const maxX = Math.max(first.x + first.width, second.x + second.width);
  const maxY = Math.max(first.y + first.height, second.y + second.height);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function getNodesBoundsForSelection(nodes: DesignNode[]): RectBounds | null {
  if (nodes.length === 0) {
    return null;
  }
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function normalizeRect(start: { x: number; y: number }, current: { x: number; y: number }): RectBounds {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  return {
    x,
    y,
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  };
}

function nodeToBounds(node: DesignNode): RectBounds {
  return {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height
  };
}

function rectsIntersect(a: RectBounds, b: RectBounds) {
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y;
}

function resizeSelectionNodes(session: ResizeSession, point: { x: number; y: number }) {
  const minSize = 6;
  const originalRight = session.bounds.x + session.bounds.width;
  const originalBottom = session.bounds.y + session.bounds.height;
  const nextLeft = session.handle.includes("w") ? Math.min(point.x, originalRight - minSize) : session.bounds.x;
  const nextTop = session.handle.includes("n") ? Math.min(point.y, originalBottom - minSize) : session.bounds.y;
  const nextRight = session.handle.includes("e") ? Math.max(point.x, session.bounds.x + minSize) : originalRight;
  const nextBottom = session.handle.includes("s") ? Math.max(point.y, session.bounds.y + minSize) : originalBottom;
  const nextWidth = Math.max(minSize, nextRight - nextLeft);
  const nextHeight = Math.max(minSize, nextBottom - nextTop);
  const scaleX = nextWidth / Math.max(1, session.bounds.width);
  const scaleY = nextHeight / Math.max(1, session.bounds.height);
  const patchByNodeId = new Map<string, Partial<DesignNode>>();

  session.originals.forEach((node) => {
    patchByNodeId.set(node.id, {
      x: Math.round(nextLeft + (node.x - session.bounds.x) * scaleX),
      y: Math.round(nextTop + (node.y - session.bounds.y) * scaleY),
      width: Math.max(minSize, Math.round(node.width * scaleX)),
      height: Math.max(minSize, Math.round(node.height * scaleY))
    });
  });

  return patchByNodeId;
}

function ToolbarButton({
  active,
  label,
  icon: Icon,
  onClick
}: {
  active: boolean;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="ghost" size="sm" className={`gap-1 ${active ? "bg-[#eaf1ff] text-[#246bfe] hover:bg-[#eaf1ff]" : ""}`} onClick={onClick}>
      <Icon className="size-4" />
      <span className="hidden xl:inline">{label}</span>
    </Button>
  );
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="p-5">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {children}
    </section>
  );
}

function NumberField({ label, value, onChange, compact = false }: { label: string; value: number; onChange: (value: number) => void; compact?: boolean }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-xs font-medium text-[#777]">{label}</span>
      <Input type="number" value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} className={compact ? "h-10 rounded-xl border-[#e4e4e7] bg-[#f4f4f5]" : undefined} />
    </label>
  );
}

function TextStyleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 rounded-xl text-sm font-semibold transition ${active ? "bg-[#4b55ff] text-white shadow-[0_8px_18px_rgba(75,85,255,0.28)]" : "text-[#666] hover:bg-white"}`}
    >
      {children}
    </button>
  );
}

const defaultImageColorControls: WorkspaceDesignImageColorControls = {
  isEnabled: false,
  hue: 0,
  saturation: 1,
  brightness: 0,
  contrast: 1
};
const sketchHueUiPercentScale = 31.25;

function ImageColorControlsEditor({
  value,
  onChange
}: {
  value?: WorkspaceDesignImageColorControls;
  onChange: (value: WorkspaceDesignImageColorControls | undefined) => void;
}) {
  const controls = value ?? defaultImageColorControls;
  const [expanded, setExpanded] = useState(controls.isEnabled);
  const updateControls = (patch: Partial<WorkspaceDesignImageColorControls>) => {
    onChange({
      ...defaultImageColorControls,
      ...controls,
      ...patch
    });
  };
  const setEnabled = (enabled: boolean) => {
    const nextControls = {
      ...defaultImageColorControls,
      ...controls,
      isEnabled: enabled
    };
    onChange(enabled ? nextControls : { ...nextControls, isEnabled: false });
    if (enabled) {
      setExpanded(true);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-pressed={controls.isEnabled}
          onClick={() => setEnabled(!controls.isEnabled)}
          className={`flex h-6 w-10 items-center rounded-full p-1 transition ${controls.isEnabled ? "bg-[#4b55ff]" : "bg-[#d7d7dc]"}`}
        >
          <span className={`size-4 rounded-full bg-white shadow-sm transition ${controls.isEnabled ? "translate-x-4" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className={`flex h-10 flex-1 items-center justify-between rounded-xl px-3 text-left text-sm font-semibold transition ${controls.isEnabled ? "bg-[#f4f4f5] text-[#171717]" : "bg-[#f4f4f5] text-[#8a8a90]"}`}
        >
          <span>颜色调整</span>
          <ChevronDown className={`size-4 transition ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>

      {expanded ? (
        <div className="space-y-3 rounded-2xl border border-[#eeeeef] bg-white p-3">
          <ImageAdjustmentField
            label="色相"
            value={sketchHueToUiPercent(controls.hue ?? 0)}
            min={-100}
            max={100}
            disabled={!controls.isEnabled}
            onChange={(nextValue) => updateControls({ hue: uiPercentToSketchHue(clampImageAdjustment(nextValue, -100, 100)) })}
          />
          <ImageAdjustmentField
            label="饱和度"
            value={Math.round(((controls.saturation ?? 1) - 1) * 100)}
            min={-100}
            max={100}
            disabled={!controls.isEnabled}
            onChange={(nextValue) => updateControls({ saturation: Math.max(0, 1 + clampImageAdjustment(nextValue, -100, 100) / 100) })}
          />
          <ImageAdjustmentField
            label="亮度"
            value={Math.round((controls.brightness ?? 0) * 100)}
            min={-100}
            max={100}
            disabled={!controls.isEnabled}
            onChange={(nextValue) => updateControls({ brightness: clampImageAdjustment(nextValue, -100, 100) / 100 })}
          />
          <ImageAdjustmentField
            label="对比度"
            value={Math.round(((controls.contrast ?? 1) - 1) * 100)}
            min={-100}
            max={100}
            disabled={!controls.isEnabled}
            onChange={(nextValue) => updateControls({ contrast: Math.max(0, 1 + clampImageAdjustment(nextValue, -100, 100) / 100) })}
          />
        </div>
      ) : null}
    </div>
  );
}

function ImageAdjustmentField({
  label,
  value,
  min,
  max,
  disabled,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={`grid grid-cols-[1fr_92px] items-center gap-3 text-xs ${disabled ? "opacity-45" : ""}`}>
      <span className="rounded-xl bg-[#f4f4f5] px-3 py-2.5 text-sm font-semibold text-[#777]">{label}</span>
      <div className="flex items-center rounded-xl bg-[#f4f4f5] px-2">
        <Input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
          className="h-10 border-0 bg-transparent px-0 text-right text-sm font-semibold shadow-none focus-visible:ring-0 disabled:cursor-not-allowed"
        />
        <span className="pl-1 text-sm font-semibold text-[#555]">%</span>
      </div>
    </label>
  );
}

function clampImageAdjustment(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(min, Math.min(max, value));
}

function sketchHueToUiPercent(hue: number) {
  return Math.round(clampImageAdjustment(hue * sketchHueUiPercentScale, -100, 100));
}

function uiPercentToSketchHue(percent: number) {
  return clampImageAdjustment(percent, -100, 100) / sketchHueUiPercentScale;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const gradient = parseEditableGradientPaint(value);
  const mode = gradient?.type ?? "solid";
  const firstStop = gradient?.stops[0] ?? { color: normalizeColor(value), position: 0 };
  const lastStop = gradient?.stops[gradient.stops.length - 1] ?? { color: "#ffffff", position: 1 };
  const angle = gradient?.angle ?? 180;
  const center = gradient?.center ?? { x: 0.5, y: 0.5 };
  const setMode = (nextMode: string) => {
    if (nextMode === "solid") {
      onChange(firstStop.color);
      return;
    }
    if (nextMode === "linear") {
      onChange(buildEditableLinearGradient(angle, firstStop, lastStop));
      return;
    }
    onChange(buildEditableRadialGradient(center, firstStop, lastStop));
  };
  const updateGradient = (patch: Partial<{ angle: number; centerX: number; centerY: number; firstColor: string; firstPosition: number; lastColor: string; lastPosition: number }>) => {
    const nextFirst = {
      color: patch.firstColor ?? firstStop.color,
      position: clampGradientPosition((patch.firstPosition ?? firstStop.position * 100) / 100)
    };
    const nextLast = {
      color: patch.lastColor ?? lastStop.color,
      position: clampGradientPosition((patch.lastPosition ?? lastStop.position * 100) / 100)
    };
    if (mode === "radial") {
      onChange(buildEditableRadialGradient({
        x: clampGradientPosition((patch.centerX ?? center.x * 100) / 100),
        y: clampGradientPosition((patch.centerY ?? center.y * 100) / 100)
      }, nextFirst, nextLast));
      return;
    }
    onChange(buildEditableLinearGradient(patch.angle ?? angle, nextFirst, nextLast));
  };
  return (
    <div className="mb-4 space-y-2 text-xs">
      <span className="block text-xs font-medium text-[#777]">{label}</span>
      <div className="space-y-3 rounded-xl border border-[#e4e4e7] p-3">
        <div className="grid grid-cols-[36px_1fr] items-center gap-3">
          <div className="size-9 rounded-lg border border-[#e4e4e7]" style={{ background: value || "transparent" }} />
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger className="h-9 w-full rounded-lg border-[#e4e4e7] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="solid">纯色</SelectItem>
              <SelectItem value="linear">线性</SelectItem>
              <SelectItem value="radial">径向</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mode === "solid" ? (
          <div className="grid grid-cols-[36px_1fr] items-center gap-3">
            <input type="color" value={normalizeColor(value)} onChange={(event) => onChange(event.target.value)} className="size-9 rounded border-0 bg-transparent p-0" />
            <Input value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-lg border-[#e4e4e7] px-2 font-mono text-[11px]" />
          </div>
        ) : (
          <div className="space-y-3">
            {mode === "linear" ? (
              <label className="space-y-1.5">
                <span className="text-[#777]">角度</span>
                <Input type="number" value={Math.round(angle)} onChange={(event) => updateGradient({ angle: Number(event.target.value) || 0 })} className="h-9 rounded-lg border-[#e4e4e7]" />
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[#777]">X%</span>
                  <Input type="number" value={Math.round(center.x * 100)} onChange={(event) => updateGradient({ centerX: Number(event.target.value) || 0 })} className="h-9 rounded-lg border-[#e4e4e7]" />
                </label>
                <label className="space-y-1">
                  <span className="text-[#777]">Y%</span>
                  <Input type="number" value={Math.round(center.y * 100)} onChange={(event) => updateGradient({ centerY: Number(event.target.value) || 0 })} className="h-9 rounded-lg border-[#e4e4e7]" />
                </label>
              </div>
            )}
            <GradientStopField label="起点" stop={firstStop} onChange={(patch) => updateGradient({ firstColor: patch.color, firstPosition: patch.position })} />
            <GradientStopField label="终点" stop={lastStop} onChange={(patch) => updateGradient({ lastColor: patch.color, lastPosition: patch.position })} />
            <label className="space-y-1.5">
              <span className="text-[#777]">CSS</span>
              <Input value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-lg border-[#e4e4e7] font-mono text-[11px]" />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function GradientStopField({
  label,
  stop,
  onChange
}: {
  label: string;
  stop: { color: string; position: number };
  onChange: (patch: { color?: string; position?: number }) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-lg bg-[#f7f7f8] p-2">
      <span className="text-[#777]">{label}</span>
      <div className="grid grid-cols-[36px_1fr_64px] items-center gap-2">
        <input type="color" value={normalizeColor(stop.color)} onChange={(event) => onChange({ color: event.target.value })} className="size-9 rounded border-0 bg-transparent p-0" />
        <Input value={stop.color} onChange={(event) => onChange({ color: event.target.value })} className="h-9 rounded-lg border-[#e4e4e7] px-2 font-mono text-[11px]" />
        <Input type="number" value={Math.round(stop.position * 100)} onChange={(event) => onChange({ position: Number(event.target.value) || 0 })} className="h-9 rounded-lg border-[#e4e4e7] px-2" />
      </div>
    </div>
  );
}

function PaintLayersView({ paints }: { paints?: WorkspaceDesignPaint[] }) {
  if (!paints?.length) {
    return null;
  }
  return (
    <div className="-mt-2 mb-4 space-y-2 rounded-xl bg-[#f7f7f8] p-2 text-xs">
      {paints.map((paint) => (
        <div key={`${paint.sourceIndex}-${paint.kind}`} className="grid grid-cols-[28px_1fr_auto] items-center gap-2">
          <div className="size-7 rounded-md border border-[#e4e4e7]" style={{ background: paint.css || "transparent" }} />
          <div className="min-w-0">
            <div className="truncate font-mono text-[10px] text-[#555]">{paint.css || paint.kind}</div>
            {paint.gradient ? (
              <div className="mt-0.5 text-[10px] text-[#888]">
                {paint.gradient.type} · {paint.gradient.stops.length} stops · from {formatPaintPoint(paint.gradient.from)} to {formatPaintPoint(paint.gradient.to)}
              </div>
            ) : null}
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${paint.enabled ? "bg-[#e8f3ff] text-[#246bfe]" : "bg-[#eeeeef] text-[#888]"}`}>
            {paint.enabled ? "显示" : "隐藏"}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatPaintPoint(point: { x: number; y: number }) {
  return `${Number(point.x.toFixed(2))}, ${Number(point.y.toFixed(2))}`;
}

function DesignLayerTree({
  nodes,
  expandedIds,
  selectedIds,
  onToggle,
  onSelect,
  onContextMenu
}: {
  nodes: DesignLayerTreeNode[];
  expandedIds: string[];
  selectedIds: string[];
  onToggle: (nodeId: string) => void;
  onSelect: (node: DesignNode, append: boolean) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, node: DesignNode) => void;
}) {
  if (nodes.length === 0) {
    return <div className="rounded-xl px-3 py-4 text-xs text-[#888]">没有匹配到图层。</div>;
  }

  const renderNode = (treeNode: DesignLayerTreeNode): ReactNode => {
    const node = treeNode.node;
    const hasChildren = treeNode.children.length > 0;
    const expanded = expandedIds.includes(node.id);
    return (
      <div key={node.id}>
        <button
          type="button"
          onClick={(event) => {
            const append = event.shiftKey || event.metaKey || event.ctrlKey;
            onSelect(node, append);
          }}
          onContextMenu={(event) => onContextMenu(event, node)}
          className={`group flex w-full items-center gap-1 rounded-xl py-2 pr-2 text-left text-sm ${selectedIds.includes(node.id) ? "bg-[#ede7ff] text-[#6d35d8]" : "hover:bg-[#f7f7f8]"}`}
          style={{ paddingLeft: 8 + Math.min(treeNode.depth, 8) * 14 }}
        >
          <span
            role="button"
            tabIndex={-1}
            aria-label={expanded ? "收起图层" : "展开图层"}
            onClick={(event) => {
              event.stopPropagation();
              if (hasChildren) {
                onToggle(node.id);
              }
            }}
            className={`flex size-5 shrink-0 items-center justify-center rounded-md ${hasChildren ? "text-[#777] hover:bg-white" : "text-transparent"}`}
          >
            <ChevronDown className={`size-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`} />
          </span>
          {nodeIcon(node.type)}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {node.locked ? <Lock className="size-3.5 text-[#999]" /> : null}
          {!node.visible ? <EyeOff className="size-3.5 text-[#999]" /> : null}
        </button>
        {hasChildren && expanded ? <div>{treeNode.children.map(renderNode)}</div> : null}
      </div>
    );
  };

  return <>{nodes.map(renderNode)}</>;
}

function nodeIcon(type: DesignNodeType) {
  const className = "size-4 shrink-0";
  if (type === "text") return <Type className={className} />;
  if (type === "table") return <Table2 className={className} />;
  if (type === "image") return <Image className={className} />;
  if (type === "button") return <RectangleHorizontal className={className} />;
  if (type === "frame") return <Frame className={className} />;
  return <Box className={className} />;
}

function buildDesignLayerTree(nodes: DesignNode[], query: string): DesignLayerTreeNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParentId = new Map<string, DesignNode[]>();
  const roots: DesignNode[] = [];

  nodes.forEach((node) => {
    const parentId = node.parentId && nodeById.has(node.parentId) ? node.parentId : "";
    if (!parentId) {
      roots.push(node);
      return;
    }
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(node);
    childrenByParentId.set(parentId, siblings);
  });

  const buildNode = (node: DesignNode, depth: number): DesignLayerTreeNode | null => {
    const children = sortDesignLayerPanelNodes(childrenByParentId.get(node.id) ?? [])
      .map((child) => buildNode(child, depth + 1))
      .filter((child): child is DesignLayerTreeNode => Boolean(child));
    const matched = !normalizedQuery || node.name.toLowerCase().includes(normalizedQuery);
    if (!matched && children.length === 0) {
      return null;
    }
    return {
      node,
      children,
      depth
    };
  };

  const visibleRoots = roots.flatMap((node) => isHiddenRootNode(node, nodes) ? childrenByParentId.get(node.id) ?? [] : [node]);

  return sortDesignLayerPanelNodes(visibleRoots)
    .map((node) => buildNode(node, 0))
    .filter((node): node is DesignLayerTreeNode => Boolean(node));
}

function sortDesignLayerPanelNodes(nodes: DesignNode[]) {
  return [...nodes].sort((first, second) => (second.zIndex ?? 0) - (first.zIndex ?? 0));
}

function cloneDesignNodesWithNewIds(
  nodes: DesignNode[],
  patch: (node: DesignNode, index: number) => Partial<DesignNode>
) {
  const idMap = new Map(nodes.map((node) => [node.id, createId("node")]));
  return nodes.map((node, index) => {
    const nextPatch = patch(node, index);
    const dx = nextPatch.x !== undefined ? nextPatch.x - node.x : 0;
    const dy = nextPatch.y !== undefined ? nextPatch.y - node.y : 0;
    return {
      ...translateDesignNode(node, dx, dy),
      ...nextPatch,
      id: idMap.get(node.id) ?? createId("node"),
      parentId: node.parentId && idMap.has(node.parentId) ? idMap.get(node.parentId) : undefined
    };
  });
}

function createLocalComponentNodes(sourceNodes: DesignNode[]) {
  if (sourceNodes.length === 0) {
    return [];
  }
  const bounds = getNodesBoundsForSelection(sourceNodes) ?? getNodesBounds(sourceNodes);
  const topLevelNodes = sourceNodes.filter((node) => !node.parentId || !sourceNodes.some((candidate) => candidate.id === node.parentId));
  const shouldWrap = topLevelNodes.length > 1;
  const wrapperId = shouldWrap ? createId("node") : "";
  const clonedNodes = cloneDesignNodesWithNewIds(sourceNodes, (node, index) => ({
    x: Math.round(node.x - bounds.x),
    y: Math.round(node.y - bounds.y),
    zIndex: index,
    locked: false,
    visible: true
  }));
  if (!shouldWrap) {
    return clonedNodes.map((node, index) => index === 0 ? { ...node, x: 0, y: 0, parentId: undefined } : node);
  }
  return [
    createNode("container", {
      id: wrapperId,
      name: "组件根节点",
      x: 0,
      y: 0,
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
      fill: "transparent",
      stroke: "transparent",
      strokeWidth: 0,
      text: "",
      zIndex: 0
    }),
    ...clonedNodes.map((node, index) => ({
      ...node,
      parentId: topLevelNodes.some((topNode) => topNode.id === sourceNodes[index]?.id) ? wrapperId : node.parentId,
      zIndex: index + 1
    }))
  ];
}

function createPageTemplateNodes(allNodes: DesignNode[], frame: DesignNode) {
  const frameIds = new Set<string>([frame.id]);
  let changed = true;
  while (changed) {
    changed = false;
    allNodes.forEach((node) => {
      if (node.parentId && frameIds.has(node.parentId) && !frameIds.has(node.id)) {
        frameIds.add(node.id);
        changed = true;
      }
    });
  }
  const sourceNodes = allNodes.filter((node) => frameIds.has(node.id));
  const cloned = cloneDesignNodesWithNewIds(sourceNodes, (node, index) => ({
    x: Math.round(node.x - frame.x),
    y: Math.round(node.y - frame.y),
    zIndex: index,
    locked: false,
    visible: node.visible !== false
  }));
  return cloned.map((node, index) => index === 0
    ? { ...node, x: 0, y: 0, parentId: undefined, width: frame.width, height: frame.height }
    : node);
}

function createPageTemplateNodesFromSelection(allNodes: DesignNode[], topLevelIds: string[], bounds: RectBounds) {
  if (topLevelIds.length === 0) return [];
  const selectedIds = new Set<string>();
  topLevelIds.forEach((id) => {
    selectedIds.add(id);
    allNodes
      .filter((node) => isDescendantOfNode(node, id, allNodes))
      .forEach((node) => selectedIds.add(node.id));
  });
  const sourceNodes = allNodes.filter((node) => selectedIds.has(node.id));
  if (sourceNodes.length === 0) return [];
  const rootId = createId("node");
  const topLevelSet = new Set(topLevelIds);
  const cloned = cloneDesignNodesWithNewIds(sourceNodes, (node, index) => ({
    x: Math.round(node.x - bounds.x),
    y: Math.round(node.y - bounds.y),
    zIndex: index + 1,
    locked: false,
    visible: node.visible !== false
  }));
  return [
    createNode("frame", {
      id: rootId,
      name: "选区模板画板",
      x: 0,
      y: 0,
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
      fill: inferSelectionTemplateBackground(sourceNodes),
      stroke: "transparent",
      strokeWidth: 0,
      text: "",
      zIndex: 0
    }),
    ...cloned.map((node, index) => ({
      ...node,
      parentId: topLevelSet.has(sourceNodes[index]?.id) ? rootId : node.parentId
    }))
  ];
}

function inferSelectionTemplateBackground(nodes: DesignNode[]) {
  const frame = nodes.find((node) => node.type === "frame");
  if (frame?.fill && frame.fill !== "transparent") return frame.fill;
  const largeSurface = [...nodes]
    .filter((node) => node.fill && node.fill !== "transparent")
    .sort((first, second) => (second.width * second.height) - (first.width * first.height))[0];
  return largeSurface?.fill ?? "#f7f7f8";
}

function extractStyleProfileFromNodes(nodes: DesignNode[]): WorkspaceDesignStyleProfile {
  const frame = nodes.find((node) => node.type === "frame") ?? nodes[0];
  const visibleNodes = nodes.filter((node) => node.visible !== false);
  const fills = mostFrequentColors(visibleNodes.map((node) => node.fill));
  const strokes = mostFrequentColors(visibleNodes.map((node) => node.stroke));
  const textColors = mostFrequentColors(visibleNodes.map((node) => node.textColor));
  const textSizes = visibleNodes
    .filter((node) => node.type === "text" || Boolean(node.text))
    .map((node) => node.fontSize)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const buttonNodes = visibleNodes.filter((node) => node.type === "button" || /button|按钮|确认|保存|提交|新增/i.test(`${node.name} ${node.text ?? ""}`));
  const inputNodes = visibleNodes.filter((node) => node.type === "input" || /input|输入|搜索|查询|请选择/i.test(`${node.name} ${node.text ?? ""}`));
  const cardNodes = visibleNodes.filter((node) => ["container", "card", "frame"].includes(node.type) && node.fill && node.fill !== "transparent");
  const childNodes = visibleNodes.filter((node) => node.id !== frame?.id && node.parentId === frame?.id).sort((a, b) => a.y - b.y);
  const verticalGaps = childNodes.slice(1)
    .map((node, index) => Math.round(node.y - (childNodes[index].y + childNodes[index].height)))
    .filter((gap) => gap >= 0 && gap <= 96);
  const pageMargin = frame
    ? Math.round(Math.min(
      ...visibleNodes
        .filter((node) => node.id !== frame.id && node.parentId === frame.id)
        .map((node) => Math.max(0, node.x))
        .filter((value) => Number.isFinite(value))
    ))
    : undefined;
  return {
    platform: frame && frame.width <= 520 ? "mobile" : frame && frame.width >= 960 ? "web" : "unknown",
    colors: {
      primary: pickPrimaryColor([...buttonNodes.map((node) => node.fill), ...fills]),
      background: frame?.fill && frame.fill !== "transparent" ? frame.fill : fills[0],
      surface: fills.find((color) => isLightColor(color)) ?? fills[0],
      border: strokes[0],
      text: textColors[0],
      mutedText: textColors.find((color) => color !== textColors[0])
    },
    typography: {
      title: textSizes.at(-1),
      body: medianNumber(textSizes),
      caption: textSizes[0]
    },
    spacing: {
      pageMargin: Number.isFinite(pageMargin) ? pageMargin : undefined,
      sectionGap: medianNumber(verticalGaps),
      itemGap: medianNumber(verticalGaps.filter((gap) => gap <= 24))
    },
    radius: {
      card: medianNumber(cardNodes.map((node) => node.radius).filter((value) => value > 0)),
      button: medianNumber(buttonNodes.map((node) => node.radius).filter((value) => value > 0)),
      input: medianNumber(inputNodes.map((node) => node.radius).filter((value) => value > 0))
    },
    components: {
      button: buttonNodes.length ? {
        height: medianNumber(buttonNodes.map((node) => node.height)),
        radius: medianNumber(buttonNodes.map((node) => node.radius).filter((value) => value > 0)),
        primaryFill: pickPrimaryColor(buttonNodes.map((node) => node.fill)),
        textColor: mostFrequentColors(buttonNodes.map((node) => node.textColor))[0]
      } : undefined,
      input: inputNodes.length ? {
        height: medianNumber(inputNodes.map((node) => node.height)),
        radius: medianNumber(inputNodes.map((node) => node.radius).filter((value) => value > 0)),
        fill: mostFrequentColors(inputNodes.map((node) => node.fill))[0],
        border: mostFrequentColors(inputNodes.map((node) => node.stroke))[0]
      } : undefined,
      card: cardNodes.length ? {
        radius: medianNumber(cardNodes.map((node) => node.radius).filter((value) => value > 0)),
        fill: mostFrequentColors(cardNodes.map((node) => node.fill))[0],
        border: mostFrequentColors(cardNodes.map((node) => node.stroke))[0],
        padding: Number.isFinite(pageMargin) ? pageMargin : undefined
      } : undefined
    }
  };
}

function mostFrequentColors(values: Array<string | undefined>) {
  const counts = new Map<string, number>();
  values
    .map((value) => normalizeColorToken(value))
    .filter((value): value is string => Boolean(value))
    .forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([color]) => color);
}

function normalizeColorToken(value?: string) {
  if (!value || value === "transparent" || /\b(?:linear|radial|conic)-gradient\(/.test(value)) return "";
  const trimmed = value.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed) || /^rgba?\(/i.test(trimmed) ? trimmed : "";
}

function medianNumber(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
}

function pickPrimaryColor(values: Array<string | undefined>) {
  return mostFrequentColors(values).find((color) => !isLightColor(color) && !isGrayColor(color));
}

function isLightColor(color?: string) {
  const rgb = parseRgbColor(color);
  return rgb ? (rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114) > 235 : false;
}

function isGrayColor(color?: string) {
  const rgb = parseRgbColor(color);
  return rgb ? Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) < 18 : false;
}

function parseRgbColor(color?: string) {
  if (!color) return undefined;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)?.[1];
  if (hex) {
    const normalized = hex.length === 3 ? hex.split("").map((item) => item + item).join("") : hex.slice(0, 6);
    return {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16)
    };
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
  if (!rgb) return undefined;
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
}

function normalizeDesignFile(value: unknown, projectName: string): AiDesignFile {
  const fallback = createInitialDesignFile(projectName);
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const source = value as Partial<AiDesignFile>;
  const pages = Array.isArray(source.pages) && source.pages.length > 0
    ? source.pages
    : fallback.pages;
  const localComponents = Array.isArray(source.importedComponents)
    ? source.importedComponents.filter((component) => component.sourceFileName === LOCAL_COMPONENT_SOURCE_NAME)
    : [];
  const existingLibraries = Array.isArray(source.componentLibraries) ? source.componentLibraries : [];
  const componentLibraries = existingLibraries.length > 0 || localComponents.length === 0
    ? existingLibraries
    : [{
        id: createId("component-library"),
        name: DEFAULT_LOCAL_COMPONENT_LIBRARY_NAME,
        description: "从画布选区创建的本地组件。",
        createdAt: source.updatedAt ?? fallback.updatedAt,
        updatedAt: source.updatedAt ?? fallback.updatedAt
      }];
  const defaultLibraryId = componentLibraries[0]?.id;

  return {
    ...fallback,
    ...source,
    id: source.id ?? fallback.id,
    name: source.name ?? fallback.name,
    prdText: source.prdText ?? fallback.prdText,
    aiSettings: source.aiSettings ?? fallback.aiSettings,
    pages,
    componentLibraries,
    pageTemplates: Array.isArray(source.pageTemplates) ? source.pageTemplates : [],
    importedComponents: Array.isArray(source.importedComponents)
      ? source.importedComponents.map((component) => component.sourceFileName === LOCAL_COMPONENT_SOURCE_NAME && !component.libraryId && defaultLibraryId
        ? { ...component, libraryId: defaultLibraryId }
        : component)
      : [],
    importedAssets: Array.isArray(source.importedAssets) ? source.importedAssets : [],
    updatedAt: source.updatedAt ?? fallback.updatedAt
  };
}

function applyDragPreviewToNodes(
  nodes: DesignNode[],
  dragPreview: { nodeIds: string[]; dx: number; dy: number } | null
) {
  if (!dragPreview || (dragPreview.dx === 0 && dragPreview.dy === 0) || dragPreview.nodeIds.length === 0) {
    return nodes;
  }
  const movingIds = new Set(dragPreview.nodeIds);
  return nodes.map((node) => movingIds.has(node.id)
    ? translateDesignNode(node, dragPreview.dx, dragPreview.dy)
    : node);
}

function hydrateDesignVectorResources(nodes: DesignNode[], resources: Record<string, DesignVectorResource>) {
  if (Object.keys(resources).length === 0) return nodes;
  return nodes.map((node) => {
    let nextNode = node;
    const svgPathResource = node.svgPathAssetRef ? resources[node.svgPathAssetRef] : undefined;
    if (svgPathResource?.svgPath) {
      nextNode = {
        ...nextNode,
        svgPath: svgPathResource.svgPath,
        svgFillRule: svgPathResource.svgFillRule ?? nextNode.svgFillRule
      };
    }
    const svgPathsResource = node.svgPathsAssetRef ? resources[node.svgPathsAssetRef] : undefined;
    if (svgPathsResource?.svgPaths) {
      nextNode = {
        ...nextNode,
        svgPaths: svgPathsResource.svgPaths
      };
    }
    const svgTreeResource = node.svgTreeAssetRef ? resources[node.svgTreeAssetRef] : undefined;
    if (svgTreeResource?.svgTree) {
      nextNode = {
        ...nextNode,
        svgTree: svgTreeResource.svgTree
      };
    }
    const clipPathResource = node.clipPathSvgAssetRef ? resources[node.clipPathSvgAssetRef] : undefined;
    if (clipPathResource?.svgPath && nextNode.clipPath) {
      nextNode = {
        ...nextNode,
        clipPath: {
          ...nextNode.clipPath,
          svgPath: clipPathResource.svgPath
        }
      };
    }
    return nextNode;
  });
}

function translateDesignNode(node: DesignNode, dx: number, dy: number): DesignNode {
  if (dx === 0 && dy === 0) {
    return node;
  }
  return {
    ...node,
    x: node.x + dx,
    y: node.y + dy,
    clipBounds: node.clipBounds ? {
      ...node.clipBounds,
      x: node.clipBounds.x + dx,
      y: node.clipBounds.y + dy
    } : undefined,
    clipPath: node.clipPath ? {
      ...node.clipPath,
      x: node.clipPath.x + dx,
      y: node.clipPath.y + dy
    } : undefined
  };
}

function mergeAgentPageIntoFile(file: AiDesignFile, page?: DesignPage): AiDesignFile {
  if (!page) {
    return file;
  }
  const hasPage = file.pages.some((item) => item.id === page.id);
  return {
    ...file,
    pages: hasPage
      ? file.pages.map((item) => item.id === page.id ? { ...page, schemaLoaded: true, nodeCount: page.nodes.length } : item)
      : [...file.pages, { ...page, schemaLoaded: true, nodeCount: page.nodes.length }]
  };
}

function resolveAgentEventPage(requestPageId: string | undefined, page?: DesignPage) {
  if (!page) {
    return undefined;
  }
  if (!requestPageId || page.id === requestPageId || page.nodes.length > 0) {
    return page;
  }
  return undefined;
}

function extractAiPreviewImages(result: unknown): Array<{ label: string; dataUrl: string }> | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }
  const previews = (result as { previews?: unknown }).previews;
  if (!Array.isArray(previews)) {
    return undefined;
  }
  const images = previews
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as { label?: unknown; dataUrl?: unknown };
      if (typeof record.dataUrl !== "string" || !record.dataUrl.startsWith("data:image/")) return null;
      return {
        label: typeof record.label === "string" ? record.label : "画板预览",
        dataUrl: record.dataUrl
      };
    })
    .filter((item): item is { label: string; dataUrl: string } => Boolean(item));
  return images.length > 0 ? images : undefined;
}

function preserveLoadedDesignPages(nextFile: AiDesignFile, currentFile: AiDesignFile): AiDesignFile {
  const currentById = new Map(currentFile.pages.map((page) => [page.id, page]));
  return {
    ...nextFile,
    pages: nextFile.pages.map((page) => {
      const current = currentById.get(page.id);
      if (page.nodes.length > 0 || !current || current.nodes.length === 0) {
        return page;
      }
      return {
        ...page,
        nodes: current.nodes,
        schemaLoaded: current.schemaLoaded,
        nodeCount: page.nodeCount ?? current.nodeCount ?? current.nodes.length
      };
    })
  };
}

function createInitialDesignFile(projectName: string): AiDesignFile {
  const now = new Date().toISOString();
  return {
    id: createId("design"),
    name: `${projectName} AI Design`,
    prdText: "这里承载当前项目的 PRD 草稿。后续 AI 会根据 PRD 生成页面清单、UI Schema 和可编辑画布。",
    aiSettings: {
      systemPrompt: ""
    },
    updatedAt: now,
    componentLibraries: [],
    pageTemplates: [],
    importedComponents: [],
    importedAssets: [],
    pages: [
      {
        id: createId("page"),
        name: "页面 1",
        nodes: [
          createNode("frame", { x: 520, y: 260, name: "分区 1", width: 360, height: 210, fill: "#f2f2f3", text: "分区 1" }),
          createNode("container", { x: 615, y: 325, name: "容器 3", width: 190, height: 130, fill: "#c52b32", stroke: "#c52b32", text: "" }),
          createNode("container", { x: 960, y: 290, name: "容器 4", width: 118, height: 150, fill: "#ffffff", stroke: "#ffffff", text: "" }),
          createNode("table", { x: 520, y: 670, name: "表格/多内容/两行", width: 520, height: 270, fill: "#ffffff", text: "" })
        ]
      }
    ]
  };
}

function createNode(type: DesignNodeType, overrides: Partial<DesignNode> = {}): DesignNode {
  const base: DesignNode = {
    id: createId("node"),
    type,
    name: defaultNodeName(type),
    x: 420,
    y: 320,
    width: type === "text" ? 220 : type === "table" ? 520 : type === "input" ? 260 : 180,
    height: type === "text" ? 64 : type === "table" ? 270 : type === "button" ? 64 : 120,
    fill: type === "button" ? "#246bfe" : type === "text" ? "transparent" : "#ffffff",
    stroke: type === "text" ? "transparent" : "#d8d8dd",
    radius: type === "button" || type === "input" ? 14 : 8,
    text: defaultNodeText(type),
    textColor: type === "button" ? "#ffffff" : "#171717",
    fontSize: type === "text" ? 22 : 14,
    textVerticalAlign: type === "text" ? "top" : "middle",
    fontFamily: "PingFang SC",
    fontWeight: type === "button" ? 600 : 400,
    letterSpacing: 0,
    fontStretch: "normal",
    underline: false,
    strikethrough: false,
    textTransform: "none",
    visible: true,
    locked: false
  };
  return { ...base, ...overrides };
}

function defaultNodeName(type: DesignNodeType) {
  return {
    frame: "Frame",
    container: "Container",
    text: "Text",
    button: "Button",
    input: "Input",
    table: "Table",
    card: "Card",
    image: "Image"
  }[type];
}

function defaultNodeText(type: DesignNodeType) {
  return {
    frame: "Frame",
    container: "Container",
    text: "输入文字",
    button: "确认",
    input: "请输入内容",
    table: "",
    card: "Card",
    image: ""
  }[type];
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeColor(value: string) {
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return value;
  }
  const rgba = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i.exec(value.trim());
  if (rgba) {
    return `#${[rgba[1], rgba[2], rgba[3]].map((channel) => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, "0")).join("")}`;
  }
  return "#ffffff";
}

function normalizeRotationInput(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0001) {
    return 0;
  }
  return Number(value.toFixed(4));
}

function parseEditableGradientPaint(value: string): {
  type: "linear" | "radial";
  angle?: number;
  center?: { x: number; y: number };
  stops: Array<{ color: string; position: number }>;
} | undefined {
  const paint = getFirstCanvasPaintLayer(value);
  if (!paint?.startsWith("linear-gradient") && !paint?.startsWith("radial-gradient")) {
    return undefined;
  }
  const args = extractCssFunctionArgs(paint);
  if (args.length === 0) {
    return undefined;
  }
  if (paint.startsWith("radial-gradient")) {
    const firstArg = args[0] ?? "";
    const hasShapeArg = isCssRadialGradientShapeArg(firstArg);
    const stops = (hasShapeArg ? args.slice(1) : args)
      .map(parseCssColorStop)
      .filter((stop): stop is { color: string; position: number } => Boolean(stop));
    return {
      type: "radial",
      center: parseCssRadialGradientCenter(firstArg),
      stops: ensureEditableGradientStops(stops)
    };
  }
  const firstArg = args[0] ?? "";
  const hasDirectionArg = isCssLinearGradientDirectionArg(firstArg);
  const stops = (hasDirectionArg ? args.slice(1) : args)
    .map(parseCssColorStop)
    .filter((stop): stop is { color: string; position: number } => Boolean(stop));
  return {
    type: "linear",
    angle: parseCssLinearGradientAngle(firstArg),
    stops: ensureEditableGradientStops(stops)
  };
}

function ensureEditableGradientStops(stops: Array<{ color: string; position: number }>) {
  if (stops.length >= 2) {
    return stops;
  }
  if (stops.length === 1) {
    return [stops[0], { color: "#ffffff", position: 1 }];
  }
  return [{ color: "#e2e4ff", position: 0 }, { color: "rgba(255, 255, 255, 0)", position: 1 }];
}

function buildEditableLinearGradient(angle: number, first: { color: string; position: number }, last: { color: string; position: number }) {
  return `linear-gradient(${normalizeEditableGradientAngle(angle)}deg, ${formatEditableGradientStop(first)}, ${formatEditableGradientStop(last)})`;
}

function buildEditableRadialGradient(center: { x: number; y: number }, first: { color: string; position: number }, last: { color: string; position: number }) {
  return `radial-gradient(circle at ${formatEditableGradientPercent(center.x)}% ${formatEditableGradientPercent(center.y)}%, ${formatEditableGradientStop(first)}, ${formatEditableGradientStop(last)})`;
}

function formatEditableGradientStop(stop: { color: string; position: number }) {
  return `${stop.color} ${formatEditableGradientPercent(stop.position)}%`;
}

function formatEditableGradientPercent(value: number) {
  const percent = clampGradientPosition(value) * 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/\.?0+$/, "");
}

function normalizeEditableGradientAngle(angle: number) {
  return Number.isFinite(angle) ? Math.round((((angle % 360) + 360) % 360) * 100) / 100 : 180;
}

function clampGradientPosition(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
