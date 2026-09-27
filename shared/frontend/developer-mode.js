(function () {
  'use strict';
  const labels = { community_user: '🌷 Community User', assistant: '💜 Verified Assistant', admin: '👑 Administrator' };
  async function switchView(selected, message) {
    try {
      const state = await CommunityAuth.state(true);
      CommunityAuth.setView(state, selected);
      AppNavigation.go(AuthPolicy.destination(state, selected));
    } catch (error) { message.textContent = CommunityAuth.message(error); }
  }
  function choices(container, message) {
    for (const [view, label] of Object.entries(labels)) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label;
      button.addEventListener('click', async () => {
        button.disabled = true;
        await switchView(view, message);
        button.disabled = false;
      });
      container.append(button);
    }
    const exit = document.createElement('button');
    exit.type = 'button'; exit.textContent = '🎀 Exit Developer Mode';
    exit.addEventListener('click', () => switchView('normal', message));
    container.append(exit);
  }
  function mount(state) {
    if (!state.developer || document.getElementById('developer-switcher')) return;
    const selector = document.getElementById('developer-choices');
    if (selector) {
      selector.replaceChildren();
      choices(selector, document.getElementById('auth-message'));
    }
    const wrapper = document.createElement('aside');
    wrapper.id = 'developer-switcher'; wrapper.className = 'dev-princess';
    const open = document.createElement('button');
    open.className = 'dev-floating'; open.type = 'button'; open.textContent = '🎀 DEV MODE ✨';
    open.setAttribute('aria-haspopup', 'dialog');
    const dialog = document.createElement('dialog');
    dialog.className = 'dev-dialog'; dialog.setAttribute('aria-labelledby', 'dev-dialog-title');
    const title = document.createElement('h2');
    title.id = 'dev-dialog-title'; title.textContent = '✨🌸 Switch your fabulous era 🌸✨';
    const current = document.createElement('p');
    current.textContent = 'Currently viewing: ' + (labels[CommunityAuth.view(state)] || 'normal account interface');
    const note = document.createElement('p');
    note.textContent = 'Interface preview only. Your real database permissions stay unchanged. Serving code & community 💅';
    const message = document.createElement('p'); message.setAttribute('role', 'status');
    const buttons = document.createElement('div'); choices(buttons, message);
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    dialog.append(title, current, note, buttons, message, close);
    open.addEventListener('click', () => dialog.showModal());
    dialog.addEventListener('close', () => open.focus());
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    // Native dialog supplies focus containment, Escape dismissal and background inertness.
    wrapper.append(open, dialog); document.body.append(wrapper);
  }
  window.DeveloperMode = Object.freeze({ mount });
})();
