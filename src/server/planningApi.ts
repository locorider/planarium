import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join, relative, resolve } from "node:path";
import type { Plugin } from "vite";

type EpicStatus = "draft" | "anchored" | "in_progress" | "review" | "done" | "unknown";
type MutableEpicStatus = Exclude<EpicStatus, "unknown">;
type ClaimState = "active" | "expired" | "unclaimed";

export interface LedgerEpic {
  issue?: number;
  subIssues?: Record<string, number>;
}

export interface GithubLedger {
  repo?: string | null;
  project?: { number?: number | null } | null;
  epics?: Record<string, LedgerEpic>;
}

interface StoryCounts {
  open: number;
  completed: number;
  total: number;
}

export interface ViewerConfig {
  name?: string;
  areas?: Record<string, readonly string[]>;
  areaDescriptions?: Record<string, string>;
}

export interface WorkspaceContext {
  id: string;
  name: string;
  root: string;
  relativeRoot: string;
  planningRoot: string;
  archiveRoot: string;
  config: ViewerConfig;
  ledger: GithubLedger;
}

type EpicPatch =
  | { approved: boolean }
  | { status: MutableEpicStatus }
  | { claim: { action: "claim"; heldBy: string; intent: string; ttlHours: number } }
  | { claim: { action: "clear" } }
  | { lifecycle: { action: "archive" } }
  | { lifecycle: { action: "delete"; confirmId: string } };

export interface PlanningApiOptions {
  root: string;
  maxDepth?: number;
  readOnly?: boolean;
}

const MAX_SOURCE_FILE_BYTES = 768 * 1024;
const DEFAULT_MAX_DEPTH = 5;
const SKIPPED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".turbo",
  ".vercel",
  ".wrangler",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function writeText(path: string, text: string): void {
  writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

function safeJson<T>(path: string, fallback: T): T {
  const text = readText(path);
  if (!text) {
    return fallback;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "root";
}

function displayName(root: string, baseRoot: string, config: ViewerConfig): string {
  if (config.name?.trim()) {
    return config.name.trim();
  }
  const relativeRoot = relative(baseRoot, root);
  return relativeRoot ? relativeRoot : basename(root);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function hasPlanningDir(path: string): boolean {
  return isDirectory(join(path, ".planning"));
}

function readViewerConfig(planningRoot: string): ViewerConfig {
  const config = safeJson<ViewerConfig>(join(planningRoot, "planarium.json"), {});
  if (Object.keys(config).length > 0) {
    return config;
  }
  return safeJson<ViewerConfig>(join(planningRoot, "viewer.config.json"), {});
}

function readLedger(planningRoot: string): GithubLedger {
  return safeJson<GithubLedger>(join(planningRoot, ".github-sync.json"), {});
}

export function discoverPlanningWorkspaces(root: string, maxDepth = DEFAULT_MAX_DEPTH): WorkspaceContext[] {
  const baseRoot = resolve(root);
  const found: string[] = [];

  function walk(dir: string, depth: number): void {
    if (hasPlanningDir(dir)) {
      found.push(dir);
    }
    if (depth >= maxDepth) {
      return;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".planning" || SKIPPED_DIRS.has(entry.name)) {
        continue;
      }
      walk(join(dir, entry.name), depth + 1);
    }
  }

  walk(baseRoot, 0);

  const idCounts = new Map<string, number>();
  return found
    .sort((a, b) => relative(baseRoot, a).localeCompare(relative(baseRoot, b)))
    .map((workspaceRoot) => {
      const planningRoot = join(workspaceRoot, ".planning");
      const config = readViewerConfig(planningRoot);
      const relativeRoot = relative(baseRoot, workspaceRoot);
      const baseId = slugify(relativeRoot || basename(workspaceRoot));
      const seen = idCounts.get(baseId) ?? 0;
      idCounts.set(baseId, seen + 1);
      const id = seen === 0 ? baseId : `${baseId}-${seen + 1}`;
      return {
        id,
        name: displayName(workspaceRoot, baseRoot, config),
        root: workspaceRoot,
        relativeRoot,
        planningRoot,
        archiveRoot: join(planningRoot, "_archive"),
        config,
        ledger: readLedger(planningRoot),
      };
    });
}

function inferLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "css":
      return "css";
    case "html":
      return "html";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "mjs":
    case "js":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return ext ?? "text";
  }
}

function resolveRepoFilePath(workspace: WorkspaceContext, input: string): { absolutePath: string; relativePath: string } {
  const clean = input.trim().replace(/^\/+/, "");
  if (!clean || clean.includes("\0") || clean.startsWith("~")) {
    throw new Error("Invalid source path.");
  }
  const absolutePath = resolve(workspace.root, clean);
  const relativePath = relative(workspace.root, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("Refusing to read a file outside the workspace.");
  }
  return { absolutePath, relativePath };
}

function readSourceFile(workspace: WorkspaceContext, input: string) {
  const { absolutePath, relativePath } = resolveRepoFilePath(workspace, input);
  if (!existsSync(absolutePath)) {
    return {
      exists: false,
      path: relativePath,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      language: inferLanguage(relativePath),
      size: 0,
      text: "",
    };
  }
  const stats = statSync(absolutePath);
  if (!stats.isFile()) {
    throw new Error("Source path is not a file.");
  }
  if (stats.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error(`Source file is too large to preview (${Math.round(stats.size / 1024)} KB).`);
  }
  return {
    exists: true,
    path: relativePath,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    language: inferLanguage(relativePath),
    size: stats.size,
    text: readFileSync(absolutePath, "utf8"),
  };
}

function first(text: string, re: RegExp): string {
  return text.match(re)?.[1]?.trim() ?? "";
}

function normalizeScalar(value: string): string | null {
  const withoutComment = value.replace(/\s+#.*$/, "").trim();
  if (!withoutComment || withoutComment === "null" || withoutComment === "~") {
    return null;
  }
  if ((withoutComment.startsWith("\"") && withoutComment.endsWith("\"")) || (withoutComment.startsWith("'") && withoutComment.endsWith("'"))) {
    try {
      return JSON.parse(withoutComment);
    } catch {
      return withoutComment.slice(1, -1);
    }
  }
  return withoutComment.replace(/^['"]|['"]$/g, "");
}

function lineValue(text: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^${escaped}:\\s*(.*)$`, "m"));
  return match ? normalizeScalar(match[1] ?? "") : null;
}

function parseStatus(value: string): EpicStatus {
  if (value === "draft" || value === "anchored" || value === "in_progress" || value === "review" || value === "done") {
    return value;
  }
  return "unknown";
}

function isMutableStatus(value: unknown): value is MutableEpicStatus {
  return value === "draft" || value === "anchored" || value === "in_progress" || value === "review" || value === "done";
}

function findEpicDir(workspace: WorkspaceContext, id: string): string {
  if (!/^EPIC-\d{4}$/.test(id)) {
    throw new Error("Invalid epic id.");
  }
  const matches = readdirSync(workspace.planningRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${id}-`))
    .map((entry) => entry.name);
  if (matches.length === 0) {
    throw new Error(`No planning directory found for ${id}.`);
  }
  if (matches.length > 1) {
    throw new Error(`${id} matches multiple planning directories in ${workspace.name}.`);
  }
  return join(workspace.planningRoot, matches[0] as string);
}

function assertSafeEpicDir(workspace: WorkspaceContext, id: string, dir: string): void {
  const relativePath = relative(workspace.planningRoot, resolve(dir));
  if (!relativePath || relativePath.startsWith("..") || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("Refusing to modify a path outside .planning.");
  }
  if (!basename(dir).startsWith(`${id}-`)) {
    throw new Error("Refusing to modify a non-matching epic directory.");
  }
}

function replaceLine(text: string, pattern: RegExp, replacement: string): string {
  if (pattern.test(text)) {
    return text.replace(pattern, replacement);
  }
  return `${text.trimEnd()}\n${replacement}\n`;
}

function updateUpdatedAt(text: string, now: string): string {
  return replaceLine(text, /^updated_at:\s*\S+.*$/m, `updated_at: ${now}`);
}

function updateApproved(text: string, approved: boolean, now: string): string {
  const next = updateUpdatedAt(text, now);
  if (/^(\s*spec_anchor_approved:\s*)(true|false)(.*)$/m.test(next)) {
    return next.replace(/^(\s*spec_anchor_approved:\s*)(true|false)(.*)$/m, `$1${String(approved)}$3`);
  }
  if (/^approval:\s*$/m.test(next)) {
    return next.replace(/^approval:\s*$/m, `approval:\n  spec_anchor_approved: ${String(approved)}`);
  }
  return `${next.trimEnd()}\n\napproval:\n  spec_anchor_approved: ${String(approved)}\n`;
}

function updateStatus(text: string, status: MutableEpicStatus, now: string): string {
  const withStatus = replaceLine(text, /^status:\s*[a-z_]+.*$/m, `status: ${status}`);
  return updateUpdatedAt(withStatus, now);
}

function yamlScalar(value: string | null): string {
  if (value === null) {
    return "null";
  }
  return JSON.stringify(value);
}

function writeClaim(dir: string, patch: Extract<EpicPatch, { claim: unknown }>["claim"], now: string): void {
  const claimPath = join(dir, "claim.yaml");
  if (patch.action === "clear") {
    writeText(claimPath, [
      "held_by: null",
      "acquired_at: null",
      "expires_at: null",
      "last_heartbeat_at: null",
      "intent: null",
      "",
    ].join("\n"));
    return;
  }

  const heldBy = patch.heldBy.trim();
  const intent = patch.intent.trim();
  const ttlHours = Number.isFinite(patch.ttlHours) ? Math.max(1, Math.min(168, patch.ttlHours)) : 8;
  if (!heldBy) {
    throw new Error("Claim holder is required.");
  }
  const expires = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  writeText(claimPath, [
    `held_by: ${yamlScalar(heldBy)}`,
    `acquired_at: ${now}`,
    `expires_at: ${expires}`,
    `last_heartbeat_at: ${now}`,
    `intent: ${yamlScalar(intent || "Claimed from Planarium")}`,
    "",
  ].join("\n"));
}

function applyLifecyclePatch(
  workspace: WorkspaceContext,
  id: string,
  dir: string,
  patch: Extract<EpicPatch, { lifecycle: unknown }>["lifecycle"],
): void {
  assertSafeEpicDir(workspace, id, dir);

  if (patch.action === "archive") {
    mkdirSync(workspace.archiveRoot, { recursive: true });
    const target = join(workspace.archiveRoot, basename(dir));
    if (existsSync(target)) {
      throw new Error(`${id} already has an archived directory.`);
    }
    renameSync(dir, target);
    return;
  }

  if (patch.confirmId !== id) {
    throw new Error(`Type ${id} to confirm permanent deletion.`);
  }
  rmSync(dir, { recursive: true, force: false });
}

function isEpicPatch(value: unknown): value is EpicPatch {
  if (!value || typeof value !== "object") {
    return false;
  }
  if ("approved" in value) {
    return typeof (value as { approved?: unknown }).approved === "boolean";
  }
  if ("status" in value) {
    return isMutableStatus((value as { status?: unknown }).status);
  }
  if ("lifecycle" in value) {
    const lifecycle = (value as { lifecycle?: unknown }).lifecycle;
    if (!lifecycle || typeof lifecycle !== "object") {
      return false;
    }
    const action = (lifecycle as { action?: unknown }).action;
    if (action === "archive") {
      return true;
    }
    return action === "delete" && typeof (lifecycle as { confirmId?: unknown }).confirmId === "string";
  }
  if (!("claim" in value)) {
    return false;
  }
  const claim = (value as { claim?: unknown }).claim;
  if (!claim || typeof claim !== "object") {
    return false;
  }
  const action = (claim as { action?: unknown }).action;
  if (action === "clear") {
    return true;
  }
  return action === "claim"
    && typeof (claim as { heldBy?: unknown }).heldBy === "string"
    && typeof (claim as { intent?: unknown }).intent === "string"
    && typeof (claim as { ttlHours?: unknown }).ttlHours === "number";
}

function applyEpicPatch(workspace: WorkspaceContext, id: string, patch: EpicPatch): void {
  const now = new Date().toISOString();
  const dir = findEpicDir(workspace, id);
  if ("lifecycle" in patch) {
    applyLifecyclePatch(workspace, id, dir, patch.lifecycle);
    return;
  }

  const epicPath = join(dir, "epic.yaml");
  const epicText = readText(epicPath);

  if ("approved" in patch) {
    writeText(epicPath, updateApproved(epicText, patch.approved, now));
    return;
  }
  if ("status" in patch) {
    writeText(epicPath, updateStatus(epicText, patch.status, now));
    return;
  }
  writeClaim(dir, patch.claim, now);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 256 * 1024) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

function configuredArea(id: string, areas: Record<string, readonly string[]> | undefined): string | null {
  for (const [area, ids] of Object.entries(areas ?? {})) {
    if (ids.includes(id)) {
      return area;
    }
  }
  return null;
}

function areaOf(workspace: WorkspaceContext, id: string, yaml: string): string {
  const explicit = lineValue(yaml, "area") ?? lineValue(yaml, "milestone");
  if (explicit) {
    return explicit;
  }
  const configured = configuredArea(id, workspace.config.areas);
  if (configured) {
    return configured;
  }
  return "Unsorted";
}

function areaDescription(workspaces: WorkspaceContext[], area: string): string {
  for (const workspace of workspaces) {
    const description = workspace.config.areaDescriptions?.[area];
    if (description) {
      return description;
    }
  }
  return area === "Unsorted" ? "Epics not assigned to an area." : "Project area.";
}

function countStories(text: string): StoryCounts {
  let bucket: "open" | "completed" | null = null;
  let open = 0;
  let completed = 0;

  for (const line of text.split("\n")) {
    if (/^ {2}user_stories:\s*$/.test(line)) {
      bucket = null;
      continue;
    }
    if (/^ {4}open:/.test(line)) {
      bucket = "open";
      continue;
    }
    if (/^ {4}completed:/.test(line)) {
      bucket = "completed";
      continue;
    }
    if (/^ {6}- id:\s*US-\d+/.test(line)) {
      if (bucket === "completed") {
        completed += 1;
      } else {
        open += 1;
      }
    }
  }

  return { open, completed, total: open + completed };
}

function scopedBlock(text: string, startPattern: RegExp, endPattern: RegExp): string {
  const start = text.search(startPattern);
  if (start === -1) {
    return "";
  }
  const rest = text.slice(start);
  const firstLineEnd = rest.indexOf("\n");
  if (firstLineEnd === -1) {
    return rest;
  }
  const body = rest.slice(firstLineEnd + 1);
  const end = body.search(endPattern);
  return end === -1 ? rest : rest.slice(0, firstLineEnd + 1 + end);
}

function extractChangeFiles(text: string): string[] {
  const block = scopedBlock(text, /^change_surface:\s*$/m, /^\S/m);
  return [...block.matchAll(/^ {4}-\s*(.+)$/gm)]
    .map((match) => (match[1] ?? "").replace(/\s+#.*$/, "").trim())
    .filter(Boolean);
}

function countBehaviorScenarios(text: string): number {
  return [...text.matchAll(/^ {4}- id:\s*BS-\d+/gm)].length;
}

function countRisks(text: string): number {
  const block = scopedBlock(text, /^ {2}risks:\s*$/m, /^(?: {2}[a-z_]+:|\S)/m);
  return [...block.matchAll(/^ {4}-\s+/gm)].length;
}

function summaryExcerpt(summary: string): string {
  const paragraph = summary
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith("#") && !part.startsWith("**") && !part.startsWith(">") && part !== "---");
  if (!paragraph) {
    return "No summary text yet.";
  }
  const clean = paragraph.replace(/\s+/g, " ");
  return clean.length > 300 ? `${clean.slice(0, 297)}...` : clean;
}

function claimState(heldBy: string | null, expiresAt: string | null): ClaimState {
  if (!heldBy) {
    return "unclaimed";
  }
  if (!expiresAt) {
    return "active";
  }
  const expires = new Date(expiresAt).getTime();
  if (Number.isNaN(expires)) {
    return "active";
  }
  return expires < Date.now() ? "expired" : "active";
}

function readWorkspaceEpics(workspace: WorkspaceContext) {
  let dirs: string[];
  try {
    dirs = readdirSync(workspace.planningRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^EPIC-\d{4}-/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    dirs = [];
  }

  return dirs.map((dirName) => {
    const dir = join(workspace.planningRoot, dirName);
    const yaml = readText(join(dir, "epic.yaml"));
    const claim = readText(join(dir, "claim.yaml"));
    const summary = readText(join(dir, "summary.md"));
    const id = first(yaml, /^id:\s*(EPIC-\d+)/m) || dirName.match(/^EPIC-\d{4}/)?.[0] || dirName;
    const ledgerEpic = workspace.ledger.epics?.[id];
    const issue = ledgerEpic?.issue ?? null;
    const heldBy = lineValue(claim, "held_by");
    const expiresAt = lineValue(claim, "expires_at");
    const stories = countStories(yaml);

    return {
      key: `${workspace.id}:${id}`,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceRoot: workspace.relativeRoot || ".",
      id,
      dirName,
      title: first(yaml, /^title:\s*(.+)$/m) || dirName,
      slug: first(yaml, /^slug:\s*(.+)$/m),
      status: parseStatus(first(yaml, /^status:\s*([a-z_]+)/m)),
      area: areaOf(workspace, id, yaml),
      createdAt: lineValue(yaml, "created_at"),
      updatedAt: lineValue(yaml, "updated_at"),
      approved: /spec_anchor_approved:\s*true\b/.test(yaml),
      claim: {
        heldBy,
        acquiredAt: lineValue(claim, "acquired_at"),
        expiresAt,
        lastHeartbeatAt: lineValue(claim, "last_heartbeat_at"),
        intent: lineValue(claim, "intent"),
        state: claimState(heldBy, expiresAt),
      },
      stories,
      behaviorCount: countBehaviorScenarios(yaml),
      changeFiles: extractChangeFiles(yaml),
      riskCount: countRisks(yaml),
      summary,
      summaryExcerpt: summaryExcerpt(summary),
      github: {
        issue,
        url: workspace.ledger.repo && issue ? `https://github.com/${workspace.ledger.repo}/issues/${issue}` : null,
        subIssues: Object.keys(ledgerEpic?.subIssues ?? {}).length,
      },
    };
  });
}

function workspacePublic(workspace: WorkspaceContext) {
  return {
    id: workspace.id,
    name: workspace.name,
    root: workspace.relativeRoot || ".",
    repo: workspace.ledger.repo ?? null,
    projectNumber: workspace.ledger.project?.number ?? null,
  };
}

export function readPlanningSnapshot(root: string, options: Pick<PlanningApiOptions, "maxDepth"> = {}) {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const workspaces = discoverPlanningWorkspaces(root, maxDepth);
  const epics = workspaces.flatMap(readWorkspaceEpics);
  const stats = {
    total: epics.length,
    activeClaims: epics.filter((epic) => epic.claim.state === "active").length,
    expiredClaims: epics.filter((epic) => epic.claim.state === "expired").length,
    approved: epics.filter((epic) => epic.approved).length,
    mirrored: epics.filter((epic) => epic.github.issue !== null).length,
    openStories: epics.reduce((sum, epic) => sum + epic.stories.open, 0),
    completedStories: epics.reduce((sum, epic) => sum + epic.stories.completed, 0),
  };

  const areaNames = [...new Set(epics.map((epic) => epic.area))].sort((a, b) => a.localeCompare(b));
  const areas = areaNames.map((name) => {
    const inArea = epics.filter((epic) => epic.area === name);
    return {
      name,
      description: areaDescription(workspaces, name),
      total: inArea.length,
      done: inArea.filter((epic) => epic.status === "done").length,
      review: inArea.filter((epic) => epic.status === "review").length,
      inProgress: inArea.filter((epic) => epic.status === "in_progress").length,
    };
  });

  const repos = [...new Set(workspaces.map((workspace) => workspace.ledger.repo).filter(Boolean))] as string[];
  const projectNumbers = [...new Set(workspaces.map((workspace) => workspace.ledger.project?.number).filter((value): value is number => typeof value === "number"))];

  return {
    generatedAt: new Date().toISOString(),
    root: resolve(root),
    repo: repos.length === 1 ? repos[0] : null,
    projectNumber: projectNumbers.length === 1 ? projectNumbers[0] : null,
    workspaces: workspaces.map(workspacePublic),
    epics,
    stats,
    areas,
  };
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

function workspaceById(root: string, maxDepth: number, workspaceId: string | null): WorkspaceContext {
  const workspaces = discoverPlanningWorkspaces(root, maxDepth);
  if (!workspaceId && workspaces.length === 1) {
    return workspaces[0] as WorkspaceContext;
  }
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    throw new Error(workspaceId ? `No planning workspace found for ${workspaceId}.` : "Workspace id is required.");
  }
  return workspace;
}

export function planningApiPlugin(options: PlanningApiOptions): Plugin {
  const root = resolve(options.root);
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const readOnly = options.readOnly ?? false;

  return {
    name: "planarium-planning-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/planning")) {
          next();
          return;
        }

        try {
          const url = new URL(req.url, "http://localhost");
          const patchMatch = url.pathname.match(/^\/api\/planning\/workspaces\/([^/]+)\/epics\/(EPIC-\d{4})$/);
          const legacyPatchMatch = url.pathname.match(/^\/api\/planning\/epics\/(EPIC-\d{4})$/);
          if (req.method === "GET" && url.pathname === "/api/planning") {
            sendJson(res, 200, readPlanningSnapshot(root, { maxDepth }));
            return;
          }
          if (req.method === "GET" && url.pathname === "/api/planning/source") {
            const workspace = workspaceById(root, maxDepth, url.searchParams.get("workspaceId"));
            sendJson(res, 200, readSourceFile(workspace, url.searchParams.get("path") ?? ""));
            return;
          }
          if (req.method === "PATCH" && (patchMatch || legacyPatchMatch)) {
            if (readOnly) {
              sendJson(res, 403, { error: "Planarium is running in read-only mode." });
              return;
            }
            const workspace = workspaceById(root, maxDepth, patchMatch?.[1] ?? url.searchParams.get("workspaceId"));
            const id = patchMatch?.[2] ?? legacyPatchMatch?.[1];
            const body = await readJson(req);
            if (!id || !isEpicPatch(body)) {
              sendJson(res, 400, { error: "Unsupported planning patch." });
              return;
            }
            applyEpicPatch(workspace, id, body);
            sendJson(res, 200, readPlanningSnapshot(root, { maxDepth }));
            return;
          }
          if (url.pathname.startsWith("/api/planning")) {
            sendJson(res, 405, { error: "Method not allowed." });
            return;
          }
          next();
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : "Unable to update planning files" });
        }
      });
    },
  };
}
