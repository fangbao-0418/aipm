import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Button } from "../ui/button";
import { Plus, FolderOpen, Trash2, Search, Settings } from "lucide-react";
import { getProjects, deleteProject, generateId } from "../../utils/storage";
import { Project } from "../../types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ScrollArea } from "../ui/scroll-area";
import { toast } from "sonner";
import {
  bootstrapWorkspaceProject,
  createWorkspaceProject,
  deleteWorkspaceProject,
  updateWorkspaceLlmSettings,
  WorkspaceBundleResponse
} from "../../utils/workspace-api";

interface ProjectSidebarProps {
  currentProjectId: string;
  currentProject: Project;
  onBundleUpdate: (bundle: WorkspaceBundleResponse) => void;
}

type LlmProvider = NonNullable<Project["llmSettings"]>["provider"];
type LlmProfile = NonNullable<Project["llmSettings"]>["modelProfile"];

export function ProjectSidebar({ currentProjectId, currentProject, onBundleUpdate }: ProjectSidebarProps) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [industry, setIndustry] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [provider, setProvider] = useState<LlmProvider>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelProfile, setModelProfile] = useState<LlmProfile>("balanced");
  const [captureModel, setCaptureModel] = useState("gpt-5-mini");
  const [structureModel, setStructureModel] = useState("gpt-5.2");
  const [isCreating, setIsCreating] = useState(false);
  const [settingsProvider, setSettingsProvider] = useState<LlmProvider>("openai");
  const [settingsBaseUrl, setSettingsBaseUrl] = useState("");
  const [settingsApiKey, setSettingsApiKey] = useState("");
  const [settingsModelProfile, setSettingsModelProfile] = useState<LlmProfile>("balanced");
  const [settingsCaptureModel, setSettingsCaptureModel] = useState("gpt-5-mini");
  const [settingsStructureModel, setSettingsStructureModel] = useState("gpt-5.2");
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const loadProjects = () => {
    setProjects(getProjects());
  };

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    const settings = currentProject.llmSettings;
    setSettingsProvider(settings?.provider ?? "openai");
    setSettingsBaseUrl(settings?.baseUrl ?? "");
    setSettingsModelProfile(settings?.modelProfile ?? "balanced");
    setSettingsCaptureModel(settings?.stageModelRouting?.capture ?? "gpt-5-mini");
    setSettingsStructureModel(settings?.stageModelRouting?.structure ?? "gpt-5.2");
    setSettingsApiKey("");
  }, [currentProject]);

  const resetCreateForm = () => {
    setProjectName("");
    setProjectDescription("");
    setIndustry("");
    setSystemPrompt("");
    setProvider("openai");
    setBaseUrl("");
    setApiKey("");
    setModelProfile("balanced");
    setCaptureModel("gpt-5-mini");
    setStructureModel("gpt-5.2");
  };

  const handleCreateProject = async () => {
    if (!projectName.trim()) {
      return;
    }

    const id = generateId();
    setIsCreating(true);

    try {
      const bundle = await createWorkspaceProject({
        id,
        name: projectName,
        description: projectDescription,
        industry: industry || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        llmSettings: {
          provider,
          baseUrl: baseUrl.trim() || undefined,
          modelProfile,
          stageModelRouting: {
            capture: captureModel.trim() || undefined,
            structure: structureModel.trim() || undefined
          }
        },
        apiKey: apiKey.trim() || undefined
      });

      onBundleUpdate(bundle);
      setShowNewProjectDialog(false);
      resetCreateForm();
      loadProjects();
      toast.success("项目创建成功");
      navigate(`/project/${id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "项目创建失败");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteProject = async (projectId: string, projectName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (confirm(`确定要删除项目"${projectName}"吗？此操作无法撤销。`)) {
      try {
        await deleteWorkspaceProject(projectId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "本地项目空间删除失败");
        return;
      }

      deleteProject(projectId);
      loadProjects();
      toast.success("项目已删除");
      
      if (projectId === currentProjectId) {
        navigate('/');
      }
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);

    try {
      let result;
      try {
        result = await updateWorkspaceLlmSettings(currentProjectId, {
          provider: settingsProvider,
          baseUrl: settingsBaseUrl.trim() || undefined,
          modelProfile: settingsModelProfile,
          stageModelRouting: {
            capture: settingsCaptureModel.trim() || undefined,
            structure: settingsStructureModel.trim() || undefined
          },
          apiKey: settingsApiKey.trim() || undefined
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("ENOENT")) {
          throw error;
        }

        const bootstrapped = await bootstrapWorkspaceProject(currentProject);
        onBundleUpdate(bootstrapped);
        result = await updateWorkspaceLlmSettings(currentProjectId, {
          provider: settingsProvider,
          baseUrl: settingsBaseUrl.trim() || undefined,
          modelProfile: settingsModelProfile,
          stageModelRouting: {
            capture: settingsCaptureModel.trim() || undefined,
            structure: settingsStructureModel.trim() || undefined
          },
          apiKey: settingsApiKey.trim() || undefined
        });
      }

      onBundleUpdate(result.bundle);
      loadProjects();
      setShowSettingsDialog(false);
      setSettingsApiKey("");
      toast.success(result.validation.message || "模型设置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存模型设置失败");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      <div className="flex h-full min-h-0 w-64 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        {/* Header */}
        <div className="p-4 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">项目列表</h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowNewProjectDialog(true)}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          
          <div className="relative">
            <Search className="absolute left-2 top-2.5 size-4 text-[var(--color-text-secondary)]" />
            <Input
              placeholder="搜索项目..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        {/* Project List */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2 space-y-1">
            {filteredProjects.length === 0 ? (
              <div className="p-4 text-center text-sm text-[var(--color-text-secondary)]">
                {searchQuery ? "未找到匹配的项目" : "暂无项目"}
              </div>
            ) : (
              filteredProjects.map((project) => (
                <div
                  key={project.id}
                  className={`
                    group relative p-3 rounded-lg cursor-pointer transition-colors
                    ${project.id === currentProjectId
                      ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]'
                      : 'hover:bg-[var(--color-muted)]'
                    }
                  `}
                  onClick={() => navigate(`/project/${project.id}`)}
                >
                  <div className="flex items-start gap-2">
                    <FolderOpen className="size-4 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {project.name}
                      </div>
                      {project.description && (
                        <div className="text-xs text-[var(--color-text-secondary)] line-clamp-2 mt-1">
                          {project.description}
                        </div>
                      )}
                      <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                        {new Date(project.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="opacity-0 group-hover:opacity-100 size-6 p-0"
                      onClick={(e) => handleDeleteProject(project.id, project.name, e)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--color-border)]">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setShowSettingsDialog(true)}
          >
            <Settings className="size-4 mr-2" />
            模型设置
          </Button>
        </div>
      </div>

      <Dialog open={showNewProjectDialog} onOpenChange={setShowNewProjectDialog}>
        <DialogContent className="sm:max-w-[525px]">
          <DialogHeader>
            <DialogTitle>创建新项目</DialogTitle>
            <DialogDescription>
              填写项目基本信息，开始你的产品设计之旅
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">项目名称 *</Label>
              <Input
                id="name"
                placeholder="例如：智能日程管理应用"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="description">项目简介</Label>
              <Textarea
                id="description"
                placeholder="简单描述项目的核心目标和场景..."
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                rows={3}
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="industry">行业类型</Label>
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger id="industry">
                  <SelectValue placeholder="选择行业（可选）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="saas">SaaS / 企业服务</SelectItem>
                  <SelectItem value="ecommerce">电商 / 零售</SelectItem>
                  <SelectItem value="fintech">金融科技</SelectItem>
                  <SelectItem value="education">在线教育</SelectItem>
                  <SelectItem value="healthcare">医疗健康</SelectItem>
                  <SelectItem value="social">社交网络</SelectItem>
                  <SelectItem value="media">内容 / 媒体</SelectItem>
                  <SelectItem value="other">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="system-prompt">项目系统提示词</Label>
              <Textarea
                id="system-prompt"
                placeholder="例如：你是资深 B 端产品专家，优先输出结构化需求、明确边界和验收标准。"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
              />
            </div>

            <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-4">
              <div>
                <div className="text-sm font-semibold">模型设置</div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                  建议先设置默认策略，再只对关键阶段做模型覆盖。
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="provider">Provider</Label>
                <Select value={provider} onValueChange={(value) => setProvider(value as LlmProvider)}>
                  <SelectTrigger id="provider">
                    <SelectValue placeholder="选择模型提供方" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="openai-compatible">OpenAI Compatible</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="base-url">Base URL</Label>
                <Input
                  id="base-url"
                  placeholder="https://api.openai.com/v1"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="api-key">API Key</Label>
                <Input
                  id="api-key"
                  type="password"
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="model-profile">默认模型策略</Label>
                <Select value={modelProfile} onValueChange={(value) => setModelProfile(value as LlmProfile)}>
                  <SelectTrigger id="model-profile">
                    <SelectValue placeholder="选择策略" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quality">质量优先</SelectItem>
                    <SelectItem value="balanced">质量 / 成本平衡</SelectItem>
                    <SelectItem value="cost-saving">成本优先</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="capture-model">需求采集模型</Label>
                  <Input
                    id="capture-model"
                    placeholder="gpt-5-mini"
                    value={captureModel}
                    onChange={(event) => setCaptureModel(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="structure-model">需求结构化模型</Label>
                  <Input
                    id="structure-model"
                    placeholder="gpt-5.2"
                    value={structureModel}
                    onChange={(event) => setStructureModel(event.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowNewProjectDialog(false)}
            >
              取消
            </Button>
            <Button 
              onClick={handleCreateProject}
              disabled={!projectName.trim() || isCreating}
            >
              {isCreating ? "创建中..." : "创建项目"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>模型设置</DialogTitle>
            <DialogDescription>
              当前项目会优先使用这里的设置。建议采用“默认 profile + 阶段覆盖”。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="settings-provider">Provider</Label>
              <Select value={settingsProvider} onValueChange={(value) => setSettingsProvider(value as LlmProvider)}>
                <SelectTrigger id="settings-provider">
                  <SelectValue placeholder="选择模型提供方" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="openai-compatible">OpenAI Compatible</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-base-url">Base URL</Label>
              <Input
                id="settings-base-url"
                placeholder="https://api.openai.com/v1"
                value={settingsBaseUrl}
                onChange={(event) => setSettingsBaseUrl(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-api-key">API Key</Label>
              <Input
                id="settings-api-key"
                type="password"
                placeholder={currentProject.llmSettings?.apiKeyConfigured ? "已配置，留空则保持不变" : "sk-..."}
                value={settingsApiKey}
                onChange={(event) => setSettingsApiKey(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-model-profile">默认模型策略</Label>
              <Select value={settingsModelProfile} onValueChange={(value) => setSettingsModelProfile(value as LlmProfile)}>
                <SelectTrigger id="settings-model-profile">
                  <SelectValue placeholder="选择策略" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quality">质量优先</SelectItem>
                  <SelectItem value="balanced">质量 / 成本平衡</SelectItem>
                  <SelectItem value="cost-saving">成本优先</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="settings-capture-model">需求采集模型</Label>
                <Input
                  id="settings-capture-model"
                  value={settingsCaptureModel}
                  onChange={(event) => setSettingsCaptureModel(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="settings-structure-model">需求结构化模型</Label>
                <Input
                  id="settings-structure-model"
                  value={settingsStructureModel}
                  onChange={(event) => setSettingsStructureModel(event.target.value)}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettingsDialog(false)}>
              取消
            </Button>
            <Button onClick={handleSaveSettings} disabled={isSavingSettings}>
              {isSavingSettings ? "保存中..." : "保存设置"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
