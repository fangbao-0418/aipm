import { access, appendFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ProjectContext } from "./project-context.js";
import { formatSequentialId } from "../../shared/utils/ids.js";
import { readJsonFile, writeJsonFile } from "../../shared/utils/json.js";
import type { Task } from "../../shared/types/tasks.js";
import type { TaskStore } from "../../domain/task/task-store.js";
import { IndexDatabase } from "../db/index-database.js";

export class TaskRepository implements TaskStore {
  private readonly index: IndexDatabase;

  constructor(private readonly context: ProjectContext) {
    this.index = new IndexDatabase(context);
  }

  async ensureReady() {
    await Promise.all([this.context.ensureBaseStructure(), this.index.ensureReady()]);
  }

  taskDir(id: string) {
    return this.context.path("tasks", id);
  }

  taskPath(id: string) {
    return this.context.path("tasks", id, "task.json");
  }

  async nextTaskId() {
    await this.ensureReady();
    return formatSequentialId("task", await this.index.nextTaskSequence());
  }

  async saveTask(task: Task) {
    await mkdir(this.taskDir(task.id), { recursive: true });
    await writeJsonFile(this.taskPath(task.id), task);
    await this.index.upsertTask(task);
  }

  async getTask(id: string) {
    return readJsonFile<Task>(this.taskPath(id));
  }

  async listTasks() {
    await this.ensureReady();
    let ids = await this.index.listTaskIds();
    if (ids.length === 0) {
      ids = await this.bootstrapTaskIndexFromFiles();
    }

    const tasks = await Promise.all(ids.map(async (id) => this.readTaskIfExists(id)));
    return tasks
      .filter((item): item is Task => item !== null)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async appendComment(taskId: string, comment: string) {
    const commentPath = this.context.path("tasks", taskId, "comments.md");
    await appendFile(commentPath, `${comment.trim()}\n\n`, "utf-8");
  }

  private async bootstrapTaskIndexFromFiles() {
    const entries = await readdir(this.context.path("tasks"), { withFileTypes: true });
    const ids: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !/^task-\d+$/.test(entry.name)) {
        continue;
      }

      const task = await this.readTaskIfExists(entry.name);
      if (!task) {
        continue;
      }

      await this.index.upsertTask(task);
      ids.push(task.id);
    }

    return ids.sort((left, right) => left.localeCompare(right));
  }

  private async readTaskIfExists(id: string) {
    const path = join(this.context.path("tasks"), id, "task.json");
    try {
      await access(path);
      return await readJsonFile<Task>(path);
    } catch {
      return null;
    }
  }
}
