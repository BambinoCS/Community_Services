document.addEventListener("DOMContentLoaded",()=>{
  const form=document.getElementById("community-user_request-serviceForm"), message=document.getElementById("message");
  if(!form)return;
  const todaySast=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let today=todaySast(),requestId=null,busy=false;
  form.addEventListener('input',()=>{if(!busy)requestId=null;});
  form.addEventListener('change',()=>{if(!busy)requestId=null;});
  const disableFields=value=>form.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=value);
   document.getElementById("servicePreferredDate").min=today;
  CommunityLocation.attachLocator(document.getElementById("serviceLocateButton"),{locationInput:document.getElementById("serviceLocation"),latInput:document.getElementById("serviceLatitude"),lngInput:document.getElementById("serviceLongitude"),statusEl:document.getElementById("serviceLocateStatus")});
  form.addEventListener("submit",async e=>{e.preventDefault();if(busy)return;today=todaySast();document.getElementById('servicePreferredDate').min=today;message.className="message-banner";
    const category=document.querySelector('input[name="serviceCategory"]:checked'),desc=document.getElementById("serviceDescription"),loc=document.getElementById("serviceLocation"),date=document.getElementById("servicePreferredDate"),time=document.getElementById("servicePreferredTime"),urg=document.getElementById("serviceUrgency"); let valid=true;
    valid=setFieldError(document.querySelector('input[name="serviceCategory"]'),document.getElementById("serviceCategoryError"),category?"":"Please select a service.")&&valid;
    valid=setFieldError(desc,document.getElementById("serviceDescriptionError"),!desc.value.trim()?"Please describe what you need.":desc.value.trim().length>1000?"Description must be 1000 characters or fewer.":"")&&valid;
    valid=setFieldError(loc,document.getElementById("serviceLocationError"),!loc.value.trim()?"Please provide a location.":loc.value.trim().length>200?"Location must be 200 characters or fewer.":"")&&valid;
    valid=setFieldError(date,document.getElementById("servicePreferredDateError"),!date.value?"Please select a preferred date.":date.value<today?"Preferred date cannot be in the past.":"")&&valid;
    valid=setFieldError(time,document.getElementById("servicePreferredTimeError"),time.value?"":"Please select a preferred time.")&&valid;
    valid=setFieldError(urg,document.getElementById("serviceUrgencyError"),urg.value?"":"Please select an urgency level.")&&valid; if(!valid)return;
    const submit=form.querySelector('button[type="submit"]');busy=true;disableFields(true);submit.textContent="Submitting…";
    try{const payload={requestType:"service",category:category.value,description:desc.value.trim(),location:loc.value.trim(),latitude:parseFloat(document.getElementById("serviceLatitude").value)||null,longitude:parseFloat(document.getElementById("serviceLongitude").value)||null,preferredDate:date.value,preferredTime:time.value,urgency:urg.value,problemsAddressed:[...document.querySelectorAll('input[name="problemsAddressed"]:checked')].map(x=>x.value),additionalInfo:document.getElementById("serviceAdditional").value.trim()}; const row=await CommunityAPI.createRequest(payload, requestId ||= crypto.randomUUID()); showBanner(message,`Service request submitted successfully. Reference: ${row.id}`,'success');form.reset();requestId=null;date.min=today;}catch(error){console.error(error);showBanner(message,ServiceRequests.message(error),'error');}finally{busy=false;disableFields(false);submit.textContent="Submit Service Request";}
  });
});
