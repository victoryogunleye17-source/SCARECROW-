import {
  deleteCookie,
  getCookie,
  getRequest,
  setCookie,
} from "@tanstack/react-start/server";
import { getStore, storeKind, type StoreKind } from "./store";
import {
  hashToken,
  normalizePhone,
  passwordsMatch,
  randId,
  timingSafeString,
} from "./crypto";

const ADMIN_COOKIE = "sc_admin";
const GUEST_COOKIE = "sc_guest";
const ADMIN_TTL_SEC = 60 * 60 * 24 * 7;
const LOCK_AFTER = 5;
const LOCK_SEC = 60 * 15;

export type AuthConfig = {
  previewAuth: boolean;
  store: StoreKind;
  turnConfigured: boolean;
  previewHint: { phone: string; username: string; password: string } | null;
};

function adminPhone(): string {
  return process.env.ADMIN_PHONE || "+2340000000000";
}
function adminUser(): string {
  return process.env.ADMIN_USERNAME || "admin";
}
function adminPassword(): string {
  return process.env.ADMIN_PASSWORD || "scarecrow-preview";
}

export function authConfig(): AuthConfig {
  const previewAuth = !process.env.ADMIN_PASSWORD;
  return {
    previewAuth,
    store: storeKind(),
    turnConfigured: Boolean(
      process.env.TURN_URLS &&
        process.env.TURN_USERNAME &&
        process.env.TURN_CREDENTIAL,
    ),
    previewHint: previewAuth
      ? {
          phone: adminPhone(),
          username: adminUser(),
          password: adminPassword(),
        }
      : null,
  };
}

function cookieSecure(): boolean {
  try {
    const req = getRequest();
    const proto =
      req.headers.get("x-forwarded-proto") || new URL(req.url).protocol;
    return proto.includes("https");
  } catch {
    return false;
  }
}

function cookieOpts(maxAge: number) {
  return {
    path: "/",
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax" as const,
    maxAge,
  };
}

export async function isAdmin(): Promise<boolean> {
  const token = getCookie(ADMIN_COOKIE);
  if (!token) return false;
  const val = await getStore().get(`admin:token:${hashToken(token)}`);
  return Boolean(val);
}

export function readGuestCookie(): { id: string; token: string } | null {
  const raw = getCookie(GUEST_COOKIE);
  if (!raw) return null;
  const idx = raw.indexOf(".");
  if (idx < 1) return null;
  return { id: raw.slice(0, idx), token: raw.slice(idx + 1) };
}

export async function isGuestFor(id: string): Promise<boolean> {
  const parsed = readGuestCookie();
  if (!parsed || parsed.id !== id) return false;
  const stored = await getStore().get(`sc:${id}:guest`);
  if (!stored) return false;
  return timingSafeString(stored, hashToken(parsed.token));
}

export function setAdminCookie(token: string) {
  setCookie(ADMIN_COOKIE, token, cookieOpts(ADMIN_TTL_SEC));
}

export function clearAdminCookie() {
  deleteCookie(ADMIN_COOKIE, { path: "/" });
}

export function setGuestCookie(id: string, token: string, ttlSec: number) {
  setCookie(GUEST_COOKIE, `${id}.${token}`, cookieOpts(ttlSec));
}

export function clearGuestCookie() {
  deleteCookie(GUEST_COOKIE, { path: "/" });
}

export async function loginAdmin(input: {
  phone: string;
  username: string;
  password: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = getStore();
  const locked = await store.get("login:lock");
  if (locked) {
    return {
      ok: false,
      error: "Too many attempts. Wait 15 minutes and try again.",
    };
  }

  const phoneOk = timingSafeString(
    normalizePhone(input.phone),
    normalizePhone(adminPhone()),
  );
  const userOk = timingSafeString(input.username.trim(), adminUser());
  const passOk = passwordsMatch(input.password, adminPassword());

  if (!phoneOk || !userOk || !passOk) {
    const raw = await store.get("login:fails");
    const fails = Number(raw || "0") + 1;
    await store.set("login:fails", String(fails), LOCK_SEC);
    if (fails >= LOCK_AFTER) {
      await store.set("login:lock", "1", LOCK_SEC);
    }
    await new Promise((r) => setTimeout(r, 400));
    return { ok: false, error: "Phone, username, or password not recognized." };
  }

  await store.del("login:fails");
  await store.del("login:lock");
  const token = randId(32);
  await store.set(`admin:token:${hashToken(token)}`, "1", ADMIN_TTL_SEC);
  setAdminCookie(token);
  return { ok: true };
}

export async function logoutAdmin() {
  const token = getCookie(ADMIN_COOKIE);
  if (token) await getStore().del(`admin:token:${hashToken(token)}`);
  clearAdminCookie();
}
