begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(108);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'sync-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'sync-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- Schema and exposed-surface security.
select has_table('public'::name, 'sync_accounts'::name);
select has_table('public'::name, 'sync_resources'::name);
select has_table('public'::name, 'sync_mutations'::name);
select has_table('public'::name, 'sync_devices'::name);
select has_function('public', 'sync_pull', array['integer', 'bigint', 'integer']);
select has_function('public', 'sync_write', array['integer', 'uuid', 'uuid', 'text', 'text', 'bigint', 'integer', 'jsonb']);
select has_function('public', 'sync_delete', array['integer', 'uuid', 'uuid', 'text', 'text', 'bigint']);
select has_function('public', 'sync_touch_device', array['integer', 'uuid', 'text', 'text']);
select has_function('public', 'sync_purge', array['integer', 'text']);

select ok(
  (select count(*) = 5 and bool_and(not p.prosecdef)
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('sync_pull', 'sync_write', 'sync_delete', 'sync_touch_device', 'sync_purge')),
  'all browser RPCs are SECURITY INVOKER'
);
select ok(
  (select count(*) = 5 and bool_and('search_path=""' = any(coalesce(p.proconfig, array[]::text[])))
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('sync_pull', 'sync_write', 'sync_delete', 'sync_touch_device', 'sync_purge')),
  'all browser RPCs pin an empty search_path'
);
select ok(
  (select bool_and(c.relrowsecurity)
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('sync_accounts', 'sync_resources', 'sync_mutations', 'sync_devices')),
  'every sync table has row-level security enabled'
);
select ok(
  not exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where n.nspname = 'public'
       and c.relname in ('sync_accounts', 'sync_resources', 'sync_mutations', 'sync_devices')
       and a.grantee = 0
       and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ),
  'PUBLIC has no sync table privileges'
);
select ok(
  not exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('sync_accounts', 'sync_resources', 'sync_mutations', 'sync_devices')
       and (has_table_privilege('anon', c.oid, 'SELECT')
         or has_table_privilege('anon', c.oid, 'INSERT')
         or has_table_privilege('anon', c.oid, 'UPDATE')
         or has_table_privilege('anon', c.oid, 'DELETE'))
  ),
  'anon has no sync table privileges'
);
select ok(
  (select count(*) = 5 and bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('sync_pull', 'sync_write', 'sync_delete', 'sync_touch_device', 'sync_purge')),
  'authenticated can execute every browser RPC'
);
select ok(
  (select count(*) = 5 and bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE'))
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('sync_pull', 'sync_write', 'sync_delete', 'sync_touch_device', 'sync_purge')),
  'anon cannot execute any browser RPC'
);
select ok(
  not exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'public'
       and p.proname in ('sync_pull', 'sync_write', 'sync_delete', 'sync_touch_device', 'sync_purge')
       and a.grantee = 0
       and a.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute browser RPCs'
);
select ok(
  not has_schema_privilege('authenticated', 'mealrail_private', 'USAGE')
    and not has_function_privilege('authenticated', 'mealrail_private.sync_retention()', 'EXECUTE')
    and not has_schema_privilege('anon', 'mealrail_private', 'USAGE')
    and not has_function_privilege('anon', 'mealrail_private.sync_retention()', 'EXECUTE'),
  'retention cleanup is not browser-exposed'
);

-- User A creates and updates a resource. Revisions are per resource and seq is per account.
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select ok(
  public.sync_write(1, '65000000-0000-4000-8000-000000000101', '65000000-0000-4000-8000-000000000201', 'day', '2099-01-01', 0, 1, '{"planned":1}'::jsonb)
    @> '{"ok":true,"protocol":1,"result":"applied","resource":{"kind":"day","key":"2099-01-01","rev":1,"deleted":false,"payload_version":1,"payload":{"planned":1},"updated_by":"65000000-0000-4000-8000-000000000201"}}'::jsonb,
  'create returns the complete applied rev 1 envelope'
);
select ok(
  public.sync_write(1, '65000000-0000-4000-8000-000000000102', '65000000-0000-4000-8000-000000000202', 'day', '2099-01-01', 1, 1, '{"planned":2}'::jsonb)
    @> '{"ok":true,"protocol":1,"result":"applied","resource":{"rev":2,"deleted":false,"payload":{"planned":2},"updated_by":"65000000-0000-4000-8000-000000000202"}}'::jsonb,
  'matching update increments rev and replaces opaque payload'
);
select is((select rev from public.sync_resources where kind = 'day' and key = '2099-01-01'), 2::bigint, 'resource revision is 2');
select is((select seq from public.sync_resources where kind = 'day' and key = '2099-01-01'), 2::bigint, 'accepted mutations consume increasing account seq values');

-- A stale write returns current and changes neither the row, counter, nor mutation log.
select ok(
  public.sync_write(1, '65000000-0000-4000-8000-000000000103', '65000000-0000-4000-8000-000000000201', 'day', '2099-01-01', 1, 1, '{"planned":99}'::jsonb)
    @> '{"ok":false,"protocol":1,"result":"stale","current":{"rev":2,"seq":2,"payload":{"planned":2}}}'::jsonb,
  'stale write returns the current envelope'
);
select is((select jsonb_build_array(rev, seq, payload) from public.sync_resources where kind = 'day' and key = '2099-01-01'), '[2,2,{"planned":2}]'::jsonb, 'stale write has no row side effects');
select is((select seq from public.sync_accounts), 2::bigint, 'stale write consumes no seq');
select is((select count(*) from public.sync_mutations where mutation_id = '65000000-0000-4000-8000-000000000103'), 0::bigint, 'stale write creates no idempotency record');

-- Duplicate mutation IDs are idempotent even after the resource advances.
select ok(
  public.sync_write(1, '65000000-0000-4000-8000-000000000104', '65000000-0000-4000-8000-000000000201', 'day', '2099-01-01', 2, 1, '{"planned":3}'::jsonb)
    @> '{"ok":true,"result":"applied","resource":{"rev":3,"payload":{"planned":3}}}'::jsonb,
  'third revision applies'
);
select ok(
  public.sync_write(1, '65000000-0000-4000-8000-000000000104', '65000000-0000-4000-8000-000000000299', 'day', '2099-12-31', 0, 9, '{"ignored":true}'::jsonb)
    @> '{"ok":true,"result":"duplicate","applied_rev":3,"resource":{"kind":"day","key":"2099-01-01","rev":3,"payload":{"planned":3}}}'::jsonb,
  'duplicate ID replays its original resource and applied revision, ignoring changed arguments'
);
select is((select seq from public.sync_accounts), 3::bigint, 'duplicate consumes no seq');
select is((select count(*) from public.sync_mutations where mutation_id = '65000000-0000-4000-8000-000000000104'), 1::bigint, 'duplicate retains one mutation-log row');

-- Deletes, tombstones, stale delete side effects, absent lineage, and explicit undelete.
select ok(
  public.sync_delete(1, '65000000-0000-4000-8000-000000000105', '65000000-0000-4000-8000-000000000201', 'day', '2099-01-01', 2)
    @> '{"ok":false,"result":"stale","current":{"rev":3,"deleted":false,"payload":{"planned":3}}}'::jsonb,
  'stale delete returns current live envelope'
);
select is((select jsonb_build_array(rev, seq, payload) from public.sync_resources where kind = 'day' and key = '2099-01-01'), '[3,3,{"planned":3}]'::jsonb, 'stale delete has no row side effects');
select is((select count(*) from public.sync_mutations where mutation_id = '65000000-0000-4000-8000-000000000105'), 0::bigint, 'stale delete creates no idempotency row');
select ok(
  public.sync_delete(1, '65000000-0000-4000-8000-000000000106', '65000000-0000-4000-8000-000000000201', 'day', '2099-01-01', 3)
    @> '{"ok":true,"result":"applied","resource":{"rev":4,"deleted":true,"payload_version":null,"payload":null}}'::jsonb,
  'matching delete creates a tombstone and increments rev'
);
select ok((select deleted_at is not null from public.sync_resources where kind = 'day' and key = '2099-01-01'), 'tombstone has deleted_at');
select ok(
  public.sync_write(1, '65000000-0000-4000-8000-000000000107', '65000000-0000-4000-8000-000000000201', 'day', '2099-01-01', 0, 1, '{"planned":4}'::jsonb)
    @> '{"ok":false,"result":"deleted","current":{"rev":4,"deleted":true}}'::jsonb,
  'create against tombstone is distinguished from absence'
);
select is((select rev from public.sync_resources where kind = 'day' and key = '2099-01-01'), 4::bigint, 'rejected create does not change tombstone');
select ok(
  public.sync_delete(1, '65000000-0000-4000-8000-000000000108', '65000000-0000-4000-8000-000000000201', 'day', '2099-01-01', 4)
    @> '{"ok":true,"result":"already_deleted","resource":{"rev":4,"deleted":true}}'::jsonb,
  'delete at current tombstone revision is an accepted no-op'
);
select is((select rev from public.sync_resources where kind = 'day' and key = '2099-01-01'), 4::bigint, 'already_deleted does not bump revision');
select ok(
  public.sync_write(1, '65000000-0000-4000-8000-000000000109', '65000000-0000-4000-8000-000000000202', 'day', '2099-01-01', 4, 1, '{"planned":5}'::jsonb)
    @> '{"ok":true,"result":"applied","resource":{"rev":5,"deleted":false,"payload":{"planned":5},"deleted_at":null}}'::jsonb,
  'write at tombstone revision explicitly undeletes'
);
select ok(
  public.sync_delete(1, '65000000-0000-4000-8000-000000000106', '65000000-0000-4000-8000-000000000299', 'day', '2099-01-01', 3)
    @> '{"ok":true,"result":"duplicate","applied_rev":4,"resource":{"rev":5,"deleted":false,"payload":{"planned":5}}}'::jsonb,
  'duplicate delete reports its applied tombstone revision and the newer current resource'
);
select ok(
  public.sync_write(1, '65000000-0000-4000-8000-000000000110', '65000000-0000-4000-8000-000000000201', 'day', '2099-02-01', 7, 1, '{}'::jsonb)
    @> '{"ok":false,"result":"absent","current":null}'::jsonb,
  'update against missing lineage returns absent'
);
select ok(
  public.sync_delete(1, '65000000-0000-4000-8000-000000000111', '65000000-0000-4000-8000-000000000201', 'day', '2099-02-01', 7)
    @> '{"ok":false,"result":"absent","current":null}'::jsonb,
  'delete against missing lineage returns absent'
);
select ok(
  public.sync_touch_device(1, '65000000-0000-4000-8000-000000000251', 'User A phone', 'ios')
    @> '{"ok":true,"result":"applied"}'::jsonb,
  'user A device metadata is created for isolation checks'
);

-- Cross-user RLS and RPC isolation, including identical resource and mutation IDs.
reset role;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is((select count(*) from public.sync_resources), 0::bigint, 'RLS hides user A resources from user B');
select is((select count(*) from public.sync_mutations), 0::bigint, 'RLS hides user A mutation log from user B');
select is((select count(*) from public.sync_devices), 0::bigint, 'RLS hides user A devices from user B');
select is(jsonb_array_length(public.sync_pull(1, 0, 200)->'rows'), 0, 'RPC pull returns no user A resources to user B');
select is(public.sync_pull(1, 0, 200)->'account'->>'user_id', '65000000-0000-4000-8000-000000000002', 'pull derives account ownership from auth.uid');
select ok(
  public.sync_write(1, '65000000-0000-4000-8000-000000000104', '65000000-0000-4000-8000-000000000203', 'day', '2099-01-01', 0, 1, '{"owner":"b"}'::jsonb)
    @> '{"ok":true,"result":"applied","resource":{"rev":1,"seq":1,"payload":{"owner":"b"}}}'::jsonb,
  'same resource and mutation IDs are independent per user'
);
select is((select payload from public.sync_resources where kind = 'day' and key = '2099-01-01'), '{"owner":"b"}'::jsonb, 'user B sees only their own same-key row');

-- Pull paging returns only current envelopes, in seq order, including tombstones.
select ok(public.sync_purge(1, 'DELETE') @> '{"ok":true,"result":"purged"}'::jsonb, 'user B starts paging test from purged account');
select ok(public.sync_write(1, '65000000-0000-4000-8000-000000000121', '65000000-0000-4000-8000-000000000203', 'day', '2099-03-01', 0, 1, '{"n":1}'::jsonb)->>'result' = 'applied', 'paging row one created');
select ok(public.sync_write(1, '65000000-0000-4000-8000-000000000122', '65000000-0000-4000-8000-000000000203', 'day', '2099-03-02', 0, 1, '{"n":2}'::jsonb)->>'result' = 'applied', 'paging row two created');
select ok(public.sync_write(1, '65000000-0000-4000-8000-000000000123', '65000000-0000-4000-8000-000000000203', 'day', '2099-03-03', 0, 1, '{"n":3}'::jsonb)->>'result' = 'applied', 'paging row three created');
select ok(public.sync_delete(1, '65000000-0000-4000-8000-000000000124', '65000000-0000-4000-8000-000000000203', 'day', '2099-03-01', 1)->>'result' = 'applied', 'paging row one becomes latest tombstone');
select is(
  (
    select jsonb_agg(
      jsonb_build_object(
        'key', row->>'key',
        'seq', (row->>'seq')::bigint,
        'deleted', (row->>'deleted')::boolean
      )
      order by ordinal
    )
      from jsonb_array_elements(public.sync_pull(1, 0, 2)->'rows')
        with ordinality as page(row, ordinal)
  ),
  '[{"key":"2099-03-02","seq":2,"deleted":false},{"key":"2099-03-03","seq":3,"deleted":false}]'::jsonb,
  'first pull page is truncated and ordered by current seq'
);
select ok(public.sync_pull(1, 0, 2) @> '{"ok":true,"protocol":1,"result":"page","has_more":true,"next_seq":3}'::jsonb, 'first pull page exposes paging metadata');
select is(
  (
    select jsonb_agg(
      jsonb_build_object(
        'key', row->>'key',
        'seq', (row->>'seq')::bigint,
        'deleted', (row->>'deleted')::boolean,
        'payload', row->'payload',
        'payload_version', row->'payload_version'
      )
      order by ordinal
    )
      from jsonb_array_elements(public.sync_pull(1, 3, 2)->'rows')
        with ordinality as page(row, ordinal)
  ),
  '[{"key":"2099-03-01","seq":4,"deleted":true,"payload":null,"payload_version":null}]'::jsonb,
  'next pull page includes tombstone'
);
select ok(public.sync_pull(1, 3, 2) @> '{"ok":true,"result":"page","has_more":false,"next_seq":4}'::jsonb, 'last pull page exposes terminal metadata');
select is((public.sync_pull(1, 4, 200)->>'next_seq')::bigint, 4::bigint, 'empty pull preserves since_seq as next_seq');
select is(jsonb_array_length(public.sync_pull(1, 4, 200)->'rows'), 0, 'empty pull has no rows');
select is((public.sync_pull(1, 0, 99999)->>'has_more')::boolean, false, 'oversized pull limit is clamped rather than rejected');

-- Protocol, malformed input, payload size, and write-retention outcomes are typed JSON values.
select ok(public.sync_pull(2, 0, 200) @> '{"ok":false,"protocol":1,"result":"unsupported_protocol","supported":[1]}'::jsonb, 'pull rejects unsupported protocol as JSON');
select ok(public.sync_write(2, '65000000-0000-4000-8000-000000000131', '65000000-0000-4000-8000-000000000203', 'day', '2099-04-01', 0, 1, '{}'::jsonb) @> '{"ok":false,"protocol":1,"result":"unsupported_protocol","supported":[1]}'::jsonb, 'write rejects unsupported protocol as JSON');
select ok(public.sync_delete(2, '65000000-0000-4000-8000-000000000149', '65000000-0000-4000-8000-000000000203', 'day', '2099-04-01', 1) @> '{"ok":false,"protocol":1,"result":"unsupported_protocol","supported":[1]}'::jsonb, 'delete rejects unsupported protocol as JSON');
select ok(public.sync_purge(2, 'DELETE') @> '{"ok":false,"protocol":1,"result":"unsupported_protocol","supported":[1]}'::jsonb, 'purge rejects unsupported protocol as JSON');
select ok(public.sync_pull(1, -1, 200) @> '{"ok":false,"result":"invalid","field":"p_since_seq"}'::jsonb, 'negative pull cursor is invalid');
select ok(public.sync_pull(1, 0, 0) @> '{"ok":false,"result":"invalid","field":"p_limit"}'::jsonb, 'nonpositive pull limit is invalid');
select ok(public.sync_write(1, '65000000-0000-4000-8000-000000000132', '65000000-0000-4000-8000-000000000203', 'other', 'x', 0, 1, '{}'::jsonb) @> '{"ok":false,"result":"invalid","field":"p_kind"}'::jsonb, 'unknown resource kind is invalid');
select ok(public.sync_write(1, '65000000-0000-4000-8000-000000000133', '65000000-0000-4000-8000-000000000203', 'day', '2099-02-30', 0, 1, '{}'::jsonb) @> '{"ok":false,"result":"invalid","field":"p_key"}'::jsonb, 'non-calendar day key is invalid');
select ok(public.sync_write(1, '65000000-0000-4000-8000-000000000134', '65000000-0000-4000-8000-000000000203', 'settings', 'wrong', 0, 1, '{}'::jsonb) @> '{"ok":false,"result":"invalid","field":"p_key"}'::jsonb, 'settings key must be literal settings');
select ok(public.sync_write(1, '65000000-0000-4000-8000-000000000135', '65000000-0000-4000-8000-000000000203', 'day', '2099-04-01', -1, 1, '{}'::jsonb) @> '{"ok":false,"result":"invalid","field":"p_expected_rev"}'::jsonb, 'negative expected revision is invalid');
select ok(public.sync_write(1, '65000000-0000-4000-8000-000000000136', '65000000-0000-4000-8000-000000000203', 'day', '2099-04-01', 0, 0, '{}'::jsonb) @> '{"ok":false,"result":"invalid","field":"p_payload_version"}'::jsonb, 'nonpositive payload version is invalid');
select ok(public.sync_write(1, '65000000-0000-4000-8000-000000000137', '65000000-0000-4000-8000-000000000203', 'day', '2099-04-01', 0, 1, '[]'::jsonb) @> '{"ok":false,"result":"invalid","field":"p_payload"}'::jsonb, 'non-object payload is invalid');
select ok(public.sync_write(1, '65000000-0000-4000-8000-000000000138', '65000000-0000-4000-8000-000000000203', 'day', '2099-04-01', 0, 1, null) @> '{"ok":false,"result":"invalid","field":"p_payload"}'::jsonb, 'null payload is invalid');
select ok(public.sync_write(1, null, '65000000-0000-4000-8000-000000000203', 'day', '2099-04-01', 0, 1, '{}'::jsonb) @> '{"ok":false,"result":"invalid","field":"p_mutation_id"}'::jsonb, 'null write mutation ID is invalid');
select ok(public.sync_delete(1, '65000000-0000-4000-8000-000000000139', '65000000-0000-4000-8000-000000000203', 'day', '2099-04-01', 0) @> '{"ok":false,"result":"invalid","field":"p_expected_rev"}'::jsonb, 'delete revision zero is invalid');
select ok(public.sync_delete(1, '65000000-0000-4000-8000-000000000140', '65000000-0000-4000-8000-000000000203', 'settings', 'settings', 1) @> '{"ok":false,"result":"invalid","field":"p_kind"}'::jsonb, 'settings cannot be deleted');
select ok(
  oversized.result @> '{"ok":false,"result":"too_large","limit":65536}'::jsonb
    and oversized.result ? 'size'
    and (oversized.result->>'size')::integer > 65536,
  'day payload over 65536 bytes is rejected with measured size'
)
from (
  select public.sync_write(1, '65000000-0000-4000-8000-000000000141', '65000000-0000-4000-8000-000000000203', 'day', '2099-04-01', 0, 1, jsonb_build_object('x', repeat('x', 65536))) as result
) as oversized;
select ok(
  oversized.result @> '{"ok":false,"result":"too_large","limit":262144}'::jsonb
    and oversized.result ? 'size'
    and (oversized.result->>'size')::integer > 262144,
  'settings payload over 262144 bytes is rejected'
)
from (
  select public.sync_write(1, '65000000-0000-4000-8000-000000000142', '65000000-0000-4000-8000-000000000203', 'settings', 'settings', 0, 1, jsonb_build_object('x', repeat('x', 262144))) as result
) as oversized;
select ok(
  public.sync_write(1, '65000000-0000-4000-8000-000000000143', '65000000-0000-4000-8000-000000000203', 'day', to_char((now() at time zone 'utc')::date - 402, 'YYYY-MM-DD'), 0, 1, '{}'::jsonb)
    @> jsonb_build_object('ok', false, 'result', 'expired', 'floor', to_char((now() at time zone 'utc')::date - 401, 'YYYY-MM-DD')),
  'day older than write floor returns expired with floor'
);
select ok(
  public.sync_delete(1, '65000000-0000-4000-8000-000000000145', '65000000-0000-4000-8000-000000000203', 'day', to_char((now() at time zone 'utc')::date - 402, 'YYYY-MM-DD'), 1)
    @> jsonb_build_object('ok', false, 'result', 'expired', 'floor', to_char((now() at time zone 'utc')::date - 401, 'YYYY-MM-DD')),
  'delete older than write floor returns expired before absence'
);
select ok(
  public.sync_write(1, '65000000-0000-4000-8000-000000000144', '65000000-0000-4000-8000-000000000203', 'day', to_char((now() at time zone 'utc')::date - 401, 'YYYY-MM-DD'), 0, 1, '{"boundary":true}'::jsonb)
    @> '{"ok":true,"result":"applied","resource":{"rev":1}}'::jsonb,
  'day exactly at write floor is accepted'
);
select ok((public.sync_pull(1, 0, 1)->>'server_time')::timestamptz is not null, 'protocol response server_time is a timestamp');
select is(public.sync_pull(1, 0, 1)->>'write_floor', to_char((now() at time zone 'utc')::date - 401, 'YYYY-MM-DD'), 'pull exposes exact UTC write floor');

-- Device metadata is per user and purge requires explicit confirmation.
select ok(
  public.sync_touch_device(1, '65000000-0000-4000-8000-000000000250', 'Phone', 'ios-safari')
    @> '{"ok":true,"protocol":1,"result":"applied","device":{"device_id":"65000000-0000-4000-8000-000000000250","label":"Phone","platform":"ios-safari"}}'::jsonb,
  'device touch creates advisory metadata'
);
select ok((select first_seen_at = last_seen_at from public.sync_devices where device_id = '65000000-0000-4000-8000-000000000250'), 'first touch initializes both device timestamps');
select ok(
  public.sync_touch_device(1, '65000000-0000-4000-8000-000000000250', 'Laptop', 'desktop')
    @> '{"ok":true,"result":"applied","device":{"label":"Laptop","platform":"desktop"}}'::jsonb,
  'second touch updates label and platform'
);
select ok(public.sync_touch_device(9, '65000000-0000-4000-8000-000000000250', 'No', 'No') @> '{"ok":false,"result":"unsupported_protocol","supported":[1]}'::jsonb, 'device touch validates protocol');
select ok(public.sync_touch_device(1, null, 'No', 'No') @> '{"ok":false,"result":"invalid","field":"p_device_id"}'::jsonb, 'device touch rejects null device ID');
select ok(public.sync_purge(1, 'delete') @> '{"ok":false,"result":"invalid","field":"p_confirm"}'::jsonb, 'purge rejects anything except literal DELETE');
select ok((select count(*) > 0 from public.sync_resources), 'invalid purge leaves resources intact');
select ok(
  public.sync_purge(1, 'DELETE')
    @> '{"ok":true,"protocol":1,"result":"purged","removed":{"resources":4,"mutations":5,"devices":1}}'::jsonb,
  'confirmed purge returns typed success and removal counts'
);
select is((select count(*) from public.sync_resources), 0::bigint, 'purge removes all caller resources');
select is((select count(*) from public.sync_mutations), 0::bigint, 'purge removes all caller mutations');
select is((select count(*) from public.sync_devices), 0::bigint, 'purge removes all caller devices');
select is((select count(*) from public.sync_accounts), 0::bigint, 'purge removes caller account counter');

reset role;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  (select payload from public.sync_resources where kind = 'day' and key = '2099-01-01'),
  '{"planned":5}'::jsonb,
  'user B purge cannot remove user A data'
);
select is((select count(*) from public.sync_devices), 1::bigint, 'user B purge cannot remove user A devices');

-- Privileged retention removes only rows beyond the exact independent floors.
reset role;
insert into public.sync_accounts (user_id, seq)
values ('65000000-0000-4000-8000-000000000002', 5);

insert into public.sync_resources (
  user_id, kind, key, rev, seq, deleted, payload_version, payload,
  created_at, updated_at, deleted_at
) values
  (
    '65000000-0000-4000-8000-000000000002', 'day',
    to_char((now() at time zone 'utc')::date - 404, 'YYYY-MM-DD'),
    1, 1, false, 1, '{"case":"old live"}', now() - interval '500 days', now() - interval '404 days', null
  ),
  (
    '65000000-0000-4000-8000-000000000002', 'day',
    to_char((now() at time zone 'utc')::date - 405, 'YYYY-MM-DD'),
    1, 2, true, null, null, now() - interval '500 days', now() - interval '401 days', now() - interval '401 days'
  ),
  (
    '65000000-0000-4000-8000-000000000002', 'day',
    to_char((now() at time zone 'utc')::date - 406, 'YYYY-MM-DD'),
    1, 3, true, null, null, now() - interval '500 days', now() - interval '399 days', now() - interval '399 days'
  ),
  (
    '65000000-0000-4000-8000-000000000002', 'day',
    to_char((now() at time zone 'utc')::date - 403, 'YYYY-MM-DD'),
    1, 4, false, 1, '{"case":"gc boundary"}', now() - interval '500 days', now() - interval '403 days', null
  ),
  (
    '65000000-0000-4000-8000-000000000002', 'settings', 'settings',
    1, 5, false, 1, '{"case":"settings"}', now() - interval '500 days', now() - interval '403 days', null
  );

insert into public.sync_mutations (
  user_id, mutation_id, kind, key, op, applied_rev, applied_seq, applied_at
) values
  (
    '65000000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000261',
    'day', '2099-06-01', 'write', 1, 1, now() - interval '31 days'
  ),
  (
    '65000000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000262',
    'day', '2099-06-02', 'write', 1, 2, now() - interval '29 days'
  );

select mealrail_private.sync_retention();

select is(
  (select count(*) from public.sync_resources where payload = '{"case":"old live"}'),
  0::bigint,
  'retention hard-deletes live days older than UTC current_date - 403'
);
select is(
  (select count(*) from public.sync_resources where deleted and deleted_at < now() - interval '400 days'),
  0::bigint,
  'retention hard-deletes old-key tombstones only after 400 days'
);
select is(
  (select count(*) from public.sync_resources where payload is null and deleted),
  1::bigint,
  'retention keeps an old-key tombstone younger than 400 days'
);
select is(
  (select count(*) from public.sync_resources where payload = '{"case":"gc boundary"}'),
  1::bigint,
  'retention keeps a live day exactly on the GC floor'
);
select is(
  (select count(*) from public.sync_resources where kind = 'settings'),
  1::bigint,
  'retention never removes settings'
);
select is(
  (select count(*) from public.sync_mutations where mutation_id = '65000000-0000-4000-8000-000000000261'),
  0::bigint,
  'retention removes mutation records older than 30 days'
);
select is(
  (select count(*) from public.sync_mutations where mutation_id = '65000000-0000-4000-8000-000000000262'),
  1::bigint,
  'retention keeps mutation records within 30 days'
);
select is(
  (
    select count(*)
      from cron.job
     where jobname = 'mealrail-sync-retention'
       and schedule = '17 3 * * *'
       and command = 'select mealrail_private.sync_retention();'
  ),
  1::bigint,
  'daily retention cleanup is scheduled once'
);

select * from finish();
rollback;
