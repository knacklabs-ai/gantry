# Boondi lead taxonomy (canonical reference)

Single source of truth for how Boondi's CRM turns a conversation into **queries**
and **leads**. The operational copies are the background extractor's prompt
(`packages/mcp-crm/src/extractor/prompt.ts`) and the deterministic scorer
(`packages/mcp-crm/src/scoring.ts`); Boondi's conversational routing uses the same
definitions (`agents/boondi_support/SOUL.md` §9). Keep these in sync.

## Opportunity

One distinct order / purchase intent. A customer may have **several open at once**
(e.g. a Raksha Bandhan gift order and a separate quarterly office order) — each is
its own row, scored on its own merits.

## Query vs lead

- **Query** — soft, forward-looking interest in ordering, gifting, or a bigger
  plan; nothing decided yet ("might do Diwali boxes", "do you do corporate
  gifting?"). Worth capturing at any size.
- **Lead** — decided / strong intent, OR any strong-B2B signal below. A query
  becomes a lead as the customer qualifies.
- **Not an opportunity** — pure order support (tracking, "where's my order"),
  complaints, refunds/returns, out-of-scope chatter. Never captured.

## Strong-B2B signals (any ONE promotes a query to a lead)

- 25+ pieces
- total budget over ~₹10,000
- a corporate (company-domain) email
- delivery across multiple cities / pan-India
- timeline under one week

## Captured fields (extracted from the conversation — not asked as a form)

- `intentCategory`: `shopping` | `gifting_personal` | `gifting_b2b` | `corporate` | `reorder` | `other`
- `occasion` (free text)
- `quantity` (number) + `quantityRaw`
- `budgetPerGiftInr` or `budgetTotalInr` (+ `budgetRaw`; `budgetUndecided`)
- `locations` (single string) + `locationScope`: `single` | `multi_drop_city` | `multi_city` | `pan_india`
- `timeline` (+ `timelineDays`; `timelineExploring`)
- `buyerType`: `personal` | `wedding_event` | `small_business` | `employee_gifting` | `client_vip_procurement`
- `customisation`: `none` | `note_card` | `logo` | `custom_packaging` | `bespoke`
- contact: `contactEmail` / `contactPhone` (`contactQuality` is derived deterministically)

## Scoring (Blueprint v3 — deterministic, leads only)

Computed in `scoring.ts` from the fields above: 7 dimensions summing to 100, banded
**P1** 85–100 · **P2** 70–84 · **P3** 50–69 · **P4** 25–49 · **P5** 0–24. Queries
are not scored. The LLM extracts fields only; code does the scoring.
