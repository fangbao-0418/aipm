import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PriorityLevel, RequirementStatus, SourceChannel, SourceType } from "../shared/types/models.js";
import { printRequirementList, printRequirementSummary, printScoreSummary } from "./output.js";
import { printSkillDetail, printSkillList } from "./skills-output.js";
import type { TaskStatus, TaskType } from "../shared/types/tasks.js";
import { printTaskList, printTaskSummary } from "./task-output.js";
import { createAppRuntime } from "../application/runtime.js";

export function createCli() {
  const program = new Command();
  const runtime = createAppRuntime();
  const {
    requirementRepository: repository,
    artifactRepository,
    requirementService,
    scoringService,
    skillService,
    taskService,
    generationService
  } = runtime;

  program
    .name("aipm")
    .description("Local-first AI product management CLI")
    .version("0.1.0");

  const req = program.command("req").description("Manage requirements");

  req
    .command("add")
    .requiredOption("--title <text>", "Requirement title")
    .requiredOption("--source <type>", "Requirement source type")
    .requiredOption("--source-name <name>", "Requirement source name")
    .option("--channel <channel>", "Requirement source channel")
    .option("--source-detail <text>", "Source detail")
    .option("--content <text>", "Requirement content")
    .option("--file <path>", "Read requirement content from file")
    .option("--priority <level>", "Priority level")
    .option("--owner <name>", "Owner name")
    .option("--project <projectId>", "Linked project id")
    .option("--tag <tag>", "Tag", collectValues, [])
    .action(async (options) => {
      const content = options.content ?? (options.file ? await readFile(resolve(options.file), "utf-8") : "");
      if (!content.trim()) {
        throw new Error("Requirement content is required via --content or --file");
      }

      const requirement = await requirementService.add({
        title: options.title,
        sourceType: options.source as SourceType,
        sourceName: options.sourceName,
        sourceChannel: options.channel as SourceChannel | undefined,
        sourceDetail: options.sourceDetail,
        content,
        priorityLevel: (options.priority as PriorityLevel | undefined) ?? undefined,
        ownerName: options.owner,
        projectId: options.project,
        tags: options.tag
      });
      printRequirementSummary(requirement);
    });

  req
    .command("list")
    .option("--status <status>", "Filter by requirement status")
    .option("--priority <level>", "Filter by priority level")
    .option("--source <type>", "Filter by source type")
    .option("--project <projectId>", "Filter by project id")
    .option("--json", "Output raw JSON")
    .action(async (options) => {
      const requirements = await requirementService.list({
        status: options.status as RequirementStatus | undefined,
        priority: options.priority as PriorityLevel | undefined,
        sourceType: options.source as SourceType | undefined,
        projectId: options.project
      });

      if (options.json) {
        console.log(JSON.stringify(requirements, null, 2));
        return;
      }

      printRequirementList(requirements);
    });

  req
    .command("view")
    .argument("<id>", "Requirement id")
    .option("--json", "Output raw JSON")
    .option("--score", "Include score if present")
    .action(async (id: string, options) => {
      const requirement = await requirementService.get(id);
      if (options.json) {
        const payload: Record<string, unknown> = { requirement };
        if (options.score) {
          try {
            payload.score = await repository.getScore(id);
          } catch {
            payload.score = null;
          }
        }
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      printRequirementSummary(requirement);
      console.log("");
      console.log(requirement.rawContent);
      if (options.score) {
        try {
          const score = await repository.getScore(id);
          console.log("");
          printScoreSummary(score);
        } catch {
          console.log("");
          console.log("No score recorded.");
        }
      }
    });

  req
    .command("stage")
    .argument("<id>", "Requirement id")
    .requiredOption("--to <status>", "Target status")
    .option("--reason <text>", "Stage change reason")
    .action(async (id: string, options) => {
      const updated = await requirementService.stage(id, {
        to: options.to as RequirementStatus,
        reason: options.reason
      });
      printRequirementSummary(updated);
    });

  req
    .command("score")
    .argument("<id>", "Requirement id")
    .requiredOption("--user-value <n>", "User value score")
    .requiredOption("--business-value <n>", "Business value score")
    .requiredOption("--strategic-fit <n>", "Strategic fit score")
    .requiredOption("--urgency <n>", "Urgency score")
    .requiredOption("--reach <n>", "Reach score")
    .requiredOption("--implementation-cost <n>", "Implementation cost score")
    .requiredOption("--delivery-risk <n>", "Delivery risk score")
    .option("--reason <text>", "Scoring reason")
    .option("--override-level <level>", "Override priority level")
    .option("--override-reason <text>", "Override reason")
    .action(async (id: string, options) => {
      const score = await scoringService.scoreRequirement({
        requirementId: id,
        scores: {
          userValue: toScore(options.userValue),
          businessValue: toScore(options.businessValue),
          strategicFit: toScore(options.strategicFit),
          urgency: toScore(options.urgency),
          reach: toScore(options.reach),
          implementationCost: toScore(options.implementationCost),
          deliveryRisk: toScore(options.deliveryRisk)
        },
        reason: options.reason,
        overrideLevel: options.overrideLevel as PriorityLevel | undefined,
        overrideReason: options.overrideReason
      });
      printScoreSummary(score);
    });

  req
    .command("prioritize")
    .option("--json", "Output raw JSON")
    .action(async (options) => {
      const requirements = await scoringService.prioritize();
      if (options.json) {
        console.log(JSON.stringify(requirements, null, 2));
        return;
      }
      printRequirementList(requirements);
    });

  const model = program.command("model").description("Generate and inspect product models");

  model
    .command("generate")
    .requiredOption("--requirement <id>", "Source requirement id")
    .action(async (options) => {
      const result = await generationService.generateProductModel(options.requirement);
      console.log(`Generated product model for ${result.productModel.meta.requirementId}`);
      console.log(`features: ${result.productModel.features.length}`);
      console.log(`pages: ${result.productModel.pages.length}`);
    });

  model
    .command("view")
    .requiredOption("--requirement <id>", "Source requirement id")
    .action(async (options) => {
      const model = await artifactRepository.getProductModel(options.requirement);
      console.log(JSON.stringify(model, null, 2));
    });

  const prd = program.command("prd").description("Generate and inspect PRD artifacts");

  prd
    .command("generate")
    .requiredOption("--requirement <id>", "Source requirement id")
    .action(async (options) => {
      const result = await generationService.generatePrd(options.requirement);
      console.log(`Generated PRD for ${result.productModel.meta.requirementId}`);
      console.log(`path: artifacts/${result.productModel.meta.requirementId}/prd/prd.md`);
    });

  prd
    .command("view")
    .requiredOption("--requirement <id>", "Source requirement id")
    .option("--json", "Output structured PRD JSON instead of markdown")
    .action(async (options) => {
      if (options.json) {
        const prdDocument = await artifactRepository.getPrdDocument(options.requirement);
        console.log(JSON.stringify(prdDocument, null, 2));
        return;
      }
      const markdown = await artifactRepository.getPrdMarkdown(options.requirement);
      console.log(markdown);
    });

  prd
    .command("validate")
    .requiredOption("--requirement <id>", "Source requirement id")
    .action(async (options) => {
      const validation = await generationService.validatePrd(options.requirement);
      console.log(JSON.stringify(validation, null, 2));
    });

  prd
    .command("compare")
    .requiredOption("--requirement <id>", "Source requirement id")
    .requiredOption("--competitor <name>", "Competitor name", collectValues, [])
    .action(async (options) => {
      const analysis = await generationService.comparePrd(options.requirement, options.competitor);
      console.log(JSON.stringify(analysis, null, 2));
    });

  const wireframe = program.command("wireframe").description("Generate and inspect wireframes");

  wireframe
    .command("generate")
    .requiredOption("--requirement <id>", "Source requirement id")
    .action(async (options) => {
      const spec = await generationService.generateWireframe(options.requirement);
      console.log(`Generated wireframe spec for ${options.requirement}`);
      console.log(`pages: ${spec.pages.length}`);
    });

  wireframe
    .command("annotate")
    .requiredOption("--requirement <id>", "Source requirement id")
    .action(async (options) => {
      const annotations = await generationService.annotateWireframe(options.requirement);
      console.log(`Generated wireframe annotations for ${options.requirement}`);
      console.log(`annotations: ${annotations.annotations.length}`);
    });

  wireframe
    .command("view")
    .requiredOption("--requirement <id>", "Source requirement id")
    .option("--page <pageId>", "Wireframe page id")
    .option("--annotations", "View annotation json")
    .option("--json", "View wireframe spec json")
    .action(async (options) => {
      if (options.annotations) {
        const annotations = await artifactRepository.getWireframeAnnotations(options.requirement);
        console.log(JSON.stringify(annotations, null, 2));
        return;
      }
      if (options.page) {
        const html = await artifactRepository.getWireframePage(options.requirement, options.page);
        console.log(html);
        return;
      }
      const spec = await artifactRepository.getWireframeSpec(options.requirement);
      console.log(JSON.stringify(spec, null, 2));
    });

  const ui = program.command("ui").description("Generate and inspect UI artifacts");

  ui
    .command("generate")
    .requiredOption("--requirement <id>", "Source requirement id")
    .action(async (options) => {
      const design = await generationService.generateUi(options.requirement);
      console.log(`Generated UI design for ${options.requirement}`);
      console.log(`pages: ${design.pages.length}`);
    });

  ui
    .command("view")
    .requiredOption("--requirement <id>", "Source requirement id")
    .option("--page <pageId>", "UI page id")
    .option("--json", "View UI design json")
    .action(async (options) => {
      if (options.page) {
        const html = await artifactRepository.getUiPage(options.requirement, options.page);
        console.log(html);
        return;
      }
      const design = await artifactRepository.getUiDesign(options.requirement);
      console.log(JSON.stringify(design, null, 2));
    });

  const task = program.command("task").description("Manage execution tasks");

  task
    .command("create")
    .requiredOption("--title <text>", "Task title")
    .requiredOption("--type <type>", "Task type")
    .requiredOption("--priority <level>", "Task priority")
    .requiredOption("--requirement <id>", "Source requirement id", collectValues, [])
    .option("--description <text>", "Task description")
    .option("--version <id>", "Source version id")
    .option("--owner <name>", "Owner name")
    .option("--assignee <name>", "Assignee name", collectValues, [])
    .option("--depends-on <id>", "Dependency task id", collectValues, [])
    .option("--acceptance <text>", "Acceptance criteria", collectValues, [])
    .option("--due <date>", "Due date")
    .action(async (options) => {
      const created = await taskService.create({
        title: options.title,
        description: options.description,
        type: options.type as TaskType,
        priority: options.priority as PriorityLevel,
        sourceRequirementIds: options.requirement,
        sourceVersionId: options.version,
        ownerName: options.owner,
        assigneeNames: options.assignee,
        dependencies: options.dependsOn,
        acceptanceCriteria: options.acceptance,
        dueDate: options.due
      });
      printTaskSummary(created);
    });

  task
    .command("list")
    .option("--json", "Output raw JSON")
    .action(async (options) => {
      const tasks = await taskService.list();
      if (options.json) {
        console.log(JSON.stringify(tasks, null, 2));
        return;
      }
      printTaskList(tasks);
    });

  task
    .command("view")
    .argument("<id>", "Task id")
    .option("--json", "Output raw JSON")
    .action(async (id: string, options) => {
      const taskRecord = await taskService.get(id);
      if (options.json) {
        console.log(JSON.stringify(taskRecord, null, 2));
        return;
      }
      printTaskSummary(taskRecord);
      if (taskRecord.description) {
        console.log("");
        console.log(taskRecord.description);
      }
    });

  task
    .command("update")
    .argument("<id>", "Task id")
    .option("--status <status>", "Task status")
    .option("--priority <level>", "Task priority")
    .option("--owner <name>", "Owner name")
    .option("--add-dependency <id>", "Dependency task id", collectValues, [])
    .option("--remove-dependency <id>", "Dependency task id", collectValues, [])
    .option("--append-comment <text>", "Append task comment")
    .option("--due <date>", "Due date")
    .action(async (id: string, options) => {
      const updated = await taskService.update(id, {
        status: options.status as TaskStatus | undefined,
        priority: options.priority as PriorityLevel | undefined,
        ownerName: options.owner,
        addDependency: options.addDependency,
        removeDependency: options.removeDependency,
        appendComment: options.appendComment,
        dueDate: options.due
      });
      printTaskSummary(updated);
    });

  task
    .command("board")
    .action(async () => {
      const tasks = await taskService.list();
      printTaskList(tasks);
    });

  const skill = program.command("skill").description("Manage reusable skills");

  skill
    .command("list")
    .option("--stage <stage>", "Filter skills by stage")
    .option("--json", "Output raw JSON")
    .action(async (options) => {
      const skills = await skillService.list(options.stage);
      if (options.json) {
        console.log(JSON.stringify(await skillService.summarize(skills), null, 2));
        return;
      }
      printSkillList(skills);
    });

  skill
    .command("view")
    .argument("<id>", "Skill id")
    .option("--json", "Output raw JSON")
    .action(async (id: string, options) => {
      const loaded = await skillService.get(id);
      if (options.json) {
        console.log(JSON.stringify(loaded, null, 2));
        return;
      }
      printSkillDetail(loaded);
    });

  program
    .command("workspace")
    .description("Start the local AIPM workspace")
    .option("--host <host>", "Bind host", "127.0.0.1")
    .option("--port <port>", "Bind port", "4310")
    .option("--no-open", "Do not open the browser automatically")
    .action(async (options) => {
      const { startWorkspaceServer } = await import("../studio/server.js");
      await startWorkspaceServer({
        host: options.host,
        port: Number(options.port),
        open: options.open
      });
    });

  program
    .command("studio")
    .description("Legacy alias for `aipm workspace`")
    .option("--host <host>", "Bind host", "127.0.0.1")
    .option("--port <port>", "Bind port", "4310")
    .option("--no-open", "Do not open the browser automatically")
    .action(async (options) => {
      const { startWorkspaceServer } = await import("../studio/server.js");
      await startWorkspaceServer({
        host: options.host,
        port: Number(options.port),
        open: options.open
      });
    });

  return program;
}

function collectValues(value: string, previous: string[]) {
  return [...previous, value];
}

function toScore(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    throw new Error(`Invalid score "${value}". Expected an integer from 1 to 5.`);
  }
  return parsed;
}
