---
name: setup-mini-app
description: Interactive setup wizard for the Telegram Mini App (plan review UI). Walks users through BotFather registration, frontend deployment, API tunnel, and env configuration. Use when the user asks to set up or configure the Mini App, or when MINI_APP_ENABLED is not set.
user_invocable: true
---

# /setup-mini-app

Interactive setup for the MyClaw Telegram Mini App. This skill guides the user step-by-step through everything needed to get the plan review UI working in Telegram.

## Prerequisites

Before starting, verify:
- MyClaw is installed and running (`node dist/index.js` or `npm run dev`)
- A Telegram bot exists with a valid `TELEGRAM_BOT_TOKEN` in `.env`
- Node.js 20+ is available

## Steps

### Step 1: Check current state

Read the `.env` file at the MyClaw root (`$AGENT_ROOT/.env` or `~/myclaw/.env`). Check which of these are already configured:

- `MINI_APP_ENABLED`
- `MINI_APP_FRONTEND_URL`
- `MINI_APP_API_URL`
- `MINI_APP_CORS_ORIGIN`
- `MINI_APP_SHORT_NAME`

If all five are set and `MINI_APP_ENABLED=true`, tell the user the Mini App is already configured and ask if they want to reconfigure. If not, skip to Step 7 (test).

Also check:
- Is `cloudflared` installed? Run `which cloudflared`.
- Is `wrangler` available? Run `npx wrangler --version`.
- Is the `apps/mini-app/` directory present? If not, the user needs a MyClaw version that includes it.

Report what's already done and what's missing before proceeding.

### Step 2: BotFather — Register the Mini App

Tell the user to open [@BotFather](https://t.me/BotFather) in Telegram and walk them through these steps:

1. Send `/mybots` and select their bot
2. Go to **Bot Settings** → **Mini App** (or send `/newapp` to BotFather)
3. Follow BotFather's prompts:
   - **Title**: `Plans` (or their preference)
   - **Description**: `Review and approve agent plans`
   - **Photo**: Any 640x360 image (required by BotFather)
   - **GIF**: Send `/empty` to skip
   - **Web App URL**: They'll fill this after Step 3 — tell them to use a placeholder like `https://example.com` for now, they can update it later with `/editapp`
   - **Short Name**: `plans` (recommend this default — it becomes `t.me/<bot_username>/plans`)

4. Ask the user for:
   - Their **bot username** (e.g., `my_ai_bot`)
   - The **short name** they chose (e.g., `plans`)

Store these — needed for `MINI_APP_SHORT_NAME` in Step 5.

Also set up the **Menu Button**:
1. In BotFather, go to **Bot Settings** → **Menu Button** → **Configure Menu Button**
2. URL: the frontend URL from Step 3 (update later if not yet deployed)
3. Button text: `Plans`

### Step 3: Deploy frontend to Cloudflare Pages

#### Install wrangler if needed

```bash
npm install -g wrangler
```

#### Login to Cloudflare

```bash
npx wrangler login
```

This opens a browser for OAuth. Wait for the user to complete it.

#### Create the Pages project (first time only)

Ask the user for a project name (default: `myclaw-mini-app`).

```bash
npx wrangler pages project create <project-name> --production-branch main
```

If the project already exists, skip this step.

#### Build the frontend

The `VITE_API_URL` must be set at build time — it gets baked into the JS bundle. If the user doesn't have a tunnel URL yet (Step 4), build without it for now and rebuild later.

```bash
cd apps/mini-app
VITE_API_URL=<tunnel-url-if-known> npx vite build
```

#### Deploy

```bash
npx wrangler pages deploy dist --project-name <project-name>
```

Note the production URL (e.g., `https://myclaw-mini-app.pages.dev`). This is the `MINI_APP_FRONTEND_URL`.

#### Ensure SPA routing works

Check that `apps/mini-app/public/_redirects` exists with:
```
/*    /index.html   200
```

If missing, create it and redeploy.

### Step 4: Set up the API tunnel

The Mini App API runs on `localhost:3100` inside MyClaw. Telegram requires HTTPS, so it must be exposed via a tunnel.

#### Install cloudflared if needed

```bash
# Mac
brew install cloudflared

# Linux
# See https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

#### Start a quick tunnel

```bash
cloudflared tunnel --url http://localhost:3100
```

This prints a URL like `https://some-words.trycloudflare.com`. This is the `MINI_APP_API_URL`.

Tell the user: quick tunnel URLs change on every restart. For a stable URL, they can create a named tunnel later. For now, the quick tunnel works.

#### Verify the tunnel

```bash
curl -s -o /dev/null -w "%{http_code}" <tunnel-url>/api/health
```

Should return `200`. If MyClaw isn't running yet with `MINI_APP_ENABLED=true`, it may return an error — that's fine, we'll set the env vars next.

### Step 5: Configure environment variables

Add or update these in the MyClaw `.env` file:

```env
MINI_APP_ENABLED=true
MINI_APP_FRONTEND_URL=https://<project-name>.pages.dev
MINI_APP_API_URL=https://<tunnel-url>.trycloudflare.com
MINI_APP_CORS_ORIGIN=https://<project-name>.pages.dev
MINI_APP_SHORT_NAME=plans
```

Use the actual values collected from Steps 2-4.

After writing the env vars, tell the user to **restart MyClaw** for the changes to take effect. If you have access to the process, offer to restart it.

### Step 6: Rebuild frontend with API URL

If the frontend was built without `VITE_API_URL` in Step 3 (because the tunnel wasn't ready yet), rebuild and redeploy now:

```bash
cd apps/mini-app
VITE_API_URL=https://<tunnel-url>.trycloudflare.com npx vite build
npx wrangler pages deploy dist --project-name <project-name>
```

Also update the BotFather Web App URL if a placeholder was used:
1. Open @BotFather → `/mybots` → select bot → **Bot Settings** → **Mini App** → **Edit Web App URL**
2. Send the actual frontend URL: `https://<project-name>.pages.dev`

And update the Menu Button URL the same way.

### Step 7: Test the setup

#### API health check

```bash
curl https://<tunnel-url>.trycloudflare.com/api/health
```

Should return `200`.

#### Create a test plan

Use the `create_plan` MCP tool (or IPC) to create a test plan targeting the user's chat. The plan review message should appear in Telegram with a **"Review Plan" button** (not a plain URL).

#### Verify Mini App opens

Ask the user to:
1. Tap the "Review Plan" button in Telegram
2. The Mini App should open and show the plan sections
3. They should be able to approve/reject sections without errors

If they get a 401 error, the `telegram-web-app.js` script may be missing from `index.html` or the tunnel is down.

### Step 8: Report results

Summarize what was configured:
- Frontend URL
- API tunnel URL
- Bot username and Mini App short name
- Whether the test plan worked

Warn about:
- Quick tunnel URLs change on restart — rebuild frontend when the URL changes
- `initData` expires after 1 hour — reopen from Telegram if auth fails
- The Mini App only works when opened from Telegram (not a regular browser)

## Troubleshooting

If the user reports issues during setup, check these:

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Plain URL instead of button in group chat | `MINI_APP_SHORT_NAME` not set or MyClaw not restarted | Set the env var and restart |
| 401 in Mini App | `telegram-web-app.js` missing from `index.html` | Check `apps/mini-app/index.html` has `<script src="https://telegram.org/js/telegram-web-app.js"></script>` in `<head>` |
| "The string did not match the expected pattern" | `VITE_API_URL` not baked in or tunnel down | Rebuild frontend with correct URL, verify tunnel is running |
| CORS error | `MINI_APP_CORS_ORIGIN` doesn't match frontend URL | Must be exact match including protocol, no trailing slash |
| Wrangler auth expired | OAuth token expires periodically | Run `npx wrangler login` again |
| `BUTTON_TYPE_INVALID` from Telegram API | Using `web_app` button in a group chat | This is handled automatically — ensure MyClaw is running latest code with `MINI_APP_SHORT_NAME` set |
| Blank page after deploy | SPA routing not configured | Ensure `public/_redirects` has `/* /index.html 200` |
