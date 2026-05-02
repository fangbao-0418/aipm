import { Artifact, Project, Stage, ChatMessage, StageType, ArtifactType, WorkspaceRequirementItem, WorkspaceViewConfig, WorkspaceBusinessModelGraph, WorkspaceRequirementDocument } from '../types';

// 使用 localStorage 存储项目数据
const STORAGE_KEY = 'aipm_projects';
const CHAT_STORAGE_KEY = 'aipm_chats';
const STAGES_STORAGE_KEY = 'aipm_stages';
const WORKSPACE_ITEMS_STORAGE_KEY = 'aipm_workspace_items';
const WORKSPACE_VIEW_CONFIG_STORAGE_KEY = 'aipm_workspace_view_config';
const WORKSPACE_BUSINESS_MODEL_STORAGE_KEY = 'aipm_workspace_business_model';
const WORKSPACE_DOCUMENTS_STORAGE_KEY = 'aipm_workspace_documents';

// 获取所有项目
export function getProjects(): Project[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

// 保存项目
export function saveProject(project: Project): void {
  const projects = getProjects();
  const index = projects.findIndex(p => p.id === project.id);
  
  if (index >= 0) {
    projects[index] = project;
  } else {
    projects.push(project);
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function syncProjectBundle(project: Project, stages: Stage[]): void {
  saveProject(project);
  saveStages(project.id, stages);
}

export function updateProjectCurrentStage(projectId: string, stage: StageType): void {
  const project = getProject(projectId);
  if (!project) {
    return;
  }

  saveProject({
    ...project,
    currentStage: stage,
    updatedAt: new Date().toISOString()
  });
}

// 删除项目
export function deleteProject(projectId: string): void {
  const projects = getProjects();
  const filtered = projects.filter(p => p.id !== projectId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  
  // 同时删除相关的聊天记录和阶段数据
  localStorage.removeItem(`${CHAT_STORAGE_KEY}_${projectId}`);
  localStorage.removeItem(`${STAGES_STORAGE_KEY}_${projectId}`);
}

// 获取项目
export function getProject(projectId: string): Project | null {
  const projects = getProjects();
  return projects.find(p => p.id === projectId) || null;
}

// 获取项目的聊天记录
export function getChatMessages(projectId: string): ChatMessage[] {
  const stored = localStorage.getItem(`${CHAT_STORAGE_KEY}_${projectId}`);
  return stored ? JSON.parse(stored) : [];
}

// 保存聊天消息
export function saveChatMessage(projectId: string, message: ChatMessage): void {
  const messages = getChatMessages(projectId);
  messages.push(message);
  localStorage.setItem(`${CHAT_STORAGE_KEY}_${projectId}`, JSON.stringify(messages));
}

export function saveChatMessages(projectId: string, messages: ChatMessage[]): void {
  localStorage.setItem(`${CHAT_STORAGE_KEY}_${projectId}`, JSON.stringify(messages));
}

export function updateChatMessage(projectId: string, messageId: string, patch: Partial<ChatMessage>): ChatMessage | null {
  const messages = getChatMessages(projectId);
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) {
    return null;
  }

  const updated = {
    ...messages[index],
    ...patch
  };
  messages[index] = updated;
  saveChatMessages(projectId, messages);
  return updated;
}

export function deleteChatMessage(projectId: string, messageId: string): void {
  const messages = getChatMessages(projectId);
  const deletedIds = new Set<string>([messageId]);

  let changed = true;
  while (changed) {
    changed = false;
    for (const message of messages) {
      if (message.parentId && deletedIds.has(message.parentId) && !deletedIds.has(message.id)) {
        deletedIds.add(message.id);
        changed = true;
      }
    }
  }

  const filtered = messages.filter((message) => !deletedIds.has(message.id));
  saveChatMessages(projectId, filtered);
}

// 获取项目的阶段数据
export function getStages(projectId: string): Stage[] {
  const stored = localStorage.getItem(`${STAGES_STORAGE_KEY}_${projectId}`);
  
  if (stored) {
    return JSON.parse(stored);
  }
  
  // 返回默认阶段
  return getDefaultStages();
}

// 保存阶段数据
export function saveStages(projectId: string, stages: Stage[]): void {
  localStorage.setItem(`${STAGES_STORAGE_KEY}_${projectId}`, JSON.stringify(stages));
}

// 更新阶段状态
export function updateStageStatus(projectId: string, stageType: StageType, status: Stage['status']): void {
  const stages = getStages(projectId);
  const stage = stages.find(s => s.type === stageType);
  
  if (stage) {
    stage.status = status;
    saveStages(projectId, stages);
  }
}

export function upsertStageArtifact(
  projectId: string,
  stageType: StageType,
  artifactType: ArtifactType,
  name: string,
  content: Artifact["content"]
): Artifact {
  const stages = getStages(projectId);
  const stage = stages.find((item) => item.type === stageType);

  if (!stage) {
    throw new Error(`Stage "${stageType}" not found.`);
  }

  const now = new Date().toISOString();
  const existing = stage.artifacts.find((artifact) => artifact.type === artifactType);

  if (existing) {
    existing.name = name;
    existing.content = content;
    existing.version += 1;
    existing.updatedAt = now;
    saveStages(projectId, stages);
    return existing;
  }

  const created: Artifact = {
    id: generateId(),
    type: artifactType,
    name,
    content,
    version: 1,
    createdAt: now,
    updatedAt: now
  };

  stage.artifacts.unshift(created);
  saveStages(projectId, stages);
  return created;
}

export function updateStageArtifact(
  projectId: string,
  stageType: StageType,
  artifactId: string,
  patch: Partial<Artifact>
): Artifact | null {
  const stages = getStages(projectId);
  const stage = stages.find((item) => item.type === stageType);

  if (!stage) {
    return null;
  }

  const artifact = stage.artifacts.find((item) => item.id === artifactId);

  if (!artifact) {
    return null;
  }

  const nextArtifact = {
    ...artifact,
    ...patch,
    version: artifact.version + 1,
    updatedAt: new Date().toISOString()
  };

  stage.artifacts = stage.artifacts.map((item) => (item.id === artifactId ? nextArtifact : item));
  saveStages(projectId, stages);
  return nextArtifact;
}

export function rollbackToStage(projectId: string, targetStage: StageType): void {
  const stages = getStages(projectId);
  const targetIndex = stages.findIndex((stage) => stage.type === targetStage);

  if (targetIndex < 0) {
    return;
  }

  const nextStages = stages.map((stage, index) => {
    if (index < targetIndex) {
      return {
        ...stage,
        status: stage.artifacts.length > 0 ? "completed" : "not-started"
      };
    }

    if (index === targetIndex) {
      return {
        ...stage,
        status: "in-progress"
      };
    }

    return {
      ...stage,
      status: stage.artifacts.length > 0 ? "pending-review" : "not-started"
    };
  });

  saveStages(projectId, nextStages);
  updateProjectCurrentStage(projectId, targetStage);
}

// 默认阶段列表
function getDefaultStages(): Stage[] {
  return [
    {
      type: 'requirement-collection',
      name: '需求采集',
      description: '收集和记录原始需求输入',
      status: 'not-started',
      artifacts: []
    },
    {
      type: 'requirement-structure',
      name: '需求结构化',
      description: '将原始需求整理成结构化需求点',
      status: 'not-started',
      artifacts: []
    },
    {
      type: 'requirement-clarification',
      name: '需求澄清',
      description: 'AI 主动识别缺失信息并补全',
      status: 'not-started',
      artifacts: []
    },
    {
      type: 'product-model',
      name: '产品模型',
      description: '建立统一的产品中间模型',
      status: 'not-started',
      artifacts: []
    },
    {
      type: 'prd',
      name: 'PRD',
      description: '形成正式产品需求文档',
      status: 'not-started',
      artifacts: []
    },
    {
      type: 'prototype',
      name: '原型',
      description: '输出页面结构和交互骨架',
      status: 'not-started',
      artifacts: []
    },
    {
      type: 'prototype-annotation',
      name: '原型标注',
      description: '补充交互和业务标注',
      status: 'not-started',
      artifacts: []
    },
    {
      type: 'ui-draft',
      name: 'UI 稿',
      description: '生成高保真视觉设计稿',
      status: 'not-started',
      artifacts: []
    },
    {
      type: 'review',
      name: 'Review',
      description: '版本管理和质量审查',
      status: 'not-started',
      artifacts: []
    }
  ];
}

// 生成 ID
export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function getWorkspaceRequirementItems(projectId: string): WorkspaceRequirementItem[] {
  const stored = localStorage.getItem(`${WORKSPACE_ITEMS_STORAGE_KEY}_${projectId}`);
  return stored ? JSON.parse(stored) : [];
}

export function saveWorkspaceRequirementItems(projectId: string, items: WorkspaceRequirementItem[]): void {
  localStorage.setItem(`${WORKSPACE_ITEMS_STORAGE_KEY}_${projectId}`, JSON.stringify(items));
}

export function getWorkspaceViewConfig(projectId: string): WorkspaceViewConfig | null {
  const stored = localStorage.getItem(`${WORKSPACE_VIEW_CONFIG_STORAGE_KEY}_${projectId}`);
  return stored ? JSON.parse(stored) : null;
}

export function saveWorkspaceViewConfig(projectId: string, config: WorkspaceViewConfig): void {
  localStorage.setItem(`${WORKSPACE_VIEW_CONFIG_STORAGE_KEY}_${projectId}`, JSON.stringify(config));
}

export function getWorkspaceBusinessModelGraph(projectId: string): WorkspaceBusinessModelGraph | null {
  const stored = localStorage.getItem(`${WORKSPACE_BUSINESS_MODEL_STORAGE_KEY}_${projectId}`);
  return stored ? JSON.parse(stored) : null;
}

export function saveWorkspaceBusinessModelGraph(projectId: string, graph: WorkspaceBusinessModelGraph): void {
  localStorage.setItem(`${WORKSPACE_BUSINESS_MODEL_STORAGE_KEY}_${projectId}`, JSON.stringify(graph));
}

export function getWorkspaceRequirementDocuments(projectId: string): WorkspaceRequirementDocument[] {
  const stored = localStorage.getItem(`${WORKSPACE_DOCUMENTS_STORAGE_KEY}_${projectId}`);
  return stored ? JSON.parse(stored) : [];
}

export function saveWorkspaceRequirementDocuments(projectId: string, documents: WorkspaceRequirementDocument[]): void {
  localStorage.setItem(`${WORKSPACE_DOCUMENTS_STORAGE_KEY}_${projectId}`, JSON.stringify(documents));
}
