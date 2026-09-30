(function () {
  'use strict';
  const section = document.getElementById('assistant-membership');
  if (!section) return;
  const message = document.getElementById('membership-message');
  const button = document.getElementById('apply-assistant');
  let busy = false;
  function render(state) {
    section.hidden = !state.assistant && !['community_user', 'assistant'].includes(state.profile.role);
    button.hidden = !!state.assistant;
    document.getElementById('membership-status').textContent = state.assistant
      ? 'Verification: ' + AssistantAPI.label(state.assistant.verification_status) + ' · Training: ' + AssistantAPI.label(state.assistant.training_status)
      : 'Help your neighbours with approved community services. The project team will review your application and arrange training.';
  }
  document.addEventListener('community:authenticated', ({ detail }) => render(detail));
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true; button.disabled = true; message.textContent = 'Sending application…';
    try {
      await AssistantAPI.apply();
      button.hidden = true;
      message.textContent = 'Application received. The project team will review your eligibility and training.';
      try { render(await CommunityAuth.state(true)); }
      catch { message.textContent += ' Refresh to see your latest status.'; }
    } catch (error) { message.textContent = AssistantAPI.message(error); }
    finally { busy = false; button.disabled = false; }
  });
})();
