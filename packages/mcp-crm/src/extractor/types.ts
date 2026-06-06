import { z } from 'zod';

export const extractedOpportunitySchema = z.object({
  // Existing open-opportunity id to UPDATE, or null to CREATE a new one.
  match: z.string().nullable(),
  isLead: z.boolean(),
  intentCategory: z
    .enum(['shopping', 'gifting_personal', 'gifting_b2b', 'corporate', 'reorder', 'other'])
    .optional(),
  occasion: z.string().optional(),
  quantity: z.number().int().min(1).optional(),
  quantityRaw: z.string().optional(),
  budgetPerGiftInr: z.number().int().min(1).optional(),
  budgetTotalInr: z.number().int().min(1).optional(),
  budgetRaw: z.string().optional(),
  budgetUndecided: z.boolean().optional(),
  locations: z.string().optional(),
  locationScope: z.enum(['single', 'multi_drop_city', 'multi_city', 'pan_india']).optional(),
  timeline: z.string().optional(),
  timelineDays: z.number().int().min(0).optional(),
  timelineExploring: z.boolean().optional(),
  buyerType: z
    .enum(['personal', 'wedding_event', 'small_business', 'employee_gifting', 'client_vip_procurement'])
    .optional(),
  customisation: z.enum(['none', 'note_card', 'logo', 'custom_packaging', 'bespoke']).optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
  customerName: z.string().optional(),
  summaryBrief: z.string(),
  evidenceQuote: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedOpportunity = z.infer<typeof extractedOpportunitySchema>;

export const extractionResultSchema = z.object({
  opportunities: z.array(extractedOpportunitySchema),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export interface ExtractionInput {
  conversationId: string;
  phone: string;
  transcript: Array<{ role: 'customer' | 'assistant'; text: string }>;
  digestText: string;
  openOpportunities: Array<{ id: string; summary: string }>;
}
