const { redis, setCookie, clearCookie, randId } = require("./_utils");

module.exports = async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "method not allowed" });
  const { action, phone, username } = req.body || {};

  if (action === "logout") {
    clearCookie(res, "sc_admin");
    return res.status(200).json({ ok: true });
  }

  if (action === "login") {
    const adminPhone = process.env.ADMIN_PHONE || "";
    const adminUser = process.env.ADMIN_USERNAME || "";

    if (!adminPhone || !adminUser) {
      return res
        .status(500)
        .json({
          error:
            "Admin login is not configured yet. Set ADMIN_PHONE and ADMIN_USERNAME in your Vercel project's environment variables.",
        });
    }

    const norm = (s) => (s || "").toString().replace(/[\s\-()]/g, "");

    if (
      norm(phone) !== norm(adminPhone) ||
      (username || "").trim() !== adminUser
    ) {
      // small delay to slow down guessing
      await new Promise((r) => setTimeout(r, 500));
      return res
        .status(401)
        .json({ error: "Phone number or username not recognized." });
    }

    const token = randId(48);
    await redis.set(`admin:token:${token}`, "1", { ex: 60 * 60 * 24 * 30 }); // 30 days
    setCookie(res, "sc_admin", token, { maxAge: 60 * 60 * 24 * 30 });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "unknown action" });
};
