import { taskSchema, type Task, type TaskStatus, type TaskType } from "../../shared/types/tasks.js";
import type { PersonRef, PriorityLevel } from "../../shared/types/models.js";
import { nowIso } from "../../shared/utils/time.js";
import type { TaskStore } from "../../domain/task/task-store.js";

export interface CreateTaskInput {
  title: string;
  description?: string;
  type: TaskType;
  priority: PriorityLevel;
  sourceRequirementIds: string[];
  sourceVersionId?: string;
  linkedAnnotationIds?: string[];
  ownerName?: string;
  assigneeNames?: string[];
  dependencies?: string[];
  acceptanceCriteria?: string[];
  dueDate?: string;
  labels?: string[];
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  priority?: PriorityLevel;
  ownerName?: string;
  addLinkedAnnotationId?: string[];
  removeLinkedAnnotationId?: string[];
  addDependency?: string[];
  removeDependency?: string[];
  appendComment?: string;
  dueDate?: string;
}

export class TaskService {
  constructor(private readonly repository: TaskStore) {}

  async create(input: CreateTaskInput) {
    const id = await this.repository.nextTaskId();
    const createdAt = nowIso();
    const owner = input.ownerName ? asPerson(input.ownerName) : undefined;
    const assignees = (input.assigneeNames ?? []).map(asPerson);

    const task = taskSchema.parse({
      id,
      title: input.title,
      description: input.description,
      type: input.type,
      status: "todo",
      priority: input.priority,
      owner,
      assignees,
      sourceRequirementIds: input.sourceRequirementIds,
      sourceVersionId: input.sourceVersionId,
      linkedAnnotationIds: input.linkedAnnotationIds ?? [],
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      dependencies: input.dependencies ?? [],
      labels: input.labels ?? [],
      dates: input.dueDate ? { dueDate: input.dueDate } : undefined,
      statusHistory: [
        {
          from: null,
          to: "todo",
          reason: "Task created",
          changedAt: createdAt
        }
      ],
      version: {
        schemaVersion: "1.0.0",
        revision: 1
      },
      createdAt,
      updatedAt: createdAt
    });

    await this.repository.saveTask(task);
    return task;
  }

  async list() {
    return this.repository.listTasks();
  }

  async get(id: string) {
    return this.repository.getTask(id);
  }

  async update(id: string, input: UpdateTaskInput) {
    const current = await this.repository.getTask(id);
    const updatedAt = nowIso();
    const nextDependencies = new Set(current.dependencies);
    const nextLinkedAnnotations = new Set(current.linkedAnnotationIds);

    for (const dependency of input.addDependency ?? []) {
      nextDependencies.add(dependency);
    }
    for (const dependency of input.removeDependency ?? []) {
      nextDependencies.delete(dependency);
    }
    for (const annotationId of input.addLinkedAnnotationId ?? []) {
      nextLinkedAnnotations.add(annotationId);
    }
    for (const annotationId of input.removeLinkedAnnotationId ?? []) {
      nextLinkedAnnotations.delete(annotationId);
    }

    let statusHistory = current.statusHistory;
    if (input.status && input.status !== current.status) {
      statusHistory = [
        ...statusHistory,
        {
          from: current.status,
          to: input.status,
          reason: "Task status updated",
          changedAt: updatedAt
        }
      ];
    }

    const updated: Task = {
      ...current,
      status: input.status ?? current.status,
      priority: input.priority ?? current.priority,
      owner: input.ownerName ? asPerson(input.ownerName) : current.owner,
      linkedAnnotationIds: [...nextLinkedAnnotations],
      dependencies: [...nextDependencies],
      dates: input.dueDate ? { ...(current.dates ?? {}), dueDate: input.dueDate } : current.dates,
      statusHistory,
      updatedAt,
      version: {
        ...current.version,
        revision: current.version.revision + 1
      }
    };

    await this.repository.saveTask(updated);
    if (input.appendComment) {
      await this.repository.appendComment(id, input.appendComment);
    }
    return updated;
  }
}

function asPerson(name: string): PersonRef {
  return {
    id: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name
  };
}
