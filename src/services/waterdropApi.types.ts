import type { AdChallenge, PayoutPreflight, WaterdropState } from '../domain/economy';

export type WaterdropApi = {
  isPreview: boolean;
  resolveIdentity(): Promise<string>;
  bootstrap(identity: string): Promise<WaterdropState>;
  preflightInterstitial(identity: string, round: 1 | 2, idempotencyKey: string): Promise<AdChallenge>;
  confirmInterstitial(identity: string, challenge: AdChallenge): Promise<WaterdropState>;
  completeFinalRound(identity: string, idempotencyKey: string): Promise<WaterdropState>;
  preflightPayout(identity: string, idempotencyKey: string): Promise<PayoutPreflight>;
  createPayoutEntitlement(identity: string, challenge: AdChallenge): Promise<WaterdropState>;
  reconcilePayout(identity: string, entitlementId: string): Promise<WaterdropState>;
};

export function newIdempotencyKey(scope: string) {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `waterdrop:${scope}:${random}`;
}
