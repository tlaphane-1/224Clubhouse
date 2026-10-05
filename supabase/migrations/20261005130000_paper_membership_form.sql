-- ============================================================
-- 224 Clubhouse — online application = the paper membership form (2026-10-05)
-- ============================================================
-- The owner's printed form (224 Clubhouse Membership Form) asks for more than
-- the online application did. This brings them in line:
--   * residential address and ID/passport number (now required)
--   * what the applicant uses cannabis for (+ "other" text)
--   * all six Agreement & Consent statements, each ticked
--   * a signature (drawn on screen, or typed as a fallback) and when it was signed
--   * the "224 Clubhouse use only" block: approved_by (stamped on approval)
--     and admin_notes (edited by admins; existing admin update policy covers it)
-- Existing rows are untouched (all new columns nullable).
-- DEPLOY TOGETHER WITH THE FRONTEND: the old application form doesn't send the
-- new fields, so place_membership would now reject it.
-- ============================================================

alter table memberships
  add column if not exists residential_address  text,
  add column if not exists consumption_reasons  text[],
  add column if not exists consumption_other    text,
  add column if not exists consents             jsonb,
  add column if not exists signature_image      text,
  add column if not exists signature_typed      text,
  add column if not exists signed_at            timestamptz,
  add column if not exists approved_by          text,
  add column if not exists admin_notes          text;

-- ---- place_membership: same signature (grants preserved), stricter body ---
create or replace function place_membership(p_customer jsonb, p_tier text, p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_email      text;
  v_tier       membership_tiers%rowtype;
  v_id         uuid;
  v_address    text := trim(coalesce(p_customer->>'residential_address', ''));
  v_id_number  text := trim(coalesce(p_customer->>'id_number', ''));
  v_reasons    text[];
  v_other      text := nullif(trim(coalesce(p_customer->>'consumption_other', '')), '');
  v_sig_image  text := nullif(p_customer->>'signature_image', '');
  v_sig_typed  text := nullif(trim(coalesce(p_customer->>'signature_typed', '')), '');
  -- The six statements on the paper form, in order.
  c_consents   constant text[] := array[
    'age_21', 'private_club', 'no_redistribution',
    'personal_use', 'code_of_conduct', 'release_liability'
  ];
begin
  if v_uid is null then
    raise exception 'Sign in required to apply for membership';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if coalesce(trim(v_email), '') = '' then
    raise exception 'Account has no email address';
  end if;

  select * into v_tier from membership_tiers
   where slug = p_tier and is_active
   limit 1;
  if not found then raise exception 'Invalid tier'; end if;

  if coalesce(trim(p_customer->>'full_name'), '') = ''
     or coalesce(trim(p_customer->>'phone'), '') = ''
     or coalesce(trim(p_customer->>'date_of_birth'), '') = ''
     or v_address = ''
     or v_id_number = '' then
    raise exception 'Missing required details';
  end if;
  -- Anti-abuse input caps (same idiom as contact_messages).
  if char_length(p_customer->>'full_name') > 200
     or char_length(p_customer->>'phone') > 50
     or char_length(v_id_number) > 20
     or char_length(v_address) > 500
     or char_length(coalesce(v_other, '')) > 200
     or char_length(coalesce(v_sig_typed, '')) > 200
     or char_length(coalesce(p_reference, '')) > 100 then
    raise exception 'Input too long';
  end if;
  if ((p_customer->>'date_of_birth')::date) > (current_date - interval '21 years') then
    raise exception 'Must be 21 or older';
  end if;

  -- What the applicant uses cannabis for: at least one known value.
  v_reasons := array(
    select distinct jsonb_array_elements_text(coalesce(p_customer->'consumption_reasons', '[]'::jsonb))
  );
  if cardinality(v_reasons) = 0 then
    raise exception 'Please tell us what you use cannabis for';
  end if;
  if exists (
    select 1 from unnest(v_reasons) r
     where r not in ('personal_wellness', 'recreational', 'medical', 'other')
  ) then
    raise exception 'Invalid reason';
  end if;
  if 'other' = any(v_reasons) and v_other is null then
    raise exception 'Please describe "Other"';
  end if;

  -- Every Agreement & Consent statement must be ticked.
  if exists (
    select 1 from unnest(c_consents) k
     where coalesce((p_customer->'consents'->>k)::boolean, false) is not true
  ) then
    raise exception 'All agreement statements must be ticked';
  end if;

  -- A signature: a drawn PNG (data URL, size-capped) or a typed name.
  if v_sig_image is null and v_sig_typed is null then
    raise exception 'Signature required';
  end if;
  if v_sig_image is not null
     and (left(v_sig_image, 22) <> 'data:image/png;base64,' or char_length(v_sig_image) > 300000) then
    raise exception 'Invalid signature';
  end if;

  -- One live application per account: no second pending, and no new
  -- application while an unexpired active membership exists.
  if exists (
    select 1 from memberships m
     where m.user_id = v_uid
       and (m.status = 'pending'
            or (m.status = 'active' and (m.expires_at is null or m.expires_at > now())))
  ) then
    raise exception 'You already have a pending or active membership';
  end if;

  insert into memberships (
    full_name, email, phone, date_of_birth, id_number, tier, tier_id,
    status, amount, duration_days, paystack_reference, starts_at, expires_at,
    user_id, status_history,
    residential_address, consumption_reasons, consumption_other,
    consents, signature_image, signature_typed, signed_at
  ) values (
    p_customer->>'full_name', v_email, p_customer->>'phone',
    (p_customer->>'date_of_birth')::date, v_id_number,
    v_tier.slug, v_tier.id,
    -- price AND duration snapshotted together: editing the tier later must not
    -- change what this applicant paid for or how long they get.
    'pending', v_tier.price_cents, v_tier.duration_days, nullif(trim(p_reference), ''), null, null,
    v_uid,
    jsonb_build_array(jsonb_build_object('status', 'pending', 'at', now(), 'actor', v_uid)),
    v_address, v_reasons, case when 'other' = any(v_reasons) then v_other end,
    (select jsonb_object_agg(k, true) from unnest(c_consents) k) || jsonb_build_object('accepted_at', now()),
    v_sig_image, v_sig_typed, now()
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'tier', v_tier.slug, 'amount', v_tier.price_cents, 'status', 'pending'
  );
end;
$$;

revoke execute on function place_membership(jsonb, text, text) from public, anon;
grant  execute on function place_membership(jsonb, text, text) to authenticated;

-- ---- admin_update_membership_status: also stamp "Approved by" -------------
-- Body is 20260813150000 verbatim except approved_by on activation.
create or replace function admin_update_membership_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       memberships%rowtype;
  v_days      int;
  v_is_active boolean;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('pending','active','expired','cancelled') then
    raise exception 'Invalid status';
  end if;

  select * into v_row from memberships where id = p_id for update;
  if not found then raise exception 'Membership not found'; end if;

  v_is_active := v_row.status = 'active'
                 and (v_row.expires_at is null or v_row.expires_at > now());

  if p_status = 'active' and not v_is_active then
    v_days := v_row.duration_days;
    if v_days is null then
      select t.duration_days into v_days from membership_tiers t where t.id = v_row.tier_id;
    end if;
    if v_days is null then
      select t.duration_days into v_days from membership_tiers t where t.slug = v_row.tier;
    end if;
    if v_days is null then
      raise exception 'Cannot determine tier duration for membership %', p_id;
    end if;

    update memberships
       set status         = 'active',
           approved_at    = now(),
           approved_by    = (select email from auth.users where id = auth.uid()),
           starts_at      = now(),
           expires_at     = now() + (v_days || ' days')::interval,
           status_history = coalesce(status_history, '[]'::jsonb)
                            || jsonb_build_object('status', 'active', 'at', now(), 'actor', auth.uid())
     where id = p_id
     returning * into v_row;
  else
    update memberships
       set status         = p_status,
           status_history = coalesce(status_history, '[]'::jsonb)
                            || jsonb_build_object('status', p_status, 'at', now(), 'actor', auth.uid())
     where id = p_id
     returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id, 'status', v_row.status,
    'starts_at', v_row.starts_at, 'expires_at', v_row.expires_at
  );
end;
$$;

revoke execute on function admin_update_membership_status(uuid, text) from public, anon;
grant  execute on function admin_update_membership_status(uuid, text) to authenticated;
