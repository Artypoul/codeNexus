import type { CodexDesktopAppApi } from "@codenexus/shared/ipc";
import { translate } from "../../i18n/translate";

export type SystemNotificationVisibilityState = {
  focused: boolean;
  hidden: boolean;
  minimized: boolean;
};

export function shouldSendSystemNotification(state: SystemNotificationVisibilityState): boolean {
  return Boolean(state.hidden || state.minimized || !state.focused);
}

export async function notifyTurnCompleted(args: {
  app: Pick<CodexDesktopAppApi, "showSystemNotification">;
  focused: boolean;
  hidden: boolean;
  minimized: boolean;
  threadTitle?: string | null;
}): Promise<void> {
  if (!shouldSendSystemNotification(args)) return;
  const title = String(args.threadTitle ?? "").trim() || "Codex";
  try {
    await args.app.showSystemNotification({
      title: translate("systemNotification.taskCompletedTitle"),
      body: translate("systemNotification.turnCompletedBody", { title }),
      silent: true,
    });
  } catch (error) {
    console.warn("[systemNotification] show failed", error);
  }
}
