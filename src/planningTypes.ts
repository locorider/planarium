export type EpicStatus = "draft" | "anchored" | "in_progress" | "review" | "done" | "unknown";

export type ClaimState = "active" | "expired" | "unclaimed";

export interface EpicClaim {
  heldBy: string | null;
  acquiredAt: string | null;
  expiresAt: string | null;
  lastHeartbeatAt: string | null;
  intent: string | null;
  state: ClaimState;
}

export interface EpicStories {
  open: number;
  completed: number;
  total: number;
}

export interface EpicGithub {
  issue: number | null;
  url: string | null;
  subIssues: number;
}

export interface PlanningEpic {
  key: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRoot: string;
  id: string;
  dirName: string;
  title: string;
  slug: string;
  status: EpicStatus;
  area: string;
  createdAt: string | null;
  updatedAt: string | null;
  approved: boolean;
  claim: EpicClaim;
  stories: EpicStories;
  behaviorCount: number;
  changeFiles: string[];
  riskCount: number;
  summary: string;
  summaryExcerpt: string;
  github: EpicGithub;
}

export interface PlanningStats {
  total: number;
  activeClaims: number;
  expiredClaims: number;
  approved: number;
  mirrored: number;
  openStories: number;
  completedStories: number;
}

export interface PlanningArea {
  name: string;
  description: string;
  total: number;
  done: number;
  review: number;
  inProgress: number;
}

export interface PlanningWorkspace {
  id: string;
  name: string;
  root: string;
  repo: string | null;
  projectNumber: number | null;
}

export interface PlanningSnapshot {
  generatedAt: string;
  root: string;
  repo: string | null;
  projectNumber: number | null;
  workspaces: PlanningWorkspace[];
  epics: PlanningEpic[];
  stats: PlanningStats;
  areas: PlanningArea[];
}

export type LoadState =
  | { status: "loading" }
  | { status: "ready"; snapshot: PlanningSnapshot; selectedEpicId: string | null }
  | { status: "error"; error: string };

export type ViewMode = "board" | "architecture" | "claims";

export type ClaimFilter = "all" | ClaimState;

export type MutableEpicStatus = Exclude<EpicStatus, "unknown">;

export type EpicPatch =
  | { approved: boolean }
  | { status: MutableEpicStatus }
  | { claim: { action: "claim"; heldBy: string; intent: string; ttlHours: number } }
  | { claim: { action: "clear" } }
  | { lifecycle: { action: "archive" } }
  | { lifecycle: { action: "delete"; confirmId: string } };
