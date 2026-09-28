
(function(){
'use strict';
const API = {};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg','image/png','image/webp']);

function client(){ return window.getSupabaseClient(); }
async function user(){
  const {data,error}=await client().auth.getUser();
  if(error || !data?.user) throw new Error('Your session is no longer valid. Please sign in again.');
  return data.user;
}
function fail(error,fallback){
  console.error(error);
  if(error?.code==='42501') return new Error('You do not have permission to perform this action.');
  return new Error(fallback);
}
function safeFileName(name){
  const ext=(name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');
  return `${crypto.randomUUID()}.${ext || 'jpg'}`;
}
API.profile = async function(){
  const u=await user();
  const {data,error}=await client().from('profiles').select('id,first_name,last_name,phone,role,avatar_path,created_at').eq('id',u.id).single();
  if(error) throw fail(error,'Could not load your profile.');
  return {user:u,profile:data};
};
API.dashboard = async function(){
  const u=await user();
  const [profile,requests,donations,notifications]=await Promise.all([
    client().from('profiles').select('first_name,last_name,phone,avatar_path').eq('id',u.id).single(),
    client().from('requests').select('id,request_type,category,status,created_at').eq('user_id',u.id).order('created_at',{ascending:false}).limit(5),
    client().from('donations').select('id,item_name,status,created_at').eq('donor_id',u.id).order('created_at',{ascending:false}).limit(5),
    client().from('notifications').select('id,title,message,type,is_read,created_at').eq('user_id',u.id).order('created_at',{ascending:false}).limit(6)
  ]);
  for(const r of [profile,requests,donations,notifications]) if(r.error) throw fail(r.error,'Could not load dashboard data.');
  return {profile:profile.data,requests:requests.data||[],donations:donations.data||[],notifications:notifications.data||[]};
};
API.createRequest = async function(payload){
  const u=await user();
  const row={
    user_id:u.id, request_type:payload.requestType, category:payload.category,
    description:payload.description, location:payload.location||null,
    preferred_date:payload.preferredDate||null, preferred_time:payload.preferredTime||null,
    urgency:payload.urgency||null, additional_info:payload.additionalInfo||null, status:'open'
  };
  const {data,error}=await client().from('requests').insert(row).select('*').single();
  if(error) throw fail(error,'Could not submit your request.');
  return data;
};
API.createReport = async function(payload){
  const u=await user();
  const {data,error}=await client().from('reports').insert({
    user_id:u.id,category:payload.category,description:payload.description,
    location:payload.location||null,status:'open'
  }).select('*').single();
  if(error) throw fail(error,'Could not submit your report.');
  return data;
};
API.ownRequests = async function(){
  const u=await user();
  const {data,error}=await client().from('requests').select('*').eq('user_id',u.id).order('created_at',{ascending:false});
  if(error) throw fail(error,'Could not load your requests.');
  return data||[];
};
API.cancelRequest = async function(id){
  const u=await user();
  const {data,error}=await client().from('requests').update({status:'cancelled'}).eq('id',id).eq('user_id',u.id).in('status',['open','assigned']).select('*').maybeSingle();
  if(error) throw fail(error,'Could not cancel this request.');
  if(!data) throw new Error('This request can no longer be cancelled.');
  return data;
};
API.createDonation = async function(payload, files){
  const u=await user();
  const {data:donation,error}=await client().from('donations').insert({
    donor_id:u.id,item_name:payload.itemName,category:payload.category,description:payload.description,
    quantity:payload.quantity,location:payload.location,available_from:payload.availableFrom||null,
    available_until:payload.availableUntil||null,status:'available'
  }).select('*').single();
  if(error) throw fail(error,'Could not create the donation.');

  const uploaded=[];
  try{
    for(let i=0;i<files.length;i++){
      const file=files[i];
      if(!IMAGE_TYPES.has(file.type) || file.size>MAX_IMAGE_BYTES) throw new Error('Each image must be JPG, PNG, or WEBP and no larger than 10 MB.');
      const path=`${u.id}/${donation.id}/${safeFileName(file.name)}`;
      const up=await client().storage.from('donation-images').upload(path,file,{upsert:false,contentType:file.type});
      if(up.error) throw up.error;
      uploaded.push(path);
      const ins=await client().from('donation_images').insert({donation_id:donation.id,storage_path:path,sort_order:i});
      if(ins.error) throw ins.error;
    }
  }catch(err){
    if(uploaded.length) await client().storage.from('donation-images').remove(uploaded);
    await client().from('donations').update({status:'cancelled'}).eq('id',donation.id);
    throw fail(err,'Donation was created, but an image upload failed. The donation was cancelled so it will not appear as available.');
  }
  return donation;
};
API.ownDonations = async function(){
  const u=await user();
  const {data,error}=await client().from('donations').select('*,donation_images(id,storage_path,sort_order)').eq('donor_id',u.id).order('created_at',{ascending:false});
  if(error) throw fail(error,'Could not load your donations.');
  return data||[];
};
API.browseResourceRequests = async function(){
  const {data,error}=await client().rpc('browse_open_resource_requests');
  if(error) throw fail(error,'Browse Requests needs migration 004_request_assignment_workflow.sql to be applied.');
  return data||[];
};
API.publicImageUrl = function(path){
  if(!path) return '';
  return client().storage.from('donation-images').getPublicUrl(path).data.publicUrl;
};
API.markNotificationRead = async function(id){
  const {error}=await client().from('notifications').update({is_read:true,read_at:new Date().toISOString()}).eq('id',id);
  if(error) throw fail(error,'Could not update notification.');
};
window.CommunityAPI=API;
})();
