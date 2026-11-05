import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { BrokerCredentials } from "./types.js";

const ALGO = "aes-256-gcm";

function masterKey(): Buffer {
  const raw = process.env.ORDIUM_VAULT_KEY?.trim();
  if (!raw) {
    // Dev fallback — déterministe mais documenté. En prod, définir ORDIUM_VAULT_KEY.
    return createHash("sha256").update("ordium-dev-vault-key-change-me").digest();
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

export function encryptCredentials(creds: BrokerCredentials): {
  ciphertext: string;
  iv: string;
  tag: string;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const plain = Buffer.from(JSON.stringify(creds), "utf8");
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptCredentials(blob: {
  ciphertext: string;
  iv: string;
  tag: string;
}): BrokerCredentials {
  const decipher = createDecipheriv(ALGO, masterKey(), Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final(),
  ]);
  const parsed = JSON.parse(dec.toString("utf8")) as BrokerCredentials;
  if (!parsed.apiKey || !parsed.apiSecret) {
    throw new Error("Credentials vault invalides");
  }
  return parsed;
}

export function vaultKeyConfigured(): boolean {
  return Boolean(process.env.ORDIUM_VAULT_KEY?.trim());
}
