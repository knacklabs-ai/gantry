# Phase 1: Static Foundation Implementation Plan

## Goal

Deliver the visual and hosting foundation for the Gantry operator UI without
creating a browser-to-server authority path. The browser serves static assets,
owns appearance preferences, and has no runtime data, API client, SSE, WebSocket,
authentication, pairing, credential, or mock-data behavior.

## Delivery Packets

1. Confirm `feature/gantry-web-ui-initiate`, update the Phase 1 source docs, and
   create the tracker.
2. Add `apps/web` as a Vite/React workspace with a code-defined TanStack Router
   tree, Lucide, Radix dialog, Tailwind CSS v4, and self-hosted Spline fonts.
   Do not add a router plugin/generated route tree, Query, forms, tables, chat,
   API, auth, event, or test dependencies.
3. Build semantic theme, typography, spacing, control, focus, motion, and
   responsive tokens from the supplied prototype. Keep control and card radii at
   or below 8px.
4. Compose `/ui/` from an application shell, 232px desktop navigation, mobile
   dialog drawer, header, theme action, truthful `Not connected` status rail,
   and stable content area. Add `/ui/profile` for System/Light/Dark and reduced
   motion preferences. Create shared state compositions without rendering mock
   runtime data.
5. Build the workspace into `apps/web/dist`, copy it to `dist/ui`, and serve it
   from the existing Control server. Redirect `/ui` to `/ui/`; fall back to
   `index.html` only for extensionless `/ui/*` routes; never fall back for API,
   webhook, health, metrics, or missing asset paths.
6. Add strict static asset headers, including a self-only CSP, no-referrer,
   nosniff, immutable cache for hashed assets, and no-cache for HTML.
7. Record manual visual evidence and cleanup searches in the tracker. Automated
   UI tests remain deferred by user decision.

## UI Boundaries

- Storage: only `gantry.ui.preferences.v1` with `theme` and `reduceMotion`.
- Routing: TanStack Router uses `basepath: '/ui'`; `/profile` is served as
  `/ui/profile`. The handwritten tree is TypeScript-registered; file-based
  routing and generated route trees are excluded.
- Transport: no `fetch`, `EventSource`, `WebSocket`, API client, bearer token,
  cookie/session logic, or Vite API proxy. Disable Vite HMR so local development
  also introduces no browser WebSocket.
- Authority: existing Control API remains unchanged and inaccessible to React.

## Manual Acceptance

- Refresh `/ui/`, `/ui/profile`, and an extensionless unknown `/ui/*` route.
- Confirm `/v1/*` retains existing behavior and never returns the SPA.
- Check the shell at 1440px, 1024px, and 390px in both themes; verify drawer,
  keyboard focus, text wrapping, and reduced motion.
- Search for browser transport, credentials, and unexpected browser storage.
- Run `npm run build:web`, `npm run typecheck`, `npm run lint`, `npm run build`,
  `git diff --check`, architecture checks, and artifact validation. Do not run
  automated UI tests or add a test harness until approved.
