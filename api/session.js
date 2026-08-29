const { createHash } = require("crypto");
const { redis, requireAdmin, randId } = require("./_utils");

const TTL = 60 * 60 * 6; // sessions and all their data self-expire after 6 hours

function hashPin(pin, id) {
  return createHash("sha256").update(`${pin}:${id}`).digest("hex");
}

async function upsertHistory(id, patch) {
  const raw = await redis.hget("admin:history", id);
  const rec = raw ? JSON.parse(raw) : { id };
  Object.assign(rec, patch);
  await redis.hset("admin:history", { [id]: JSON.stringify(rec) });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "method not allowed" });
  const { op, id } = req.body || {};

  // --- ops that don't need a session id ---
  if (op === "create") {
    if (!(await requireAdmin(req)))
      return res.status(401).json({ error: "not authorized" });
    const newId = randId(22);
    await redis.set(
      `sc:${newId}:status`,
      JSON.stringify({ value: "pending" }),
      { ex: TTL }
    );
    await upsertHistory(newId, {
      id: newId,
      createdAt: Date.now(),
      status: "pending",
    });

    const { normalPin, duressPin } = req.body;
    if (normalPin && duressPin) {
      await redis.set(
        `sc:${newId}:pins`,
        JSON.stringify({
          normalHash: hashPin(normalPin, newId),
          duressHash: hashPin(duressPin, newId),
        }),
        { ex: TTL }
      );
    }
    return res.status(200).json({ id: newId });
  }

  if (op === "whoami") {
    const ok = await requireAdmin(req);
    return res.status(200).json({ authed: ok });
  }

  if (op === "history-list") {
    if (!(await requireAdmin(req)))
      return res.status(401).json({ error: "not authorized" });
    const raw = await redis.hgetall("admin:history");
    const list = Object.values(raw || {})
      .map((v) => {
        try {
          return JSON.parse(v);
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return res.status(200).json({ history: list });
  }
  if (op === "history-clear") {
    if (!(await requireAdmin(req)))
      return res.status(401).json({ error: "not authorized" });
    await redis.del("admin:history");
    return res.status(200).json({ ok: true });
  }

  // --- PIN check (guest side, no admin auth needed — the link is the credential) ---
  if (op === "pin-required") {
    if (!id) return res.status(400).json({ error: "missing id" });
    const raw = await redis.get(`sc:${id}:pins`);
    return res.status(200).json({ required: !!raw });
  }
  if (op === "pin-check") {
    if (!id) return res.status(400).json({ error: "missing id" });
    const { pin } = req.body;
    const raw = await redis.get(`sc:${id}:pins`);
    if (!raw) return res.status(200).json({ result: "normal" }); // no PINs configured, nothing to check
    const { normalHash, duressHash } = JSON.parse(raw);
    const h = hashPin(pin || "", id);
    if (h === normalHash) return res.status(200).json({ result: "normal" });
    if (h === duressHash) return res.status(200).json({ result: "duress" });
    return res.status(200).json({ result: "invalid" });
  }

  if (!id) return res.status(400).json({ error: "missing id" });

  // --- status ---
  if (op === "status-get") {
    const raw = await redis.get(`sc:${id}:status`);
    return res.status(200).json({ status: raw ? JSON.parse(raw) : null });
  }
  if (op === "status-set") {
    const { value, by, duress } = req.body;
    await redis.set(
      `sc:${id}:status`,
      JSON.stringify({ value, by, duress: !!duress, ts: Date.now() }),
      { ex: TTL }
    );
    const patch = { status: value, duress: !!duress };
    if (value === "ended" || value === "declined") patch.endedAt = Date.now();
    await upsertHistory(id, patch);
    return res.status(200).json({ ok: true });
  }

  // --- WebRTC signaling relay (offer / answer / ICE candidates) ---
  if (op === "signal-set") {
    const { field, data } = req.body; // field: 'offer' | 'answer' | 'cand:host' | 'cand:guest'
    if (field === "cand:host" || field === "cand:guest") {
      await redis.rpush(`sc:${id}:${field}`, JSON.stringify(data));
      await redis.expire(`sc:${id}:${field}`, TTL);
    } else if (field === "offer" || field === "answer") {
      await redis.set(`sc:${id}:${field}`, JSON.stringify(data), { ex: TTL });
    } else {
      return res.status(400).json({ error: "bad field" });
    }
    return res.status(200).json({ ok: true });
  }
  if (op === "signal-get") {
    const { field } = req.body;
    if (field === "cand:host" || field === "cand:guest") {
      const list = await redis.lrange(`sc:${id}:${field}`, 0, -1);
      return res
        .status(200)
        .json({ data: (list || []).map((x) => JSON.parse(x)) });
    }
    if (field === "offer" || field === "answer") {
      const raw = await redis.get(`sc:${id}:${field}`);
      return res.status(200).json({ data: raw ? JSON.parse(raw) : null });
    }
    return res.status(400).json({ error: "bad field" });
  }

  // --- location: guest only ever writes this; admin only ever reads it ---
  if (op === "location-set") {
    const { data } = req.body;
    await redis.set(`sc:${id}:location`, JSON.stringify(data), { ex: TTL });
    await upsertHistory(id, { lastLocation: data });
    return res.status(200).json({ ok: true });
  }
  if (op === "location-get") {
    const raw = await redis.get(`sc:${id}:location`);
    return res.status(200).json({ data: raw ? JSON.parse(raw) : null });
  }

  if (op === "chat-send") {
    const { from, text } = req.body;
    if (!text || !text.trim())
      return res.status(400).json({ error: "empty message" });
    const msg = { from, text: text.trim().slice(0, 500), ts: Date.now() };
    await redis.rpush(`sc:${id}:chat`, JSON.stringify(msg));
    await redis.ltrim(`sc:${id}:chat`, -200, -1);
    await redis.expire(`sc:${id}:chat`, TTL);
    return res.status(200).json({ ok: true });
  }
  if (op === "chat-get") {
    const list = await redis.lrange(`sc:${id}:chat`, 0, -1);
    return res
      .status(200)
      .json({ messages: (list || []).map((x) => JSON.parse(x)) });
  }

  return res.status(400).json({ error: "unknown op" });
};
