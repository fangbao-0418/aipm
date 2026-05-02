import { access, appendFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ProjectContext } from "./project-context.js";
import { formatSequentialId } from "../../shared/utils/ids.js";
import { readJsonFile, writeJsonFile } from "../../shared/utils/json.js";
import type { Requirement, ScoreRecord } from "../../shared/types/models.js";
import type { RequirementStore } from "../../domain/requirement/requirement-store.js";
import { IndexDatabase } from "../db/index-database.js";

export class RequirementRepository implements RequirementStore {
  private readonly index: IndexDatabase;

  constructor(private readonly context: ProjectContext) {
    this.index = new IndexDatabase(context);
  }

  async ensureReady() {
    await Promise.all([this.context.ensureBaseStructure(), this.index.ensureReady()]);
  }

  requirementDir(id: string) {
    return this.context.path("requirements", id);
  }

  requirementPath(id: string) {
    return this.context.path("requirements", id, "requirement.json");
  }

  scorePath(id: string) {
    return this.context.path("requirements", id, "score.json");
  }

  async nextRequirementId() {
    await this.ensureReady();
    return formatSequentialId("req", await this.index.nextRequirementSequence());
  }

  async nextScoreId() {
    await this.ensureReady();
    return formatSequentialId("score", await this.index.nextScoreSequence());
  }

  async saveRequirement(requirement: Requirement) {
    await mkdir(this.requirementDir(requirement.id), { recursive: true });
    await writeJsonFile(this.requirementPath(requirement.id), requirement);
    await this.index.upsertRequirement(requirement);
  }

  async saveScore(requirementId: string, score: ScoreRecord) {
    await mkdir(this.requirementDir(requirementId), { recursive: true });
    await writeJsonFile(this.scorePath(requirementId), score);
    await this.index.upsertScore(score);
  }

  async getRequirement(id: string) {
    return readJsonFile<Requirement>(this.requirementPath(id));
  }

  async getScore(requirementId: string) {
    return readJsonFile<ScoreRecord>(this.scorePath(requirementId));
  }

  async listRequirements() {
    await this.ensureReady();
    let ids = await this.index.listRequirementIds();
    if (ids.length === 0) {
      ids = await this.bootstrapRequirementIndexFromFiles();
    }

    const items = await Promise.all(ids.map(async (id) => this.readRequirementIfExists(id)));
    return items
      .filter((item): item is Requirement => item !== null)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async appendComment(requirementId: string, comment: string) {
    const commentPath = this.context.path("requirements", requirementId, "comments.md");
    await appendFile(commentPath, `${comment.trim()}\n\n`, "utf-8");
  }

  async appendChangelog(event: Record<string, unknown>) {
    await appendFile(
      this.context.path("versions", "changelog.jsonl"),
      `${JSON.stringify(event)}\n`,
      "utf-8"
    );
  }

  async listIndexedRequirementIds(query?: {
    status?: string;
    priority?: string;
    sourceType?: string;
    projectId?: string;
  }) {
    await this.ensureReady();
    const ids = await this.index.listRequirementIds(query);
    if (ids.length > 0) {
      return ids;
    }
    return this.bootstrapRequirementIndexFromFiles(query);
  }

  private async bootstrapRequirementIndexFromFiles(query?: {
    status?: string;
    priority?: string;
    sourceType?: string;
    projectId?: string;
  }) {
    const entries = await readdir(this.context.path("requirements"), { withFileTypes: true });
    const ids: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !/^req-\d+$/.test(entry.name)) {
        continue;
      }

      const requirement = await this.readRequirementIfExists(entry.name);
      if (!requirement) {
        continue;
      }

      await this.index.upsertRequirement(requirement);
      if (matchesRequirementQuery(requirement, query)) {
        ids.push(requirement.id);
      }
    }

    return ids.sort((left, right) => left.localeCompare(right));
  }

  private async readRequirementIfExists(id: string) {
    const path = join(this.context.path("requirements"), id, "requirement.json");
    try {
      await access(path);
      return await readJsonFile<Requirement>(path);
    } catch {
      return null;
    }
  }
}

function matchesRequirementQuery(
  requirement: Requirement,
  query?: { status?: string; priority?: string; sourceType?: string; projectId?: string }
) {
  if (!query) {
    return true;
  }
  if (query.status && requirement.status !== query.status) {
    return false;
  }
  if (query.priority && requirement.priorityLevel !== query.priority) {
    return false;
  }
  if (query.sourceType && requirement.source.type !== query.sourceType) {
    return false;
  }
  if (query.projectId && !requirement.linkedProjectIds.includes(query.projectId)) {
    return false;
  }
  return true;
}
