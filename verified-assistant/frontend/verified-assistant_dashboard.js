(function () {
  'use strict';
  let state, saving = false, sequence = 0;
  const toggle = document.getElementById('availability-toggle');
  const feedback = document.getElementById('availability-message');
  function statuses() {
    const assistant = state.assistant;
    document.getElementById('verificationStatusBadge').textContent = AssistantAPI.label(assistant?.verification_status);
    document.getElementById('trainingStatusBadge').textContent = AssistantAPI.label(assistant?.training_status);
    document.getElementById('verificationNote').textContent = AuthPolicy.verified(state)
      ? 'Your account is eligible to accept service requests.' : 'Your real account needs verification and completed training before accepting requests.';
    const available = assistant?.availability === 'available';
    toggle.textContent = available ? 'Available · switch off' : 'Unavailable · switch on';
    toggle.setAttribute('aria-pressed', String(available));
    toggle.disabled = saving || !assistant;
    document.getElementById('welcome-name').textContent = 'Welcome back' + (state.profile.first_name ? ', ' + state.profile.first_name : '');
  }
  async function loadJobs() {
    const version = ++sequence;
    const refresh = document.getElementById('refresh-dashboard');
    refresh.disabled = true;
    const modes = ['available', 'active', 'completed'];
    const results = await Promise.allSettled(modes.map(mode => ServiceRequests.list(mode)));
    if (version !== sequence) return;
    results.forEach((result, index) => {
      const mode = modes[index];
      const container = document.getElementById(mode === 'available' ? 'availableRequestsContainer' : mode + 'JobsContainer');
      container.replaceChildren();
      const count = document.getElementById(mode + '-count');
      count.textContent = result.status === 'fulfilled' ? String(result.value.length) + (result.value.length === 50 ? '+' : '') : '—';
      if (result.status === 'rejected') {
        const error = document.createElement('p'); error.className = 'error-state';
        error.textContent = 'Could not load these jobs. Use Refresh to try again.'; container.append(error); return;
      }
      const rows = result.value;
      if (!rows.length) {
        const empty = document.createElement('p'); empty.className = 'empty-state';
        empty.textContent = { available: 'No open service requests right now. Check back soon.', active: 'No active jobs. Accepted requests will appear here.', completed: 'Completed jobs will appear here once you finish your first service.' }[mode];
        container.append(empty);
      }
      for (const row of rows.slice(0, 3)) {
        const card = document.createElement('article'); card.className = 'item-card';
        const title = document.createElement('h3'); title.textContent = ServiceRequests.categoryLabel('service', row.category);
        const description = document.createElement('p'); description.textContent = row.description; description.className = 'job-description';
        const meta = document.createElement('p'); meta.className = 'meta'; meta.textContent = AssistantAPI.label(row.status) + ' · ' + (row.location || 'Location not provided');
        card.append(title, description, meta); container.append(card);
      }
    });
    refresh.disabled = false;
  }
  toggle.addEventListener('click', async () => {
    if (saving || !state?.assistant) return;
    saving = true; statuses(); feedback.textContent = 'Saving availability…';
    try {
      state.assistant = await AssistantAPI.availability(state.assistant.availability === 'available' ? 'unavailable' : 'available');
      feedback.textContent = 'Availability saved.';
    } catch (error) { feedback.textContent = AssistantAPI.message(error); }
    finally { saving = false; statuses(); }
  });
  document.getElementById('refresh-dashboard').addEventListener('click', () => void loadJobs());
  document.addEventListener('community:authenticated', ({ detail }) => { state = detail; statuses(); void loadJobs(); });
})();
