import type { Pinia } from "pinia";
import { codexDesktop } from "../../api/codexDesktopClient";
import {
  buildAuthRefreshNotImplementedError,
  buildInvalidUserInputPayloadError,
  buildRequestMethodNotImplementedError,
  classifyServerRequest,
  getServerRequestThreadId,
  isServerRequest,
  respondRequestError,
} from "../../app/events/requestHandlers";
import { buildApprovalPromptFromRequest } from "../../app/events/approvalPrompts";
import { useTimelineStore } from "../../stores/timeline.store";
import { useUserInputStore } from "../../stores/userInput.store";
import { useApprovalStore } from "../../stores/approval.store";
import { useImageWorkbenchStore } from "@codenexus/feature-imagegen/renderer/store";
import { useRuntimeStore } from "../../stores/runtime.store";
import { translate } from "../../i18n/translate";
import { normalizeUserInputPrompt } from "../../domain/userInputInterop";
import { safeJsonStringify } from "../../utils/safeJson";
import {
  isCodexLocalEventMessage,
  isCodexServerNotificationMessage,
  isCodexServerRequestMessage,
} from "@codenexus/shared/codex-protocol";
import type { ApprovalLifecycleController, ApprovalMethod } from "./approvalLifecycle";
import {
  IMAGE_GENERATION_DYNAMIC_TOOL_NAME,
  IMAGE_GENERATION_DYNAMIC_TOOL_NAMESPACE,
} from "@codenexus/shared/dynamicTools";
import type { DynamicToolCallParams } from "@codenexus/generated/codex-app-server/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "@codenexus/generated/codex-app-server/v2/DynamicToolCallResponse";
import type { ImageWorkbenchHistoryItem } from "@codenexus/feature-imagegen/renderer/store";
import type {
  ImageGenerationGenerateArgs,
  ImageGenerationHistoryItem,
  ImageGenerationTaskItem,
} from "@codenexus/feature-imagegen/types";

const IMAGE_TOOL_TASK_POLL_INTERVAL_MS = 1500;
const IMAGE_TOOL_TASK_WAIT_TIMEOUT_MS = 610_000;
const IMAGE_TOOL_MAX_REFERENCE_IMAGES = 4;

function toPrettyJson(value: unknown): string {
  return safeJsonStringify(value ?? {}, { space: 2 });
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toNullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function toIntegerInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  return Math.max(min, Math.min(max, rounded));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function fileNameFromPathLike(value: string, fallback: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return fallback;
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || fallback;
}

function extensionFromDataUrl(value: string): string {
  const match = String(value ?? "")
    .trim()
    .match(/^data:image\/([^;]+);base64,/i);
  const raw = String(match?.[1] ?? "png").toLowerCase();
  if (raw === "jpeg") return "jpg";
  const ext = raw.replace(/[^a-z0-9.+-]/gi, "");
  return ext || "png";
}

function normalizeImageToolCallParams(value: unknown): DynamicToolCallParams | null {
  const params = toRecord(value);
  const threadId = toNullableText(params.threadId);
  const turnId = toNullableText(params.turnId);
  const callId = toNullableText(params.callId);
  const tool = toNullableText(params.tool);
  if (!threadId || !turnId || !callId || !tool) return null;
  return {
    threadId,
    turnId,
    callId,
    namespace: toNullableText(params.namespace),
    tool,
    arguments: (params.arguments ?? {}) as DynamicToolCallParams["arguments"],
  };
}

function buildImageGenerationEventId(params: DynamicToolCallParams): string {
  return `local:imageGeneration:${params.threadId}:${params.turnId}:${params.callId}`;
}

function buildImageGenerationItem(
  params: DynamicToolCallParams,
  status: string,
  extra?: { savedPaths?: string[]; revisedPrompt?: string | null; errorText?: string; pendingImageCount?: number }
) {
  return {
    type: "imageGeneration",
    id: params.callId,
    status,
    pendingImageCount: extra?.pendingImageCount,
    revisedPrompt: extra?.revisedPrompt ?? null,
    result: "",
    savedPath: extra?.savedPaths?.[0] ?? "",
    savedPaths: extra?.savedPaths ?? [],
    errorText: extra?.errorText ?? "",
  };
}

function filterPersistedImageWorkbenchHistoryItems(items: ImageWorkbenchHistoryItem[]): ImageGenerationHistoryItem[] {
  return items.filter((item): item is ImageGenerationHistoryItem => item.workbenchStatus === undefined);
}

function upsertImageGenerationEvent(
  timelineStore: ReturnType<typeof useTimelineStore>,
  params: DynamicToolCallParams,
  method: "item/started" | "item/completed",
  status: string,
  paramsText: string,
  extra?: {
    savedPaths?: string[];
    revisedPrompt?: string | null;
    errorText?: string;
    pendingImageCount?: number;
    level?: "info" | "error";
  }
) {
  timelineStore.upsertEvent({
    threadId: params.threadId,
    id: buildImageGenerationEventId(params),
    method,
    paramsText,
    params: {
      threadId: params.threadId,
      turnId: params.turnId,
      item: buildImageGenerationItem(params, status, extra),
    },
    turnId: params.turnId,
    level: extra?.level ?? "info",
  });
}

function buildFailedToolResponse(message: string): DynamicToolCallResponse {
  return {
    success: false,
    contentItems: [{ type: "inputText", text: message }],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Math.round(ms))));
}

function normalizeToolCallArguments(params: DynamicToolCallParams) {
  const args = toRecord(params.arguments);
  return {
    prompt: toNullableText(args.prompt) ?? "",
    size: toNullableText(args.size),
    quality: toNullableText(args.quality),
    outputFormat: toNullableText(args.output_format),
    n: toIntegerInRange(args.n, 1, 1, 4),
  };
}

function isCodeNexusImageGenerationTool(params: DynamicToolCallParams): boolean {
  return (
    params.namespace === IMAGE_GENERATION_DYNAMIC_TOOL_NAMESPACE && params.tool === IMAGE_GENERATION_DYNAMIC_TOOL_NAME
  );
}

type ImageToolReferenceImageResolution = {
  inputImages: NonNullable<ImageGenerationGenerateArgs["inputImages"]>;
  requestedCount: number;
  skippedCount: number;
};

function findLatestUserImagePayload(
  timelineStore: ReturnType<typeof useTimelineStore>,
  threadId: string
): { images: string[]; localImages: string[] } {
  const events = timelineStore.eventsForThread(threadId);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.method !== "user") continue;
    const params = toRecord(event.params);
    return {
      images: toStringArray(params.images),
      localImages: toStringArray(params.local_images),
    };
  }
  return { images: [], localImages: [] };
}

async function resolveImageToolReferenceImages(
  timelineStore: ReturnType<typeof useTimelineStore>,
  params: DynamicToolCallParams
): Promise<ImageToolReferenceImageResolution> {
  const payload = findLatestUserImagePayload(timelineStore, params.threadId);
  const dataUrls = payload.images.slice(0, IMAGE_TOOL_MAX_REFERENCE_IMAGES);
  const remainingSlots = Math.max(0, IMAGE_TOOL_MAX_REFERENCE_IMAGES - dataUrls.length);
  const localPaths = payload.localImages.slice(0, remainingSlots);
  const requestedCount = dataUrls.length + localPaths.length;
  if (requestedCount === 0) return { inputImages: [], requestedCount: 0, skippedCount: 0 };

  const inputImages: NonNullable<ImageGenerationGenerateArgs["inputImages"]> = [];
  let skippedCount = 0;

  dataUrls.forEach((dataUrl, index) => {
    if (/^data:image\/[^;]+;base64,/i.test(dataUrl)) {
      inputImages.push({
        dataUrl,
        name: `reference-${index + 1}.${extensionFromDataUrl(dataUrl)}`,
      });
    } else {
      skippedCount += 1;
    }
  });

  for (let index = 0; index < localPaths.length; index += 1) {
    const path = localPaths[index];
    try {
      const res = await codexDesktop.app.readImageFileDataUrl({ path });
      const dataUrl = String(res?.dataUrl ?? "").trim();
      if (!/^data:image\/[^;]+;base64,/i.test(dataUrl)) {
        skippedCount += 1;
        continue;
      }
      inputImages.push({
        dataUrl,
        name: fileNameFromPathLike(path, `reference-${inputImages.length + 1}.${extensionFromDataUrl(dataUrl)}`),
      });
    } catch {
      skippedCount += 1;
    }
  }

  return { inputImages, requestedCount, skippedCount };
}

function formatImageToolRequestParamsText(args: ReturnType<typeof normalizeToolCallArguments>, referenceCount: number) {
  return [
    args.prompt ? `prompt=${args.prompt}` : "prompt=<empty>",
    referenceCount > 0 ? `referenceImages=${referenceCount}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function playPlanQnaNotificationSoundTwiceLazy() {
  const { playPlanQnaNotificationSoundTwice } = await import("../../features/notificationSound/player");
  await playPlanQnaNotificationSoundTwice();
}

async function syncImageWorkbenchTasksLazy(imageWorkbenchStore: ReturnType<typeof useImageWorkbenchStore>) {
  try {
    await imageWorkbenchStore.syncTasks();
  } catch {
    // 图片工作台只是订阅同一份任务状态；同步失败不应中断工具响应。
  }
}

async function waitForImageGenerationTask(taskId: string): Promise<ImageGenerationTaskItem> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < IMAGE_TOOL_TASK_WAIT_TIMEOUT_MS) {
    const taskRes = await codexDesktop.app.listImageGenerationTasks();
    const task = (Array.isArray(taskRes.tasks) ? taskRes.tasks : []).find((item) => item.id === taskId);
    if (!task) throw new Error(translate("runtime.imageTaskMissingOrDeleted"));
    if (task.status === "succeeded" || task.status === "failed" || task.status === "canceled") return task;
    await sleep(IMAGE_TOOL_TASK_POLL_INTERVAL_MS);
  }
  throw new Error(translate("runtime.imageTaskWaitTimeout"));
}

async function resolveImageGenerationHistoryItem(historyId: string): Promise<ImageGenerationHistoryItem> {
  const historyRes = await codexDesktop.app.listImageGenerationHistory();
  const item = (Array.isArray(historyRes.items) ? historyRes.items : []).find((entry) => entry.id === historyId);
  if (!item) throw new Error(translate("runtime.imageHistoryMissingAfterCompletion"));
  return item;
}

async function buildSuccessfulImageToolResponse(
  historyItem: ImageGenerationHistoryItem,
  referenceResolution?: ImageToolReferenceImageResolution
): Promise<DynamicToolCallResponse> {
  const imageContentItems = await Promise.all(
    historyItem.images.map(async (image) => {
      const res = await codexDesktop.app.readImageFileDataUrl({ path: image.path });
      return { type: "inputImage" as const, imageUrl: res.dataUrl };
    })
  );
  const savedPaths = historyItem.images.map((image) => image.path).filter(Boolean);
  const usedReferences = referenceResolution?.inputImages.length ?? 0;
  const skippedReferences = referenceResolution?.skippedCount ?? 0;
  const referenceText =
    usedReferences > 0
      ? ` Used ${usedReferences} reference image${usedReferences === 1 ? "" : "s"}.${
          skippedReferences > 0
            ? ` Skipped ${skippedReferences} unreadable reference image${skippedReferences === 1 ? "" : "s"}.`
            : ""
        }`
      : "";
  return {
    success: true,
    contentItems: [
      {
        type: "inputText",
        text: `Image generated and saved locally: ${savedPaths.join(", ")}${referenceText}`,
      },
      ...imageContentItems,
    ],
  };
}

export function installRequestResponder(pinia: Pinia, approvalLifecycle?: ApprovalLifecycleController) {
  const timelineStore = useTimelineStore(pinia);
  const userInputStore = useUserInputStore(pinia);
  const approvalStore = useApprovalStore(pinia);
  const imageWorkbenchStore = useImageWorkbenchStore(pinia);
  const runtimeStore = useRuntimeStore(pinia);

  const unsubscribe = codexDesktop.codexServer.onEvent((payload) => {
    const msg = payload?.msg;
    const serverId = String(payload.serverId ?? "").trim();
    if (isCodexServerNotificationMessage(msg) && msg.method === "serverRequest/resolved") {
      const requestId = msg.params?.requestId;
      if (serverId && (typeof requestId === "string" || typeof requestId === "number")) {
        approvalLifecycle?.clear(serverId, requestId, true);
      }
      return;
    }
    if (isCodexLocalEventMessage(msg) && msg.method === "codex/exit") {
      approvalLifecycle?.clearServer(serverId);
      return;
    }
    if (!isCodexServerRequestMessage(msg)) return;
    if (!isServerRequest(msg)) {
      console.warn("[requestResponder] ignore invalid server request shape", msg);
      return;
    }

    const handling = classifyServerRequest(msg.method);
    const threadId = getServerRequestThreadId(msg) || "__app__";
    const paramsText = toPrettyJson(msg.params ?? {});

    if (handling.kind === "approval") {
      const method = String(msg.method ?? "").trim();
      const prompt = buildApprovalPromptFromRequest(msg, serverId, paramsText);
      if (!serverId || !prompt) {
        timelineStore.appendEvent({
          threadId,
          method,
          paramsText: `${paramsText}\n[approval] invalid approval request`,
          params: msg.params,
          level: "error",
        });
        return;
      }

      approvalStore.enqueue(prompt);
      approvalLifecycle?.schedule({ serverId, requestId: msg.id, method: method as ApprovalMethod });
      timelineStore.appendEvent({
        threadId: prompt.threadId || threadId,
        method,
        paramsText: `${paramsText}\n[approval] queued`,
        params: msg.params,
        level: "warn",
      });
      return;
    }

    if (handling.kind === "toolCall") {
      const toolParams = normalizeImageToolCallParams(msg.params);
      if (!toolParams || !isCodeNexusImageGenerationTool(toolParams)) {
        void codexDesktop.codexServer.respond(
          respondRequestError(payload.serverId, msg.id, msg.method, buildRequestMethodNotImplementedError(msg.method))
        );
        timelineStore.appendEvent({
          threadId,
          method: msg.method,
          paramsText,
          params: msg.params,
          level: "error",
        });
        return;
      }

      void (async () => {
        const args = normalizeToolCallArguments(toolParams);
        upsertImageGenerationEvent(
          timelineStore,
          toolParams,
          "item/started",
          "running",
          args.prompt ? `prompt=${args.prompt}` : "prompt=<empty>",
          { pendingImageCount: args.n }
        );

        try {
          if (!args.prompt) throw new Error(translate("runtime.imagePromptRequired"));
          const referenceResolution = await resolveImageToolReferenceImages(timelineStore, toolParams);
          if (referenceResolution.requestedCount > 0 && referenceResolution.inputImages.length === 0) {
            throw new Error(translate("runtime.referenceImagesUnreadable"));
          }
          const submitResult = await codexDesktop.app.submitImageGenerationTask({
            threadId: toolParams.threadId,
            turnId: toolParams.turnId,
            callId: toolParams.callId,
            workspacePath: String(runtimeStore.workspacePath ?? "").trim() || null,
            prompt: args.prompt,
            inputImages: referenceResolution.inputImages.length > 0 ? referenceResolution.inputImages : null,
            size: args.size,
            quality: args.quality,
            outputFormat: args.outputFormat,
            n: args.n,
          });
          const submittedTaskId = String(submitResult.task?.id ?? "").trim();
          if (!submittedTaskId) throw new Error(translate("runtime.imageTaskSubmitFailed"));
          imageWorkbenchStore.generationTasks = Array.isArray(submitResult.tasks) ? submitResult.tasks : [];
          imageWorkbenchStore.mergeHistoryAndTasks(
            filterPersistedImageWorkbenchHistoryItems(imageWorkbenchStore.historyItems),
            imageWorkbenchStore.generationTasks
          );
          void syncImageWorkbenchTasksLazy(imageWorkbenchStore);

          upsertImageGenerationEvent(
            timelineStore,
            toolParams,
            "item/started",
            "running",
            [
              formatImageToolRequestParamsText(args, referenceResolution.inputImages.length),
              referenceResolution.skippedCount > 0 ? `skippedReferenceImages=${referenceResolution.skippedCount}` : "",
              `taskId=${submittedTaskId}`,
            ]
              .filter(Boolean)
              .join("\n"),
            { pendingImageCount: args.n }
          );

          const completedTask = await waitForImageGenerationTask(submittedTaskId);
          await syncImageWorkbenchTasksLazy(imageWorkbenchStore);
          if (completedTask.status !== "succeeded") {
            throw new Error(
              completedTask.errorText ||
                (completedTask.status === "canceled"
                  ? translate("runtime.imageTaskCanceled")
                  : translate("runtime.imageTaskFailed"))
            );
          }
          const historyId = String(completedTask.historyId ?? "").trim();
          if (!historyId) throw new Error(translate("runtime.imageTaskMissingHistoryId"));
          const historyItem = await resolveImageGenerationHistoryItem(historyId);
          const savedPaths = historyItem.images.map((image) => image.path).filter(Boolean);
          const revisedPrompt = historyItem.revisedPrompt ?? null;
          upsertImageGenerationEvent(
            timelineStore,
            toolParams,
            "item/completed",
            "completed",
            [
              `status=completed`,
              `taskId=${submittedTaskId}`,
              `historyId=${historyId}`,
              referenceResolution.inputImages.length > 0
                ? `referenceImages=${referenceResolution.inputImages.length}`
                : "",
              referenceResolution.skippedCount > 0 ? `skippedReferenceImages=${referenceResolution.skippedCount}` : "",
              ...savedPaths.map((path, index) => `savedPath[${index + 1}]=${path}`),
            ]
              .filter(Boolean)
              .join("\n"),
            { savedPaths, revisedPrompt }
          );
          await codexDesktop.codexServer.respond({
            serverId: payload.serverId,
            id: msg.id,
            method: msg.method,
            result: await buildSuccessfulImageToolResponse(historyItem, referenceResolution),
          });
        } catch (error: any) {
          await syncImageWorkbenchTasksLazy(imageWorkbenchStore);
          const message = String(error?.message ?? error ?? translate("runtime.imageGenerationFailed"));
          upsertImageGenerationEvent(timelineStore, toolParams, "item/completed", `failed: ${message}`, message, {
            errorText: message,
            level: "error",
          });
          await codexDesktop.codexServer.respond({
            serverId: payload.serverId,
            id: msg.id,
            method: msg.method,
            result: buildFailedToolResponse(message),
          });
        }
      })();
      return;
    }

    if (handling.kind === "currentTime") {
      void codexDesktop.codexServer.respond({
        serverId: payload.serverId,
        id: msg.id,
        method: msg.method,
        result: { currentTimeAt: Math.floor(Date.now() / 1000) },
      });
      return;
    }

    if (handling.kind === "authRefresh") {
      void codexDesktop.codexServer.respond(
        respondRequestError(payload.serverId, msg.id, msg.method, buildAuthRefreshNotImplementedError(msg.method))
      );
      timelineStore.appendEvent({
        threadId,
        method: msg.method,
        paramsText,
        params: msg.params,
        level: "error",
      });
      return;
    }

    if (handling.kind === "userInput") {
      const prompt = normalizeUserInputPrompt(msg, payload.serverId);
      if (!prompt) {
        void codexDesktop.codexServer.respond(
          respondRequestError(payload.serverId, msg.id, msg.method, buildInvalidUserInputPayloadError(msg.method))
        );
        timelineStore.appendEvent({
          threadId,
          method: msg.method,
          paramsText,
          params: msg.params,
          level: "error",
        });
        return;
      }
      const resolvedThreadId = String(prompt.threadId || threadId).trim();
      if (!resolvedThreadId) return;
      const hadPendingUserInput = userInputStore.queueSizeForThread(resolvedThreadId) > 0;
      userInputStore.enqueuePrompt(
        resolvedThreadId === String(prompt.threadId ?? "").trim() ? prompt : { ...prompt, threadId: resolvedThreadId },
        { threadIdFallback: resolvedThreadId }
      );
      if (!hadPendingUserInput && userInputStore.queueSizeForThread(resolvedThreadId) > 0) {
        void playPlanQnaNotificationSoundTwiceLazy();
      }
      timelineStore.appendEvent({
        threadId: resolvedThreadId,
        method: msg.method,
        paramsText,
        params: msg.params,
      });
      return;
    }

    void codexDesktop.codexServer.respond(
      respondRequestError(payload.serverId, msg.id, msg.method, buildRequestMethodNotImplementedError(msg.method))
    );
    timelineStore.appendEvent({
      threadId,
      method: msg.method,
      paramsText,
      params: msg.params,
      level: "error",
    });
  });
  return () => {
    unsubscribe();
  };
}
