import { requirementSchema, type PriorityLevel, type Requirement, type RequirementStatus, type SourceChannel, type SourceType } from "../../shared/types/models.js";
import type { PersonRef } from "../../shared/types/models.js";
import { nowIso } from "../../shared/utils/time.js";
import { stageTransitions } from "../../shared/constants/lifecycle.js";
import type { RequirementStore } from "../../domain/requirement/requirement-store.js";

export interface AddRequirementInput {
  title: string;
  sourceType: SourceType;
  sourceName: string;
  sourceChannel?: SourceChannel;
  sourceDetail?: string;
  content: string;
  priorityLevel?: PriorityLevel;
  ownerName?: string;
  projectId?: string;
  tags?: string[];
}

export interface RequirementListQuery {
  status?: RequirementStatus;
  priority?: PriorityLevel;
  sourceType?: SourceType;
  projectId?: string;
}

export interface StageRequirementInput {
  to: RequirementStatus;
  reason?: string;
  by?: PersonRef;
}

export class RequirementService {
  constructor(private readonly repository: RequirementStore) {}

  async add(input: AddRequirementInput) {
    const id = await this.repository.nextRequirementId();
    const createdAt = nowIso();
    const owner = input.ownerName
      ? { id: slugify(input.ownerName), name: input.ownerName }
      : undefined;

    const requirement = requirementSchema.parse({
      id,
      title: input.title,
      source: {
        type: input.sourceType,
        name: input.sourceName,
        channel: input.sourceChannel
      },
      sourceDetail: input.sourceDetail,
      rawContent: input.content,
      status: "captured",
      priorityLevel: input.priorityLevel ?? null,
      owner,
      linkedProjectIds: input.projectId ? [input.projectId] : [],
      tags: input.tags ?? [],
      stageHistory: [
        {
          from: null,
          to: "captured",
          changedAt: createdAt,
          reason: "Requirement created"
        }
      ],
      version: {
        schemaVersion: "1.0.0",
        revision: 1
      },
      createdAt,
      updatedAt: createdAt
    });

    await this.repository.saveRequirement(requirement);
    await this.repository.appendChangelog({
      type: "requirement.created",
      requirementId: requirement.id,
      at: createdAt
    });

    return requirement;
  }

  async get(id: string) {
    return this.repository.getRequirement(id);
  }

  async list(query: RequirementListQuery = {}) {
    const requirements = await this.repository.listRequirements();
    return requirements.filter((item) => {
      if (query.status && item.status !== query.status) {
        return false;
      }
      if (query.priority && item.priorityLevel !== query.priority) {
        return false;
      }
      if (query.sourceType && item.source.type !== query.sourceType) {
        return false;
      }
      if (query.projectId && !item.linkedProjectIds.includes(query.projectId)) {
        return false;
      }
      return true;
    });
  }

  async stage(id: string, input: StageRequirementInput) {
    const current = await this.repository.getRequirement(id);
    const allowed = stageTransitions[current.status];

    if (!allowed.includes(input.to)) {
      throw new Error(`Invalid transition: ${current.status} -> ${input.to}`);
    }

    const changedAt = nowIso();
    const updated: Requirement = {
      ...current,
      status: input.to,
      updatedAt: changedAt,
      updatedBy: input.by,
      stageHistory: [
        ...current.stageHistory,
        {
          from: current.status,
          to: input.to,
          reason: input.reason,
          changedAt,
          changedBy: input.by
        }
      ],
      version: {
        ...current.version,
        revision: current.version.revision + 1
      }
    };

    await this.repository.saveRequirement(updated);
    await this.repository.appendChangelog({
      type: "requirement.staged",
      requirementId: id,
      from: current.status,
      to: input.to,
      at: changedAt
    });

    return updated;
  }

  async appendComment(id: string, comment: string) {
    await this.repository.appendComment(id, comment);
    await this.repository.appendChangelog({
      type: "requirement.comment",
      requirementId: id,
      at: nowIso()
    });
  }
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
