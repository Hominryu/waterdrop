import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AdChallenge, PayoutPreflight, WaterdropState } from '../domain/economy';
import {
  clearActiveDailyReward,
  clearDailyRewardRecovery,
  dailyRewardRecoveryExpired,
  loadDailyRewardRecovery,
  prepareActiveDailyReward,
  type DailyRewardRecovery,
} from '../platform/rewards/payoutRecovery';
import { getTossGameIdentity } from '../platform/toss/identity';
import type { WaterdropApi } from './waterdropApi.types';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
const PAYOUT_RECONCILE_DELAYS_MS = [5_000, 15_000, 30_000, 60_000] as const;
const PAYOUT_RECONCILED_EVENT = 'waterdrop:payout-reconciled';

let client: SupabaseClient | null = null;
let reconcileJob: { identity: string; entitlementId: string; attempt: number; timer: number | null } | null = null;

function configured(value: string) {
  return Boolean(value && value !== 'REPLACE_ME' && !value.includes('YOUR_PROJECT'));
}

async function getClient() {
  if (!configured(url) || !configured(key)) throw new Error('BACKEND_NOT_CONFIGURED');
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  const session = await client.auth.getSession();
  if (!session.data.session) {
    const signedIn = await client.auth.signInAnonymously();
    if (signedIn.error) throw signedIn.error;
  }
  return client;
}

async function invoke<T>(action: string, identity: string, payload: Record<string, unknown> = {}): Promise<T> {
  const supabase = await getClient();
  const response = await supabase.functions.invoke('waterdrop-state', {
    body: { action, identity, ...payload },
  });
  if (response.error) throw response.error;
  if (response.data?.error) {
    const error = new Error(String(response.data.error));
    Object.assign(error, { details: response.data });
    throw error;
  }
  return response.data as T;
}

function pendingEntitlementId(state: WaterdropState) {
  return state.pendingEntitlementId && ['pending', 'verifying', 'failed_retryable'].includes(state.rewardStatus)
    ? state.pendingEntitlementId
    : null;
}

function emitReconciled(state: WaterdropState) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PAYOUT_RECONCILED_EVENT, { detail: state }));
  }
}

function clearReconcileJob() {
  if (reconcileJob?.timer !== null && reconcileJob?.timer !== undefined && typeof window !== 'undefined') {
    window.clearTimeout(reconcileJob.timer);
  }
  reconcileJob = null;
}

function scheduleNextReconcile() {
  const job = reconcileJob;
  if (!job || typeof window === 'undefined' || job.attempt >= PAYOUT_RECONCILE_DELAYS_MS.length) return;
  const delay = PAYOUT_RECONCILE_DELAYS_MS[job.attempt];
  job.timer = window.setTimeout(() => {
    if (reconcileJob !== job) return;
    job.timer = null;
    job.attempt += 1;
    void reconcilePending(job);
  }, delay);
}

async function reconcilePending(job: NonNullable<typeof reconcileJob>) {
  if (reconcileJob !== job) return;
  try {
    const state = await invoke<WaterdropState>('reconcile_payout', job.identity, { entitlementId: job.entitlementId });
    if (reconcileJob !== job) return;
    if (pendingEntitlementId(state) !== job.entitlementId) {
      clearReconcileJob();
      emitReconciled(state);
      return;
    }
  } catch {
    try {
      const state = await invoke<WaterdropState>('bootstrap', job.identity);
      if (reconcileJob !== job) return;
      if (pendingEntitlementId(state) !== job.entitlementId) {
        clearReconcileJob();
        emitReconciled(state);
        return;
      }
    } catch { /* keep bounded retry schedule */ }
  }
  if (reconcileJob === job) scheduleNextReconcile();
}

function scheduleReconcile(identity: string, state: WaterdropState) {
  const entitlementId = pendingEntitlementId(state);
  if (!entitlementId) {
    if (reconcileJob?.identity === identity) clearReconcileJob();
    return;
  }
  if (reconcileJob?.identity === identity && reconcileJob.entitlementId === entitlementId) return;
  clearReconcileJob();
  reconcileJob = { identity, entitlementId, attempt: 0, timer: null };
  scheduleNextReconcile();
}

async function invokeState(action: string, identity: string, payload: Record<string, unknown> = {}) {
  const state = await invoke<WaterdropState>(action, identity, payload);
  scheduleReconcile(identity, state);
  return state;
}

function serverAlreadyOwnsReward(state: WaterdropState) {
  return state.rewardClaimed || Boolean(state.pendingEntitlementId) || state.rewardStatus !== 'claimable';
}

function unrecoverable(error: unknown) {
  const code = error instanceof Error ? error.message : String(error ?? '');
  return [
    'INVALID_CHALLENGE', 'CHALLENGE_EXPIRED', 'CHALLENGE_ALREADY_USED',
    'PAYOUT_NOT_CLAIMABLE', 'REWARD_DISABLED', 'REWARD_CONFIGURATION_MISMATCH',
    'AD_PHASE_MISMATCH', 'DAILY_REWARD_ALREADY_CLAIMED', 'INSUFFICIENT_INTERSTITIAL_IMPRESSIONS',
  ].some((marker) => code.includes(marker));
}

function recoveryMatches(recovery: DailyRewardRecovery | null, identity: string, challenge: AdChallenge) {
  return Boolean(
    recovery
    && recovery.identity === identity
    && recovery.idempotencyKey === challenge.idempotencyKey
    && recovery.challengeToken === challenge.token
    && !dailyRewardRecoveryExpired(recovery),
  );
}

async function recoverEarnedReward(identity: string, current: WaterdropState): Promise<WaterdropState> {
  const recovery = await loadDailyRewardRecovery();
  if (!recovery) return current;
  if (recovery.identity !== identity || dailyRewardRecoveryExpired(recovery)) {
    await clearDailyRewardRecovery(recovery.idempotencyKey);
    return current;
  }
  if (serverAlreadyOwnsReward(current)) {
    await clearDailyRewardRecovery(recovery.idempotencyKey);
    return current;
  }

  try {
    const state = await invokeState('create_payout_entitlement', identity, {
      idempotencyKey: recovery.idempotencyKey,
      challengeToken: recovery.challengeToken,
    });
    await clearDailyRewardRecovery(recovery.idempotencyKey);
    return state;
  } catch (error) {
    try {
      const refreshed = await invokeState('bootstrap', identity);
      if (serverAlreadyOwnsReward(refreshed)) {
        await clearDailyRewardRecovery(recovery.idempotencyKey);
        return refreshed;
      }
      if (unrecoverable(error)) await clearDailyRewardRecovery(recovery.idempotencyKey);
      return refreshed;
    } catch {
      if (unrecoverable(error)) await clearDailyRewardRecovery(recovery.idempotencyKey);
      return current;
    }
  }
}

async function ensureNoUnresolvedEarnedReceipt(identity: string) {
  const recovery = await loadDailyRewardRecovery();
  if (!recovery) return;
  const current = await invokeState('bootstrap', identity);
  await recoverEarnedReward(identity, current);
  const remaining = await loadDailyRewardRecovery();
  if (remaining && remaining.identity === identity && !dailyRewardRecoveryExpired(remaining)) {
    // The user already earned this rewarded ad. Never overwrite its exact
    // challenge with a fresh rewarded ad while payout recovery is uncertain.
    throw new Error('REWARD_RECOVERY_RETRY');
  }
}

async function bootstrap(identity: string) {
  const current = await invokeState('bootstrap', identity);
  return recoverEarnedReward(identity, current);
}

async function preflightPayout(identity: string, idempotencyKey: string) {
  clearActiveDailyReward();
  await ensureNoUnresolvedEarnedReceipt(identity);
  const result = await invoke<PayoutPreflight>('preflight_payout', identity, { idempotencyKey });
  scheduleReconcile(identity, result.state);
  if (result.requiresAd) {
    if (!result.challenge || result.challenge.adKind !== 'rewarded') throw new Error('AD_PHASE_MISMATCH');
    prepareActiveDailyReward({
      identity,
      idempotencyKey: result.challenge.idempotencyKey,
      token: result.challenge.token,
      expiresAt: result.challenge.expiresAt,
    });
  }
  return result;
}

async function createPayoutEntitlement(identity: string, challenge: AdChallenge) {
  const recovery = await loadDailyRewardRecovery();
  const matching = recoveryMatches(recovery, identity, challenge) ? recovery : null;
  try {
    const state = await invokeState('create_payout_entitlement', identity, {
      idempotencyKey: challenge.idempotencyKey,
      challengeToken: challenge.token,
    });
    if (matching) await clearDailyRewardRecovery(matching.idempotencyKey);
    return state;
  } catch (error) {
    if (matching) {
      try {
        const refreshed = await invokeState('bootstrap', identity);
        if (serverAlreadyOwnsReward(refreshed)) {
          await clearDailyRewardRecovery(matching.idempotencyKey);
          return refreshed;
        }
      } catch { /* preserve earned receipt */ }
      if (unrecoverable(error)) await clearDailyRewardRecovery(matching.idempotencyKey);
    }
    throw error;
  }
}

export const productionWaterdropApi: WaterdropApi = {
  isPreview: false,
  resolveIdentity: getTossGameIdentity,
  bootstrap,
  preflightInterstitial: (identity, round, idempotencyKey) =>
    invoke<AdChallenge>('preflight_interstitial', identity, { round, idempotencyKey }),
  confirmInterstitial: (identity, challenge) =>
    invokeState('confirm_interstitial', identity, {
      round: challenge.round,
      idempotencyKey: challenge.idempotencyKey,
      challengeToken: challenge.token,
    }),
  completeFinalRound: (identity, idempotencyKey) =>
    invokeState('complete_final_round', identity, { idempotencyKey }),
  preflightPayout,
  createPayoutEntitlement,
  reconcilePayout: (identity, entitlementId) =>
    invokeState('reconcile_payout', identity, { entitlementId }),
};
