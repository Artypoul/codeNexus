import { codexDesktop } from "../../api/codexDesktopClient";
import { notifyTurnCompleted } from "../../features/systemNotification/systemNotification";

export type CompletedTurnNotificationRuntimeDeps = {
  getThreadTitle: (threadId: string) => string;
};

export type CompletedTurnNotificationRuntime = {
  notifyCompletedTurnIfBackground: (threadId: string) => Promise<void>;
};

export function createCompletedTurnNotificationRuntime(
  deps: CompletedTurnNotificationRuntimeDeps
): CompletedTurnNotificationRuntime {
  const { getThreadTitle } = deps;

  const notifyCompletedTurnIfBackground = async (threadIdValue: string) => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return;
    const threadTitle = getThreadTitle(threadId);
    try {
      const windowState = await codexDesktop.window.getState();
      const focused =
        typeof windowState?.isFocused === "boolean"
          ? windowState.isFocused
          : typeof document !== "undefined"
            ? document.hasFocus()
            : false;
      const hidden = windowState?.isVisible === false || (typeof document !== "undefined" ? document.hidden : true);
      await notifyTurnCompleted({
        app: codexDesktop.app,
        focused,
        hidden,
        minimized: Boolean(windowState?.isMinimized),
        threadTitle,
      });
    } catch (error) {
      console.warn("[systemNotification] turn completed notification failed", error);
    }
  };

  return { notifyCompletedTurnIfBackground };
}
