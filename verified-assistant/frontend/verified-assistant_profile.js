/* Personal details and photos are saved by the shared profile controller. */
(function () {
  'use strict';
  document.addEventListener('community:authenticated', ({ detail: state }) => {
    for (const [id, key] of [['identityStatus', 'verification_status'], ['trainingStatus', 'training_status'], ['availabilityStatus', 'availability']]) {
      document.getElementById(id).textContent = AssistantAPI.label(state.assistant?.[key]);
    }
  });
})();
