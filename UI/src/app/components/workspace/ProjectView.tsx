import { useEffect, useCallback, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { getProject, getChatMessages, getStages, syncProjectBundle } from "../../utils/storage";
import { Project, Stage, ChatMessage, MainAgentDecision } from "../../types";
import { ProjectSidebar } from "./ProjectSidebar";
import { ChatPanel } from "./ChatPanel";
import { StagesPanel } from "./StagesPanel";
import { MyWorkspaceDialog } from "./MyWorkspaceDialog";
import { Loader2 } from "lucide-react";
import { bootstrapWorkspaceProject, streamWorkspaceBundle, WorkspaceBundleResponse } from "../../utils/workspace-api";
import { toast } from "sonner";

export function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  
  const [project, setProject] = useState<Project | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [bundleStreamStatus, setBundleStreamStatus] = useState<string | null>(null);
  const [bundleStreamPreview, setBundleStreamPreview] = useState("");
  const [bundleStreamActive, setBundleStreamActive] = useState(false);
  const [mainAgentDecision, setMainAgentDecision] = useState<MainAgentDecision | undefined>(undefined);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [loading, setLoading] = useState(true);
  const bundleStreamRef = useRef<ReturnType<typeof streamWorkspaceBundle> | null>(null);

  useEffect(() => {
    void loadProject();
  }, [projectId, navigate]);

  useEffect(() => {
    return () => {
      bundleStreamRef.current?.close();
    };
  }, []);

  const applyBundle = (bundle: WorkspaceBundleResponse) => {
    syncProjectBundle(bundle.project, bundle.stages);
    setProject(bundle.project);
    setStages(bundle.stages);
    setMainAgentDecision(bundle.mainAgentDecision);
  };

  const clearBundleStreamUi = () => {
    setBundleStreamActive(false);
    setBundleStreamStatus(null);
    setBundleStreamPreview("");
  };

  const stopBundleStream = async () => {
    const currentStream = bundleStreamRef.current;
    bundleStreamRef.current = null;
    if (!currentStream) {
      return;
    }

    try {
      await currentStream.cancel();
      setBundleStreamStatus("已终止当前实时输出");
      setBundleStreamActive(false);
      toast.success("已终止当前实时输出");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "终止实时输出失败");
    }
  };

  const loadBundleWithStream = async (id: string) => {
    bundleStreamRef.current?.close();
    setBundleStreamActive(true);
    setBundleStreamStatus("正在建立实时连接");
    setBundleStreamPreview("");

    const stream = streamWorkspaceBundle(id, {
      onStatus: ({ status }) => setBundleStreamStatus(status),
      onLlmDelta: ({ delta }) => {
        setBundleStreamStatus("主 Agent 正在输出中");
        setBundleStreamPreview((current) => `${current}${delta}`.slice(-1200));
      },
      onBundle: (bundle) => {
        applyBundle(bundle);
      },
      onDone: () => {
        clearBundleStreamUi();
      },
      onCancelled: ({ message }) => {
        setBundleStreamStatus(message ?? "实时输出已取消");
        setBundleStreamActive(false);
      },
      onError: (message) => {
        setBundleStreamStatus(message);
        setBundleStreamActive(false);
      }
    });

    bundleStreamRef.current = stream;
    const bundle = await stream.promise;
    bundleStreamRef.current = null;
    clearBundleStreamUi();
    return bundle;
  };

  const loadProject = async () => {
    if (!projectId) {
      navigate("/");
      return;
    }

    const loadedProject = getProject(projectId);
    if (loadedProject) {
      setProject(loadedProject);
      setStages(getStages(projectId));
      setChatMessages(getChatMessages(projectId));
      setLoading(false);
    }

    try {
      const bundle = await loadBundleWithStream(projectId);
      applyBundle(bundle);
      setChatMessages(getChatMessages(projectId));
      setLoading(false);
      return;
    } catch (error) {
      if (loadedProject) {
        try {
          const bundle = await bootstrapWorkspaceProject(loadedProject);
          applyBundle(bundle);
          setChatMessages(getChatMessages(projectId));
          setLoading(false);
          toast.success("已为旧项目初始化本地项目空间");
          return;
        } catch {}
      }

      if (loadedProject) {
        return;
      }
      toast.error(error instanceof Error ? error.message : "项目加载失败");
      navigate("/");
    }
  };

  const refreshData = async () => {
    if (!projectId) return;

    try {
      const bundle = await loadBundleWithStream(projectId);
      applyBundle(bundle);
    } catch {
      const localProject = getProject(projectId);
      if (localProject) {
        try {
          const bundle = await bootstrapWorkspaceProject(localProject);
          applyBundle(bundle);
        } catch {}
      }
    }

    const loadedProject = getProject(projectId);
    if (loadedProject) {
      setProject(loadedProject);
    }
    setStages(getStages(projectId));
    setChatMessages(getChatMessages(projectId));
  };

  const refreshLocalState = () => {
    if (!projectId) {
      return;
    }

    const loadedProject = getProject(projectId);
    if (loadedProject) {
      setProject(loadedProject);
    }
    setStages(getStages(projectId));
    setChatMessages(getChatMessages(projectId));
  };

  const onOpenWorkspace = useCallback(() => {
    // setShowWorkspace(true);
    navigate(`/project/${projectId}/workspace`);
  }, [])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-[var(--color-text-secondary)]" />
      </div>
    );
  }

  if (!project) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0">
      {/* Left Sidebar - Projects */}
      <ProjectSidebar
        currentProjectId={project.id}
        currentProject={project}
        onBundleUpdate={applyBundle}
      />
      
      {/* Middle Panel - Chat */}
      <ChatPanel 
        projectId={project.id}
        currentStage={project.currentStage}
        messages={chatMessages}
        stages={stages}
        onBundleUpdate={applyBundle}
        onRefresh={refreshLocalState}
        onOpenWorkspace={onOpenWorkspace}
      />
      
      {/* Right Panel - Stages */}
      <StagesPanel 
        projectId={project.id}
        stages={stages}
        currentStage={project.currentStage}
        onBundleUpdate={applyBundle}
        onRefresh={refreshData}
      />

      {/* <MyWorkspaceDialog
        open={showWorkspace}
        onOpenChange={onOpenWorkspace}
        projectId={project.id}
        projectName={project.name}
        currentStage={project.currentStage}
        stages={stages}
      /> */}
    </div>
  );
}
