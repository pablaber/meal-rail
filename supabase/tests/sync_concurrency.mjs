#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

const databaseUrl =
  process.argv[2] ??
  process.env.SYNC_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const userId = "65000000-0000-4000-8000-000000000065";
const deviceA = "65000000-0000-4000-8000-0000000000a1";
const deviceB = "65000000-0000-4000-8000-0000000000b2";
const mutationA = "65000000-0000-4000-8000-0000000000a3";
const mutationB = "65000000-0000-4000-8000-0000000000b4";

class PsqlSession {
  constructor(name) {
    this.name = name;
    this.sequence = 0;
    this.pending = null;
    this.stderr = "";
    this.child = spawn(
      "psql",
      ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", databaseUrl],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.stdoutBuffer = "";
    this.closed = new Promise((resolve) => {
      this.child.once("exit", resolve);
    });
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.child.on("exit", (code, signal) => {
      if (this.pending) {
        this.pending.reject(
          new Error(
            `${this.name}: psql exited (${code ?? signal}) before completing query\n${this.stderr}`,
          ),
        );
        this.pending = null;
      }
    });
  }

  onStdout(chunk) {
    this.stdoutBuffer += chunk;
    let newline;
    while ((newline = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!this.pending) continue;
      if (line === this.pending.marker) {
        const { resolve, lines } = this.pending;
        this.pending = null;
        resolve(lines);
      } else if (line) {
        this.pending.lines.push(line);
      }
    }
  }

  execute(sql) {
    if (this.pending) {
      throw new Error(
        `${this.name}: attempted overlapping commands on one session`,
      );
    }
    const marker = `__MEAL_RAIL_DONE_${this.name}_${++this.sequence}__`;
    return new Promise((resolve, reject) => {
      this.pending = { marker, lines: [], resolve, reject };
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }

  async value(sql) {
    const lines = await this.execute(sql);
    return lines.at(-1) ?? "";
  }

  close() {
    if (!this.child.killed) {
      this.child.stdin.end();
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label}: expected JSON, got ${JSON.stringify(value)}`);
  }
}

async function waitForBlockedWriter(admin, writerPid, blockerPid) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const blocked = await admin.value(`
      select exists (
        select 1
          from pg_catalog.pg_stat_activity
         where pid = ${writerPid}
           and wait_event_type = 'Lock'
           and ${blockerPid} = any(pg_catalog.pg_blocking_pids(pid))
      );
    `);
    if (blocked === "t") return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 25));
  }
  throw new Error(
    "writer B never waited behind writer A's account-row lock; a nextval-style implementation permits commit-order inversion",
  );
}

async function visibleRows(reader) {
  return parseJson(
    await reader.value(`
      select coalesce(
        jsonb_agg(
          jsonb_build_object('key', key, 'seq', seq, 'payload', payload)
          order by seq
        ),
        '[]'::jsonb
      )::text
      from public.sync_resources;
    `),
    "reader result",
  );
}

const admin = new PsqlSession("admin");
const writerA = new PsqlSession("writer_a");
const writerB = new PsqlSession("writer_b");
const reader = new PsqlSession("reader");

try {
  await admin.execute(`
    delete from auth.users where id = '${userId}'::uuid;
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000'::uuid,
      '${userId}'::uuid,
      'authenticated',
      'authenticated',
      'sync-concurrency@example.invalid',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );
    insert into public.sync_accounts (user_id)
      values ('${userId}'::uuid);
  `);

  for (const session of [writerA, writerB, reader]) {
    await session.execute(`
      select set_config('request.jwt.claim.sub', '${userId}', false);
      set role authenticated;
    `);
  }

  const pidA = Number(await writerA.value("select pg_backend_pid();"));
  const pidB = Number(await writerB.value("select pg_backend_pid();"));
  assert(
    Number.isInteger(pidA) && Number.isInteger(pidB),
    "failed to obtain writer backend PIDs",
  );

  const appliedA = parseJson(
    await writerA.value(`
      begin;
      select public.sync_write(
        1,
        '${mutationA}'::uuid,
        '${deviceA}'::uuid,
        'day',
        '2099-05-01',
        0,
        1,
        '{"writer":"A"}'::jsonb
      )::text;
    `),
    "writer A result",
  );
  assert(
    appliedA.result === "applied" && appliedA.resource.seq === 1,
    "writer A did not reserve seq 1",
  );

  const blockedWriteB = writerB.value(`
    begin;
    select public.sync_write(
      1,
      '${mutationB}'::uuid,
      '${deviceB}'::uuid,
      'day',
      '2099-05-02',
      0,
      1,
      '{"writer":"B"}'::jsonb
    )::text;
  `);

  await waitForBlockedWriter(admin, pidB, pidA);
  assert(
    (await visibleRows(reader)).length === 0,
    "reader saw an uncommitted resource while B waited",
  );

  await writerA.execute("commit;");
  const appliedB = parseJson(await blockedWriteB, "writer B result");
  assert(
    appliedB.result === "applied" && appliedB.resource.seq === 2,
    "writer B did not receive seq 2 after A committed",
  );

  const afterA = await visibleRows(reader);
  assert(
    afterA.length === 1 &&
      afterA[0].key === "2099-05-01" &&
      afterA[0].seq === 1,
    `after A commit and before B commit, expected only A; got ${JSON.stringify(afterA)}`,
  );

  await writerB.execute("commit;");
  const afterB = await visibleRows(reader);
  assert(
    afterB.length === 2 &&
      afterB[0].key === "2099-05-01" &&
      afterB[0].seq === 1 &&
      afterB[1].key === "2099-05-02" &&
      afterB[1].seq === 2,
    `after B commit, expected A then B in seq order; got ${JSON.stringify(afterB)}`,
  );

  process.stdout.write(
    "ok - account-row locking preserves visibility order (direct: node supabase/tests/sync_concurrency.mjs [database-url])\n",
  );
} finally {
  writerA.close();
  writerB.close();
  reader.close();
  await Promise.all([writerA.closed, writerB.closed, reader.closed]);
  await admin
    .execute(`delete from auth.users where id = '${userId}'::uuid;`)
    .catch(() => {});
  admin.close();
  await admin.closed;
}
