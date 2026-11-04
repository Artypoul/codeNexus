// 运行时 Store：当前工作区、服务连接、会话与基础运行参数（model / sandbox 等）。
import { defineStore } from "pinia";
import { watch } from "vue";
import type { CollaborationModeKind, ComposeImageAttachment, ComposeWorkspaceFileMention } from "../domain/types";
import type { SandboxMode } from "@codenexus/generated/codex-app-server/v2/SandboxMode";
import { DEFAULT_LOCAL_THREAD_COMPOSE_STATE, type LocalDraftState } from "@codenexus/shared/localDraftState";
import {
  clearSavedLocalDraftThreadState,
  saveLocalDraftThreadState,
  saveLocalDraftThreadStates,
} from "../domain/localDraftState";

export type { SandboxMode };

type ThreadComposeState = {
  sandboxMode: SandboxMode;
  composeInput: string;
  composeMode: CollaborationModeKind;
  model: string;
  reasoningEffort: string;
  reasoningSummary: string;
};

type ThreadComposeSeed = Partial<{
  sandboxMode: string;
  composeMode: CollaborationModeKind;
  model: string;
  reasoningEffort: string;
  reasoningSummary: string;
}>;

const APP_TIMELINE_ID = "__app__";
const COMPOSE_STATE_SAVE_DEBOUNCE_MS = 300;

const DEFAULT_COMPOSE_STATE: ThreadComposeState = {
  ...DEFAULT_LOCAL_THREAD_COMPOSE_STATE,
};

function threadKey(threadId: string): string {
  const tid = String(threadId ?? "").trim();
  return tid || APP_TIMELINE_ID;
}

function isSandboxMode(value: unknown): value is SandboxMode {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access";
}

function isComposeMode(value: unknown): value is CollaborationModeKind {
  return value === "default" || value === "plan";
}

function normalizeReasoningEffort(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeComposeState(value: unknown): ThreadComposeState {
  const anyValue = value && typeof value === "object" ? (value as any) : null;
  return {
    sandboxMode: isSandboxMode(anyValue?.sandboxMode) ? anyValue.sandboxMode : DEFAULT_COMPOSE_STATE.sandboxMode,
    composeInput:
      typeof anyValue?.composeInput === "string" ? anyValue.composeInput : DEFAULT_COMPOSE_STATE.composeInput,
    composeMode: isComposeMode(anyValue?.composeMode) ? anyValue.composeMode : DEFAULT_COMPOSE_STATE.composeMode,
    model: typeof anyValue?.model === "string" ? String(anyValue.model).trim() : "",
    reasoningEffort: normalizeReasoningEffort(anyValue?.reasoningEffort),
    reasoningSummary:
      typeof anyValue?.reasoningSummary === "string"
        ? anyValue.reasoningSummary
        : DEFAULT_COMPOSE_STATE.reasoningSummary,
  };
}

function buildThreadComposeStateFromSeed(seed?: ThreadComposeSeed): ThreadComposeState {
  const next = normalizeComposeState({
    ...DEFAULT_COMPOSE_STATE,
    ...seed,
    composeInput: "",
  });
  return {
    ...next,
    composeInput: "",
  };
}

function cloneComposeAttachment(value: ComposeImageAttachment): ComposeImageAttachment {
  return {
    ...value,
    input:
      value.input.type === "image"
        ? { type: "image", url: value.input.url }
        : { type: "localImage", path: value.input.path },
  };
}

function cloneComposeAttachments(values: ComposeImageAttachment[] | undefined): ComposeImageAttachment[] {
  if (!Array.isArray(values) || values.length === 0) return [];
  return values.map((value) => cloneComposeAttachment(value));
}

function cloneComposeFileMention(value: ComposeWorkspaceFileMention): ComposeWorkspaceFileMention {
  const kind =
    value.kind === "directory" || value.kind === "skill" || value.kind === "mention"
      ? value.kind
      : value.kind === "file"
        ? "file"
        : undefined;
  const name = String(value.name ?? "").trim();
  const displayName = String(value.displayName ?? "").trim();
  const iconUrl = String(value.iconUrl ?? "").trim();
  return {
    id: String(value.id ?? "").trim(),
    path: String(value.path ?? "").trim(),
    ...(kind ? { kind } : {}),
    ...(name ? { name } : {}),
    ...(displayName ? { displayName } : {}),
    ...(iconUrl ? { iconUrl } : {}),
  };
}

function cloneComposeFileMentions(values: ComposeWorkspaceFileMention[] | undefined): ComposeWorkspaceFileMention[] {
  if (!Array.isArray(values) || values.length === 0) return [];
  return values.map((value) => cloneComposeFileMention(value));
}

function safeRevokeComposePreviewUrl(
  item: Pick<ComposeImageAttachment, "previewUrl" | "revokePreviewUrlOnDispose">
): void {
  if (!item.revokePreviewUrlOnDispose) return;
  const preview = String(item.previewUrl ?? "");
  if (!preview) return;
  try {
    URL.revokeObjectURL(preview);
  } catch {}
}

function disposeComposeAttachments(values: ComposeImageAttachment[] | undefined): void {
  if (!Array.isArray(values) || values.length === 0) return;
  for (const value of values) safeRevokeComposePreviewUrl(value);
}

function composeAttachmentIdentity(value: ComposeImageAttachment): string {
  if (value.input.type === "image") {
    return `image:${String(value.input.url ?? "")}`;
  }
  return `localImage:${String(value.input.path ?? "")}`;
}

function composeFileMentionIdentity(value: Pick<ComposeWorkspaceFileMention, "path">): string {
  return String(value.path ?? "")
    .trim()
    .toLowerCase();
}

const saveTimerByThread = new Map<string, ReturnType<typeof setTimeout>>();
let stopComposeStateSaveWatch: (() => void) | null = null;

export const useRuntimeStore = defineStore("runtime", {
  state: () => ({
    serverId: "" as string,
    workspacePath: "" as string,
    navigationRevision: 0,
    currentThreadId: "" as string,
    // 当前线程输入与参数（在 setCurrentThread 时按线程保存/恢复）。
    sandboxMode: DEFAULT_COMPOSE_STATE.sandboxMode as SandboxMode,
    composeInput: DEFAULT_COMPOSE_STATE.composeInput as string,
    composeMode: DEFAULT_COMPOSE_STATE.composeMode as CollaborationModeKind,
    model: DEFAULT_COMPOSE_STATE.model as string,
    reasoningEffort: DEFAULT_COMPOSE_STATE.reasoningEffort as string,
    reasoningSummary: DEFAULT_COMPOSE_STATE.reasoningSummary as string,
    // 线程级草稿与参数：输入框、协作模式、模型、思考强度、权限等都随线程隔离。
    composeStateByThreadId: {
      [APP_TIMELINE_ID]: { ...DEFAULT_COMPOSE_STATE },
    } as Record<string, ThreadComposeState>,
    // Keep image attachments in memory only; do not save preview URLs.
    composeAttachments: [] as ComposeImageAttachment[],
    composeAttachmentsByThreadId: {
      [APP_TIMELINE_ID]: [],
    } as Record<string, ComposeImageAttachment[]>,
    composeFileMentions: [] as ComposeWorkspaceFileMention[],
    composeFileMentionsByThreadId: {
      [APP_TIMELINE_ID]: [],
    } as Record<string, ComposeWorkspaceFileMention[]>,
    // Compose rewrite mode temporarily reuses history or queue content as the current draft.
    historyRewriteActive: false,
    historyRewriteSource: "history" as "history" | "queue",
    historyRewriteAnchorEventId: "" as string,
    historyRewriteAnchorTurnId: "" as string,
    historyRewriteSavedDraft: "" as string,
    historyRewriteSavedAttachments: [] as ComposeImageAttachment[],
    historyRewriteSavedMentions: [] as ComposeWorkspaceFileMention[],
    composerFocusSeq: 0,
    timelineDebugEnabled: false,
    pendingThreadInitSendCountByThread: new Map<string, number>(),
    timelineScrollToBottomSeq: 0,
  }),
  getters: {
    // 未选线程时使用全局时间线 key，避免渲染层出现空 key 分支判断。
    timelineKey(state): string {
      return threadKey(state.currentThreadId);
    },
  },
  actions: {
    hydrateFromLocalDraftState(snapshot: LocalDraftState) {
      const threads: Record<string, ThreadComposeState> = {
        [APP_TIMELINE_ID]: { ...DEFAULT_COMPOSE_STATE },
      };
      for (const [threadId, state] of Object.entries(snapshot?.threads ?? {})) {
        const key = threadKey(threadId);
        if (!key) continue;
        threads[key] = normalizeComposeState(state);
      }
      this.composeStateByThreadId = threads;
      const currentState = this.composeStateByThreadId[threadKey(this.currentThreadId)] ?? { ...DEFAULT_COMPOSE_STATE };
      this.sandboxMode = currentState.sandboxMode;
      this.composeInput = currentState.composeInput;
      this.composeMode = currentState.composeMode;
      this.model = currentState.model;
      this.reasoningEffort = currentState.reasoningEffort;
      this.reasoningSummary = currentState.reasoningSummary;
    },
    // 保存当前线程的 compose 状态到映射表。
    saveThreadComposeState(threadIdValue?: string, opts?: { save?: boolean }) {
      const shouldSave = opts?.save ?? false;
      const key = threadKey(threadIdValue ?? this.currentThreadId);
      this.composeStateByThreadId[key] = {
        sandboxMode: this.sandboxMode,
        composeInput: this.composeInput,
        composeMode: this.composeMode,
        model: this.model,
        reasoningEffort: this.reasoningEffort,
        reasoningSummary: this.reasoningSummary,
      };
      if (shouldSave) this.scheduleSaveThreadComposeState(key);
    },
    saveThreadComposeAttachments(threadIdValue?: string) {
      const key = threadKey(threadIdValue ?? this.currentThreadId);
      this.composeAttachmentsByThreadId[key] = cloneComposeAttachments(this.composeAttachments);
    },
    saveThreadComposeFileMentions(threadIdValue?: string) {
      const key = threadKey(threadIdValue ?? this.currentThreadId);
      this.composeFileMentionsByThreadId[key] = cloneComposeFileMentions(this.composeFileMentions);
    },
    loadThreadComposeAttachments(threadIdValue?: string) {
      const key = threadKey(threadIdValue ?? this.currentThreadId);
      const existing = this.composeAttachmentsByThreadId[key];
      if (!existing) {
        this.composeAttachments = [];
        this.composeAttachmentsByThreadId[key] = [];
        return;
      }
      this.composeAttachments = cloneComposeAttachments(existing);
    },
    loadThreadComposeFileMentions(threadIdValue?: string) {
      const key = threadKey(threadIdValue ?? this.currentThreadId);
      const existing = this.composeFileMentionsByThreadId[key];
      if (!existing) {
        this.composeFileMentions = [];
        this.composeFileMentionsByThreadId[key] = [];
        return;
      }
      this.composeFileMentions = cloneComposeFileMentions(existing);
    },
    addComposeAttachments(values: ComposeImageAttachment[]) {
      const incoming = cloneComposeAttachments(values);
      if (incoming.length === 0) return;
      const seen = new Set(this.composeAttachments.map((item) => composeAttachmentIdentity(item)));
      const next = [...this.composeAttachments];
      for (const item of incoming) {
        const identity = composeAttachmentIdentity(item);
        if (seen.has(identity)) {
          // Avoid leaking the new preview URL when the attachment is a duplicate.
          safeRevokeComposePreviewUrl(item);
          continue;
        }
        seen.add(identity);
        next.push(item);
      }
      this.composeAttachments = next;
      this.saveThreadComposeAttachments(this.currentThreadId);
    },
    addComposeFileMentions(
      values: Array<Pick<ComposeWorkspaceFileMention, "path" | "kind" | "name" | "displayName" | "iconUrl">>
    ) {
      const incoming = Array.isArray(values)
        ? values
            .map((value, index) => {
              const path = String(value.path ?? "").trim();
              if (!path) return null;
              return {
                id: `compose-file:${Date.now()}:${index}:${Math.random().toString(16).slice(2)}`,
                path,
                ...(value.kind === "directory" ||
                value.kind === "file" ||
                value.kind === "skill" ||
                value.kind === "mention"
                  ? { kind: value.kind }
                  : {}),
                ...(String(value.name ?? "").trim() ? { name: String(value.name).trim() } : {}),
                ...(String(value.displayName ?? "").trim() ? { displayName: String(value.displayName).trim() } : {}),
                ...(String(value.iconUrl ?? "").trim() ? { iconUrl: String(value.iconUrl).trim() } : {}),
              } satisfies ComposeWorkspaceFileMention;
            })
            .filter((value): value is ComposeWorkspaceFileMention => Boolean(value))
        : [];
      if (incoming.length === 0) return;
      const seen = new Set(this.composeFileMentions.map((item) => composeFileMentionIdentity(item)));
      const next = [...this.composeFileMentions];
      for (const item of incoming) {
        const identity = composeFileMentionIdentity(item);
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        next.push(item);
      }
      this.composeFileMentions = next;
      this.saveThreadComposeFileMentions(this.currentThreadId);
    },
    removeComposeAttachment(attachmentId: string) {
      const id = String(attachmentId ?? "").trim();
      if (!id) return;
      const idx = this.composeAttachments.findIndex((item) => item.id === id);
      if (idx < 0) return;
      const removed = this.composeAttachments[idx];
      this.composeAttachments = this.composeAttachments.filter((item) => item.id !== id);
      safeRevokeComposePreviewUrl(removed);
      this.saveThreadComposeAttachments(this.currentThreadId);
    },
    removeComposeFileMention(mentionId: string) {
      const id = String(mentionId ?? "").trim();
      if (!id) return;
      const idx = this.composeFileMentions.findIndex((item) => item.id === id);
      if (idx < 0) return;
      this.composeFileMentions = this.composeFileMentions.filter((item) => item.id !== id);
      this.saveThreadComposeFileMentions(this.currentThreadId);
    },
    clearComposeAttachments(threadIdValue?: string) {
      const key = threadKey(threadIdValue ?? this.currentThreadId);
      const currentKey = threadKey(this.currentThreadId);
      const list = key === currentKey ? this.composeAttachments : (this.composeAttachmentsByThreadId[key] ?? []);
      disposeComposeAttachments(list);
      if (key === currentKey) this.composeAttachments = [];
      this.composeAttachmentsByThreadId[key] = [];
    },
    clearComposeFileMentions(threadIdValue?: string) {
      const key = threadKey(threadIdValue ?? this.currentThreadId);
      const currentKey = threadKey(this.currentThreadId);
      if (key === currentKey) this.composeFileMentions = [];
      this.composeFileMentionsByThreadId[key] = [];
    },
    scheduleSaveThreadComposeState(threadIdValue: string) {
      const key = threadKey(threadIdValue);
      const existing = saveTimerByThread.get(key);
      if (existing) return;

      const timer = setTimeout(() => {
        saveTimerByThread.delete(key);
        const state = this.composeStateByThreadId[key];
        if (!state) return;
        void saveLocalDraftThreadState(key, state);
      }, COMPOSE_STATE_SAVE_DEBOUNCE_MS);

      saveTimerByThread.set(key, timer);
    },
    // 立即持久化：用于窗口关闭等场景，避免防抖计时器未触发导致草稿丢失。
    async saveThreadComposeStateNow(threadIdValue?: string): Promise<void> {
      const key = threadKey(threadIdValue ?? this.currentThreadId);
      const timer = saveTimerByThread.get(key);
      if (timer) {
        try {
          clearTimeout(timer);
        } catch {}
        saveTimerByThread.delete(key);
      }

      const useCurrentFields = key === threadKey(this.currentThreadId);
      const state = useCurrentFields
        ? {
            sandboxMode: this.sandboxMode,
            composeInput: this.composeInput,
            composeMode: this.composeMode,
            model: this.model,
            reasoningEffort: this.reasoningEffort,
            reasoningSummary: this.reasoningSummary,
          }
        : (this.composeStateByThreadId[key] ?? { ...DEFAULT_COMPOSE_STATE });

      this.composeStateByThreadId[key] = { ...state };
      await saveLocalDraftThreadState(key, state);
    },
    // 立即落盘所有“等待防抖写入”的线程状态（以及当前线程）。
    async flushPendingComposeStateSaves(): Promise<void> {
      const currentKey = threadKey(this.currentThreadId);
      const keys = new Set<string>([currentKey, ...Array.from(saveTimerByThread.keys())]);
      const statesByThread: Record<string, ThreadComposeState> = {};

      for (const key of keys) {
        const timer = saveTimerByThread.get(key);
        if (timer) {
          try {
            clearTimeout(timer);
          } catch {}
          saveTimerByThread.delete(key);
        }

        const useCurrentFields = key === currentKey;
        const state = useCurrentFields
          ? {
              sandboxMode: this.sandboxMode,
              composeInput: this.composeInput,
              composeMode: this.composeMode,
              model: this.model,
              reasoningEffort: this.reasoningEffort,
              reasoningSummary: this.reasoningSummary,
            }
          : (this.composeStateByThreadId[key] ?? { ...DEFAULT_COMPOSE_STATE });

        this.composeStateByThreadId[key] = { ...state };
        statesByThread[key] = { ...state };
      }

      await saveLocalDraftThreadStates(statesByThread);
    },
    // 加载指定线程的 compose 状态；若不存在则用默认值初始化。
    loadThreadComposeState(threadIdValue: string) {
      const key = threadKey(threadIdValue);
      const existing = this.composeStateByThreadId[key];
      const next = existing ? { ...existing } : { ...DEFAULT_COMPOSE_STATE };
      if (!existing) this.composeStateByThreadId[key] = { ...next };
      this.sandboxMode = next.sandboxMode;
      this.composeInput = next.composeInput;
      this.composeMode = next.composeMode;
      this.model = next.model;
      this.reasoningEffort = next.reasoningEffort;
      this.reasoningSummary = next.reasoningSummary;
    },
    clearThreadComposeState(threadIdValue: string) {
      const key = threadKey(threadIdValue);
      if (key === threadKey(this.currentThreadId)) {
        this.clearComposeAttachments(this.currentThreadId);
        this.clearComposeFileMentions(this.currentThreadId);
      } else {
        this.clearComposeAttachments(key);
        this.clearComposeFileMentions(key);
      }
      this.pendingThreadInitSendCountByThread.delete(key);
      this.composeStateByThreadId = Object.fromEntries(
        Object.entries(this.composeStateByThreadId).filter(([k]) => k !== key)
      ) as Record<string, ThreadComposeState>;
      this.composeAttachmentsByThreadId = Object.fromEntries(
        Object.entries(this.composeAttachmentsByThreadId).filter(([k]) => k !== key)
      ) as Record<string, ComposeImageAttachment[]>;
      this.composeFileMentionsByThreadId = Object.fromEntries(
        Object.entries(this.composeFileMentionsByThreadId).filter(([k]) => k !== key)
      ) as Record<string, ComposeWorkspaceFileMention[]>;

      const timer = saveTimerByThread.get(key);
      if (timer) {
        try {
          clearTimeout(timer);
        } catch {}
        saveTimerByThread.delete(key);
      }
      void clearSavedLocalDraftThreadState(key);
    },
    moveThreadComposeState(fromThreadIdValue: string, toThreadIdValue: string) {
      const fromKey = threadKey(fromThreadIdValue);
      const toKey = threadKey(toThreadIdValue);
      if (!fromKey || !toKey || fromKey === toKey) return;

      const sourceState = this.composeStateByThreadId[fromKey];
      const sourceAttachments = this.composeAttachmentsByThreadId[fromKey];
      const sourceMentions = this.composeFileMentionsByThreadId[fromKey];
      const hadPendingSave = saveTimerByThread.has(fromKey);
      const timer = saveTimerByThread.get(fromKey);
      if (timer) {
        try {
          clearTimeout(timer);
        } catch {}
        saveTimerByThread.delete(fromKey);
      }

      if (sourceState) {
        this.composeStateByThreadId[toKey] = { ...sourceState };
      }
      if (sourceAttachments) {
        this.composeAttachmentsByThreadId[toKey] = cloneComposeAttachments(sourceAttachments);
      } else if (!(toKey in this.composeAttachmentsByThreadId)) {
        this.composeAttachmentsByThreadId[toKey] = [];
      }
      if (sourceMentions) {
        this.composeFileMentionsByThreadId[toKey] = cloneComposeFileMentions(sourceMentions);
      } else if (!(toKey in this.composeFileMentionsByThreadId)) {
        this.composeFileMentionsByThreadId[toKey] = [];
      }

      if (threadKey(this.currentThreadId) === fromKey) {
        this.currentThreadId = String(toThreadIdValue ?? "").trim();
      }

      if (fromKey !== APP_TIMELINE_ID) {
        this.composeStateByThreadId = Object.fromEntries(
          Object.entries(this.composeStateByThreadId).filter(([k]) => k !== fromKey)
        ) as Record<string, ThreadComposeState>;
        this.composeAttachmentsByThreadId = Object.fromEntries(
          Object.entries(this.composeAttachmentsByThreadId).filter(([k]) => k !== fromKey)
        ) as Record<string, ComposeImageAttachment[]>;
        this.composeFileMentionsByThreadId = Object.fromEntries(
          Object.entries(this.composeFileMentionsByThreadId).filter(([k]) => k !== fromKey)
        ) as Record<string, ComposeWorkspaceFileMention[]>;
      }

      if (hadPendingSave) this.scheduleSaveThreadComposeState(toKey);
      void clearSavedLocalDraftThreadState(fromKey);
    },
    // 为新线程预置参数：从某个线程拷贝（不带 composeInput 草稿）。
    seedThreadComposeState(threadIdValue: string, fromThreadIdValue?: string) {
      const key = threadKey(threadIdValue);
      const fromKey = threadKey(fromThreadIdValue ?? this.currentThreadId);
      // 以当前 UI 值为准，避免映射表滞后导致“新线程未继承最新选择”。
      if (fromKey === threadKey(this.currentThreadId)) {
        this.saveThreadComposeState(this.currentThreadId, { save: false });
      }
      const source = this.composeStateByThreadId[fromKey] ?? {
        sandboxMode: this.sandboxMode,
        composeInput: this.composeInput,
        composeMode: this.composeMode,
        model: this.model,
        reasoningEffort: this.reasoningEffort,
        reasoningSummary: this.reasoningSummary,
      };
      this.composeStateByThreadId[key] = {
        sandboxMode: source.sandboxMode,
        composeInput: "",
        composeMode: source.composeMode,
        model: source.model,
        reasoningEffort: source.reasoningEffort,
        reasoningSummary: source.reasoningSummary,
      };
      this.composeAttachmentsByThreadId[key] = [];
      this.composeFileMentionsByThreadId[key] = [];
    },
    // 为新线程预置参数：直接使用调用方提供的种子值（典型场景：右侧全局配置）。
    seedThreadComposeStateFromSeed(threadIdValue: string, seed?: ThreadComposeSeed) {
      const key = threadKey(threadIdValue);
      this.composeStateByThreadId[key] = buildThreadComposeStateFromSeed(seed);
      this.composeAttachmentsByThreadId[key] = [];
      this.composeFileMentionsByThreadId[key] = [];
    },
    // 设置当前连接的 serverId。
    setServer(nextServerId: string) {
      this.serverId = nextServerId;
    },
    clearServer() {
      this.serverId = "";
    },
    setWorkspace(path: string) {
      this.workspacePath = path;
    },
    setCurrentThread(threadId: string, opts?: { savePrev?: boolean }) {
      const savePrev = opts?.savePrev ?? true;
      // Exit history rewrite mode before switching threads.
      if (this.historyRewriteActive) this.cancelHistoryRewrite({ restoreDraft: true });
      // Save the current thread draft and compose settings before switching away.
      if (savePrev) {
        this.saveThreadComposeState(this.currentThreadId, { save: true });
        this.saveThreadComposeAttachments(this.currentThreadId);
        this.saveThreadComposeFileMentions(this.currentThreadId);
      }
      const tid = String(threadId ?? "").trim();
      this.currentThreadId = tid;
      // Load the target thread draft and compose settings after switching.
      this.loadThreadComposeState(tid);
      this.loadThreadComposeAttachments(tid);
      this.loadThreadComposeFileMentions(tid);
    },
    requestFocusComposer() {
      this.composerFocusSeq += 1;
    },
    startHistoryRewrite(args: {
      anchorEventId?: string;
      anchorTurnId?: string;
      prefillText: string;
      source?: "history" | "queue";
      prefillAttachments?: ComposeImageAttachment[];
      prefillMentions?: ComposeWorkspaceFileMention[];
    }) {
      const source = args?.source === "queue" ? "queue" : "history";
      const anchorEventId = source === "history" ? String(args.anchorEventId ?? "").trim() : "";
      const anchorTurnId = source === "history" ? String(args.anchorTurnId ?? "").trim() : "";
      const prefillText = String(args.prefillText ?? "");
      const prefillAttachments = cloneComposeAttachments(args.prefillAttachments);
      const prefillMentions = cloneComposeFileMentions(args.prefillMentions);
      if (!this.historyRewriteActive) {
        this.historyRewriteSavedDraft = this.composeInput;
        this.historyRewriteSavedAttachments = cloneComposeAttachments(this.composeAttachments);
        this.historyRewriteSavedMentions = cloneComposeFileMentions(this.composeFileMentions);
      } else {
        disposeComposeAttachments(this.composeAttachments);
      }
      this.historyRewriteActive = true;
      this.historyRewriteSource = source;
      this.historyRewriteAnchorEventId = anchorEventId;
      this.historyRewriteAnchorTurnId = anchorTurnId;
      this.composeInput = prefillText;
      this.composeAttachments = prefillAttachments;
      this.composeFileMentions = prefillMentions;
      this.saveThreadComposeAttachments(this.currentThreadId);
      this.saveThreadComposeFileMentions(this.currentThreadId);
      this.requestFocusComposer();
    },
    startQueueRewrite(args: {
      prefillText: string;
      prefillAttachments?: ComposeImageAttachment[];
      prefillMentions?: ComposeWorkspaceFileMention[];
    }) {
      this.startHistoryRewrite({
        source: "queue",
        prefillText: String(args?.prefillText ?? ""),
        prefillAttachments: cloneComposeAttachments(args?.prefillAttachments),
        prefillMentions: cloneComposeFileMentions(args?.prefillMentions),
      });
    },
    endHistoryRewrite() {
      if (!this.historyRewriteActive) return;
      const savedAttachments = this.historyRewriteSavedAttachments;
      this.historyRewriteActive = false;
      this.historyRewriteSource = "history";
      this.historyRewriteAnchorEventId = "";
      this.historyRewriteAnchorTurnId = "";
      this.historyRewriteSavedDraft = "";
      this.historyRewriteSavedAttachments = [];
      this.historyRewriteSavedMentions = [];
      disposeComposeAttachments(savedAttachments);
    },
    cancelHistoryRewrite(opts?: { restoreDraft?: boolean }) {
      if (!this.historyRewriteActive) return;
      const restoreDraft = opts?.restoreDraft ?? true;
      const draft = this.historyRewriteSavedDraft;
      const savedAttachments = this.historyRewriteSavedAttachments;
      const savedMentions = this.historyRewriteSavedMentions;
      const activeAttachments = this.composeAttachments;
      this.historyRewriteActive = false;
      this.historyRewriteSource = "history";
      this.historyRewriteAnchorEventId = "";
      this.historyRewriteAnchorTurnId = "";
      this.historyRewriteSavedDraft = "";
      this.historyRewriteSavedAttachments = [];
      this.historyRewriteSavedMentions = [];
      if (restoreDraft) {
        this.composeInput = draft;
        this.composeAttachments = cloneComposeAttachments(savedAttachments);
        this.composeFileMentions = cloneComposeFileMentions(savedMentions);
      } else {
        this.composeAttachments = [];
        this.composeFileMentions = [];
        disposeComposeAttachments(savedAttachments);
      }
      this.saveThreadComposeAttachments(this.currentThreadId);
      this.saveThreadComposeFileMentions(this.currentThreadId);
      disposeComposeAttachments(activeAttachments);
      this.requestFocusComposer();
    },
    setSandboxMode(mode: SandboxMode) {
      this.sandboxMode = mode;
    },
    setComposeMode(mode: CollaborationModeKind) {
      this.composeMode = mode;
    },
    initLocalDraftState() {
      // Restore saved compose state for the current thread on startup.
      this.loadThreadComposeState(this.currentThreadId);
      this.loadThreadComposeAttachments(this.currentThreadId);
      this.loadThreadComposeFileMentions(this.currentThreadId);

      if (stopComposeStateSaveWatch) return;
      stopComposeStateSaveWatch = watch(
        () =>
          [
            this.currentThreadId,
            this.sandboxMode,
            this.composeInput,
            this.composeMode,
            this.model,
            this.reasoningEffort,
            this.reasoningSummary,
          ] as const,
        () => {
          // 同步映射表并持久化：输入框与运行参数均按线程隔离。
          this.saveThreadComposeState(this.currentThreadId, { save: true });
        },
        { flush: "post" }
      );
    },
    setTimelineDebugEnabled(enabled: boolean) {
      this.timelineDebugEnabled = Boolean(enabled);
    },
    toggleTimelineDebugEnabled() {
      this.timelineDebugEnabled = !this.timelineDebugEnabled;
    },
    setPendingThreadInitSendCount(threadIdValue: string, countValue: number) {
      const key = threadKey(threadIdValue);
      const count = Number.isFinite(countValue) ? Math.max(0, Math.round(countValue)) : 0;
      if (count <= 0) {
        this.pendingThreadInitSendCountByThread.delete(key);
        return;
      }
      this.pendingThreadInitSendCountByThread.set(key, count);
    },
    clearPendingThreadInitSendCount(threadIdValue: string) {
      const key = threadKey(threadIdValue);
      this.pendingThreadInitSendCountByThread.delete(key);
    },
    movePendingThreadInitSendCount(fromThreadIdValue: string, toThreadIdValue: string) {
      const fromKey = threadKey(fromThreadIdValue);
      const toKey = threadKey(toThreadIdValue);
      if (!fromKey || !toKey || fromKey === toKey) return;
      const count = this.pendingThreadInitSendCountByThread.get(fromKey);
      this.pendingThreadInitSendCountByThread.delete(fromKey);
      if (count == null || count <= 0) return;
      this.pendingThreadInitSendCountByThread.set(toKey, count);
    },
    // Request the chat timeline to scroll back to the latest content.
    requestScrollTimelineToBottom() {
      this.timelineScrollToBottomSeq += 1;
    },
  },
});
