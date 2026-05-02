import test from "node:test";
import assert from "node:assert/strict";
import { buildFallbackChatDecision, classifyChatInput } from "./chat-rules.js";
import type { WorkspaceRequirementCollection } from "../../shared/types/workspace.js";

function createCollection(): WorkspaceRequirementCollection {
  return {
    projectName: "AIPM",
    rawInputs: [],
    sourceRecords: [],
    uploadedFiles: [],
    extractedHighlights: [],
    aiSummary: "当前还没有正式整理。",
    requirementsDocument: "# AIPM 需求点文档",
    requirementsDocumentHtml: "<h1>AIPM 需求点文档</h1>",
    structuredSnapshot: {
      userGoals: [],
      coreScenarios: [],
      coreFunctions: [],
      constraints: []
    },
    followupQuestions: ["目标用户是谁？"],
    lastOrganizedAt: new Date().toISOString()
  };
}

test("classifyChatInput identifies question", () => {
  assert.equal(classifyChatInput("我现在有多少条需求？"), "question");
});

test("classifyChatInput identifies document generation instruction", () => {
  assert.equal(classifyChatInput("整理成需求文档"), "document_generation_instruction");
});

test("classifyChatInput identifies modification instruction", () => {
  assert.equal(classifyChatInput("把这一段合并进当前文档"), "modification_instruction");
});

test("classifyChatInput identifies modification instruction from rewrite request", () => {
  assert.equal(classifyChatInput("把目标用户改成中小团队负责人"), "modification_instruction");
});

test("classifyChatInput identifies explicit stage generation instruction", () => {
  assert.equal(classifyChatInput("进入下一阶段，生成需求结构化"), "document_generation_instruction");
});

test("classifyChatInput identifies doc action for prototype generation", () => {
  assert.equal(classifyChatInput("帮我生成原型"), "document_generation_instruction");
});

test("classifyChatInput identifies doc action for requirement document cleanup", () => {
  assert.equal(classifyChatInput("帮我整理一下需求点文档"), "document_generation_instruction");
});

test("classifyChatInput identifies requirement description", () => {
  assert.equal(classifyChatInput("我想做一个任务管理应用，帮助团队协作和追踪项目进度"), "requirement_description");
});

test("classifyChatInput keeps stage explanation requests as questions", () => {
  assert.equal(classifyChatInput("进入下一阶段需求结构化是做什么的，能产出什么？"), "question");
});

test("classifyChatInput keeps comparison questions as questions", () => {
  assert.equal(classifyChatInput("需求整理和PRD有什么区别？"), "question");
});

test("fallback chat decision answers questions directly", () => {
  const decision = buildFallbackChatDecision("为什么这个阶段要做需求结构化？", createCollection());
  assert.equal(decision.mode, "answer");
  assert.equal(decision.shouldCapture, false);
  assert.match(decision.reply, /我先直接回答这个问题/);
});

test("fallback chat decision auto-captures requirement descriptions", () => {
  const decision = buildFallbackChatDecision("我想做一个任务管理应用，帮助团队协作和追踪项目进度", createCollection());
  assert.equal(decision.mode, "capture");
  assert.equal(decision.shouldCapture, true);
  assert.match(decision.reply, /并入当前阶段文档/);
});

test("fallback chat decision captures explicit document actions", () => {
  const decision = buildFallbackChatDecision("整理成需求文档", createCollection());
  assert.equal(decision.shouldCapture, true);
  assert.equal(decision.mode, "capture");
  assert.match(decision.reply, /生成或更新对应阶段文档/);
});

test("fallback chat decision captures modification actions", () => {
  const decision = buildFallbackChatDecision("把目标用户改成中小团队负责人", createCollection());
  assert.equal(decision.shouldCapture, true);
  assert.equal(decision.mode, "capture");
  assert.match(decision.reply, /更新当前阶段文档/);
});

test("fallback chat decision completes current stage work for explicit requirement descriptions", () => {
  const decision = buildFallbackChatDecision("我想开发一个宠物平台，支持寄养、洗护和商城", createCollection());
  assert.equal(decision.mode, "capture");
  assert.equal(decision.shouldCapture, true);
});

test("fallback chat decision keeps comparison questions as answers", () => {
  const decision = buildFallbackChatDecision("需求整理和PRD有什么区别？", createCollection());
  assert.equal(decision.mode, "answer");
  assert.equal(decision.shouldCapture, false);
});

test("fallback chat decision captures requirement-document cleanup requests", () => {
  const decision = buildFallbackChatDecision("帮我整理一下需求点文档", createCollection());
  assert.equal(decision.mode, "capture");
  assert.equal(decision.shouldCapture, true);
});

test("fallback chat decision captures adding uploaded file details into requirement document", () => {
  const decision = buildFallbackChatDecision("把上传的文件内容并入需求点文档", createCollection());
  assert.equal(decision.mode, "capture");
  assert.equal(decision.shouldCapture, true);
});
