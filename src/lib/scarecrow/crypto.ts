import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export function randId(bytes = 18): string {
  return randomBytes(bytes).toString("base64url");
}

export function timingSafeString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function hashPin(pin: string, sessionId: string): string {
  const pepper = process.env.AUTH_SECRET || "scarecrow-pin-pepper";
  return createHmac("sha256", pepper).update(`${sessionId}:${pin}`).digest("hex");
}

export function hashToken(token: string): string {
  const pepper = process.env.AUTH_SECRET || "scarecrow-token-pepper";
  return createHmac("sha256", pepper).update(token).digest("hex");
}

export function digestPassword(password: string): Buffer {
  const salt = process.env.AUTH_SECRET || "scarecrow-password-salt";
  return scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
}

export function passwordsMatch(input: string, expected: string): boolean {
  const a = digestPassword(input);
  const b = digestPassword(expected);
  return timingSafeEqual(a, b);
}

export function normalizePhone(value: string): string {
  return value.toString().replace(/[\s\-()]/g, "");
}
