document.addEventListener("DOMContentLoaded",()=>{
  const form=document.getElementById("community-user_request-new-itemForm"),message=document.getElementById("message");if(!form)return;
  const params=new URLSearchParams(location.search),suggested=params.get("item"); if(suggested){document.getElementById("itemName").value=suggested;document.getElementById("itemDescription").value=`Requested item: ${suggested}`;}
  form.addEventListener("submit",async e=>{e.preventDefault();message.className="message-banner"; const name=document.getElementById("itemName"),cat=document.getElementById("itemCategory"),qty=document.getElementById("itemQuantity"),desc=document.getElementById("itemDescription"),loc=document.getElementById("itemLocation"),urg=document.getElementById("itemUrgency");let valid=true;
    valid=setFieldError(name,document.getElementById("itemNameError"),name.value.trim()?"":"Please enter the item you need.")&&valid;
    valid=setFieldError(cat,document.getElementById("itemCategoryError"),cat.value?"":"Please select an item category.")&&valid;
    valid=setFieldError(qty,document.getElementById("itemQuantityError"),Number.isInteger(Number(qty.value))&&Number(qty.value)>=1?"":"Quantity must be a whole number of at least 1.")&&valid;
    valid=setFieldError(desc,document.getElementById("itemDescriptionError"),!desc.value.trim()?"Please describe what you need.":desc.value.trim().length>1000?"Description must be 1000 characters or fewer.":"")&&valid;
    valid=setFieldError(loc,document.getElementById("itemLocationError"),loc.value.trim()?"":"Please provide a location.")&&valid;
    valid=setFieldError(urg,document.getElementById("itemUrgencyError"),urg.value?"":"Please select an urgency level.")&&valid;if(!valid)return;
    const submit=form.querySelector('button[type="submit"]');submit.disabled=true;submit.textContent="Submitting…";
    try{const row=await CommunityAPI.createRequest({requestType:"resource",category:cat.value,itemName:name.value.trim(),quantity:Number(qty.value),description:desc.value.trim(),location:loc.value.trim(),urgency:urg.value,additionalInfo:document.getElementById("itemAdditional").value.trim()});showBanner(message,`Item request submitted successfully. Reference: ${row.id}`,'success');form.reset();}catch(error){console.error(error);showBanner(message,error.message||"Could not submit the item request.",'error');}finally{submit.disabled=false;submit.textContent="Submit Item Request";}
  });
});
