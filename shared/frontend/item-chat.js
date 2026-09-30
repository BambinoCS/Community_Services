(function () {
  'use strict';
  async function result(query) { const {data,error}=await query; if(error) throw error; return data; }
  const client = () => CommunityAuth.getClient();
  async function source(type,id) {
    if (!['donation','request'].includes(type)) throw new Error('Invalid source.');
    return result(client().from(type==='donation'?'donations':'requests')
      .select(type==='donation'?'id,donor_id,item_name,quantity,description,location,status':'id,user_id,item_name,quantity,description,location,status,request_type').eq('id',id).single());
  }
  const list = (offset=0) => result(client().from('item_handoffs').select('*').order('created_at',{ascending:false}).order('id').range(offset,offset+49));
  const get = id => result(client().from('item_handoffs').select('*').eq('id',id).single());
  function messages(id,before=null) {
    let q=client().from('chat_messages').select('id,handoff_id,sender_id,sender_name,body,created_at').eq('handoff_id',id);
    if(before!==null) q=q.lt('id',before);
    return result(q.order('id',{ascending:false}).limit(50));
  }
  const start = (id,type,sourceId,mode,location) => result(client().rpc('start_item_handoff',{
    p_id:id,p_source_type:type,p_source_id:sourceId,p_mode:mode,p_location:location.trim()
  }));
  const participants = id => result(client().rpc('item_handoff_participants',{p_id:id}));
  const send = (id,nonce,body) => result(client().rpc('send_chat_message',{p_handoff_id:id,p_client_id:nonce,p_body:body.trim()}));
  const finish = (id,action) => result(client().rpc('finish_item_handoff',{p_id:id,p_action:action}));
  const waiting = (offset=0) => result(client().rpc('waiting_item_deliveries',{p_offset:offset}));
  const claim = id => result(client().rpc('claim_item_delivery',{p_id:id}));
  function message(error) {
    if(['PGRST202','42P01','42883','PGRST205'].includes(error?.code)) return 'Chat and delivery arrangements are not available yet. Please contact the project team to finish setup.';
    if(error?.code==='PGRST116') return 'This item or conversation is unavailable. It may already be reserved or you may not have access.';
    if(error?.code==='42501') return 'You do not have access to this conversation or action. Refresh to check your access.';
    if(['P0001','23505'].includes(error?.code)) return 'This item or delivery is no longer available for that action. Refresh to see the latest arrangement.';
    if(error?.code==='22023') return 'Check your transport choice, location and message, then try again.';
    return 'Could not connect. Your unsent text is kept. Please try again.';
  }
  window.ItemChat=Object.freeze({source,list,get,messages,start,send,finish,waiting,claim,participants,message});
})();
