import type {
  CodexDesktopApi as SharedCodexDesktopApi,
  CodexDesktopAppApi as SharedCodexDesktopAppApi,
} from "@codenexus/shared/ipc/contracts";
import type {
  ImageGenerationGenerateArgs,
  ImageGenerationGenerateResult,
  ImageGenerationHistoryDeleteResult,
  ImageGenerationHistoryListResult,
  ImageGenerationTaskCancelResult,
  ImageGenerationTaskDeleteResult,
  ImageGenerationTaskListResult,
  ImageGenerationTaskRetryResult,
  ImageGenerationTaskSubmitResult,
} from "@codenexus/feature-imagegen/types";

export * from "@codenexus/shared/ipc/contracts";

export type FeatureImageGenerationAppApi = {
  generateImage(args: ImageGenerationGenerateArgs): Promise<ImageGenerationGenerateResult>;
  listImageGenerationHistory(): Promise<ImageGenerationHistoryListResult>;
  deleteImageGenerationHistory(args: { id: string }): Promise<ImageGenerationHistoryDeleteResult>;
  listImageGenerationTasks(): Promise<ImageGenerationTaskListResult>;
  submitImageGenerationTask(args: ImageGenerationGenerateArgs): Promise<ImageGenerationTaskSubmitResult>;
  cancelImageGenerationTask(args: { id: string }): Promise<ImageGenerationTaskCancelResult>;
  deleteImageGenerationTask(args: { id: string }): Promise<ImageGenerationTaskDeleteResult>;
  retryImageGenerationTask(args: { id: string }): Promise<ImageGenerationTaskRetryResult>;
};

export type CodexDesktopAppApi = SharedCodexDesktopAppApi & FeatureImageGenerationAppApi;

export type CodexDesktopApi = Omit<SharedCodexDesktopApi, "app"> & {
  app: CodexDesktopAppApi;
};
