/* Pure routing policy. Database RLS remains the authority for all data access. */
(function (root) {
  'use strict';
  const destinations = Object.freeze({
    community_user: 'community-user/frontend/community-user_dashboard.html',
    assistant: 'verified-assistant/frontend/verified-assistant_dashboard.html',
    admin: 'admin/frontend/admin_dashboard.html'
  });
  const validView = (view) => Object.hasOwn(destinations, view);
  const verified = (state) => state?.assistant?.verification_status === 'verified' &&
    state.assistant.training_status === 'completed';
  function normalView(state) {
    if (state.profile.role === 'admin') return 'admin';
    // Matches private.is_verified_assistant() in migration 001, independent of role.
    if (verified(state)) return 'assistant';
    return 'community_user'; // Pending assistants/organisations have no separate UI yet.
  }
  function destination(state, view) {
    if (!state) return 'login.html';
    if (state.developer && view !== 'normal') {
      return validView(view) ? destinations[view] : 'developer.html';
    }
    return destinations[normalView(state)];
  }
  function allowed(state, area, view) {
    if (!state) return false;
    if (area === 'account') return true;
    if (area === 'developer') return state.developer === true;
    if (state.developer && validView(view)) return area === view;
    return area === normalView(state);
  }
  const policy = Object.freeze({ destinations, validView, verified, normalView, destination, allowed });
  if (typeof module !== 'undefined' && module.exports) module.exports = policy;
  else root.AuthPolicy = policy;
})(globalThis);
