/* Browser access to the service workflow. RLS and RPCs derive authorization in SQL. */
(function () {
  'use strict';
  const categories = Object.freeze({
    food_water_delivery: 'Food / Water Delivery',
    grocery_collection: 'Grocery Collection',
    elderly_vulnerable_assistance: 'Elderly / Vulnerable Assistance',
    public_transport_accompaniment: 'Public Transport Accompaniment',
    healthcare_access: 'Healthcare Access',
    donated_resource_delivery: 'Donated Resource Delivery',
    child_supervision: 'Child Supervision',
    pet_support: 'Pet Support',
    administrative_guidance: 'Administrative Guidance',
    other_approved_service: 'Other Approved Service'
  });
  const resourceCategories = Object.freeze({
    food: 'Food',
    water: 'Water',
    clothing: 'Clothing',
    school_supplies: 'School Supplies',
    household_goods: 'Household Goods',
    other_essentials: 'Other Essentials',
    other: 'Other'
  });
  const reportCategories = Object.freeze({
    community_issue: 'Community Issue',
    platform_issue: 'Platform Issue',
    safety_issue: 'Safety Issue',
    service_issue: 'Service Issue',
    other_issue: 'Other Issue'
  });
  const columns = 'id,user_id,request_type,category,description,item_name,quantity,problems_addressed,location,latitude,longitude,preferred_date,preferred_time,urgency,additional_info,status,created_at,updated_at';
  const pageSize = 50;
  function categoryLabel(type, value) {
    const source = type === 'resource' ? resourceCategories : type === 'report' ? reportCategories : categories;
    if (value && Object.hasOwn(source, value)) return source[value];
    return value ? String(value).replace(/_/g, ' ').replace(/\b\w/g, function (char) { return char.toUpperCase(); }) : 'General request';
  }
  async function identity() {
    const state = await CommunityAuth.state();
    if (!state) throw new Error('Please sign in to continue.');
    return state;
  }
  async function result(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  async function create(input, requestId) {
    await identity();
    return result(CommunityAuth.getClient().rpc('create_service_request', {
      p_category: input.category,
      p_description: input.description.trim(),
      p_location: input.location.trim(),
      p_preferred_date: input.preferredDate,
      p_preferred_time: input.preferredTime,
      p_urgency: input.urgency,
      p_additional_info: input.additionalInfo?.trim() || null,
      p_request_id: requestId,
      p_problems_addressed: input.problemsAddressed || null,
      p_latitude: input.latitude ?? null,
      p_longitude: input.longitude ?? null
    }));
  }
  async function list(mode, offset = 0) {
    const state = await identity();
    const db = CommunityAuth.getClient();
    let query;
    if (mode === 'mine') {
      query = db.from('requests').select(columns).eq('user_id', state.user.id).in('request_type', ['service', 'resource']);
    } else if (mode === 'available') {
      if (!AuthPolicy.verified(state)) return [];
      query = db.from('requests').select(columns).eq('request_type', 'service').eq('status', 'open').neq('user_id', state.user.id);
    } else {
      if (!state.assistant?.id) return [];
      query = db.from('assignments').select(`id,status,completed_at,requests(${columns})`)
        .eq('assistant_id', state.assistant.id).in('status', mode === 'active' ? ['assigned', 'in_progress'] : ['completed']);
    }
    const rows = await result(query.order('created_at', { ascending: false }).range(offset, offset + pageSize - 1));
    if (mode === 'mine' || mode === 'available') return rows || [];
    return (rows || []).filter(row => row.requests).map(row => ({ ...row.requests,
      assignment_id: row.id, status: row.status, completed_at: row.completed_at }));
  }
  async function transition(action, requestId) {
    const methods = { accept: 'accept_service_request', cancel: 'cancel_service_request', cancelResource: 'cancel_resource_request',
      start: 'start_service_request', complete: 'complete_service_request' };
    if (!Object.hasOwn(methods, action)) throw new Error('This action is not supported.');
    await identity();
    return result(CommunityAuth.getClient().rpc(methods[action], { p_request_id: requestId }));
  }
  function message(error) {
    if (error?.code === 'PGRST202' || error?.code === '42883') {
      return 'Service requests are not available yet. Please contact the project team to finish setup.';
    }
    if (error?.code === '42501') return 'Your account cannot perform this action. Refresh to check your current access.';
    if (error?.code === '22023') return 'Check the request fields and preferred date, then try again.';
    if (['P0001', '23505', '40001'].includes(error?.code)) {
      return 'This request has changed or is no longer available for that action. Refresh to see its current status.';
    }
    if (error?.message === 'Please sign in to continue.') return error.message;
    return 'The request could not be completed. Check your connection and try again.';
  }
  window.ServiceRequests = Object.freeze({ categories, resourceCategories, reportCategories,
    categoryLabel, pageSize, create, list, transition, message });
})();
