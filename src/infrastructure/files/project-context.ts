import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export class ProjectContext {
  readonly rootDir: string;

  constructor(rootDir = process.cwd()) {
    this.rootDir = rootDir;
  }

  path(...parts: string[]) {
    return join(this.rootDir, ...parts);
  }

  async ensureBaseStructure() {
    await Promise.all([
      mkdir(this.path("requirements"), { recursive: true }),
      mkdir(this.path("skills"), { recursive: true }),
      mkdir(this.path("tasks"), { recursive: true }),
      mkdir(this.path("workspace", "projects"), { recursive: true }),
      mkdir(this.path("versions", "snapshots"), { recursive: true }),
      mkdir(this.path("logs"), { recursive: true }),
      mkdir(this.path("data"), { recursive: true })
    ]);
  }
}
