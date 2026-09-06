import { TossAds, loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';
import type { FullScreenAdKind } from '../../domain/economy';
import { clearActiveDailyReward, persistActiveDailyRewardEarned } from '../rewards/payoutRecovery';

const SHOW_TIMEOUT_MS = 60_000;
const PRELOAD_TIMEOUT_MS = 20_000;
const REWARDED_DISMISS_GRACE_MS = 1_200;

type FullScreenState = {
  loadedId: string | null;
  loading: Promise<void> | null;
  cleanupLoad: () => void;
};

const states: Record<FullScreenAdKind, FullScreenState> = {
  rewarded: { loadedId: null, loading: null, cleanupLoad: () => {} },
  interstitial: { loadedId: null, loading: null, cleanupLoad: () => {} },
};

let bannerInitialization: Promise<boolean> | null = null;

function qaMode(kind: FullScreenAdKind) {
  if (typeof window === 'undefined') return null;
  const key = kind === 'rewarded' ? 'previewRewarded' : 'previewInterstitial';
  return new URLSearchParams(window.location.search).get(key);
}

function configured(id: string) {
  return Boolean(id && id !== 'REPLACE_ME');
}

export function preloadAd(kind: FullScreenAdKind, adGroupId: string, preview: boolean): Promise<void> {
  if (preview) return Promise.resolve();
  if (!configured(adGroupId)) return Promise.reject(new Error('AD_NOT_CONFIGURED'));
  if (!loadFullScreenAd.isSupported() || !showFullScreenAd.isSupported()) return Promise.reject(new Error('AD_UNSUPPORTED'));

  const state = states[kind];
  if (state.loadedId === adGroupId) return Promise.resolve();
  if (state.loading) return state.loading;

  state.cleanupLoad();
  state.loadedId = null;
  state.loading = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      state.cleanupLoad();
      state.cleanupLoad = () => {};
      state.loading = null;
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else {
        state.loadedId = adGroupId;
        resolve();
      }
    };
    const timer = window.setTimeout(() => finish(new Error('AD_PRELOAD_TIMEOUT')), PRELOAD_TIMEOUT_MS);
    state.cleanupLoad = loadFullScreenAd({
      options: { adGroupId },
      onEvent: (event) => { if (event.type === 'loaded') finish(); },
      onError: finish,
    });
  });
  return state.loading;
}

function reloadLater(kind: FullScreenAdKind, adGroupId: string) {
  if (!configured(adGroupId)) return;
  void preloadAd(kind, adGroupId, false).catch(() => undefined);
}

/**
 * Interstitial value is established only at `impression`. Never advance the
 * server round merely because show() was called or because dismissed arrived.
 */
export async function showInterstitialAd(adGroupId: string, preview: boolean, onImpression: () => void) {
  if (preview) {
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    const mode = qaMode('interstitial');
    if (mode === 'failure' || mode === 'nofill' || mode === 'no-impression') throw new Error('AD_NO_IMPRESSION');
    onImpression();
    return;
  }
  if (!configured(adGroupId)) throw new Error('AD_NOT_CONFIGURED');
  const state = states.interstitial;
  if (state.loadedId !== adGroupId) {
    reloadLater('interstitial', adGroupId);
    throw new Error('AD_NOT_PRELOADED');
  }
  state.loadedId = null;

  await new Promise<void>((resolve, reject) => {
    let cleanupShow = () => {};
    let settled = false;
    let impressionSeen = false;
    let cleaned = false;
    let timeoutId = 0;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      window.clearTimeout(timeoutId);
      cleanupShow();
    };
    const reload = () => { cleanup(); reloadLater('interstitial', adGroupId); };
    const resolveOnce = () => { if (!settled) { settled = true; resolve(); } };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    timeoutId = window.setTimeout(() => {
      if (!impressionSeen) rejectOnce(new Error('AD_TIMEOUT'));
      reload();
    }, SHOW_TIMEOUT_MS);

    cleanupShow = showFullScreenAd({
      options: { adGroupId },
      onEvent: (event) => {
        if (event.type === 'impression' && !impressionSeen) {
          impressionSeen = true;
          onImpression();
          // Android can miss dismissed; do not block the app after monetizable impression.
          resolveOnce();
          return;
        }
        if (event.type === 'failedToShow') {
          rejectOnce(new Error('AD_FAILED_TO_SHOW'));
          reload();
          return;
        }
        if (event.type === 'dismissed') {
          if (!impressionSeen) rejectOnce(new Error('AD_NO_IMPRESSION'));
          reload();
        }
      },
      onError: (error) => { rejectOnce(error); reload(); },
    });
  });
}

/**
 * `userEarnedReward` is the only point-reward boundary. `impression`,
 * `dismissed`, timeout, or failedToShow must never create a payout entitlement.
 */
export async function showRewardedAd(adGroupId: string, preview: boolean) {
  if (preview) {
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    const mode = qaMode('rewarded');
    if (mode === 'cancel') throw new Error('AD_NOT_COMPLETED');
    if (mode === 'failure' || mode === 'nofill') throw new Error('AD_LOAD_ERROR');
    await persistActiveDailyRewardEarned();
    return;
  }
  if (!configured(adGroupId)) throw new Error('AD_NOT_CONFIGURED');
  const state = states.rewarded;
  if (state.loadedId !== adGroupId) {
    clearActiveDailyReward();
    reloadLater('rewarded', adGroupId);
    throw new Error('AD_NOT_PRELOADED');
  }
  state.loadedId = null;

  await new Promise<void>((resolve, reject) => {
    let cleanupShow = () => {};
    let earned = false;
    let impressionSeen = false;
    let settled = false;
    let cleaned = false;
    let timeoutId = 0;
    let dismissGraceId = 0;
    let reloadTimer = 0;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      window.clearTimeout(timeoutId);
      window.clearTimeout(dismissGraceId);
      window.clearTimeout(reloadTimer);
      cleanupShow();
    };
    const reload = () => { cleanup(); reloadLater('rewarded', adGroupId); };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearActiveDailyReward();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const rejectIncomplete = () => { rejectOnce(new Error('AD_NOT_COMPLETED')); reload(); };

    timeoutId = window.setTimeout(() => {
      if (impressionSeen && !earned) rejectIncomplete();
      else { rejectOnce(new Error('AD_TIMEOUT')); reload(); }
    }, SHOW_TIMEOUT_MS);

    cleanupShow = showFullScreenAd({
      options: { adGroupId },
      onEvent: (event) => {
        if (event.type === 'impression') {
          impressionSeen = true;
          return;
        }
        if (event.type === 'userEarnedReward') {
          if (earned) return;
          earned = true;
          window.clearTimeout(timeoutId);
          window.clearTimeout(dismissGraceId);
          // Persist the exact challenge before the promise resolves.
          void persistActiveDailyRewardEarned()
            .catch((error) => { if (import.meta.env.DEV) console.warn('REWARDED_RECEIPT_PERSIST_FAILED', error); })
            .finally(() => {
              if (!settled) { settled = true; resolve(); }
              if (!cleaned) reloadTimer = window.setTimeout(reload, 1_500);
            });
          return;
        }
        if (event.type === 'failedToShow') {
          if (impressionSeen) return;
          rejectOnce(new Error('AD_FAILED_TO_SHOW'));
          reload();
          return;
        }
        if (event.type === 'dismissed') {
          if (earned) { reload(); return; }
          // SDK ordering may emit dismissed immediately before userEarnedReward.
          if (!dismissGraceId) {
            dismissGraceId = window.setTimeout(() => {
              if (earned) reload();
              else rejectIncomplete();
            }, REWARDED_DISMISS_GRACE_MS);
          }
        }
      },
      onError: (error) => {
        // After impression keep listening: a legitimate earned event may still arrive.
        if (impressionSeen) return;
        rejectOnce(error);
        reload();
      },
    });
  });
}

async function initializeBanner() {
  if (bannerInitialization) return bannerInitialization;
  if (!TossAds.initialize.isSupported() || !TossAds.attachBanner.isSupported()) return false;
  bannerInitialization = new Promise<boolean>((resolve) => {
    TossAds.initialize({ callbacks: { onInitialized: () => resolve(true), onInitializationFailed: () => resolve(false) } });
  });
  return bannerInitialization;
}

export function attachBanner(adGroupId: string, element: HTMLElement, preview: boolean, collapse: () => void) {
  if (preview) return () => {};
  if (!configured(adGroupId)) { collapse(); return () => {}; }
  let disposed = false;
  let destroy = () => {};
  void initializeBanner().then((ready) => {
    if (!ready || disposed) { if (!ready) collapse(); return; }
    const slot = TossAds.attachBanner(adGroupId, element, {
      theme: 'auto', tone: 'grey', variant: 'card',
      callbacks: { onNoFill: collapse, onAdFailedToRender: collapse },
    });
    if (disposed) slot.destroy(); else destroy = slot.destroy;
  });
  return () => { disposed = true; destroy(); };
}
