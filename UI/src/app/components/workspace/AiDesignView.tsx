import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
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
  MousePointer2,
  PanelLeft,
  Play,
  Plus,
  RectangleHorizontal,
  Search,
  Send,
  Share2,
  Settings2,
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
import { getProject } from "../../utils/storage";
import { toast } from "sonner";
import {
  getAiDesignFile,
  getAiDesignPage,
  importAiDesignFile,
  runAiDesignAgent,
  saveAiDesignFile,
  updateWorkspaceLlmSettings,
  type WorkspaceDesignFile
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
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
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
  visible: boolean;
  locked: boolean;
  imageUrl?: string;
  fillImageUrl?: string;
  fillImageMode?: "stretch" | "fill" | "fit" | "tile";
  fillImageScale?: number;
  svgPath?: string;
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
  }>;
  svgTree?: DesignSvgNode;
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
  nodeCount: number;
  nodes: DesignNode[];
}

interface ImportedDesignAsset {
  id: string;
  name: string;
  sourceFileName: string;
  type: "image";
  mimeType: string;
  url: string;
  sourceRef?: string;
  width?: number;
  height?: number;
}

type AiDesignFile = WorkspaceDesignFile;

interface AiDesignChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
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

interface DesignRenderTreeNode {
  node: DesignNode;
  children: DesignRenderTreeNode[];
}

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
  const [aiSettingsOpen, setAiSettingsOpen] = useState(true);
  const [aiSystemPrompt, setAiSystemPrompt] = useState(project?.systemPrompt ?? "");
  const [aiProvider, setAiProvider] = useState<"openai" | "openai-compatible">(project?.llmSettings?.provider ?? "openai-compatible");
  const [aiBaseUrl, setAiBaseUrl] = useState(project?.llmSettings?.baseUrl ?? "");
  const [aiModel, setAiModel] = useState(project?.llmSettings?.stageModelRouting?.design ?? project?.llmSettings?.stageModelRouting?.structure ?? "");
  const [aiApiKey, setAiApiKey] = useState("");
  const [savingAiSettings, setSavingAiSettings] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 800 });
  const [selectionRect, setSelectionRect] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const designImportInputRef = useRef<HTMLInputElement | null>(null);
  const applyingRemoteDesignRef = useRef(false);
  const saveDesignTimerRef = useRef<number | null>(null);
  const loadedPageIdsRef = useRef<Set<string>>(new Set(file.pages.filter((page) => page.nodes.length > 0).map((page) => page.id)));
  const nodeDragRef = useRef<{
    nodeIds: string[];
    startX: number;
    startY: number;
    originals: Array<{ id: string; x: number; y: number }>;
  } | null>(null);
  const panDragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const selectionDragRef = useRef<{
    append: boolean;
  } | null>(null);
  const resizeDragRef = useRef<ResizeSession | null>(null);

  const selectedPage = file.pages.find((page) => page.id === selectedPageId) ?? file.pages[0]!;
  const selectedNode = selectedPage.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedNodes = selectedPage.nodes.filter((node) => selectedNodeIds.includes(node.id));
  const selectionBounds = getNodesBoundsForSelection(selectedNodes);
  const visibleNodes = selectedPage.nodes.filter((node) => node.visible);
  const sceneContentBounds = useMemo(() => expandBounds(getNodesBounds(visibleNodes), 360), [visibleNodes]);
  const visibleSceneBounds = useMemo(() => ({
    x: -pan.x / zoom,
    y: -pan.y / zoom,
    width: viewportSize.width / zoom,
    height: viewportSize.height / zoom
  }), [pan.x, pan.y, viewportSize.height, viewportSize.width, zoom]);
  const minimapBounds = useMemo(() => unionBounds(sceneContentBounds, visibleSceneBounds), [sceneContentBounds, visibleSceneBounds]);
  const renderedNodes = useMemo(() => {
    if (visibleNodes.length < 500) {
      return visibleNodes;
    }

    const padding = 960 / zoom;
    const sceneViewport = {
      x: visibleSceneBounds.x - padding,
      y: visibleSceneBounds.y - padding,
      width: visibleSceneBounds.width + padding * 2,
      height: visibleSceneBounds.height + padding * 2
    };

    return visibleNodes.filter((node) => selectedNodeIds.includes(node.id) || rectsIntersect(sceneViewport, nodeToBounds(node)));
  }, [selectedNodeIds, visibleNodes, visibleSceneBounds, zoom]);
  const canvasRenderedNodes = useMemo(() => renderedNodes.filter((node) => !shouldRenderNodeWithDomSvg(node)), [renderedNodes]);
  const domSvgRenderedNodes = useMemo(() => renderedNodes.filter(shouldRenderNodeWithDomSvg), [renderedNodes]);
  const layerTree = useMemo(() => buildDesignLayerTree(selectedPage.nodes, layerQuery), [layerQuery, selectedPage.nodes]);

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

  const updateFile = (updater: (current: AiDesignFile) => AiDesignFile) => {
    setFile((current) => updater(current));
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

  const runDesignAgentMessage = async (message: string) => {
    const content = message.trim();
    if (!content || aiBusy) {
      return;
    }
    setAiInput("");
    setAiBusy(true);
    const userMessage: AiDesignChatMessage = { id: createId("ai-message"), role: "user", content };
    setAiMessages((current) => [...current, userMessage]);
    try {
      const response = await runAiDesignAgent(projectId, {
        message: content,
        pageId: selectedPageId,
        systemPrompt: aiSystemPrompt
      });
      const nextFile = mergeAgentPageIntoFile(
        preserveLoadedDesignPages(normalizeDesignFile(response.file, project?.name ?? "未命名设计"), file),
        response.page
      );
      setFile(nextFile);
      if (response.page) {
        loadedPageIdsRef.current.add(response.page.id);
      }
      if (response.selectedPageId) {
        const nextPage = response.page ?? nextFile.pages.find((page) => page.id === response.selectedPageId);
        selectDesignPage(response.selectedPageId, nextPage?.nodes ?? [], { replace: false });
      }
      setLeftTab("ai");
      setAiMessages((current) => [
        ...current,
        { id: createId("ai-message"), role: "assistant", content: response.reply }
      ]);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "AI Design Agent 执行失败";
      setAiMessages((current) => [
        ...current,
        { id: createId("ai-message"), role: "assistant", content: messageText }
      ]);
      toast.error(messageText);
    } finally {
      setAiBusy(false);
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

  const insertImportedComponent = (component: ImportedDesignComponent) => {
    const minX = Math.min(...component.nodes.map((node) => node.x), 0);
    const minY = Math.min(...component.nodes.map((node) => node.y), 0);
    const nextNodes = cloneDesignNodesWithNewIds(component.nodes, (node, index) => ({
      name: index === 0 ? component.name : node.name,
      x: node.x - minX + 360 + index * 4,
      y: node.y - minY + 260 + index * 4,
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
        insertImportedComponent(payload.component);
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

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    if (tool === "hand" || isSpacePressed) {
      panDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: pan.x,
        originY: pan.y
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
    const hitNode = findTopDesignNodeAtPoint(visibleNodes, scenePoint);
    if (hitNode && !hitNode.locked) {
      const append = event.shiftKey || event.metaKey || event.ctrlKey;
      const nextSelection = append
        ? selectedNodeIds.includes(hitNode.id)
          ? selectedNodeIds.filter((id) => id !== hitNode.id)
          : [...selectedNodeIds, hitNode.id]
        : selectedNodeIds.includes(hitNode.id)
          ? selectedNodeIds
          : [hitNode.id];
      selectNodes(nextSelection, hitNode.id);
      const dragIds = (selectedNodeIds.includes(hitNode.id) && !append ? selectedNodeIds : nextSelection)
        .map((id) => selectedPage.nodes.find((item) => item.id === id))
        .filter((item): item is DesignNode => Boolean(item) && !item.locked);
      nodeDragRef.current = {
        nodeIds: dragIds.map((item) => item.id),
        startX: scenePoint.x,
        startY: scenePoint.y,
        originals: dragIds.map((item) => ({ id: item.id, x: item.x, y: item.y }))
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    selectionDragRef.current = {
      append: event.shiftKey || event.metaKey || event.ctrlKey
    };
    setSelectionRect({ start: scenePoint, current: scenePoint });
    if (!selectionDragRef.current.append) {
      selectNodes([]);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panDragRef.current) {
      setPan({
        x: panDragRef.current.originX + event.clientX - panDragRef.current.startX,
        y: panDragRef.current.originY + event.clientY - panDragRef.current.startY
      });
      return;
    }

    if (nodeDragRef.current) {
      const scenePoint = getScenePoint(event.clientX, event.clientY);
      const deltaX = scenePoint.x - nodeDragRef.current.startX;
      const deltaY = scenePoint.y - nodeDragRef.current.startY;
      const originals = nodeDragRef.current.originals;
      updateSelectedPage((page) => ({
        ...page,
        nodes: page.nodes.map((node) => {
          const original = originals.find((item) => item.id === node.id);
          return original ? {
            ...node,
            x: Math.round(original.x + deltaX),
            y: Math.round(original.y + deltaY)
          } : node;
        })
      }));
      return;
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
      setSelectionRect({
        ...selectionRect,
        current: getScenePoint(event.clientX, event.clientY)
      });
    }
  };

  const handleCanvasPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (selectionDragRef.current && selectionRect) {
      const rect = normalizeRect(selectionRect.start, selectionRect.current);
      if (rect.width > 3 || rect.height > 3) {
        const matchedIds = visibleNodes
          .filter((node) => rectsIntersect(rect, nodeToBounds(node)) && !node.locked)
          .map((node) => node.id);
        selectNodes(selectionDragRef.current.append ? [...selectedNodeIds, ...matchedIds] : matchedIds);
      }
    }
    panDragRef.current = null;
    nodeDragRef.current = null;
    resizeDragRef.current = null;
    selectionDragRef.current = null;
    setSelectionRect(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleNodePointerDown = (event: ReactPointerEvent<HTMLDivElement>, node: DesignNode) => {
    event.stopPropagation();
    if (node.locked) {
      selectNodes([node.id]);
      return;
    }
    const append = event.shiftKey || event.metaKey || event.ctrlKey;
    const nextSelection = append
      ? selectedNodeIds.includes(node.id)
        ? selectedNodeIds.filter((id) => id !== node.id)
        : [...selectedNodeIds, node.id]
      : selectedNodeIds.includes(node.id)
        ? selectedNodeIds
        : [node.id];
    selectNodes(nextSelection, node.id);
    const dragIds = (selectedNodeIds.includes(node.id) && !append ? selectedNodeIds : nextSelection)
      .map((id) => selectedPage.nodes.find((item) => item.id === id))
      .filter((item): item is DesignNode => Boolean(item) && !item.locked);
    const scenePoint = getScenePoint(event.clientX, event.clientY);
    nodeDragRef.current = {
      nodeIds: dragIds.map((item) => item.id),
      startX: scenePoint.x,
      startY: scenePoint.y,
      originals: dragIds.map((item) => ({ id: item.id, x: item.x, y: item.y }))
    };
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

  return (
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
                <div className="space-y-1">
                  {file.pages.map((page) => (
                    <div
                      key={page.id}
                      className={`group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ${page.id === selectedPageId ? "bg-[#f0f0f2] font-semibold" : "hover:bg-[#f7f7f8]"}`}
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
              <div className="min-h-0 flex-1 overflow-y-auto p-3" style={{ height: '50%', overflow: 'auto' }}>
                <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                  <span>图层</span>
                  <Layers className="size-4 text-[#888]" />
                </div>
                <div className="space-y-1">
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
              {file.importedComponents?.length ? (
                <div className="mt-6">
                  <div className="mb-3 text-sm font-semibold">导入组件</div>
                  <div className="space-y-2">
                    {file.importedComponents.map((component) => (
                      <button
                        key={component.id}
                        type="button"
                        draggable
                        onDragStart={(event) => startDragPayload(event, { kind: "component", component })}
                        onClick={() => insertImportedComponent(component)}
                        className="w-full rounded-2xl border border-[#ececef] bg-white p-3 text-left transition hover:border-[#246bfe] hover:bg-[#f7faff]"
                      >
                        <DesignMiniPreview nodes={component.nodes} className="mb-3 h-[112px]" />
                        <div className="flex items-center gap-2">
                          <Component className="size-4 text-[#6d35d8]" />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{component.name}</span>
                        </div>
                        <div className="mt-1 truncate text-xs text-[#777]">
                          {component.sourceFileName} · {component.nodeCount} 个节点
                        </div>
                        <div className="mt-2 max-h-24 overflow-y-auto rounded-xl bg-[#f8f8fa] px-2 py-1">
                          {component.nodes.map((node) => (
                            <div key={node.id} className="flex items-center gap-2 py-1 text-xs text-[#666]">
                              {nodeIcon(node.type)}
                              <span className="min-w-0 flex-1 truncate">{node.name}</span>
                            </div>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-6">
                <div className="mb-3 text-sm font-semibold">页面预览</div>
                <div className="space-y-3">
                  {file.pages.map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => void insertImportedPage(page)}
                      className="w-full rounded-2xl border border-[#ececef] bg-white p-3 text-left transition hover:border-[#246bfe] hover:bg-[#f7faff]"
                    >
                      <DesignMiniPreview nodes={page.nodes} className="mb-3 h-[132px]" />
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 text-[#246bfe]" />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{page.name}</span>
                      </div>
                      <div className="mt-1 text-xs text-[#777]">{page.nodeCount ?? page.nodes.length} 个节点，点击复制成新页面</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {leftTab === "assets" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mb-2 text-sm font-semibold">图片资源</div>
              <div className="mb-4 text-xs leading-5 text-[#777]">Sketch 里解析出的 bitmap / assets 会显示在这里。点击插入，或拖到画布指定位置。</div>
              {file.importedAssets?.length ? (
                <div className="grid grid-cols-2 gap-3">
                  {file.importedAssets.map((asset) => (
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

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <div className="space-y-3">
                  {aiMessages.map((message) => (
                    <div key={message.id} className={`rounded-2xl px-3 py-2 text-sm leading-6 ${message.role === "user" ? "ml-6 bg-[#246bfe] text-white" : "mr-6 border border-[#ececef] bg-white text-[#333]"}`}>
                      <div className="mb-1 text-[11px] font-semibold opacity-70">{message.role === "user" ? "你" : "AI Design Agent"}</div>
                      <div className="whitespace-pre-wrap">{message.content}</div>
                    </div>
                  ))}
                  {aiBusy ? (
                    <div className="mr-6 rounded-2xl border border-[#ececef] bg-white px-3 py-2 text-sm text-[#777]">Agent 正在处理页面...</div>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-[#eeeeef] bg-white p-3">
                <Textarea
                  value={aiInput}
                  onChange={(event) => setAiInput(event.target.value)}
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
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleCanvasDrop}
            onWheel={handleCanvasWheel}
          >
            <CanvasDesignRenderer nodes={canvasRenderedNodes} width={viewportSize.width} height={viewportSize.height} pan={pan} zoom={zoom} />
            <DomSvgDesignRenderer nodes={domSvgRenderedNodes} pan={pan} zoom={zoom} />
            {loadingPageId === selectedPageId ? (
              <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full border border-[#e4e4e7] bg-white/90 px-4 py-2 text-xs font-semibold text-[#555] shadow-sm">
                正在加载当前页面 schema...
              </div>
            ) : null}
            <div
              className="pointer-events-none absolute origin-top-left"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
              }}
            >
              {showSelectionBounds ? (
                <SelectionBoundsView
                  bounds={selectionBounds}
                  onResizePointerDown={handleResizePointerDown}
                />
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
                <div className="divide-y divide-[#eeeeef]">
                  <InspectorSection title="图层">
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
                    </div>
                  </InspectorSection>
                  <InspectorSection title="外观">
                    <ColorField label="填充" value={selectedNode.fill} onChange={(value) => updateNode(selectedNode.id, { fill: value })} />
                    <ColorField label="描边" value={selectedNode.stroke} onChange={(value) => updateNode(selectedNode.id, { stroke: value })} />
                    <NumberField label="圆角" value={selectedNode.radius} onChange={(value) => updateNode(selectedNode.id, { radius: value })} />
                  </InspectorSection>
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

const canvasImageCache = new Map<string, { image: HTMLImageElement; loaded: boolean; failed: boolean }>();

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
    [...nodes]
      .sort((first, second) => (first.zIndex ?? 0) - (second.zIndex ?? 0))
      .forEach((node) => drawDesignNodeOnCanvas(context, node, () => setImageRevision((current) => current + 1)));
    context.restore();
  }, [height, nodes, pan.x, pan.y, width, zoom]);

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
  const baseStyle: CSSProperties = {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    background: node.svgPath ? "transparent" : node.fill || "transparent",
    borderColor: selected ? "#246bfe" : node.stroke,
    borderWidth: selected ? Math.max(1, node.strokeWidth ?? 1) : node.svgPath || node.stroke === "transparent" ? 0 : Math.max(0, node.strokeWidth ?? 1),
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
    transform: getDesignNodeCssTransform(node),
    transformOrigin: "center center",
    boxShadow: node.shadow || undefined,
    zIndex: node.zIndex,
    clipPath: getNodeClipPath(node),
    overflow: node.type === "text" && importedSketchNode ? "visible" : undefined
  };

  return (
    <div
      className={`absolute select-none ${selected ? "ring-4 ring-[#246bfe]/20" : ""}`}
      style={baseStyle}
      onPointerDown={onPointerDown}
    >
      <div className={`pointer-events-none flex h-full w-full items-center justify-center text-center font-medium ${importedSketchText ? "overflow-visible" : "overflow-hidden"} ${node.type === "image" || importedSketchNode ? "p-0" : "p-3"}`}>
        {node.svgPath ? (
          <svg
            className="h-full w-full overflow-visible"
            viewBox={`0 0 ${Math.max(1, node.width)} ${Math.max(1, node.height)}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d={node.svgPath}
              fill={getSvgPaint(node.fill, "transparent")}
              fillRule={node.svgFillRule ?? "nonzero"}
              stroke={getSvgPaint(node.stroke, "none")}
              strokeWidth={node.stroke === "transparent" ? 0 : Math.max(0, node.strokeWidth ?? 1)}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : node.type === "table" && !importedSketchNode ? (
          <div className="h-full w-full overflow-hidden rounded bg-white text-left text-[13px] text-[#333]">
            <div className="grid grid-cols-3 bg-[#eef1f7] px-3 py-2 font-semibold">
              <span>日期</span>
              <span>姓名</span>
              <span>状态</span>
            </div>
            {[1, 2, 3, 4].map((row) => (
              <div key={row} className="grid grid-cols-3 border-t border-[#e5e7eb] px-3 py-2">
                <span>2026-05-03</span>
                <span>需求 {row}</span>
                <span>进行中</span>
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
          <span className={`${importedSketchText ? "overflow-visible" : "max-h-full overflow-hidden"} w-full whitespace-pre-wrap break-words ${importedSketchNode ? "px-0.5" : ""}`}>{node.text || (importedSketchNode ? "" : node.name)}</span>
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
              background: node.svgPath ? "transparent" : node.type === "image" && node.imageUrl ? `url(${node.imageUrl}) center / 100% 100% no-repeat` : node.fill || "transparent",
              borderColor: node.stroke,
              borderWidth: node.svgPath || node.stroke === "transparent" ? 0 : Math.max(0, node.strokeWidth ?? 1),
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
              transform: getDesignNodeCssTransform(node),
              transformOrigin: "center center",
              boxShadow: node.shadow || undefined,
              zIndex: node.zIndex,
              clipPath: getNodeClipPath(node)
            }}
          >
            {node.svgPath ? (
              <svg
                className="h-full w-full overflow-visible"
                viewBox={`0 0 ${Math.max(1, node.width)} ${Math.max(1, node.height)}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d={node.svgPath}
                  fill={getSvgPaint(node.fill, "transparent")}
                  fillRule={node.svgFillRule ?? "nonzero"}
                  stroke={getSvgPaint(node.stroke, "none")}
                  strokeWidth={node.stroke === "transparent" ? 0 : Math.max(0, node.strokeWidth ?? 1)}
                  strokeDasharray={node.strokeDashPattern?.join(" ")}
                  strokeLinecap={node.strokeLineCap ?? "butt"}
                  strokeLinejoin={node.strokeLineJoin ?? "miter"}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
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
    overflow: imageNode || node.fillImageUrl || node.clipPath || node.clipBounds || visualRadius > 0 ? "hidden" : "visible",
    ...backgroundStyle,
    borderColor: node.stroke,
    borderStyle: node.stroke !== "transparent" && !node.svgTree && !node.svgPath && !node.svgPaths?.length ? "solid" : undefined,
    borderWidth: node.svgTree || node.svgPath || node.svgPaths?.length || node.stroke === "transparent" ? 0 : Math.max(0, node.strokeWidth ?? 1),
    borderRadius: visualRadius,
    boxShadow: node.shadow || undefined,
    opacity: node.opacity ?? 1,
    transform: getDesignNodeCssTransform(node),
    transformOrigin: "center center",
    zIndex: node.zIndex,
    clipPath: imageClip ? undefined : getNodeClipPath(node),
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

function getDomSvgNodeBackgroundStyle(node: DesignNode, parentNode?: DesignNode): CSSProperties {
  const baseFill = node.svgTree || node.svgPath || node.svgPaths?.length
    ? "transparent"
    : isTransparentPaint(node.fill)
      ? getImportedTransparentFallbackFill(node, parentNode) ?? "transparent"
      : node.fill;
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
  const paints = paths.map((path, index) => ({
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
      {paths.map((path, index) => (
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
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function renderDesignSvgTreeNode(owner: DesignNode, svgNode: DesignSvgNode, keyPath: string): ReactNode {
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
  if (vectorPaths.length > 0) {
    return vectorPaths.map((path, index) => {
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
    const paint = value?.trim();
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
  const angle = firstArg.endsWith("deg") ? Number(firstArg.replace("deg", "")) : 180;
  const stops = (firstArg.endsWith("deg") ? args.slice(1) : args).map(parseCssColorStop);
  const radians = (angle - 90) * Math.PI / 180;
  const x = Math.cos(radians) / 2;
  const y = Math.sin(radians) / 2;
  return `<linearGradient${serializeSvgAttributes({ id, x1: 0.5 - x, y1: 0.5 - y, x2: 0.5 + x, y2: 0.5 + y })}>${stops.map((stop) => `<stop${serializeSvgAttributes({ offset: `${Math.round(stop.position * 100)}%`, "stop-color": stop.color })}/>`).join("")}</linearGradient>`;
}

function buildSvgRadialGradientDefinition(id: string, value: string) {
  const stops = extractCssFunctionArgs(value).map(parseCssColorStop);
  return `<radialGradient${serializeSvgAttributes({ id, cx: "50%", cy: "50%", r: "70%" })}>${stops.map((stop) => `<stop${serializeSvgAttributes({ offset: `${Math.round(stop.position * 100)}%`, "stop-color": stop.color })}/>`).join("")}</radialGradient>`;
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

function getNodeTextDecoration(node: DesignNode) {
  return [
    node.underline ? "underline" : "",
    node.strikethrough ? "line-through" : ""
  ].filter(Boolean).join(" ") || undefined;
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
  context.filter = node.blurRadius ? `blur(${node.blurRadius}px)` : "none";

  if (node.svgPath) {
    drawSvgPathNode(context, node);
  } else if (node.type === "image" && node.imageUrl) {
    drawImageNode(context, node, requestRedraw);
  } else {
    drawBoxNode(context, node, requestRedraw);
    if (node.text) {
      if (node.textRuns?.length) {
        drawRichTextNode(context, node);
      } else {
        drawTextNode(context, node, node.text);
      }
    }
  }

  context.restore();
}

function applyCanvasClip(context: CanvasRenderingContext2D, node: DesignNode) {
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
}

function drawSvgPathNode(context: CanvasRenderingContext2D, node: DesignNode) {
  try {
    const path = new Path2D(node.svgPath);
    const fill = getCanvasFillStyle(context, node, node.fill);
    const stroke = getCanvasStrokeStyle(context, node);
    drawPathShadowLayers(context, path, node, fill || getCanvasPaint(node.fill) || "#ffffff");
    if (fill) {
      context.fillStyle = fill;
      context.fill(path, node.svgFillRule === "evenodd" ? "evenodd" : "nonzero");
    }
    if (stroke && (node.strokeWidth ?? 0) > 0) {
      applyCanvasStrokeStyle(context, node);
      context.strokeStyle = stroke;
      context.stroke(path);
    }
  } catch {
    drawBoxNode(context, node);
  }
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
  const fill = getCanvasFillStyle(context, node, node.fill);
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
  drawPathShadowLayers(context, path, node, fill || getCanvasPaint(node.fill) || "#ffffff");
  if (node.fillImageUrl) {
    drawFillImage(context, node, path, requestRedraw);
  }
  if (fill) {
    context.fillStyle = fill;
    context.fill(path);
  }
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
  if (shadows.length === 0) {
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
  const lines = wrapCanvasText(context, transformTextContent(text, node.textTransform), Math.max(8, node.width - 12), font);
  context.fillStyle = fill;
  context.font = font;
  if ("letterSpacing" in context) {
    (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = node.letterSpacing ? `${node.letterSpacing}px` : "0px";
  }
  context.textAlign = node.textAlign === "right" ? "right" : node.textAlign === "center" ? "center" : "left";
  context.textBaseline = "top";
  const x = node.textAlign === "right" ? node.width - 6 : node.textAlign === "center" ? node.width / 2 : 6;
  const totalHeight = lines.length * lineHeight;
  const startY = Math.max(0, Math.min(node.height - lineHeight, node.height / 2 - totalHeight / 2));
  lines.forEach((line, index) => {
    const y = startY + index * lineHeight;
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
  let cursorX = node.textAlign === "right" ? node.width - 6 : node.textAlign === "center" ? node.width / 2 : 6;
  let cursorY = Math.max(0, node.height / 2 - baseLineHeight / 2);
  const alignOffset = node.textAlign === "center" ? measureRichTextLine(context, node, getFirstRichTextLine(runs)) / 2 : 0;
  if (node.textAlign === "center") {
    cursorX -= alignOffset;
  }

  runs.forEach((run) => {
    const segments = run.text.split("\n");
    segments.forEach((segment, segmentIndex) => {
      if (segmentIndex > 0) {
        cursorX = node.textAlign === "right" ? node.width - 6 : node.textAlign === "center" ? node.width / 2 - alignOffset : 6;
        cursorY += baseLineHeight;
      }
      if (!segment) {
        return;
      }
      const font = getCanvasFont({
        ...node,
        fontFamily: run.fontFamily ?? node.fontFamily,
        fontSize: run.fontSize ?? node.fontSize,
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
      const textMetrics = context.measureText(renderedSegment);
      if (run.underline || run.strikethrough || node.underline || node.strikethrough) {
        drawCanvasTextSegmentDecorations(context, {
          x: cursorX,
          y: cursorY,
          width: textMetrics.width,
          fontSize: run.fontSize ?? node.fontSize,
          underline: Boolean(run.underline || node.underline),
          strikethrough: Boolean(run.strikethrough || node.strikethrough)
        });
      }
      cursorX += textMetrics.width;
    });
  });

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
  if (!paint || paint === "transparent" || paint.startsWith("linear-gradient") || paint.startsWith("radial-gradient") || paint.startsWith("url(")) {
    return "";
  }
  return paint;
}

function getCanvasStrokeStyle(context: CanvasRenderingContext2D, node: DesignNode): string | CanvasGradient {
  const stroke = node.stroke?.trim();
  if (!stroke || stroke === "transparent" || stroke.startsWith("url(")) {
    return "";
  }
  if (stroke.startsWith("linear-gradient")) {
    return createCanvasLinearGradient(context, node, stroke) || "";
  }
  if (stroke.startsWith("radial-gradient")) {
    return createCanvasRadialGradient(context, node, stroke) || "";
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
  const paint = value?.trim();
  if (!paint || paint === "transparent" || paint.startsWith("url(")) {
    return "";
  }
  if (paint.startsWith("linear-gradient")) {
    return createCanvasLinearGradient(context, node, paint) || "";
  }
  if (paint.startsWith("radial-gradient")) {
    return createCanvasRadialGradient(context, node, paint) || "";
  }
  return paint;
}

function createCanvasLinearGradient(context: CanvasRenderingContext2D, node: DesignNode, value: string) {
  const args = extractCssFunctionArgs(value);
  if (args.length < 2) {
    return undefined;
  }
  const firstArg = args[0];
  const angle = firstArg.endsWith("deg") ? Number(firstArg.replace("deg", "")) : 180;
  const stops = (firstArg.endsWith("deg") ? args.slice(1) : args).map(parseCssColorStop).filter(Boolean) as Array<{ color: string; position: number }>;
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
  stops.forEach((stop) => gradient.addColorStop(stop.position, stop.color));
  return gradient;
}

function createCanvasRadialGradient(context: CanvasRenderingContext2D, node: DesignNode, value: string) {
  const stops = extractCssFunctionArgs(value).map(parseCssColorStop).filter(Boolean) as Array<{ color: string; position: number }>;
  if (stops.length === 0) {
    return undefined;
  }

  const radius = Math.max(node.width, node.height) / 2;
  const gradient = context.createRadialGradient(node.width / 2, node.height / 2, 0, node.width / 2, node.height / 2, radius);
  stops.forEach((stop) => gradient.addColorStop(stop.position, stop.color));
  return gradient;
}

function extractCssFunctionArgs(value: string) {
  const start = value.indexOf("(");
  const end = value.lastIndexOf(")");
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

function splitCssLayers(value: string | undefined) {
  if (!value) {
    return [];
  }
  const layers: string[] = [];
  let depth = 0;
  let current = "";
  Array.from(value).forEach((char) => {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
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
    return { color: value.trim(), position: 0 };
  }
  return {
    color: match.groups.color.trim(),
    position: Math.max(0, Math.min(1, Number(match.groups.position) / 100))
  };
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
  const paint = value?.trim();
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
  return { paint: getSvgPaint(value, fallback), definition: null as ReactNode };
}

function renderSvgLinearGradient(id: string, value: string) {
  const args = extractCssFunctionArgs(value);
  const firstArg = args[0] ?? "";
  const angle = firstArg.endsWith("deg") ? Number(firstArg.replace("deg", "")) : 180;
  const stops = (firstArg.endsWith("deg") ? args.slice(1) : args)
    .map(parseCssColorStop)
    .filter(Boolean) as Array<{ color: string; position: number }>;
  const radians = (angle - 90) * Math.PI / 180;
  const x = Math.cos(radians) / 2;
  const y = Math.sin(radians) / 2;
  return (
    <linearGradient key={id} id={id} x1={0.5 - x} y1={0.5 - y} x2={0.5 + x} y2={0.5 + y}>
      {stops.map((stop, index) => (
        <stop key={`${id}-${index}`} offset={`${Math.round(stop.position * 100)}%`} stopColor={stop.color} />
      ))}
    </linearGradient>
  );
}

function renderSvgRadialGradient(id: string, value: string) {
  const stops = extractCssFunctionArgs(value)
    .map(parseCssColorStop)
    .filter(Boolean) as Array<{ color: string; position: number }>;
  return (
    <radialGradient key={id} id={id} cx="50%" cy="50%" r="70%">
      {stops.map((stop, index) => (
        <stop key={`${id}-${index}`} offset={`${Math.round(stop.position * 100)}%`} stopColor={stop.color} />
      ))}
    </radialGradient>
  );
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

function rectContainsPoint(rect: RectBounds, point: { x: number; y: number }) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
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
    <label className="block">
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

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mb-3 grid grid-cols-[80px_1fr] items-center gap-3">
      <span className="text-xs font-medium text-[#777]">{label}</span>
      <div className="flex items-center gap-2 rounded-xl border border-[#e4e4e7] px-3 py-2">
        <input type="color" value={normalizeColor(value)} onChange={(event) => onChange(event.target.value)} className="size-7 rounded border-0 bg-transparent p-0" />
        <Input value={value} onChange={(event) => onChange(event.target.value)} className="h-8 border-0 px-0 shadow-none focus-visible:ring-0" />
      </div>
    </label>
  );
}

function DesignLayerTree({
  nodes,
  expandedIds,
  selectedIds,
  onToggle,
  onSelect
}: {
  nodes: DesignLayerTreeNode[];
  expandedIds: string[];
  selectedIds: string[];
  onToggle: (nodeId: string) => void;
  onSelect: (node: DesignNode, append: boolean) => void;
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

  return sortDesignLayerPanelNodes(roots)
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
  return nodes.map((node, index) => ({
    ...node,
    ...patch(node, index),
    id: idMap.get(node.id) ?? createId("node"),
    parentId: node.parentId && idMap.has(node.parentId) ? idMap.get(node.parentId) : undefined
  }));
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

  return {
    ...fallback,
    ...source,
    id: source.id ?? fallback.id,
    name: source.name ?? fallback.name,
    prdText: source.prdText ?? fallback.prdText,
    aiSettings: source.aiSettings ?? fallback.aiSettings,
    pages,
    importedComponents: Array.isArray(source.importedComponents) ? source.importedComponents : [],
    importedAssets: Array.isArray(source.importedAssets) ? source.importedAssets : [],
    updatedAt: source.updatedAt ?? fallback.updatedAt
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
  return "#ffffff";
}
