function value(name: string | undefined) {
  return (name ?? '').trim();
}
function configured(input: string) {
  return Boolean(input && input !== 'REPLACE_ME' && !input.includes('YOUR_PROJECT'));
}

export const WATERDROP_RUNTIME = {
  preview: value(import.meta.env.VITE_QA_PREVIEW).toLowerCase() === 'true',
  supabaseUrl: value(import.meta.env.VITE_SUPABASE_URL),
  supabasePublishableKey: value(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
  interstitialAdGroupId: value(import.meta.env.VITE_AIT_INTERSTITIAL_AD_GROUP_ID),
  rewardedAdGroupId: value(import.meta.env.VITE_AIT_REWARDED_AD_GROUP_ID),
  bannerAdGroupId: value(import.meta.env.VITE_AIT_BANNER_AD_GROUP_ID),
} as const;

export function browserRuntimeReady() {
  return configured(WATERDROP_RUNTIME.supabaseUrl)
    && configured(WATERDROP_RUNTIME.supabasePublishableKey)
    && configured(WATERDROP_RUNTIME.interstitialAdGroupId)
    && configured(WATERDROP_RUNTIME.rewardedAdGroupId);
}

/** Promotion/payout secrets are intentionally impossible to read from browser code. */
export function assertProductionBrowserRuntime() {
  if (WATERDROP_RUNTIME.preview) throw new Error('QA_PREVIEW_ENABLED');
  if (!browserRuntimeReady()) throw new Error('WATERDROP_RUNTIME_NOT_CONFIGURED');
}
