import { getStore } from "./store";
import {
  hashPin,
  hashToken,
  randId,
  timingSafeString,
} from "./crypto";
import {
  isAdmin,
  isGuestFor,
  setGuestCookie,
} from "./auth.server";
import type {
  ChatMessage,
  DurationHours,
  HistoryRecord,
  IceServer,
  LocationFix,
  SessionStatus,
  SessionValue,
  SignalField,
} from "./types";
import { DURATION_HOURS } from "./types";

const LAST_KNOWN_TTL = 60 * 60 * 24;
const HISTORY_TTL = 60 * 60 * 24 * 7;
const HEARTBEAT_DROP_MS = 45_000;
const PIN_MAX_TRIES = 5;
const PIN_LOCK_SEC = 60 * 15;

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function ttlRemaining(expiresAt: number): number {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
}

async function readStatus(id: string): Promise<SessionStatus | null> {
  return parseJson<SessionStatus>(await getStore().get(`sc:${id}:status`));
}

async function writeStatus(id: string, status: SessionStatus, ttlSec: number) {
  await getStore().set(`sc:${id}:status`, JSON.stringify(status), ttlSec);
}

async function upsertHistory(id: string, patch: Partial<HistoryRecord>) {
  const store = getStore();
  const prev =
    parseJson<HistoryRecord>(await store.get(`hist:${id}`)) ??
    ({
      id,
      createdAt: Date.now(),
      endedAt: null,
      status: "pending",
      durationHours: 2,
      duress: false,
      panic: false,
      lastLocationAt: null,
      lastLocation: null,
    } satisfies HistoryRecord);
  const next: HistoryRecord = { ...prev, ...patch, id };
  // Never persist GPS in the long-lived history record.
  next.lastLocation = null;
  await store.set(`hist:${id}`, JSON.stringify(next), HISTORY_TTL);
  await store.sadd("admin:history", id);
  await store.expire("admin:history", HISTORY_TTL);
}

async function requireFresh(id: string): Promise<SessionStatus | null> {
  const status = await readStatus(id);
  if (!status) return null;
  if (status.value === "ended" || status.value === "declined") return status;
  if (Date.now() >= status.expiresAt) {
    const ended: SessionStatus = {
      ...status,
      value: "ended",
      endedAt: Date.now(),
      endedBy: "expiry",
    };
    await writeStatus(id, ended, LAST_KNOWN_TTL);
    await upsertHistory(id, {
      status: "ended",
      endedAt: ended.endedAt,
    });
    const store = getStore();
    await store.expire(`sc:${id}:location`, LAST_KNOWN_TTL);
    return ended;
  }
  return status;
}

export async function createSession(input: {
  durationHours: number;
  normalPin?: string;
  duressPin?: string;
}): Promise<{ ok: true; id: string; expiresAt: number } | { ok: false; error: string }> {
  if (!(await isAdmin())) return { ok: false, error: "not authorized" };
  if (!(DURATION_HOURS as readonly number[]).includes(input.durationHours)) {
    return { ok: false, error: "Pick a 2, 4, or 8 hour trip." };
  }
  const durationHours = input.durationHours as DurationHours;
  const normalPin = (input.normalPin || "").trim();
  const duressPin = (input.duressPin || "").trim();
  if ((normalPin && !duressPin) || (!normalPin && duressPin)) {
    return { ok: false, error: "Set both PINs, or leave both blank." };
  }
  if (normalPin && duressPin && normalPin === duressPin) {
    return { ok: false, error: "The two PINs must be different." };
  }

  const id = randId(18);
  const now = Date.now();
  const ttlSec = durationHours * 60 * 60;
  const status: SessionStatus = {
    value: "pending",
    createdAt: now,
    expiresAt: now + ttlSec * 1000,
    durationHours,
    duress: false,
    panic: false,
    panicAt: null,
    endedAt: null,
    endedBy: null,
    lastHeartbeatAt: null,
  };
  const store = getStore();
  await writeStatus(id, status, ttlSec);
  if (normalPin && duressPin) {
    await store.set(
      `sc:${id}:pins`,
      JSON.stringify({
        normalHash: hashPin(normalPin, id),
        duressHash: hashPin(duressPin, id),
      }),
      ttlSec,
    );
  }
  await upsertHistory(id, {
    id,
    createdAt: now,
    status: "pending",
    durationHours,
  });
  return { ok: true, id, expiresAt: status.expiresAt };
}

export async function historyList(): Promise<
  { ok: true; history: HistoryRecord[] } | { ok: false; error: string }
> {
  if (!(await isAdmin())) return { ok: false, error: "not authorized" };
  const store = getStore();
  const ids = await store.smembers("admin:history");
  const rows: HistoryRecord[] = [];
  for (const id of ids) {
    const rec = parseJson<HistoryRecord>(await store.get(`hist:${id}`));
    if (!rec) continue;
    const loc = parseJson<LocationFix>(await store.get(`sc:${id}:location`));
    rows.push({
      ...rec,
      lastLocation: loc,
      lastLocationAt: loc?.ts ?? rec.lastLocationAt,
    });
  }
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return { ok: true, history: rows };
}

export async function historyClear(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (!(await isAdmin())) return { ok: false, error: "not authorized" };
  const store = getStore();
  const ids = await store.smembers("admin:history");
  for (const id of ids) await store.del(`hist:${id}`);
  await store.del("admin:history");
  return { ok: true };
}

export async function publicStatus(id: string): Promise<{
  found: boolean;
  pinRequired: boolean;
  value: SessionValue | null;
  expiresAt: number | null;
  durationHours: DurationHours | null;
}> {
  if (!id) {
    return {
      found: false,
      pinRequired: false,
      value: null,
      expiresAt: null,
      durationHours: null,
    };
  }
  const status = await requireFresh(id);
  if (!status) {
    return {
      found: false,
      pinRequired: false,
      value: null,
      expiresAt: null,
      durationHours: null,
    };
  }
  const pins = await getStore().get(`sc:${id}:pins`);
  return {
    found: true,
    pinRequired: Boolean(pins),
    value: status.value,
    expiresAt: status.expiresAt,
    durationHours: status.durationHours,
  };
}

export async function guestStart(input: {
  id: string;
  pin?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { id } = input;
  const status = await requireFresh(id);
  if (!status) return { ok: false, error: "This link is invalid or has expired." };
  if (status.value === "ended") return { ok: false, error: "This session has already been closed." };
  if (status.value === "declined") return { ok: false, error: "This link was already declined." };
  if (status.value === "accepted" || status.value === "live") {
    if (await isGuestFor(id)) return { ok: true };
    return { ok: false, error: "This check-in is already in use." };
  }

  const store = getStore();
  const pinRaw = await store.get(`sc:${id}:pins`);
  let duress = false;
  if (pinRaw) {
    const locked = await store.get(`sc:${id}:pinlock`);
    if (locked) {
      return { ok: false, error: "Too many PIN attempts. Ask them to send a new link." };
    }
    const pins = parseJson<{ normalHash: string; duressHash: string }>(pinRaw);
    const h = hashPin(input.pin || "", id);
    const normal = pins ? timingSafeString(h, pins.normalHash) : false;
    const isDuress = pins ? timingSafeString(h, pins.duressHash) : false;
    if (!normal && !isDuress) {
      const fails = Number((await store.get(`sc:${id}:pinfail`)) || "0") + 1;
      await store.set(`sc:${id}:pinfail`, String(fails), PIN_LOCK_SEC);
      if (fails >= PIN_MAX_TRIES) {
        await store.set(`sc:${id}:pinlock`, "1", PIN_LOCK_SEC);
      }
      return { ok: false, error: "That code isn't right. Try again." };
    }
    duress = isDuress;
  }

  const ttl = ttlRemaining(status.expiresAt);
  const guestToken = randId(24);
  await store.set(`sc:${id}:guest`, hashToken(guestToken), ttl);
  setGuestCookie(id, guestToken, ttl);
  const next: SessionStatus = {
    ...status,
    value: "accepted",
    duress: status.duress || duress,
    lastHeartbeatAt: Date.now(),
  };
  await writeStatus(id, next, ttl);
  await upsertHistory(id, { status: "accepted", duress: next.duress });
  return { ok: true };
}

export async function guestDecline(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const status = await requireFresh(id);
  if (!status) return { ok: false, error: "This link is invalid or has expired." };
  if (status.value !== "pending") {
    return { ok: false, error: "This check-in can no longer be declined." };
  }
  const next: SessionStatus = {
    ...status,
    value: "declined",
    endedAt: Date.now(),
    endedBy: "guest",
  };
  await writeStatus(id, next, LAST_KNOWN_TTL);
  await upsertHistory(id, { status: "declined", endedAt: next.endedAt });
  return { ok: true };
}

export async function guestPanic(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isGuestFor(id))) return { ok: false, error: "not authorized" };
  const status = await requireFresh(id);
  if (!status) return { ok: false, error: "Session gone." };
  if (status.value === "ended" || status.value === "declined") {
    return { ok: false, error: "Session already closed." };
  }
  const next: SessionStatus = {
    ...status,
    panic: true,
    panicAt: Date.now(),
  };
  await writeStatus(id, next, ttlRemaining(status.expiresAt));
  await upsertHistory(id, { panic: true });
  return { ok: true };
}

export async function endSession(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await isAdmin();
  const guest = await isGuestFor(id);
  if (!admin && !guest) return { ok: false, error: "not authorized" };
  const status = await requireFresh(id);
  if (!status) return { ok: false, error: "Session gone." };
  if (status.value === "ended" || status.value === "declined") return { ok: true };
  const next: SessionStatus = {
    ...status,
    value: "ended",
    endedAt: Date.now(),
    endedBy: admin ? "host" : "guest",
  };
  await writeStatus(id, next, LAST_KNOWN_TTL);
  await getStore().expire(`sc:${id}:location`, LAST_KNOWN_TTL);
  await upsertHistory(id, { status: "ended", endedAt: next.endedAt });
  return { ok: true };
}

export async function guestPing(input: {
  id: string;
  location?: LocationFix | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isGuestFor(input.id))) return { ok: false, error: "not authorized" };
  const status = await requireFresh(input.id);
  if (!status) return { ok: false, error: "Session gone." };
  if (status.value === "ended" || status.value === "declined") {
    return { ok: false, error: "ended" };
  }
  const store = getStore();
  const ttl = ttlRemaining(status.expiresAt);
  const now = Date.now();
  if (input.location) {
    const loc = input.location;
    if (
      !Number.isFinite(loc.lat) ||
      !Number.isFinite(loc.lng) ||
      loc.lat < -90 ||
      loc.lat > 90 ||
      loc.lng < -180 ||
      loc.lng > 180
    ) {
      return { ok: false, error: "bad location" };
    }
    const fix: LocationFix = {
      lat: loc.lat,
      lng: loc.lng,
      acc: Number.isFinite(loc.acc) ? loc.acc : 0,
      ts: now,
    };
    await store.set(`sc:${input.id}:location`, JSON.stringify(fix), ttl);
    await upsertHistory(input.id, { lastLocationAt: now });
  }
  await writeStatus(
    input.id,
    { ...status, lastHeartbeatAt: now, value: status.value === "accepted" ? "live" : status.value },
    ttl,
  );
  return { ok: true };
}

function dropped(status: SessionStatus): boolean {
  if (status.value !== "accepted" && status.value !== "live") return false;
  if (!status.lastHeartbeatAt) return Date.now() - status.createdAt > HEARTBEAT_DROP_MS;
  return Date.now() - status.lastHeartbeatAt > HEARTBEAT_DROP_MS;
}

async function readChat(id: string): Promise<ChatMessage[]> {
  const list = await getStore().lrange(`sc:${id}:chat`, 0, -1);
  return list
    .map((row) => parseJson<ChatMessage>(row))
    .filter((row): row is ChatMessage => Boolean(row));
}

export async function hostSnapshot(id: string): Promise<
  | {
      ok: true;
      status: SessionStatus;
      location: LocationFix | null;
      messages: ChatMessage[];
      dropped: boolean;
      remainingMs: number;
    }
  | { ok: false; error: string }
> {
  if (!(await isAdmin())) return { ok: false, error: "not authorized" };
  const status = await requireFresh(id);
  if (!status) return { ok: false, error: "Session gone." };
  const location = parseJson<LocationFix>(await getStore().get(`sc:${id}:location`));
  return {
    ok: true,
    status,
    location,
    messages: await readChat(id),
    dropped: dropped(status),
    remainingMs: Math.max(0, status.expiresAt - Date.now()),
  };
}

export async function guestSnapshot(id: string): Promise<
  | {
      ok: true;
      value: SessionValue;
      expiresAt: number;
      remainingMs: number;
      messages: ChatMessage[];
    }
  | { ok: false; error: string }
> {
  if (!(await isGuestFor(id))) return { ok: false, error: "not authorized" };
  const status = await requireFresh(id);
  if (!status) return { ok: false, error: "Session gone." };
  return {
    ok: true,
    value: status.value,
    expiresAt: status.expiresAt,
    remainingMs: Math.max(0, status.expiresAt - Date.now()),
    messages: await readChat(id),
  };
}

export async function signalSet(input: {
  id: string;
  field: SignalField;
  data: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { id, field, data } = input;
  const admin = await isAdmin();
  const guest = await isGuestFor(id);
  if (field === "offer" || field === "cand:host") {
    if (!admin) return { ok: false, error: "not authorized" };
  } else if (field === "answer" || field === "cand:guest") {
    if (!guest) return { ok: false, error: "not authorized" };
  } else {
    return { ok: false, error: "bad field" };
  }
  const status = await requireFresh(id);
  if (!status) return { ok: false, error: "Session gone." };
  const ttl = ttlRemaining(status.expiresAt);
  const raw = JSON.stringify(data);
  if (raw.length > 16_000) return { ok: false, error: "payload too large" };
  const store = getStore();
  if (field === "cand:host" || field === "cand:guest") {
    await store.rpush(`sc:${id}:${field}`, raw);
    await store.expire(`sc:${id}:${field}`, ttl);
  } else {
    await store.set(`sc:${id}:${field}`, raw, ttl);
  }
  return { ok: true };
}

export async function signalGet(input: {
  id: string;
  field: SignalField;
}): Promise<{ ok: true; payload: string | null } | { ok: false; error: string }> {
  const { id, field } = input;
  const admin = await isAdmin();
  const guest = await isGuestFor(id);
  // Host reads guest signals; guest reads host signals.
  if (field === "answer" || field === "cand:guest") {
    if (!admin) return { ok: false, error: "not authorized" };
  } else if (field === "offer" || field === "cand:host") {
    if (!guest) return { ok: false, error: "not authorized" };
  } else {
    return { ok: false, error: "bad field" };
  }
  const store = getStore();
  if (field === "cand:host" || field === "cand:guest") {
    const list = await store.lrange(`sc:${id}:${field}`, 0, -1);
    return { ok: true, payload: JSON.stringify(list.map((row) => parseJson(row)).filter(Boolean)) };
  }
  const raw = await store.get(`sc:${id}:${field}`);
  return { ok: true, payload: raw };
}

export async function chatSend(input: {
  id: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await isAdmin();
  const guest = await isGuestFor(input.id);
  if (!admin && !guest) return { ok: false, error: "not authorized" };
  const text = input.text.trim().slice(0, 500);
  if (!text) return { ok: false, error: "empty message" };
  const status = await requireFresh(input.id);
  if (!status) return { ok: false, error: "Session gone." };
  const ttl = ttlRemaining(status.expiresAt);
  const msg: ChatMessage = {
    from: admin ? "host" : "guest",
    text,
    ts: Date.now(),
  };
  const store = getStore();
  await store.rpush(`sc:${input.id}:chat`, JSON.stringify(msg));
  await store.ltrim(`sc:${input.id}:chat`, -200, -1);
  await store.expire(`sc:${input.id}:chat`, ttl);
  return { ok: true };
}

export function iceServers(): IceServer[] {
  const servers: IceServer[] = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun.cloudflare.com:3478",
      ],
    },
  ];
  const urls = (process.env.TURN_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;
  if (urls.length && username && credential) {
    servers.push({ urls, username, credential });
  }
  return servers;
}
