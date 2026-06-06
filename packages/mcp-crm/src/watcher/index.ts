import type { Pool } from 'pg';
import type { BoondiCrmEnv } from '../env.js';
import type { Logger } from '../logger.js';
import type { RecordsRepository } from '../db/records-repository.js';
import type { ExtractorLlm } from '../extractor/llm-client.js';
import { extractOpportunities } from '../extractor/extract.js';
import { applyExtraction } from '../extractor/apply.js';
import { findNewDigests, advanceDigestCursor } from './digest-source.js';
import { loadTranscript, phoneFromConversationId } from '../reconciler/gantry-source.js';

export interface WatcherDeps {
  env: BoondiCrmEnv;
  logger: Logger;
  pool: Pool;
  repo: RecordsRepository;
  llm: ExtractorLlm | null;
}

export interface DigestCycleStats {
  digests: number;
  extracted: number;
  created: number;
  updated: number;
  skipped: number;
}

export async function runDigestCycleOnce(deps: WatcherDeps): Promise<DigestCycleStats> {
  const stats: DigestCycleStats = { digests: 0, extracted: 0, created: 0, updated: 0, skipped: 0 };
  if (!deps.llm) return stats;
  const pending = await findNewDigests(deps.pool, deps.env.gantrySchema, deps.env.reconcileAgentId);
  stats.digests = pending.length;
  for (const d of pending) {
    const phone = phoneFromConversationId(d.conversationId);
    if (!phone) { stats.skipped += 1; continue; }
    const transcript = await loadTranscript(deps.pool, deps.env.gantrySchema, d.conversationId);
    const open = await deps.repo.getOpenOpportunitiesByPhone(phone);
    const result = await extractOpportunities(
      deps.llm,
      {
        conversationId: d.conversationId, phone, transcript, digestText: d.digestText,
        openOpportunities: open.map((o) => ({
          id: o.id,
          summary: `${o.status} ${o.intentCategory} ${o.occasion ?? ''} qty=${o.quantity ?? '?'}`.trim(),
        })),
      },
      (detail) =>
        deps.logger.warn(
          { conversationId: d.conversationId, digestId: d.digestId, ...detail },
          'extraction_parse_failed',
        ),
    );
    if (!result) { stats.skipped += 1; continue; }
    const applied = await applyExtraction(deps.repo, {
      phone, conversationId: d.conversationId, opportunities: result.opportunities,
    });
    stats.extracted += result.opportunities.length;
    stats.created += applied.created;
    stats.updated += applied.updated;
    await advanceDigestCursor(deps.pool, d.conversationId, d.digestId, d.digestAt);
  }
  return stats;
}

export function startDigestWatcher(deps: WatcherDeps): () => void {
  if (!deps.llm) {
    deps.logger.warn({}, 'extractor_disabled_no_key');
    return () => undefined;
  }
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const stats = await runDigestCycleOnce(deps);
      if (stats.digests > 0) deps.logger.info({ ...stats }, 'digest_cycle');
    } catch (err) {
      deps.logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'digest_cycle_failed');
    } finally {
      running = false;
    }
  };
  deps.logger.info({ intervalMs: deps.env.reconcileIntervalMs, model: deps.env.extractorModel }, 'digest_watcher_started');
  void tick();
  const handle = setInterval(() => void tick(), deps.env.reconcileIntervalMs);
  return () => { stopped = true; clearInterval(handle); };
}
