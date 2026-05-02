import type {
  PrdDocument,
  UiDesign,
  WireframeAnnotationsDocument,
  WireframeSpec
} from "../../shared/types/artifacts.js";

export function renderPrdMarkdown(document: PrdDocument) {
  const userLines = document.targetUsers
    .map((user) => `- ${user.name}\n  - 需求：${user.needs.join("；")}\n  - 场景：${user.scenarios.join("；")}`)
    .join("\n");
  const scopeIn = document.scope.inScope.map((item) => `- ${item}`).join("\n");
  const scopeOut = document.scope.outOfScope.map((item) => `- ${item}`).join("\n");
  const functionalLines = document.functionalRequirements
    .map((item) => `### ${item.id} ${item.title}\n\n${item.description}\n\n验收标准：\n${item.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`)
    .join("\n\n");
  const flowLines = document.userFlows
    .map((flow) => `- ${flow.name}\n  - ${flow.steps.join("\n  - ")}`)
    .join("\n");
  const pageLines = document.pages
    .map((page) => `- ${page.name}：${page.purpose}\n  - 模块：${page.keyModules.join("、")}`)
    .join("\n");
  const riskLines = document.risks.map((item) => `- ${item}`).join("\n");
  const questionLines = document.openQuestions.map((item) => `- ${item}`).join("\n");

  return `# ${document.overview.title}

## 概述

${document.overview.summary}

## 背景

${document.overview.background}

## 业务目标

${document.overview.businessGoal}

## 成功指标

${document.overview.successMetrics.map((item) => `- ${item}`).join("\n")}

## 目标用户

${userLines}

## 范围

### In Scope

${scopeIn}

### Out of Scope

${scopeOut}

## 功能需求

${functionalLines}

## 用户流程

${flowLines}

## 页面结构

${pageLines}

## 风险

${riskLines}

## 待确认项

${questionLines}
`;
}

export function renderWireframeHtml(spec: WireframeSpec, pageId: string) {
  const page = spec.pages.find((item) => item.id === pageId);
  if (!page) {
    throw new Error(`Wireframe page not found: ${pageId}`);
  }

  const sections = page.sections.map((section) => `
      <section class="wf-section" id="${escapeHtml(section.id)}">
        <div class="wf-kicker">${escapeHtml(section.title)}</div>
        <h2>${escapeHtml(section.objective)}</h2>
        <ul>
          ${section.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
        </ul>
        ${section.primaryAction ? `<div class="wf-cta">${escapeHtml(section.primaryAction)}</div>` : ""}
      </section>
    `).join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.name)} - Wireframe</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f1e8;
        --paper: #fffcf6;
        --ink: #171411;
        --line: #b9b0a0;
        --muted: #6b645a;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Helvetica Neue", sans-serif;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.82), rgba(245,241,232,0.94)),
          repeating-linear-gradient(90deg, transparent 0, transparent 62px, rgba(23,20,17,0.045) 62px, rgba(23,20,17,0.045) 63px);
        color: var(--ink);
      }
      header {
        padding: 32px 28px 12px;
        border-bottom: 1px solid var(--line);
      }
      header p {
        margin: 0 0 10px;
        color: var(--muted);
        letter-spacing: 0.16em;
        font-size: 12px;
        text-transform: uppercase;
      }
      header h1 {
        margin: 0;
        font-size: clamp(28px, 4vw, 42px);
        line-height: 1.02;
      }
      main {
        display: grid;
        gap: 18px;
        padding: 24px 20px 40px;
      }
      .wf-section {
        border: 1px solid var(--line);
        background: rgba(255, 252, 246, 0.92);
        min-height: 180px;
        padding: 18px;
        display: grid;
        gap: 12px;
      }
      .wf-kicker {
        font-size: 12px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.18em;
      }
      h2 {
        margin: 0;
        font-size: 22px;
      }
      ul {
        margin: 0;
        padding-left: 18px;
        color: var(--muted);
      }
      .wf-cta {
        justify-self: start;
        padding: 10px 16px;
        border: 1px dashed var(--ink);
      }
    </style>
  </head>
  <body>
    <header>
      <p>wireframe</p>
      <h1>${escapeHtml(page.name)}</h1>
    </header>
    <main>${sections}</main>
  </body>
</html>`;
}

export function renderUiHtml(
  spec: WireframeSpec,
  design: UiDesign,
  annotations: WireframeAnnotationsDocument,
  pageId: string
) {
  const page = spec.pages.find((item) => item.id === pageId);
  if (!page) {
    throw new Error(`UI page not found: ${pageId}`);
  }

  const pageAnnotations = annotations.annotations.filter((item) => item.pageId === pageId);
  const annotationMap = new Map(pageAnnotations.map((item) => [item.sectionId, item]));
  const colors = design.designStyle.colorTokens;

  const sections = page.sections.map((section, index) => {
    const annotation = annotationMap.get(section.id);
    return `
      <section class="ui-section section-${index + 1}" id="${escapeHtml(section.id)}">
        <div class="ui-section-copy">
          <p class="eyebrow">${escapeHtml(section.title)}</p>
          <h2>${escapeHtml(section.objective)}</h2>
          <ul>
            ${section.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
          </ul>
          ${section.primaryAction ? `<button>${escapeHtml(section.primaryAction)}</button>` : ""}
        </div>
        <div class="ui-section-visual">
          <div class="frame">
            <span>${escapeHtml(section.title)}</span>
            <strong>${escapeHtml(page.name)}</strong>
          </div>
          ${annotation ? `<aside class="annotation"><b>${escapeHtml(annotation.kind)}</b><span>${escapeHtml(annotation.title)}</span></aside>` : ""}
        </div>
      </section>
    `;
  }).join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.name)} - UI</title>
    <style>
      :root {
        color-scheme: light;
        --bg: ${colors.background ?? "#f4efe6"};
        --surface: ${colors.surface ?? "#fdf8ef"};
        --surface-strong: ${colors.surfaceStrong ?? "#efe3d2"};
        --ink: ${colors.text ?? "#171411"};
        --muted: ${colors.muted ?? "#645d55"};
        --accent: ${colors.accent ?? "#b85c38"};
        --line: ${colors.line ?? "rgba(23,20,17,0.12)"};
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: ${JSON.stringify(design.designStyle.fontFamily)};
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(184,92,56,0.16), transparent 28%),
          linear-gradient(180deg, rgba(255,255,255,0.75), rgba(244,239,230,0.98)),
          var(--bg);
      }
      header {
        padding: 28px 24px 16px;
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        align-items: end;
        justify-content: space-between;
      }
      .brand {
        display: grid;
        gap: 8px;
      }
      .brand span {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        color: var(--muted);
      }
      h1 {
        margin: 0;
        font-size: clamp(34px, 6vw, 64px);
        line-height: 0.95;
        max-width: 8ch;
      }
      .theme-note {
        max-width: 280px;
        color: var(--muted);
        line-height: 1.5;
      }
      main {
        display: grid;
        gap: 22px;
        padding: 0 20px 40px;
      }
      .ui-section {
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 18px;
        padding: 20px;
        border-top: 1px solid var(--line);
      }
      .ui-section-copy {
        display: grid;
        align-content: start;
        gap: 14px;
      }
      .eyebrow {
        margin: 0;
        font-size: 12px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--muted);
      }
      h2 {
        margin: 0;
        font-size: clamp(24px, 4vw, 38px);
        line-height: 1.04;
      }
      ul {
        margin: 0;
        padding-left: 18px;
        color: var(--muted);
        line-height: 1.6;
      }
      button {
        appearance: none;
        border: none;
        border-radius: 999px;
        padding: 12px 18px;
        background: var(--accent);
        color: white;
        font: inherit;
        width: fit-content;
      }
      .ui-section-visual {
        position: relative;
        min-height: 220px;
        display: grid;
      }
      .frame {
        align-self: stretch;
        border-radius: 24px;
        background:
          linear-gradient(135deg, rgba(255,255,255,0.8), rgba(239,227,210,0.92)),
          var(--surface);
        border: 1px solid var(--line);
        padding: 18px;
        display: grid;
        align-content: space-between;
      }
      .frame span {
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.16em;
        font-size: 12px;
      }
      .frame strong {
        font-size: clamp(28px, 5vw, 52px);
        max-width: 8ch;
        line-height: 0.94;
      }
      .annotation {
        position: absolute;
        right: 16px;
        bottom: 16px;
        display: grid;
        gap: 4px;
        max-width: 220px;
        padding: 12px 14px;
        background: rgba(23,20,17,0.92);
        color: white;
        border-radius: 18px;
      }
      .annotation b {
        text-transform: uppercase;
        letter-spacing: 0.16em;
        font-size: 11px;
        color: rgba(255,255,255,0.68);
      }
      @media (max-width: 860px) {
        .ui-section {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">
        <span>${escapeHtml(design.designStyle.themeName)}</span>
        <h1>${escapeHtml(page.name)}</h1>
      </div>
      <p class="theme-note">${escapeHtml(design.visualThesis)}</p>
    </header>
    <main>${sections}</main>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
