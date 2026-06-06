import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RecordsRepository } from '../db/records-repository.js';
import { getCallerPhone, jsonContent, toolErrorContent } from './shared.js';

export function registerGetOpenRecords(
  server: McpServer,
  repo: RecordsRepository,
): void {
  server.tool(
    'get_open_records',
    "Return the verified caller's OPEN opportunities (queries/leads) — a customer may have several. Call with empty arguments {} on the first turn of a returning conversation so you can greet them and continue where they left off. Returns {found:false, records:[]} for a brand-new customer.",
    {},
    async () => {
      try {
        const phone = getCallerPhone();
        if (!phone) {
          return toolErrorContent(
            'IDENTITY_REQUIRED',
            'No verified caller identity on this request.',
          );
        }
        const recs = await repo.getOpenOpportunitiesByPhone(phone);
        return jsonContent({
          found: recs.length > 0,
          records: recs.map((rec) => ({
            id: rec.id,
            status: rec.status,
            intentCategory: rec.intentCategory,
            occasion: rec.occasion,
            quantity: rec.quantity,
            quantityRaw: rec.quantityRaw,
            budgetPerGiftInr: rec.budgetPerGiftInr,
            budgetRaw: rec.budgetRaw,
            locations: rec.locations,
            timeline: rec.timeline,
            buyerType: rec.buyerType,
            customisation: rec.customisation,
            score: rec.score,
            band: rec.band,
            summaryBrief: rec.summaryBrief,
            needsReview: rec.needsReview,
            updatedAt: rec.updatedAt,
          })),
        });
      } catch (err) {
        return toolErrorContent(
          'INTERNAL_ERROR',
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  );
}
