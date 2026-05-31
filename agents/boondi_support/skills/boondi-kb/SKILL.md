---
name: boondi-kb
description: Bombay Sweet Shop knowledge base — return policy, store info, allergens, active discount codes, seasonal catalogue notes. Use whenever a customer asks a policy or store-info question, or when recommending products by occasion or dietary need.
user_invocable: false
---

# Bombay Sweet Shop — Customer Care Knowledge Base

This skill is the source-of-truth for policy, store, and product-care answers
that Boondi gives without going to Shopify. Fill in the bracketed sections with
content from BSS before going live.

## Return policy

[TO BE FILLED BY BSS]

- Return window: [number of days]
- Perishable exceptions: [e.g. mithai categories with shorter window]
- Damaged or wrong items: escalate to human team within 5 minutes (chat) or
  60 seconds (voice). Boondi never approves refunds — only escalates with full
  Shopify context.
- Refund timing: [number of days after approval]

## Store locations & hours

[TO BE FILLED BY BSS]

- Bandra: [address], [hours]
- [Other locations]

## Allergens (per product category)

Use this when an Anxious Detail-Seeker asks. If the question is clinically
specific (e.g. cross-contamination, severe allergy), escalate to a human.

- Kaju Katli — contains tree nuts (cashew).
- Motichoor Ladoo — contains dairy (ghee); typically gluten-free.
- Mango Barfi — contains dairy; check label for nut presence.
- [TO BE FILLED for the full catalogue.]

## Active discount codes

These are read by `validate_discount_code` for live validity. Listed here so
Boondi can answer "do you have any codes running?" without a tool call.

**[TO BE FILLED BY BSS — do not quote any code below to a customer without
confirming it with `validate_discount_code` first; the entries here are
placeholders, not live codes.]**

- _Example placeholder:_ `BSSDIWALI20` — 20% off, minimum order INR 1000.

## Seasonal catalogue notes

- Diwali — hampers, gift boxes, corporate options.
- Wedding — favour boxes, bulk discounts (B2C self-serve up to 24 pieces; 25+ goes to the gifting team).
- [Other festivals.]

## Currency

All prices are in INR (denoted with the Rupee symbol).

## Languages

English, Hindi, Hinglish. Match the customer's register — see SOUL.md §4 for the
Hinglish protocol.

## Brand voice samples

[TO BE FILLED BY BSS — three to five example replies in Boondi's voice across
shopping, order tracking, and complaint scenarios.]
