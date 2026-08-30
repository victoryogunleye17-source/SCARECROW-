import { useEffect, useRef, useState } from "react";
import {
  chatSendFn,
  endSessionFn,
  guestDeclineFn,
  guestPanicFn,
  guestPingFn,
  guestSnapshotFn,
  guestStartFn,
  iceServersFn,
  publicStatusFn,
} from "@/lib/scarecrow/api";
import type { ChatMessage, IceServer } from "@/lib/scarecrow/types";
import { fmtRemaining } from "@/lib/scarecrow/format";
import { pullSignals, startGuestPeer } from "@/lib/scarecrow/webrtc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppShell, Card, StatusLine } from "./shell";
import { ChatBox } from "./chat-box";

type View =
  | "boot"
  | "consent"
  | "pin"
  | "live"
  | "ended"
  | "missing";

export function JoinView({ sessionId }: { sessionId: string }) {
  const [view, setView] = useState<View>(sessionId ? "boot" : "missing");
  const [pinRequired, setPinRequired] = useState(false);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [endedTitle, setEndedTitle] = useState("Check-in ended.");
  const [endedBody, setEndedBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [remainingMs, setRemainingMs] = useState(0);
  const [alerted, setAlerted] = useState(false);
  const [camError, setCamError] = useState("");
  const [screenOn, setScreenOn] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const watchId = useRef<number | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const sigState = useRef({ appliedRemote: false, lastCand: 0 });
  const iceRef = useRef<IceServer[] | null>(null);
  const lastFix = useRef<{ lat: number; lng: number; acc: number; ts: number } | null>(
    null,
  );

  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      const st = await publicStatusFn({ data: { id: sessionId } });
      if (!st.found) {
        setEndedTitle("Link not found.");
        setEndedBody("This check-in link is invalid or has expired.");
        setView("missing");
        return;
      }
      if (st.value === "ended") {
        setEndedTitle("Check-in ended.");
        setEndedBody("This session has already been closed.");
        setView("ended");
        return;
      }
      if (st.value === "declined") {
        setEndedTitle("Already declined.");
        setEndedBody("This link was already declined.");
        setView("ended");
        return;
      }
      setPinRequired(st.pinRequired);
      setRemainingMs(st.expiresAt ? Math.max(0, st.expiresAt - Date.now()) : 0);
      setView("consent");
    })();
  }, [sessionId]);

  useEffect(() => {
    function onVis() {
      setScreenOn(document.visibilityState === "visible");
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  function teardown() {
    if (watchId.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    void wakeLock.current?.release();
    wakeLock.current = null;
  }

  async function requestWake() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      /* unsupported or denied */
    }
  }

  async function beginSharing(enteredPin?: string) {
    setBusy(true);
    setPinErr("");
    const started = await guestStartFn({
      data: { id: sessionId, pin: enteredPin },
    });
    if (!started.ok) {
      setBusy(false);
      setPinErr(started.error);
      if (pinRequired) setView("pin");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
    } catch (err) {
      setCamError(
        err instanceof Error
          ? err.message
          : "Camera permission was denied. Location can still share.",
      );
    }

    if (!iceRef.current) {
      iceRef.current = (await iceServersFn()).iceServers;
    }
    if (streamRef.current) {
      pcRef.current = await startGuestPeer(
        sessionId,
        iceRef.current,
        streamRef.current,
      );
    }

    if (navigator.geolocation) {
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          lastFix.current = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acc: pos.coords.accuracy,
            ts: Date.now(),
          };
        },
        () => {
          /* keep heartbeats even without GPS */
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      );
    }

    await requestWake();
    setView("live");
    setBusy(false);
  }

  useEffect(() => {
    if (view !== "live") return;
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [view]);

  useEffect(() => {
    if (view !== "live") return;
    let stop = false;
    const timer = window.setInterval(async () => {
      if (stop) return;
      const ping = await guestPingFn({
        data: { id: sessionId, location: lastFix.current },
      });
      if (!ping.ok && ping.error === "ended") {
        teardown();
        setEndedTitle("Check-in ended.");
        setEndedBody("This session is closed.");
        setView("ended");
        return;
      }
      const snap = await guestSnapshotFn({ data: { id: sessionId } });
      if (!snap.ok) return;
      setMessages(snap.messages);
      setRemainingMs(snap.remainingMs);
      if (snap.value === "ended" || snap.value === "declined") {
        teardown();
        setEndedTitle("Check-in ended.");
        setEndedBody(
          snap.value === "ended"
            ? "They ended the check-in, or the trip timer ran out."
            : "This session is closed.",
        );
        setView("ended");
        return;
      }
      if (pcRef.current) {
        try {
          await pullSignals(pcRef.current, sessionId, "guest", sigState.current);
        } catch {
          /* ignore */
        }
      }
    }, 1600);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [view, sessionId]);

  useEffect(() => () => teardown(), []);

  if (view === "boot") {
    return (
      <AppShell kicker="CHECK-IN REQUEST">
        <Card>
          <p className="text-[14.5px] text-muted">Opening check-in…</p>
        </Card>
      </AppShell>
    );
  }

  if (view === "missing" || view === "ended") {
    return (
      <AppShell kicker="CHECK-IN REQUEST">
        <Card>
          <StatusLine tone="off">ENDED</StatusLine>
          <h1 className="mb-2 text-balance text-[22px] font-bold leading-snug tracking-[-0.01em]">
            {endedTitle}
          </h1>
          <p className="text-pretty text-[14.5px] leading-normal text-muted">
            {endedBody}
          </p>
        </Card>
      </AppShell>
    );
  }

  if (view === "pin") {
    return (
      <AppShell kicker="CHECK-IN REQUEST">
        <Card>
          <h1 className="mb-2 text-balance text-[22px] font-bold leading-snug tracking-[-0.01em]">
            Enter your code.
          </h1>
          <p className="mb-4 text-pretty text-[14.5px] leading-normal text-muted">
            Enter the code you were given to continue.
          </p>
          <Input
            id="in-pin"
            inputMode="numeric"
            placeholder="Code"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void beginSharing(pin.trim());
            }}
          />
          {pinErr ? (
            <div className="mb-3.5 text-[13px] text-danger">{pinErr}</div>
          ) : null}
          <Button
            disabled={busy}
            onClick={() => void beginSharing(pin.trim())}
          >
            Continue
          </Button>
        </Card>
      </AppShell>
    );
  }

  if (view === "live") {
    return (
      <AppShell kicker="CHECK-IN REQUEST">
        <div className="rounded-md border border-warn/40 bg-warn-dim px-3.5 py-3 text-[13px] leading-normal text-fg">
          Keep this screen on and this page in the foreground. Sharing ends at
          the trip timer —{" "}
          <span className="font-mono tabular-nums text-warn">
            {fmtRemaining(remainingMs)}
          </span>{" "}
          left. If the phone sleeps or you switch apps, the check-in can drop.
        </div>
        {!screenOn ? (
          <div className="rounded-md border border-danger/40 bg-danger/15 px-3.5 py-3 text-[13px] text-fg">
            This page left the foreground. Open it again so location and video
            keep sending.
          </div>
        ) : null}
        <Card>
          <StatusLine tone="live">
            SHARING — LIVE · {fmtRemaining(remainingMs)}
          </StatusLine>
          <div className="relative mb-3.5 aspect-[3/4] overflow-hidden rounded-md border border-border bg-bg">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="size-full object-cover"
            />
            <div className="absolute bottom-2 left-2 rounded bg-bg/70 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em]">
              YOUR CAMERA
            </div>
          </div>
          {camError ? (
            <p className="mb-3 text-[13px] text-warn">{camError}</p>
          ) : (
            <p className="mb-3.5 text-[14.5px] leading-normal text-muted">
              They can now see this feed and your location. Stop anytime — it
              ends immediately on their side too.
            </p>
          )}
          <ChatBox
            messages={messages}
            myRole="guest"
            onSend={async (text) => {
              await chatSendFn({ data: { id: sessionId, text } });
            }}
          />
          <div className="flex flex-col gap-2">
            <Button
              variant="warn"
              disabled={alerted}
              onClick={async () => {
                const res = await guestPanicFn({ data: { id: sessionId } });
                if (res.ok) setAlerted(true);
              }}
            >
              {alerted ? "Alert sent" : "Send alert"}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await endSessionFn({ data: { id: sessionId } });
                teardown();
                setEndedTitle("Check-in ended.");
                setEndedBody(
                  "You stopped sharing. Nothing is being shared anymore.",
                );
                setView("ended");
              }}
            >
              Stop sharing
            </Button>
          </div>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell kicker="CHECK-IN REQUEST">
      <Card>
        <div className="mb-4 flex gap-2.5 rounded-md border border-warn/40 bg-warn-dim px-3.5 py-3 text-[13px] leading-normal text-fg">
          <span className="mt-px font-mono text-warn">!</span>
          <span>
            <span className="text-warn">Someone wants to check in with you.</span>{" "}
            If you accept, they will see your live camera and your live
            location for as long as you keep this page open. Only accept if you
            know who sent you this link.
          </span>
        </div>
        <h1 className="mb-2 text-balance text-[22px] font-bold leading-snug tracking-[-0.01em]">
          Accept this check-in?
        </h1>
        <p className="mb-4 text-pretty text-[14.5px] leading-normal text-muted">
          This turns on your camera and shares your GPS location. They cannot
          see anything until you tap Accept, and you can stop at any moment.
          Keep this screen on for the whole trip — browsers cannot share in the
          background after you leave the page.
        </p>
        {pinErr ? (
          <div className="mb-3.5 text-[13px] text-danger">{pinErr}</div>
        ) : null}
        <div className="flex gap-2.5">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await guestDeclineFn({ data: { id: sessionId } });
              setEndedTitle("Declined.");
              setEndedBody(
                "You declined. Your camera and location were never shared.",
              );
              setView("ended");
            }}
          >
            Decline
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              if (pinRequired) {
                setView("pin");
                return;
              }
              void beginSharing();
            }}
          >
            Accept & share
          </Button>
        </div>
      </Card>
    </AppShell>
  );
}
