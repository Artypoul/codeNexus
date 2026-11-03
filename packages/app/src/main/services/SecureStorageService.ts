import { safeStorage } from "electron";
import { logger } from "../utils/logger";

const ENCRYPTED_PREFIX = "enc:";

/**
 * Wraps Electron's safeStorage (DPAPI on Windows) to encrypt/decrypt
 * sensitive strings before persisting them to disk.
 *
 * Encrypted values are stored as "enc:<base64>".
 */
export class SecureStorageService {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  encrypt(plaintext: string | null): string | null {
    if (plaintext == null || plaintext === "") return plaintext;
    if (!this.isAvailable()) {
      logger.error("secure-storage", "encryption unavailable, refusing to store plaintext");
      return null;
    }
    const encrypted = safeStorage.encryptString(plaintext);
    return `${ENCRYPTED_PREFIX}${encrypted.toString("base64")}`;
  }

  decrypt(stored: string | null): string | null {
    if (stored == null || stored === "") return stored;
    if (!stored.startsWith(ENCRYPTED_PREFIX)) {
      logger.warn("secure-storage", "refusing non-encrypted stored value");
      return null;
    }
    if (!this.isAvailable()) {
      logger.warn("secure-storage", "decryption unavailable, cannot read encrypted value");
      return null;
    }
    const base64 = stored.slice(ENCRYPTED_PREFIX.length);
    const buffer = Buffer.from(base64, "base64");
    return safeStorage.decryptString(buffer);
  }
}
