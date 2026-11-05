import { describe, expect, it } from "vitest";
import { decryptCredentials, encryptCredentials } from "../src/vault.js";

describe("vault", () => {
  it("round-trips credentials", () => {
    const creds = { apiKey: "key-abc", apiSecret: "secret-xyz" };
    const enc = encryptCredentials(creds);
    expect(enc.ciphertext).toBeTruthy();
    expect(decryptCredentials(enc)).toEqual(creds);
  });
});
