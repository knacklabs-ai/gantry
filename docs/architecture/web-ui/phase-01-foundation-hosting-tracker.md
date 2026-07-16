# Phase 1: Static Foundation Tracker

Branch: `feature/gantry-web-ui-initiate`
Status: Phase 1 acceptance complete; automated UI release gate deferred
Automated UI tests: Deferred by user decision; this phase is not release-gate complete until test work is approved.

| Packet | Scope | Status | Evidence | Commit |
| --- | --- | --- | --- | --- |
| P0 | Scope docs and tracker | Complete | Static-only plan and tracker revised | Uncommitted |
| P1 | Web workspace and dependencies | Complete | `apps/web` Vite/React/TypeScript workspace with code-defined TanStack Router, Tailwind v4, and HMR disabled | Uncommitted |
| P2 | Tokens, primitives, shell, and preferences | Complete | Tailwind shell, mobile drawer, theme and motion preferences | Uncommitted |
| P3 | Static hosting and runtime packaging | Complete | `npm run build` copies `apps/web/dist` to `dist/ui`; Control server mounts `/ui` | Uncommitted |
| P4 | Manual responsive and route verification | Complete | Rendered development and production bundles at 1440px, 1024px, and 390px with no console errors or horizontal overflow | Uncommitted |
| P5 | Cleanup and handoff | Complete with baseline gates recorded | Browser-transport search and `git diff --check` are clean | Uncommitted |

## Evidence Log

| Date | Packet | Result | Notes |
| --- | --- | --- | --- |
| 2026-07-15 | P0 | Complete | Static-only boundary replaces pairing and browser transport work. |
| 2026-07-15 | P1 | Complete | Installed Vite, React, TanStack Router, Lucide, Radix Dialog, Tailwind v4, and self-hosted Spline fonts. Query, Table, Zod, forms, and router generation remain deferred. |
| 2026-07-15 | P2 | Complete | Implemented the Home and Profile shell, desktop navigation, mobile drawer, theme, and reduced-motion preferences. |
| 2026-07-15 | P3 | Complete | `npm run build:web`, `npm run typecheck`, and `npm run build` passed; production assets were copied into `dist/ui`. |
| 2026-07-15 | P4 | Partial | Vite route checks passed. Full visual review at 1440px, 1024px, and 390px remains a manual sign-off. |
| 2026-07-15 | P5 | Complete | Targeted web lint, typecheck, format check, build, cleanup search, and `git diff --check` passed. Root lint and architecture checks remain blocked by pre-existing core findings. |
| 2026-07-15 | P1 | Complete | Replaced React Router with the registered, code-defined TanStack Router tree; no router plugin, generated tree, Query, Table, Zod, forms, API client, or event transport was added. |
| 2026-07-15 | P4 | Partial | Restarted Vite with HMR disabled and confirmed direct `/ui/`, `/ui/profile`, and unknown `/ui/*` HTTP routes return 200. Visual sign-off remains manual. |
| 2026-07-15 | P4 | Complete | Repaired duplicate React runtime resolution. Verified rendered shell, Profile navigation, preference persistence, mobile drawer, and 1440px/1024px/390px layouts in development; production bundle rendered without console errors. |

## Blockers And Deferred Work

- Browser identity, authentication, pairing, REST, SSE, WebSockets, browser API
  clients, and runtime data require a separate approved browser-access design.
- Automated UI tests and the test harness are deferred by user direction.
- `npm run lint` is blocked by eight existing core errors outside this change.
- `python3 .codex/scripts/check_architecture.py` is blocked by one pre-existing
  file-size finding and three existing Telegram placement findings.
