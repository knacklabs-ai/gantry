# Gantry Web UI

## Scope

This directory contains the separately built Gantry React application. It is
served by the existing Gantry process at `/ui`; it is not a second runtime,
control plane, or authority surface.

Read the repository-level `AGENTS.md` first. This file adds web-specific rules.

## Current Phase Boundary

Phase 1 is static UI only. Do not add browser-to-server communication until a
dedicated browser identity and access design is approved.

- Do not add `fetch`, `EventSource`, `WebSocket`, API clients, bearer tokens,
  cookies/sessions, auth, pairing, CSRF, API proxies, or mock runtime data.
- Do not add TanStack Query, Table, Zod, forms, a router plugin, generated route
  tree, or a test dependency in Phase 1.
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
- Do not use mock runtime states. The Phase 1 status is truthfully `Not
  connected`.

## File And Change Discipline

- Keep every non-document UI source file at or below 350 lines. Split by
  responsibility before it grows beyond that limit.
- Make web edits one file at a time. Inspect the changed file before moving to
  the next one so ownership and review context stay clear.
- Prefer composition and explicit props over boolean-heavy components.
- Keep browser-only code in `apps/web`; static-host changes belong in
  `apps/core/src/control/server/` and must not import React code.
- Add dependencies only in the first approved phase that exercises them:
  Query/Table/Zod in Phase 2 and React Hook Form in Phase 3. Do not adopt
  TanStack Form, Store, DB, Virtual, Start, or `assistant-ui`.

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

Confirm Phase 1 has no `react-router`, Query, Table, Zod, forms, router plugin,
generated route tree, API client, SSE, WebSocket, or test dependency.

When the static host or workspace integration changes, also run:

```bash
npm run typecheck
npm run build
python3 .codex/scripts/check_architecture.py
python3 .codex/scripts/validate_artifacts.py --allow-missing-run
```

Manually check `/ui/`, `/ui/profile`, and an unknown extensionless `/ui/*`
route at 1440px, 1024px, and 390px in both themes. Automated UI tests and test
dependencies are deferred by user decision; do not add a test harness without
explicit approval.
