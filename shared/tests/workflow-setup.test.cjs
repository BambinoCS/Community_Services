'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.SERVICE_TEST_PGLITE || '@electric-sql/pglite');
const { buildWorkflowSetup } = require('../scripts/build-workflow-setup.cjs');

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;`);
  return db;
}
async function base(db) {
  for (const file of fs.readdirSync(path.join(__dirname, '../supabase/migrations')).filter(name => /^(001|003|004|005|006)_/.test(name)).sort()) {
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8'));
  }
}
async function absent(db) {
  const result = await db.query("select to_regclass('public.assistant_reviews') as reviews, to_regclass('public.item_handoffs') as handoffs");
  assert.deepEqual(result.rows[0], { reviews: null, handoffs: null });
}
test('setup installs all workflows, preserves existing data and protects private chats', async () => {
  const db = await database();
  try {
    await base(db);
    const user = '10000000-0000-4000-8000-000000000001';
    await db.query('insert into auth.users(id) values ($1)', [user]);
    await db.query("insert into public.donations(donor_id,item_name,category,description,quantity,location) values ($1,'Blankets','clothing','Two clean blankets',2,'Community hall')", [user]);
    await db.exec(buildWorkflowSetup());
    assert.equal((await db.query('select count(*)::int as total from public.donations')).rows[0].total, 1);
    for (const table of ['assistant_reviews','item_handoffs','chat_messages','admin_report_reviews','admin_actions']) {
      assert.equal((await db.query('select relrowsecurity from pg_class where oid=to_regclass($1)', ['public.' + table])).rows[0].relrowsecurity, true);
    }
    const rpc = 'public.start_item_handoff(uuid,text,uuid,text,text)';
    assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') as allowed", [rpc])).rows[0].allowed, true);
    assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') as allowed", [rpc])).rows[0].allowed, false);
    await assert.rejects(db.exec(buildWorkflowSetup()), /already exists/);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int as total from public.donations')).rows[0].total, 1);
  } finally { await db.close(); }
});
test('setup refuses missing prerequisites without creating workflow tables', async () => {
  const db = await database();
  try {
    await assert.rejects(db.exec(buildWorkflowSetup()), /Apply migrations 001-006 first/);
    await db.exec('rollback');
    await absent(db);
  } finally { await db.close(); }
});
test('a later migration failure rolls back earlier workflow changes', async () => {
  const db = await database();
  try {
    await base(db);
    // Simulate a conflicting existing RPC; the failure occurs in migration 009.
    await db.exec('create function public.admin_overview() returns jsonb language sql as $$ select null::jsonb $$');
    await assert.rejects(db.exec(buildWorkflowSetup()), /already exists/);
    await db.exec('rollback');
    await absent(db);
    assert.equal((await db.query("select to_regprocedure('public.apply_to_be_assistant()') as application")).rows[0].application, null);
  } finally { await db.close(); }
});
