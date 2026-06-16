import { describe, expect, it } from "vitest";
import type { PlanningEpic } from "./planningTypes";
import { matchesEpic, statusLabel, storyProgress } from "./planningView";

function epic(overrides: Partial<PlanningEpic> = {}): PlanningEpic {
  return {
    key: "root:EPIC-0099",
    workspaceId: "root",
    workspaceName: "Root",
    workspaceRoot: ".",
    id: "EPIC-0099",
    dirName: "EPIC-0099-test",
    title: "Planning tracker",
    slug: "planning-tracker",
    status: "in_progress",
    area: "Platform & Access",
    createdAt: null,
    updatedAt: "2026-06-11T10:00:00Z",
    approved: true,
    claim: {
      heldBy: "agent-codex",
      acquiredAt: null,
      expiresAt: null,
      lastHeartbeatAt: null,
      intent: "Build the planning dashboard",
      state: "active",
    },
    stories: { open: 1, completed: 3, total: 4 },
    behaviorCount: 2,
    changeFiles: ["apps/planning/src/App.tsx"],
    riskCount: 1,
    summary: "Summary",
    summaryExcerpt: "Dashboard over local planning files",
    github: { issue: 99, url: "https://github.com/planarium/planarium/issues/99", subIssues: 2 },
    ...overrides,
  };
}

describe("planning view helpers", () => {
  it("formats status labels", () => {
    expect(statusLabel("in_progress")).toBe("In Progress");
    expect(statusLabel("done")).toBe("Done");
  });

  it("filters by query, status, area, and claim", () => {
    const item = epic();

    expect(matchesEpic(item, "dashboard codex", "in_progress", "Platform & Access", "active")).toBe(true);
    expect(matchesEpic(item, "dashboard codex", "done", "Platform & Access", "active")).toBe(false);
    expect(matchesEpic(item, "dashboard codex", "in_progress", "Unsorted", "active")).toBe(false);
    expect(matchesEpic(item, "dashboard codex", "in_progress", "Platform & Access", "expired")).toBe(false);
  });

  it("calculates user-story completion", () => {
    expect(storyProgress(epic())).toBe(75);
    expect(storyProgress(epic({ stories: { open: 0, completed: 0, total: 0 }, status: "done" }))).toBe(100);
  });
});
