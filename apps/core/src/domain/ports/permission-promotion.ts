export interface PermissionPromotionCounter {
  appId: string;
  agentFolder: string;
  suggestionKey: string;
  allowCount: number;
  lastOfferedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionPromotionRepository {
  incrementAndGet(input: {
    appId: string;
    agentFolder: string;
    suggestionKey: string;
    nowIso: string;
  }): Promise<PermissionPromotionCounter>;

  markOffered(input: {
    appId: string;
    agentFolder: string;
    suggestionKey: string;
    nowIso: string;
  }): Promise<boolean>;
}
