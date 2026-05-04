import type {
  WorkspaceRequirementDocument,
  WorkspaceRequirementDocumentVersion
} from "../types";
import {
  createWorkspaceDocument,
  deleteWorkspaceDocument,
  getWorkspaceDocumentVersion,
  getWorkspaceDocument,
  listWorkspaceDocuments,
  listWorkspaceDocumentVersions,
  reorderWorkspaceDocuments,
  restoreWorkspaceDocumentVersion,
  saveWorkspaceDocument
} from "../utils/workspace-api";

export interface DocumentRepository {
  list(projectId: string): Promise<WorkspaceRequirementDocument[]>;
  create(projectId: string, input?: { title?: string }): Promise<WorkspaceRequirementDocument>;
  get(projectId: string, documentId: string): Promise<WorkspaceRequirementDocument | null>;
  save(projectId: string, document: WorkspaceRequirementDocument): Promise<WorkspaceRequirementDocument>;
  delete(projectId: string, documentId: string): Promise<void>;
  reorder(projectId: string, orderedIds: string[]): Promise<WorkspaceRequirementDocument[]>;
  listVersions(projectId: string, documentId: string): Promise<WorkspaceRequirementDocumentVersion[]>;
  getVersion(projectId: string, documentId: string, versionId: string): Promise<WorkspaceRequirementDocument | null>;
  restoreVersion(projectId: string, documentId: string, versionId: string): Promise<WorkspaceRequirementDocument>;
}

class WorkspaceApiDocumentRepository implements DocumentRepository {
  async list(projectId: string): Promise<WorkspaceRequirementDocument[]> {
    return listWorkspaceDocuments(projectId);
  }

  async create(projectId: string, input?: { title?: string }): Promise<WorkspaceRequirementDocument> {
    return createWorkspaceDocument(projectId, input);
  }

  async get(projectId: string, documentId: string): Promise<WorkspaceRequirementDocument | null> {
    try {
      return await getWorkspaceDocument(projectId, documentId);
    } catch {
      return null;
    }
  }

  async save(projectId: string, document: WorkspaceRequirementDocument): Promise<WorkspaceRequirementDocument> {
    return saveWorkspaceDocument(projectId, document.id, document);
  }

  async delete(projectId: string, documentId: string): Promise<void> {
    await deleteWorkspaceDocument(projectId, documentId);
  }

  async reorder(projectId: string, orderedIds: string[]): Promise<WorkspaceRequirementDocument[]> {
    return reorderWorkspaceDocuments(projectId, orderedIds);
  }

  async listVersions(projectId: string, documentId: string): Promise<WorkspaceRequirementDocumentVersion[]> {
    return listWorkspaceDocumentVersions(projectId, documentId);
  }

  async getVersion(projectId: string, documentId: string, versionId: string): Promise<WorkspaceRequirementDocument | null> {
    try {
      return await getWorkspaceDocumentVersion(projectId, documentId, versionId);
    } catch {
      return null;
    }
  }

  async restoreVersion(projectId: string, documentId: string, versionId: string): Promise<WorkspaceRequirementDocument> {
    return restoreWorkspaceDocumentVersion(projectId, documentId, versionId);
  }
}

export function createDocumentRepository(): DocumentRepository {
  return new WorkspaceApiDocumentRepository();
}
