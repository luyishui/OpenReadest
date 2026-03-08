export const USAGE_TYPES = {
  TRANSLATION_CHARS: 'translation_chars',
} as const;

export const QUOTA_TYPES = {
  DAILY: 'daily',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
} as const;

export class UsageStatsManager {
  static async trackUsage(
    userId: string,
    usageType: string,
    increment: number = 1,
    metadata: Record<string, string | number> = {},
  ): Promise<number> {
    void userId;
    void usageType;
    void increment;
    void metadata;
    return 0;
  }

  static async getCurrentUsage(
    userId: string,
    usageType: string,
    period: 'daily' | 'monthly' = 'daily',
  ): Promise<number> {
    void userId;
    void usageType;
    void period;
    return 0;
  }
}
