const { Redis } = require("@upstash/redis");
const { randomBytes } = require("crypto");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
  automaticDeserialization: false, // we handle JSON ourselves, always as raw strings
});

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || "/"}`);
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  parts.push("HttpOnly");
  parts.push("Secure");
  parts.push(`SameSite=${opts.sameSite || "Lax"}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(res, name) {
  res.setHeader(
    "Set-Cookie",
    `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
  );
}

async function requireAdmin(req) {
  const cookies = parseCookies(req);
  const token = cookies.sc_admin;
  if (!token) return false;
  const val = await redis.get(`admin:token:${token}`);
  return !!val;
}

function randId(len = 20) {
  return randomBytes(len).toString("hex").slice(0, len);
}

module.exports = {
  redis,
  parseCookies,
  setCookie,
  clearCookie,
  requireAdmin,
  randId,
};
