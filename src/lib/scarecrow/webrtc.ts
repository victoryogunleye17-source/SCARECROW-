import type { IceServer, SignalField } from "./types";
import { signalGetFn, signalSetFn } from "./api";

export async function startHostPeer(
  id: string,
  iceServers: IceServer[],
  onTrack: (stream: MediaStream) => void,
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({ iceServers });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.ontrack = (ev) => {
    const stream = ev.streams[0] ?? new MediaStream([ev.track]);
    onTrack(stream);
  };
  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      void signalSetFn({
        data: { id, field: "cand:host", data: ev.candidate.toJSON() },
      });
    }
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await signalSetFn({ data: { id, field: "offer", data: offer } });
  return pc;
}

export async function startGuestPeer(
  id: string,
  iceServers: IceServer[],
  stream: MediaStream,
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({ iceServers });
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      void signalSetFn({
        data: { id, field: "cand:guest", data: ev.candidate.toJSON() },
      });
    }
  };
  return pc;
}

export async function pullSignals(
  pc: RTCPeerConnection,
  id: string,
  role: "host" | "guest",
  state: { appliedRemote: boolean; lastCand: number },
) {
  const remoteField: SignalField = role === "host" ? "answer" : "offer";
  const candField: SignalField = role === "host" ? "cand:guest" : "cand:host";

  if (!state.appliedRemote) {
    const remote = await signalGetFn({ data: { id, field: remoteField } });
    if (remote.ok && remote.payload) {
      const desc = JSON.parse(remote.payload) as RTCSessionDescriptionInit;
      if (!pc.currentRemoteDescription) {
        await pc.setRemoteDescription(desc);
        if (role === "guest") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await signalSetFn({ data: { id, field: "answer", data: answer } });
        }
        state.appliedRemote = true;
      }
    }
  }

  const cands = await signalGetFn({ data: { id, field: candField } });
  if (cands.ok && cands.payload) {
    const list = JSON.parse(cands.payload) as RTCIceCandidateInit[];
    if (Array.isArray(list)) {
      for (let i = state.lastCand; i < list.length; i++) {
        try {
          await pc.addIceCandidate(list[i]);
        } catch {
          /* candidate arrived early */
        }
      }
      state.lastCand = list.length;
    }
  }
}
