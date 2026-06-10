# Boondi CRM Connector

- Opportunity extraction is driven from session digests; regression checks must
  invoke the operator slash-command path and then assert
  `boondi_business_records`, not local replay scripts or customer-facing tool
  calls.
- Manual extraction/debug tooling must reuse the same watcher path as the digest
  watcher so query-to-lead upgrades, scoring, and cursor advancement stay
  single-sourced.
- Connector logs may expose digest ids, hashed conversation refs, counts, record
  ids, statuses, scores, and non-contact classification fields. Do not log raw
  phones, emails, transcripts, caller identity headers, or database URLs.
