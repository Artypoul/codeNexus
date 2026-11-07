import { computed, ref, watch } from "vue";
import { useThreadStore } from "../../../stores/thread.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { translate } from "../../../i18n/translate";
import type { ActivityTone } from "../types/chat.types";

export function useChatLayout() {
  const threadStore = useThreadStore();
  const runtimeStore = useRuntimeStore();

  const hiddenImageIds = ref(new Set<string>());

  const normalizeThreadId = (value: unknown): string => String(value ?? "").trim();

  const threadHistoryById = computed(
    () =>
      new Map(
        threadStore.threadHistory.map((item) => [normalizeThreadId(item?.id), item] as const).filter(([id]) => !!id)
      )
  );

  const resolveThreadLabelForDiagnostics = (threadIdValue: unknown): string => {
    const tid = normalizeThreadId(threadIdValue);
    if (!tid) return translate("chatPane.unknownThread");
    const history = threadHistoryById.value.get(tid);
    const nickname = String(history?.agentNickname ?? "").trim();
    const title = String(history?.title ?? "").trim();
    const fallback = tid.length <= 8 ? tid : `…${tid.slice(-8)}`;
    return nickname || title || fallback;
  };

  const currentThreadHandoffDiagnostics = computed(() => {
    const threadId = normalizeThreadId(runtimeStore.timelineKey);
    if (!threadId || threadId === "__app__") return null;
    return threadStore.handoffDiagnosticsByThread.get(threadId) ?? null;
  });

  const handoffDiagnosticsBanner = computed<{ text: string; tone: ActivityTone } | null>(() => {
    const threadId = normalizeThreadId(runtimeStore.timelineKey);
    if (!threadId || threadId === "__app__") return null;

    const historyItem = threadHistoryById.value.get(threadId);
    const parentThreadId = normalizeThreadId(historyItem?.forkedFromId);
    if (!parentThreadId) return null;

    if (threadStore.handoffDiagnosticsLoadingThreadIds.has(threadId) && !currentThreadHandoffDiagnostics.value) {
      return {
        text: translate("chatPane.readingHandoffSummary", {
          thread: resolveThreadLabelForDiagnostics(parentThreadId),
        }),
        tone: "running",
      };
    }

    const d = currentThreadHandoffDiagnostics.value;
    if (!d) return null;

    const parentLabel = resolveThreadLabelForDiagnostics(d.parentThreadId || parentThreadId);
    const parentTurns = d.parent?.totalTurns;
    const currentTurns = d.current.totalTurns;
    const postHandoffTurns = d.postHandoffTurns;
    const details: string[] = [];

    if (parentTurns != null)
      details.push(translate("chatPane.parentThreadTurns", { thread: parentLabel, count: parentTurns }));
    else details.push(translate("chatPane.parentThreadSummaryUnavailable", { thread: parentLabel }));

    details.push(translate("chatPane.currentTurns", { count: currentTurns }));
    if (postHandoffTurns != null)
      details.push(
        postHandoffTurns > 0
          ? translate("chatPane.postHandoffTurns", { count: postHandoffTurns })
          : translate("chatPane.inheritedTranscriptStage")
      );

    const latestDurationText = (() => {
      const ms = typeof d.current.lastTurnDurationMs === "number" ? d.current.lastTurnDurationMs : NaN;
      if (!Number.isFinite(ms) || ms <= 0) return "";
      if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
      const seconds = Math.max(1, Math.round(ms / 1000));
      if (seconds < 60) return `${seconds}s`;
      const minutes = Math.floor(seconds / 60);
      const remainSeconds = seconds % 60;
      return remainSeconds > 0 ? `${minutes}m${remainSeconds}s` : `${minutes}m`;
    })();
    if (latestDurationText) details.push(translate("chatPane.latestTurnDuration", { duration: latestDurationText }));

    return { text: details.join("｜"), tone: postHandoffTurns == null ? "warn" : postHandoffTurns > 0 ? "ok" : "warn" };
  });

  watch(
    () => runtimeStore.timelineKey,
    () => {
      hiddenImageIds.value = new Set();
    }
  );

  return {
    hiddenImageIds,
    handoffDiagnosticsBanner,
  };
}
