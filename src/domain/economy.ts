export const WATERDROP_ECONOMY = {
  version: 'v1-3round-2i-1r-10w-2026-09-07',
  totalRounds: 3,
  interstitialRounds: [1, 2] as const,
  rewardedRound: 3,
  dailyRewardWon: 10,
  dailyRewardLimit: 1,
  requiredInterstitialImpressions: 2,
  challengeTtlSeconds: 10 * 60,
} as const;

export type FullScreenAdKind = 'interstitial' | 'rewarded';
export type RewardStatus =
  | 'none'
  | 'claimable'
  | 'pending'
  | 'verifying'
  | 'success'
  | 'failed_retryable';

export type WaterdropState = {
  economyVersion: string;
  serverNow: string;
  serverDate: string;
  completedRounds: number;
  interstitialImpressions: number;
  rewardStatus: RewardStatus;
  rewardClaimed: boolean;
  pointsToday: number;
  pendingEntitlementId: string | null;
  rewardEnabled: boolean;
  integrationReady: boolean;
};

export type AdChallenge = {
  token: string;
  adKind: FullScreenAdKind;
  round: number;
  idempotencyKey: string;
  expiresAt: string;
};

export type PayoutPreflight = {
  requiresAd: boolean;
  entitlementId: string | null;
  challenge: AdChallenge | null;
  state: WaterdropState;
};

/**
 * UI-only helper. The server remains authoritative for KST day boundaries.
 * This is intentionally not used to decide whether real money may be paid.
 */
export function kstDate(timestampMs = Date.now()): string {
  return new Date(timestampMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function expectedAdForRound(round: number): FullScreenAdKind {
  if (round === WATERDROP_ECONOMY.rewardedRound) return 'rewarded';
  if (WATERDROP_ECONOMY.interstitialRounds.includes(round as 1 | 2)) return 'interstitial';
  throw new Error('INVALID_ROUND');
}

export function canRequestDailyReward(state: Pick<WaterdropState, 'completedRounds' | 'interstitialImpressions' | 'rewardClaimed' | 'rewardEnabled'>) {
  return state.rewardEnabled
    && !state.rewardClaimed
    && state.completedRounds >= WATERDROP_ECONOMY.totalRounds
    && state.interstitialImpressions >= WATERDROP_ECONOMY.requiredInterstitialImpressions;
}
