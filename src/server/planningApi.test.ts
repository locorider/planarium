import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverPlanningWorkspaces, readPlanningSnapshot } from "./planningApi";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "planarium-test-"));
  roots.push(root);
  return root;
}

function writeEpic(workspaceRoot: string, id: string): void {
  const dir = join(workspaceRoot, ".planning", `${id}-demo`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "claim.yaml"), "held_by: null\nexpires_at: null\n", "utf8");
  writeFileSync(join(dir, "summary.md"), "A short summary.\n", "utf8");
  writeFileSync(join(dir, "epic.yaml"), [
    "doc_type: epic",
    `id: ${id}`,
    "title: Demo epic",
    "slug: demo-epic",
    "status: draft",
    "area: Test Area",
    "created_at: 2026-06-12T00:00:00Z",
    "updated_at: 2026-06-12T00:00:00Z",
    "",
    "approval:",
    "  spec_anchor_approved: false",
    "",
    "change_surface:",
    "  files:",
    "    - src/index.ts # new",
    "    - services/api.ts",
    "",
    "constraints:",
    "  risks:",
    "    - Parser regressions hide files.",
    "",
    "behavior:",
    "  scenarios:",
    "    - id: BS-001",
    "      given: A fixture",
    "      when: It is parsed",
    "      then: Counts are populated",
    "",
    "delivery:",
    "  user_stories:",
    "    open:",
    "      - id: US-001",
    "        title: Parse it",
    "    completed: []",
    "",
  ].join("\n"), "utf8");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("planning API helpers", () => {
  it("discovers nested planning workspaces", () => {
    const root = makeRoot();
    writeEpic(root, "EPIC-0001");
    writeEpic(join(root, "services", "api"), "EPIC-0002");
    mkdirSync(join(root, "node_modules", "ignored", ".planning"), { recursive: true });

    const workspaces = discoverPlanningWorkspaces(root, 4);

    expect(workspaces.map((workspace) => workspace.relativeRoot)).toEqual(["", "services/api"]);
  });

  it("parses change files, stories, behavior, and risks from a workspace", () => {
    const root = makeRoot();
    writeEpic(root, "EPIC-0001");

    const snapshot = readPlanningSnapshot(root);
    const epic = snapshot.epics[0];

    expect(snapshot.workspaces).toHaveLength(1);
    expect(epic?.changeFiles).toEqual(["src/index.ts", "services/api.ts"]);
    expect(epic?.stories).toEqual({ open: 1, completed: 0, total: 1 });
    expect(epic?.behaviorCount).toBe(1);
    expect(epic?.riskCount).toBe(1);
  });
});
