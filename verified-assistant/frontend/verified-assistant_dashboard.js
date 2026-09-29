/* Status comes from the signed-in account; workflow actions live on dedicated lists. */
(function () {
  'use strict';
  document.addEventListener('community:authenticated', ({ detail: state }) => {
    const assistant = state.assistant;
    document.getElementById('verificationStatusBadge').textContent = assistant?.verification_status || 'No assistant record';
    document.getElementById('trainingStatusBadge').textContent = assistant?.training_status || 'Not started';
    document.getElementById('verificationNote').textContent = AuthPolicy.verified(state)
      ? 'Your account is eligible to accept service requests.'
      : 'Your real account needs verification and completed training before accepting requests.';
    document.getElementById('availabilityToggleContainer').textContent = assistant?.availability === 'available' ? 'Available' : 'Unavailable';
    for (const [id, text, href] of [
      ['availableRequestsContainer', 'Browse available service requests', 'verified-assistant_available-requests.html'],
      ['activeJobsContainer', 'Open your active jobs', 'verified-assistant_active-jobs.html'],
      ['completedJobsContainer', 'View your completed jobs', 'verified-assistant_completed-jobs.html']
    ]) {
      const link = document.createElement('a');
      link.className = 'btn btn-primary'; link.href = href; link.textContent = text;
      document.getElementById(id).replaceChildren(link);
    }
  });
})();
