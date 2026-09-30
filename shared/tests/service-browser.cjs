// Service UI regression tests. All Supabase traffic is mocked; no live data is read or changed.
// Isolated browser accounts share an in-memory backend to exercise persisted lifecycle updates.
// These checks do not replace applying/testing the SQL migration against a real Supabase project.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const prefix = '/Community_Services/';
const pages = {
  help: 'community-user/frontend/community-user_request-service.html',
  mine: 'community-user/frontend/community-user_requests.html',
  available: 'verified-assistant/frontend/verified-assistant_available-requests.html',
  active: 'verified-assistant/frontend/verified-assistant_active-jobs.html',
  completed: 'verified-assistant/frontend/verified-assistant_completed-jobs.html',
  dashboard: 'community-user/frontend/community-user_dashboard.html',
  donate: 'community-user/frontend/community-user_donate.html',
  browse: 'community-user/frontend/community-user_browse-requests.html',
  assistantDashboard: 'verified-assistant/frontend/verified-assistant_dashboard.html',
  assistantProfile: 'verified-assistant/frontend/verified-assistant_profile.html',
  training: 'verified-assistant/frontend/verified-assistant_training.html',
  account: 'profile.html',
  reviews: 'admin/frontend/admin_verify_assistants.html'
};
const sdkMock = `(() => {
  let callback;
  window.supabase = { createClient: () => ({
    auth: {
      onAuthStateChange(fn) { callback = fn; return {data:{subscription:{unsubscribe(){}}}}; },
      async getSession() { return {data:{session:window.testAccount.id ? {user:{id:window.testAccount.id}} : null}}; },
      async getUser() { return {data:{user:window.testAccount.id ? {id:window.testAccount.id} : null}}; },
      async signOut() { callback('SIGNED_OUT',null); return {}; }
    },
    from(table) {
      const query = {table, filters:[], ors:[]};
      const builder = {
        select(columns) { query.columns=columns; return this; },
        update(changes) { query.update=changes; return this; },
        insert(rows) { query.insert=Array.isArray(rows)?rows:[rows]; return this; },
        eq(key,value) { query.filters.push(['eq',key,value]); return this; },
        neq(key,value) { query.filters.push(['neq',key,value]); return this; },
        in(key,value) { query.filters.push(['in',key,value]); return this; },
        or(expression) { query.ors.push(expression); return this; },
        order(key,options) { query.order={key,...options}; return this; },
        range(start,end) { query.range=[start,end]; return this; },
        limit(count) { query.limit=count; return this; },
        single() { query.single=true; return window.testBackend({kind:'query',...query}); },
        maybeSingle() { return window.testBackend({kind:'query',...query,single:true}); },
        then(resolve,reject) { return window.testBackend({kind:'query',...query}).then(resolve,reject); }
      }; return builder;
    },
    rpc(name,args) { return window.testBackend({kind:'rpc',name,args}); },
    storage: { from(bucket) { return {
      upload(path,file,options) { return window.testBackend({kind:'storage',op:'upload',bucket,path,contentType:options?.contentType}); },
      getPublicUrl(path) { return {data:{publicUrl:'https://cdn.test/'+bucket+'/'+path}}; }
    }; } }
  })};
})();`;

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + pathname.replace(/^\/Community_Services/, ''));
  if (!file.startsWith(root + path.sep) || !/\.(html|js|css)$/.test(file) || !fs.existsSync(file)) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'text/javascript; charset=utf-8');
  res.end(fs.readFileSync(file));
});

function backend() {
  const db = { assistantRows: [], failUpdate: null, requests: [], assignments: [], reports: [], donations: [], donation_images: [], storageFiles: [],
    calls: [], failQuery: null, failRpc: null, delayRpc: 0 };
  const error = code => ({error:{code,message:'Private database detail must never be shown'}});
  const verified = account => account.assistant?.verification_status === 'verified' && account.assistant?.training_status === 'completed';
  db.request = (changes = {}) => {
    const row = { id:randomUUID(), user_id:'member', request_type:'service', category:'grocery_collection',
      description:'Please collect groceries', location:'Community hall', preferred_date:'2099-12-31',
      preferred_time:'10:30:00', urgency:'medium', additional_info:null, latitude:null, longitude:null,
      status:'open', created_at:new Date().toISOString(), updated_at:new Date().toISOString(), ...changes };
    db.requests.push(row); return row;
  };
  // Minimal evaluator for the .or() expressions the frontend sends (is.null, lte/gte, ilike substring).
  const orMatch = (row, expression) => expression.split(',').some(part => {
    if (part.endsWith('.is.null')) return row[part.slice(0,-'.is.null'.length)] == null;
    let match = part.match(/^(.*)\.(lte|gte|lt|gt|eq)\.(.*)$/);
    if (match) {
      const value = row[match[1]];
      if (value == null) return false;
      const left = String(value), right = match[3];
      return match[2] === 'lte' ? left <= right : match[2] === 'gte' ? left >= right
        : match[2] === 'lt' ? left < right : match[2] === 'gt' ? left > right : left === right;
    }
    match = part.match(/^(.*)\.ilike\.%(.*)%$/);
    if (match) return String(row[match[1]] ?? '').toLowerCase().includes(match[2].toLowerCase());
    return false;
  });
  db.handle = async (account, call) => {
    db.calls.push({account:account.id,...structuredClone(call)});
    if (call.kind === 'storage') {
      if (call.op === 'upload') { db.storageFiles.push({bucket:call.bucket,path:call.path,contentType:call.contentType}); return {data:{path:call.path}}; }
      return error('P0001');
    }
    if (call.kind === 'query') {
      if (call.update) {
        if (db.failUpdate) { db.failUpdate = null; return error('42501'); }
        if (call.table === 'assistants') {
          assert.deepEqual(Object.keys(call.update),['availability']);
          assert.ok(call.filters.some(([op,key,value]) => key==='user_id' && value===account.id));
          Object.assign(account.assistant,call.update); return {data:structuredClone(account.assistant)};
        }
        if (call.table === 'profiles') { account.savedProfile={...account.savedProfile,...call.update,id:account.id}; return {data:structuredClone(account.savedProfile)}; }
      }
      if (call.insert) {
        if (call.table === 'requests') for (const row of call.insert) assert.equal(row.user_id,account.id);
        const defaults = call.table === 'donations' ? {status:'available'} : {};
        const rows = call.insert.map(row => ({...defaults, id:randomUUID(), ...row}));
        db[call.table].push(...rows);
        return {data:structuredClone(call.single ? rows[0] : rows)};
      }
      if (call.table === 'profiles') return {data:{id:account.id, role:account.role || 'community_user', first_name:'Test', last_name:account.id,...account.savedProfile}};
      if (call.table === 'assistants') {
        if(call.single) return {data:structuredClone(account.assistant || null)};
        let rows=db.assistantRows;
        for(const [op,key,value] of call.filters) rows=rows.filter(row=>row[key]===value);
        if(call.range) rows=rows.slice(call.range[0],call.range[1]+1);
        return {data:structuredClone(rows)};
      }
      if (call.table === 'developer_accounts') return {data:account.developer ? {user_id:account.id} : null};
      if (db.failQuery) { const code=db.failQuery; db.failQuery=null; return error(code); }
      // Model account visibility independently of the query's filters.
      let rows;
      if (call.table === 'requests') {
        rows = db.requests.filter(row => row.user_id === account.id || verified(account)
          || (row.request_type === 'resource' && row.status === 'open'));
      } else if (call.table === 'assignments') {
        rows = db.assignments.filter(row => row.assistant_id === account.assistant?.id)
          .map(row => ({...row,requests:db.requests.find(request => request.id === row.request_id)}));
      } else {
        rows = (db[call.table] || []).slice();
      }
      for (const [op,key,value] of call.filters) rows=rows.filter(row => op === 'eq' ? row[key] === value : op === 'neq' ? row[key] !== value : value.includes(row[key]));
      for (const expression of call.ors) rows=rows.filter(row => orMatch(row,expression));
      if (call.order) rows=[...rows].sort((a,b) => String(a[call.order.key]).localeCompare(String(b[call.order.key])) * (call.order.ascending ? 1 : -1));
      if (call.range) rows=rows.slice(call.range[0],call.range[1]+1);
      if (call.limit != null) rows=rows.slice(0,call.limit);
      return {data:structuredClone(rows)};
    }
    if (db.delayRpc) await new Promise(resolve => setTimeout(resolve,db.delayRpc));
    const failure=db.failRpc; db.failRpc=null;
    if (failure && !failure.afterCommit) return error(failure.code);
    assert.ok(account.id, 'RPC requires an authenticated principal');
    if (call.name === 'apply_to_be_assistant') {
      account.assistant ||= {id:'assistant-'+account.id,user_id:account.id,verification_status:'pending',training_status:'not_started',availability:'unavailable'};
      return {data:structuredClone(account.assistant)};
    }
    if (call.name === 'review_assistant') {
      if(account.role!=='admin') return error('42501');
      const target=db.assistantRows.find(row=>row.id===call.args.p_assistant_id);
      if(!target || target.verification_status!==call.args.p_expected_verification || target.training_status!==call.args.p_expected_training) return error('40001');
      target.verification_status=call.args.p_verification; target.training_status=call.args.p_training;
      return {data:structuredClone(target)};
    }
    assert.equal(Object.keys(call.args).some(key => /user|assistant|role|status/.test(key)),false,'client must not supply authority fields');
    let row=db.requests.find(request => request.id === call.args.p_request_id);
    if (call.name === 'create_service_request') {
      if (row && row.user_id !== account.id) return error('42501');
      if (!row) row=db.request({id:call.args.p_request_id,user_id:account.id,category:call.args.p_category,
        description:call.args.p_description,location:call.args.p_location,preferred_date:call.args.p_preferred_date,
        preferred_time:call.args.p_preferred_time,urgency:call.args.p_urgency,additional_info:call.args.p_additional_info,
        problems_addressed:call.args.p_problems_addressed,latitude:call.args.p_latitude ?? null,longitude:call.args.p_longitude ?? null});
    } else {
      if (!row) return error('P0001');
      const assignment=db.assignments.find(item => item.request_id === row.id);
      if (['cancel_service_request','cancel_resource_request'].includes(call.name)) {
        if (row.user_id !== account.id) return error('42501');
        if (row.status !== 'open') return error('P0001');
        row.status='cancelled';
      } else if (call.name === 'accept_service_request') {
        if (!verified(account) || row.user_id === account.id) return error('42501');
        if (row.status !== 'open' || assignment) return error('P0001');
        row.status='assigned';
        db.assignments.push({id:randomUUID(),request_id:row.id,assistant_id:account.assistant.id,status:'assigned',created_at:new Date().toISOString()});
      } else {
        if (!verified(account) || assignment?.assistant_id !== account.assistant.id) return error('42501');
        const starting=call.name === 'start_service_request';
        if (row.status !== (starting ? 'assigned' : 'in_progress')) return error('P0001');
        row.status=assignment.status=starting ? 'in_progress' : 'completed';
        if (!starting) assignment.completed_at=new Date().toISOString();
      }
    }
    return failure ? error(failure.code) : {data:structuredClone(row)};
  };
  return db;
}

(async () => {
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}${prefix}`;
  const browser=await chromium.launch({channel:process.env.AUTH_TEST_BROWSER || 'msedge',headless:true});
  let count=0;
  const assistant = id => ({id,role:'assistant',assistant:{id:'assistant-'+id,user_id:id,verification_status:'verified',training_status:'completed',availability:'unavailable'}});
  async function scenario(name, run) {
    const db=backend(), contexts=[], errors=[];
    async function account(settings) {
      const context=await browser.newContext({viewport:{width:390,height:844},
        permissions:settings.geolocation ? ['geolocation'] : []}); contexts.push(context);
      if (settings.geolocation) await context.setGeolocation(settings.geolocation);
      await context.addInitScript(settings => {
        window.testAccount=settings;
        if (settings.developerView) sessionStorage.setItem('community-services.developer-view',JSON.stringify({userId:settings.id,view:settings.developerView}));
      },settings);
      await context.exposeBinding('testBackend',(_,call)=>db.handle(settings,call));
      await context.route('**/*',route => {
        const url=route.request().url();
        if (url.startsWith(base)) return route.continue();
        if (url.startsWith('https://cdn.jsdelivr.net/')) return route.fulfill({contentType:'text/javascript',body:sdkMock});
        return route.abort();
      });
      const page=await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror',error => errors.push(error.message));
      page.on('dialog',dialog => dialog.accept());
      return page;
    }
    try { await run({db,account}); assert.deepEqual(errors,[]); count++; console.log('PASS '+name); }
    finally { await Promise.all(contexts.map(context => context.close())); }
  }
  const listPages = new Set(['mine','available','active','completed','browse']);
  async function open(page,key) {
    await page.goto(base+pages[key]);
    await page.locator('#protected-content').waitFor({state:'visible'});
    if (listPages.has(key)) await page.getByRole('button',{name:'Refresh',exact:true}).waitFor({state:'visible'});
  }
  const message = (page,text) => page.locator('#service-message').filter({hasText:text}).waitFor();
  const cards = page => page.locator('article.item-card');
  const action = (page,name) => page.getByRole('button',{name,exact:true}).click();
  async function fillRequest(page, description='Please help me collect groceries') {
    await page.locator('input[name=serviceCategory][value=grocery_collection]').check();
    await page.locator('input[name=problemsAddressed][value=food_access]').check();
    await page.locator('#serviceDescription').fill(description);
    await page.locator('#serviceLocation').fill('Community hall');
    await page.locator('#servicePreferredDate').fill('2099-12-31');
    await page.locator('#servicePreferredTime').fill('10:30');
    await page.locator('#serviceUrgency').selectOption('medium');
  }
  try {
    await scenario('assistant dashboard shows saved jobs, handles availability failures and survives reload', async ({db,account}) => {
      db.request({description:'A neighbour needs groceries'});
      const page=await account(assistant('worker'));
      await open(page,'assistantDashboard');
      await page.locator('#available-count').filter({hasText:'1'}).waitFor();
      await page.locator('#availableRequestsContainer').filter({hasText:'A neighbour needs groceries'}).waitFor();
      db.failUpdate=true;
      await page.locator('#availability-toggle').click();
      await page.locator('#availability-message').filter({hasText:'cannot make this change'}).waitFor();
      assert.equal(await page.locator('#availability-toggle').getAttribute('aria-pressed'),'false');
      await page.locator('#availability-toggle').click();
      await page.locator('#availability-message').filter({hasText:'Availability saved'}).waitFor();
      await page.reload();
      await page.locator('#availability-toggle[aria-pressed="true"]').waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(root,'test-results/assistant-dashboard-mobile.png'),fullPage:true});
      await page.setViewportSize({width:1440,height:1000});
      await page.screenshot({path:path.join(root,'test-results/assistant-dashboard-desktop.png'),fullPage:true});
    });
    await scenario('assistant profile saves real details and preserves unsaved edits on recheck', async ({account}) => {
      const page=await account(assistant('worker')); await open(page,'assistantProfile');
      await page.locator('#first_name').fill('Naledi');
      await page.evaluate(async()=>document.dispatchEvent(new CustomEvent('community:authenticated',{detail:await CommunityAuth.state(true)})));
      assert.equal(await page.locator('#first_name').inputValue(),'Naledi');
      await page.locator('#save-profile').click();
      await page.locator('#profile-message').filter({hasText:'has been saved'}).waitFor();
      await page.reload(); await page.locator('#first_name').waitFor();
      assert.equal(await page.locator('#first_name').inputValue(),'Naledi');
      await page.locator('#identityStatus').filter({hasText:'Verified'}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(root,'test-results/assistant-profile-mobile.png'),fullPage:true});
    });
    await scenario('community member applies once and sees actual pending training status', async ({db,account}) => {
      const page=await account({id:'new-helper'}); await open(page,'account');
      await page.locator('#apply-assistant').click();
      await page.locator('#membership-message').filter({hasText:'Application received'}).waitFor();
      await page.reload(); await page.locator('#membership-status').filter({hasText:'Pending'}).waitFor();
      assert.equal(await page.locator('#apply-assistant').isVisible(),false);
      await open(page,'training');
      await page.locator('#training-state').filter({hasText:'Not Started'}).waitFor();
      await page.locator('#verification-state').filter({hasText:'Pending'}).waitFor();
      assert.equal(db.calls.filter(c=>c.name==='apply_to_be_assistant').length,1);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    });
    await scenario('admin reviews real applications, validates reasons and detects stale reviews', async ({db,account}) => {
      db.assistantRows.push({id:'app-1',user_id:'person-1',verification_status:'pending',training_status:'not_started',created_at:new Date().toISOString(),profiles:{first_name:'Lerato',last_name:'Mokoena'}});
      const page=await account({id:'admin',role:'admin'}); await open(page,'reviews');
      await page.getByRole('button',{name:'Review Lerato Mokoena'}).click();
      await page.locator('#review-verification').selectOption('suspended');
      await page.getByRole('button',{name:'Save review'}).click();
      await page.locator('#dialog-message').filter({hasText:'Include a reason'}).waitFor();
      await page.locator('#review-verification').selectOption('verified');
      await page.locator('#review-training').selectOption('completed');
      await page.getByRole('button',{name:'Save review'}).click();
      await page.locator('#review-message').filter({hasText:'review saved'}).waitFor();
      await page.locator('#assistantsTableBody').filter({hasText:'Verified'}).waitFor();
      await page.getByRole('button',{name:'Review Lerato Mokoena'}).click();
      db.assistantRows[0].verification_status='suspended';
      await page.getByRole('button',{name:'Save review'}).click();
      await page.locator('#dialog-message').filter({hasText:'updated by someone else'}).waitFor();
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.locator('#refresh-assistants').click();
      await page.locator('#assistantsTableBody').filter({hasText:'Suspended'}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(root,'test-results/assistant-review-mobile.png'),fullPage:true});
    });
    await scenario('developer admin preview cannot list or review assistant applications', async ({db,account}) => {
      const page=await account({id:'dev',developer:true,developerView:'admin'}); await open(page,'reviews');
      await page.locator('#emptyStateContainer').filter({hasText:'real administrator'}).waitFor();
      assert.equal(await page.locator('#refresh-assistants').isDisabled(),true);
      assert.equal(db.calls.some(c=>c.table==='assistants'&&!c.single),false);
    });
    await scenario('service lifecycle persists across member and assistant accounts',async ({db,account}) => {
      const member=await account({id:'member'}), worker=await account(assistant('worker'));
      await open(member,'help'); await fillRequest(member);
      await action(member,'Submit Service Request');
      await member.getByText('Service request submitted successfully.',{exact:false}).waitFor();
      assert.equal(db.requests.length,1); assert.equal(db.requests[0].status,'open');
      assert.deepEqual(db.requests[0].problems_addressed,['food_access']);
      await open(member,'mine'); await cards(member).filter({hasText:'Open'}).waitFor();
      await open(worker,'available'); await action(worker,'Accept request'); await message(worker,'Request accepted');
      await member.reload(); await cards(member).filter({hasText:'Assigned'}).waitFor();
      assert.equal(await member.getByRole('button',{name:'Cancel request',exact:true}).count(),0);
      await open(worker,'active'); await action(worker,'Start job'); await message(worker,'Job started');
      await action(worker,'Complete job'); await message(worker,'Job completed');
      await open(worker,'completed'); await cards(worker).filter({hasText:'Completed'}).waitFor();
      await member.reload(); await cards(member).filter({hasText:'Completed'}).waitFor();
      assert.equal(db.assignments.length,1); assert.equal(db.assignments[0].status,'completed');
      await member.reload(); await cards(member).filter({hasText:'Completed'}).waitFor();
      assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
      assert.equal(await worker.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
    });
    await scenario('lost create response retries the same ID without duplicates',async ({db,account}) => {
      const member=await account({id:'member'}); await open(member,'help'); await fillRequest(member);
      db.failRpc={code:'NETWORK',afterCommit:true}; db.delayRpc=200;
      await action(member,'Submit Service Request');
      await member.locator('#message').filter({hasText:'could not be completed'}).waitFor();
      assert.equal(await member.locator('#serviceDescription').inputValue(),'Please help me collect groceries');
      assert.equal(db.requests.length,1);
      await action(member,'Submit Service Request');
      await member.getByText('Service request submitted successfully.',{exact:false}).waitFor();
      const calls=db.calls.filter(call=>call.name==='create_service_request');
      assert.equal(calls.length,2); assert.equal(calls[0].args.p_request_id,calls[1].args.p_request_id);
      assert.equal(db.requests.length,1);
    });
    await scenario('blank description blocks submission and form fits mobile',async ({db,account}) => {
      const member=await account({id:'member'}); await open(member,'help'); await fillRequest(member,'   ');
      await action(member,'Submit Service Request');
      await member.locator('#serviceDescriptionError').filter({hasText:'Please describe what you need.'}).waitFor();
      assert.equal(db.calls.filter(call=>call.kind==='rpc').length,0);
      assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
      fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
      await member.screenshot({path:path.join(root,'test-results/service-form-mobile.png'),fullPage:true});
    });
    await scenario('member sees own requests only and cancellation persists',async ({db,account}) => {
      db.request(); db.request({user_id:'another-member',description:'Private request from another member'});
      const member=await account({id:'member'}); await open(member,'mine');
      await cards(member).waitFor(); assert.equal(await cards(member).count(),1);
      await action(member,'Cancel request'); await message(member,'Request cancelled');
      await member.reload(); await cards(member).filter({hasText:'Cancelled'}).waitFor();
      assert.equal(await member.getByRole('button',{name:'Cancel request',exact:true}).count(),0);
      assert.equal(db.requests[1].status,'open');
    });
    await scenario('two assistants with stale listings cannot show duplicate acceptance',async ({db,account}) => {
      db.request(); const first=await account(assistant('first')), second=await account(assistant('second'));
      await open(first,'available'); await open(second,'available');
      await action(first,'Accept request'); await message(first,'Request accepted');
      await action(second,'Accept request'); await message(second,'no longer available');
      assert.equal(db.assignments.length,1); assert.equal(db.assignments[0].assistant_id,'assistant-first');
      assert.equal(await second.locator('#service-message').textContent().then(text=>text.includes('accepted')),false);
      await action(second,'Refresh'); await second.getByText('No available requests right now.',{exact:true}).waitFor();
    });
    await scenario('RPC failure preserves actual status and permits retry',async ({db,account}) => {
      db.request(); const member=await account({id:'member'}); await open(member,'mine');
      db.failRpc={code:'42501'}; await action(member,'Cancel request'); await message(member,'cannot perform this action');
      assert.equal(db.requests[0].status,'open'); assert.equal(await cards(member).locator('.badge').textContent(),'Open');
      assert.equal(await member.getByRole('button',{name:'Cancel request',exact:true}).isEnabled(),true);
      assert.equal(await member.getByText('Private database detail',{exact:false}).count(),0);
      await action(member,'Cancel request'); await message(member,'Request cancelled');
    });
    await scenario('active delivery rejection explains how to finish before accepting service work',async ({db,account}) => {
      db.request();const worker=await account(assistant('worker'));await open(worker,'available');
      db.failRpc={code:'55000'};await action(worker,'Accept request');await message(worker,'Finish your current item delivery');
      assert.equal(db.requests[0].status,'open');assert.equal(db.assignments.length,0);
      assert.equal(await worker.getByRole('button',{name:'Accept request',exact:true}).isEnabled(),true);
      await action(worker,'Accept request');await message(worker,'Request accepted');
    });
    await scenario('failed list refresh displays error and recovers',async ({db,account}) => {
      db.request(); const member=await account({id:'member'}); db.failQuery='PGRST202';
      await open(member,'mine'); await message(member,'finish setup'); assert.equal(await cards(member).count(),0);
      await action(member,'Refresh'); await cards(member).waitFor();
      assert.equal(await member.locator('#service-message').textContent(),'');
    });
    await scenario('successful mutation followed by failed refresh preserves the refresh error',async ({db,account}) => {
      db.request(); const worker=await account(assistant('worker')); await open(worker,'available');
      await cards(worker).waitFor(); db.failQuery='NETWORK';
      await action(worker,'Accept request'); await message(worker,'could not be completed');
      assert.equal(db.requests[0].status,'assigned'); assert.equal(await cards(worker).count(),0);
      assert.equal(await worker.locator('#service-message').textContent().then(text=>text.includes('Request accepted')),false);
      await action(worker,'Refresh'); await worker.getByText('No available requests right now.',{exact:true}).waitFor();
    });
    await scenario('available queue excludes assistant own requests',async ({db,account}) => {
      db.request({user_id:'worker',description:'My own request'}); db.request({description:'Someone else needs help'});
      const worker=await account(assistant('worker')); await open(worker,'available'); await cards(worker).waitFor();
      assert.equal(await cards(worker).count(),1); assert.equal(await cards(worker).textContent().then(text=>text.includes('My own request')),false);
    });
    await scenario('developer assistant preview never grants work actions',async ({db,account}) => {
      db.request(); const developer=await account({id:'developer',developer:true,developerView:'assistant'});
      await open(developer,'available'); await message(developer,'real account needs verified assistant status');
      assert.equal(await developer.getByRole('button',{name:'Accept request',exact:true}).count(),0);
      assert.equal(db.calls.filter(call=>call.kind==='rpc').length,0);
    });
    await scenario('pending assistant and anonymous visitor are routed away',async ({account}) => {
      for (const settings of [{id:null},{id:'pending',role:'assistant',assistant:{id:'pending',verification_status:'pending',training_status:'incomplete'}}]) {
        const page=await account(settings); await page.goto(base+pages.available);
        await page.waitForURL(base+(settings.id ? 'community-user/frontend/community-user_dashboard.html' : 'login.html'));
        assert.equal(await page.getByRole('button',{name:'Accept request',exact:true}).count(),0);
      }
    });
    await scenario('untrusted request values render as text without executing markup',async ({db,account}) => {
      const payload='<img src=x onerror="window.testXss=true">';
      db.request({description:payload,location:payload,additional_info:payload});
      const member=await account({id:'member'}); await open(member,'mine'); await cards(member).waitFor();
      assert.equal(await cards(member).locator('img').count(),0);
      assert.equal(await member.evaluate(()=>window.testXss),undefined);
      assert.ok((await cards(member).textContent()).includes(payload));
      assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
    });
    await scenario('team item and report pages still submit their structured fields',async ({db,account}) => {
      const member=await account({id:'member'});
      await member.goto(base+'community-user/frontend/community-user_request-new-item.html');
      await member.locator('#protected-content').waitFor({state:'visible'});
      await member.locator('#itemName').fill('Rice');
      await member.locator('#itemCategory').selectOption('food');
      await member.locator('#itemQuantity').fill('3');
      await member.locator('#itemDescription').fill('Food for the household');
      await member.locator('#itemLocation').fill('Community hall');
      await member.locator('#itemUrgency').selectOption('medium');
      await action(member,'Submit Item Request');
      await member.locator('#message').filter({hasText:'Item request submitted successfully'}).waitFor();
      assert.equal(db.requests[0].item_name,'Rice');assert.equal(db.requests[0].quantity,3);
      await open(member,'mine');await cards(member).filter({hasText:'Rice'}).waitFor();
      await member.goto(base+'community-user/frontend/community-user_report-problem.html');
      await member.locator('#protected-content').waitFor({state:'visible'});
      await member.locator('#problemType').selectOption('community_issue');
      await member.locator('#problemDescription').fill('Broken street light');
      await member.locator('#problemLocation').fill('Community hall');
      await member.locator('#problemUrgency').selectOption('high');
      await member.locator('#problemAdditional').fill('Near the entrance');
      await action(member,'Submit Problem Report');
      await member.locator('#message').filter({hasText:'Problem report submitted successfully'}).waitFor();
      assert.equal(db.reports[0].urgency,'high');assert.equal(db.reports[0].additional_info,'Near the entrance');
    });
    await scenario('item requests remain visible and use their own cancellation RPC',async ({db,account}) => {
      db.request({request_type:'resource',item_name:'Rice',quantity:2});
      const member=await account({id:'member'}); await open(member,'mine'); await cards(member).waitFor();
      assert.ok((await cards(member).textContent()).includes('Rice'));
      assert.ok((await cards(member).textContent()).includes('Quantity: 2'));
      await action(member,'Cancel request'); await message(member,'Request cancelled');
      assert.equal(db.calls.filter(call=>call.name==='cancel_resource_request').length,1);
    });
    await scenario('pagination exposes requests beyond the first fifty',async ({db,account}) => {
      for (let i=0;i<51;i++) db.request({description:'Request number '+i,created_at:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()});
      const member=await account({id:'member'}); await open(member,'mine'); await member.getByText('Request number 50',{exact:true}).waitFor();
      assert.equal(await cards(member).count(),50);
      await action(member,'Next'); await member.getByText('Request number 0',{exact:true}).waitFor();
      assert.equal(await cards(member).count(),1); assert.equal(await member.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
      await action(member,'Previous'); await member.getByText('Request number 50',{exact:true}).waitFor();
      assert.equal(await member.getByRole('button',{name:'Previous',exact:true}).isDisabled(),true);
    });
    await scenario('live location button fills coordinates into the service request',async ({db,account}) => {
      const member=await account({id:'member',geolocation:{latitude:-25.7479,longitude:28.2293}});
      await open(member,'help');
      await member.getByRole('button',{name:'Use my current location'}).click();
      await member.locator('#serviceLocateStatus').filter({hasText:'Location captured'}).waitFor();
      assert.equal(await member.locator('#serviceLatitude').inputValue(),'-25.7479');
      assert.equal(await member.locator('#serviceLongitude').inputValue(),'28.2293');
      await member.locator('input[name=serviceCategory][value=grocery_collection]').check();
      await member.locator('#serviceDescription').fill('Please help me collect groceries');
      await member.locator('#servicePreferredDate').fill('2099-12-31');
      await member.locator('#servicePreferredTime').fill('10:30');
      await member.locator('#serviceUrgency').selectOption('medium');
      await action(member,'Submit Service Request');
      await member.getByText('Service request submitted successfully.',{exact:false}).waitFor();
      assert.equal(db.requests.length,1);
      assert.equal(db.requests[0].latitude,-25.7479);
      assert.equal(db.requests[0].longitude,28.2293);
    });
    await scenario('browse requests lists open item needs with directions and donate links',async ({db,account}) => {
      db.request({user_id:'another-member',request_type:'resource',category:'food',description:'Rice and maize meal',
        quantity:5,location:'Hatfield',urgency:'high',latitude:-25.7479,longitude:28.2293});
      const member=await account({id:'member'}); await open(member,'browse');
      const card=cards(member).filter({hasText:'Rice and maize meal'});
      await card.waitFor();
      const directions=card.getByRole('link',{name:'Get Directions'});
      assert.match(await directions.getAttribute('href'),/google\.com\/maps\/dir/);
      assert.match(await directions.getAttribute('href'),/destination=-25\.7479/);
      assert.equal(await card.getByRole('link',{name:'Donate This Item'}).getAttribute('href'),base+'chat.html?request='+db.requests[0].id);
      await member.locator('#categoryFilter').selectOption('water');
      await member.getByText('No matching requests',{exact:true}).waitFor();
      await member.locator('#categoryFilter').selectOption('');
      await member.locator('#locationFilter').fill('hatfield');
      await card.waitFor();
      assert.match(await member.locator('#browseMessage').textContent(),/1 open request/);
    });
    await scenario('donation with image saves row, storage path, and appears in dashboard search',async ({db,account}) => {
      const member=await account({id:'member'}); await open(member,'donate');
      await member.locator('#itemName').fill('Winter blankets');
      await member.locator('#category').selectOption('clothing');
      await member.locator('#description').fill('Clean, gently used blankets');
      await member.locator('#quantity').fill('4');
      await member.locator('#location').fill('Community hall');
      await member.locator('#availableFrom').fill('2026-09-28T09:00');
      await member.locator('#availableUntil').fill('2026-10-05T17:00');
      await member.locator('#images').setInputFiles({name:'blankets.png',mimeType:'image/png',buffer:Buffer.from('89504e470d0a1a0a','hex')});
      await action(member,'Upload Donation');
      await member.locator('#message').filter({hasText:'Your donation has been listed'}).waitFor();
      assert.equal(db.donations.length,1);
      assert.equal(db.donations[0].item_name,'Winter blankets');
      assert.equal(db.donations[0].status,'available');
      assert.equal(db.storageFiles.length,1);
      assert.equal(db.storageFiles[0].bucket,'donation-images');
      assert.match(db.storageFiles[0].path,new RegExp('^member/'+db.donations[0].id+'/.+-blankets\\.png$'));
      assert.equal(db.donation_images.length,1);
      assert.equal(db.donation_images[0].donation_id,db.donations[0].id);
      assert.equal(db.donation_images[0].storage_path,db.storageFiles[0].path);
      await open(member,'dashboard');
      const result=member.locator('#searchResults .result-card').filter({hasText:'Winter blankets'});
      await result.waitFor();
      assert.equal(await result.getByRole('link',{name:'Request this item · collection or assistance →'}).getAttribute('href'),base+'chat.html?donation='+db.donations[0].id);
      assert.match(await result.getByRole('link',{name:'Get Directions'}).getAttribute('href'),/google\.com\/maps\/dir/);
      await member.locator('#itemSearchInput').fill('blankets');
      await action(member,'Search');
      await result.waitFor();
      await member.locator('#itemSearchInput').fill('nonexistent item');
      await action(member,'Search');
      await member.locator('#searchMessage').filter({hasText:'No available items match your search.'}).waitFor();
    });
    await scenario('assistant job views link directions to the requester coordinates',async ({db,account}) => {
      db.request({location:'Hatfield Community Hall',latitude:-25.7479,longitude:28.2293});
      const worker=await account(assistant('worker')); await open(worker,'available');
      const card=cards(worker).filter({hasText:'Hatfield Community Hall'});
      await card.waitFor();
      const href=await card.getByRole('link',{name:'Get Directions'}).getAttribute('href');
      assert.match(href,/google\.com\/maps\/dir/);
      assert.match(href,/destination=-25\.7479/);
    });
    console.log(`${count} service browser scenarios passed. Supabase SDK/backend are mocked; SQL concurrency/RLS and live deployment require separate verification.`);
  } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
