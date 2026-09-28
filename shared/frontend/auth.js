(function () {
  'use strict';
  const viewKey = 'community-services.developer-view';
  const recoveryKey = 'community-services.recovery';
  let client, pending, current = null, revision = 0, recoveryGrant = null;
  const listeners = new Set();
  const storage = {
    get(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } },
    set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* UI preference is optional. */ } },
    remove(key) { try { sessionStorage.removeItem(key); } catch { /* Storage can be disabled. */ } }
  };
  function clearUI() { storage.remove(viewKey); storage.remove(recoveryKey); recoveryGrant = null; }
  function getClient() {
    if (client) return client;
    client = getSupabaseClient();
    // Never await Supabase calls inside its auth lock/event callback.
    client.auth.onAuthStateChange((event, session) => {
      revision += 1;
      pending = null;
      if (event === 'SIGNED_OUT') { current = null; clearUI(); }
      if (event === 'PASSWORD_RECOVERY' && session) {
        recoveryGrant = { userId: session.user.id, expires: Date.now() + 30 * 60 * 1000 };
        storage.set(recoveryKey, recoveryGrant);
      }
      setTimeout(() => listeners.forEach((listener) => listener(event, session)), 0);
    });
    return client;
  }
  async function session() {
    const { data, error } = await getClient().auth.getSession();
    if (error) throw new Error('Your session could not be restored. Please sign in again.');
    return data.session;
  }
  async function user() {
    const { data, error } = await getClient().auth.getUser();
    if (error || !data.user) throw new Error('Your session could not be verified. Please sign in again.');
    return data.user;
  }
  async function load() {
    if (!await session()) { current = null; clearUI(); return null; }
    const identity = await user();
    const version = revision;
    const db = getClient();
    const results = await Promise.all([
      db.from('profiles').select('id,first_name,last_name,phone,avatar_path,role').eq('id', identity.id).maybeSingle(),
      db.from('assistants').select('id,user_id,verification_status,training_status,availability').eq('user_id', identity.id).maybeSingle(),
      db.from('developer_accounts').select('user_id').eq('user_id', identity.id).maybeSingle()
    ]);
    if (results.some((result) => result.error)) {
      throw new Error('Your account access could not be loaded. Please retry or contact the project team.');
    }
    if (!results[0].data) throw new Error('Your profile is missing. Contact the project team to repair your account.');
    if (!['community_user', 'assistant', 'admin', 'organisation'].includes(results[0].data.role)) {
      throw new Error('Your account role is not supported. Contact the project team.');
    }
    if (version !== revision) return load(); // Do not reveal stale access after sign-out/account switch.
    current = { user: identity, profile: results[0].data, assistant: results[1].data,
      developer: results[2].data?.user_id === identity.id };
    if (!current.developer) storage.remove(viewKey);
    return current;
  }
  function state(force = false) {
    if (force || !pending) pending = load().catch((error) => { pending = null; current = null; throw error; });
    return pending;
  }
  function view(state) {
    const saved = storage.get(viewKey);
    return state?.developer && saved?.userId === state.user.id &&
      (AuthPolicy.validView(saved.view) || saved.view === 'normal') ? saved.view : null;
  }
  function setView(state, selected) {
    if (!state?.developer || !(AuthPolicy.validView(selected) || selected === 'normal')) {
      throw new Error('Developer access is required.');
    }
    storage.set(viewKey, { userId: state.user.id, view: selected });
  }
  function destination(state) { return AuthPolicy.destination(state, view(state)); }
  async function signOut(redirect = true) {
    const { error } = await getClient().auth.signOut({ scope: 'local' });
    if (error) throw new Error('Sign out failed. Check your connection and try again.');
    clearUI(); current = null; pending = null;
    if (redirect) AppNavigation.go('login.html');
  }
  async function recovery(verifiedIdentity) {
    if (!verifiedIdentity && !await session()) return false;
    const identity = verifiedIdentity || await user();
    const saved = recoveryGrant || storage.get(recoveryKey);
    return saved?.userId === identity.id && saved.expires > Date.now();
  }
  function message(error) {
    const code = error?.code;
    if (code === 'invalid_credentials') return 'Email or password is incorrect.';
    if (code === 'email_not_confirmed') return 'Please confirm your email before signing in.';
    if (code === 'weak_password') return 'Use a stronger password that meets the project password requirements.';
    if (code === 'same_password') return 'Choose a password different from your current password.';
    if (code === 'over_email_send_rate_limit' || error?.status === 429) return 'Too many attempts. Please wait before trying again.';
    if (error instanceof TypeError || error?.name === 'AuthRetryableFetchError') return 'Could not connect. Check your connection and try again.';
    // Only our own errors are displayed verbatim; SDK/database details stay private.
    if (error?.name === 'Error' && !error.status && !error.code) return error.message;
    return 'This request could not be completed. Please try again.';
  }
  window.CommunityAuth = Object.freeze({ getClient, session, user, state, view, setView, destination,
    signOut, recovery, message, clearRecovery() { storage.remove(recoveryKey); recoveryGrant = null; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } });
})();
