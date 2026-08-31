const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = pad + "=".repeat((4 - (pad.length % 4)) % 4);
  return atob(padded);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return toHex(sig);
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(data));
  return toHex(digest);
}

export function randomToken(bytes = 24): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function signSession(email: string, exp: number, secret: string): Promise<string> {
  const payload = toBase64Url(enc.encode(JSON.stringify({ email, exp })));
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySession(token: string, secret: string): Promise<string | null> {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacHex(secret, payload);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as { email?: string; exp?: number };
    if (!parsed.email || !parsed.exp || parsed.exp * 1000 < Date.now()) return null;
    return parsed.email.toLowerCase();
  } catch {
    return null;
  }
}

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function cookieHeader(
  name: string,
  value: string,
  opts: { maxAge: number; secure: boolean; path: string },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path}`,
    `Max-Age=${opts.maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  if (!header || !secret) return false;
  const v1s: string[] = [];
  let timestamp = "";
  for (const item of header.split(",")) {
    const [k, ...rest] = item.trim().split("=");
    const v = rest.join("=");
    if (k === "t") timestamp = v;
    if (k === "v1") v1s.push(v);
  }
  if (!timestamp || !v1s.length) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (Number.isNaN(Number(timestamp)) || age > 300) return false;
  const expected = await hmacHex(secret, `${timestamp}.${payload}`);
  return v1s.some((sig) => timingSafeEqual(sig.toLowerCase(), expected.toLowerCase()));
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
