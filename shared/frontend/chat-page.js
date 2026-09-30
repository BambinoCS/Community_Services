(function () {
  'use strict';
  const el=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  const sourceType=params.has('donation')?'donation':params.has('request')?'request':null;
  const sourceId=sourceType?params.get(sourceType):null;
  let state=null, selected=params.get('id'), current=null, inboxOffset=0, queueOffset=0;
  let loading=false, busy=false, version=0, source=null, messageRows=[], moreHistory=false;
  const text=(tag,value,className)=>{const n=document.createElement(tag);n.textContent=value;if(className)n.className=className;return n;};
  const labels={waiting_assistant:'Waiting for an assistant',arranged:'Ready to arrange',completed:'Received',cancelled:'Cancelled'};
  // Keep retry IDs in memory too when browser session storage is unavailable.
  const memory=new Map();
  const storage={
    get(key){if(memory.has(key))return memory.get(key);try{return JSON.parse(sessionStorage.getItem(key));}catch{return null;}},
    set(key,value){memory.set(key,value);try{sessionStorage.setItem(key,JSON.stringify(value));}catch{}},
    remove(key){memory.delete(key);try{sessionStorage.removeItem(key);}catch{}}
  };
  const draftKey=id=>'community-services.chat-draft.'+state.user.id+'.'+id;
  const attemptKey=()=> 'community-services.handoff.'+state.user.id+'.'+sourceType+'.'+sourceId;
  function setFeedback(message){el('chat-feedback').textContent=message;}
  function saveDraft() {
    if(!selected)return;
    const body=el('message-body').value;
    const previous=storage.get(draftKey(selected));
    storage.set(draftKey(selected),{body,id:previous?.body===body?previous.id:crypto.randomUUID()});
  }
  function messageList() {
    const container=el('messages');const nearBottom=container.scrollHeight-container.scrollTop-container.clientHeight<60;
    const previousLast=container.lastElementChild?.dataset.messageId;
    container.replaceChildren(...messageRows.map(row=>{
      const item=text('li','', 'chat-message'+(row.sender_id===state.user.id?' mine':''));item.dataset.messageId=String(row.id);
      item.append(text('strong',row.sender_id===state.user.id?'You':row.sender_name),text('p',row.body),text('small',new Date(row.created_at).toLocaleString()));return item;
    }));
    if(nearBottom) container.scrollTop=container.scrollHeight;
    if(previousLast && previousLast!==String(messageRows.at(-1)?.id)) el('new-message-status').textContent='New messages received.';
    el('older-messages').hidden=!moreHistory;
  }
  function renderConversation() {
    el('conversation-title').textContent=current.title;
    const assisted=current.transport_mode==='assistance';
    const transport={self_collect:'Recipient collects',self_deliver:'Donor delivers',assistance:current.assistant_id?'Assistant connected':'Waiting for an available assistant'}[current.transport_mode];
    el('conversation-summary').textContent=labels[current.status]+' · '+transport;
    const details=el('handoff-details'); details.replaceChildren(text('p','Quantity: '+current.quantity));
    details.append(text('p','Collection: '+current.pickup_location));
    if(current.delivery_location)details.append(text('p','Delivery: '+current.delivery_location));
    details.append(text('p',assisted&&current.assistant_id?'This chat includes the donor, recipient and matched assistant.':'This chat connects the donor and recipient.'));
    if(assisted&&!current.assistant_id&&current.status==='waiting_assistant') details.append(text('p','No assistant was free when this was requested. An available assistant can accept from Deliveries needing help. You can still message each other.'));
    const active=!['completed','cancelled'].includes(current.status);
    el('message-form').hidden=!active;el('handoff-actions').replaceChildren();
    if(active&&state.user.id===current.recipient_id&&current.status==='arranged') actionButton('Confirm received','completed');
    if(active&&[current.donor_id,current.recipient_id].includes(state.user.id))actionButton('Cancel arrangement','cancelled');
    el('send-message').disabled=busy;
    if(!active) el('send-feedback').textContent='This arrangement is closed. Its chat history is still available.';
  }
  function actionButton(label,action) {
    const button=text('button',label,'secondary');button.type='button';button.disabled=busy;
    button.addEventListener('click',async()=>{
      if(busy||!confirm(action==='completed'?'Confirm that you have received the item?':'Cancel this arrangement and make the item or request available again?'))return;
      const id=selected;busy=true;renderConversation();
      try{await ItemChat.finish(id,action);setFeedback(action==='completed'?'Receipt confirmed. Thank you for helping your community.':'Arrangement cancelled.');}
      catch(error){setFeedback(ItemChat.message(error));}
      finally{busy=false;await refresh();}
    });el('handoff-actions').append(button);
  }
  async function openConversation(id) {
    if(busy)return;
    version++; selected=id;current=null;messageRows=[];moreHistory=false;
    el('messages').replaceChildren();el('handoff-details').replaceChildren();el('handoff-actions').replaceChildren();
    el('conversation-title').textContent='Loading conversation…';el('conversation-summary').textContent='';
    el('message-form').hidden=true;el('send-feedback').textContent='';el('new-message-status').textContent='';
    el('message-body').value=storage.get(draftKey(id))?.body||'';
    history.replaceState(null,'',AppNavigation.url('chat.html')+'?id='+encodeURIComponent(id));
    await refresh(true);
  }
  async function refresh(force=false) {
    if(!state||busy||document.getElementById('protected-content').hidden||(!force&&loading))return;
    const run=++version;loading=true;el('refresh-chat').disabled=true;
    try {
      const [inbox,detail]=await Promise.allSettled([ItemChat.list(inboxOffset),selected?ItemChat.get(selected):Promise.resolve(null)]);
      if(run!==version)return;
      if(inbox.status==='fulfilled'){
        const rows=inbox.value||[];el('conversations').replaceChildren();
        if(!rows.length)el('conversations').append(text('p','No conversations on this page. Request a donated item or offer an item from Browse Requests.','hint'));
        for(const row of rows){const button=text('button',row.title,'conversation-link');button.type='button';button.setAttribute('aria-current',String(row.id===selected));button.append(text('small',labels[row.status]));button.addEventListener('click',()=>void openConversation(row.id));el('conversations').append(button);}
        el('inbox-prev').disabled=inboxOffset===0;el('inbox-next').disabled=rows.length<50;el('inbox-page').textContent=String(inboxOffset/50+1);
      }else setFeedback(ItemChat.message(inbox.reason));
      if(selected){
        if(detail.status==='rejected'){
          current=null;el('message-form').hidden=true;el('messages').replaceChildren();el('handoff-details').replaceChildren();el('handoff-actions').replaceChildren();
          el('conversation-title').textContent='Conversation unavailable';el('conversation-summary').textContent='You may no longer have access. Try Refresh or choose another conversation.';
          setFeedback(ItemChat.message(detail.reason));
        }else{
          current=detail.value;renderConversation();
          try{const [messages,people]=await Promise.all([ItemChat.messages(selected),ItemChat.participants(selected)]);if(run!==version)return;
            const names=text('p',people.map(person=>person.participant_role+': '+person.display_name).join(' · '));el('handoff-details').prepend(names);
            if(people.some(person=>person.participant_role==='Assistant'&&!person.eligible))el('handoff-details').append(text('p','This assistant is no longer eligible. Cancel this arrangement and request assistance again if the item has not been delivered.'));
            // Merge the latest page without dropping older messages the reader loaded.
            const byId=new Map(messageRows.map(row=>[String(row.id),row]));for(const row of messages)byId.set(String(row.id),row);
            messageRows=[...byId.values()].sort((a,b)=>Number(a.id)-Number(b.id));
            if(messageRows.length<=50)moreHistory=messages.length===50;messageList();
          }catch(error){el('send-feedback').textContent=ItemChat.message(error);}
        }
      }
      el('assistant-queue').hidden=!(AuthPolicy.verified(state)&&state.assistant?.availability==='available');
      if(!el('assistant-queue').hidden){
        try{const rows=await ItemChat.waiting(queueOffset);if(run!==version)return;el('waiting-deliveries').replaceChildren();
          if(!rows.length)el('waiting-deliveries').append(text('p','No deliveries waiting on this page.','hint'));
          for(const row of rows){const card=text('div','','waiting-card');card.append(text('span',row.title+' · Qty '+row.quantity));const button=text('button','Accept delivery');button.type='button';
            button.addEventListener('click',async()=>{if(busy)return;busy=true;button.disabled=true;
              try{const saved=await ItemChat.claim(row.id);busy=false;await openConversation(saved.id);}
              catch(error){busy=false;setFeedback(ItemChat.message(error));await refresh();}
            });card.append(button);el('waiting-deliveries').append(card);}
          el('queue-prev').disabled=queueOffset===0;el('queue-next').disabled=rows.length<50;el('queue-page').textContent=String(queueOffset/50+1);
        }catch(error){el('waiting-deliveries').replaceChildren(text('p',ItemChat.message(error)));}
      }
    }finally{if(run===version){loading=false;el('refresh-chat').disabled=false;}}
  }
  function transportChanged() {
    const assistance=el('arrange-form').elements.transport.value==='assistance';
    el('location-group').hidden=sourceType==='donation'&&!assistance;
    el('handoff-location').required=!el('location-group').hidden;
    el('start-chat').textContent=assistance?'Request assistance & open chat':'Open chat';
  }
  async function loadSource() {
    if(!sourceType)return;
    el('arrange-panel').hidden=false;el('arrange-fields').disabled=true;
    let previous=storage.get(attemptKey());
    if(previous?.id){try{
      const existing=await ItemChat.get(previous.id);
      if(existing.status==='cancelled'){storage.remove(attemptKey());previous=null;}
      else{el('arrange-panel').hidden=true;await openConversation(existing.id);return;}
    }catch{}}
    try{
      source=await ItemChat.source(sourceType,sourceId);
      const own=(sourceType==='donation'?source.donor_id:source.user_id)===state.user.id;
      if(own||source.status!==(sourceType==='donation'?'available':'open')||(sourceType==='request'&&source.request_type!=='resource'))throw new Error('unavailable');
      el('arrange-title').textContent=source.item_name||'Requested item';el('arrange-description').textContent=source.description;
      el('arrange-quantity').textContent='Full quantity: '+(source.quantity||1);
      el('arrange-kind').textContent=sourceType==='donation'?'REQUEST A DONATED ITEM':'DONATE A REQUESTED ITEM';
      el('transport-question').textContent=sourceType==='donation'?'Can you collect this item yourself?':'Can you deliver this item yourself?';
      el('direct-title').textContent=sourceType==='donation'?'Yes, I can collect it myself':'Yes, I can deliver it myself';
      el('direct-note').textContent=sourceType==='donation'?'Chat with the donor to agree a collection time.':'Chat with the requester to agree a delivery time.';
      el('location-label').textContent=sourceType==='donation'?'Delivery address / meeting place':'Where will the item be collected?';
      if(previous){el('handoff-location').value=previous.location||'';const choice=el('arrange-form').querySelector('[value="'+(previous.mode==='assistance'?'assistance':'direct')+'"]');choice.checked=true;}
      el('arrange-fields').disabled=false;transportChanged();
    }catch(error){el('arrange-feedback').textContent=error.message==='unavailable'?'This item is unavailable or belongs to you. Choose another item or open an existing conversation.':ItemChat.message(error);}
  }
  el('arrange-form').addEventListener('change',transportChanged);
  el('arrange-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!source||!event.target.reportValidity())return;
    const mode=event.target.elements.transport.value==='assistance'?'assistance':sourceType==='donation'?'self_collect':'self_deliver';
    const address=el('location-group').hidden?'':el('handoff-location').value.trim();
    if(!el('location-group').hidden&&!address){el('arrange-feedback').textContent='Enter a location.';return;}
    const previous=storage.get(attemptKey());const id=previous?.mode===mode&&previous.location===address?previous.id:crypto.randomUUID();
    storage.set(attemptKey(),{id,mode,location:address});busy=true;el('arrange-fields').disabled=true;el('arrange-feedback').textContent='Connecting…';
    try{const saved=await ItemChat.start(id,sourceType,sourceId,mode,address);el('arrange-panel').hidden=true;busy=false;await openConversation(saved.id);}
    catch(error){el('arrange-feedback').textContent=ItemChat.message(error);}
    finally{busy=false;el('arrange-fields').disabled=false;}
  });
  el('message-body').addEventListener('input',saveDraft);
  el('message-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!current||!event.target.reportValidity())return;
    const body=el('message-body').value.trim();if(!body){el('send-feedback').textContent='Write a message before sending.';return;}
    saveDraft();const id=selected;const draft=storage.get(draftKey(id));const nonce=draft?.id||crypto.randomUUID();
    busy=true;el('send-message').disabled=true;el('message-body').disabled=true;el('send-feedback').textContent='Sending…';
    try{await ItemChat.send(id,nonce,body);storage.remove(draftKey(id));el('message-body').value='';el('send-feedback').textContent='Message sent.';}
    catch(error){el('send-feedback').textContent=ItemChat.message(error);}
    finally{busy=false;el('send-message').disabled=false;el('message-body').disabled=false;await refresh();}
  });
  el('older-messages').addEventListener('click',async()=>{
    if(!selected||!messageRows.length)return;const id=selected;el('older-messages').disabled=true;
    try{const rows=await ItemChat.messages(id,messageRows[0].id);if(id!==selected)return;const map=new Map([...rows,...messageRows].map(row=>[String(row.id),row]));messageRows=[...map.values()].sort((a,b)=>Number(a.id)-Number(b.id));moreHistory=rows.length===50;messageList();}
    catch(error){el('send-feedback').textContent=ItemChat.message(error);}finally{el('older-messages').disabled=false;}
  });
  el('refresh-chat').addEventListener('click',()=>{setFeedback('');void refresh();});
  for(const [id,type,delta] of [['inbox-prev','inbox',-50],['inbox-next','inbox',50],['queue-prev','queue',-50],['queue-next','queue',50]])el(id).addEventListener('click',()=>{if(busy||loading)return;if(type==='inbox')inboxOffset=Math.max(0,inboxOffset+delta);else queueOffset=Math.max(0,queueOffset+delta);void refresh();});
  document.addEventListener('community:authenticated',async({detail})=>{
    const changed=state&&state.user.id!==detail.user.id;
    const first=!state||changed;
    if(changed){version++;selected=null;current=null;messageRows=[];el('messages').replaceChildren();el('handoff-details').replaceChildren();el('handoff-actions').replaceChildren();el('conversations').replaceChildren();el('message-body').value='';el('message-form').hidden=true;}
    state=detail;el('back-dashboard').href=AppNavigation.url(CommunityAuth.destination(state));
    if(first){if(selected)el('message-body').value=storage.get(draftKey(selected))?.body||'';await loadSource();}
    void refresh();
  });
  setInterval(()=>{if(!document.hidden&&!busy&&!loading)void refresh();},10000);
})();
