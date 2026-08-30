import { useEffect, useRef, useState } from "react";
import {
  chatSendFn,
  createSessionFn,
  endSessionFn,
  historyClearFn,
  historyListFn,
  hostSnapshotFn,
  iceServersFn,
  loginFn,
  logoutFn,
  whoamiFn,
} from "@/lib/scarecrow/api";
import type {
  ChatMessage,
  DurationHours,
  HistoryRecord,
  IceServer,
  LocationFix,
  SessionStatus,
} from "@/lib/scarecrow/types";
import { DURATION_HOURS } from "@/lib/scarecrow/types";
import {
  fmtAgo,
  fmtCoord,
  fmtRemaining,
  fmtWhen,
  mapLink,
} from "@/lib/scarecrow/format";
import { pullSignals, startHostPeer } from "@/lib/scarecrow/webrtc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppShell, Card, StatusLine } from "./shell";
import { ChatBox } from "./chat-box";

type Who = Awaited<ReturnType<typeof whoamiFn>>;

export function AdminDashboard({ initial }: { initial: Who }) {
  const [who, setWho] = useState(initial);
  const [view, setView] = useState<"login" | "dash" | "ended">(
    initial.authed ? "dash" : "login",
  );
  const [endedTitle, setEndedTitle] = useState("Check-in ended.");
  const [endedBody, setEndedBody] = useState("");

  return (
    <AppShell kicker="ADMIN">
      {view === "login" ? (
        <LoginForm
          who={who}
          onAuthed={async () => {
            setWho(await whoamiFn());
            setView("dash");
          }}
        />
      ) : view === "ended" ? (
        <Card>
          <StatusLine tone="off">ENDED</StatusLine>
          <h1 className="mb-2 text-balance text-[22px] font-bold leading-snug tracking-[-0.01em]">
            {endedTitle}
          </h1>
          <p className="mb-4 text-pretty text-[14.5px] leading-normal text-muted">
            {endedBody}
          </p>
          <Button variant="ghost" onClick={() => setView("dash")}>
            Back to dashboard
          </Button>
        </Card>
      ) : (
        <Dash
          who={who}
          onLogout={async () => {
            await logoutFn();
            setWho(await whoamiFn());
            setView("login");
          }}
          onEnded={(title, body) => {
            setEndedTitle(title);
            setEndedBody(body);
            setView("ended");
          }}
        />
      )}
    </AppShell>
  );
}

function LoginForm({
  who,
  onAuthed,
}: {
  who: Who;
  onAuthed: () => void;
}) {
  const [phone, setPhone] = useState(who.previewHint?.phone ?? "");
  const [username, setUsername] = useState(who.previewHint?.username ?? "");
  const [password, setPassword] = useState(who.previewHint?.password ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr("");
    if (!phone.trim() || !username.trim() || !password) {
      setErr("Enter all three fields.");
      return;
    }
    setBusy(true);
    const res = await loginFn({
      data: { phone: phone.trim(), username: username.trim(), password },
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    onAuthed();
  }

  return (
    <Card>
      <h1 className="mb-2 text-balance text-[22px] font-bold leading-snug tracking-[-0.01em]">
        Sign in.
      </h1>
      <p className="mb-4 text-pretty text-[14.5px] leading-normal text-muted">
        This dashboard is for one person only. Nobody else can create check-in
        links.
      </p>
      {who.previewAuth ? (
        <p className="mb-4 rounded-md border border-border bg-surface-2 px-3.5 py-3 text-[13px] leading-normal text-muted">
          Preview login is on until you set{" "}
          <span className="font-mono text-fg">ADMIN_PASSWORD</span> on Vercel.
          Use the filled-in values below.
        </p>
      ) : null}
      <Label htmlFor="in-phone">Phone number</Label>
      <Input
        id="in-phone"
        type="tel"
        autoComplete="tel"
        placeholder="+234…"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <Label htmlFor="in-user">Username</Label>
      <Input
        id="in-user"
        autoComplete="username"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <Label htmlFor="in-pass">Password</Label>
      <Input
        id="in-pass"
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
      />
      {err ? (
        <div className="mb-3.5 text-[13px] text-danger">{err}</div>
      ) : null}
      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </Card>
  );
}

function Dash({
  who,
  onLogout,
  onEnded,
}: {
  who: Who;
  onLogout: () => void;
  onEnded: (title: string, body: string) => void;
}) {
  const [duration, setDuration] = useState<DurationHours>(4);
  const [normalPin, setNormalPin] = useState("");
  const [duressPin, setDuressPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [link, setLink] = useState("");

  async function refreshHistory() {
    const res = await historyListFn();
    if (res.ok) setHistory(res.history);
  }

  useEffect(() => {
    void refreshHistory();
  }, []);

  async function create() {
    setBusy(true);
    const res = await createSessionFn({
      data: {
        durationHours: duration,
        normalPin: normalPin.trim() || undefined,
        duressPin: duressPin.trim() || undefined,
      },
    });
    setBusy(false);
    setNormalPin("");
    setDuressPin("");
    if (!res.ok) {
      window.alert(res.error);
      return;
    }
    const nextLink = `${window.location.origin}/join?s=${res.id}`;
    setSessionId(res.id);
    setLink(nextLink);
    void refreshHistory();
  }

  return (
    <>
      {who.store === "memory" ? (
        <p className="rounded-md border border-border bg-surface-2 px-3.5 py-3 text-[12.5px] leading-normal text-muted">
          Sessions live in this server process until you set{" "}
          <span className="font-mono text-fg">UPSTASH_REDIS_REST_URL</span> and{" "}
          <span className="font-mono text-fg">UPSTASH_REDIS_REST_TOKEN</span> on
          Vercel.
        </p>
      ) : null}
      {!who.turnConfigured ? (
        <p className="rounded-md border border-border bg-surface-2 px-3.5 py-3 text-[12.5px] leading-normal text-muted">
          Video on mobile data needs a TURN server. Set{" "}
          <span className="font-mono text-fg">TURN_URLS</span>,{" "}
          <span className="font-mono text-fg">TURN_USERNAME</span>, and{" "}
          <span className="font-mono text-fg">TURN_CREDENTIAL</span> after you
          create a free Metered or Twilio TURN account.
        </p>
      ) : null}

      <Card>
        <h1 className="mb-2 text-balance text-[22px] font-bold leading-snug tracking-[-0.01em]">
          Start a check-in.
        </h1>
        <p className="mb-4 text-pretty text-[14.5px] leading-normal text-muted">
          Generate a private link for one trip. When they open it and accept,
          you receive their live camera and location — yours are never shared.
        </p>

        <Label>Trip length</Label>
        <div className="mb-3.5 grid grid-cols-3 gap-2">
          {DURATION_HOURS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setDuration(h)}
              className={
                duration === h
                  ? "min-h-11 rounded-md bg-accent font-mono text-[13px] font-semibold text-accent-fg"
                  : "min-h-11 rounded-md border border-border bg-surface-2 font-mono text-[13px] font-semibold text-fg"
              }
            >
              {h}h
            </button>
          ))}
        </div>

        <Label htmlFor="in-normal-pin">Normal PIN (optional)</Label>
        <Input
          id="in-normal-pin"
          inputMode="numeric"
          placeholder="Leave blank to skip PIN protection"
          value={normalPin}
          onChange={(e) => setNormalPin(e.target.value)}
        />
        <Label htmlFor="in-duress-pin">Duress PIN (optional)</Label>
        <Input
          id="in-duress-pin"
          inputMode="numeric"
          placeholder="A different code — flags your dashboard only"
          value={duressPin}
          onChange={(e) => setDuressPin(e.target.value)}
        />
        <p className="-mt-1.5 mb-4 text-[13px] leading-normal text-muted">
          If you set both, share them privately — never through this app. Their
          screen still looks like a normal live check-in either way. Phones
          cannot hide the camera indicator, so this is a silent flag for you,
          not stealth.
        </p>
        <Button disabled={busy} onClick={() => void create()}>
          {busy ? "Generating…" : "Generate check-in link"}
        </Button>
      </Card>

      {sessionId ? (
        <HostPanel
          id={sessionId}
          link={link}
          onEnded={onEnded}
          onHistory={() => void refreshHistory()}
        />
      ) : null}

      <Button variant="ghost" onClick={() => void onLogout()}>
        Sign out
      </Button>

      <Card>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="m-0 text-[15px] font-bold">History</h2>
          <Button
            variant="ghost"
            size="compact"
            className="w-auto"
            onClick={async () => {
              if (
                !window.confirm(
                  "Clear all check-in history? This cannot be undone.",
                )
              )
                return;
              await historyClearFn();
              void refreshHistory();
            }}
          >
            Clear
          </Button>
        </div>
        {history.length === 0 ? (
          <div className="text-[13px] text-muted">No check-ins yet.</div>
        ) : (
          history.map((rec) => <HistoryRow key={rec.id} rec={rec} />)
        )}
      </Card>

      <p className="mt-2 border-t border-border pt-4 text-xs leading-relaxed text-muted">
        <span className="text-fg">Read before relying on this.</span> The
        check-in link is the only thing protecting that session — treat it like
        a password. Location and connection setup pass through this app's
        server; live video is peer-to-peer. Sharing only lasts while their
        screen stays on this page, up to the trip timer. In a genuine high-risk
        environment, treat this as an extra layer, not a substitute for a
        vetted safety plan.
      </p>
    </>
  );
}

function HistoryRow({ rec }: { rec: HistoryRecord }) {
  const badge = rec.duress
    ? "bg-danger/20 text-danger"
    : rec.panic
      ? "bg-danger/20 text-danger"
      : rec.status === "live" || rec.status === "accepted"
        ? "bg-accent-dim text-accent"
        : rec.status === "declined"
          ? "bg-danger/15 text-danger"
          : rec.status === "ended"
            ? "bg-surface-2 text-muted"
            : "bg-warn-dim text-warn";
  const label = rec.duress
    ? "DURESS"
    : rec.panic
      ? "ALERT"
      : rec.status.toUpperCase();
  return (
    <div className="flex items-start gap-2.5 border-b border-border py-2.5 last:border-b-0">
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.06em] ${badge}`}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10.5px] text-muted">
          {fmtWhen(rec.createdAt)} · {rec.durationHours}h
        </div>
        {rec.lastLocation ? (
          <div className="mt-0.5 font-mono text-[11.5px] text-fg">
            {rec.lastLocation.lat.toFixed(5)}, {rec.lastLocation.lng.toFixed(5)}{" "}
            ·{" "}
            <a
              className="text-accent no-underline"
              href={mapLink(rec.lastLocation.lat, rec.lastLocation.lng)}
              target="_blank"
              rel="noopener noreferrer"
            >
              map
            </a>
            {rec.lastLocationAt ? (
              <span className="text-muted">
                {" "}
                · {fmtAgo(rec.lastLocationAt)}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="mt-0.5 font-mono text-[11.5px] text-muted">
            {rec.lastLocationAt
              ? `location expired · last seen ${fmtAgo(rec.lastLocationAt)}`
              : "no location shared"}
          </div>
        )}
      </div>
    </div>
  );
}

function HostPanel({
  id,
  link,
  onEnded,
  onHistory,
}: {
  id: string;
  link: string;
  onEnded: (title: string, body: string) => void;
  onHistory: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [live, setLive] = useState(false);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [location, setLocation] = useState<LocationFix | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [dropped, setDropped] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [hasVideo, setHasVideo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteStream = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const connecting = useRef(false);
  const sigState = useRef({ appliedRemote: false, lastCand: 0 });
  const iceRef = useRef<IceServer[] | null>(null);

  useEffect(() => {
    let stop = false;
    const timer = window.setInterval(async () => {
      if (stop) return;
      const snap = await hostSnapshotFn({ data: { id } });
      if (!snap.ok || stop) return;
      setStatus(snap.status);
      setLocation(snap.location);
      setMessages(snap.messages);
      setDropped(snap.dropped);
      setRemainingMs(snap.remainingMs);

      if (snap.status.value === "declined") {
        teardown();
        onHistory();
        onEnded("Declined.", "They declined this check-in. Nothing was shared.");
        return;
      }
      if (snap.status.value === "ended") {
        teardown();
        onHistory();
        const body =
          snap.status.endedBy === "guest"
            ? "They stopped sharing."
            : snap.status.endedBy === "expiry"
              ? "The trip timer ended this session. Last known location is kept for 24 hours."
              : "This session is closed.";
        onEnded("Check-in ended.", body);
        return;
      }

      if (
        (snap.status.value === "accepted" || snap.status.value === "live") &&
        !connecting.current
      ) {
        connecting.current = true;
        setLive(true);
        try {
          if (!iceRef.current) {
            iceRef.current = (await iceServersFn()).iceServers;
          }
          pcRef.current = await startHostPeer(
            id,
            iceRef.current,
            (stream) => {
              remoteStream.current = stream;
              if (videoRef.current) videoRef.current.srcObject = stream;
              setHasVideo(true);
            },
          );
        } catch (err) {
          console.error(err);
        }
      }

      if (connecting.current && pcRef.current) {
        try {
          await pullSignals(pcRef.current, id, "host", sigState.current);
        } catch {
          /* ignore signaling races */
        }
      }
    }, 1600);
    return () => {
      stop = true;
      window.clearInterval(timer);
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (live && videoRef.current && remoteStream.current) {
      videoRef.current.srcObject = remoteStream.current;
    }
  }, [live, hasVideo]);

  function teardown() {
    connecting.current = false;
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  }

  const tone = status?.duress || status?.panic
    ? "alert"
    : dropped
      ? "off"
      : hasVideo
        ? "live"
        : live
          ? "pending"
          : "pending";

  const statusText = status?.duress
    ? "DURESS FLAG — they entered the duress PIN. This feed is real."
    : status?.panic
      ? "ALERT — they tapped Send alert."
      : dropped
        ? `SIGNAL LOST — last seen ${fmtAgo(status?.lastHeartbeatAt)}`
        : hasVideo
          ? `LIVE · ${fmtRemaining(remainingMs)} left`
          : live
            ? "CONNECTING…"
            : "WAITING FOR LINK TO OPEN";

  return (
    <Card>
      <StatusLine tone={tone}>{statusText}</StatusLine>

      {!live ? (
        <>
          <p className="mb-4 text-pretty text-[14.5px] leading-normal text-muted">
            Send this link to the person you want to check on. Nothing shares
            until they accept. Ask them to keep the page in the foreground for
            the whole trip.
          </p>
          <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2.5">
            <input
              readOnly
              value={link}
              className="min-w-0 flex-1 border-0 bg-transparent font-mono text-xs text-fg outline-none"
            />
            <Button
              variant="ghost"
              size="compact"
              className="w-auto"
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="rounded-md border border-dashed border-border bg-surface-2 px-3.5 py-3 text-[13px] leading-normal text-fg">
            Tap this link to share your live camera and location with me for a
            safety check-in — nothing turns on until you accept: {link}
          </div>
        </>
      ) : (
        <>
          <div className="relative mb-3.5 aspect-[3/4] overflow-hidden rounded-md border border-border bg-bg">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="size-full object-cover"
            />
            {!hasVideo ? (
              <div className="absolute inset-0 flex items-center justify-center px-2.5 text-center font-mono text-[11px] text-muted">
                Waiting for them to accept…
              </div>
            ) : (
              <div className="absolute bottom-2 left-2 rounded bg-bg/70 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em]">
                THEIR CAMERA
              </div>
            )}
          </div>

          <div className="mb-3.5 rounded-md border border-border bg-surface-2 px-3.5 py-3">
            <div className="mb-1 font-mono text-[10px] tracking-[0.1em] text-muted">
              THEIR LOCATION
            </div>
            <div className="font-mono text-[13px] text-fg">
              {location
                ? fmtCoord(location.lat, location.lng, location.acc)
                : "—"}
            </div>
            {location ? (
              <a
                className="mt-1.5 inline-block font-mono text-[11.5px] text-accent no-underline"
                href={mapLink(location.lat, location.lng)}
                target="_blank"
                rel="noopener noreferrer"
              >
                open map
              </a>
            ) : null}
            <div className="mt-1 font-mono text-[11px] text-muted">
              Last fix {fmtAgo(location?.ts ?? status?.lastHeartbeatAt)}
              {dropped ? " · phone may be off or the page left the foreground" : ""}
            </div>
          </div>

          <ChatBox
            messages={messages}
            myRole="host"
            onSend={async (text) => {
              await chatSendFn({ data: { id, text } });
            }}
          />

          <Button
            variant="danger"
            onClick={async () => {
              await endSessionFn({ data: { id } });
              teardown();
              onHistory();
              onEnded(
                "Check-in ended.",
                "You ended the session. Last known location is kept for 24 hours.",
              );
            }}
          >
            End check-in
          </Button>
        </>
      )}
    </Card>
  );
}
