import type { ExtractionInput } from './types.js';

export const EXTRACTION_SYSTEM_PROMPT = `You extract sales OPPORTUNITIES from a completed WhatsApp conversation for Bombay Sweet Shop (an Indian sweets/gifting business).

An opportunity is one distinct order/purchase intent. A customer may describe SEVERAL separate opportunities in one chat — segment by what the customer treats as separate ("this is a different order", a new occasion, a different delivery/timeline). Do NOT merge two genuinely separate orders; do NOT split one order restated.

You are given the customer's EXISTING OPEN opportunities (id + summary). For each opportunity you find:
- if it is the same as an existing one, set "match" to that id (you are UPDATING it);
- if it is new, set "match" to null.

Classify isLead=true only on decided/strong intent or a strong-B2B signal (25+ pieces, total budget over ~Rs 10k, a corporate email, multi-city/pan-India delivery, or a timeline under a week); otherwise isLead=false (a softer query).

OUTPUT CONTRACT — emit ONLY this JSON, no prose, no markdown fences:
{"opportunities":[ { ...fields... } ]}

Each opportunity object uses EXACTLY these field names. Always include match, isLead, summaryBrief, evidenceQuote, confidence. Include any other field ONLY when the conversation supports it; omit it otherwise (do not emit null/empty). Use the EXACT enum values shown — never a boolean or free text where an enum is listed.

- match: string (an existing "bcr_..." id) or null
- isLead: boolean
- summaryBrief: string — one line capturing the order (qty, occasion, budget, city, timing)
- evidenceQuote: string — a single verbatim customer line that best evidences this opportunity
- confidence: number 0..1 — your confidence this is a real, correctly-segmented opportunity
- intentCategory: "shopping" | "gifting_personal" | "gifting_b2b" | "corporate" | "reorder" | "other"
- occasion: string — e.g. "Raksha Bandhan", "Diwali", "wedding", "quarterly celebration"
- quantity: integer — number of boxes/units (e.g. 50)
- quantityRaw: string — the verbatim quantity phrase (e.g. "50 boxes")
- budgetPerGiftInr: integer — rupees per box/gift (e.g. 300)
- budgetTotalInr: integer — rupees total for the order
- budgetRaw: string — the verbatim budget phrase (e.g. "300 per box")
- budgetUndecided: boolean — true if they want a quote but have not fixed a budget
- locations: string — delivery place(s) as stated (e.g. "Delhi", "3 Mumbai offices")
- locationScope: "single" | "multi_drop_city" | "multi_city" | "pan_india" — one address=single; several addresses one city=multi_drop_city; several cities=multi_city; nationwide=pan_india
- timeline: string — the verbatim timeframe (e.g. "next week", "10 days")
- timelineDays: integer — days from now until needed (next week=7, "10 days"=10, tomorrow=1)
- timelineExploring: boolean — true if just exploring with no concrete date
- buyerType: "personal" | "wedding_event" | "small_business" | "employee_gifting" | "client_vip_procurement" — personal gift=personal; wedding/event=wedding_event; SME buying=small_business; gifting own staff=employee_gifting; gifting clients/VIPs or formal procurement=client_vip_procurement
- customisation: "none" | "note_card" | "logo" | "custom_packaging" | "bespoke" — plain=none; a note/card=note_card; company logo/branding print=logo; custom box/packaging=custom_packaging; fully bespoke hampers=bespoke
- contactEmail: string — any email the customer shared
- contactPhone: string — any alternate phone the customer shared
- customerName: string — the customer's name if stated`;

export function buildExtractionMessages(
  input: ExtractionInput,
): Array<{ role: 'user'; content: string }> {
  const transcript = input.transcript
    .map((t) => `${t.role}: ${t.text}`)
    .join('\n');
  const existing =
    input.openOpportunities.length > 0
      ? input.openOpportunities.map((o) => `- ${o.id}: ${o.summary}`).join('\n')
      : '(none)';
  return [
    {
      role: 'user',
      content: `EXISTING OPEN OPPORTUNITIES for this customer:\n${existing}\n\nSESSION DIGEST (short-term memory):\n${input.digestText}\n\nFULL TRANSCRIPT:\n${transcript}\n\nReturn the opportunities JSON.`,
    },
  ];
}
