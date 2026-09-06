import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

type Payout = {
  id: string;
  amount: number;
  promotionCode: string;
  tossPayoutKey: string | null;
  status: 'pending' | 'verifying' | 'success' | 'failed_retryable';
};

type GatewayResult = { status: 'SUCCESS' | 'PENDING' | 'FAILED' };

const APP_NAME = Deno.env.get('AIT_APP_NAME') ?? 'waterdrop';
const SCHEMA = 'waterdrop';
const LIVE_PROMOTION_CODE = Deno.env.get('TOSS_LIVE_PROMOTION_CODE') ?? '';
const TEST_PROMOTION_CODE = Deno.env.get('TOSS_TEST_PROMOTION_CODE') ?? '';
const allowedOrigins = new Set([
  `https://${APP_NAME}.web.tossmini.com`,
  `https://${APP_NAME}.private-web.tossmini.com`,
  `https://${APP_NAME}.apps.tossmini.com`,
  `https://${APP_NAME}.private-apps.tossmini.com`,
]);
for (const entry of (Deno.env.get('ADDITIONAL_ALLOWED_ORIGINS') ?? '').split(',')) {
  const origin = entry.trim();
  if (origin) allowedOrigins.add(origin);
}

function originAllowed(origin: string | null) {
  if (!origin) return true;
  return allowedOrigins.has(origin)
    || origin.startsWith('http://localhost:')
    || origin.startsWith('http://127.0.0.1:');
}

function isTestOrigin(origin: string | null) {
  return Boolean(
    origin?.includes('.private-web.tossmini.com')
    || origin?.includes('.private-apps.tossmini.com')
    || origin?.startsWith('http://localhost:')
    || origin?.startsWith('http://127.0.0.1:'),
  );
}

function promotionCodeForOrigin(origin: string | null) {
  const code = isTestOrigin(origin) ? TEST_PROMOTION_CODE : LIVE_PROMOTION_CODE;
  if (!code || code === 'REPLACE_ME') throw new Error('PROMOTION_NOT_CONFIGURED');
  return code;
}

function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin && originAllowed(origin) ? origin : [...allowedOrigins][0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  };
}

function reply(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

async function digestIdentity(identity: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function gateway<T>(path: '/verify-identity' | '/get-key' | '/execute' | '/result', body: Record<string, unknown>): Promise<T> {
  const base = (Deno.env.get('WATERDROP_PAYOUT_GATEWAY_URL') ?? '').replace(/\/$/, '');
  const secret = Deno.env.get('WATERDROP_PAYOUT_GATEWAY_SECRET') ?? '';
  if (!base || base.includes('REPLACE_ME') || !secret || secret === 'REPLACE_ME') {
    throw new Error('PAYOUT_GATEWAY_NOT_CONFIGURED');
  }
  const response = await fetch(`${base}/api/payout${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ appName: APP_NAME, ...body }),
    signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof data?.error === 'string' ? data.error : `GATEWAY_HTTP_${response.status}`;
    throw new Error(code);
  }
  return data as T;
}

function safeGatewayCode(error: unknown) {
  const raw = error instanceof Error ? error.message : 'GATEWAY_UNKNOWN';
  return raw.replace(/[^A-Z0-9_:-]/gi, '_').slice(0, 100);
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') {
    return originAllowed(origin)
      ? new Response(null, { status: 204, headers: corsHeaders(origin) })
      : reply({ error: 'ORIGIN_NOT_ALLOWED' }, 403, null);
  }
  if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405, origin);
  if (!originAllowed(origin)) return reply({ error: 'ORIGIN_NOT_ALLOWED' }, 403, null);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const secretKey = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authorization = request.headers.get('authorization') ?? '';
  if (!supabaseUrl || !publishableKey || !secretKey || !authorization.startsWith('Bearer ')) {
    return reply({ error: 'AUTH_CONFIGURATION_ERROR' }, 401, origin);
  }

  try {
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const userResult = await userClient.auth.getUser();
    if (userResult.error || !userResult.data.user || userResult.data.user.is_anonymous !== true) {
      return reply({ error: 'INVALID_SESSION' }, 401, origin);
    }
    const authUserId = userResult.data.user.id;
    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: SCHEMA },
    });

    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'INVALID_BODY' }, 400, origin);
    const action = String(body.action ?? '');
    const identity = String(body.identity ?? '');
    if (identity.length < 8 || identity.length > 512) return reply({ error: 'INVALID_IDENTITY' }, 400, origin);
    const identityHash = await digestIdentity(identity);

    if (action === 'bootstrap') {
      const verified = await gateway<{ valid?: boolean }>('/verify-identity', { anonymousKey: identity });
      if (verified.valid !== true) return reply({ error: 'TOSS_IDENTITY_INVALID' }, 401, origin);
      const result = await admin.rpc('bootstrap', { p_auth_user_id: authUserId, p_identity_hash: identityHash });
      if (result.error) return reply({ error: result.error.message }, 409, origin);
      return reply(result.data, 200, origin);
    }

    const idempotencyKey = String(body.idempotencyKey ?? '');
    const validIdempotencyKey = idempotencyKey.length >= 16 && idempotencyKey.length <= 200;

    if (action === 'preflight_interstitial') {
      const round = Number(body.round ?? 0);
      if (!validIdempotencyKey || (round !== 1 && round !== 2)) return reply({ error: 'INVALID_INTERSTITIAL_PREFLIGHT' }, 400, origin);
      const result = await admin.rpc('preflight_interstitial', {
        p_auth_user_id: authUserId, p_identity_hash: identityHash, p_round: round, p_idempotency_key: idempotencyKey,
      });
      if (result.error) return reply({ error: result.error.message }, 409, origin);
      return reply(result.data, 200, origin);
    }

    if (action === 'confirm_interstitial') {
      const round = Number(body.round ?? 0);
      const token = String(body.challengeToken ?? '');
      if (!validIdempotencyKey || token.length < 32 || (round !== 1 && round !== 2)) return reply({ error: 'INVALID_INTERSTITIAL_CONFIRM' }, 400, origin);
      const result = await admin.rpc('confirm_interstitial', {
        p_auth_user_id: authUserId, p_identity_hash: identityHash, p_token: token, p_round: round, p_idempotency_key: idempotencyKey,
      });
      if (result.error) return reply({ error: result.error.message }, 409, origin);
      return reply(result.data, 200, origin);
    }

    if (action === 'complete_final_round') {
      if (!validIdempotencyKey) return reply({ error: 'INVALID_FINAL_ROUND' }, 400, origin);
      const result = await admin.rpc('complete_final_round', {
        p_auth_user_id: authUserId, p_identity_hash: identityHash, p_idempotency_key: idempotencyKey,
      });
      if (result.error) return reply({ error: result.error.message }, 409, origin);
      return reply(result.data, 200, origin);
    }

    if (action === 'preflight_payout') {
      if (!validIdempotencyKey) return reply({ error: 'INVALID_PAYOUT_PREFLIGHT' }, 400, origin);
      const result = await admin.rpc('preflight_payout', {
        p_auth_user_id: authUserId, p_identity_hash: identityHash, p_idempotency_key: idempotencyKey,
      });
      if (result.error) return reply({ error: result.error.message }, 409, origin);
      return reply(result.data, 200, origin);
    }

    let entitlementId = String(body.entitlementId ?? '');
    if (action === 'create_payout_entitlement') {
      const token = String(body.challengeToken ?? '');
      if (!validIdempotencyKey || token.length < 32) return reply({ error: 'INVALID_PAYOUT_CLAIM' }, 400, origin);
      const promotionCode = promotionCodeForOrigin(origin);
      const created = await admin.rpc('create_payout_entitlement', {
        p_auth_user_id: authUserId,
        p_identity_hash: identityHash,
        p_token: token,
        p_idempotency_key: idempotencyKey,
        p_promotion_code: promotionCode,
      });
      if (created.error) return reply({ error: created.error.message }, 409, origin);
      entitlementId = String(created.data?.pendingEntitlementId ?? '');
      if (!entitlementId) return reply(created.data, 200, origin);
    } else if (action !== 'reconcile_payout') {
      return reply({ error: 'INVALID_ACTION' }, 400, origin);
    }

    if (entitlementId.length < 32) return reply({ error: 'INVALID_ENTITLEMENT' }, 400, origin);

    const fetchPayout = async () => {
      const result = await admin.rpc('get_payout_request', {
        p_auth_user_id: authUserId, p_identity_hash: identityHash, p_entitlement_id: entitlementId,
      });
      if (result.error || !result.data) throw new Error('PAYOUT_NOT_FOUND');
      return result.data as Payout;
    };
    const recordGatewayError = async (stage: 'GET_KEY' | 'EXECUTE' | 'RESULT', error: unknown) => {
      await admin.rpc('record_payout_gateway_error', {
        p_auth_user_id: authUserId,
        p_identity_hash: identityHash,
        p_entitlement_id: entitlementId,
        p_stage: stage,
        p_failure_code: safeGatewayCode(error),
      });
    };
    const confirm = async (payoutKey: string, checked: GatewayResult) => {
      const confirmed = await admin.rpc('confirm_payout', {
        p_auth_user_id: authUserId,
        p_identity_hash: identityHash,
        p_entitlement_id: entitlementId,
        p_toss_payout_key: payoutKey,
        p_result: checked.status,
        p_failure_code: checked.status === 'FAILED' ? 'TOSS_FAILED' : null,
      });
      if (confirmed.error) throw confirmed.error;
      return confirmed.data;
    };

    const payout = await fetchPayout();
    if (payout.status === 'success') {
      const state = await admin.rpc('bootstrap', { p_auth_user_id: authUserId, p_identity_hash: identityHash });
      if (state.error) throw state.error;
      return reply(state.data, 200, origin);
    }

    let payoutKey = payout.tossPayoutKey;
    if (payoutKey) {
      try {
        const checked = await gateway<GatewayResult>('/result', {
          anonymousKey: identity, promotionCode: payout.promotionCode, key: payoutKey,
        });
        const state = await confirm(payoutKey, checked);
        if (checked.status === 'SUCCESS') return reply(state, 200, origin);
        return reply({ error: checked.status === 'PENDING' ? 'PAYOUT_PENDING' : 'PAYOUT_FAILED_RETRYABLE', entitlementId }, 503, origin);
      } catch (error) {
        await recordGatewayError('RESULT', error);
        return reply({ error: 'PAYOUT_PENDING', entitlementId }, 503, origin);
      }
    }

    try {
      const issued = await gateway<{ key?: string }>('/get-key', { anonymousKey: identity });
      if (!issued.key) throw new Error('PAYOUT_KEY_NOT_RETURNED');
      payoutKey = issued.key;
      const stored = await admin.rpc('store_payout_key', {
        p_auth_user_id: authUserId,
        p_identity_hash: identityHash,
        p_entitlement_id: entitlementId,
        p_toss_payout_key: payoutKey,
      });
      if (stored.error) throw stored.error;
    } catch (error) {
      await recordGatewayError('GET_KEY', error);
      return reply({ error: 'PAYOUT_PENDING', entitlementId }, 503, origin);
    }

    try {
      await gateway('/execute', {
        anonymousKey: identity,
        promotionCode: payout.promotionCode,
        key: payoutKey,
        amount: payout.amount,
      });
    } catch (error) {
      // Execute may have succeeded upstream even when the response failed. Never issue
      // a second key here; keep this exact key and verify its result below.
      await recordGatewayError('EXECUTE', error);
    }

    try {
      const checked = await gateway<GatewayResult>('/result', {
        anonymousKey: identity, promotionCode: payout.promotionCode, key: payoutKey,
      });
      const state = await confirm(payoutKey, checked);
      if (checked.status === 'SUCCESS') return reply(state, 200, origin);
      return reply({ error: checked.status === 'PENDING' ? 'PAYOUT_PENDING' : 'PAYOUT_FAILED_RETRYABLE', entitlementId }, 503, origin);
    } catch (error) {
      await recordGatewayError('RESULT', error);
      return reply({ error: 'PAYOUT_PENDING', entitlementId }, 503, origin);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    const status = [
      'PROMOTION_NOT_CONFIGURED', 'PAYOUT_GATEWAY_NOT_CONFIGURED', 'REWARD_DISABLED',
    ].includes(message) ? 503 : 500;
    return reply({ error: message }, status, origin);
  }
});
