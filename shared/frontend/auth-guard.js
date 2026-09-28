(function () {
  'use strict';

  const area = document.body.dataset.authArea;
  const shell = document.getElementById('auth-shell');
  const content = document.getElementById('protected-content');

  let checking = false;
  let rerun = false;
  let signingOut = false;

  function prepareShell() {
    if (!shell) return;

    const retryButtons = shell.querySelectorAll('[data-auth-retry]');
    const logoutButtons = shell.querySelectorAll('[data-auth-logout]');

    /*
     * Hide these IMMEDIATELY.
     * They should only appear after a real authentication error.
     */
    retryButtons.forEach((button) => {
      button.style.display = 'none';
    });

    logoutButtons.forEach((button) => {
      button.style.display = 'none';
    });
  }

  function hideErrorActions() {
    if (!shell) return;

    shell
      .querySelectorAll('[data-auth-retry], [data-auth-logout]')
      .forEach((button) => {
        button.style.display = 'none';
      });
  }

  function showErrorActions() {
    if (!shell) return;

    shell
      .querySelectorAll('[data-auth-retry], [data-auth-logout]')
      .forEach((button) => {
        button.style.display = 'inline-block';
      });
  }

  function setStatus(message) {
    const status = shell?.querySelector('[role="status"]');

    if (status) {
      status.textContent = message;
    }
  }

  function showCheckingState() {
    if (content) {
      content.hidden = true;
    }

    document
      .getElementById('developer-switcher')
      ?.remove();

    if (shell) {
      shell.hidden = false;
    }

    setStatus('Checking your account…');

    /*
     * IMPORTANT:
     * Retry / Sign out stay hidden while checking.
     */
    hideErrorActions();
  }

  function showErrorState(message) {
    if (content) {
      content.hidden = true;
    }

    if (shell) {
      shell.hidden = false;
    }

    setStatus(
      message || 'Unable to verify your account.'
    );

    /*
     * Only now show Retry / Sign out.
     */
    showErrorActions();
  }

  function showProtectedContent(state) {
    hideErrorActions();

    if (shell) {
      shell.hidden = true;
    }

    if (content) {
      content.hidden = false;
    }

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

  /*
   * Hide buttons BEFORE doing anything asynchronous.
   */
  prepareShell();

  /*
   * Add Profile button.
   */
  const accountBar =
    document.querySelector('.auth-account');

  if (
    accountBar &&
    area !== 'account' &&
    !accountBar.querySelector(
      '[data-auth-profile]'
    )
  ) {
    const profileButton =
      document.createElement('button');

    profileButton.type = 'button';
    profileButton.textContent = 'Profile';
    profileButton.dataset.authProfile = '';

    profileButton.addEventListener(
      'click',
      () => {
        window.location.assign(
          AppNavigation.url(
            'profile.html'
          )
        );
      }
    );

    const logoutButton =
      accountBar.querySelector(
        '[data-auth-logout]'
      );

    if (logoutButton) {
      accountBar.insertBefore(
        profileButton,
        logoutButton
      );
    } else {
      accountBar.appendChild(
        profileButton
      );
    }
  }

  async function check() {
    if (checking) {
      rerun = true;
      return;
    }

    checking = true;

    showCheckingState();

    try {
      const state =
        await CommunityAuth.state(true);

      if (!state) {
        AppNavigation.go(
          'login.html'
        );

        return;
      }

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

      const currentView =
        CommunityAuth.view(state);

      if (
        !AuthPolicy.allowed(
          state,
          area,
          currentView
        )
      ) {
        AppNavigation.go(
          CommunityAuth.destination(
            state
          )
        );

        return;
      }

      const alias =
        document.body.dataset
          .authDestination;

      if (alias) {
        const destination =
          AuthPolicy.destinations?.[
            area
          ];

        if (destination) {
          AppNavigation.go(
            destination
          );
        }

        return;
      }

      if (
        rerun ||
        signingOut
      ) {
        return;
      }

      showProtectedContent(
        state
      );
    } catch (error) {
      console.error(
        'Authentication check failed:',
        error
      );

      showErrorState(
        CommunityAuth.message(
          error
        )
      );
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

  document
    .querySelectorAll(
      '[data-auth-retry]'
    )
    .forEach((button) => {
      button.addEventListener(
        'click',
        () => {
          hideErrorActions();

          void check();
        }
      );
    });

  document
    .querySelectorAll(
      '[data-auth-logout]'
    )
    .forEach((button) => {
      button.addEventListener(
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

          setStatus(
            'Signing out…'
          );

          hideErrorActions();

          try {
            await CommunityAuth
              .signOut();

            AppNavigation.go(
              'login.html'
            );
          } catch (error) {
            signingOut = false;

            showErrorState(
              CommunityAuth.message(
                error
              )
            );

            return;
          }

          signingOut = false;
        }
      );
    });

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
        event ===
        'PASSWORD_RECOVERY'
      ) {
        if (content) {
          content.hidden = true;
        }

        AppNavigation.go(
          'reset-password.html'
        );

        return;
      }

      if (
        event !==
        'INITIAL_SESSION'
      ) {
        void check();
      }
    }
  );

  window.addEventListener(
    'pagehide',
    () => {
      if (content) {
        content.hidden = true;
      }
    }
  );

  window.addEventListener(
    'pageshow',
    (event) => {
      if (event.persisted) {
        void check();
      }
    }
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (!document.hidden) {
        void check();
      }
    }
  );

  void check();
})();
