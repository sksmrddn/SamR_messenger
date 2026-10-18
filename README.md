# SamR messenger

Private 1:1 video chat. No accounts, one-time link, end-to-end encrypted, everything wiped when either side leaves.
Runs on Cloudflare (Worker + Durable Object + static assets). Free plan works.

## Deploy
    npm install
    npx wrangler login
    npx wrangler deploy

Local test: `npx wrangler dev` (open two browser profiles on http://localhost:8787).

## Optional: hide both IP addresses (recommended)
Create a TURN key in Cloudflare dashboard (Realtime > TURN), then:
    npx wrangler secret put TURN_KEY_ID
    npx wrangler secret put TURN_KEY_API_TOKEN
With these set the app forces relay-only media. Without them, video goes peer-to-peer and each person's browser can see the other's IP.

## How it works
- Link = `/#<roomId>.<secret>`. The secret lives after `#`, so it never reaches the server.
- Each browser makes fresh ECDH keys; the secret authenticates them (HMAC), so a server in the middle can't swap keys. Session keys (AES-GCM, one per direction) exist only in memory.
- Chat, files and call signaling are encrypted before they reach the relay. Video/audio use WebRTC (DTLS-SRTP).
- The relay accepts exactly two sockets. Any disconnect deletes the room and leaves a tombstone (24h) so the link can't be reused. Unclaimed links expire after 30 min.
- Session ends on: End chat, tab close/refresh, connection drop, or camera/mic revoked. Tab switching does not end it.
- Strict CSP, no third-party scripts, nothing stored in the browser.
