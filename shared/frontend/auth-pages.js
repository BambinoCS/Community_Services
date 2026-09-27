(function () {
  'use strict';
  const page = document.body.dataset.authPage;
  const form = document.querySelector('form');
  const message = document.getElementById('auth-message');
  let busy = false;
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const callbackError = hash.has('error') || query.has('error');
  const hasCallback = hash.has('access_token') || query.has('code') || callbackError;
  function show(text) { message.textContent = text; }
  function cleanURL() { history.replaceState(null, '', location.pathname); }
  function passwordError(password, confirm) {
    if (password.length < 8) return 'Use at least 8 characters for your password.';
    if (password !== confirm) return 'The passwords do not match.';
    return '';
  }
  async function route() {
    if (await CommunityAuth.recovery()) { AppNavigation.go('reset-password.html'); return; }
    const state = await CommunityAuth.state(true);
    if (state) AppNavigation.go(CommunityAuth.destination(state));
    else throw new Error('This link is invalid or expired. Sign in or request a new email.');
  }
  async function initialize() {
    try {
      if (callbackError) {
        await CommunityAuth.session(); // Allow SDK to finish interpreting the callback before cleaning it.
        cleanURL();
        throw new Error('This email link is invalid or expired. Please request a new one.');
      }
      if (page === 'reset') {
        if (!await CommunityAuth.recovery()) throw new Error('Open a valid password reset link from your email to continue.');
        cleanURL(); form.hidden = false;
        show('Choose a new password for your account.');
      } else if (page === 'callback') {
        if (!hasCallback) throw new Error('No confirmation link was provided. Sign in or request a new confirmation email.');
        await CommunityAuth.session(); cleanURL(); await route();
      } else if (page === 'login' && await CommunityAuth.session()) {
        await route();
      }
    } catch (error) { show(CommunityAuth.message(error)); }
  }
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    if (page === 'register' || page === 'reset') {
      const invalid = passwordError(password, String(data.get('confirm') || ''));
      if (invalid) { show(invalid); return; }
    }
    if (page === 'register' && (!String(data.get('first_name')).trim() || !String(data.get('last_name')).trim())) {
      show('Enter your first and last name.'); return;
    }
    busy = true;
    const button = form.querySelector('button[type="submit"]');
    const label = button.textContent; button.disabled = true; button.textContent = 'Please wait…';
    show('');
    try {
      const auth = CommunityAuth.getClient().auth;
      if (page === 'login') {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
        await route();
      } else if (page === 'register') {
        const { data: result, error } = await auth.signUp({ email, password, options: {
          emailRedirectTo: AppNavigation.url('auth-callback.html'),
          data: { first_name: String(data.get('first_name')).trim(), last_name: String(data.get('last_name')).trim(),
            phone: String(data.get('phone') || '').trim() || null }
        } });
        if (error) throw error;
        form.reset();
        if (result.session) await route();
        else show('Check your inbox to confirm your email. If you already have an account, sign in or reset your password.');
      } else if (page === 'forgot') {
        const { error } = await auth.resetPasswordForEmail(email, { redirectTo: AppNavigation.url('reset-password.html') });
        if (error) throw error;
        show('If an account exists for that email, check your inbox for a password reset link.');
      } else if (page === 'reset') {
        if (!await CommunityAuth.recovery()) throw new Error('Your recovery session expired. Request another reset link.');
        const { error } = await auth.updateUser({ password });
        if (error) throw error;
        CommunityAuth.clearRecovery(); form.reset(); form.hidden = true;
        try {
          await CommunityAuth.signOut(false);
          show('Password updated. You can now sign in with your new password.');
        } catch {
          show('Password updated, but sign out could not finish. Open the sign-in page and use “Sign out of this browser” before signing in again.');
        }
      }
    } catch (error) { show(CommunityAuth.message(error)); }
    finally {
      busy = false; button.disabled = false; button.textContent = label;
      form.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ''; });
    }
  });
  document.querySelector('[data-resend]')?.addEventListener('click', async (event) => {
    const email = form.elements.email;
    if (busy || !email.reportValidity()) return;
    busy = true; event.target.disabled = true;
    try {
      const { error } = await CommunityAuth.getClient().auth.resend({ type: 'signup', email: email.value.trim(),
        options: { emailRedirectTo: AppNavigation.url('auth-callback.html') } });
      if (error) throw error;
      show('If your account needs confirmation, check your inbox for a new link.');
    } catch (error) { show(CommunityAuth.message(error)); }
    finally { busy = false; event.target.disabled = false; }
  });
  document.querySelector('[data-auth-logout]')?.addEventListener('click', async () => {
    try { await CommunityAuth.signOut(); } catch (error) { show(CommunityAuth.message(error)); }
  });
  CommunityAuth.subscribe((event) => {
    if (event === 'PASSWORD_RECOVERY' && page !== 'reset') AppNavigation.go('reset-password.html');
    if (event === 'SIGNED_OUT' && page === 'reset') { form.hidden = true; }
  });
  void initialize();
})();
