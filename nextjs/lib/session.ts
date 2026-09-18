/**
 * The admin session token, with no framework imports.
 *
 * Shared by the middleware — which guards every admin request before it reaches
 * a page — and by the server helpers in auth.ts. It uses Web Crypto rather than
 * node:crypto so the same code runs wherever the middleware does.
 *
 * The token carries the moment it was issued and is signed over that moment and
 * the password. So it expires on the server, not just in the browser: the old
 * token was a fixed signature of the password alone, which meant a copied cookie
 * stayed valid indefinitely whatever its max-age said. Changing the password
 * still signs everybody out, because the password is inside the signature.
 */

export const COOKIE_NAME = "pwc_admin";
export const MAX_AGE_SECONDS = 60 * 60 * 12;

const VERSION = "pwc-admin-v2";
// Tolerate a server clock that runs slightly behind the one that issued the token.
const CLOCK_SKEW_SECONDS = 60;
const encoder = new TextEncoder();

function credentials(): { password: string; secret: string } {
  const password = process.env.ADMIN_PASSWORD ?? "";
  return { password, secret: process.env.ADMIN_SECRET || password };
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares in time that does not depend on where the strings first differ. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function issueToken(now: number = Date.now()): Promise<string> {
  const { password, secret } = credentials();
  const issued = Math.floor(now / 1000);
  return `${issued}.${await sign(secret, `${VERSION}:${issued}:${password}`)}`;
}

export async function verifyToken(token: string | undefined, now: number = Date.now()): Promise<boolean> {
  const { password, secret } = credentials();
  // No password configured means no one can sign in, not that everyone can.
  if (!password || !token) return false;

  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const issued = Number(token.slice(0, dot));
  if (!Number.isInteger(issued)) return false;

  const age = Math.floor(now / 1000) - issued;
  if (age < -CLOCK_SKEW_SECONDS || age > MAX_AGE_SECONDS) return false;

  const expected = await sign(secret, `${VERSION}:${issued}:${password}`);
  return sameString(token.slice(dot + 1), expected);
}
