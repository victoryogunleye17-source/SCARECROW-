const { redis, requireAdmin, randId } = require("./_utils");

const TTL = 60 * 60 * 6; // sessions and all their data self-expire after 6 hours

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
    return res.status(200).json({ id: newId });
  }

  if (op === "whoami") {
    const ok = await requireAdmin(req);
    return res.status(200).json({ authed: ok });
  }

  if (!id) return res.status(400).json({ error: "missing id" });

  // --- status ---
  if (op === "status-get") {
    const raw = await redis.get(`sc:${id}:status`);
    return res.status(200).json({ status: raw ? JSON.parse(raw) : null });
  }
  if (op === "status-set") {
    const { value, by } = req.body;
    await redis.set(
      `sc:${id}:status`,
      JSON.stringify({ value, by, ts: Date.now() }),
      { ex: TTL }
    );
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
    return res.status(200).json({ ok: true });
  }
  if (op === "location-get") {
    const raw = await redis.get(`sc:${id}:location`);
    return res.status(200).json({ data: raw ? JSON.parse(raw) : null });
  }

  return res.status(400).json({ error: "unknown op" });
};
