/*
 * Executes the real migrations and RPCs against a disposable PostgreSQL engine.
 * Install @electric-sql/pglite outside the repository, then either set NODE_PATH
 * to its node_modules directory or use SERVICE_TEST_PGLITE to its package path:
 *   node --test shared/tests/service-database.test.cjs
 * No network/database credentials are read and no deployed database is touched.
 * PGlite serializes connections: these tests verify SQL, RLS, permissions,
 * rollback and competing operations, but not cross-connection lock scheduling.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require(process.env.SERVICE_TEST_PGLITE || '@electric-sql/pglite');

const ids = {
  owner: '10000000-0000-4000-8000-000000000001',
  stranger: '10000000-0000-4000-8000-000000000002',
  assistant: '10000000-0000-4000-8000-000000000003',
  secondAssistant: '10000000-0000-4000-8000-000000000004',
  pending: '10000000-0000-4000-8000-000000000005',
  admin: '10000000-0000-4000-8000-000000000006',
  organisation: '10000000-0000-4000-8000-000000000007'
};
let db;
let today;
let yesterday;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const name of ['001_initial_schema.sql', '003_developer_accounts.sql', '004_request_help_fields.sql', '005_service_request_workflow.sql', '006_location_resource_problem.sql', '007_assistant_management.sql', '008_item_handoffs_chat.sql', '009_admin_operations.sql']) {
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8'));
  }
  for (const id of Object.values(ids)) await db.query('insert into auth.users(id) values ($1)', [id]);
  await db.query("update public.profiles set role = 'assistant' where id = any($1::uuid[])",
    [[ids.assistant, ids.secondAssistant, ids.pending]]);
  await db.query("update public.profiles set role = 'admin' where id = $1", [ids.admin]);
  await db.query("update public.profiles set role = 'organisation' where id = $1", [ids.organisation]);
  for (const id of [ids.assistant, ids.secondAssistant]) {
    await db.query("insert into public.assistants(user_id, verification_status, training_status) values ($1, 'verified', 'completed')", [id]);
  }
  await db.query('insert into public.assistants(user_id) values ($1)', [ids.pending]);
  await db.query('insert into public.developer_accounts(user_id) values ($1)', [ids.admin]);
  const dates = (await db.query(`select
    to_char(timezone('Africa/Johannesburg', now())::date, 'YYYY-MM-DD') as today,
    to_char(timezone('Africa/Johannesburg', now())::date - 1, 'YYYY-MM-DD') as yesterday`)).rows[0];
  today = dates.today;
  yesterday = dates.yesterday;
});

after(async () => { if (db) await db.close(); });

async function asUser(id) {
  await db.exec('set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id || '']);
}

async function trusted() { await db.exec('reset role'); }

function databaseTest(name, fn) {
  test(name, async () => {
    await db.exec('begin');
    try { await fn(); }
    finally { await db.exec('rollback'); }
  });
}

async function expectFailure(action, code) {
  await db.exec('savepoint expected_failure');
  let failure;
  try { await action(); }
  catch (error) { failure = error; }
  await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure');
  assert.ok(failure, 'Operation unexpectedly succeeded');
  assert.equal(failure.code, code, failure.message);
  return failure;
}

async function create(overrides = {}) {
  const fields = {
    category: 'grocery_collection', description: 'Collect groceries for my household.',
    location: 'Community centre, Soweto', date: today, time: '10:30',
    urgency: 'medium', additional: null, id: randomUUID(), ...overrides
  };
  return (await db.query(`select * from public.create_service_request(
    $1::text, $2::text, $3::text, $4::date, $5::time, $6::text, $7::text, $8::uuid, $9::text[]
  )`, [fields.category, fields.description, fields.location, fields.date, fields.time,
    fields.urgency, fields.additional, fields.id, fields.problems || []])).rows[0];
}

async function rpc(action, id) {
  assert.ok(['accept', 'cancel', 'start', 'complete'].includes(action));
  return (await db.query(`select * from public.${action}_service_request($1::uuid)`, [id])).rows[0];
}

async function requestAndAssignment(id) {
  return (await db.query(`select r.status, ass.status as assignment_status, ass.completed_at
    from public.requests r left join public.assignments ass on ass.request_id = r.id
    where r.id = $1`, [id])).rows[0];
}

databaseTest('full service flow derives identity and keeps request and assignment states together', async () => {
  await asUser(ids.owner);
  const request = await create();
  assert.equal(request.user_id, ids.owner);
  assert.equal(request.request_type, 'service');
  assert.equal(request.status, 'open');
  await asUser(ids.assistant);
  assert.equal((await rpc('accept', request.id)).status, 'assigned');
  assert.deepEqual(await requestAndAssignment(request.id), { status: 'assigned', assignment_status: 'assigned', completed_at: null });
  assert.equal((await rpc('start', request.id)).status, 'in_progress');
  assert.deepEqual(await requestAndAssignment(request.id), { status: 'in_progress', assignment_status: 'in_progress', completed_at: null });
  assert.equal((await rpc('complete', request.id)).status, 'completed');
  await asUser(ids.owner);
  const completed = await requestAndAssignment(request.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.assignment_status, 'completed');
  assert.ok(completed.completed_at);
});

databaseTest('request and assignment SELECT policies do not recurse or expose other members data', async () => {
  await asUser(ids.owner);
  const request = await create();
  await asUser(ids.stranger);
  assert.equal((await db.query('select * from public.requests')).rows.length, 0);
  await asUser(ids.pending);
  assert.equal((await db.query('select * from public.requests')).rows.length, 0);
  await asUser(ids.secondAssistant);
  assert.equal((await db.query('select * from public.requests')).rows.length, 1);
  await asUser(ids.assistant);
  await rpc('accept', request.id);
  assert.equal((await db.query('select * from public.assignments')).rows.length, 1);
  await asUser(ids.secondAssistant);
  assert.equal((await db.query('select * from public.requests')).rows.length, 0);
  assert.equal((await db.query('select * from public.assignments')).rows.length, 0);
  await asUser(ids.owner);
  assert.equal((await db.query('select * from public.assignments')).rows.length, 1);
  await asUser(ids.admin);
  assert.equal((await db.query('select * from public.requests')).rows.length, 1);
  assert.equal((await db.query('select * from public.assignments')).rows.length, 1);
});

databaseTest('all direct browser lifecycle writes are forbidden', async () => {
  await asUser(ids.owner);
  const request = await create();
  for (const role of ['authenticated', 'anon']) {
    await trusted();
    await db.exec(`set local role ${role}`);
    for (const sql of [
      `insert into public.requests(user_id, request_type, category, description) values ('${ids.owner}', 'service', 'x', 'x')`,
      `update public.requests set status = 'completed' where id = '${request.id}'`,
      `update public.requests set user_id = '${ids.stranger}' where id = '${request.id}'`,
      `delete from public.requests where id = '${request.id}'`,
      "insert into public.assignments(request_id, assistant_id) values (gen_random_uuid(), gen_random_uuid())",
      "update public.assignments set status = 'completed'",
      'delete from public.assignments'
    ]) await expectFailure(() => db.exec(sql), '42501');
  }
});

databaseTest('anonymous RPCs and missing authenticated identity cannot act', async () => {
  await db.exec('set local role anon');
  await expectFailure(() => create(), '42501');
  for (const action of ['accept', 'cancel', 'start', 'complete']) {
    await expectFailure(() => rpc(action, randomUUID()), '42501');
  }
  await asUser(null);
  await expectFailure(() => create(), '42501');
  for (const action of ['accept', 'cancel', 'start', 'complete']) {
    await expectFailure(() => rpc(action, randomUUID()), '42501');
  }
});

databaseTest('creation requires actual community role, including developer view accounts', async () => {
  for (const user of [ids.assistant, ids.admin, ids.organisation]) {
    await asUser(user);
    await expectFailure(() => create(), '42501');
  }
});

databaseTest('server rejects invalid categories, lengths, urgency, dates, time and request references', async () => {
  await asUser(ids.owner);
  for (const fields of [
    { category: null }, { category: 'invented' }, { category: '' },
    { description: null }, { description: '  ' }, { description: 'x'.repeat(1001) },
    { location: null }, { location: '' }, { location: 'x'.repeat(201) },
    { additional: 'x'.repeat(1001) }, { urgency: null }, { urgency: 'critical' },
    { date: null }, { date: yesterday }, { date: 'infinity' },
    { time: null }, { time: '24:00' }, { id: null }
  ]) await expectFailure(() => create(fields), '22023');
  assert.equal((await db.query('select count(*)::int as count from public.requests')).rows[0].count, 0);
});

databaseTest('creation normalizes text, accepts boundary lengths and all approved categories', async () => {
  await asUser(ids.owner);
  for (const category of ['food_water_delivery', 'grocery_collection', 'elderly_assistance',
    'public_transport_assistance', 'healthcare_facility_assistance', 'donated_resource_delivery', 'other_approved_service']) {
    const request = await create({ category, description: 'x'.repeat(1000), location: 'x'.repeat(200), additional: 'x'.repeat(1000) });
    assert.equal(request.category, category);
  }
  const request = await create({ category: ' grocery_collection ', description: ' x ', location: ' y ', additional: '  ' });
  assert.equal(request.description, 'x');
  assert.equal(request.location, 'y');
  assert.equal(request.additional_info, null);
});

databaseTest('same nonce and content return the same row, even after completion', async () => {
  await asUser(ids.owner);
  const id = randomUUID();
  const first = await create({ id });
  const second = await create({ id });
  assert.equal(first.id, second.id);
  assert.equal(String(first.created_at), String(second.created_at));
  assert.equal((await db.query('select count(*)::int as count from public.requests')).rows[0].count, 1);
  await asUser(ids.assistant);
  await rpc('accept', id); await rpc('start', id); await rpc('complete', id);
  await asUser(ids.owner);
  assert.equal((await create({ id })).status, 'completed');
});

databaseTest('idempotent replay still succeeds when the original preferred date has passed', async () => {
  await asUser(ids.owner);
  const request = await create();
  await trusted();
  await db.query('update public.requests set preferred_date = $1::date where id = $2::uuid', [yesterday, request.id]);
  await asUser(ids.owner);
  assert.equal((await create({ id: request.id, date: yesterday })).id, request.id);
});

databaseTest('nonce changes and foreign nonce collisions return a safe error without leaking a row', async () => {
  await asUser(ids.owner);
  const request = await create();
  let mismatch;
  for (const fields of [{ description: 'Changed' }, { category: 'elderly_assistance' }, { location: 'Elsewhere' },
    { date: '2099-12-31' }, { time: '11:30' }, { urgency: 'high' }, { additional: 'Changed' }]) {
    mismatch = await expectFailure(() => create({ id: request.id, ...fields }), 'P0001');
  }
  await asUser(ids.stranger);
  const foreign = await expectFailure(() => create({ id: request.id }), 'P0001');
  assert.equal(foreign.message, mismatch.message);
  assert.equal((await db.query('select * from public.requests')).rows.length, 0);
});

databaseTest('server generates a request UUID when the optional nonce is omitted', async () => {
  await asUser(ids.owner);
  const result = (await db.query(`select * from public.create_service_request(
    'grocery_collection', 'Collect groceries', 'Community centre', $1::date, '10:30', 'low')`, [today])).rows[0];
  assert.match(result.id, /^[a-f0-9-]{36}$/);
  assert.equal(result.user_id, ids.owner);
});

databaseTest('acceptance requires both trusted eligibility states', async () => {
  await asUser(ids.owner);
  const request = await create();
  for (const verification of ['pending', 'verified', 'rejected', 'suspended']) {
    for (const training of ['not_started', 'in_progress', 'completed']) {
      if (verification === 'verified' && training === 'completed') continue;
      await trusted();
      await db.query('update public.assistants set verification_status = $1, training_status = $2 where user_id = $3', [verification, training, ids.pending]);
      await asUser(ids.pending);
      await expectFailure(() => rpc('accept', request.id), '42501');
    }
  }
  await asUser(ids.admin);
  await expectFailure(() => rpc('accept', request.id), '42501');
});

databaseTest('a verified assistant cannot accept their own request', async () => {
  await asUser(ids.owner);
  const request = await create();
  await trusted();
  await db.query("insert into public.assistants(user_id, verification_status, training_status) values ($1, 'verified', 'completed')", [ids.owner]);
  await asUser(ids.owner);
  await expectFailure(() => rpc('accept', request.id), '42501');
});

databaseTest('only the assigned, still eligible assistant can start or complete a request', async () => {
  await asUser(ids.owner);
  const request = await create();
  await asUser(ids.assistant); await rpc('accept', request.id);
  for (const user of [ids.owner, ids.secondAssistant, ids.admin]) {
    await asUser(user);
    for (const action of ['start', 'complete']) await expectFailure(() => rpc(action, request.id), '42501');
  }
  await trusted();
  await db.query("update public.assistants set verification_status = 'suspended' where user_id = $1", [ids.assistant]);
  await asUser(ids.assistant);
  await expectFailure(() => rpc('start', request.id), '42501');
});

databaseTest('status transitions cannot be skipped or repeated', async () => {
  await asUser(ids.owner); const request = await create();
  await asUser(ids.assistant); await rpc('accept', request.id);
  await expectFailure(() => rpc('complete', request.id), 'P0001');
  await expectFailure(() => rpc('accept', request.id), 'P0001');
  await rpc('start', request.id);
  await expectFailure(() => rpc('start', request.id), 'P0001');
  await rpc('complete', request.id);
  await expectFailure(() => rpc('complete', request.id), 'P0001');
});

databaseTest('only owner can cancel an open request, and acceptance prevents cancellation', async () => {
  await asUser(ids.owner); const first = await create(); const second = await create();
  await asUser(ids.stranger); await expectFailure(() => rpc('cancel', first.id), '42501');
  await asUser(ids.assistant); await rpc('accept', second.id);
  await asUser(ids.owner);
  await expectFailure(() => rpc('cancel', second.id), 'P0001');
  assert.equal((await rpc('cancel', first.id)).status, 'cancelled');
  await expectFailure(() => rpc('cancel', first.id), 'P0001');
  await asUser(ids.assistant); await expectFailure(() => rpc('accept', first.id), 'P0001');
});

databaseTest('competing accepts leave exactly one assignment, for the first winner', async () => {
  await asUser(ids.owner); const request = await create();
  await asUser(ids.assistant); await rpc('accept', request.id);
  await asUser(ids.secondAssistant); await expectFailure(() => rpc('accept', request.id), 'P0001');
  await asUser(ids.owner);
  const assignments = (await db.query('select ass.*, a.user_id from public.assignments ass join public.assistants a on a.id = ass.assistant_id where ass.request_id = $1', [request.id])).rows;
  // Requesters cannot read another user's assistant record; inspect as trusted.
  assert.equal(assignments.length, 0);
  await trusted();
  const winner = (await db.query('select a.user_id from public.assignments ass join public.assistants a on a.id = ass.assistant_id where ass.request_id = $1', [request.id])).rows;
  assert.deepEqual(winner, [{ user_id: ids.assistant }]);
});

databaseTest('service RPCs cannot mutate resource requests', async () => {
  const id = randomUUID();
  await db.query("insert into public.requests(id, user_id, request_type, category, description) values ($1, $2, 'resource', 'food', 'Food')", [id, ids.owner]);
  await asUser(ids.owner); await expectFailure(() => rpc('cancel', id), '42501');
  await asUser(ids.assistant);
  await expectFailure(() => rpc('accept', id), 'P0001');
  for (const action of ['start', 'complete']) await expectFailure(() => rpc(action, id), '42501');
});

databaseTest('an inconsistent legacy assignment cannot be overwritten by accept or cancel', async () => {
  await asUser(ids.owner); const request = await create();
  await trusted();
  await db.query("insert into public.assignments(request_id, assistant_id) select $1, id from public.assistants where user_id = $2", [request.id, ids.secondAssistant]);
  await asUser(ids.assistant); await expectFailure(() => rpc('accept', request.id), 'P0001');
  await asUser(ids.owner); await expectFailure(() => rpc('cancel', request.id), 'P0001');
  assert.equal((await requestAndAssignment(request.id)).status, 'open');
});

databaseTest('failed request updates roll back assignment creation and later assignment transitions', async () => {
  await asUser(ids.owner); const request = await create();
  await trusted();
  await db.exec(`create function public.test_fail_request_update() returns trigger language plpgsql as $$
    begin raise exception 'Injected request update failure'; end;
  $$;
  create trigger test_fail_request_update before update on public.requests
    for each row execute function public.test_fail_request_update();`);
  await asUser(ids.assistant);
  await expectFailure(() => rpc('accept', request.id), 'P0001');
  await asUser(ids.owner);
  assert.deepEqual(await requestAndAssignment(request.id), { status: 'open', assignment_status: null, completed_at: null });
  await trusted(); await db.exec('alter table public.requests disable trigger test_fail_request_update');
  await asUser(ids.assistant); await rpc('accept', request.id);
  await trusted(); await db.exec('alter table public.requests enable trigger test_fail_request_update');
  await asUser(ids.assistant); await expectFailure(() => rpc('start', request.id), 'P0001');
  assert.deepEqual(await requestAndAssignment(request.id), { status: 'assigned', assignment_status: 'assigned', completed_at: null });
  await trusted(); await db.exec('alter table public.requests disable trigger test_fail_request_update');
  await asUser(ids.assistant); await rpc('start', request.id);
  await trusted(); await db.exec('alter table public.requests enable trigger test_fail_request_update');
  await asUser(ids.assistant); await expectFailure(() => rpc('complete', request.id), 'P0001');
  assert.deepEqual(await requestAndAssignment(request.id), { status: 'in_progress', assignment_status: 'in_progress', completed_at: null });
});

databaseTest('private helpers are identity-bound and private mutation helper cannot be executed by the browser', async () => {
  await asUser(ids.owner); const request = await create();
  await asUser(ids.stranger);
  assert.deepEqual((await db.query('select private.owns_request($1) as owns, private.is_assigned_to_request($1) as assigned', [request.id])).rows[0], { owns: false, assigned: false });
  await expectFailure(() => db.query("select private.advance_service_request($1, 'completed')", [request.id]), '42501');
  await trusted();
  const functions = (await db.query(`select p.proname, p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname in ('create_service_request', 'accept_service_request',
      'cancel_service_request', 'start_service_request', 'complete_service_request'))
      or (n.nspname = 'private' and p.proname in ('owns_request', 'is_assigned_to_request', 'advance_service_request'))`)).rows;
  assert.equal(functions.length, 8);
  for (const fn of functions) {
    assert.equal(fn.prosecdef, true);
    assert.deepEqual(fn.proconfig, ['search_path=""']);
  }
});

databaseTest('team service categories and structured problems survive creation and replay', async () => {
  await asUser(ids.owner);
  for (const category of ['elderly_vulnerable_assistance','public_transport_accompaniment','healthcare_access']) {
    const input={category,problems:['transport_access','healthcare_access'],id:randomUUID()};
    const row=await create(input);
    assert.deepEqual(row.problems_addressed,input.problems);
    assert.equal((await create(input)).id,row.id);
    await expectFailure(()=>create({...input,problems:['food_access']}),'P0001');
  }
  for(const problems of [['unknown'],[null],Array(8).fill('food_access')]) {
    await expectFailure(()=>create({problems}),'22023');
  }
});
databaseTest('item creation remains allowed but cannot forge service lifecycle or identity', async () => {
  await asUser(ids.owner);
  const insert=(owner=ids.owner,status='open')=>db.query(
    "insert into public.requests(user_id,request_type,category,description,item_name,quantity,status) values ($1,'resource','food','Need food','Rice',2,$2) returning *",[owner,status]);
  const row=(await insert()).rows[0];
  assert.equal(row.item_name,'Rice');assert.equal(row.quantity,2);
  await expectFailure(()=>insert(ids.stranger),'42501');
  await expectFailure(()=>insert(ids.owner,'completed'),'42501');
  await expectFailure(()=>db.query("update public.requests set status='completed' where id=$1",[row.id]),'42501');
  await asUser(ids.assistant);await expectFailure(()=>insert(ids.assistant),'42501');
  await asUser(ids.stranger);await expectFailure(()=>db.query('select * from public.cancel_resource_request($1)',[row.id]),'42501');
  await asUser(ids.owner);
  assert.equal((await db.query('select * from public.cancel_resource_request($1)',[row.id])).rows[0].status,'cancelled');
  await expectFailure(()=>db.query('select * from public.cancel_resource_request($1)',[row.id]),'P0001');
  const service=await create();
  await expectFailure(()=>db.query('select * from public.cancel_resource_request($1)',[service.id]),'42501');
});


databaseTest('assistant application derives ownership and retries without resetting status', async () => {
  await asUser(ids.owner);
  const first = (await db.query('select * from public.apply_to_be_assistant()')).rows[0];
  assert.equal(first.user_id, ids.owner);
  assert.equal(first.verification_status, 'pending');
  assert.equal(first.training_status, 'not_started');
  assert.equal(first.availability, 'unavailable');
  assert.equal((await db.query('select * from public.apply_to_be_assistant()')).rows[0].id, first.id);
  await trusted();
  await db.query("update public.assistants set verification_status = 'suspended' where id=$1", [first.id]);
  await asUser(ids.owner);
  assert.equal((await db.query('select * from public.apply_to_be_assistant()')).rows[0].verification_status, 'suspended');
});

async function reviewAssistant(id, verification, training, beforeVerification='pending', beforeTraining='not_started', reason='Reviewed by project team') {
  return (await db.query('select * from public.review_assistant($1,$2,$3,$4,$5,$6)',
    [id,verification,training,beforeVerification,beforeTraining,reason])).rows[0];
}

databaseTest('only actual admins can review, even with developer membership', async () => {
  const pending = (await db.query('select id from public.assistants where user_id=$1',[ids.pending])).rows[0].id;
  await db.query('insert into public.developer_accounts(user_id) values ($1)',[ids.owner]);
  for (const id of [ids.owner,ids.assistant,ids.pending]) {
    await asUser(id);
    await expectFailure(() => reviewAssistant(pending,'verified','completed'),'42501');
  }
  await asUser(ids.admin);
  const updated = await reviewAssistant(pending,'verified','completed');
  assert.equal(updated.verification_status,'verified');
  assert.equal(updated.training_status,'completed');
  const audit = (await db.query('select * from public.assistant_reviews')).rows;
  assert.equal(audit.length,1);
  assert.equal(audit[0].reviewer_id,ids.admin);
  assert.equal(audit[0].previous_verification,'pending');
  await asUser(ids.pending);
  assert.equal((await db.query('select * from public.assistant_reviews')).rows.length,0);
});

databaseTest('review rejects stale or invalid decisions without changing status or audit', async () => {
  const id=(await db.query('select id from public.assistants where user_id=$1',[ids.pending])).rows[0].id;
  await asUser(ids.admin);
  await expectFailure(() => reviewAssistant(id,'verified','completed','verified'),'40001');
  await expectFailure(() => reviewAssistant(id,'unknown','completed'),'22023');
  await expectFailure(() => reviewAssistant(id,'verified',null),'22023');
  await expectFailure(() => reviewAssistant(id,'suspended','not_started','pending','not_started','  '),'22023');
  assert.equal((await db.query('select count(*)::int as n from public.assistant_reviews')).rows[0].n,0);
  assert.equal((await db.query('select verification_status from public.assistants where id=$1',[id])).rows[0].verification_status,'pending');
});

databaseTest('suspension clears availability and immediately blocks protected service work', async () => {
  const id=(await db.query('select id from public.assistants where user_id=$1',[ids.assistant])).rows[0].id;
  await asUser(ids.owner); const request=await create();
  await asUser(ids.assistant); await rpc('accept',request.id);
  await db.query("update public.assistants set availability='available' where id=$1",[id]);
  await asUser(ids.admin);
  assert.equal((await reviewAssistant(id,'suspended','completed','verified','completed','Review needed')).availability,'unavailable');
  await asUser(ids.assistant);
  await expectFailure(() => rpc('start',request.id),'42501');
});

databaseTest('assistant can edit only own availability and cannot self-verify or forge review history', async () => {
  await asUser(ids.assistant);
  const changed=await db.query("update public.assistants set availability='available' where user_id=$1 returning availability",[ids.assistant]);
  assert.equal(changed.rows[0].availability,'available');
  assert.equal((await db.query("update public.assistants set availability='available' where user_id=$1 returning id",[ids.secondAssistant])).rows.length,0);
  await expectFailure(() => db.query("update public.assistants set verification_status='verified'"),'42501');
  await expectFailure(() => db.query("insert into public.assistant_reviews(assistant_id,reviewer_id,previous_verification,verification_status,previous_training,training_status) select id,user_id,'pending','verified','not_started','completed' from public.assistants"),'42501');
});

databaseTest('anonymous and organisation accounts cannot submit assistant applications', async () => {
  await asUser(ids.organisation);
  await expectFailure(() => db.query('select public.apply_to_be_assistant()'),'42501');
  await asUser(null);
  await expectFailure(() => db.query('select public.apply_to_be_assistant()'),'42501');
  await trusted(); await db.exec('set local role anon');
  await expectFailure(() => db.query('select public.apply_to_be_assistant()'),'42501');
});

async function donatedItem(overrides={}) {
  const row={donor:ids.owner,title:'Winter blankets',quantity:2,location:'Community hall',...overrides};
  return (await db.query("insert into public.donations(donor_id,item_name,category,description,quantity,location) values($1,$2,'clothing','Clean blankets',$3,$4) returning *",[row.donor,row.title,row.quantity,row.location])).rows[0];
}
async function itemNeed() {
  return (await db.query("insert into public.requests(user_id,request_type,category,item_name,description,quantity,location,status) values($1,'resource','clothing','Winter blankets','Need two blankets',2,'Recipient meeting place','open') returning *",[ids.stranger])).rows[0];
}
async function handoff(source,mode='self_collect',type='donation',address='',id=randomUUID()) {
  return (await db.query('select * from public.start_item_handoff($1,$2,$3,$4,$5)',[id,type,source,mode,address])).rows[0];
}
async function chat(id,body,nonce=randomUUID()) {
  return (await db.query('select * from public.send_chat_message($1,$2,$3)',[id,nonce,body])).rows[0];
}
async function finishHandoff(id,action) {
  return (await db.query('select * from public.finish_item_handoff($1,$2)',[id,action])).rows[0];
}

databaseTest('self-collection reserves donation and opens a participant-only idempotent conversation',async()=>{
  const donation=await donatedItem();await asUser(ids.stranger);
  const nonce=randomUUID(),h=await handoff(donation.id,'self_collect','donation','',nonce);
  assert.equal(h.donor_id,ids.owner);assert.equal(h.recipient_id,ids.stranger);assert.equal(h.status,'arranged');assert.equal(h.assistant_id,null);
  assert.equal((await handoff(donation.id,'self_collect','donation','',nonce)).id,h.id);
  const m=await chat(h.id,'Can I collect tomorrow?');
  assert.equal(m.sender_id,ids.stranger);
  await asUser(ids.owner);assert.equal((await db.query('select status from public.donations where id=$1',[donation.id])).rows[0].status,'reserved');
  assert.equal((await db.query('select body from public.chat_messages')).rows[0].body,'Can I collect tomorrow?');
  for(const other of [ids.assistant,ids.admin,ids.pending]){
    await asUser(other);assert.equal((await db.query('select * from public.item_handoffs')).rows.length,0);
    assert.equal((await db.query('select * from public.chat_messages')).rows.length,0);
    await expectFailure(()=>chat(h.id,'intrusion'),'42501');
    await expectFailure(()=>db.query('select * from public.item_handoff_participants($1)',[h.id]),'42501');
  }
});

databaseTest('donating a requested item derives the requester and supports direct delivery and cancellation',async()=>{
  const request=await itemNeed();await asUser(ids.owner);
  const h=await handoff(request.id,'self_deliver','request','Donor collection place');
  assert.equal(h.recipient_id,ids.stranger);assert.equal(h.donor_id,ids.owner);
  assert.equal(h.delivery_location,'Recipient meeting place');assert.equal(h.pickup_location,'Donor collection place');
  await chat(h.id,'I can deliver this afternoon.');
  await asUser(ids.stranger);assert.equal((await db.query('select status from public.requests where id=$1',[request.id])).rows[0].status,'assigned');
  await finishHandoff(h.id,'cancelled');
  assert.equal((await db.query('select status from public.requests where id=$1',[request.id])).rows[0].status,'open');
  await expectFailure(()=>chat(h.id,'closed'),'P0001');
});

databaseTest('assistance matches an available trained verified assistant and includes only that helper in chat',async()=>{
  const donation=await donatedItem();
  await db.query("update public.assistants set availability='available' where user_id=$1",[ids.assistant]);
  await asUser(ids.stranger);const h=await handoff(donation.id,'assistance','donation','Recipient address');
  assert.equal(h.status,'arranged');assert.ok(h.assistant_id);
  await asUser(ids.assistant);assert.equal((await db.query('select id from public.item_handoffs')).rows[0].id,h.id);
  await chat(h.id,'I can help with collection.');
  await expectFailure(()=>finishHandoff(h.id,'completed'),'42501');
  await asUser(ids.owner);await expectFailure(()=>finishHandoff(h.id,'completed'),'42501');
  await asUser(ids.stranger);await finishHandoff(h.id,'completed');
  await trusted();assert.equal((await db.query('select status from public.donations where id=$1',[donation.id])).rows[0].status,'collected');
});

databaseTest('unavailable assistants leave a waiting delivery; an available assistant can claim it once',async()=>{
  const request=await itemNeed();await asUser(ids.owner);
  const h=await handoff(request.id,'assistance','request','Donor address');assert.equal(h.status,'waiting_assistant');
  await expectFailure(()=>finishHandoff(h.id,'completed'),'42501');
  await asUser(ids.assistant);await expectFailure(()=>db.query('select * from public.waiting_item_deliveries()'),'42501');
  await db.query("update public.assistants set availability='available' where user_id=$1",[ids.assistant]);
  const queue=(await db.query('select * from public.waiting_item_deliveries()')).rows;
  assert.deepEqual(Object.keys(queue[0]).sort(),['created_at','id','quantity','title']);
  assert.equal(queue[0].id,h.id);assert.equal((await db.query('select * from public.item_handoffs')).rows.length,0);
  const claimed=(await db.query('select * from public.claim_item_delivery($1)',[h.id])).rows[0];assert.equal(claimed.status,'arranged');
  await asUser(ids.secondAssistant);await db.query("update public.assistants set availability='available' where user_id=$1",[ids.secondAssistant]);
  await expectFailure(()=>db.query('select * from public.claim_item_delivery($1)',[h.id]),'P0001');
  await asUser(ids.stranger);await finishHandoff(h.id,'completed');
  assert.equal((await db.query('select status from public.requests where id=$1',[request.id])).rows[0].status,'completed');
});

databaseTest('matching excludes untrained, suspended, busy and participating assistants',async()=>{
  const first=await donatedItem();const second=await donatedItem();
  await db.query("update public.assistants set availability='available'");
  await db.query("update public.assistants set verification_status='suspended' where user_id=$1",[ids.secondAssistant]);
  await asUser(ids.stranger);const h=await handoff(first.id,'assistance','donation','Meeting place');assert.ok(h.assistant_id);
  const waiting=await handoff(second.id,'assistance','donation','Meeting place');assert.equal(waiting.status,'waiting_assistant');
  await asUser(ids.assistant);await expectFailure(()=>db.query('select * from public.claim_item_delivery($1)',[waiting.id]),'P0001');
  await asUser(ids.pending);await expectFailure(()=>db.query('select * from public.claim_item_delivery($1)',[waiting.id]),'42501');
  await asUser(ids.secondAssistant);await expectFailure(()=>db.query('select * from public.claim_item_delivery($1)',[waiting.id]),'42501');
  await trusted();const ownDonation=await donatedItem({donor:ids.assistant});
  await asUser(ids.stranger);const own=await handoff(ownDonation.id,'assistance','donation','Meeting place');assert.equal(own.assistant_id,null);
});

databaseTest('active service jobs prevent automatic delivery matching',async()=>{
  const donation=await donatedItem();await asUser(ids.owner);const service=await create();
  await asUser(ids.assistant);await rpc('accept',service.id);
  await db.query("update public.assistants set availability='available' where user_id=$1",[ids.assistant]);
  await asUser(ids.stranger);assert.equal((await handoff(donation.id,'assistance','donation','Address')).status,'waiting_assistant');
});

databaseTest('competing item requests cannot double reserve and cancellation safely reopens the source',async()=>{
  const donation=await donatedItem();await asUser(ids.stranger);const h=await handoff(donation.id);
  await asUser(ids.organisation);await expectFailure(()=>handoff(donation.id),'P0001');
  await asUser(ids.owner);await expectFailure(()=>db.query("update public.donations set status='available' where id=$1",[donation.id]),'42501');
  await finishHandoff(h.id,'cancelled');assert.equal((await db.query('select status from public.donations where id=$1',[donation.id])).rows[0].status,'available');
  await asUser(ids.organisation);assert.equal((await handoff(donation.id)).status,'arranged');
});

databaseTest('chat retries are exactly once, body is validated and direct writes are forbidden',async()=>{
  const donation=await donatedItem();await asUser(ids.stranger);const h=await handoff(donation.id);const nonce=randomUUID();
  const first=await chat(h.id,'  Hello neighbour  ',nonce);assert.equal(first.body,'Hello neighbour');
  assert.equal((await chat(h.id,'Hello neighbour',nonce)).id,first.id);
  await expectFailure(()=>chat(h.id,'changed',nonce),'22023');
  await expectFailure(()=>chat(h.id,'  '),'22023');await expectFailure(()=>chat(h.id,'x'.repeat(2001)),'22023');
  await expectFailure(()=>db.query("update public.item_handoffs set status='completed'"),'42501');
  await expectFailure(()=>db.query("update public.chat_messages set body='tampered'"),'42501');
  await expectFailure(()=>db.query("delete from public.chat_messages"),'42501');
  assert.equal((await db.query('select * from public.chat_messages')).rows.length,1);
  await asUser(ids.owner);await expectFailure(()=>chat(h.id,'Hello neighbour',nonce),'22023');
});

databaseTest('revoked helper loses chat access while donor and recipient retain their history',async()=>{
  const donation=await donatedItem();await db.query("update public.assistants set availability='available' where user_id=$1",[ids.assistant]);
  await asUser(ids.stranger);const h=await handoff(donation.id,'assistance','donation','Recipient address');await chat(h.id,'Hello');
  await trusted();await db.query("update public.assistants set verification_status='suspended' where user_id=$1",[ids.assistant]);
  await asUser(ids.assistant);assert.equal((await db.query('select * from public.chat_messages')).rows.length,0);await expectFailure(()=>chat(h.id,'hello'),'42501');
  await asUser(ids.stranger);assert.equal((await db.query('select * from public.chat_messages')).rows.length,1);await finishHandoff(h.id,'cancelled');
});

databaseTest('handoff rejects self-arrangements, invalid modes, missing locations and anonymous users',async()=>{
  const donation=await donatedItem();await asUser(ids.owner);await expectFailure(()=>handoff(donation.id),'42501');
  await asUser(ids.stranger);await expectFailure(()=>handoff(donation.id,'self_deliver'),'22023');
  await expectFailure(()=>handoff(donation.id,'assistance'),'22023');await expectFailure(()=>handoff(donation.id,'assistance','donation','x'.repeat(501)),'22023');
  await asUser(null);await expectFailure(()=>handoff(donation.id),'42501');
  await trusted();await db.exec('set local role anon');await expectFailure(()=>handoff(donation.id),'42501');
});

async function adminList(kind,filters={},search='',offset=0){return (await db.query('select public.admin_list_records($1,$2,$3,$4) as data',[kind,offset,filters,search])).rows[0].data;}
async function moderate(kind,id,note='Reviewed by administrator'){return db.query('select public.admin_moderate_record($1,$2,$3)',[kind,id,note]);}

databaseTest('admin lists and totals reject ordinary users and developer-only membership',async()=>{
  await db.query('insert into public.developer_accounts(user_id) values($1)',[ids.owner]);
  for(const id of [ids.owner,ids.assistant,ids.organisation]){await asUser(id);await expectFailure(()=>adminList('users'),'42501');await expectFailure(()=>db.query('select public.admin_overview()'),'42501');await expectFailure(()=>moderate('report',randomUUID()),'42501');}
  await asUser(ids.admin);const rows=await adminList('users');assert.equal(rows.length,7);assert.ok(rows.every(row=>!('phone' in row)&&!('avatar_path' in row)));
});

databaseTest('admin counts real eligible assistants and current donation availability',async()=>{
  await donatedItem();const expired=await donatedItem();await db.query("update public.donations set available_until=now()-interval '1 day' where id=$1",[expired.id]);
  await asUser(ids.admin);const stats=(await db.query('select public.admin_overview() as data')).rows[0].data;
  assert.equal(stats.users,7);assert.equal(stats.verified_assistants,2);assert.equal(stats.pending_assistants,1);assert.equal(stats.available_donations,1);
  assert.equal((await adminList('users',{role:'assistant'})).length,3);
});

databaseTest('admin cancellation is audited and cannot cancel assigned work or reserved items',async()=>{
  const donation=await donatedItem();await asUser(ids.owner);const open=await create(),assigned=await create();
  await asUser(ids.assistant);await rpc('accept',assigned.id);
  await asUser(ids.stranger);await handoff(donation.id);
  await asUser(ids.admin);await moderate('request',open.id);
  assert.equal((await db.query('select status from public.requests where id=$1',[open.id])).rows[0].status,'cancelled');
  await expectFailure(()=>moderate('request',assigned.id),'P0001');await expectFailure(()=>moderate('donation',donation.id),'P0001');
  assert.equal((await db.query('select count(*)::int as n from public.admin_actions')).rows[0].n,1);
});

databaseTest('report review persists a private note without claiming the issue is resolved',async()=>{
  const report=(await db.query("insert into public.reports(user_id,category,description) values($1,'community_issue','Damaged pavement') returning id",[ids.owner])).rows[0].id;
  await asUser(ids.admin);await expectFailure(()=>moderate('report',report,'  '),'22023');await moderate('report',report,'Raised with the maintenance team');
  const rows=await adminList('reports',{review:'reviewed'});assert.equal(rows.length,1);assert.equal(rows[0].status,'open');assert.equal(rows[0].review_note,'Raised with the maintenance team');
  assert.equal((await adminList('reports',{review:'unreviewed'})).length,0);
  await asUser(ids.owner);assert.equal((await db.query('select * from public.admin_report_reviews')).rows.length,0);assert.equal((await db.query('select * from public.admin_actions')).rows.length,0);
  await expectFailure(()=>db.query("update public.admin_report_reviews set note='fake'"),'42501');
});

databaseTest('admin donation cancellation and server-side search preserve unrelated records',async()=>{
  const first=await donatedItem(),second=await donatedItem();await db.query("update public.profiles set first_name='Naledi' where id=$1",[ids.owner]);
  await asUser(ids.admin);await moderate('donation',first.id,'Listing is no longer available');
  assert.equal((await adminList('donations',{status:'cancelled'})).length,1);assert.equal((await adminList('donations',{status:'available'}))[0].id,second.id);
  assert.equal((await adminList('users',{},'naledi'))[0].id,ids.owner);assert.equal((await adminList('users',{},"' OR 1=1 --")).length,0);
});
