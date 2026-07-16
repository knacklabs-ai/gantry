# Gantry Web UI

## Scope

This directory contains the separately built Gantry React application. It is
served by the existing Gantry process at `/ui`; it is not a second runtime,
control plane, or authority surface.

Read the repository-level `AGENTS.md` first. This file adds web-specific rules.

## Current Delivery Boundary

Build the complete interface with typed, visibly labeled preview data. Do not
add browser-to-server communication until identity and access are approved.

- Do not add `fetch`, `EventSource`, `WebSocket`, API clients, bearer tokens,
  cookies/sessions, auth, pairing, CSRF, or API proxies.
- Preview records are memory-only. The shell must show `Preview data` and `Not
connected` whenever they are visible.
- Local UI interactions may work. Server-owned commands must use the shared
  connection gate, issue no request, preserve local drafts, and never mutate
  preview records or show fake success.
- TanStack Query, Table, Zod, and React Hook Form are frontend infrastructure;
  they do not grant server authority or define public Gantry contracts.
- Do not change existing Control API authentication or add UI-specific Control
  API routes from this workspace.
- Browser storage is limited to the versioned
  `gantry.ui.preferences.v1` record with `theme` and `reduceMotion`.
- Vite HMR stays disabled so development introduces no browser WebSocket.
- Keep runtime truth in the future Control API. The browser must never access
  Postgres, `settings.yaml`, the filesystem, or provider credentials directly.

## Structure

```text
src/
  app/                    # Code-defined TanStack Router and persistent shell
  routes/                 # Route-level screens
  features/<feature>/     # Feature state and composition
  ui/primitives/          # Small reusable controls
  ui/compositions/        # Reusable multi-control states and layouts
  ui/rich/                # Channel-neutral rich interaction renderers
  ui/workflow/            # Shared workflow presentation components
  ui/lab/                 # Development-only component lab sections
  lib/<area>/             # Narrow browser-only helpers
  styles.css              # Tailwind import, semantic tokens, base rules only
```

Keep ownership clear. Do not introduce generic `common`, `misc`, or `utils`
folders, wrapper-only components, or a local component library for one use.

## UI And Styling Rules

- Use Tailwind CSS v4 utilities for all component styling. Do not add CSS
  Modules or component-specific stylesheet files.
- Use the handwritten TanStack Router tree in `src/app/router.tsx`. Do not add
  file-based routing, `@tanstack/router-plugin`, or `routeTree.gen.ts`.
- `src/styles.css` is the only stylesheet. It may define semantic theme tokens,
  font tokens, and global accessibility rules; it must not become a component
  styling bucket.
- Use semantic token utilities such as `bg-surface` and `text-text-secondary`.
  Do not scatter raw colour literals through JSX.
- Use self-hosted Spline Sans and Spline Sans Mono. Use Lucide for interface
  icons; icon-only controls need accessible labels and titles.
- Keep control and card radii at 8px or below, dimensions stable, keyboard
  focus visible, and both light/dark themes functional.
- Respect `prefers-reduced-motion` and the local reduce-motion preference.
- Use desktop, tablet, and mobile layouts intentionally. The desktop sidebar is
  232px; the mobile navigation is the Radix Dialog drawer.
- Preview data must be plausible, deterministic, redacted, and visibly
  non-live. Do not simulate runtime progress or terminal command success.

## File And Change Discipline

- Keep every non-document UI source file at or below 350 lines. Split by
  responsibility before it grows beyond that limit.
- Make web edits one file at a time. Inspect the changed file before moving to
  the next one so ownership and review context stay clear.
- Prefer composition and explicit props over boolean-heavy components.
- Keep browser-only code in `apps/web`; static-host changes belong in
  `apps/core/src/control/server/` and must not import React code.
- Add dependencies only when an implemented screen exercises them. Do not adopt
  TanStack Form, Store, DB, Virtual, Start, a global feature store, Storybook,
  a chart library, or `assistant-ui` without a measured need.

## Commands

Use the repository-supported Node version (`>=24 <26`).

```bash
npm run dev --workspace @gantry/web
npm run build:web
npm run typecheck:web
npm run lint:web
npm run format:check
```

Vite serves the local UI at `http://127.0.0.1:5173/ui/`. Production builds are
written to `apps/web/dist`, copied to `dist/ui`, and served by the Control
server at `/ui`.

## Verification

For web-only changes, run the smallest relevant checks first:

```bash
npm run typecheck:web
npm run lint:web
npm run build:web
git diff --check
```

Confirm there is no `react-router`, router plugin, generated route tree, API
client, SSE, WebSocket, browser credential, persisted Query cache, or test
dependency. Check every handwritten UI file remains at or below 350 lines.

When the static host or workspace integration changes, also run:

```bash
npm run typecheck
npm run build
python3 .codex/scripts/check_architecture.py
python3 .codex/scripts/validate_artifacts.py --allow-missing-run
```

Manually check every changed route at 1440px, 1024px, and 390px in both themes,
including keyboard focus, long content, drawers, dialogs, local drafts, and the
connection gate. Automated UI tests and test dependencies are deferred by user
decision; do not add a test harness without explicit approval.
