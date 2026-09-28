-- ===========================================================================
-- docs/dev/remote-hub.sql: Dayspring remote control on the Lantern hub.
-- ---------------------------------------------------------------------------
-- NOT APPLIED. The owner reviews this and runs it himself, once, in the hub's
-- Supabase project: SQL Editor → New query → paste this whole file → Run.
-- It only ADDS things (three tables, a helper table, dayspring_remote_*
-- functions, policies, Realtime), and changes nothing Lantern already has.
-- Safe to run again.
--
-- What it's for: the owner signs in to Dayspring on several computers with his
-- one account; each computer is a "device" with its own keys; devices send
-- each other signed, end-to-end encrypted commands through this hub.
-- docs/dev/remote-protocol.md is the protocol, remote-security.md the threats.
--
-- Shape of the design (the same as Lantern's hub):
--   * Every table has Row Level Security ON. A person can SELECT only their
--     own rows (user_id = auth.uid()); nobody can insert, update or delete a
--     table directly. Every write is one of the dayspring_remote_* functions,
--     which check who is asking.
--   * Each device's hub session is bound to it (dayspring_remote_bindings,
--     readable by no one). A device can only act as itself, and only an
--     APPROVED device can approve another, change permissions, sign one out,
--     or send commands. So a stolen password alone (a new sign-in) makes at
--     most a "pending" device that can do nothing until approved on one of
--     the owner's existing devices.
--   * The hub stores only ciphertext for commands, answers, camera pictures and
--     device profiles. The devices check every signature themselves; nothing
--     here is trusted for that (a hub admin can't forge a command).
--   * Messages live at most 5 minutes (camera pieces 2), are deleted as soon
--     as the device picks them up, and everything expired is purged: every
--     5 minutes by pg_cron when the project has it, and also as messages are
--     sent.
--   * Rate limits: 600 messages a minute per account, 1000 waiting for any one
--     device, 20 devices per account, 10 pairing requests an hour, envelopes
--     up to 96 KB.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables ---

create table if not exists public.dayspring_remote_devices (
  id           text primary key check (id ~ '^dev_[a-f0-9]{20}$'),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  platform     text not null default '' check (char_length(platform) <= 40),
  app_version  text not null default '' check (char_length(app_version) <= 40),
  client       text not null default 'desk' check (client in ('desk', 'phone', 'web')),
  sign_pub     text not null check (char_length(sign_pub) between 40 and 200),   -- Ed25519, SPKI DER, base64
  enc_pub      text not null check (char_length(enc_pub) between 40 and 200),    -- X25519, SPKI DER, base64
  status       text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  cert         jsonb check (cert is null or pg_column_size(cert) <= 4096),         -- signed by the approving device
  perm_grant   jsonb check (perm_grant is null or pg_column_size(perm_grant) <= 2048),
  revocation   jsonb check (revocation is null or pg_column_size(revocation) <= 2048),
  profile      jsonb check (profile is null or pg_column_size(profile) <= 32768),  -- sealed to the owner's devices
  created_at   timestamptz not null default now(),
  approved_at  timestamptz,
  revoked_at   timestamptz,
  last_seen    timestamptz
);
create index if not exists dayspring_remote_devices_user on public.dayspring_remote_devices (user_id);

-- which hub session belongs to which device (no policies: only the functions read it)
create table if not exists public.dayspring_remote_bindings (
  device_id    text primary key references public.dayspring_remote_devices(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   text not null
);
create index if not exists dayspring_remote_bindings_session on public.dayspring_remote_bindings (session_id);

create table if not exists public.dayspring_remote_pairings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_id    text not null references public.dayspring_remote_devices(id) on delete cascade,
  approver_id  text references public.dayspring_remote_devices(id) on delete set null,
  offer        jsonb check (offer is null or pg_column_size(offer) <= 2048),
  approval     jsonb check (approval is null or pg_column_size(approval) <= 65536),
  status       text not null default 'open' check (status in ('open', 'offered', 'approved', 'rejected', 'cancelled')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '10 minutes'
);
create index if not exists dayspring_remote_pairings_user on public.dayspring_remote_pairings (user_id, status);

create table if not exists public.dayspring_remote_messages (
  id           uuid primary key,                       -- the envelope's own id (a second copy is refused)
  user_id      uuid not null references auth.users(id) on delete cascade,
  from_device  text not null references public.dayspring_remote_devices(id) on delete cascade,
  to_device    text not null references public.dayspring_remote_devices(id) on delete cascade,
  kind         text not null check (kind in ('cmd', 'resp', 'chunk')),
  reply_to     uuid,
  seq          integer not null default 0 check (seq between 0 and 999),
  envelope     jsonb not null check (pg_column_size(envelope) <= 98304),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists dayspring_remote_messages_inbox on public.dayspring_remote_messages (to_device, created_at);
create index if not exists dayspring_remote_messages_expiry on public.dayspring_remote_messages (expires_at);

create table if not exists public.dayspring_remote_usage (
  user_id      uuid not null references auth.users(id) on delete cascade,
  bucket       timestamptz not null,                   -- the minute
  kind         text not null default 'send',
  n            integer not null default 0,
  primary key (user_id, bucket, kind)
);

-- ------------------------------------------------------ row level security ---

alter table public.dayspring_remote_devices  enable row level security;
alter table public.dayspring_remote_bindings enable row level security;
alter table public.dayspring_remote_pairings enable row level security;
alter table public.dayspring_remote_messages enable row level security;
alter table public.dayspring_remote_usage    enable row level security;

drop policy if exists dayspring_remote_devices_own on public.dayspring_remote_devices;
create policy dayspring_remote_devices_own on public.dayspring_remote_devices
  for select to authenticated using (user_id = auth.uid());
drop policy if exists dayspring_remote_pairings_own on public.dayspring_remote_pairings;
create policy dayspring_remote_pairings_own on public.dayspring_remote_pairings
  for select to authenticated using (user_id = auth.uid());
drop policy if exists dayspring_remote_messages_own on public.dayspring_remote_messages;
create policy dayspring_remote_messages_own on public.dayspring_remote_messages
  for select to authenticated using (user_id = auth.uid());
-- (bindings and usage: no policies at all, so nobody reads them directly)

revoke all on public.dayspring_remote_devices, public.dayspring_remote_bindings, public.dayspring_remote_pairings,
              public.dayspring_remote_messages, public.dayspring_remote_usage from anon, authenticated;
grant select on public.dayspring_remote_devices, public.dayspring_remote_pairings, public.dayspring_remote_messages to authenticated;

-- --------------------------------------------------------------- helpers ---

create or replace function public.dayspring_remote_uid() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  return u;
end $$;

-- the device this hub session belongs to (null when none)
create or replace function public.dayspring_remote_caller() returns text
language sql stable security definer set search_path = public as $$
  select b.device_id from public.dayspring_remote_bindings b
  where b.user_id = auth.uid() and b.session_id = coalesce(auth.jwt() ->> 'session_id', '')
  limit 1
$$;

-- the caller must BE p_device (bound to this session); approved = must also be approved
create or replace function public.dayspring_remote_require(p_device text, p_approved boolean) returns void
language plpgsql stable security definer set search_path = public as $$
declare s text;
begin
  perform public.dayspring_remote_uid();
  if p_device is null or public.dayspring_remote_caller() is distinct from p_device then
    raise exception 'This sign-in doesn''t belong to that device.' using errcode = '42501';
  end if;
  select status into s from public.dayspring_remote_devices where id = p_device and user_id = auth.uid();
  if s is null or s = 'revoked' then raise exception 'This device was signed out.' using errcode = '42501'; end if;
  if p_approved and s <> 'approved' then raise exception 'This device hasn''t been approved yet.' using errcode = '42501'; end if;
end $$;

-- a simple per-minute counter; raises when over the limit
create or replace function public.dayspring_remote_count(p_kind text, p_limit integer, p_add integer default 1) returns void
language plpgsql security definer set search_path = public as $$
declare b timestamptz := date_trunc('minute', now()); c integer;
begin
  insert into public.dayspring_remote_usage (user_id, bucket, kind, n) values (auth.uid(), b, p_kind, p_add)
  on conflict (user_id, bucket, kind) do update set n = public.dayspring_remote_usage.n + p_add
  returning n into c;
  if c > p_limit then raise exception 'Too many requests. Wait a minute.' using errcode = 'P0429'; end if;
end $$;

create or replace function public.dayspring_remote_purge() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m integer; p integer; u integer;
begin
  delete from public.dayspring_remote_messages where expires_at < now();
  get diagnostics m = row_count;
  delete from public.dayspring_remote_pairings where expires_at < now() - interval '1 hour';
  get diagnostics p = row_count;
  delete from public.dayspring_remote_usage where bucket < now() - interval '2 hours';
  get diagnostics u = row_count;
  return jsonb_build_object('messages', m, 'pairings', p, 'usage', u);
end $$;

-- ------------------------------------------------------------- devices ---

-- Register this device (or come back as it). The account's first device is approved straight away (with its own
-- self-signed root certificate); every later one waits for approval on an approved device. A device coming back with
-- a NEW sign-in (its old session lost) goes back to pending unless it's the only device left.
create or replace function public.dayspring_remote_register(p_id text, p_name text, p_platform text, p_version text,
  p_client text, p_sign_pub text, p_enc_pub text, p_root_cert jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u uuid := public.dayspring_remote_uid();
  sid text := coalesce(auth.jwt() ->> 'session_id', '');
  d public.dayspring_remote_devices;
  others integer;
  bound text;
begin
  if sid = '' then raise exception 'This sign-in has no session id.' using errcode = '42501'; end if;
  select * into d from public.dayspring_remote_devices where id = p_id;
  select count(*) into others from public.dayspring_remote_devices where user_id = u and status = 'approved' and id <> p_id;
  if d.id is not null then
    if d.user_id <> u then raise exception 'That device id is taken.' using errcode = '42501'; end if;
    if d.sign_pub <> p_sign_pub or d.enc_pub <> p_enc_pub then raise exception 'That device already has other keys.' using errcode = '42501'; end if;
    if d.status = 'revoked' then return jsonb_build_object('id', d.id, 'status', 'revoked', 'first', false, 'server_time', now()); end if;
    if d.status = 'pending' and others = 0 then     -- nobody left to approve it: it becomes the first device again
      update public.dayspring_remote_devices set status = 'approved', cert = p_root_cert, approved_at = now() where id = d.id;
      d.status := 'approved';
    end if;
    select session_id into bound from public.dayspring_remote_bindings where device_id = d.id;
    if bound is distinct from sid then
      -- its keys are public, so anyone with the password could claim to be it: only once its own session has ended
      if bound is not null and exists (select 1 from auth.sessions s where s.id::text = bound) then
        raise exception 'This device is still signed in with another sign-in. Sign it out on one of your devices first.' using errcode = '42501';
      end if;
      insert into public.dayspring_remote_bindings (device_id, user_id, session_id) values (d.id, u, sid)
      on conflict (device_id) do update set session_id = excluded.session_id, user_id = excluded.user_id;
      if others > 0 then update public.dayspring_remote_devices set status = 'pending' where id = d.id; d.status := 'pending'; end if;
    end if;
    update public.dayspring_remote_devices set name = left(coalesce(nullif(trim(p_name), ''), name), 60), platform = left(coalesce(p_platform, ''), 40),
      app_version = left(coalesce(p_version, ''), 40), last_seen = now() where id = d.id;
    return jsonb_build_object('id', d.id, 'status', d.status, 'first', d.status = 'approved' and others = 0, 'server_time', now());
  end if;
  if (select count(*) from public.dayspring_remote_devices where user_id = u and status <> 'revoked') >= 20 then
    raise exception 'You have 20 devices already. Remove one first.' using errcode = 'P0429';
  end if;
  insert into public.dayspring_remote_devices (id, user_id, name, platform, app_version, client, sign_pub, enc_pub, status, cert, approved_at, last_seen)
  values (p_id, u, left(coalesce(nullif(trim(p_name), ''), 'Dayspring'), 60), left(coalesce(p_platform, ''), 40), left(coalesce(p_version, ''), 40),
          coalesce(nullif(p_client, ''), 'desk'), p_sign_pub, p_enc_pub,
          case when others = 0 then 'approved' else 'pending' end,
          case when others = 0 then p_root_cert else null end,
          case when others = 0 then now() else null end, now());
  insert into public.dayspring_remote_bindings (device_id, user_id, session_id) values (p_id, u, sid)
  on conflict (device_id) do update set session_id = excluded.session_id;
  return jsonb_build_object('id', p_id, 'status', case when others = 0 then 'approved' else 'pending' end, 'first', others = 0, 'server_time', now());
end $$;

create or replace function public.dayspring_remote_heartbeat(p_device text, p_version text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s text;
begin
  perform public.dayspring_remote_uid();
  select status into s from public.dayspring_remote_devices where id = p_device and user_id = auth.uid();
  if s is null then return jsonb_build_object('status', 'unknown', 'server_time', now()); end if;
  if public.dayspring_remote_caller() is distinct from p_device then return jsonb_build_object('status', case when s = 'revoked' then 'revoked' else 'unbound' end, 'server_time', now()); end if;
  update public.dayspring_remote_devices set last_seen = now(), app_version = left(coalesce(p_version, app_version), 40) where id = p_device;
  return jsonb_build_object('status', s, 'server_time', now());
end $$;

create or replace function public.dayspring_remote_rename(p_device text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare c text := public.dayspring_remote_caller();
begin
  perform public.dayspring_remote_require(c, c is distinct from p_device);   -- rename yourself any time; others only when approved
  if coalesce(trim(p_name), '') = '' then raise exception 'Give it a name.'; end if;
  update public.dayspring_remote_devices set name = left(trim(p_name), 60) where id = p_device and user_id = auth.uid() and status <> 'revoked';
end $$;

create or replace function public.dayspring_remote_set_grant(p_device text, p_grant jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c text := public.dayspring_remote_caller();
begin
  perform public.dayspring_remote_require(c, true);
  if (p_grant ->> 'device') is distinct from p_device or (p_grant ->> 'by') is distinct from c then raise exception 'That permission change isn''t for this device.'; end if;
  update public.dayspring_remote_devices set perm_grant = p_grant where id = p_device and user_id = auth.uid() and status = 'approved';
end $$;

create or replace function public.dayspring_remote_set_profile(p_device text, p_profile jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.dayspring_remote_require(p_device, true);
  update public.dayspring_remote_devices set profile = p_profile where id = p_device and user_id = auth.uid();
end $$;

-- Sign a device out for good: by an approved device, or by the device itself. Its waiting messages and pairing
-- requests go, its binding goes, and its hub session is ended too (so its refresh token stops working).
create or replace function public.dayspring_remote_revoke(p_device text, p_revocation jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c text := public.dayspring_remote_caller(); sid text;
begin
  perform public.dayspring_remote_require(c, c is distinct from p_device);
  if (p_revocation ->> 'device') is distinct from p_device or (p_revocation ->> 'by') is distinct from c then raise exception 'That sign-out isn''t for this device.'; end if;
  update public.dayspring_remote_devices set status = 'revoked', revocation = p_revocation, revoked_at = now(), profile = null
  where id = p_device and user_id = auth.uid();
  delete from public.dayspring_remote_messages where user_id = auth.uid() and (to_device = p_device or from_device = p_device);
  delete from public.dayspring_remote_pairings where user_id = auth.uid() and device_id = p_device;
  delete from public.dayspring_remote_bindings where device_id = p_device returning session_id into sid;
  if sid is not null and sid <> '' then
    begin
      delete from auth.sessions where id = sid::uuid and user_id = auth.uid();
    exception when others then null;   -- if this project doesn't allow it, the device still can't act (no binding)
    end;
  end if;
end $$;

create or replace function public.dayspring_remote_forget(p_device text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.dayspring_remote_require(public.dayspring_remote_caller(), true);
  delete from public.dayspring_remote_devices where id = p_device and user_id = auth.uid() and status = 'revoked';
end $$;

-- ------------------------------------------------------------- pairing ---

create or replace function public.dayspring_remote_pair_open(p_device text) returns public.dayspring_remote_pairings
language plpgsql security definer set search_path = public as $$
declare r public.dayspring_remote_pairings; s text;
begin
  perform public.dayspring_remote_require(p_device, false);
  select status into s from public.dayspring_remote_devices where id = p_device;
  if s <> 'pending' then raise exception 'This device is already approved.'; end if;
  if (select count(*) from public.dayspring_remote_pairings where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many requests to join. Wait a while.' using errcode = 'P0429';
  end if;
  update public.dayspring_remote_pairings set status = 'cancelled' where device_id = p_device and status in ('open', 'offered');
  insert into public.dayspring_remote_pairings (user_id, device_id) values (auth.uid(), p_device) returning * into r;
  return r;
end $$;

-- an approved device answers a request with its keys (the first answer wins; a second is refused)
create or replace function public.dayspring_remote_pair_offer(p_pairing uuid, p_device text, p_offer jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.dayspring_remote_require(p_device, true);
  if (p_offer ->> 'approver') is distinct from p_device or (p_offer ->> 'pairing') is distinct from p_pairing::text then raise exception 'That answer isn''t for this request.'; end if;
  update public.dayspring_remote_pairings set approver_id = p_device, offer = p_offer, status = 'offered'
  where id = p_pairing and user_id = auth.uid() and status = 'open' and expires_at > now() and device_id <> p_device;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'That request has expired or was already answered.'; end if;
end $$;

create or replace function public.dayspring_remote_pair_approve(p_pairing uuid, p_device text, p_cert jsonb, p_grant jsonb, p_approval jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.dayspring_remote_pairings;
begin
  perform public.dayspring_remote_require(p_device, true);
  select * into r from public.dayspring_remote_pairings where id = p_pairing and user_id = auth.uid() for update;
  if r.id is null or r.status <> 'offered' or r.approver_id is distinct from p_device or r.expires_at < now() then raise exception 'That request has expired or was answered by another device.'; end if;
  if (p_cert ->> 'device') is distinct from r.device_id or (p_cert ->> 'by') is distinct from p_device then raise exception 'That approval isn''t for this request.'; end if;
  update public.dayspring_remote_pairings set status = 'approved', approval = p_approval where id = p_pairing;
  update public.dayspring_remote_devices set status = 'approved', cert = p_cert, perm_grant = p_grant, approved_at = now()
  where id = r.device_id and user_id = auth.uid() and status = 'pending';
end $$;

-- the new device cancels (the codes didn't match), or an approved device turns it down
create or replace function public.dayspring_remote_pair_cancel(p_pairing uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.dayspring_remote_uid();
  update public.dayspring_remote_pairings set status = 'cancelled'
  where id = p_pairing and user_id = auth.uid() and status in ('open', 'offered') and device_id = public.dayspring_remote_caller();
end $$;
create or replace function public.dayspring_remote_pair_reject(p_pairing uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.dayspring_remote_require(public.dayspring_remote_caller(), true);
  update public.dayspring_remote_pairings set status = 'rejected' where id = p_pairing and user_id = auth.uid() and status in ('open', 'offered');
end $$;

-- ------------------------------------------------------------ messages ---

create or replace function public.dayspring_remote_send(p_id uuid, p_from text, p_to text, p_kind text, p_reply_to uuid,
  p_seq integer, p_ttl_seconds integer, p_envelope jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ttl integer := least(greatest(coalesce(p_ttl_seconds, 60), 5), case when p_kind = 'chunk' then 120 else 300 end);
begin
  perform public.dayspring_remote_require(p_from, true);
  if p_to = p_from or not exists (select 1 from public.dayspring_remote_devices where id = p_to and user_id = auth.uid() and status = 'approved') then
    raise exception 'That device isn''t one of your approved devices.';
  end if;
  if (p_envelope ->> 'id') is distinct from p_id::text or (p_envelope ->> 'from') is distinct from p_from or (p_envelope ->> 'to') is distinct from p_to
     or (p_envelope ->> 'kind') is distinct from p_kind then
    raise exception 'The message doesn''t match its envelope.';
  end if;
  perform public.dayspring_remote_count('send', 600);
  if (select count(*) from public.dayspring_remote_messages where to_device = p_to) >= 1000 then
    raise exception 'That device has too many messages waiting.' using errcode = 'P0429';
  end if;
  insert into public.dayspring_remote_messages (id, user_id, from_device, to_device, kind, reply_to, seq, envelope, expires_at)
  values (p_id, auth.uid(), p_from, p_to, p_kind, p_reply_to, coalesce(p_seq, 0), p_envelope, now() + make_interval(secs => ttl));
  if random() < 0.05 then perform public.dayspring_remote_purge(); end if;
  return jsonb_build_object('id', p_id, 'expires_at', now() + make_interval(secs => ttl));
end $$;

create or replace function public.dayspring_remote_inbox(p_device text) returns setof public.dayspring_remote_messages
language plpgsql security definer set search_path = public as $$
begin
  perform public.dayspring_remote_require(p_device, true);
  return query select * from public.dayspring_remote_messages
    where to_device = p_device and user_id = auth.uid() and expires_at > now() order by created_at, seq limit 200;
end $$;

create or replace function public.dayspring_remote_ack(p_device text, p_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.dayspring_remote_require(p_device, true);
  delete from public.dayspring_remote_messages where to_device = p_device and user_id = auth.uid() and id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------- who may call what ---

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'dayspring\_remote\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname in ('dayspring_remote_uid', 'dayspring_remote_caller', 'dayspring_remote_require', 'dayspring_remote_count', 'dayspring_remote_purge') then
      execute format('revoke all on function %s from authenticated', f.sig);      -- internal helpers
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------- realtime ---
-- Live updates (postgres_changes) for the three tables, so a device hears about a command at once instead of on its
-- next look. Realtime applies the SELECT policies above, so each person only hears about their own rows.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dayspring_remote_messages') then
      alter publication supabase_realtime add table public.dayspring_remote_messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dayspring_remote_devices') then
      alter publication supabase_realtime add table public.dayspring_remote_devices;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dayspring_remote_pairings') then
      alter publication supabase_realtime add table public.dayspring_remote_pairings;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------- purge ---
-- Every 5 minutes, when the project has pg_cron (Database → Extensions → pg_cron). Without it, sending purges now
-- and then, and the devices delete what they pick up.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'dayspring-remote-purge';
    perform cron.schedule('dayspring-remote-purge', '*/5 * * * *', 'select public.dayspring_remote_purge()');
  end if;
end $$;
