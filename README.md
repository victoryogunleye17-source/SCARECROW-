# Scarecrow

Consent-based, one-way camera and location check-in for a timed trip.

- You (admin) sign in, pick 2 / 4 / 8 hours, generate a link.
- They open `/join?s=…`, tap Accept, and keep that screen on.
- You receive their camera and GPS. Yours never go out.
- Last known location is kept 24 hours after the session ends or the phone drops.
- GPS is not stored in long-lived history.

## Vercel environment variables

| Name | Required | Purpose |
|---|---|---|
| `ADMIN_PHONE` | yes in production | Admin login phone |
| `ADMIN_USERNAME` | yes in production | Admin login username |
| `ADMIN_PASSWORD` | yes in production | Admin login password |
| `UPSTASH_REDIS_REST_URL` | yes in production | Session / signaling store |
| `UPSTASH_REDIS_REST_TOKEN` | yes in production | Session / signaling store |
| `TURN_URLS` | recommended | Comma-separated TURN URLs so video works on mobile data |
| `TURN_USERNAME` | with TURN | TURN username |
| `TURN_CREDENTIAL` | with TURN | TURN credential |
| `AUTH_SECRET` | recommended | Extra pepper for PIN / token hashes |

Until `ADMIN_PASSWORD` is set, preview login is `+2340000000000` / `admin` / `scarecrow-preview`.

Create a free Redis database at [upstash.com](https://upstash.com). For TURN, a free Metered or Twilio TURN account is enough — STUN alone often fails on mobile networks.

## Limits

The link is the credential. Sharing only lasts while their page stays open, up to the trip timer. This is not background tracking, and it is not a substitute for a vetted safety plan.
