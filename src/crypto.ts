import { jwtVerify, SignJWT } from "jose";

const encoder = new TextEncoder();
const ISSUER = "sitegate";
const AUDIENCE = "sitegate";

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function derive(key: CryptoKey, purpose: string, password: string): Promise<ArrayBuffer> {
  return crypto.subtle.sign("HMAC", key, encoder.encode(`sitegate:${purpose}:${password}`));
}

export interface CryptoService {
  verifyPassword(candidate: string): Promise<boolean>;
  createSession(nowMs: number, durationSeconds: number): Promise<string>;
  verifySession(token: string, nowMs: number): Promise<boolean>;
  createCsrf(nonce: string, nowMs: number): Promise<string>;
  verifyCsrf(token: string, nonce: string, nowMs: number): Promise<boolean>;
}

export function createCryptoService(secret: string, password: string): CryptoService {
  const baseKey = importHmacKey(secret);
  const passwordTag = baseKey.then((key) => derive(key, "password", password));
  const sessionKey = baseKey
    .then((key) => derive(key, "session", password))
    .then((bytes) => new Uint8Array(bytes));

  return {
    async verifyPassword(candidate) {
      const key = await baseKey;
      return crypto.subtle.verify(
        "HMAC",
        key,
        await passwordTag,
        encoder.encode(`sitegate:password:${candidate}`),
      );
    },

    async createSession(nowMs, durationSeconds) {
      const now = Math.floor(nowMs / 1000);
      return new SignJWT({ type: "session" })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + durationSeconds)
        .setJti(crypto.randomUUID())
        .sign(await sessionKey);
    },

    async verifySession(token, nowMs) {
      try {
        const { payload, protectedHeader } = await jwtVerify(token, await sessionKey, {
          algorithms: ["HS256"],
          audience: AUDIENCE,
          issuer: ISSUER,
          currentDate: new Date(nowMs),
          clockTolerance: 5,
          requiredClaims: ["iat", "exp", "jti"],
        });
        return protectedHeader.typ === "JWT" && payload["type"] === "session";
      } catch {
        return false;
      }
    },

    async createCsrf(nonce, nowMs) {
      const now = Math.floor(nowMs / 1000);
      return new SignJWT({ type: "csrf", nonce })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + 10 * 60)
        .setJti(crypto.randomUUID())
        .sign(await sessionKey);
    },

    async verifyCsrf(token, nonce, nowMs) {
      try {
        const { payload, protectedHeader } = await jwtVerify(token, await sessionKey, {
          algorithms: ["HS256"],
          audience: AUDIENCE,
          issuer: ISSUER,
          currentDate: new Date(nowMs),
          clockTolerance: 5,
          requiredClaims: ["iat", "exp", "jti"],
        });
        return (
          protectedHeader.typ === "JWT" && payload["type"] === "csrf" && payload["nonce"] === nonce
        );
      } catch {
        return false;
      }
    },
  };
}
