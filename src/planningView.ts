import type { ClaimFilter, ClaimState, EpicStatus, MutableEpicStatus, PlanningEpic } from "./planningTypes";

export const STATUS_ORDER: readonly MutableEpicStatus[] = ["draft", "anchored", "in_progress", "review", "done"];

export function statusLabel(status: EpicStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "anchored":
      return "Anchored";
    case "in_progress":
      return "In Progress";
    case "review":
      return "Review";
    case "done":
      return "Done";
    case "unknown":
      return "Unknown";
  }
}

export function claimLabel(state: ClaimState): string {
  switch (state) {
    case "active":
      return "Claimed";
    case "expired":
      return "Expired";
    case "unclaimed":
      return "Unclaimed";
  }
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function statusTone(status: EpicStatus): "neutral" | "amber" | "blue" | "violet" | "green" {
  switch (status) {
    case "draft":
      return "neutral";
    case "anchored":
      return "amber";
    case "in_progress":
      return "blue";
    case "review":
      return "violet";
    case "done":
      return "green";
    case "unknown":
      return "neutral";
  }
}

export function matchesEpic(
  epic: PlanningEpic,
  query: string,
  status: EpicStatus | "all",
  area: string,
  claim: ClaimFilter,
): boolean {
  if (status !== "all" && epic.status !== status) {
    return false;
  }
  if (area !== "all" && epic.area !== area) {
    return false;
  }
  if (claim !== "all" && epic.claim.state !== claim) {
    return false;
  }

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return true;
  }

  const haystack = [
    epic.id,
    epic.workspaceName,
    epic.workspaceRoot,
    epic.title,
    epic.slug,
    epic.area,
    epic.status,
    epic.claim.heldBy ?? "",
    epic.claim.intent ?? "",
    epic.summaryExcerpt,
    ...epic.changeFiles,
  ].join(" ").toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

export function storyProgress(epic: PlanningEpic): number {
  if (epic.stories.total === 0) {
    return epic.status === "done" ? 100 : 0;
  }
  return Math.round((epic.stories.completed / epic.stories.total) * 100);
}
