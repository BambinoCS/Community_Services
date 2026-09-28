document.addEventListener("DOMContentLoaded",()=>{
  const form=document.getElementById("community-user_request-serviceForm"), message=document.getElementById("message");
  if(!form)return;
  const today=new Date().toISOString().slice(0,10); document.getElementById("servicePreferredDate").min=today;
  form.addEventListener("submit",async e=>{e.preventDefault();message.className="message-banner";
    const category=document.querySelector('input[name="serviceCategory"]:checked'),desc=document.getElementById("serviceDescription"),loc=document.getElementById("serviceLocation"),date=document.getElementById("servicePreferredDate"),time=document.getElementById("servicePreferredTime"),urg=document.getElementById("serviceUrgency"); let valid=true;
    valid=setFieldError(document.querySelector('input[name="serviceCategory"]'),document.getElementById("serviceCategoryError"),category?"":"Please select a service.")&&valid;
    valid=setFieldError(desc,document.getElementById("serviceDescriptionError"),!desc.value.trim()?"Please describe what you need.":desc.value.trim().length>1000?"Description must be 1000 characters or fewer.":"")&&valid;
    valid=setFieldError(loc,document.getElementById("serviceLocationError"),loc.value.trim()?"":"Please provide a location.")&&valid;
    valid=setFieldError(date,document.getElementById("servicePreferredDateError"),!date.value?"Please select a preferred date.":date.value<today?"Preferred date cannot be in the past.":"")&&valid;
    valid=setFieldError(time,document.getElementById("servicePreferredTimeError"),time.value?"":"Please select a preferred time.")&&valid;
    valid=setFieldError(urg,document.getElementById("serviceUrgencyError"),urg.value?"":"Please select an urgency level.")&&valid; if(!valid)return;
    const submit=form.querySelector('button[type="submit"]');submit.disabled=true;submit.textContent="Submitting…";
    try{const payload={requestType:"service",category:category.value,description:desc.value.trim(),location:loc.value.trim(),preferredDate:date.value,preferredTime:time.value,urgency:urg.value,problemsAddressed:[...document.querySelectorAll('input[name="problemsAddressed"]:checked')].map(x=>x.value),additionalInfo:document.getElementById("serviceAdditional").value.trim()}; const row=await CommunityAPI.createRequest(payload); showBanner(message,`Service request submitted successfully. Reference: ${row.id}`,'success');form.reset();date.min=today;}catch(error){console.error(error);showBanner(message,error.message||"Could not submit the service request.",'error');}finally{submit.disabled=false;submit.textContent="Submit Service Request";}
  });
});
