(function () {
  'use strict';
  const label=value=>value?String(value).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()):'—';
  const text=(tag,value,className)=>{const n=document.createElement(tag);n.textContent=value??'—';if(className)n.className=className;return n;};
  const date=value=>value?new Date(value).toLocaleString():'—';
  const metricLabels={users:'Total users',verified_assistants:'Eligible assistants',pending_assistants:'Pending verification',open_requests:'Open requests',active_requests:'Active requests',completed_requests:'Completed requests',available_donations:'Available donations now',reports_to_review:'Reports to review',waiting_deliveries:'Deliveries waiting for help'};
  function mount(kind) {
    const main=document.querySelector('main');
    const toolbar=document.createElement('div');toolbar.className='admin-toolbar';
    const button=name=>{const n=text('button',name,'btn btn-secondary');n.type='button';return n;};
    const refresh=button('Refresh'),previous=button('Previous'),next=button('Next'),page=text('span','Page 1');
    toolbar.append(refresh);if(kind!=='dashboard')toolbar.append(previous,page,next);
    const feedback=text('p','');feedback.id='admin-feedback';feedback.setAttribute('role','status');main.querySelector('.page-heading').after(toolbar,feedback);
    const container=document.getElementById(kind==='dashboard'?'statsContainer':kind==='reports'?'reportsContainer':kind+'TableBody');
    const empty=document.getElementById('emptyStateContainer');
    const filters=[...document.querySelectorAll('.filters-bar select')];const search=document.getElementById('searchInput');
    const dialog=document.getElementById('admin-detail');const form=document.getElementById('admin-action-form');
    let offset=0,rows=[],sequence=0,busy=false,ready=false,selected=null,canAct=false,timer;
    const selectedFilters=()=>Object.fromEntries(filters.map(f=>[({roleFilter:'role',statusFilter:'status',typeFilter:kind==='reports'?'category':'request_type',urgencyFilter:'urgency',categoryFilter:'category',reviewFilter:'review'})[f.id],f.value]));
    function render() {
      container.replaceChildren();if(empty)empty.textContent=rows.length?'':'No records match these filters.';
      if(kind==='reports'&&!rows.length)container.append(text('p','No reports match these filters.','empty-state'));
      for(const row of rows){
        if(kind==='reports'){
          const card=text('article','','item-card');card.append(text('h3',label(row.category)),text('p',row.description),text('p',row.reviewed_at?'Reviewed '+date(row.reviewed_at):'Awaiting review','meta'),text('p','Location: '+(row.location||'Not provided'),'meta'));
          const view=button('Review report');view.addEventListener('click',()=>showDetails(row));card.append(view);container.append(card);continue;
        }
        const tr=document.createElement('tr');let values,labels;
        if(kind==='users'){values=[[row.first_name,row.last_name].filter(Boolean).join(' ')||'Community member',label(row.role),date(row.created_at),row.verification_status?label(row.verification_status)+' · '+label(row.training_status):'No assistant application'];labels=['Name','Role','Created','Assistant verification'];}
        if(kind==='requests'){values=[row.id,label(row.request_type),label(row.category),label(row.status),row.location||'Not provided',date(row.created_at)];labels=['ID','Type','Category','Status','Location','Created'];}
        if(kind==='donations'){values=[row.item_name,label(row.category),row.quantity,row.location,label(row.status),date(row.available_until)];labels=['Item','Category','Quantity','Location','Status','Available until'];}
        values.forEach((value,i)=>{const td=text('td',value);td.dataset.label=labels[i];tr.append(td);});
        if(kind!=='users'){const td=document.createElement('td');td.dataset.label='Actions';const view=button('View details');view.addEventListener('click',()=>showDetails(row));td.append(view);tr.append(td);}
        container.append(tr);
      }
      previous.disabled=offset===0;next.disabled=rows.length<50;page.textContent='Page '+(offset/50+1);
    }
    function showDetails(row) {
      selected=row;document.getElementById('admin-detail-title').textContent=row.item_name||label(row.category);
      const details=document.getElementById('admin-detail-body');details.replaceChildren();
      for(const [key,title] of [['description','Description'],['status','Status'],['quantity','Quantity'],['location','Location'],['urgency','Urgency'],['preferred_date','Preferred date'],['preferred_time','Preferred time'],['additional_info','Additional information'],['available_from','Available from'],['available_until','Available until'],['created_at','Created'],['reviewed_at','Reviewed'],['review_note','Review note']]){
        if(row[key]!=null&&row[key]!==''){details.append(text('dt',title),text('dd',key.endsWith('_at')||key.startsWith('available_')?date(row[key]):String(row[key])));}
      }
      canAct=kind==='reports'||(kind==='requests'&&row.status==='open')||(kind==='donations'&&row.status==='available');
      document.getElementById('admin-note-group').hidden=!canAct;
      document.getElementById('admin-note').value=kind==='reports'?row.review_note||'':'';
      document.getElementById('admin-note').required=canAct;
      const save=document.getElementById('admin-save');save.hidden=!canAct;save.textContent=kind==='reports'?'Save review':kind==='requests'?'Cancel request':'Cancel donation';
      document.getElementById('admin-action-help').textContent=kind==='reports'?'Record your review and any follow-up taken. This does not claim the reported problem has been resolved.':'Only open, unassigned requests and unreserved donations can be cancelled. Enter the reason below.';
      document.getElementById('admin-action-message').textContent='';dialog.showModal();
    }
    async function load() {
      const run=++sequence;refresh.disabled=previous.disabled=next.disabled=true;feedback.textContent='Loading…';
      try{
        if(kind==='dashboard'){
          const stats=await AdminAPI.overview();if(run!==sequence)return;container.replaceChildren();
          for(const [key,name] of Object.entries(metricLabels)){const card=text('article','','stat-card');card.append(text('div',Number(stats[key]??0).toLocaleString(),'stat-value'),text('div',name,'stat-label'));container.append(card);}
          feedback.textContent='Updated '+new Date().toLocaleTimeString();
        }else{const data=await AdminAPI.list(kind,offset,selectedFilters(),search?.value.trim()||'');if(run!==sequence)return;rows=data||[];render();feedback.textContent=rows.length+' record'+(rows.length===1?'':'s')+' on this page. Filters search all records.';}
      }catch(error){if(run!==sequence)return;rows=[];container.replaceChildren();if(empty)empty.textContent='';feedback.textContent=AdminAPI.message(error);previous.disabled=offset===0;}
      finally{if(run===sequence)refresh.disabled=false;}
    }
    refresh.addEventListener('click',()=>{if(!busy)void load();});
    previous.addEventListener('click',()=>{if(!busy){offset=Math.max(0,offset-50);void load();}});
    next.addEventListener('click',()=>{if(!busy){offset+=50;void load();}});
    filters.forEach(f=>f.addEventListener('change',()=>{offset=0;void load();}));
    search?.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{offset=0;void load();},300);});
    if(dialog){
      document.getElementById('admin-close').addEventListener('click',()=>{if(!busy)dialog.close();});
      dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(busy||!selected||!canAct||!form.reportValidity())return;
        const note=document.getElementById('admin-note').value.trim();const message=document.getElementById('admin-action-message');if(!note){message.textContent='Enter a review note or cancellation reason.';return;}
        busy=true;form.querySelector('fieldset').disabled=true;message.textContent='Saving…';
        try{await AdminAPI.moderate({reports:'report',requests:'request',donations:'donation'}[kind],selected.id,note);dialog.close();await load();feedback.textContent=kind==='reports'?'Review saved.':'Cancellation saved.';}
        catch(error){message.textContent=AdminAPI.message(error);}finally{busy=false;form.querySelector('fieldset').disabled=false;}
      });
    }
    document.addEventListener('community:authenticated',({detail:state})=>{
      if(state.profile.role!=='admin'){container.replaceChildren();feedback.textContent='These tools require a real administrator account. Developer view does not grant data permissions.';refresh.disabled=previous.disabled=next.disabled=true;filters.forEach(f=>f.disabled=true);if(search)search.disabled=true;return;}
      if(!ready){ready=true;void load();}
    });
  }
  window.AdminPage=Object.freeze({mount});
})();
