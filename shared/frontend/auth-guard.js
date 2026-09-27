(function () {
  'use strict';
  const area = document.body.dataset.authArea;
  const shell = document.getElementById('auth-shell');
  const content = document.getElementById('protected-content');
  let checking = false, rerun = false, signingOut = false;
  function conceal() {
    content.hidden = true;
    document.getElementById('developer-switcher')?.remove();
    shell.hidden = false;
  }
  async function check() {
    if (checking) { rerun = true; return; }
    checking = true; conceal();
    shell.querySelector('[role="status"]').textContent = 'Checking your account…';
    try {
      const state = await CommunityAuth.state(true);
      if (!state) { AppNavigation.go('login.html'); return; }
      if (await CommunityAuth.recovery(state.user)) { AppNavigation.go('reset-password.html'); return; }
      if (!AuthPolicy.allowed(state, area, CommunityAuth.view(state))) {
        AppNavigation.go(CommunityAuth.destination(state)); return;
      }
      const alias = document.body.dataset.authDestination;
      if (alias) { AppNavigation.go(AuthPolicy.destinations[area]); return; }
      if (rerun || signingOut) return;
      shell.hidden = true; content.hidden = false;
      DeveloperMode.mount(state);
      document.querySelectorAll('[data-auth-name]').forEach((el) => {
        el.textContent = [state.profile.first_name, state.profile.last_name].filter(Boolean).join(' ') || 'Community member';
      });
      document.dispatchEvent(new CustomEvent('community:authenticated', { detail: state }));
    } catch (error) {
      shell.querySelector('[role="status"]').textContent = CommunityAuth.message(error);
    } finally {
      checking = false;
      if (rerun && !signingOut) { rerun = false; void check(); }
    }
  }
  document.querySelectorAll('[data-auth-retry]').forEach((el) => el.addEventListener('click', check));
  document.querySelectorAll('[data-auth-logout]').forEach((el) => el.addEventListener('click', async () => {
    if (signingOut) return;
    signingOut = true; conceal();
    try { await CommunityAuth.signOut(); }
    catch (error) { shell.querySelector('[role="status"]').textContent = CommunityAuth.message(error); }
    finally { signingOut = false; }
  }));
  CommunityAuth.subscribe((event, session) => {
    if (event === 'SIGNED_OUT' || !session) { conceal(); AppNavigation.go('login.html'); }
    else if (event === 'PASSWORD_RECOVERY') { conceal(); AppNavigation.go('reset-password.html'); }
    else if (event !== 'INITIAL_SESSION') void check();
  });
  window.addEventListener('pagehide', conceal);
  window.addEventListener('pageshow', (event) => { if (event.persisted) void check(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
  void check();
})();
