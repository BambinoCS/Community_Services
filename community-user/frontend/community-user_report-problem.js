document.addEventListener("DOMContentLoaded", () => {
  const form=document.getElementById("community-user_report-problemForm");
  const message=document.getElementById("message");
  if(!form) return;
  CommunityLocation.attachLocator(document.getElementById("problemLocateButton"),{locationInput:document.getElementById("problemLocation"),latInput:document.getElementById("problemLatitude"),lngInput:document.getElementById("problemLongitude"),statusEl:document.getElementById("problemLocateStatus")});
  form.addEventListener("submit", async (event)=>{
    event.preventDefault(); hideBanner(message);
    const type=document.getElementById("problemType"), desc=document.getElementById("problemDescription"), loc=document.getElementById("problemLocation"), urgency=document.getElementById("problemUrgency");
    let valid=true;
    valid=setFieldError(type,document.getElementById("problemTypeError"),type.value?"":"Please select a problem type.")&&valid;
    valid=setFieldError(desc,document.getElementById("problemDescriptionError"),!desc.value.trim()?"Please describe the problem.":desc.value.trim().length>1000?"Description must be 1000 characters or fewer.":"")&&valid;
    valid=setFieldError(loc,document.getElementById("problemLocationError"),loc.value.trim()?"":"Please provide the problem location.")&&valid;
    valid=setFieldError(urgency,document.getElementById("problemUrgencyError"),urgency.value?"":"Please select an urgency level.")&&valid;
    if(!valid) return;
    const submit=form.querySelector('button[type="submit"]'); submit.disabled=true; submit.textContent="Submitting…";
    try{
      const report=await CommunityAPI.createReport({category:type.value,description:desc.value.trim(),location:loc.value.trim(),latitude:parseFloat(document.getElementById("problemLatitude").value)||null,longitude:parseFloat(document.getElementById("problemLongitude").value)||null,urgency:urgency.value,additionalInfo:document.getElementById("problemAdditional").value.trim()});
      showBanner(message,`Problem report submitted successfully. Reference: ${report.id}`,'success');
      form.reset();
    }catch(error){ console.error(error); showBanner(message,error.message||"Could not submit the problem report.",'error'); }
    finally{submit.disabled=false;submit.textContent="Submit Problem Report";}
  });
});
function hideBanner(el){ if(el) el.className="message-banner"; }
