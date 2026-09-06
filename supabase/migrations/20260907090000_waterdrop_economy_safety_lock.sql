-- WATERDROP V1 ECONOMY SAFETY LOCK
-- 3 rounds / interstitial impressions after rounds 1+2 / rewarded after round 3 / 10 won once per KST day.
-- Real payouts are disabled by default until ad groups + promotion/gateway configuration are issued.

create schema if not exists waterdrop;

create table if not exists waterdrop.runtime_config (
  singleton boolean primary key default true check (singleton),
  economy_version text not null default 'v1-3round-2i-1r-10w-2026-09-07',
  reward_enabled boolean not null default false,
  daily_reward_won integer not null default 10 check (daily_reward_won = 10),
  total_rounds smallint not null default 3 check (total_rounds = 3),
  required_interstitial_impressions smallint not null default 2 check (required_interstitial_impressions = 2),
  challenge_ttl_seconds integer not null default 600 check (challenge_ttl_seconds between 60 and 1800),
  max_daily_payouts integer null check (max_daily_payouts is null or max_daily_payouts > 0),
  updated_at timestamptz not null default now()
);
insert into waterdrop.runtime_config(singleton) values (true) on conflict (singleton) do nothing;

create table if not exists waterdrop.player (
  id uuid primary key default gen_random_uuid(),
  identity_hash text not null unique check (length(identity_hash) between 32 and 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists waterdrop.session_binding (
  auth_user_id uuid primary key,
  player_id uuid not null references waterdrop.player(id) on delete cascade,
  identity_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(player_id, auth_user_id)
);
create index if not exists session_binding_player_idx on waterdrop.session_binding(player_id);

create table if not exists waterdrop.daily_state (
  player_id uuid not null references waterdrop.player(id) on delete cascade,
  server_date date not null,
  completed_rounds smallint not null default 0 check (completed_rounds between 0 and 3),
  interstitial_impressions smallint not null default 0 check (interstitial_impressions between 0 and 2),
  updated_at timestamptz not null default now(),
  primary key(player_id, server_date),
  constraint daily_state_progress_gate check (
    (completed_rounds = 0 and interstitial_impressions = 0)
    or (completed_rounds = 1 and interstitial_impressions = 1)
    or (completed_rounds >= 2 and interstitial_impressions = 2)
  )
);

create table if not exists waterdrop.ad_challenge (
  id uuid primary key default gen_random_uuid(),
  token text not null unique check (length(token) between 32 and 128),
  player_id uuid not null references waterdrop.player(id) on delete cascade,
  server_date date not null,
  ad_kind text not null check (ad_kind in ('interstitial','rewarded')),
  round smallint not null check (round between 1 and 3),
  idempotency_key text not null check (length(idempotency_key) between 16 and 200),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now(),
  unique(player_id, idempotency_key)
);
create index if not exists ad_challenge_player_day_idx on waterdrop.ad_challenge(player_id, server_date, created_at desc);

create table if not exists waterdrop.ad_impression_ledger (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references waterdrop.player(id) on delete cascade,
  server_date date not null,
  challenge_id uuid not null unique references waterdrop.ad_challenge(id) on delete restrict,
  ad_kind text not null check (ad_kind in ('interstitial','rewarded')),
  round smallint not null check (round between 1 and 3),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique(player_id, idempotency_key)
);
create index if not exists ad_impression_day_idx on waterdrop.ad_impression_ledger(server_date, ad_kind);

create table if not exists waterdrop.final_round_ledger (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references waterdrop.player(id) on delete cascade,
  server_date date not null,
  idempotency_key text not null check (length(idempotency_key) between 16 and 200),
  created_at timestamptz not null default now(),
  unique(player_id, server_date),
  unique(player_id, idempotency_key)
);

create table if not exists waterdrop.payout_entitlement (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references waterdrop.player(id) on delete cascade,
  server_date date not null,
  reward_kind text not null default 'daily_10' check (reward_kind = 'daily_10'),
  amount integer not null default 10 check (amount = 10),
  promotion_code text not null check (length(promotion_code) between 4 and 128),
  idempotency_key text not null check (length(idempotency_key) between 16 and 200),
  challenge_id uuid not null unique references waterdrop.ad_challenge(id) on delete restrict,
  toss_payout_key text null unique,
  status text not null default 'pending' check (status in ('pending','verifying','success','failed_retryable')),
  failure_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  succeeded_at timestamptz null,
  unique(player_id, server_date, reward_kind),
  unique(player_id, idempotency_key)
);
create index if not exists payout_entitlement_status_idx on waterdrop.payout_entitlement(status, updated_at);
create index if not exists payout_entitlement_day_idx on waterdrop.payout_entitlement(server_date, status);

create table if not exists waterdrop.payout_gateway_error (
  id bigserial primary key,
  entitlement_id uuid not null references waterdrop.payout_entitlement(id) on delete cascade,
  stage text not null check (stage in ('GET_KEY','EXECUTE','RESULT')),
  failure_code text not null,
  created_at timestamptz not null default now()
);

create or replace function waterdrop.today_kst() returns date
language sql stable
set search_path = pg_catalog
as $$ select (now() at time zone 'Asia/Seoul')::date $$;

create or replace function waterdrop.ensure_daily(p_player_id uuid) returns void
language plpgsql security definer
set search_path = pg_catalog, waterdrop
as $$
begin
  insert into waterdrop.daily_state(player_id, server_date)
  values (p_player_id, waterdrop.today_kst())
  on conflict (player_id, server_date) do nothing;
end;
$$;

create or replace function waterdrop.resolve_player(p_auth_user_id uuid, p_identity_hash text) returns uuid
language plpgsql security definer
set search_path = pg_catalog, waterdrop
as $$
declare v_player uuid;
begin
  select b.player_id into v_player
  from waterdrop.session_binding b
  join waterdrop.player p on p.id = b.player_id
  where b.auth_user_id = p_auth_user_id
    and b.identity_hash = p_identity_hash
    and p.identity_hash = p_identity_hash;
  if v_player is null then raise exception 'IDENTITY_MISMATCH'; end if;
  return v_player;
end;
$$;

create or replace function waterdrop.state_json(p_player_id uuid) returns jsonb
language sql security definer
set search_path = pg_catalog, waterdrop
as $$
  with cfg as (
    select * from waterdrop.runtime_config where singleton = true
  ), s as (
    select * from waterdrop.daily_state
    where player_id = p_player_id and server_date = waterdrop.today_kst()
  ), e as (
    select * from waterdrop.payout_entitlement
    where player_id = p_player_id and server_date = waterdrop.today_kst() and reward_kind = 'daily_10'
    limit 1
  )
  select jsonb_build_object(
    'economyVersion', cfg.economy_version,
    'serverNow', now(),
    'serverDate', waterdrop.today_kst(),
    'completedRounds', coalesce(s.completed_rounds, 0),
    'interstitialImpressions', coalesce(s.interstitial_impressions, 0),
    'rewardStatus', case
      when e.status is not null then e.status
      when coalesce(s.completed_rounds,0) = 3 and cfg.reward_enabled then 'claimable'
      else 'none'
    end,
    'rewardClaimed', coalesce(e.status = 'success', false),
    'pointsToday', coalesce((select sum(amount)::integer from waterdrop.payout_entitlement where player_id = p_player_id and server_date = waterdrop.today_kst() and status = 'success'), 0),
    'pendingEntitlementId', case when e.status in ('pending','verifying','failed_retryable') then e.id else null end,
    'rewardEnabled', cfg.reward_enabled,
    'integrationReady', cfg.reward_enabled
  )
  from cfg left join s on true left join e on true;
$$;

create or replace function waterdrop.bootstrap(p_auth_user_id uuid, p_identity_hash text) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, waterdrop
as $$
declare
  v_player uuid;
  v_bound waterdrop.session_binding%rowtype;
begin
  if length(p_identity_hash) < 32 or length(p_identity_hash) > 128 then raise exception 'INVALID_IDENTITY_HASH'; end if;

  select * into v_bound from waterdrop.session_binding where auth_user_id = p_auth_user_id for update;
  if found and v_bound.identity_hash <> p_identity_hash then raise exception 'SESSION_IDENTITY_REBIND_FORBIDDEN'; end if;

  select id into v_player from waterdrop.player where identity_hash = p_identity_hash for update;
  if v_player is null then
    insert into waterdrop.player(identity_hash) values (p_identity_hash) returning id into v_player;
  end if;

  if found then
    update waterdrop.session_binding set player_id = v_player, updated_at = now()
    where auth_user_id = p_auth_user_id;
  else
    insert into waterdrop.session_binding(auth_user_id, player_id, identity_hash)
    values (p_auth_user_id, v_player, p_identity_hash)
    on conflict (auth_user_id) do nothing;
  end if;

  perform waterdrop.ensure_daily(v_player);
  return waterdrop.state_json(v_player);
end;
$$;

create or replace function waterdrop.preflight_interstitial(
  p_auth_user_id uuid, p_identity_hash text, p_round smallint, p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, waterdrop
as $$
declare
  v_player uuid := waterdrop.resolve_player(p_auth_user_id, p_identity_hash);
  v_state waterdrop.daily_state%rowtype;
  v_challenge waterdrop.ad_challenge%rowtype;
  v_ttl integer;
begin
  if p_round not in (1,2) then raise exception 'INVALID_INTERSTITIAL_ROUND'; end if;
  if length(p_idempotency_key) < 16 or length(p_idempotency_key) > 200 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  perform waterdrop.ensure_daily(v_player);
  select * into v_state from waterdrop.daily_state where player_id=v_player and server_date=waterdrop.today_kst() for update;

  select * into v_challenge from waterdrop.ad_challenge where player_id=v_player and idempotency_key=p_idempotency_key;
  if found then
    if v_challenge.ad_kind <> 'interstitial' or v_challenge.round <> p_round then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('token',v_challenge.token,'adKind','interstitial','round',v_challenge.round,'idempotencyKey',v_challenge.idempotency_key,'expiresAt',v_challenge.expires_at);
  end if;

  if v_state.completed_rounds >= p_round then raise exception 'ROUND_ALREADY_CONFIRMED'; end if;
  if v_state.completed_rounds <> p_round - 1 then raise exception 'ROUND_SEQUENCE_MISMATCH'; end if;
  select challenge_ttl_seconds into v_ttl from waterdrop.runtime_config where singleton=true;
  insert into waterdrop.ad_challenge(token,player_id,server_date,ad_kind,round,idempotency_key,expires_at)
  values (gen_random_uuid()::text,v_player,waterdrop.today_kst(),'interstitial',p_round,p_idempotency_key,now()+make_interval(secs=>v_ttl))
  returning * into v_challenge;
  return jsonb_build_object('token',v_challenge.token,'adKind','interstitial','round',v_challenge.round,'idempotencyKey',v_challenge.idempotency_key,'expiresAt',v_challenge.expires_at);
end;
$$;

create or replace function waterdrop.confirm_interstitial(
  p_auth_user_id uuid, p_identity_hash text, p_token text, p_round smallint, p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, waterdrop
as $$
declare
  v_player uuid := waterdrop.resolve_player(p_auth_user_id,p_identity_hash);
  v_state waterdrop.daily_state%rowtype;
  v_challenge waterdrop.ad_challenge%rowtype;
begin
  perform waterdrop.ensure_daily(v_player);
  select * into v_state from waterdrop.daily_state where player_id=v_player and server_date=waterdrop.today_kst() for update;
  select * into v_challenge from waterdrop.ad_challenge
  where player_id=v_player and token=p_token and idempotency_key=p_idempotency_key for update;
  if not found then raise exception 'INVALID_CHALLENGE'; end if;
  if v_challenge.ad_kind <> 'interstitial' or v_challenge.round <> p_round then raise exception 'AD_PHASE_MISMATCH'; end if;
  if v_challenge.server_date <> waterdrop.today_kst() then raise exception 'CHALLENGE_DAY_MISMATCH'; end if;
  if v_challenge.expires_at < now() and v_challenge.consumed_at is null then raise exception 'CHALLENGE_EXPIRED'; end if;

  if v_challenge.consumed_at is not null then
    if v_state.completed_rounds >= p_round then return waterdrop.state_json(v_player); end if;
    raise exception 'CHALLENGE_ALREADY_USED';
  end if;
  if v_state.completed_rounds <> p_round - 1 then raise exception 'ROUND_SEQUENCE_MISMATCH'; end if;

  update waterdrop.ad_challenge set consumed_at=now() where id=v_challenge.id;
  insert into waterdrop.ad_impression_ledger(player_id,server_date,challenge_id,ad_kind,round,idempotency_key)
  values (v_player,waterdrop.today_kst(),v_challenge.id,'interstitial',p_round,p_idempotency_key)
  on conflict (challenge_id) do nothing;
  update waterdrop.daily_state set
    completed_rounds=p_round,
    interstitial_impressions=least(2,interstitial_impressions+1),
    updated_at=now()
  where player_id=v_player and server_date=waterdrop.today_kst();
  return waterdrop.state_json(v_player);
end;
$$;

create or replace function waterdrop.complete_final_round(
  p_auth_user_id uuid, p_identity_hash text, p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, waterdrop
as $$
declare
  v_player uuid := waterdrop.resolve_player(p_auth_user_id,p_identity_hash);
  v_state waterdrop.daily_state%rowtype;
begin
  if length(p_idempotency_key) < 16 or length(p_idempotency_key) > 200 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  perform waterdrop.ensure_daily(v_player);
  select * into v_state from waterdrop.daily_state where player_id=v_player and server_date=waterdrop.today_kst() for update;
  if v_state.completed_rounds = 3 then return waterdrop.state_json(v_player); end if;
  if v_state.completed_rounds <> 2 then raise exception 'ROUND_SEQUENCE_MISMATCH'; end if;
  if v_state.interstitial_impressions <> 2 then raise exception 'INSUFFICIENT_INTERSTITIAL_IMPRESSIONS'; end if;
  insert into waterdrop.final_round_ledger(player_id,server_date,idempotency_key)
  values(v_player,waterdrop.today_kst(),p_idempotency_key)
  on conflict (player_id,server_date) do nothing;
  update waterdrop.daily_state set completed_rounds=3,updated_at=now()
  where player_id=v_player and server_date=waterdrop.today_kst();
  return waterdrop.state_json(v_player);
end;
$$;

create or replace function waterdrop.preflight_payout(
  p_auth_user_id uuid, p_identity_hash text, p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, waterdrop
as $$
declare
  v_player uuid := waterdrop.resolve_player(p_auth_user_id,p_identity_hash);
  v_state waterdrop.daily_state%rowtype;
  v_ent waterdrop.payout_entitlement%rowtype;
  v_challenge waterdrop.ad_challenge%rowtype;
  v_cfg waterdrop.runtime_config%rowtype;
begin
  if length(p_idempotency_key) < 16 or length(p_idempotency_key) > 200 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  select * into v_cfg from waterdrop.runtime_config where singleton=true;
  if not v_cfg.reward_enabled then raise exception 'REWARD_DISABLED'; end if;
  perform waterdrop.ensure_daily(v_player);
  select * into v_state from waterdrop.daily_state where player_id=v_player and server_date=waterdrop.today_kst() for update;
  if v_state.completed_rounds <> 3 then raise exception 'PAYOUT_NOT_CLAIMABLE'; end if;
  if v_state.interstitial_impressions < v_cfg.required_interstitial_impressions then raise exception 'INSUFFICIENT_INTERSTITIAL_IMPRESSIONS'; end if;

  select * into v_ent from waterdrop.payout_entitlement where player_id=v_player and server_date=waterdrop.today_kst() and reward_kind='daily_10';
  if found then return jsonb_build_object('requiresAd',false,'entitlementId',v_ent.id,'challenge',null,'state',waterdrop.state_json(v_player)); end if;

  select * into v_challenge from waterdrop.ad_challenge where player_id=v_player and idempotency_key=p_idempotency_key;
  if not found then
    insert into waterdrop.ad_challenge(token,player_id,server_date,ad_kind,round,idempotency_key,expires_at)
    values(gen_random_uuid()::text,v_player,waterdrop.today_kst(),'rewarded',3,p_idempotency_key,now()+make_interval(secs=>v_cfg.challenge_ttl_seconds))
    returning * into v_challenge;
  elsif v_challenge.ad_kind <> 'rewarded' or v_challenge.round <> 3 then
    raise exception 'IDEMPOTENCY_KEY_REUSED';
  end if;

  return jsonb_build_object(
    'requiresAd',true,'entitlementId',null,
    'challenge',jsonb_build_object('token',v_challenge.token,'adKind','rewarded','round',3,'idempotencyKey',v_challenge.idempotency_key,'expiresAt',v_challenge.expires_at),
    'state',waterdrop.state_json(v_player)
  );
end;
$$;

create or replace function waterdrop.create_payout_entitlement(
  p_auth_user_id uuid, p_identity_hash text, p_token text, p_idempotency_key text, p_promotion_code text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, waterdrop
as $$
declare
  v_player uuid := waterdrop.resolve_player(p_auth_user_id,p_identity_hash);
  v_state waterdrop.daily_state%rowtype;
  v_cfg waterdrop.runtime_config%rowtype;
  v_challenge waterdrop.ad_challenge%rowtype;
  v_existing waterdrop.payout_entitlement%rowtype;
  v_reserved integer;
begin
  if p_promotion_code is null or p_promotion_code='' or p_promotion_code='REPLACE_ME' then raise exception 'PROMOTION_NOT_CONFIGURED'; end if;
  select * into v_cfg from waterdrop.runtime_config where singleton=true;
  if not v_cfg.reward_enabled then raise exception 'REWARD_DISABLED'; end if;
  if v_cfg.daily_reward_won <> 10 or v_cfg.total_rounds <> 3 or v_cfg.required_interstitial_impressions <> 2 then raise exception 'REWARD_CONFIGURATION_MISMATCH'; end if;
  perform waterdrop.ensure_daily(v_player);
  select * into v_state from waterdrop.daily_state where player_id=v_player and server_date=waterdrop.today_kst() for update;

  select * into v_existing from waterdrop.payout_entitlement where player_id=v_player and server_date=waterdrop.today_kst() and reward_kind='daily_10';
  if found then return waterdrop.state_json(v_player); end if;
  if v_state.completed_rounds <> 3 then raise exception 'PAYOUT_NOT_CLAIMABLE'; end if;
  if v_state.interstitial_impressions < 2 then raise exception 'INSUFFICIENT_INTERSTITIAL_IMPRESSIONS'; end if;

  if v_cfg.max_daily_payouts is not null then
    select count(*)::integer into v_reserved from waterdrop.payout_entitlement
    where server_date=waterdrop.today_kst() and status in ('pending','verifying','success');
    if v_reserved >= v_cfg.max_daily_payouts then raise exception 'DAILY_PAYOUT_BUDGET_GUARD'; end if;
  end if;

  select * into v_challenge from waterdrop.ad_challenge
  where player_id=v_player and token=p_token and idempotency_key=p_idempotency_key for update;
  if not found then raise exception 'INVALID_CHALLENGE'; end if;
  if v_challenge.ad_kind <> 'rewarded' or v_challenge.round <> 3 then raise exception 'AD_PHASE_MISMATCH'; end if;
  if v_challenge.server_date <> waterdrop.today_kst() then raise exception 'CHALLENGE_DAY_MISMATCH'; end if;
  if v_challenge.consumed_at is not null then raise exception 'CHALLENGE_ALREADY_USED'; end if;
  if v_challenge.expires_at < now() then raise exception 'CHALLENGE_EXPIRED'; end if;

  update waterdrop.ad_challenge set consumed_at=now() where id=v_challenge.id;
  insert into waterdrop.payout_entitlement(player_id,server_date,amount,promotion_code,idempotency_key,challenge_id)
  values(v_player,waterdrop.today_kst(),10,p_promotion_code,p_idempotency_key,v_challenge.id)
  on conflict (player_id,server_date,reward_kind) do nothing;
  return waterdrop.state_json(v_player);
end;
$$;

create or replace function waterdrop.get_payout_request(
  p_auth_user_id uuid,p_identity_hash text,p_entitlement_id uuid
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, waterdrop
as $$
declare v_player uuid := waterdrop.resolve_player(p_auth_user_id,p_identity_hash); v_ent waterdrop.payout_entitlement%rowtype;
begin
  select * into v_ent from waterdrop.payout_entitlement where id=p_entitlement_id and player_id=v_player;
  if not found then return null; end if;
  return jsonb_build_object('id',v_ent.id,'amount',v_ent.amount,'promotionCode',v_ent.promotion_code,'tossPayoutKey',v_ent.toss_payout_key,'status',v_ent.status);
end;
$$;

create or replace function waterdrop.store_payout_key(
  p_auth_user_id uuid,p_identity_hash text,p_entitlement_id uuid,p_toss_payout_key text
) returns void
language plpgsql security definer
set search_path = pg_catalog, waterdrop
as $$
declare v_player uuid := waterdrop.resolve_player(p_auth_user_id,p_identity_hash); v_existing text;
begin
  if length(p_toss_payout_key) < 8 or length(p_toss_payout_key) > 200 then raise exception 'INVALID_PAYOUT_KEY'; end if;
  select toss_payout_key into v_existing from waterdrop.payout_entitlement where id=p_entitlement_id and player_id=v_player for update;
  if not found then raise exception 'PAYOUT_NOT_FOUND'; end if;
  if v_existing is not null and v_existing <> p_toss_payout_key then raise exception 'PAYOUT_KEY_IMMUTABLE'; end if;
  update waterdrop.payout_entitlement set toss_payout_key=coalesce(toss_payout_key,p_toss_payout_key),status='verifying',updated_at=now() where id=p_entitlement_id;
end;
$$;

create or replace function waterdrop.confirm_payout(
  p_auth_user_id uuid,p_identity_hash text,p_entitlement_id uuid,p_toss_payout_key text,p_result text,p_failure_code text default null
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, waterdrop
as $$
declare v_player uuid := waterdrop.resolve_player(p_auth_user_id,p_identity_hash); v_ent waterdrop.payout_entitlement%rowtype;
begin
  if p_result not in ('SUCCESS','PENDING','FAILED') then raise exception 'INVALID_PAYOUT_RESULT'; end if;
  select * into v_ent from waterdrop.payout_entitlement where id=p_entitlement_id and player_id=v_player for update;
  if not found then raise exception 'PAYOUT_NOT_FOUND'; end if;
  if v_ent.toss_payout_key is null or v_ent.toss_payout_key <> p_toss_payout_key then raise exception 'PAYOUT_KEY_MISMATCH'; end if;
  if v_ent.status='success' then return waterdrop.state_json(v_player); end if;
  update waterdrop.payout_entitlement set
    status=case p_result when 'SUCCESS' then 'success' when 'PENDING' then 'verifying' else 'failed_retryable' end,
    failure_code=case when p_result='FAILED' then coalesce(p_failure_code,'TOSS_FAILED') else null end,
    succeeded_at=case when p_result='SUCCESS' then now() else succeeded_at end,
    updated_at=now()
  where id=p_entitlement_id;
  return waterdrop.state_json(v_player);
end;
$$;

create or replace function waterdrop.record_payout_gateway_error(
  p_auth_user_id uuid,p_identity_hash text,p_entitlement_id uuid,p_stage text,p_failure_code text
) returns void
language plpgsql security definer
set search_path = pg_catalog, waterdrop
as $$
declare v_player uuid := waterdrop.resolve_player(p_auth_user_id,p_identity_hash);
begin
  if p_stage not in ('GET_KEY','EXECUTE','RESULT') then raise exception 'INVALID_GATEWAY_STAGE'; end if;
  if not exists(select 1 from waterdrop.payout_entitlement where id=p_entitlement_id and player_id=v_player) then raise exception 'PAYOUT_NOT_FOUND'; end if;
  insert into waterdrop.payout_gateway_error(entitlement_id,stage,failure_code) values(p_entitlement_id,p_stage,left(p_failure_code,100));
  update waterdrop.payout_entitlement set failure_code=coalesce(failure_code,left(p_failure_code,100)),updated_at=now() where id=p_entitlement_id;
end;
$$;

revoke all on schema waterdrop from public;
revoke all on all tables in schema waterdrop from public, anon, authenticated;
revoke all on all functions in schema waterdrop from public, anon, authenticated;
grant usage on schema waterdrop to service_role;
grant all on all tables in schema waterdrop to service_role;
grant usage, select on all sequences in schema waterdrop to service_role;
grant execute on all functions in schema waterdrop to service_role;
