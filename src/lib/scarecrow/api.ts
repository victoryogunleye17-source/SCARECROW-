import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SignalField } from "./types";

const idSchema = z.object({ id: z.string().min(1) });
const signalField = z.enum(["offer", "answer", "cand:host", "cand:guest"]);

export const whoamiFn = createServerFn({ method: "GET" }).handler(async () => {
  const { isAdmin, authConfig } = await import("./auth.server");
  const cfg = authConfig();
  return { authed: await isAdmin(), ...cfg };
});

export const loginFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      phone: z.string(),
      username: z.string(),
      password: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const { loginAdmin } = await import("./auth.server");
    return loginAdmin(data);
  });

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  const { logoutAdmin } = await import("./auth.server");
  await logoutAdmin();
  return { ok: true as const };
});

export const createSessionFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      durationHours: z.number(),
      normalPin: z.string().optional(),
      duressPin: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { createSession } = await import("./session.server");
    return createSession(data);
  });

export const historyListFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const { historyList } = await import("./session.server");
    return historyList();
  },
);

export const historyClearFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const { historyClear } = await import("./session.server");
    return historyClear();
  },
);

export const publicStatusFn = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const { publicStatus } = await import("./session.server");
    return publicStatus(data.id);
  });

export const guestStartFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1), pin: z.string().optional() }))
  .handler(async ({ data }) => {
    const { guestStart } = await import("./session.server");
    return guestStart(data);
  });

export const guestDeclineFn = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const { guestDecline } = await import("./session.server");
    return guestDecline(data.id);
  });

export const guestPanicFn = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const { guestPanic } = await import("./session.server");
    return guestPanic(data.id);
  });

export const endSessionFn = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const { endSession } = await import("./session.server");
    return endSession(data.id);
  });

export const guestPingFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().min(1),
      location: z
        .object({
          lat: z.number(),
          lng: z.number(),
          acc: z.number(),
          ts: z.number(),
        })
        .nullable()
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { guestPing } = await import("./session.server");
    return guestPing(data);
  });

export const hostSnapshotFn = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const { hostSnapshot } = await import("./session.server");
    return hostSnapshot(data.id);
  });

export const guestSnapshotFn = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const { guestSnapshot } = await import("./session.server");
    return guestSnapshot(data.id);
  });

export const signalSetFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().min(1),
      field: signalField,
      data: z.any(),
    }),
  )
  .handler(async ({ data }) => {
    const { signalSet } = await import("./session.server");
    return signalSet({
      id: data.id,
      field: data.field as SignalField,
      data: data.data,
    });
  });

export const signalGetFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1), field: signalField }))
  .handler(async ({ data }) => {
    const { signalGet } = await import("./session.server");
    return signalGet({ id: data.id, field: data.field as SignalField });
  });

export const chatSendFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1), text: z.string() }))
  .handler(async ({ data }) => {
    const { chatSend } = await import("./session.server");
    return chatSend(data);
  });

export const iceServersFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const { iceServers } = await import("./session.server");
    return { iceServers: iceServers() };
  },
);
