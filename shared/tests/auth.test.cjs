const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../frontend/auth-policy.js');
const state = (role = 'community_user', developer = false, assistant = null) => ({
  user: { id: 'test-user' }, profile: { role }, developer, assistant
});
test('all anonymous role/developer URLs are denied', () => {
  for (const area of ['community_user', 'assistant', 'admin', 'developer', 'account']) assert.equal(policy.allowed(null, area, 'admin'), false);
  assert.equal(policy.destination(null), 'login.html');
});
test('personal account page is available to all authenticated roles and developer views', () => {
  for (const role of ['community_user', 'assistant', 'admin', 'organisation']) {
    assert.equal(policy.allowed(state(role), 'account'), true);
    assert.equal(policy.allowed(state(role, true), 'account', 'community_user'), true);
  }
});
test('forged browser developer view cannot elevate a normal user', () => {
  for (const view of ['admin', 'assistant', 'developer', '__proto__']) {
    assert.equal(policy.allowed(state(), 'admin', view), false);
    assert.equal(policy.allowed(state(), 'developer', view), false);
    assert.equal(policy.destination(state(), view), policy.destinations.community_user);
  }
});
test('assistant access requires BOTH trusted statuses; admin routing takes precedence', () => {
  for (const verification_status of ['pending', 'verified', 'suspended', 'rejected']) {
    for (const training_status of ['not_started', 'in_progress', 'completed']) {
      const s = state('assistant', false, { verification_status, training_status });
      assert.equal(policy.allowed(s, 'assistant'), verification_status === 'verified' && training_status === 'completed');
    }
  }
  assert.equal(policy.normalView(state('admin', false, { verification_status: 'verified', training_status: 'completed' })), 'admin');
});
test('developer selector, all views and exit never modify the actual role', () => {
  const s = state('admin', true);
  assert.equal(policy.destination(s, null), 'developer.html');
  for (const view of Object.keys(policy.destinations)) {
    assert.equal(policy.allowed(s, view, view), true);
    assert.equal(policy.destination(s, view), policy.destinations[view]);
    assert.equal(s.profile.role, 'admin');
  }
  assert.equal(policy.destination(s, 'normal'), policy.destinations.admin);
});
function harness({ role = 'community_user', developer = false, failTable, missingProfile = false, authenticated = true } = {}) {
  const stored = new Map(); let listener; const queries = [];
  let session = authenticated ? { user: { id: 'test-user' } } : null;
  const db = {
    auth: {
      onAuthStateChange(cb) { listener = cb; },
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user: session?.user } }),
      signOut: async () => { session = null; listener('SIGNED_OUT', null); return {}; }
    },
    from(table) { return { select() { return this; }, eq(column, id) {
      queries.push({ table, column, id }); return this;
    }, async maybeSingle() {
      if (table === failTable) return { error: { message: 'private database detail' } };
      return { data: table === 'profiles' ? (missingProfile ? null : { id: 'test-user', role }) :
        table === 'developer_accounts' && developer ? { user_id: 'test-user' } : null };
    } }; }
  };
  const context = { getSupabaseClient: () => db, AuthPolicy: policy, setTimeout: (fn) => fn(),
    AppNavigation: { go() {} }, sessionStorage: {
      getItem: (k) => stored.get(k), setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k)
    } };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/auth.js'), 'utf8'), context);
  return { auth: context.CommunityAuth, queries, stored, event: (...args) => listener(...args) };
}
test('profile, assistant and developer checks always use authenticated identity', async () => {
  const h = harness(); await h.auth.state();
  assert.equal(h.queries.length, 3);
  assert.ok(h.queries.every(q => q.id === 'test-user'));
});
test('missing profile and every failed authorization query fail closed', async () => {
  for (const failTable of ['profiles', 'assistants', 'developer_accounts']) {
    await assert.rejects(harness({ failTable }).auth.state(), /access could not be loaded/);
  }
  await assert.rejects(harness({ missingProfile: true }).auth.state(), /profile is missing/);
});
test('view is bound to verified membership AND current identity; logout clears it', async () => {
  const h = harness({ developer: true }); const s = await h.auth.state();
  h.auth.setView(s, 'admin'); assert.equal(h.auth.view(s), 'admin');
  assert.equal(h.auth.view({ ...s, user: { id: 'another-user' } }), null);
  assert.equal(h.auth.view({ ...s, developer: false }), null);
  await h.auth.signOut(false); assert.equal(h.auth.view(s), null);
  assert.equal(await h.auth.state(), null);
});
test('ordinary sessions are not treated as password recovery', async () => {
  const h = harness(); assert.equal(await h.auth.recovery(), false);
  h.event('PASSWORD_RECOVERY', { user: { id: 'test-user' } });
  assert.equal(await h.auth.recovery(), true);
  h.auth.clearRecovery(); assert.equal(await h.auth.recovery(), false);
});
test('GitHub Pages navigation uses script location and preserves the deployment prefix', () => {
  for (const prefix of ['', '/Community_Services']) {
    let target;
    const context = { URL, document: { readyState: 'loading', addEventListener() {},
      currentScript: { src: `https://example.test${prefix}/shared/frontend/navigation.js` } },
      location: { replace(url) { target = url; } } };
    context.window = context;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/navigation.js'), 'utf8'), context);
    context.AppNavigation.go('login.html');
    assert.equal(target, `https://example.test${prefix}/login.html`);
  }
});
