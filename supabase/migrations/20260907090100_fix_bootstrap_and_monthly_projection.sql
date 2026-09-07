-- Correct the session-binding FOUND lifetime and expose month-to-date successful points.

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
    'pointsToday', coalesce((
      select sum(amount)::integer from waterdrop.payout_entitlement
      where player_id = p_player_id and server_date = waterdrop.today_kst() and status = 'success'
    ), 0),
    'pointsMonth', coalesce((
      select sum(amount)::integer from waterdrop.payout_entitlement
      where player_id = p_player_id
        and status = 'success'
        and date_trunc('month', server_date::timestamp) = date_trunc('month', waterdrop.today_kst()::timestamp)
    ), 0),
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
  v_had_binding boolean := false;
begin
  if length(p_identity_hash) < 32 or length(p_identity_hash) > 128 then raise exception 'INVALID_IDENTITY_HASH'; end if;

  select * into v_bound from waterdrop.session_binding where auth_user_id = p_auth_user_id for update;
  v_had_binding := found;
  if v_had_binding and v_bound.identity_hash <> p_identity_hash then
    raise exception 'SESSION_IDENTITY_REBIND_FORBIDDEN';
  end if;

  select id into v_player from waterdrop.player where identity_hash = p_identity_hash for update;
  if v_player is null then
    insert into waterdrop.player(identity_hash) values (p_identity_hash) returning id into v_player;
  end if;

  if v_had_binding then
    if v_bound.player_id <> v_player then raise exception 'SESSION_PLAYER_MISMATCH'; end if;
    update waterdrop.session_binding set updated_at = now() where auth_user_id = p_auth_user_id;
  else
    insert into waterdrop.session_binding(auth_user_id, player_id, identity_hash)
    values (p_auth_user_id, v_player, p_identity_hash);
  end if;

  perform waterdrop.ensure_daily(v_player);
  return waterdrop.state_json(v_player);
end;
$$;
