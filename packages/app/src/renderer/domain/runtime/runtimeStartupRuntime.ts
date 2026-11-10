import type { Pinia } from "pinia";
import type { useThreadStore } from "../../stores/thread.store";
import { installEventPipeline } from "../../processes/protocol-event-pipeline/installEventPipeline";
import { installRequestResponder } from "../../processes/protocol-request-responder/installRequestResponder";
import type { ApprovalLifecycleController } from "../../processes/protocol-request-responder/approvalLifecycle";
import { createHistoryTitleOverridesRuntime } from "./historyTitleOverridesRuntime";

type ThreadStore = ReturnType<typeof useThreadStore>;
type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

export type RuntimeStartupRuntimeDeps = {
  pinia: Pinia;
  approvalLifecycle: ApprovalLifecycleController;
  threadStore: ThreadStore;
  subscribeHistoryUpdates: () => () => void;
  subscribeCodexServerEvents: () => () => void;
  refreshHistory: (force?: boolean) => Promise<void>;
  resetSidePanelStores: (statusText?: string) => void;
  translate: TranslateFn;
};

export type RuntimeStartupRuntime = {
  startRuntime: () => Array<() => void>;
};

export function createRuntimeStartupRuntime(deps: RuntimeStartupRuntimeDeps): RuntimeStartupRuntime {
  const startRuntime = () => {
    const disposers: Array<() => void> = [];
    disposers.push(deps.subscribeHistoryUpdates());
    disposers.push(deps.subscribeCodexServerEvents());
    disposers.push(installEventPipeline(deps.pinia));
    disposers.push(installRequestResponder(deps.pinia, deps.approvalLifecycle));

    const historyTitleOverridesRuntime = createHistoryTitleOverridesRuntime({ threadStore: deps.threadStore });
    void historyTitleOverridesRuntime.refreshThreadTitleOverrides();
    void deps.refreshHistory(false);
    deps.resetSidePanelStores(deps.translate("runtime.noService"));

    return disposers;
  };

  return { startRuntime };
}
