import type { Task } from "../shared/types/tasks.js";

export function printTaskSummary(task: Task) {
  console.log(`${task.id} ${task.title}`);
  console.log(`status: ${task.status}`);
  console.log(`type: ${task.type}`);
  console.log(`priority: ${task.priority}`);
  console.log(`requirements: ${task.sourceRequirementIds.join(", ")}`);
}

export function printTaskList(tasks: Task[]) {
  if (tasks.length === 0) {
    console.log("No tasks found.");
    return;
  }
  for (const task of tasks) {
    console.log(`${task.id}  [${task.status}]  [${task.priority}]  [${task.type}]  ${task.title}`);
  }
}
