import type { RequirementStatus } from "../types/models.js";

export const stageTransitions: Record<RequirementStatus, RequirementStatus[]> = {
  captured: ["triaged", "archived"],
  triaged: ["clarifying", "archived"],
  clarifying: ["triaged", "modeled", "archived"],
  modeled: ["clarifying", "prd_ready", "archived"],
  prd_ready: ["clarifying", "reviewing", "wireframe_ready", "archived"],
  wireframe_ready: ["prd_ready", "reviewing", "ui_ready", "archived"],
  ui_ready: ["wireframe_ready", "reviewing", "approved", "archived"],
  reviewing: ["clarifying", "prd_ready", "wireframe_ready", "ui_ready", "approved", "archived"],
  approved: ["reviewing", "archived"],
  archived: []
};
