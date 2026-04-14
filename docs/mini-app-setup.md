# MyClaw Mini App — Setup Guide

End-to-end setup for the Telegram Mini App (plan review UI). Takes ~15 minutes.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| MyClaw running | `npm run dev` or `node dist/index.js` |
| Telegram Bot | Created via @BotFather with a valid `TELEGRAM_BOT_TOKEN` |
| Node.js 20+ | For building the frontend |
| Cloudflare account | Free tier, for Pages deployment |
| `cloudflared` CLI | `brew install cloudflared` (Mac) or [download](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) |
| `wrangler` CLI | `npm install -g wrangler` — Cloudflare Pages deploy tool |

---

## Step 1: Register Mini App with BotFather

1. Open Telegram, go to [@BotFather](https://t.me/BotFather)
2. Send `/mybots` → select your bot
3. Tap **Bot Settings** → **Menu Button** → **Configure Menu Button**
4. Send the frontend URL (you'll set this in Step 3): `https://<your-project>.pages.dev`
5. Send the button text: `Plans`
6. Go back to **Bot Settings** → **Mini App** (or send `/newapp`)
7. Follow the prompts:
   - **Title**: `Plans` (or whatever you prefer)
   - **Description**: `Review and approve agent plans`
   - **Photo**: Upload any 640x360 image (app preview)
   - **GIF**: Skip (send `/empty`)
   - **Web App URL**: `https://<your-project>.pages.dev`
   - **Short Name**: `plans` (this becomes `t.me/<bot_username>/plans`)
8. Note down your **bot username** and **short name** — you'll need them for config

Your Mini App is now accessible at `https://t.me/<bot_username>/plans`.

---

## Step 2: Deploy Frontend to Cloudflare Pages

### First-time setup

```bash
# Login to Cloudflare (opens browser for OAuth)
wrangler login

# Create the Pages project (one-time)
wrangler pages project create myclaw-mini-app --production-branch main
```

### Build and deploy

```bash
cd apps/mini-app

# Build with your API URL baked in (see Step 3 for the URL)
VITE_API_URL=https://<your-tunnel>.trycloudflare.com npx vite build

# Deploy to Cloudflare Pages
wrangler pages deploy dist --project-name myclaw-mini-app
```

Your frontend is now live at `https://myclaw-mini-app.pages.dev`.

> **SPA routing**: The `public/_redirects` file (`/* /index.html 200`) ensures client-side routing works on Cloudflare Pages.

---

## Step 3: Start API Tunnel

MyClaw's API server runs on `localhost:3100`. Telegram Mini Apps require HTTPS, so you expose it via a Cloudflare quick tunnel:

```bash
# Install cloudflared (Mac)
brew install cloudflared

# Start a quick tunnel (no account needed)
cloudflared tunnel --url http://localhost:3100
```

This prints a random URL like `https://some-words.trycloudflare.com`. Copy it — this is your `MINI_APP_API_URL`.

> **Note**: Quick tunnel URLs change on restart. For a stable URL, create a [named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/) or use a custom domain.

---

## Step 4: Configure Environment Variables

Add these to your `~/.myclaw/.env` (or wherever your MyClaw `.env` lives):

```env
# Enable the Mini App API server
MINI_APP_ENABLED=true

# Public URL of the frontend (Cloudflare Pages)
MINI_APP_FRONTEND_URL=https://myclaw-mini-app.pages.dev

# Public URL of the API tunnel (from Step 3)
MINI_APP_API_URL=https://some-words.trycloudflare.com

# CORS origin — must match the frontend URL
MINI_APP_CORS_ORIGIN=https://myclaw-mini-app.pages.dev

# BotFather Mini App short name (from Step 1)
MINI_APP_SHORT_NAME=plans
```

### Optional variables

```env
# API server bind address (default: 0.0.0.0)
MINI_APP_HOST=0.0.0.0

# API server port (default: 3100)
MINI_APP_PORT=3100
```

After updating `.env`, **restart MyClaw** to pick up the changes.

---

## Step 5: Rebuild Frontend (if tunnel URL changed)

The `VITE_API_URL` is baked into the frontend at build time. If your tunnel URL changes, rebuild and redeploy:

```bash
cd apps/mini-app
VITE_API_URL=https://new-tunnel-url.trycloudflare.com npx vite build
wrangler pages deploy dist --project-name myclaw-mini-app
```

---

## Step 6: Test the Flow

### Quick test via API

```bash
# Health check (should return 200)
curl https://<your-tunnel>.trycloudflare.com/api/health

# Plans list (should return 401 — auth required)
curl https://<your-tunnel>.trycloudflare.com/api/plans
```

### Full test via Telegram

1. Open your bot in Telegram (any chat where the bot is active)
2. Ask the agent to create a plan — e.g., "Plan how to add dark mode support"
3. The bot sends a message with a **"Review Plan"** button
4. Tap the button — the Mini App opens with plan sections
5. Approve, reject, or edit sections
6. The agent receives your feedback in real-time via SSE

### Direct access

Open `https://t.me/<bot_username>/plans` in Telegram to access the Mini App directly. The home page shows all active plans.

---

## How It Works

```
User taps "Review Plan" button in Telegram
        │
        ▼
Telegram opens Mini App via t.me/bot/plans?startapp=<planId>
        │
        ▼
Frontend reads startapp param → navigates to /plans/<planId>
        │
        ▼
Frontend sends API request with Telegram initData header
        │
        ▼
API server validates initData (HMAC-SHA-256 with bot token)
        │
        ▼
API returns plan data → UI renders sections
        │
        ▼
User approves/rejects/edits sections
        │
        ▼
API writes plan events → IPC watcher routes to agent
        │
        ▼
Agent processes feedback → updates plan → SSE pushes to UI
```

### Authentication

The Mini App uses Telegram's built-in auth. When Telegram opens the app, it injects `initData` — a signed payload containing:
- User ID, username, first name
- Chat info
- Timestamp + HMAC-SHA-256 hash (signed with bot token)

The API server validates this signature on every request. No passwords or tokens needed — Telegram handles identity.

`initData` expires after **1 hour**. If you get a 401 error, close and reopen the Mini App from Telegram.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Plain URL instead of button | `web_app` buttons don't work in groups | Ensure `MINI_APP_SHORT_NAME` is set — the bot uses `t.me` deep links in group chats |
| 401 error in Mini App | Missing or expired `initData` | Reopen the Mini App from Telegram (not a browser) |
| "The string did not match the expected pattern" | API URL unreachable or invalid | Check `VITE_API_URL` is correct, tunnel is running, rebuild frontend |
| CORS error in console | `MINI_APP_CORS_ORIGIN` doesn't match frontend URL | Set `MINI_APP_CORS_ORIGIN` to your exact Pages URL |
| Mini App shows blank page | SPA routing broken | Ensure `public/_redirects` exists with `/* /index.html 200` |
| Button works in DMs but not groups | `web_app` type vs `url` type | This is fixed — the bot auto-detects chat type and uses the right button |
| Tunnel URL changed | Quick tunnels are ephemeral | Rebuild frontend with new `VITE_API_URL` and redeploy |

---

## File Reference

| File | Purpose |
|------|---------|
| `apps/mini-app/` | React frontend (Vite + TypeScript) |
| `apps/mini-app/index.html` | Entry HTML — includes `telegram-web-app.js` |
| `apps/mini-app/src/api/client.ts` | API client — resolves API base from `VITE_API_URL` or `?api=` param |
| `apps/mini-app/src/App.tsx` | Router — handles `startapp` redirect |
| `apps/mini-app/src/hooks/usePlan.ts` | Plan data + SSE reconnect with backoff |
| `apps/mini-app/src/lib/telegram.ts` | Telegram WebApp helpers (haptics, back button, initData) |
| `apps/core/src/mini-app/server.ts` | Fastify API server (port 3100) |
| `apps/core/src/mini-app/init-data.ts` | Telegram initData HMAC-SHA-256 validation |
| `apps/core/src/mini-app/plan-store.ts` | Plan CRUD (JSON file storage) |
| `apps/core/src/channels/telegram.ts` | Bot integration — sends plan review buttons |
| `apps/core/src/core/config.ts` | All `MINI_APP_*` config exports |
