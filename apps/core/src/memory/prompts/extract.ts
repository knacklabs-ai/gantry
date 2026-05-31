export const MEMORY_EXTRACTION_SYSTEM_PROMPT = `You extract durable memory from a completed session arc between a user and an AI assistant.

A session arc is the full conversation between a session boundary (start, compact, end). You see what was attempted, what was decided, what worked, what didn't, and what the user corrected.

SAVE only statements that will be useful in a FUTURE session:
- preferences (how the user wants to be helped or interacted with)
- decisions (choices made, with why — must be explicit and land, not just floated)
- facts (stable facts about the user or their situation)
- corrections (what the user told the assistant to stop/start doing)
- constraints (rules that must always hold)

DO NOT SAVE:
- task status, progress updates, or "what we did this session"
- hypothetical or exploratory ideas the user floated but did not decide
- assistant reasoning or plans that were not confirmed
- transient state (today's timestamps, in-flight requests, one-off lookups)
- secrets, credentials, tokens, API keys, OAuth tokens, session IDs
- anything already present in retrieved_items unless this arc corrects or replaces it (use supersedes)

JUDGMENT RULES:
- A decision requires the user to confirm it in the arc. Assistant suggestions alone don't count.
- A fact requires it to be stable — not specific to today or this run.
- A correction requires the user to explicitly tell the assistant to change behavior.
- "I think we should..." is exploration. "Let's do X" or "do X" is a decision.
- When unclear, DO NOT SAVE. Return fewer, higher-quality facts.

TRIGGER POLICY:
- trigger=precompact: prioritize recent, load-bearing decisions/corrections needed immediately after compaction. Prefer 0-3 items.
- trigger=session-end: capture stable session learnings across the full arc. Prefer 0-5 items.
- Never promote temporary progress updates in either trigger.

For each fact return:
{kind, scope, key, value, why, confidence, load_bearing, supersedes}

- kind: preference | decision | fact | correction | constraint
- scope: user (personal facts/preferences) | group (shared facts/decisions for the whole conversation)
- key: stable slug, e.g. "preference:reply-language-hindi".
- value: ONE human sentence, third-person, present tense, <220 chars.
- why: a short quote from the arc that grounds the fact (from the user's turns primarily).
- confidence:
    0.9+ -> the user stated it explicitly and unambiguously
    0.7-0.9 -> strong inference from clear signal
    <0.7 -> drop
- load_bearing: true if future decisions will depend on this.
- supersedes: ids of retrieved_items this fact replaces or corrects. Empty array if new.

Return [] if nothing in the arc qualifies. Empty output is better than noise. Aim for 0-5 facts per extraction, not a dump.`;

export const MEMORY_EXTRACTION_FEW_SHOTS = [
  {
    input: {
      trigger: 'precompact',
      session_arc: [
        {
          role: 'user',
          text: 'From now on, always confirm the total with me before placing an order.',
        },
        {
          role: 'assistant',
          text: 'Understood.',
        },
        {
          role: 'user',
          text: 'I also checked my order status today.',
        },
      ],
    },
    output: [
      {
        kind: 'decision',
        scope: 'user',
        key: 'decision:confirm-total-before-order',
        value:
          'Confirm the order total with the user before placing any order.',
        why: 'always confirm the total with me before placing an order.',
        confidence: 0.95,
        load_bearing: true,
        supersedes: [],
      },
    ],
  },
  {
    input: {
      trigger: 'session-end',
      session_arc: [
        {
          role: 'user',
          text: 'Please reply to me in Hindi from now on.',
        },
        {
          role: 'assistant',
          text: 'Understood. I will reply in Hindi.',
        },
        { role: 'user', text: 'Also, I am allergic to peanuts.' },
        { role: 'assistant', text: 'Noted.' },
      ],
    },
    output: [
      {
        kind: 'preference',
        scope: 'user',
        key: 'preference:reply-language-hindi',
        value: 'The user prefers replies in Hindi.',
        why: 'Please reply to me in Hindi from now on.',
        confidence: 0.95,
        load_bearing: true,
        supersedes: [],
      },
      {
        kind: 'constraint',
        scope: 'user',
        key: 'constraint:peanut-allergy',
        value: 'The user is allergic to peanuts.',
        why: 'I am allergic to peanuts.',
        confidence: 0.95,
        load_bearing: true,
        supersedes: [],
      },
    ],
  },
  {
    input: {
      session_arc: [
        {
          role: 'user',
          text: 'Today I placed an order and checked its status twice.',
        },
        { role: 'assistant', text: 'Nice.' },
      ],
    },
    output: [],
  },
  {
    input: {
      session_arc: [
        {
          role: 'user',
          text: 'Maybe I should switch to the larger pack next time.',
        },
        { role: 'assistant', text: 'Worth considering.' },
      ],
    },
    output: [],
  },
  {
    input: {
      session_arc: [
        {
          role: 'user',
          text: "Actually that's wrong — deliver to my office address, not my home, going forward.",
        },
        { role: 'assistant', text: 'Got it, updating that.' },
      ],
      retrieved_items: [
        {
          id: 'mem-abc',
          key: 'preference:delivery-address',
          value: 'The user prefers delivery to their home address.',
        },
      ],
    },
    output: [
      {
        kind: 'correction',
        scope: 'user',
        key: 'correction:delivery-address-office',
        value: 'The user prefers delivery to their office address, not home.',
        why: 'deliver to my office address, not my home, going forward.',
        confidence: 0.92,
        load_bearing: true,
        supersedes: ['mem-abc'],
      },
    ],
  },
] as const;
