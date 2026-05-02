import { resolve } from "node:path";
import { ProjectContext } from "../infrastructure/files/project-context.js";
import { RequirementRepository } from "../infrastructure/files/requirement-repository.js";
import { SkillRepository } from "../infrastructure/files/skill-repository.js";
import { TaskRepository } from "../infrastructure/files/task-repository.js";
import { ArtifactRepository } from "../infrastructure/files/artifact-repository.js";
import { RequirementService } from "./requirement/requirement-service.js";
import { ScoringService } from "./scoring/scoring-service.js";
import { SkillService } from "./skills/skill-service.js";
import { TaskService } from "./task/task-service.js";
import { GenerationService } from "./generation/generation-service.js";
import { RefinementService } from "./refinement/refinement-service.js";
import { ClarifyService } from "./clarify/clarify-service.js";
import { ReviewService } from "./review/review-service.js";
import { PatchService } from "./patch/patch-service.js";
import { PipelineService } from "./pipeline/pipeline-service.js";
import { StageEditorService } from "./editor/stage-editor-service.js";
import { WorkspaceProjectRepository } from "../infrastructure/files/workspace-project-repository.js";
import { WorkspaceProjectService } from "./workspace/workspace-project-service.js";
import { StageAgentService } from "./workspace/stage-agent-service.js";
import { MainAgentOrchestratorService } from "./workspace/main-agent-orchestrator-service.js";

export function createAppRuntime(rootDir = process.cwd()) {
  const context = new ProjectContext(rootDir);
  const requirementRepository = new RequirementRepository(context);
  const skillRepository = new SkillRepository(context);
  const taskRepository = new TaskRepository(context);
  const artifactRepository = new ArtifactRepository(context);
  const workspaceProjectRepository = new WorkspaceProjectRepository(context);
  const stageAgentService = new StageAgentService(workspaceProjectRepository);
  const mainAgentOrchestratorService = new MainAgentOrchestratorService(workspaceProjectRepository, stageAgentService);

  const taskService = new TaskService(taskRepository);
  const clarifyService = new ClarifyService(requirementRepository, artifactRepository);
  const reviewService = new ReviewService(requirementRepository, artifactRepository, clarifyService);
  const patchService = new PatchService(requirementRepository, artifactRepository);
  const generationService = new GenerationService(requirementRepository, artifactRepository, context, undefined, clarifyService);
  const stageEditorService = new StageEditorService(requirementRepository, artifactRepository);

  return {
    context,
    requirementRepository,
    skillRepository,
    taskRepository,
    artifactRepository,
    workspaceProjectRepository,
    requirementService: new RequirementService(requirementRepository),
    scoringService: new ScoringService(
      requirementRepository,
      resolve(context.rootDir, "configs", "default-priority-weights.json")
    ),
    skillService: new SkillService(skillRepository),
    taskService,
    clarifyService,
    reviewService,
    patchService,
    stageEditorService,
    generationService,
    pipelineService: new PipelineService(clarifyService, generationService, reviewService, patchService),
    refinementService: new RefinementService(requirementRepository, artifactRepository, taskService, patchService, context),
    stageAgentService,
    mainAgentOrchestratorService,
    workspaceProjectService: new WorkspaceProjectService(workspaceProjectRepository, mainAgentOrchestratorService)
  };
}
