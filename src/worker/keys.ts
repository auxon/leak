import { fromBase64, toBase64 } from "./crypto";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function wrappingKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function wrapSecret(plain: string, secret: string): Promise<string> {
  const key = await wrappingKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  return JSON.stringify({ iv: toBase64(iv), data: toBase64(new Uint8Array(ct)) });
}

export async function unwrapSecret(wrapped: string, secret: string): Promise<string> {
  const parsed = JSON.parse(wrapped) as { iv: string; data: string };
  const key = await wrappingKey(secret);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(parsed.iv) as BufferSource },
    key,
    fromBase64(parsed.data) as BufferSource,
  );
  return dec.decode(pt);
}
