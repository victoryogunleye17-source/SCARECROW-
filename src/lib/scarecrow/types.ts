export const DURATION_HOURS = [2, 4, 8] as const;
export type DurationHours = (typeof DURATION_HOURS)[number];

export type SessionValue =
  | "pending"
  | "accepted"
  | "live"
  | "ended"
  | "declined";

export type LocationFix = {
  lat: number;
  lng: number;
  acc: number;
  ts: number;
};

export type SessionStatus = {
  value: SessionValue;
  createdAt: number;
  expiresAt: number;
  durationHours: DurationHours;
  duress: boolean;
  panic: boolean;
  panicAt: number | null;
  endedAt: number | null;
  endedBy: "host" | "guest" | "expiry" | null;
  lastHeartbeatAt: number | null;
};

export type HistoryRecord = {
  id: string;
  createdAt: number;
  endedAt: number | null;
  status: SessionValue;
  durationHours: DurationHours;
  duress: boolean;
  panic: boolean;
  lastLocationAt: number | null;
  lastLocation: LocationFix | null;
};

export type ChatMessage = {
  from: "host" | "guest";
  text: string;
  ts: number;
};

export type SignalField = "offer" | "answer" | "cand:host" | "cand:guest";

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};
