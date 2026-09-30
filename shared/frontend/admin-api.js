(function () {
  'use strict';
  async function call(name,args={}) {
    const state=await CommunityAuth.state();
    if(state?.profile.role!=='admin')throw new Error('A real administrator account is required.');
    const {data,error}=await CommunityAuth.getClient().rpc(name,args);if(error)throw error;return data;
  }
  function message(error) {
    if(['PGRST202','42883'].includes(error?.code))return 'Admin tools are not available yet. Please contact the project team to finish setup.';
    if(error?.code==='42501')return 'Your account cannot access these administrator tools.';
    if(error?.code==='P0001')return 'This record has changed. Refresh to check its current status. Assigned requests and reserved donations cannot be cancelled here.';
    if(error?.code==='22023')return 'Enter a review note between 1 and 1,000 characters.';
    return 'Could not load or save this information. Please check your connection and try again.';
  }
  window.AdminAPI=Object.freeze({
    overview:()=>call('admin_overview'),
    list:(kind,offset,filters,search)=>call('admin_list_records',{p_kind:kind,p_offset:offset,p_filters:filters,p_search:search}),
    moderate:(kind,id,note)=>call('admin_moderate_record',{p_kind:kind,p_id:id,p_note:note.trim()}),
    message
  });
})();
