import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkspaceDesignNode, WorkspaceDesignPage } from "../../shared/types/workspace.js";

export interface DesignReferenceSummary {
  id: string;
  name: string;
  category: "antd_search_list" | "antd_form" | "unknown";
  sourcePath: string;
  page: {
    width: number;
    height: number;
    background?: string;
  };
  layout: {
    contentX?: number;
    contentY?: number;
    contentWidth?: number;
    contentHeight?: number;
    topRegionY?: number;
  };
  styleTokens: {
    fills: string[];
    textColors: string[];
    fontSizes: number[];
    radii: number[];
  };
  nodeStats: Record<string, number>;
  keyTexts: string[];
  guidance: string[];
}

const referenceFiles: Array<{
  id: string;
  category: DesignReferenceSummary["category"];
  sourcePath: string;
  guidance: string[];
}> = [];

let cachedReferences: DesignReferenceSummary[] | undefined;

export function getDesignReferenceContext(userRequest: string, platform?: string): {
  matchedReferenceIds: string[];
  references: ReturnType<typeof compactReferenceSummary>[];
  rules: string[];
} {
  return {
    matchedReferenceIds: [],
    references: [],
    rules: []
  };
}

function loadDesignReferences() {
  if (cachedReferences) return cachedReferences;
  cachedReferences = referenceFiles
    .map((file) => {
      const absolutePath = resolve(process.cwd(), file.sourcePath);
      if (!existsSync(absolutePath)) return undefined;
      try {
        const page = JSON.parse(readFileSync(absolutePath, "utf8")) as WorkspaceDesignPage;
        return summarizeReferencePage(page, file);
      } catch (error) {
        console.warn("[AIPM][DesignReference] failed to load reference", {
          sourcePath: file.sourcePath,
          message: error instanceof Error ? error.message : String(error)
        });
        return undefined;
      }
    })
    .filter((item): item is DesignReferenceSummary => Boolean(item));
  return cachedReferences;
}

function summarizeReferencePage(
  page: WorkspaceDesignPage,
  file: {
    id: string;
    category: DesignReferenceSummary["category"];
    sourcePath: string;
    guidance: string[];
  }
): DesignReferenceSummary {
  const root = page.nodes.find((node) => !node.parentId) ?? page.nodes[0];
  const content = page.nodes
    .filter((node) => node.type === "container" || node.type === "card")
    .sort((first, second) => second.width * second.height - first.width * first.height)[0];
  return {
    id: file.id,
    name: page.name,
    category: file.category,
    sourcePath: file.sourcePath,
    page: {
      width: root?.width ?? 1440,
      height: root?.height ?? 1024,
      background: root?.fill
    },
    layout: {
      contentX: content?.x,
      contentY: content?.y,
      contentWidth: content?.width,
      contentHeight: content?.height,
      topRegionY: Math.min(...page.nodes.filter((node) => node.visible !== false).map((node) => node.y).slice(0, 40))
    },
    styleTokens: {
      fills: topValues(page.nodes.map((node) => node.fill).filter(Boolean)),
      textColors: topValues(page.nodes.map((node) => node.textColor).filter(Boolean)),
      fontSizes: topNumbers(page.nodes.map((node) => node.fontSize)),
      radii: topNumbers(page.nodes.map((node) => node.radius))
    },
    nodeStats: countNodeTypes(page.nodes),
    keyTexts: page.nodes
      .filter((node) => node.type === "text" && node.text?.trim())
      .sort((first, second) => (first.y - second.y) || (first.x - second.x))
      .slice(0, 24)
      .map((node) => node.text?.trim() ?? ""),
    guidance: file.guidance
  };
}

function compactReferenceSummary(reference: DesignReferenceSummary) {
  return {
    id: reference.id,
    name: reference.name,
    category: reference.category,
    sourcePath: reference.sourcePath,
    page: reference.page,
    layout: reference.layout,
    styleTokens: reference.styleTokens,
    nodeStats: reference.nodeStats,
    keyTexts: reference.keyTexts,
    guidance: reference.guidance
  };
}

function countNodeTypes(nodes: WorkspaceDesignNode[]) {
  return nodes.reduce<Record<string, number>>((result, node) => {
    result[node.type] = (result[node.type] ?? 0) + 1;
    return result;
  }, {});
}

function topValues(values: string[], limit = 8) {
  const counts = values.reduce<Map<string, number>>((map, value) => {
    map.set(value, (map.get(value) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  return [...counts.entries()]
    .sort((first, second) => second[1] - first[1])
    .slice(0, limit)
    .map(([value]) => value);
}

function topNumbers(values: Array<number | undefined>, limit = 8) {
  const counts = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .reduce<Map<number, number>>((map, value) => {
      map.set(value, (map.get(value) ?? 0) + 1);
      return map;
    }, new Map<number, number>());
  return [...counts.entries()]
    .sort((first, second) => second[1] - first[1])
    .slice(0, limit)
    .map(([value]) => value);
}
