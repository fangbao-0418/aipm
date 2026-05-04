import { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import type { Requirement, ScoreRecord } from "../../shared/types/models.js";
import type { Task } from "../../shared/types/tasks.js";
import type {
  WorkspaceProjectDocumentMeta,
  WorkspaceProjectDocumentVersion
} from "../../shared/types/workspace.js";
import { ProjectContext } from "../files/project-context.js";

interface RequirementIndexQuery {
  status?: string;
  priority?: string;
  sourceType?: string;
  projectId?: string;
}

export class IndexDatabase {
  private db?: DatabaseSync;

  constructor(private readonly context: ProjectContext) {}

  async ensureReady() {
    await this.context.ensureBaseStructure();
    await mkdir(this.context.path("data"), { recursive: true });

    if (!this.db) {
      this.db = new DatabaseSync(this.context.path("data", "app.db"));
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS requirements (
          id TEXT PRIMARY KEY,
          seq INTEGER NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          priority_level TEXT,
          priority_score REAL,
          source_type TEXT NOT NULL,
          project_ids_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scores (
          id TEXT PRIMARY KEY,
          seq INTEGER NOT NULL,
          requirement_id TEXT NOT NULL UNIQUE,
          priority_level TEXT NOT NULL,
          priority_score REAL NOT NULL,
          value_score REAL NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          seq INTEGER NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          type TEXT NOT NULL,
          priority TEXT NOT NULL,
          source_requirement_ids_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS artifacts (
          requirement_id TEXT NOT NULL,
          artifact_type TEXT NOT NULL,
          artifact_path TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (requirement_id, artifact_type)
        );

        CREATE TABLE IF NOT EXISTS workspace_documents (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0,
          content_file_path TEXT NOT NULL,
          html_file_path TEXT NOT NULL,
          text_file_path TEXT NOT NULL,
          latest_version_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_workspace_documents_project_updated
        ON workspace_documents(project_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_workspace_documents_project_sort
        ON workspace_documents(project_id, sort_order ASC);

        CREATE TABLE IF NOT EXISTS workspace_document_versions (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          version_number INTEGER NOT NULL,
          summary TEXT NOT NULL,
          snapshot_file_path TEXT NOT NULL,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_workspace_document_versions_document
        ON workspace_document_versions(document_id, version_number DESC);
      `);
    }
  }

  async nextRequirementSequence() {
    await this.ensureReady();
    const row = this.db!.prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM requirements").get() as { maxSeq: number };
    return row.maxSeq + 1;
  }

  async nextScoreSequence() {
    await this.ensureReady();
    const row = this.db!.prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM scores").get() as { maxSeq: number };
    return row.maxSeq + 1;
  }

  async nextTaskSequence() {
    await this.ensureReady();
    const row = this.db!.prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM tasks").get() as { maxSeq: number };
    return row.maxSeq + 1;
  }

  async upsertRequirement(requirement: Requirement) {
    await this.ensureReady();
    this.db!.prepare(`
      INSERT INTO requirements (id, seq, title, status, priority_level, priority_score, source_type, project_ids_json, updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        seq = excluded.seq,
        title = excluded.title,
        status = excluded.status,
        priority_level = excluded.priority_level,
        priority_score = excluded.priority_score,
        source_type = excluded.source_type,
        project_ids_json = excluded.project_ids_json,
        updated_at = excluded.updated_at,
        created_at = excluded.created_at
    `).run(
      requirement.id,
      sequenceFromId(requirement.id),
      requirement.title,
      requirement.status,
      requirement.priorityLevel,
      requirement.priorityScore,
      requirement.source.type,
      JSON.stringify(requirement.linkedProjectIds),
      requirement.updatedAt,
      requirement.createdAt
    );
  }

  async upsertScore(score: ScoreRecord) {
    await this.ensureReady();
    this.db!.prepare(`
      INSERT INTO scores (id, seq, requirement_id, priority_level, priority_score, value_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        seq = excluded.seq,
        requirement_id = excluded.requirement_id,
        priority_level = excluded.priority_level,
        priority_score = excluded.priority_score,
        value_score = excluded.value_score,
        created_at = excluded.created_at
    `).run(
      score.id,
      sequenceFromId(score.id),
      score.requirementId,
      score.priorityLevel,
      score.priorityScore,
      score.valueScore,
      score.createdAt
    );
  }

  async upsertTask(task: Task) {
    await this.ensureReady();
    this.db!.prepare(`
      INSERT INTO tasks (id, seq, title, status, type, priority, source_requirement_ids_json, updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        seq = excluded.seq,
        title = excluded.title,
        status = excluded.status,
        type = excluded.type,
        priority = excluded.priority,
        source_requirement_ids_json = excluded.source_requirement_ids_json,
        updated_at = excluded.updated_at,
        created_at = excluded.created_at
    `).run(
      task.id,
      sequenceFromId(task.id),
      task.title,
      task.status,
      task.type,
      task.priority,
      JSON.stringify(task.sourceRequirementIds),
      task.updatedAt,
      task.createdAt
    );
  }

  async upsertArtifact(requirementId: string, artifactType: string, artifactPath: string, updatedAt: string) {
    await this.ensureReady();
    this.db!.prepare(`
      INSERT INTO artifacts (requirement_id, artifact_type, artifact_path, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(requirement_id, artifact_type) DO UPDATE SET
        artifact_path = excluded.artifact_path,
        updated_at = excluded.updated_at
    `).run(requirementId, artifactType, artifactPath, updatedAt);
  }

  async upsertWorkspaceDocumentMeta(meta: WorkspaceProjectDocumentMeta) {
    await this.ensureReady();
    this.db!.prepare(`
      INSERT INTO workspace_documents (
        id, project_id, title, sort_order, deleted, content_file_path, html_file_path, text_file_path, latest_version_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        title = excluded.title,
        sort_order = excluded.sort_order,
        deleted = excluded.deleted,
        content_file_path = excluded.content_file_path,
        html_file_path = excluded.html_file_path,
        text_file_path = excluded.text_file_path,
        latest_version_id = excluded.latest_version_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      meta.id,
      meta.projectId,
      meta.title,
      meta.sortOrder,
      meta.deleted ? 1 : 0,
      meta.contentFilePath,
      meta.htmlFilePath,
      meta.textFilePath,
      meta.latestVersionId ?? null,
      meta.createdAt,
      meta.updatedAt
    );
  }

  async listWorkspaceDocumentMetas(projectId: string) {
    await this.ensureReady();
    const rows = this.db!.prepare(`
      SELECT
        id,
        project_id,
        title,
        sort_order,
        deleted,
        content_file_path,
        html_file_path,
        text_file_path,
        latest_version_id,
        created_at,
        updated_at
      FROM workspace_documents
      WHERE project_id = ?
      ORDER BY sort_order ASC, updated_at DESC
    `).all(projectId) as Array<{
      id: string;
      project_id: string;
      title: string;
      sort_order: number;
      deleted: number;
      content_file_path: string;
      html_file_path: string;
      text_file_path: string;
      latest_version_id: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      sortOrder: row.sort_order,
      deleted: Boolean(row.deleted),
      contentFilePath: row.content_file_path,
      htmlFilePath: row.html_file_path,
      textFilePath: row.text_file_path,
      latestVersionId: row.latest_version_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async getWorkspaceDocumentMeta(projectId: string, documentId: string) {
    await this.ensureReady();
    const row = this.db!.prepare(`
      SELECT
        id,
        project_id,
        title,
        sort_order,
        deleted,
        content_file_path,
        html_file_path,
        text_file_path,
        latest_version_id,
        created_at,
        updated_at
      FROM workspace_documents
      WHERE project_id = ? AND id = ?
      LIMIT 1
    `).get(projectId, documentId) as {
      id: string;
      project_id: string;
      title: string;
      sort_order: number;
      deleted: number;
      content_file_path: string;
      html_file_path: string;
      text_file_path: string;
      latest_version_id: string | null;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      sortOrder: row.sort_order,
      deleted: Boolean(row.deleted),
      contentFilePath: row.content_file_path,
      htmlFilePath: row.html_file_path,
      textFilePath: row.text_file_path,
      latestVersionId: row.latest_version_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async deleteWorkspaceDocumentMeta(projectId: string, documentId: string) {
    await this.ensureReady();
    this.db!.prepare(`
      DELETE FROM workspace_documents
      WHERE project_id = ? AND id = ?
    `).run(projectId, documentId);

    this.db!.prepare(`
      DELETE FROM workspace_document_versions
      WHERE project_id = ? AND document_id = ?
    `).run(projectId, documentId);
  }

  async upsertWorkspaceDocumentVersion(version: WorkspaceProjectDocumentVersion) {
    await this.ensureReady();
    this.db!.prepare(`
      INSERT INTO workspace_document_versions (
        id, document_id, project_id, version_number, summary, snapshot_file_path, source, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        document_id = excluded.document_id,
        project_id = excluded.project_id,
        version_number = excluded.version_number,
        summary = excluded.summary,
        snapshot_file_path = excluded.snapshot_file_path,
        source = excluded.source,
        created_at = excluded.created_at
    `).run(
      version.id,
      version.documentId,
      version.projectId,
      version.versionNumber,
      version.summary,
      version.snapshotFilePath,
      version.source,
      version.createdAt
    );
  }

  async listWorkspaceDocumentVersions(projectId: string, documentId: string) {
    await this.ensureReady();
    const rows = this.db!.prepare(`
      SELECT
        id,
        document_id,
        project_id,
        version_number,
        summary,
        snapshot_file_path,
        source,
        created_at
      FROM workspace_document_versions
      WHERE project_id = ? AND document_id = ?
      ORDER BY version_number DESC
    `).all(projectId, documentId) as Array<{
      id: string;
      document_id: string;
      project_id: string;
      version_number: number;
      summary: string;
      snapshot_file_path: string;
      source: WorkspaceProjectDocumentVersion["source"];
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      projectId: row.project_id,
      versionNumber: row.version_number,
      summary: row.summary,
      snapshotFilePath: row.snapshot_file_path,
      source: row.source,
      createdAt: row.created_at
    }));
  }

  async listRequirementIds(query: RequirementIndexQuery = {}) {
    await this.ensureReady();
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (query.status) {
      conditions.push("status = ?");
      values.push(query.status);
    }
    if (query.priority) {
      conditions.push("priority_level = ?");
      values.push(query.priority);
    }
    if (query.sourceType) {
      conditions.push("source_type = ?");
      values.push(query.sourceType);
    }
    if (query.projectId) {
      conditions.push("project_ids_json LIKE ?");
      values.push(`%\"${query.projectId}\"%`);
    }

    const sql = `
      SELECT id FROM requirements
      ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY seq ASC
    `;
    const rows = this.db!.prepare(sql).all(...(values as never[])) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  async listTaskIds() {
    await this.ensureReady();
    const rows = this.db!.prepare("SELECT id FROM tasks ORDER BY seq ASC").all() as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }
}

function sequenceFromId(id: string) {
  const numeric = Number(id.replace(/^[a-z-]+/, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}
