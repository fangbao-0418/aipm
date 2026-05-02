import { useNavigate } from "react-router";
import { Button } from "../ui/button";
import { FolderOpen, Plus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { generateId, getProjects, syncProjectBundle } from "../../utils/storage";
import { Project } from "../../types";
import { createWorkspaceProject } from "../../utils/workspace-api";
import { toast } from "sonner";
import { Card } from "../ui/card";

type LlmProvider = NonNullable<Project["llmSettings"]>["provider"];
type LlmProfile = NonNullable<Project["llmSettings"]>["modelProfile"];

export function Welcome() {
  const navigate = useNavigate();
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
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
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);

  useEffect(() => {
    const projects = getProjects()
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, 3);
    setRecentProjects(projects);
  }, [showNewProjectDialog]);

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

      syncProjectBundle(bundle.project, bundle.stages);
      toast.success("项目创建成功，本地项目空间已初始化");
      navigate(`/project/${id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "项目创建失败");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="max-w-2xl text-center space-y-6">
          <div className="flex justify-center mb-8">
            <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-600">
              <Sparkles className="size-12 text-white" />
            </div>
          </div>
          
          <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
            欢迎使用 AIPM
          </h1>
          
          <p className="text-xl text-[var(--color-text-secondary)]">
            CLI 打开的 AI PM 工作台
          </p>
          
          <p className="text-base text-[var(--color-text-secondary)] max-w-xl mx-auto">
            从模糊需求到完整产品方案，让 AI 帮你完成需求结构化、PRD 编写、原型设计和 UI 稿生成的全流程工作。
          </p>

          <div className="pt-8">
            <Button 
              size="lg" 
              onClick={() => setShowNewProjectDialog(true)}
              className="text-lg px-8 py-6"
            >
              <Plus className="size-5 mr-2" />
              创建新项目
            </Button>
          </div>

          {recentProjects.length > 0 && (
            <div className="pt-4 text-left">
              <div className="mb-3 text-sm font-medium text-[var(--color-text-secondary)]">
                最近项目
              </div>
              <div className="grid gap-3">
                {recentProjects.map((project) => (
                  <Card
                    key={project.id}
                    className="cursor-pointer border-[var(--color-border)] p-4 text-left transition-colors hover:border-purple-300 hover:bg-[var(--color-muted)]/30"
                    onClick={() => navigate(`/project/${project.id}`)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-[var(--color-muted)] p-2">
                        <FolderOpen className="size-4 text-[var(--color-text-secondary)]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{project.name}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-[var(--color-text-secondary)]">
                          {project.description || "暂无项目简介"}
                        </div>
                        <div className="mt-2 text-xs text-[var(--color-text-secondary)]">
                          最近更新：{new Date(project.updatedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          <div className="pt-12 grid grid-cols-3 gap-6 text-left">
            <div className="p-4 rounded-lg border border-[var(--color-border)]">
              <div className="text-sm font-semibold mb-2">📝 需求结构化</div>
              <div className="text-xs text-[var(--color-text-secondary)]">
                把一句话需求转化为完整的结构化需求点
              </div>
            </div>
            
            <div className="p-4 rounded-lg border border-[var(--color-border)]">
              <div className="text-sm font-semibold mb-2">📋 PRD 生成</div>
              <div className="text-xs text-[var(--color-text-secondary)]">
                自动生成专业的产品需求文档
              </div>
            </div>
            
            <div className="p-4 rounded-lg border border-[var(--color-border)]">
              <div className="text-sm font-semibold mb-2">🎨 原型 & UI</div>
              <div className="text-xs text-[var(--color-text-secondary)]">
                快速生成原型和高保真 UI 设计稿
              </div>
            </div>
          </div>
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
          
          <div className="grid gap-4 py-4" style={{ maxHeight: 300, overflowY: "auto" }}>
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
                placeholder="例如：你是资深产品专家，默认先澄清需求，再输出 PRD、原型标注和 UI 稿。"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
              />
            </div>

            <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-4">
              <div>
                <div className="text-sm font-semibold">模型设置</div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                  建议用“默认 profile + 阶段覆盖”的方式。第一阶段先开放需求采集和需求结构化两个模型。
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
    </>
  );
}
