import {
  CheckCircleOutlined,
  CodeOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  FileTextOutlined,
  InboxOutlined,
  PushpinOutlined,
  ReloadOutlined,
  SaveOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Layout,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ClaimFilter,
  EpicPatch,
  EpicStatus,
  LoadState,
  MutableEpicStatus,
  PlanningArea,
  PlanningEpic,
  PlanningSnapshot,
  ViewMode,
} from "./planningTypes";
import { MarkdownView } from "./MarkdownView";
import { HighlightedCodeLine } from "./CodeHighlight";
import {
  STATUS_ORDER,
  claimLabel,
  formatDateTime,
  matchesEpic,
  statusLabel,
  storyProgress,
} from "./planningView";

const { Content, Header } = Layout;
const { Paragraph, Text, Title } = Typography;

const POLL_MS = 4_000;

const STATUS_COLORS: Record<EpicStatus, string> = {
  draft: "default",
  anchored: "gold",
  in_progress: "blue",
  review: "purple",
  done: "green",
  unknown: "default",
};

const CLAIM_COLORS: Record<PlanningEpic["claim"]["state"], string> = {
  active: "processing",
  expired: "error",
  unclaimed: "default",
};

const STATUS_OPTIONS = STATUS_ORDER.map((status) => ({
  label: statusLabel(status),
  value: status,
}));

interface SourceFile {
  exists: boolean;
  path: string;
  workspaceId: string;
  workspaceName: string;
  language: string;
  size: number;
  text: string;
}

type SourceLoadState =
  | { status: "idle" }
  | { status: "loading"; path: string }
  | { status: "ready"; source: SourceFile }
  | { status: "error"; path: string; error: string };

async function fetchPlanning(): Promise<PlanningSnapshot> {
  const response = await fetch("/api/planning", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Planning API failed with ${response.status}`);
  }
  return response.json() as Promise<PlanningSnapshot>;
}

async function patchPlanningEpic(epic: PlanningEpic, patch: EpicPatch): Promise<PlanningSnapshot> {
  const response = await fetch(`/api/planning/workspaces/${encodeURIComponent(epic.workspaceId)}/epics/${epic.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `Planning API failed with ${response.status}` })) as { error?: string };
    throw new Error(body.error ?? `Planning API failed with ${response.status}`);
  }
  return response.json() as Promise<PlanningSnapshot>;
}

function isSourceFile(value: unknown): value is SourceFile {
  return Boolean(
    value
      && typeof value === "object"
      && typeof (value as { exists?: unknown }).exists === "boolean"
      && typeof (value as { path?: unknown }).path === "string"
      && typeof (value as { workspaceId?: unknown }).workspaceId === "string"
      && typeof (value as { workspaceName?: unknown }).workspaceName === "string"
      && typeof (value as { language?: unknown }).language === "string"
      && typeof (value as { size?: unknown }).size === "number"
      && typeof (value as { text?: unknown }).text === "string",
  );
}

async function fetchSourceFile(workspaceId: string, path: string): Promise<SourceFile> {
  const params = new URLSearchParams({ workspaceId, path });
  const response = await fetch(`/api/planning/source?${params.toString()}`, { cache: "no-store" });
  const body = await response.json().catch(() => ({ error: `Source API failed with ${response.status}` })) as unknown;
  if (!response.ok) {
    throw new Error(typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : `Source API failed with ${response.status}`);
  }
  if (!isSourceFile(body)) {
    throw new Error("Source API returned an invalid response.");
  }
  return body;
}

function isLifecyclePatch(patch: EpicPatch): patch is Extract<EpicPatch, { lifecycle: unknown }> {
  return "lifecycle" in patch;
}

function mutableStatus(status: EpicStatus): MutableEpicStatus {
  return status === "unknown" ? "draft" : status;
}

function StatusTag({ status }: { status: EpicStatus }) {
  return <Tag color={STATUS_COLORS[status]}>{statusLabel(status)}</Tag>;
}

function ClaimTag({ epic }: { epic: PlanningEpic }) {
  return (
    <Tag color={CLAIM_COLORS[epic.claim.state]}>
      {claimLabel(epic.claim.state)}
      {epic.claim.heldBy ? ` by ${epic.claim.heldBy}` : ""}
    </Tag>
  );
}

function StoryMeter({ epic }: { epic: PlanningEpic }) {
  const progress = storyProgress(epic);
  return (
    <div className="story-meter" aria-label={`${progress}% user-story completion`}>
      <Progress percent={progress} size="small" showInfo={false} status={progress === 100 ? "success" : "active"} />
      <Text type="secondary">
        {epic.stories.completed}/{epic.stories.total || 0} stories
      </Text>
    </div>
  );
}

function EpicCard({
  epic,
  selected,
  onSelect,
}: {
  epic: PlanningEpic;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const select = () => onSelect(epic.key);
  return (
    <Card
      className={`epic-card${selected ? " epic-card--selected" : ""}`}
      hoverable
      role="button"
      size="small"
      tabIndex={0}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        select();
      }}
    >
      <div className="epic-card__topline">
        <Text strong>{epic.id}</Text>
        <StatusTag status={epic.status} />
      </div>
      <Title className="epic-card__title" level={5}>
        {epic.title}
      </Title>
      <div className="epic-card__meta">
        <Text type="secondary">{epic.workspaceName}</Text>
        <Text type="secondary">{formatDateTime(epic.updatedAt)}</Text>
      </div>
      <Text className="epic-card__area" type="secondary">{epic.area}</Text>
      <StoryMeter epic={epic} />
      <ClaimTag epic={epic} />
      <Button
        className="epic-card__open"
        icon={<FileTextOutlined />}
        size="small"
        type="primary"
        onClick={(event) => {
          event.stopPropagation();
          select();
        }}
      >
        Open epic
      </Button>
    </Card>
  );
}

function PipelineBoard({
  epics,
  selectedEpicKey,
  onSelect,
}: {
  epics: PlanningEpic[];
  selectedEpicKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <section className="board-scroll" aria-label="Epic pipeline">
      <div className="kanban-board">
        {STATUS_ORDER.map((status) => {
          const columnEpics = epics.filter((epic) => epic.status === status);
          return (
            <section className="kanban-column" key={status}>
              <div className="kanban-column__heading">
                <StatusTag status={status} />
                <Text type="secondary" strong>
                  {columnEpics.length}
                </Text>
              </div>
              <div className="kanban-column__list">
                {columnEpics.length === 0 ? (
                  <Empty description="No epics" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  columnEpics.map((epic) => (
                    <EpicCard
                      key={epic.key}
                      epic={epic}
                      selected={selectedEpicKey === epic.key}
                      onSelect={onSelect}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function ArchitectureView({
  areas,
  epics,
  selectedEpicKey,
  onSelect,
}: {
  areas: PlanningArea[];
  epics: PlanningEpic[];
  selectedEpicKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <section className="architecture" aria-label="Architecture areas">
      {areas.map((area) => {
        const areaEpics = epics.filter((epic) => epic.area === area.name);
        const donePercent = area.total > 0 ? Math.round((area.done / area.total) * 100) : 0;
        return (
          <section className="area-section" key={area.name}>
            <div className="area-section__header">
              <div>
                <Title level={3}>{area.name}</Title>
                <Paragraph type="secondary">{area.description}</Paragraph>
              </div>
              <Statistic suffix="% done" value={donePercent} />
            </div>
            <Progress percent={donePercent} />
            <Space className="area-section__stages" size={[8, 8]} wrap>
              <Tag>{area.inProgress} in progress</Tag>
              <Tag>{area.review} in review</Tag>
              <Tag color="green">{area.done} done</Tag>
            </Space>
            <div className="epic-grid">
              {areaEpics.map((epic) => (
                <EpicCard
                  key={epic.key}
                  epic={epic}
                  selected={selectedEpicKey === epic.key}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        );
      })}
    </section>
  );
}

function ClaimsView({
  epics,
  selectedEpicKey,
  onSelect,
}: {
  epics: PlanningEpic[];
  selectedEpicKey: string | null;
  onSelect: (key: string) => void;
}) {
  const claimed = epics.filter((epic) => epic.claim.state !== "unclaimed");
  const open = epics.filter((epic) => epic.claim.state === "unclaimed" && epic.status !== "done");
  return (
    <section className="claims-layout" aria-label="Claims">
      <section className="list-panel">
        <Title level={3}>Claims</Title>
        <div className="claim-list">
          {claimed.length === 0 ? (
            <Empty description="No active or expired claims" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            claimed.map((epic) => (
              <EpicCard key={epic.key} epic={epic} selected={selectedEpicKey === epic.key} onSelect={onSelect} />
            ))
          )}
        </div>
      </section>
      <section className="list-panel">
        <Title level={3}>Open non-done epics</Title>
        <div className="claim-list">
          {open.length === 0 ? (
            <Empty description="No open epics" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            open.map((epic) => (
              <EpicCard key={epic.key} epic={epic} selected={selectedEpicKey === epic.key} onSelect={onSelect} />
            ))
          )}
        </div>
      </section>
    </section>
  );
}

function defaultClaimHolder(): string {
  try {
    return window.localStorage.getItem("planning-buddy-claim-holder") ?? "";
  } catch {
    return "";
  }
}

function rememberClaimHolder(value: string): void {
  try {
    window.localStorage.setItem("planning-buddy-claim-holder", value);
  } catch {
    // Best-effort convenience only.
  }
}

function EpicActions({
  epic,
  saving,
  onPatch,
}: {
  epic: PlanningEpic;
  saving: boolean;
  onPatch: (patch: EpicPatch, successMessage: string) => Promise<void>;
}) {
  const [nextStatus, setNextStatus] = useState<MutableEpicStatus>(mutableStatus(epic.status));
  const [heldBy, setHeldBy] = useState(epic.claim.heldBy ?? defaultClaimHolder());
  const [intent, setIntent] = useState(epic.claim.intent ?? "");
  const [ttlHours, setTtlHours] = useState(8);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const saveStatus = async () => {
    await onPatch({ status: nextStatus }, `Saved ${epic.id} as ${statusLabel(nextStatus)}.`);
  };

  const toggleApproval = async () => {
    await onPatch({ approved: !epic.approved }, `${epic.id} anchor ${epic.approved ? "reopened" : "approved"}.`);
  };

  const claimEpic = async () => {
    const holder = heldBy.trim();
    rememberClaimHolder(holder);
    await onPatch(
      { claim: { action: "claim", heldBy: holder, intent: intent.trim(), ttlHours } },
      `${epic.id} claimed by ${holder}.`,
    );
  };

  const clearClaim = async () => {
    await onPatch({ claim: { action: "clear" } }, `${epic.id} claim cleared.`);
  };

  const archiveEpic = async () => {
    await onPatch({ lifecycle: { action: "archive" } }, `${epic.id} archived.`);
  };

  const deleteEpic = async () => {
    await onPatch(
      { lifecycle: { action: "delete", confirmId: deleteConfirmation.trim() } },
      `${epic.id} deleted permanently.`,
    );
  };

  return (
    <Space className="drawer-stack" orientation="vertical" size="middle">
      <section className="drawer-section">
        <Title level={4}>Planning file actions</Title>
        <div className="action-grid">
          <label>
            <Text type="secondary" strong>
              Status
            </Text>
            <Select<MutableEpicStatus>
              options={STATUS_OPTIONS}
              value={nextStatus}
              onChange={setNextStatus}
            />
          </label>
          <Button
            disabled={saving || nextStatus === epic.status}
            icon={<SaveOutlined />}
            loading={saving}
            type="primary"
            onClick={() => void saveStatus()}
          >
            Save status
          </Button>
          <Button
            icon={epic.approved ? <CloseCircleOutlined /> : <PushpinOutlined />}
            loading={saving}
            onClick={() => void toggleApproval()}
          >
            {epic.approved ? "Revoke anchor" : "Approve anchor"}
          </Button>
        </div>
      </section>

      <section className="drawer-section">
        <Title level={4}>Claim</Title>
        <div className="claim-form">
          <label>
            <Text type="secondary" strong>
              Held by
            </Text>
            <Input value={heldBy} placeholder="agent or person" onChange={(event) => setHeldBy(event.target.value)} />
          </label>
          <label>
            <Text type="secondary" strong>
              Intent
            </Text>
            <Input value={intent} placeholder="what is being worked on" onChange={(event) => setIntent(event.target.value)} />
          </label>
          <label>
            <Text type="secondary" strong>
              Hours
            </Text>
            <InputNumber
              max={168}
              min={1}
              value={ttlHours}
              onChange={(value) => setTtlHours(typeof value === "number" && Number.isFinite(value) ? value : 8)}
            />
          </label>
          <Button
            disabled={saving || !heldBy.trim()}
            icon={<UserSwitchOutlined />}
            loading={saving}
            type="primary"
            onClick={() => void claimEpic()}
          >
            Claim
          </Button>
          <Button disabled={saving || epic.claim.state === "unclaimed"} onClick={() => void clearClaim()}>
            Clear
          </Button>
        </div>
      </section>

      <section className="drawer-section danger-zone">
        <Title level={4}>Archive / Delete</Title>
        <Alert
          showIcon
          type="warning"
          title="Archive moves the epic directory to .planning/_archive. Permanent delete requires the exact epic id."
        />
        <Space className="danger-zone__actions" size={[8, 8]} wrap>
          <Button icon={<InboxOutlined />} loading={saving} onClick={() => void archiveEpic()}>
            Archive epic
          </Button>
          <Input
            className="delete-confirmation"
            placeholder={`type ${epic.id}`}
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
          />
          <Button
            danger
            disabled={saving || deleteConfirmation.trim() !== epic.id}
            icon={<DeleteOutlined />}
            loading={saving}
            onClick={() => void deleteEpic()}
          >
            Delete permanently
          </Button>
        </Space>
      </section>
    </Space>
  );
}

function CodeBrowserDrawer({
  open,
  state,
  onClose,
}: {
  open: boolean;
  state: SourceLoadState;
  onClose: () => void;
}) {
  const source = state.status === "ready" ? state.source : null;
  const titlePath = state.status === "loading" || state.status === "error" ? state.path : source?.path ?? "Source";
  const lines = source?.text.split("\n") ?? [];
  const visibleLines = lines.slice(0, 5_000);
  const hiddenLineCount = Math.max(0, lines.length - visibleLines.length);

  const copySource = () => {
    if (!source?.text) {
      return;
    }
    void navigator.clipboard?.writeText(source.text);
  };

  return (
    <Drawer
      autoFocus={false}
      className="code-drawer"
      destroyOnHidden
      open={open}
      title={(
        <div className="code-drawer__title">
          <Text type="secondary">{source?.workspaceName ?? "Code browser"}</Text>
          <Title level={3}>{titlePath}</Title>
        </div>
      )}
      extra={(
        <Space size={[8, 8]} wrap>
          {source ? <Tag icon={<CodeOutlined />}>{source.language}</Tag> : null}
          {source ? <Tag>{Math.max(1, Math.round(source.size / 1024))} KB</Tag> : null}
          <Button disabled={!source?.exists} icon={<CopyOutlined />} onClick={copySource}>
            Copy
          </Button>
        </Space>
      )}
      width="min(95vw, 1400px)"
      onClose={onClose}
    >
      {state.status === "loading" ? (
        <div className="code-viewer__loading">
          <Spin description={`Opening ${state.path}`} />
        </div>
      ) : state.status === "error" ? (
        <Alert showIcon title="Unable to open source file" description={state.error} type="error" />
      ) : source && !source.exists ? (
        <Empty
          description={(
            <span>
              No repository file exists at <code>{source.path}</code>.
            </span>
          )}
        />
      ) : source ? (
        <div className="code-viewer">
          <div className="code-viewer__chrome">
            <FileTextOutlined />
            <Text code>{source.path}</Text>
          </div>
          <pre className="code-viewer__pre" aria-label={`${source.path} source`}>
            {visibleLines.map((line, index) => (
              <div className="code-viewer__line" key={`${source.path}-${index}`}>
                <span className="code-viewer__line-number">{index + 1}</span>
                <code>
                  {line ? <HighlightedCodeLine language={source.language} line={line} /> : " "}
                </code>
              </div>
            ))}
          </pre>
          {hiddenLineCount > 0 ? (
            <Alert
              showIcon
              title={`Preview truncated after 5,000 lines. ${hiddenLineCount} lines hidden.`}
              type="warning"
            />
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}

function EpicDrawer({
  epic,
  open,
  saving,
  actionMessage,
  actionError,
  onClose,
  onOpenFile,
  onPatch,
  onNoticeClose,
}: {
  epic: PlanningEpic | null;
  open: boolean;
  saving: boolean;
  actionMessage: string | null;
  actionError: string | null;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onPatch: (patch: EpicPatch, successMessage: string) => Promise<void>;
  onNoticeClose: () => void;
}) {
  if (!epic) {
    return null;
  }

  const visibleFiles = epic.changeFiles.slice(0, 12);
  const hiddenFileCount = Math.max(0, epic.changeFiles.length - visibleFiles.length);
  const details = [
    { key: "workspace", label: "Workspace", children: epic.workspaceName },
    { key: "area", label: "Area", children: epic.area },
    { key: "updated", label: "Updated", children: formatDateTime(epic.updatedAt) },
    { key: "anchor", label: "Anchor", children: epic.approved ? "Approved" : "Pending" },
    {
      key: "github",
      label: "GitHub",
      children: epic.github.url ? (
        <a href={epic.github.url} rel="noreferrer" target="_blank">
          Issue #{epic.github.issue}
        </a>
      ) : (
        "Not mirrored"
      ),
    },
  ];

  return (
    <Drawer
      autoFocus={false}
      destroyOnHidden
      className="epic-drawer"
      extra={<StatusTag status={epic.status} />}
      open={open}
      title={(
        <div className="drawer-title">
          <Text type="secondary">{epic.id}</Text>
          <Title level={3}>{epic.title}</Title>
        </div>
      )}
      width="min(96vw, 1300px)"
      onClose={onClose}
    >
      <Space className="drawer-stack" orientation="vertical" size="middle">
        {actionMessage ? <Alert closable showIcon title={actionMessage} type="success" onClose={onNoticeClose} /> : null}
        {actionError ? <Alert closable showIcon title={actionError} type="error" onClose={onNoticeClose} /> : null}

        <Descriptions bordered column={{ xs: 1, sm: 2 }} items={details} size="small" />

        <EpicActions
          key={`${epic.id}-${epic.status}-${String(epic.approved)}-${epic.claim.heldBy ?? ""}`}
          epic={epic}
          saving={saving}
          onPatch={onPatch}
        />

        <section className="drawer-section">
          <Title level={4}>Claim state</Title>
          <Space className="fact-row" size={[8, 8]} wrap>
            <ClaimTag epic={epic} />
            <Tag>Intent: {epic.claim.intent ?? "n/a"}</Tag>
            <Tag>Heartbeat: {formatDateTime(epic.claim.lastHeartbeatAt)}</Tag>
            <Tag>Expires: {formatDateTime(epic.claim.expiresAt)}</Tag>
          </Space>
        </section>

        <section className="drawer-section">
          <Title level={4}>Progress</Title>
          <StoryMeter epic={epic} />
          <Space className="fact-row" size={[8, 8]} wrap>
            <Tag>{epic.behaviorCount} behavior scenarios</Tag>
            <Tag>{epic.riskCount} risks</Tag>
            <Tag>{epic.github.subIssues} GitHub sub-issues</Tag>
          </Space>
        </section>

        <section className="drawer-section">
          <Title level={4}>Change surface</Title>
          {visibleFiles.length === 0 ? (
            <Text type="secondary">No files listed.</Text>
          ) : (
            <ul className="file-list">
              {visibleFiles.map((file) => (
                <li key={file}>
                  <button className="file-link-button" type="button" onClick={() => onOpenFile(file)}>
                    <FileTextOutlined />
                    <code>{file}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hiddenFileCount > 0 ? <Text type="secondary">+{hiddenFileCount} more files</Text> : null}
        </section>

        <section className="drawer-section">
          <Title level={4}>Summary</Title>
          <MarkdownView source={epic.summary} onOpenFile={onOpenFile} />
        </section>
      </Space>
    </Drawer>
  );
}

function SnapshotView({
  snapshot,
  selectedEpicKey,
  onSelectedEpicChange,
  onSnapshotChange,
}: {
  snapshot: PlanningSnapshot;
  selectedEpicKey: string | null;
  onSelectedEpicChange: (key: string | null) => void;
  onSnapshotChange: (snapshot: PlanningSnapshot, selectedEpicKey: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<EpicStatus | "all">("all");
  const [area, setArea] = useState("all");
  const [workspace, setWorkspace] = useState("all");
  const [claim, setClaim] = useState<ClaimFilter>("all");
  const [view, setView] = useState<ViewMode>("board");
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceState, setSourceState] = useState<SourceLoadState>({ status: "idle" });

  const areas = useMemo(() => ["all", ...snapshot.areas.map((item) => item.name)], [snapshot.areas]);
  const workspaces = useMemo(() => ["all", ...snapshot.workspaces.map((item) => item.id)], [snapshot.workspaces]);
  const filteredEpics = useMemo(
    () => snapshot.epics.filter((epic) => (workspace === "all" || epic.workspaceId === workspace) && matchesEpic(epic, query, status, area, claim)),
    [area, claim, query, snapshot.epics, status, workspace],
  );

  useEffect(() => {
    if (filteredEpics.length === 0) {
      onSelectedEpicChange(null);
      return;
    }
    if (!selectedEpicKey || !filteredEpics.some((epic) => epic.key === selectedEpicKey)) {
      onSelectedEpicChange(filteredEpics[0]?.key ?? null);
    }
  }, [filteredEpics, onSelectedEpicChange, selectedEpicKey]);

  const selectedEpic = snapshot.epics.find((epic) => epic.key === selectedEpicKey) ?? null;
  const storyTotal = snapshot.stats.openStories + snapshot.stats.completedStories;
  const storyPercent = storyTotal > 0 ? Math.round((snapshot.stats.completedStories / storyTotal) * 100) : 0;

  const selectEpic = useCallback((key: string) => {
    onSelectedEpicChange(key);
    setDrawerOpen(true);
  }, [onSelectedEpicChange]);

  const clearNotice = useCallback(() => {
    setActionError(null);
    setActionMessage(null);
  }, []);

  const openSourceFile = useCallback(async (path: string) => {
    const cleanPath = path.trim();
    if (!cleanPath || !selectedEpic) {
      return;
    }
    setSourceOpen(true);
    setSourceState({ status: "loading", path: cleanPath });
    try {
      const source = await fetchSourceFile(selectedEpic.workspaceId, cleanPath);
      setSourceState({ status: "ready", source });
    } catch (error) {
      setSourceState({
        status: "error",
        path: cleanPath,
        error: error instanceof Error ? error.message : "Unable to open source file.",
      });
    }
  }, [selectedEpic]);

  const patchSelectedEpic = useCallback(async (patch: EpicPatch, successMessage: string) => {
    if (!selectedEpic) {
      return;
    }
    const selectedKey = selectedEpic.key;
    setSaving(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const nextSnapshot = await patchPlanningEpic(selectedEpic, patch);
      const nextSelectedEpicKey = nextSnapshot.epics.some((epic) => epic.key === selectedKey)
        ? selectedKey
        : nextSnapshot.epics[0]?.key ?? null;
      onSnapshotChange(nextSnapshot, nextSelectedEpicKey);
      setActionMessage(successMessage);
      if (isLifecyclePatch(patch)) {
        setDrawerOpen(false);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update planning files.");
    } finally {
      setSaving(false);
    }
  }, [onSnapshotChange, selectedEpic]);

  return (
    <>
      <Row className="stats-grid" gutter={[12, 12]}>
        <Col lg={4} sm={8} xs={12}>
          <Card size="small">
            <Statistic title="Epics" value={snapshot.stats.total} />
          </Card>
        </Col>
        <Col lg={4} sm={8} xs={12}>
          <Card size="small">
            <Statistic title="Claimed" value={snapshot.stats.activeClaims} />
          </Card>
        </Col>
        <Col lg={4} sm={8} xs={12}>
          <Card size="small">
            <Statistic title="Expired" value={snapshot.stats.expiredClaims} />
          </Card>
        </Col>
        <Col lg={4} sm={8} xs={12}>
          <Card size="small">
            <Statistic title="Approved" value={`${snapshot.stats.approved}/${snapshot.stats.total}`} />
          </Card>
        </Col>
        <Col lg={4} sm={8} xs={12}>
          <Card size="small">
            <Statistic title="Story progress" suffix="%" value={storyPercent} />
          </Card>
        </Col>
        <Col lg={4} sm={8} xs={12}>
          <Card size="small">
            <Statistic title="GitHub mirror" value={`${snapshot.stats.mirrored}/${snapshot.stats.total}`} />
          </Card>
        </Col>
      </Row>

      <Card className="toolbar-card" size="small">
        <div className="toolbar-grid">
          <label>
            <Text type="secondary" strong>
              Search
            </Text>
            <Input.Search
              allowClear
              placeholder="Epic, agent, file, behavior"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {snapshot.workspaces.length > 1 ? (
            <label>
              <Text type="secondary" strong>
                Workspace
              </Text>
              <Select
                options={workspaces.map((item) => ({
                  label: item === "all"
                    ? "All workspaces"
                    : snapshot.workspaces.find((candidate) => candidate.id === item)?.name ?? item,
                  value: item,
                }))}
                value={workspace}
                onChange={setWorkspace}
              />
            </label>
          ) : null}
          <label>
            <Text type="secondary" strong>
              Status
            </Text>
            <Select
              options={[{ label: "All statuses", value: "all" }, ...STATUS_OPTIONS]}
              value={status}
              onChange={(value) => setStatus(value as EpicStatus | "all")}
            />
          </label>
          <label>
            <Text type="secondary" strong>
              Area
            </Text>
            <Select
              options={areas.map((item) => ({ label: item === "all" ? "All areas" : item, value: item }))}
              value={area}
              onChange={setArea}
            />
          </label>
          <label>
            <Text type="secondary" strong>
              Claim
            </Text>
            <Select
              options={[
                { label: "All claims", value: "all" },
                { label: "Claimed", value: "active" },
                { label: "Expired", value: "expired" },
                { label: "Unclaimed", value: "unclaimed" },
              ]}
              value={claim}
              onChange={(value) => setClaim(value as ClaimFilter)}
            />
          </label>
          <Segmented
            options={[
              { label: "Board", value: "board" },
              { label: "Architecture", value: "architecture" },
              { label: "Claims", value: "claims" },
            ]}
            value={view}
            onChange={(value) => setView(value as ViewMode)}
          />
        </div>
      </Card>

      {actionMessage ? <Alert closable showIcon className="page-notice" title={actionMessage} type="success" onClose={clearNotice} /> : null}
      {actionError ? <Alert closable showIcon className="page-notice" title={actionError} type="error" onClose={clearNotice} /> : null}

      {filteredEpics.length === 0 ? (
        <Card>
          <Empty description="No matching epics" />
        </Card>
      ) : view === "board" ? (
        <PipelineBoard epics={filteredEpics} selectedEpicKey={selectedEpicKey} onSelect={selectEpic} />
      ) : view === "architecture" ? (
        <ArchitectureView areas={snapshot.areas} epics={filteredEpics} selectedEpicKey={selectedEpicKey} onSelect={selectEpic} />
      ) : (
        <ClaimsView epics={filteredEpics} selectedEpicKey={selectedEpicKey} onSelect={selectEpic} />
      )}

      <EpicDrawer
        actionError={actionError}
        actionMessage={actionMessage}
        epic={selectedEpic}
        open={drawerOpen && selectedEpic !== null}
        saving={saving}
        onClose={() => setDrawerOpen(false)}
        onOpenFile={(path) => void openSourceFile(path)}
        onNoticeClose={clearNotice}
        onPatch={patchSelectedEpic}
      />
      <CodeBrowserDrawer
        open={sourceOpen}
        state={sourceState}
        onClose={() => setSourceOpen(false)}
      />
    </>
  );
}

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      const snapshot = await fetchPlanning();
      setLoadState((previous) => {
        const previousSelection = previous.status === "ready" ? previous.selectedEpicId : null;
        const selectedEpicId = snapshot.epics.some((epic) => epic.key === previousSelection)
          ? previousSelection
          : snapshot.epics[0]?.key ?? null;
        return { status: "ready", snapshot, selectedEpicId };
      });
    } catch (error) {
      setLoadState({ status: "error", error: error instanceof Error ? error.message : "Unable to load planning" });
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void load();
    }, 0);
    const timer = window.setInterval(() => {
      void load();
    }, POLL_MS);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [load]);

  const selectedEpicChange = useCallback((id: string | null) => {
    setLoadState((previous) => previous.status === "ready" ? { ...previous, selectedEpicId: id } : previous);
  }, []);

  const snapshotChange = useCallback((snapshot: PlanningSnapshot, selectedEpicId: string | null) => {
    setLoadState({ status: "ready", snapshot, selectedEpicId });
  }, []);

  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 6,
          colorBgLayout: "#f5f7fb",
          colorPrimary: "#2563eb",
          colorText: "#172033",
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
      }}
    >
      <AntdApp>
        <Layout className="app-layout">
          <Header className="app-header">
            <div className="brand-mark" aria-hidden="true">
              <CheckCircleOutlined />
            </div>
            <div className="app-header__title">
              <Text type="secondary">Planarium</Text>
              <Title level={1}>Epic Planner</Title>
            </div>
            <Space className="header-actions" size={[8, 8]} wrap>
              {loadState.status === "ready" ? (
                <Tag color="success">Live {formatDateTime(loadState.snapshot.generatedAt)}</Tag>
              ) : null}
              <Button icon={<ReloadOutlined />} onClick={() => void load()}>
                Refresh
              </Button>
            </Space>
          </Header>

          <Content className="app-content">
            {loadState.status === "loading" ? (
              <Card>
                <Spin description="Loading planning files" />
              </Card>
            ) : loadState.status === "error" ? (
              <Alert
                showIcon
                type="error"
                title="Planning is unavailable"
                description={loadState.error}
              />
            ) : loadState.snapshot.workspaces.length === 0 ? (
              <Alert
                showIcon
                type="warning"
                title="No .planning folders found"
                description={`Planarium scanned ${loadState.snapshot.root}. Run it from a project folder, or pass --root to scan a different tree.`}
              />
            ) : (
              <SnapshotView
                snapshot={loadState.snapshot}
                selectedEpicKey={loadState.selectedEpicId}
                onSelectedEpicChange={selectedEpicChange}
                onSnapshotChange={snapshotChange}
              />
            )}
          </Content>
          <Divider className="app-divider" />
        </Layout>
      </AntdApp>
    </ConfigProvider>
  );
}
