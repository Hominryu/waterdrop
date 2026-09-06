import { Storage } from '@apps-in-toss/web-framework';

export type DailyRewardRecovery = {
  version: 1;
  identity: string;
  idempotencyKey: string;
  challengeToken: string;
  earnedAt: string;
  expiresAt: string;
};

type ActiveDailyReward = {
  identity: string;
  idempotencyKey: string;
  token: string;
  expiresAt: string;
};

const EARNED_STORAGE_KEY = 'waterdrop:reward:daily-earned-v1';
let activeDailyReward: ActiveDailyReward | null = null;

function parseRecovery(value: string | null): DailyRewardRecovery | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<DailyRewardRecovery>;
    if (
      parsed.version !== 1
      || typeof parsed.identity !== 'string'
      || parsed.identity.length < 8
      || typeof parsed.idempotencyKey !== 'string'
      || parsed.idempotencyKey.length < 16
      || typeof parsed.challengeToken !== 'string'
      || parsed.challengeToken.length < 32
      || typeof parsed.earnedAt !== 'string'
      || !Number.isFinite(Date.parse(parsed.earnedAt))
      || typeof parsed.expiresAt !== 'string'
      || !Number.isFinite(Date.parse(parsed.expiresAt))
    ) return null;
    return parsed as DailyRewardRecovery;
  } catch {
    return null;
  }
}

function readLocal() {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(EARNED_STORAGE_KEY); } catch { return null; }
}

function writeLocal(value: string) {
  if (typeof window === 'undefined') return false;
  try { window.localStorage.setItem(EARNED_STORAGE_KEY, value); return true; } catch { return false; }
}

function clearLocal() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(EARNED_STORAGE_KEY); } catch { /* best effort */ }
}

/** Nothing is persisted before userEarnedReward. */
export function prepareActiveDailyReward(input: ActiveDailyReward) {
  activeDailyReward = input;
}

export function clearActiveDailyReward() {
  activeDailyReward = null;
}

/**
 * Must be called only from the SDK userEarnedReward callback. The exact server
 * challenge becomes durable before the ad promise resolves, so an app close or
 * network timeout is recovered without asking the user to watch a second ad.
 */
export async function persistActiveDailyRewardEarned(): Promise<void> {
  const active = activeDailyReward;
  if (!active) return;

  const recovery: DailyRewardRecovery = {
    version: 1,
    identity: active.identity,
    idempotencyKey: active.idempotencyKey,
    challengeToken: active.token,
    earnedAt: new Date().toISOString(),
    expiresAt: active.expiresAt,
  };
  const serialized = JSON.stringify(recovery);
  const localWritten = writeLocal(serialized);
  try {
    await Storage.setItem(EARNED_STORAGE_KEY, serialized);
  } catch {
    if (!localWritten && import.meta.env.DEV) console.warn('DAILY_REWARD_RECOVERY_PERSIST_FAILED');
  } finally {
    activeDailyReward = null;
  }
}

export async function loadDailyRewardRecovery(): Promise<DailyRewardRecovery | null> {
  const candidates: DailyRewardRecovery[] = [];
  try {
    const sdk = parseRecovery(await Storage.getItem(EARNED_STORAGE_KEY));
    if (sdk) candidates.push(sdk);
  } catch { /* fallback below */ }
  const local = parseRecovery(readLocal());
  if (local) candidates.push(local);
  candidates.sort((a, b) => Date.parse(b.earnedAt) - Date.parse(a.earnedAt));
  return candidates[0] ?? null;
}

export function dailyRewardRecoveryExpired(recovery: Pick<DailyRewardRecovery, 'expiresAt'>, now = Date.now()) {
  const expiresAt = Date.parse(recovery.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export async function clearDailyRewardRecovery(expectedIdempotencyKey?: string): Promise<void> {
  if (expectedIdempotencyKey) {
    const current = await loadDailyRewardRecovery();
    if (current && current.idempotencyKey !== expectedIdempotencyKey) return;
  }
  clearLocal();
  try { await Storage.setItem(EARNED_STORAGE_KEY, ''); } catch { /* best effort */ }
}
