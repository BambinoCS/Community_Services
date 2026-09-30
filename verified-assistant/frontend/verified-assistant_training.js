(function () {
  'use strict';
  document.addEventListener('community:authenticated', ({ detail: state }) => {
    document.getElementById('back-dashboard').href = AppNavigation.url(CommunityAuth.destination(state));
    const assistant = state.assistant;
    document.getElementById('training-state').textContent = AssistantAPI.label(assistant?.training_status);
    document.getElementById('verification-state').textContent = AssistantAPI.label(assistant?.verification_status);
    document.getElementById('training-next-step').textContent = !assistant
      ? 'Apply from your account profile to join the assistant programme.'
      : assistant.training_status === 'completed'
        ? 'Your training is recorded as completed. Verification must also be approved before you can accept service jobs.'
        : 'Arrange your required training with the project team. An administrator records completion after reviewing your training.';
    document.getElementById('eligibility-note').textContent = AuthPolicy.verified(state)
      ? 'You are eligible to accept service jobs.'
      : 'Service jobs require both verified identity and completed training.';
  });
})();
