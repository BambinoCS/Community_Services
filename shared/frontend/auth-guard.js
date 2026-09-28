(function () {
  'use strict';

  const area = document.body.dataset.authArea;
  const shell = document.getElementById('auth-shell');
  const content = document.getElementById('protected-content');

  let checking = false;
  let rerun = false;
  let signingOut = false;

  /*
   * Ensure the auth shell has an error-actions container.
   *
   * This means you do NOT have to immediately edit every HTML page.
   * If the Retry / Sign out buttons already exist directly inside
   * #auth-shell, this script moves them into a hidden container.
   */
  function prepareShell() {
    if (!shell) {
      return;
    }

    let actions = shell.querySelector('.auth-error-actions');

    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'auth-error-actions';
      actions.hidden = true;

      const retryButtons = [
        ...shell.querySelectorAll('[data-auth-retry]')
      ];

      const logoutButtons = [
        ...shell.querySelectorAll('[data-auth-logout]')
      ];

      retryButtons.forEach((button) => {
        actions.appendChild(button);
      });

      logoutButtons.forEach((button) => {
        actions.appendChild(button);
      });

      shell.appendChild(actions);
    }

    actions.hidden = true;
  }

  prepareShell();

  /*
   * One account destination shared by all roles,
   * including Developer Mode previews.
   */
  const accountBar = document.querySelector('.auth-account');

  if (accountBar && area !== 'account') {
    const existingProfileButton =
      accountBar.querySelector('[data-auth-profile]');

    if (!existingProfileButton) {
      const profileButton = document.createElement('button');

      profileButton.type = 'button';
      profileButton.textContent = 'Profile';
      profileButton.dataset.authProfile = '';

      profileButton.addEventListener('click', () => {
        window.location.assign(
          AppNavigation.url('profile.html')
        );
      });

      const logoutButton =
        accountBar.querySelector('[data-auth-logout]');

      if (logoutButton) {
        accountBar.insertBefore(
          profileButton,
          logoutButton
        );
      } else {
        accountBar.appendChild(profileButton);
      }
    }
  }

  function getStatusElement() {
    return shell?.querySelector('[role="status"]') || null;
  }

  function getErrorActions() {
    return shell?.querySelector('.auth-error-actions') || null;
  }

  function setStatus(message) {
    const status = getStatusElement();

    if (status) {
      status.textContent = message;
    }
  }

  function hideErrorActions() {
    const actions = getErrorActions();

    if (actions) {
      actions.hidden = true;
    }
  }

  function showErrorActions() {
    const actions = getErrorActions();

    if (actions) {
      actions.hidden = false;
    }
  }

  function showCheckingState() {
    if (!shell || !content) {
      return;
    }

    content.hidden = true;

    document
      .getElementById('developer-switcher')
      ?.remove();

    shell.hidden = false;

    setStatus('Checking your account…');
    hideErrorActions();
  }

  function showErrorState(message) {
    if (!shell || !content) {
      return;
    }

    content.hidden = true;
    shell.hidden = false;

    setStatus(
      message || 'Unable to verify your account.'
    );

    showErrorActions();
  }

  function showProtectedContent(state) {
    if (!shell || !content) {
      return;
    }

    shell.hidden = true;
    content.hidden = false;

    hideErrorActions();

    DeveloperMode.mount(state);

    document
      .querySelectorAll('[data-auth-name]')
      .forEach((element) => {
        const name = [
          state.profile?.first_name,
          state.profile?.last_name
        ]
          .filter(Boolean)
          .join(' ');

        element.textContent =
          name || 'Community member';
      });

    document.dispatchEvent(
      new CustomEvent(
        'community:authenticated',
        {
          detail: state
        }
      )
    );
  }

  async function check() {
    if (checking) {
      rerun = true;
      return;
    }

    checking = true;

    showCheckingState();

    try {
      /*
       * Force trusted state reload.
       *
       * This checks:
       * - Supabase user/session
       * - profile
       * - assistant state
       * - developer membership
       */
      const state =
        await CommunityAuth.state(true);

      /*
       * No authenticated user.
       */
      if (!state) {
        AppNavigation.go('login.html');
        return;
      }

      /*
       * Password recovery session should only access
       * the reset-password flow.
       */
      if (
        await CommunityAuth.recovery(
          state.user
        )
      ) {
        AppNavigation.go(
          'reset-password.html'
        );

        return;
      }

      /*
       * Check whether the authenticated account is
       * actually allowed to use this page.
       */
      const currentView =
        CommunityAuth.view(state);

      const allowed =
        AuthPolicy.allowed(
          state,
          area,
          currentView
        );

      if (!allowed) {
        AppNavigation.go(
          CommunityAuth.destination(state)
        );

        return;
      }

      /*
       * Some old/alias pages exist only to redirect
       * toward the canonical role destination.
       */
      const alias =
        document.body.dataset.authDestination;

      if (alias) {
        const destination =
          AuthPolicy.destinations?.[area];

        if (destination) {
          AppNavigation.go(destination);
        }

        return;
      }

      /*
       * If another check was requested while this one
       * was running, do not briefly reveal the page.
       *
       * The finally block below will immediately run
       * the newest check.
       */
      if (rerun || signingOut) {
        return;
      }

      showProtectedContent(state);
    } catch (error) {
      console.error(
        'Authentication guard failed:',
        error
      );

      const message =
        CommunityAuth.message(error);

      showErrorState(message);
    } finally {
      checking = false;

      if (
        rerun &&
        !signingOut
      ) {
        rerun = false;

        void check();
      }
    }
  }

  /*
   * Retry buttons.
   *
   * They stay hidden while a normal session check
   * is running and only become visible after failure.
   */
  document
    .querySelectorAll('[data-auth-retry]')
    .forEach((element) => {
      element.addEventListener(
        'click',
        () => {
          hideErrorActions();

          void check();
        }
      );
    });

  /*
   * Logout buttons.
   *
   * There may be one in the auth error shell and
   * another in the authenticated account bar.
   */
  document
    .querySelectorAll('[data-auth-logout]')
    .forEach((element) => {
      element.addEventListener(
        'click',
        async () => {
          if (signingOut) {
            return;
          }

          signingOut = true;

          if (content) {
            content.hidden = true;
          }

          if (shell) {
            shell.hidden = false;
          }

          setStatus('Signing out…');
          hideErrorActions();

          try {
            await CommunityAuth.signOut();

            /*
             * Normally SIGNED_OUT below performs
             * the redirect as well, but this makes
             * logout reliable even if that event is delayed.
             */
            AppNavigation.go(
              'login.html'
            );
          } catch (error) {
            console.error(
              'Sign out failed:',
              error
            );

            signingOut = false;

            showErrorState(
              CommunityAuth.message(error)
            );

            return;
          }

          signingOut = false;
        }
      );
    });

  /*
   * React to Supabase auth state changes.
   */
  CommunityAuth.subscribe(
    (event, session) => {
      if (
        event === 'SIGNED_OUT' ||
        !session
      ) {
        if (content) {
          content.hidden = true;
        }

        AppNavigation.go(
          'login.html'
        );

        return;
      }

      if (
        event === 'PASSWORD_RECOVERY'
      ) {
        if (content) {
          content.hidden = true;
        }

        AppNavigation.go(
          'reset-password.html'
        );

        return;
      }

      /*
       * INITIAL_SESSION is already handled by
       * the initial check at the bottom of this file.
       *
       * Avoid running two identical checks at once.
       */
      if (
        event !== 'INITIAL_SESSION'
      ) {
        void check();
      }
    }
  );

  /*
   * When leaving the page, hide protected UI.
   *
   * This preserves the existing fail-closed behavior.
   */
  window.addEventListener(
    'pagehide',
    () => {
      if (content) {
        content.hidden = true;
      }
    }
  );

  /*
   * Browser back/forward cache.
   *
   * Recheck authorization before showing a restored page.
   */
  window.addEventListener(
    'pageshow',
    (event) => {
      if (event.persisted) {
        void check();
      }
    }
  );

  /*
   * Recheck when the user returns to the tab.
   *
   * This helps catch:
   * - expired sessions
   * - logout in another tab
   * - role/status changes
   */
  document.addEventListener(
    'visibilitychange',
    () => {
      if (!document.hidden) {
        void check();
      }
    }
  );

  /*
   * Initial protected-page check.
   */
  void check();
})();
