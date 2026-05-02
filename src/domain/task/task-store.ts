import type { Task } from "../../shared/types/tasks.js";

export interface TaskStore {
  nextTaskId(): Promise<string>;
  saveTask(task: Task): Promise<void>;
  getTask(id: string): Promise<Task>;
  listTasks(): Promise<Task[]>;
  appendComment(taskId: string, comment: string): Promise<void>;
}
