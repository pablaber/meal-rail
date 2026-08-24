create schema if not exists mealrail_private;

revoke all on schema mealrail_private from public;
revoke all on schema mealrail_private from anon;
revoke all on schema mealrail_private from authenticated;

create table public.sync_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seq bigint not null default 0 check (seq >= 0),
  created_at timestamptz not null default pg_catalog.now()
);

create table public.sync_resources (
  user_id uuid not null references public.sync_accounts (user_id) on delete cascade,
  kind text not null,
  key text not null,
  rev bigint not null check (rev >= 1),
  seq bigint not null check (seq >= 1),
  deleted boolean not null default false,
  payload_version integer,
  payload jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  deleted_at timestamptz,
  updated_by uuid,
  primary key (user_id, kind, key),
  unique (user_id, seq),
  constraint sync_resources_address_check check (
    (kind = 'settings' and key = 'settings')
    or
    (
      kind = 'day'
      and case
        when key !~ '^\d{4}-\d{2}-\d{2}$' then false
        when pg_catalog.substring(key, 1, 4)::integer < 100 then false
        when pg_catalog.substring(key, 6, 2)::integer not between 1 and 12 then false
        when pg_catalog.substring(key, 9, 2)::integer not between 1 and 31 then false
        else pg_catalog.to_char(
          pg_catalog.to_date(key, 'FXYYYY-MM-DD'),
          'YYYY-MM-DD'
        ) = key
      end
    )
  ),
  constraint sync_resources_state_check check (
    (
      deleted = false
      and payload_version >= 1
      and payload is not null
      and pg_catalog.jsonb_typeof(payload) = 'object'
      and deleted_at is null
    )
    or
    (
      deleted = true
      and kind = 'day'
      and payload_version is null
      and payload is null
      and deleted_at is not null
      and deleted_at = updated_at
    )
  ),
  constraint sync_resources_payload_size_check check (
    deleted
    or pg_catalog.octet_length(payload::text) <= case kind
      when 'day' then 65536
      when 'settings' then 262144
    end
  ),
  constraint sync_resources_timestamps_check check (updated_at >= created_at)
);

create table public.sync_devices (
  user_id uuid not null references public.sync_accounts (user_id) on delete cascade,
  device_id uuid not null,
  label text not null,
  platform text not null,
  first_seen_at timestamptz not null default pg_catalog.now(),
  last_seen_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, device_id),
  constraint sync_devices_timestamps_check check (last_seen_at >= first_seen_at)
);

create table public.sync_mutations (
  user_id uuid not null references public.sync_accounts (user_id) on delete cascade,
  mutation_id uuid not null,
  kind text not null,
  key text not null,
  op text not null check (op in ('write', 'delete')),
  applied_rev bigint not null check (applied_rev >= 1),
  applied_seq bigint not null check (applied_seq >= 1),
  applied_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, mutation_id),
  constraint sync_mutations_address_check check (
    (kind = 'settings' and key = 'settings' and op = 'write')
    or
    (
      kind = 'day'
      and case
        when key !~ '^\d{4}-\d{2}-\d{2}$' then false
        when pg_catalog.substring(key, 1, 4)::integer < 100 then false
        when pg_catalog.substring(key, 6, 2)::integer not between 1 and 12 then false
        when pg_catalog.substring(key, 9, 2)::integer not between 1 and 31 then false
        else pg_catalog.to_char(
          pg_catalog.to_date(key, 'FXYYYY-MM-DD'),
          'YYYY-MM-DD'
        ) = key
      end
    )
  )
);

create index sync_resources_live_day_retention_idx
  on public.sync_resources (key)
  where kind = 'day' and deleted = false;

create index sync_resources_tombstone_retention_idx
  on public.sync_resources (key, deleted_at)
  where kind = 'day' and deleted = true;

create index sync_mutations_retention_idx
  on public.sync_mutations (applied_at);

alter table public.sync_accounts enable row level security;
alter table public.sync_resources enable row level security;
alter table public.sync_devices enable row level security;
alter table public.sync_mutations enable row level security;

create policy sync_accounts_owner
  on public.sync_accounts
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy sync_resources_owner
  on public.sync_resources
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy sync_devices_owner
  on public.sync_devices
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy sync_mutations_owner
  on public.sync_mutations
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on table public.sync_accounts from public, anon, authenticated;
revoke all on table public.sync_resources from public, anon, authenticated;
revoke all on table public.sync_devices from public, anon, authenticated;
revoke all on table public.sync_mutations from public, anon, authenticated;

grant select, insert, update, delete on table public.sync_accounts to authenticated;
grant select, insert, update, delete on table public.sync_resources to authenticated;
grant select, insert, update, delete on table public.sync_devices to authenticated;
grant select, insert, delete on table public.sync_mutations to authenticated;

create or replace function public.sync_pull(
  p_protocol integer,
  p_since_seq bigint,
  p_limit integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_limit integer;
  v_rows jsonb;
  v_next_seq bigint;
  v_has_more boolean;
  v_account_created_at timestamptz;
  v_write_floor text;
begin
  if p_protocol is distinct from 1 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'unsupported_protocol',
      'supported', pg_catalog.jsonb_build_array(1)
    );
  end if;

  if p_since_seq is null or p_since_seq < 0 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_since_seq',
      'detail', 'must be a non-negative integer'
    );
  end if;

  if p_limit is not null and p_limit <= 0 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_limit',
      'detail', 'must be a positive integer'
    );
  end if;

  v_limit := least(coalesce(p_limit, 200), 500);
  v_write_floor := pg_catalog.to_char(
    ((v_now at time zone 'UTC')::date - 401),
    'YYYY-MM-DD'
  );

  insert into public.sync_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select a.created_at
    into v_account_created_at
    from public.sync_accounts as a
   where a.user_id = v_user_id;

  with candidates as (
    select
      r as resource,
      r.seq,
      pg_catalog.row_number() over (order by r.seq) as ordinal
    from public.sync_resources as r
    where r.user_id = v_user_id
      and r.seq > p_since_seq
    order by r.seq
    limit v_limit + 1
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'kind', (c.resource).kind,
          'key', (c.resource).key,
          'rev', (c.resource).rev,
          'seq', (c.resource).seq,
          'deleted', (c.resource).deleted,
          'payload_version', (c.resource).payload_version,
          'payload', (c.resource).payload,
          'created_at', pg_catalog.to_char((c.resource).created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'updated_at', pg_catalog.to_char((c.resource).updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'deleted_at', case
            when (c.resource).deleted_at is null then null
            else pg_catalog.to_char((c.resource).deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          end,
          'updated_by', (c.resource).updated_by
        )
        order by c.seq
      ) filter (where c.ordinal <= v_limit),
      '[]'::jsonb
    ),
    coalesce(
      pg_catalog.max(c.seq) filter (where c.ordinal <= v_limit),
      p_since_seq
    ),
    pg_catalog.count(*) > v_limit
  into v_rows, v_next_seq, v_has_more
  from candidates as c;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'protocol', 1,
    'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'result', 'page',
    'rows', v_rows,
    'next_seq', v_next_seq,
    'has_more', v_has_more,
    'write_floor', v_write_floor,
    'account', pg_catalog.jsonb_build_object(
      'user_id', v_user_id,
      'created_at', pg_catalog.to_char(v_account_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
end;
$$;

create or replace function public.sync_write(
  p_protocol integer,
  p_mutation_id uuid,
  p_device_id uuid,
  p_kind text,
  p_key text,
  p_expected_rev bigint,
  p_payload_version integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_floor text;
  v_size integer;
  v_limit integer;
  v_seq bigint;
  v_resource public.sync_resources%rowtype;
  v_mutation public.sync_mutations%rowtype;
  v_current jsonb;
  v_found boolean;
  v_key_valid boolean := false;
begin
  if p_protocol is distinct from 1 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'unsupported_protocol',
      'supported', pg_catalog.jsonb_build_array(1)
    );
  end if;

  if p_mutation_id is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_mutation_id',
      'detail', 'must be a UUID'
    );
  end if;

  insert into public.sync_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  perform a.user_id
    from public.sync_accounts as a
   where a.user_id = v_user_id
   for update;

  select m.*
    into v_mutation
    from public.sync_mutations as m
   where m.user_id = v_user_id
     and m.mutation_id = p_mutation_id;

  if found then
    select pg_catalog.jsonb_build_object(
      'kind', r.kind,
      'key', r.key,
      'rev', r.rev,
      'seq', r.seq,
      'deleted', r.deleted,
      'payload_version', r.payload_version,
      'payload', r.payload,
      'created_at', pg_catalog.to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updated_at', pg_catalog.to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deleted_at', case
        when r.deleted_at is null then null
        else pg_catalog.to_char(r.deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      end,
      'updated_by', r.updated_by
    )
      into v_current
      from public.sync_resources as r
     where r.user_id = v_user_id
       and r.kind = v_mutation.kind
       and r.key = v_mutation.key;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'duplicate',
      'resource', v_current,
      'applied_rev', v_mutation.applied_rev
    );
  end if;

  if p_device_id is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_device_id',
      'detail', 'must be a UUID'
    );
  end if;

  if p_kind is null or p_kind not in ('settings', 'day') then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_kind',
      'detail', 'must be settings or day'
    );
  end if;

  if p_kind = 'settings' then
    v_key_valid := p_key = 'settings';
  elsif p_key ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_key_valid :=
        pg_catalog.substring(p_key, 1, 4)::integer >= 100
        and pg_catalog.substring(p_key, 6, 2)::integer between 1 and 12
        and pg_catalog.substring(p_key, 9, 2)::integer between 1 and 31
        and pg_catalog.to_char(
          pg_catalog.to_date(p_key, 'FXYYYY-MM-DD'),
          'YYYY-MM-DD'
        ) = p_key;
    exception
      when datetime_field_overflow then
        v_key_valid := false;
    end;
  end if;

  if not coalesce(v_key_valid, false) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_key',
      'detail', 'must name a valid resource key'
    );
  end if;

  if p_expected_rev is null or p_expected_rev < 0 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_expected_rev',
      'detail', 'must be a non-negative integer'
    );
  end if;

  if p_payload_version is null or p_payload_version < 1 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_payload_version',
      'detail', 'must be a positive integer'
    );
  end if;

  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_payload',
      'detail', 'must be a non-null JSON object'
    );
  end if;

  v_floor := pg_catalog.to_char(
    ((v_now at time zone 'UTC')::date - 401),
    'YYYY-MM-DD'
  );

  if p_kind = 'day' and p_key < v_floor then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'expired',
      'floor', v_floor
    );
  end if;

  v_size := pg_catalog.octet_length(p_payload::text);
  v_limit := case p_kind
    when 'day' then 65536
    when 'settings' then 262144
  end;

  if v_size > v_limit then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'too_large',
      'limit', v_limit,
      'size', v_size
    );
  end if;

  select r.*
    into v_resource
    from public.sync_resources as r
   where r.user_id = v_user_id
     and r.kind = p_kind
     and r.key = p_key;
  v_found := found;

  if v_found then
    v_current := pg_catalog.jsonb_build_object(
      'kind', v_resource.kind,
      'key', v_resource.key,
      'rev', v_resource.rev,
      'seq', v_resource.seq,
      'deleted', v_resource.deleted,
      'payload_version', v_resource.payload_version,
      'payload', v_resource.payload,
      'created_at', pg_catalog.to_char(v_resource.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updated_at', pg_catalog.to_char(v_resource.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deleted_at', case
        when v_resource.deleted_at is null then null
        else pg_catalog.to_char(v_resource.deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      end,
      'updated_by', v_resource.updated_by
    );
  else
    v_current := null;
  end if;

  if not v_found and p_expected_rev > 0 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'absent',
      'current', null
    );
  end if;

  if v_found and v_resource.deleted and p_expected_rev = 0 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'deleted',
      'current', v_current
    );
  end if;

  if v_found and v_resource.rev <> p_expected_rev then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'stale',
      'current', v_current
    );
  end if;

  update public.sync_accounts as a
     set seq = a.seq + 1
   where a.user_id = v_user_id
  returning a.seq into v_seq;

  if v_found then
    update public.sync_resources as r
       set rev = r.rev + 1,
           seq = v_seq,
           deleted = false,
           payload_version = p_payload_version,
           payload = p_payload,
           updated_at = v_now,
           deleted_at = null,
           updated_by = p_device_id
     where r.user_id = v_user_id
       and r.kind = p_kind
       and r.key = p_key
    returning r.* into v_resource;
  else
    insert into public.sync_resources (
      user_id,
      kind,
      key,
      rev,
      seq,
      deleted,
      payload_version,
      payload,
      created_at,
      updated_at,
      deleted_at,
      updated_by
    )
    values (
      v_user_id,
      p_kind,
      p_key,
      1,
      v_seq,
      false,
      p_payload_version,
      p_payload,
      v_now,
      v_now,
      null,
      p_device_id
    )
    returning public.sync_resources.* into v_resource;
  end if;

  insert into public.sync_mutations (
    user_id,
    mutation_id,
    kind,
    key,
    op,
    applied_rev,
    applied_seq,
    applied_at
  )
  values (
    v_user_id,
    p_mutation_id,
    p_kind,
    p_key,
    'write',
    v_resource.rev,
    v_resource.seq,
    v_now
  );

  v_current := pg_catalog.jsonb_build_object(
    'kind', v_resource.kind,
    'key', v_resource.key,
    'rev', v_resource.rev,
    'seq', v_resource.seq,
    'deleted', v_resource.deleted,
    'payload_version', v_resource.payload_version,
    'payload', v_resource.payload,
    'created_at', pg_catalog.to_char(v_resource.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updated_at', pg_catalog.to_char(v_resource.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deleted_at', null,
    'updated_by', v_resource.updated_by
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'protocol', 1,
    'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'result', 'applied',
    'resource', v_current
  );
end;
$$;

create or replace function public.sync_delete(
  p_protocol integer,
  p_mutation_id uuid,
  p_device_id uuid,
  p_kind text,
  p_key text,
  p_expected_rev bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_floor text;
  v_seq bigint;
  v_resource public.sync_resources%rowtype;
  v_mutation public.sync_mutations%rowtype;
  v_current jsonb;
  v_found boolean;
  v_key_valid boolean := false;
begin
  if p_protocol is distinct from 1 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'unsupported_protocol',
      'supported', pg_catalog.jsonb_build_array(1)
    );
  end if;

  if p_mutation_id is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_mutation_id',
      'detail', 'must be a UUID'
    );
  end if;

  insert into public.sync_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  perform a.user_id
    from public.sync_accounts as a
   where a.user_id = v_user_id
   for update;

  select m.*
    into v_mutation
    from public.sync_mutations as m
   where m.user_id = v_user_id
     and m.mutation_id = p_mutation_id;

  if found then
    select pg_catalog.jsonb_build_object(
      'kind', r.kind,
      'key', r.key,
      'rev', r.rev,
      'seq', r.seq,
      'deleted', r.deleted,
      'payload_version', r.payload_version,
      'payload', r.payload,
      'created_at', pg_catalog.to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updated_at', pg_catalog.to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deleted_at', case
        when r.deleted_at is null then null
        else pg_catalog.to_char(r.deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      end,
      'updated_by', r.updated_by
    )
      into v_current
      from public.sync_resources as r
     where r.user_id = v_user_id
       and r.kind = v_mutation.kind
       and r.key = v_mutation.key;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'duplicate',
      'resource', v_current,
      'applied_rev', v_mutation.applied_rev
    );
  end if;

  if p_device_id is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_device_id',
      'detail', 'must be a UUID'
    );
  end if;

  if p_kind is null or p_kind not in ('settings', 'day') then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_kind',
      'detail', 'must be day'
    );
  end if;

  if p_kind = 'settings' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_kind',
      'detail', 'settings cannot be deleted'
    );
  end if;

  if p_key ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_key_valid :=
        pg_catalog.substring(p_key, 1, 4)::integer >= 100
        and pg_catalog.substring(p_key, 6, 2)::integer between 1 and 12
        and pg_catalog.substring(p_key, 9, 2)::integer between 1 and 31
        and pg_catalog.to_char(
          pg_catalog.to_date(p_key, 'FXYYYY-MM-DD'),
          'YYYY-MM-DD'
        ) = p_key;
    exception
      when datetime_field_overflow then
        v_key_valid := false;
    end;
  end if;

  if not coalesce(v_key_valid, false) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_key',
      'detail', 'must name a real calendar date as YYYY-MM-DD'
    );
  end if;

  if p_expected_rev is null or p_expected_rev <= 0 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_expected_rev',
      'detail', 'a delete must name a positive revision'
    );
  end if;

  v_floor := pg_catalog.to_char(
    ((v_now at time zone 'UTC')::date - 401),
    'YYYY-MM-DD'
  );

  if p_key < v_floor then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'expired',
      'floor', v_floor
    );
  end if;

  select r.*
    into v_resource
    from public.sync_resources as r
   where r.user_id = v_user_id
     and r.kind = p_kind
     and r.key = p_key;
  v_found := found;

  if not v_found then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'absent',
      'current', null
    );
  end if;

  v_current := pg_catalog.jsonb_build_object(
    'kind', v_resource.kind,
    'key', v_resource.key,
    'rev', v_resource.rev,
    'seq', v_resource.seq,
    'deleted', v_resource.deleted,
    'payload_version', v_resource.payload_version,
    'payload', v_resource.payload,
    'created_at', pg_catalog.to_char(v_resource.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updated_at', pg_catalog.to_char(v_resource.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deleted_at', case
      when v_resource.deleted_at is null then null
      else pg_catalog.to_char(v_resource.deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    end,
    'updated_by', v_resource.updated_by
  );

  if v_resource.rev <> p_expected_rev then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'stale',
      'current', v_current
    );
  end if;

  if v_resource.deleted then
    insert into public.sync_mutations (
      user_id,
      mutation_id,
      kind,
      key,
      op,
      applied_rev,
      applied_seq,
      applied_at
    )
    values (
      v_user_id,
      p_mutation_id,
      p_kind,
      p_key,
      'delete',
      v_resource.rev,
      v_resource.seq,
      v_now
    );

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'already_deleted',
      'resource', v_current
    );
  end if;

  update public.sync_accounts as a
     set seq = a.seq + 1
   where a.user_id = v_user_id
  returning a.seq into v_seq;

  update public.sync_resources as r
     set rev = r.rev + 1,
         seq = v_seq,
         deleted = true,
         payload_version = null,
         payload = null,
         updated_at = v_now,
         deleted_at = v_now,
         updated_by = p_device_id
   where r.user_id = v_user_id
     and r.kind = p_kind
     and r.key = p_key
  returning r.* into v_resource;

  insert into public.sync_mutations (
    user_id,
    mutation_id,
    kind,
    key,
    op,
    applied_rev,
    applied_seq,
    applied_at
  )
  values (
    v_user_id,
    p_mutation_id,
    p_kind,
    p_key,
    'delete',
    v_resource.rev,
    v_resource.seq,
    v_now
  );

  v_current := pg_catalog.jsonb_build_object(
    'kind', v_resource.kind,
    'key', v_resource.key,
    'rev', v_resource.rev,
    'seq', v_resource.seq,
    'deleted', true,
    'payload_version', null,
    'payload', null,
    'created_at', pg_catalog.to_char(v_resource.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updated_at', pg_catalog.to_char(v_resource.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deleted_at', pg_catalog.to_char(v_resource.deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updated_by', v_resource.updated_by
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'protocol', 1,
    'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'result', 'applied',
    'resource', v_current
  );
end;
$$;

create or replace function public.sync_touch_device(
  p_protocol integer,
  p_device_id uuid,
  p_label text,
  p_platform text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_device public.sync_devices%rowtype;
begin
  if p_protocol is distinct from 1 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'unsupported_protocol',
      'supported', pg_catalog.jsonb_build_array(1)
    );
  end if;

  if p_device_id is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_device_id',
      'detail', 'must be a UUID'
    );
  end if;

  if p_label is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_label',
      'detail', 'must be a string'
    );
  end if;

  if p_platform is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_platform',
      'detail', 'must be a string'
    );
  end if;

  insert into public.sync_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  perform a.user_id
    from public.sync_accounts as a
   where a.user_id = v_user_id
   for update;

  insert into public.sync_devices (
    user_id,
    device_id,
    label,
    platform,
    first_seen_at,
    last_seen_at
  )
  values (
    v_user_id,
    p_device_id,
    p_label,
    p_platform,
    v_now,
    v_now
  )
  on conflict (user_id, device_id) do update
    set label = excluded.label,
        platform = excluded.platform,
        last_seen_at = excluded.last_seen_at
  returning public.sync_devices.* into v_device;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'protocol', 1,
    'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'result', 'applied',
    'device', pg_catalog.jsonb_build_object(
      'device_id', v_device.device_id,
      'label', v_device.label,
      'platform', v_device.platform,
      'first_seen_at', pg_catalog.to_char(v_device.first_seen_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'last_seen_at', pg_catalog.to_char(v_device.last_seen_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
end;
$$;

create or replace function public.sync_purge(
  p_protocol integer,
  p_confirm text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_resources bigint;
  v_mutations bigint;
  v_devices bigint;
begin
  if p_protocol is distinct from 1 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'unsupported_protocol',
      'supported', pg_catalog.jsonb_build_array(1)
    );
  end if;

  if p_confirm is distinct from 'DELETE' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'protocol', 1,
      'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'result', 'invalid',
      'field', 'p_confirm',
      'detail', 'must be the literal DELETE'
    );
  end if;

  insert into public.sync_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  perform a.user_id
    from public.sync_accounts as a
   where a.user_id = v_user_id
   for update;

  delete from public.sync_resources as r
   where r.user_id = v_user_id;
  get diagnostics v_resources = row_count;

  delete from public.sync_mutations as m
   where m.user_id = v_user_id;
  get diagnostics v_mutations = row_count;

  delete from public.sync_devices as d
   where d.user_id = v_user_id;
  get diagnostics v_devices = row_count;

  delete from public.sync_accounts as a
   where a.user_id = v_user_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'protocol', 1,
    'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'result', 'purged',
    'removed', pg_catalog.jsonb_build_object(
      'resources', v_resources,
      'mutations', v_mutations,
      'devices', v_devices
    )
  );
end;
$$;

revoke all on function public.sync_pull(integer, bigint, integer) from public, anon, authenticated;
revoke all on function public.sync_write(integer, uuid, uuid, text, text, bigint, integer, jsonb) from public, anon, authenticated;
revoke all on function public.sync_delete(integer, uuid, uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.sync_touch_device(integer, uuid, text, text) from public, anon, authenticated;
revoke all on function public.sync_purge(integer, text) from public, anon, authenticated;

grant execute on function public.sync_pull(integer, bigint, integer) to authenticated;
grant execute on function public.sync_write(integer, uuid, uuid, text, text, bigint, integer, jsonb) to authenticated;
grant execute on function public.sync_delete(integer, uuid, uuid, text, text, bigint) to authenticated;
grant execute on function public.sync_touch_device(integer, uuid, text, text) to authenticated;
grant execute on function public.sync_purge(integer, text) to authenticated;

create or replace function mealrail_private.sync_retention()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_gc_floor text := pg_catalog.to_char(
    ((v_now at time zone 'UTC')::date - 403),
    'YYYY-MM-DD'
  );
begin
  delete from public.sync_resources as r
   where r.kind = 'day'
     and r.deleted = false
     and r.key < v_gc_floor;

  delete from public.sync_resources as r
   where r.kind = 'day'
     and r.deleted = true
     and r.key < v_gc_floor
     and r.deleted_at < v_now - interval '400 days';

  delete from public.sync_mutations as m
   where m.applied_at < v_now - interval '30 days';
end;
$$;

revoke all on function mealrail_private.sync_retention() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'mealrail-sync-retention',
  '17 3 * * *',
  'select mealrail_private.sync_retention();'
);
