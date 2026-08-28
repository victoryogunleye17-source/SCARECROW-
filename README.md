# Scarecrow

Consent-based, one-way camera & location check-in.

- **You (admin)**: log into `/` with your phone number + username, generate a link.
- **Them (recipient)**: opens the link at `/join.html?s=...`, sees a plain consent screen, and only if they tap **Accept** does their camera + location start reaching you.
- **You never share your own camera or location** — the admin dashboard only ever *receives*.
- Every session and its data (offer/answer/location) auto-expires from the database after 6 hours.

## 1. Deploy

1. Push this folder to a **new GitHub repository** (private repo recommended, since env vars — not code — hold your credentials, but keep it private anyway).
2. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import that repo.
3. Framework preset: leave as **Other**. No build command needed — just deploy.

## 2. Create a free Upstash Redis database

This is where session/signaling/location data briefly lives (auto-deleted after 6h).

1. Go to [upstash.com](https://upstash.com) → sign up free → **Create Database** (Redis, any region close to you).
2. Open the database → copy the **REST URL** and **REST TOKEN**.

## 3. Set environment variables in Vercel

In your Vercel project → **Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `UPSTASH_REDIS_REST_URL` | from Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | from Upstash |
| `ADMIN_PHONE` | your phone number, e.g. `+2348012345678` |
| `ADMIN_USERNAME` | whatever username you want to log in with — pick your own, don't reuse it anywhere else |

Redeploy after adding these (Vercel → Deployments → ⋯ → Redeploy).

## 4. Use it

- Go to your deployed URL, sign in with the phone + username you set above.
- Tap **Generate check-in link**, copy it, send it yourself via WhatsApp/SMS/whatever you already trust.
- The moment the other person accepts, their camera feed and location start appearing on your dashboard automatically — no action needed on your end beyond waiting.
- Either side can end it anytime; it closes immediately for both.

## Notes on limits (read once)

- **The link is the credential.** Anyone holding it can open the consent screen. It's a long random token, but treat it like a password — send it privately, not in a public post.
- **"Hotspot-only" can't be enforced by a browser.** There's no reliable way for a webpage to detect hotspot vs. Wi-Fi vs. SIM data, so this app doesn't pretend to.
- **Video is peer-to-peer (WebRTC)** — it never touches your server. **Location and connection setup do pass through your Upstash database** as plain JSON for the ~6-hour session window, not a dedicated encrypted backend.
- This is a solid extra layer for casual safety check-ins. For genuinely high-risk use, pair it with an established plan (scheduled check-ins, a trusted contact tree, Signal) rather than relying on it alone.
