import { app, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IPC_APP_CHANNELS } from "@codenexus/shared/ipc/channels";
import {
  DEFAULT_IMAGE_GENERATION_MAX_IMAGES,
  DEFAULT_IMAGE_GENERATION_MODEL,
  DEFAULT_IMAGE_GENERATION_OUTPUT_COMPRESSION,
  DEFAULT_IMAGE_GENERATION_OUTPUT_FORMAT,
  DEFAULT_IMAGE_GENERATION_BACKGROUND,
  DEFAULT_IMAGE_GENERATION_MODERATION,
  DEFAULT_IMAGE_GENERATION_TIMEOUT_MS,
  MAX_IMAGE_GENERATION_MAX_IMAGES,
  MAX_IMAGE_GENERATION_OUTPUT_COMPRESSION,
  MAX_IMAGE_GENERATION_TIMEOUT_MS,
  MIN_IMAGE_GENERATION_MAX_IMAGES,
  MIN_IMAGE_GENERATION_OUTPUT_COMPRESSION,
  MIN_IMAGE_GENERATION_TIMEOUT_MS,
} from "@codenexus/feature-imagegen/settings";
import type { ImageGenerationGeneratedImage, ImageGenerationGenerateArgs } from "@codenexus/feature-imagegen/types";
import type { ImageGenerationHistoryService } from "@codenexus/feature-imagegen/main/ImageGenerationHistoryService";
import type { ImageGenerationTaskService } from "@codenexus/feature-imagegen/main/ImageGenerationTaskService";
import type { LocalSettingsService } from "../../services/LocalSettingsService";
import {
  fetchWithTimeout,
  normalizeHttpUrl,
  readErrorBody,
  toIntegerInRange,
  toNullableText,
} from "./app-handler-utils";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const IMAGE_EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
};

function imageMimeFromExt(extValue: unknown): string {
  const ext = String(extValue ?? "")
    .trim()
    .toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] || "image/png";
}

function imageExtFromMime(mimeValue: unknown, fallbackFormat: unknown): string {
  const mime = String(mimeValue ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (IMAGE_EXT_BY_MIME[mime]) return IMAGE_EXT_BY_MIME[mime];
  const format = String(fallbackFormat ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
  if (format === "jpg" || format === "jpeg") return ".jpg";
  if (format === "webp") return ".webp";
  return ".png";
}

function normalizeImageOutputFormat(value: unknown, fallback: string): string | null {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
  if (text === "auto") return null;
  if (text === "jpg") return "jpeg";
  if (text === "jpeg" || text === "png" || text === "webp") return text;
  const fallbackText = String(fallback || DEFAULT_IMAGE_GENERATION_OUTPUT_FORMAT)
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
  if (fallbackText === "auto") return null;
  if (fallbackText === "jpg") return "jpeg";
  if (fallbackText === "jpeg" || fallbackText === "png" || fallbackText === "webp") return fallbackText;
  return DEFAULT_IMAGE_GENERATION_OUTPUT_FORMAT;
}

function normalizeImageBackground(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (text === "transparent" || text === "opaque" || text === "auto") return text;
  return String(fallback || DEFAULT_IMAGE_GENERATION_BACKGROUND).trim() || DEFAULT_IMAGE_GENERATION_BACKGROUND;
}

function normalizeImageModeration(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (text === "low" || text === "auto") return text;
  return String(fallback || DEFAULT_IMAGE_GENERATION_MODERATION).trim() || DEFAULT_IMAGE_GENERATION_MODERATION;
}

function normalizeImageOutputCompression(value: unknown, fallback: number): number {
  return toIntegerInRange(
    value,
    fallback,
    MIN_IMAGE_GENERATION_OUTPUT_COMPRESSION,
    MAX_IMAGE_GENERATION_OUTPUT_COMPRESSION
  );
}

function normalizeImageEndpoint(baseUrlValue: unknown, kind: "generations" | "edits"): string {
  const baseUrl = normalizeHttpUrl(baseUrlValue);
  if (!baseUrl) throw new Error("Image generation service URL is invalid. Enter an http(s) URL.");
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/images\/(generations|edits)$/i.test(path)) {
    return baseUrl.replace(/\/images\/(generations|edits)$/i, `/images/${kind}`);
  }
  if (/\/v1$/i.test(path)) return `${baseUrl}/images/${kind}`;
  return `${baseUrl}/v1/images/${kind}`;
}

function sanitizePathSegment(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || fallback;
}

function parseImageDataUrl(value: string): { mimeType: string; buffer: Buffer } | null {
  const match = String(value ?? "").match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) return null;
  const mimeType =
    String(match[1] ?? "image/png")
      .trim()
      .toLowerCase() || "image/png";
  const body = String(match[2] ?? "").trim();
  if (!body) return null;
  return { mimeType, buffer: Buffer.from(body, "base64") };
}

function dataUrlToBlob(value: string): { blob: Blob; mimeType: string } | null {
  const parsed = parseImageDataUrl(value);
  if (!parsed) return null;
  return {
    blob: new Blob([new Uint8Array(parsed.buffer)], { type: parsed.mimeType }),
    mimeType: parsed.mimeType,
  };
}

function imageBufferToDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType || "image/png"};base64,${buffer.toString("base64")}`;
}

function extractGeneratedImages(value: unknown): Array<{
  buffer?: Buffer;
  url?: string;
  mimeType?: string;
  revisedPrompt: string | null;
}> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const items = data.length > 0 ? data : Array.isArray(record.images) ? record.images : [];
  const out: Array<{ buffer?: Buffer; url?: string; mimeType?: string; revisedPrompt: string | null }> = [];
  for (const itemValue of items) {
    const item =
      itemValue && typeof itemValue === "object" && !Array.isArray(itemValue) ? (itemValue as Record<string, any>) : {};
    const revisedPrompt = toNullableText(item.revised_prompt);
    const rawBase64 = toNullableText(item.b64_json ?? item.base64 ?? item.image_base64);
    if (rawBase64) {
      if (/^https?:\/\//i.test(rawBase64)) {
        out.push({ url: rawBase64, mimeType: toNullableText(item.mime_type) ?? undefined, revisedPrompt });
        continue;
      }
      const parsedDataUrl = parseImageDataUrl(rawBase64);
      if (parsedDataUrl) {
        out.push({ buffer: parsedDataUrl.buffer, mimeType: parsedDataUrl.mimeType, revisedPrompt });
      } else {
        out.push({
          buffer: Buffer.from(rawBase64, "base64"),
          mimeType: toNullableText(item.mime_type) ?? undefined,
          revisedPrompt,
        });
      }
      continue;
    }
    const url = toNullableText(item.url ?? item.image_url ?? item.output_url ?? item.image);
    if (url) out.push({ url, mimeType: toNullableText(item.mime_type) ?? undefined, revisedPrompt });
  }
  return out;
}

export async function generateImagesWithSettings(
  localSettingsService: LocalSettingsService,
  imageGenerationHistoryService: ImageGenerationHistoryService,
  args: ImageGenerationGenerateArgs,
  signal?: AbortSignal
) {
  const prompt = toNullableText(args?.prompt);
  if (!prompt) throw new Error("Image generation prompt is required.");

  const { settings } = await localSettingsService.read();
  const imageSettings = settings.imageGeneration;
  if (!imageSettings.enabled) throw new Error("Image generation is not enabled. Enable it in settings first.");
  if (!imageSettings.baseUrl) throw new Error("Image generation service URL is not configured.");
  if (!imageSettings.apiKey) throw new Error("Image generation API Key is not configured.");

  const timeoutMs = toIntegerInRange(
    imageSettings.timeoutMs,
    DEFAULT_IMAGE_GENERATION_TIMEOUT_MS,
    MIN_IMAGE_GENERATION_TIMEOUT_MS,
    MAX_IMAGE_GENERATION_TIMEOUT_MS
  );
  const inputImages = Array.isArray(args?.inputImages)
    ? args.inputImages
        .map((item) => ({
          dataUrl: toNullableText(item?.dataUrl),
          name: toNullableText(item?.name),
        }))
        .filter((item): item is { dataUrl: string; name: string | null } => Boolean(item.dataUrl))
    : [];
  const mode = inputImages.length > 0 ? "edit" : "generate";
  const endpoint = normalizeImageEndpoint(imageSettings.baseUrl, mode === "edit" ? "edits" : "generations");
  const outputFormat = normalizeImageOutputFormat(args?.outputFormat, imageSettings.outputFormat);
  const n = Math.min(
    toIntegerInRange(
      args?.n,
      DEFAULT_IMAGE_GENERATION_MAX_IMAGES,
      MIN_IMAGE_GENERATION_MAX_IMAGES,
      MAX_IMAGE_GENERATION_MAX_IMAGES
    ),
    toIntegerInRange(
      imageSettings.maxImages,
      DEFAULT_IMAGE_GENERATION_MAX_IMAGES,
      MIN_IMAGE_GENERATION_MAX_IMAGES,
      MAX_IMAGE_GENERATION_MAX_IMAGES
    )
  );
  const size = toNullableText(args?.size) ?? imageSettings.defaultSize;
  const quality = toNullableText(args?.quality) ?? imageSettings.defaultQuality;
  const model = toNullableText(imageSettings.model) || DEFAULT_IMAGE_GENERATION_MODEL;
  const background = normalizeImageBackground(args?.background, imageSettings.defaultBackground);
  const moderation = normalizeImageModeration(args?.moderation, imageSettings.defaultModeration);
  const outputCompression = normalizeImageOutputCompression(
    args?.outputCompression,
    toIntegerInRange(
      imageSettings.outputCompression,
      DEFAULT_IMAGE_GENERATION_OUTPUT_COMPRESSION,
      MIN_IMAGE_GENERATION_OUTPUT_COMPRESSION,
      MAX_IMAGE_GENERATION_OUTPUT_COMPRESSION
    )
  );
  const requestBody =
    mode === "edit"
      ? (() => {
          const form = new FormData();
          form.append("model", model);
          form.append("prompt", prompt);
          form.append("n", String(n));
          form.append("size", size);
          form.append("quality", quality);
          if (outputFormat) form.append("output_format", outputFormat);
          if (background) form.append("background", background);
          if ((outputFormat === "jpeg" || outputFormat === "webp") && Number.isFinite(outputCompression)) {
            form.append("output_compression", String(outputCompression));
          }
          for (let index = 0; index < inputImages.length; index += 1) {
            const image = inputImages[index];
            const parsed = dataUrlToBlob(image.dataUrl);
            if (!parsed) throw new Error(`Invalid image input: image ${index + 1} is not a valid data URL.`);
            const name = image.name || `image-${index + 1}${imageExtFromMime(parsed.mimeType, outputFormat)}`;
            form.append("image[]", parsed.blob, name);
          }
          const maskDataUrl = toNullableText(args?.maskDataUrl);
          if (maskDataUrl) {
            const parsedMask = dataUrlToBlob(maskDataUrl);
            if (!parsedMask) throw new Error("Invalid image mask: not a valid data URL.");
            form.append("mask", parsedMask.blob, `mask${imageExtFromMime(parsedMask.mimeType, outputFormat)}`);
          }
          return form;
        })()
      : JSON.stringify({
          model,
          prompt,
          n,
          size,
          quality,
          background,
          moderation,
          ...(outputFormat ? { output_format: outputFormat } : {}),
          output_compression: outputFormat === "jpeg" || outputFormat === "webp" ? outputCompression : undefined,
        });

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers:
        mode === "edit"
          ? {
              Authorization: `Bearer ${imageSettings.apiKey}`,
            }
          : {
              Authorization: `Bearer ${imageSettings.apiKey}`,
              "Content-Type": "application/json",
            },
      body: requestBody,
    },
    timeoutMs,
    signal
  );

  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new Error(
      `Image ${mode === "edit" ? "edit" : "generation"} failed: HTTP ${response.status}${body ? ` ${body}` : ""}`
    );
  }

  const json = (await response.json()) as unknown;
  const images = extractGeneratedImages(json);
  if (images.length === 0)
    throw new Error(`Image ${mode === "edit" ? "edit" : "generation"} response contained no usable images.`);

  const threadSegment = sanitizePathSegment(args?.threadId, "app");
  const callSegment = sanitizePathSegment(args?.callId, randomUUID());
  const dir = join(app.getPath("userData"), "generated-images", threadSegment);
  await mkdir(dir, { recursive: true });

  const savedImages: ImageGenerationGeneratedImage[] = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    let buffer = image.buffer;
    let mimeType = image.mimeType || "";
    if (!buffer && image.url) {
      const imageUrl = normalizeHttpUrl(image.url);
      if (!imageUrl) throw new Error(`Invalid image download URL: ${image.url}`);
      const imageResponse = await fetchWithTimeout(imageUrl, { method: "GET" }, timeoutMs, signal);
      if (!imageResponse.ok) {
        const body = await readErrorBody(imageResponse);
        throw new Error(`Image download failed: HTTP ${imageResponse.status}${body ? ` ${body}` : ""}`);
      }
      const contentType = imageResponse.headers.get("content-type") || "";
      mimeType = mimeType || contentType.split(";")[0].trim();
      buffer = Buffer.from(await imageResponse.arrayBuffer());
    }
    if (!buffer) continue;
    const ext = imageExtFromMime(mimeType, outputFormat);
    mimeType = mimeType || imageMimeFromExt(ext);
    const fileName = `${Date.now()}-${callSegment}-${index + 1}${ext}`;
    const filePath = join(dir, fileName);
    await writeFile(filePath, buffer);
    savedImages.push({
      path: filePath,
      dataUrl: imageBufferToDataUrl(buffer, mimeType),
      mimeType,
      revisedPrompt: image.revisedPrompt,
    });
  }

  if (savedImages.length === 0)
    throw new Error(`Image ${mode === "edit" ? "edit" : "generation"} result could not be saved.`);
  const historyItem = await imageGenerationHistoryService.create({
    workspacePath: toNullableText(args?.workspacePath),
    model,
    prompt,
    revisedPrompt: savedImages.find((image) => image.revisedPrompt)?.revisedPrompt ?? null,
    mode,
    size,
    quality,
    outputFormat,
    background,
    moderation,
    outputCompression,
    images: savedImages.map((image) => ({
      path: image.path,
      mimeType: image.mimeType,
      revisedPrompt: image.revisedPrompt,
    })),
  });
  return {
    ok: true as const,
    historyId: historyItem.id,
    createdAt: historyItem.createdAt,
    model,
    prompt,
    revisedPrompt: historyItem.revisedPrompt,
    images: savedImages,
  };
}

export function registerImageGenerationHandlers(deps: {
  localSettingsService: LocalSettingsService;
  imageGenerationHistoryService: ImageGenerationHistoryService;
  imageGenerationTaskService: ImageGenerationTaskService;
}) {
  const { localSettingsService, imageGenerationHistoryService, imageGenerationTaskService } = deps;

  ipcMain.handle(IPC_APP_CHANNELS.appImageGenerationGenerate, async (_evt, args: ImageGenerationGenerateArgs) => {
    return generateImagesWithSettings(localSettingsService, imageGenerationHistoryService, args);
  });

  ipcMain.handle(IPC_APP_CHANNELS.appImageGenerationHistoryList, async () => {
    return { items: await imageGenerationHistoryService.list() };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appImageGenerationHistoryDelete, async (_evt, args: { id: string }) => {
    const result = await imageGenerationHistoryService.delete(args?.id);
    return { ok: true as const, ...result };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appImageGenerationTaskList, async () => {
    return { tasks: await imageGenerationTaskService.list() };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appImageGenerationTaskSubmit, async (_evt, args: ImageGenerationGenerateArgs) => {
    const result = await imageGenerationTaskService.submit(args);
    return { ok: true as const, ...result };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appImageGenerationTaskCancel, async (_evt, args: { id: string }) => {
    const result = await imageGenerationTaskService.cancel(args?.id);
    return { ok: true as const, ...result };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appImageGenerationTaskDelete, async (_evt, args: { id: string }) => {
    const result = await imageGenerationTaskService.delete(args?.id);
    return { ok: true as const, ...result };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appImageGenerationTaskRetry, async (_evt, args: { id: string }) => {
    const result = await imageGenerationTaskService.retry(args?.id);
    return { ok: true as const, ...result };
  });
}
