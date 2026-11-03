import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_USER_LOCAL_SETTINGS,
  mergeUserLocalSettings,
  normalizeUserLocalSettings,
  type UserLocalSettings,
  type UserLocalSettingsPatch,
} from "../../common/localSettings";
import { SecureStorageService } from "./SecureStorageService";
import { logger } from "../utils/logger";

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class LocalSettingsService {
  private writeQueue: Promise<UserLocalSettings> = Promise.resolve(
    normalizeUserLocalSettings(DEFAULT_USER_LOCAL_SETTINGS)
  );
  private readonly secureStorage = new SecureStorageService();

  constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath;
  }

  private decryptApiKeys(settings: UserLocalSettings): UserLocalSettings {
    return {
      ...settings,
      imageGeneration: {
        ...settings.imageGeneration,
        apiKey: this.secureStorage.decrypt(settings.imageGeneration.apiKey),
      },
    };
  }

  private encryptApiKeys(settings: UserLocalSettings): UserLocalSettings {
    return {
      ...settings,
      imageGeneration: {
        ...settings.imageGeneration,
        apiKey: this.secureStorage.encrypt(settings.imageGeneration.apiKey),
      },
    };
  }

  private async readFromDisk(): Promise<{ exists: boolean; settings: UserLocalSettings }> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const settings = normalizeUserLocalSettings(tryParseJson(raw));
      const decrypted = this.decryptApiKeys(settings);
      return { exists: true, settings: decrypted };
    } catch (error) {
      logger.info("settings", `settings file not available, using defaults (${this.filePath})`);
      return { exists: false, settings: normalizeUserLocalSettings(DEFAULT_USER_LOCAL_SETTINGS) };
    }
  }

  async read(): Promise<{ exists: boolean; settings: UserLocalSettings }> {
    await this.writeQueue.catch(() => undefined);
    return this.readFromDisk();
  }

  async patch(patch: UserLocalSettingsPatch | null | undefined): Promise<UserLocalSettings> {
    const task = this.writeQueue
      .catch(() => normalizeUserLocalSettings(DEFAULT_USER_LOCAL_SETTINGS))
      .then(async () => {
        const current = await this.readFromDisk();
        const next = mergeUserLocalSettings(current.settings, patch ?? {});
        const toWrite = this.encryptApiKeys(next);
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, `${JSON.stringify(toWrite, null, 2)}\n`, "utf8");
        return next;
      });
    this.writeQueue = task;
    return task;
  }
}
