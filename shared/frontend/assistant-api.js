/* Assistant operations use existing RLS policies and narrowly scoped RPCs. */
(function () {
  'use strict';
  async function result(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  async function identity() {
    const state = await CommunityAuth.state();
    if (!state) throw new Error('Please sign in to continue.');
    return state;
  }
  async function availability(value) {
    if (!['available', 'unavailable'].includes(value)) throw new Error('Choose an availability.');
    const state = await identity();
    if (!state.assistant) throw new Error('An assistant account is required.');
    return result(CommunityAuth.getClient().from('assistants').update({ availability: value })
      .eq('user_id', state.user.id).eq('id', state.assistant.id)
      .select('id,user_id,verification_status,training_status,availability').single());
  }
  async function apply() {
    await identity();
    return result(CommunityAuth.getClient().rpc('apply_to_be_assistant'));
  }
  async function list(offset = 0, status = '') {
    const state = await identity();
    if (state.profile.role !== 'admin') throw new Error('An administrator account is required.');
    let query = CommunityAuth.getClient().from('assistants')
      .select('id,user_id,verification_status,training_status,availability,created_at,profiles(first_name,last_name)');
    if (status) query = query.eq('verification_status', status);
    return result(query.order('created_at', { ascending: false }).order('id').range(offset, offset + 49));
  }
  async function review(row, verification, training, reason) {
    await identity();
    return result(CommunityAuth.getClient().rpc('review_assistant', {
      p_assistant_id: row.id, p_verification: verification, p_training: training,
      p_expected_verification: row.verification_status, p_expected_training: row.training_status,
      p_reason: reason.trim()
    }));
  }
  function label(value) {
    return value ? value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'No assistant record';
  }
  function message(error) {
    if (['PGRST202', '42883'].includes(error?.code)) return 'Assistant applications and reviews are not available yet. Please contact the project team.';
    if (error?.code === '42501') return 'Your account cannot make this change. Refresh to check your access.';
    if (error?.code === '40001') return 'This assistant was updated by someone else. Refresh and review the latest status.';
    if (error?.code === '22023') return 'Choose valid statuses and include a reason for rejection or suspension.';
    return 'The change could not be completed. Check your connection and try again.';
  }
  window.AssistantAPI = Object.freeze({ availability, apply, list, review, label, message });
})();
