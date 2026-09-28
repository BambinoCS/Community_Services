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
  help: 'community-user/frontend/community-user_request-help.html',
  mine: 'community-user/frontend/community-user_requests.html',
  available: 'verified-assistant/frontend/verified_assistant_available_requests.html',
  active: 'verified-assistant/frontend/verified_assistant_active_jobs.html',
  completed: 'verified-assistant/frontend/verified_assistant_completed_jobs.html'
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
      const query = {table, filters:[]};
      const builder = {
        select(columns) { query.columns=columns; return this; },
        eq(key,value) { query.filters.push(['eq',key,value]); return this; },
        neq(key,value) { query.filters.push(['neq',key,value]); return this; },
        in(key,value) { query.filters.push(['in',key,value]); return this; },
        order(key,options) { query.order={key,...options}; return this; },
        range(start,end) { query.range=[start,end]; return this; },
        maybeSingle() { return window.testBackend({kind:'query',...query,single:true}); },
        then(resolve,reject) { return window.testBackend({kind:'query',...query}).then(resolve,reject); }
      }; return builder;
    },
    rpc(name,args) { return window.testBackend({kind:'rpc',name,args}); }
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
  const db = { requests: [], assignments: [], calls: [], failQuery: null, failRpc: null, delayRpc: 0 };
  const error = code => ({error:{code,message:'Private database detail must never be shown'}});
  const verified = account => account.assistant?.verification_status === 'verified' && account.assistant?.training_status === 'completed';
  db.request = (changes = {}) => {
    const row = { id:randomUUID(), user_id:'member', request_type:'service', category:'grocery_collection',
      description:'Please collect groceries', location:'Community hall', preferred_date:'2099-12-31',
      preferred_time:'10:30:00', urgency:'medium', additional_info:null, status:'open',
      created_at:new Date().toISOString(), updated_at:new Date().toISOString(), ...changes };
    db.requests.push(row); return row;
  };
  db.handle = async (account, call) => {
    db.calls.push({account:account.id,...structuredClone(call)});
    if (call.kind === 'query') {
      if (call.table === 'profiles') return {data:{id:account.id, role:account.role || 'community_user', first_name:'Test', last_name:account.id}};
      if (call.table === 'assistants') return {data:account.assistant || null};
      if (call.table === 'developer_accounts') return {data:account.developer ? {user_id:account.id} : null};
      if (db.failQuery) { const code=db.failQuery; db.failQuery=null; return error(code); }
      // Model account visibility independently of the query's filters.
      let rows = call.table === 'requests'
        ? db.requests.filter(row => row.user_id === account.id || verified(account))
        : db.assignments.filter(row => row.assistant_id === account.assistant?.id).map(row => ({...row,requests:db.requests.find(request => request.id === row.request_id)}));
      for (const [op,key,value] of call.filters) rows=rows.filter(row => op === 'eq' ? row[key] === value : op === 'neq' ? row[key] !== value : value.includes(row[key]));
      if (call.order) rows=[...rows].sort((a,b) => String(a[call.order.key]).localeCompare(String(b[call.order.key])) * (call.order.ascending ? 1 : -1));
      if (call.range) rows=rows.slice(call.range[0],call.range[1]+1);
      return {data:structuredClone(rows)};
    }
    if (db.delayRpc) await new Promise(resolve => setTimeout(resolve,db.delayRpc));
    const failure=db.failRpc; db.failRpc=null;
    if (failure && !failure.afterCommit) return error(failure.code);
    assert.ok(account.id, 'RPC requires an authenticated principal');
    assert.equal(Object.keys(call.args).some(key => /user|assistant|role|status/.test(key)),false,'client must not supply authority fields');
    let row=db.requests.find(request => request.id === call.args.p_request_id);
    if (call.name === 'create_service_request') {
      if (row && row.user_id !== account.id) return error('42501');
      if (!row) row=db.request({id:call.args.p_request_id,user_id:account.id,category:call.args.p_category,
        description:call.args.p_description,location:call.args.p_location,preferred_date:call.args.p_preferred_date,
        preferred_time:call.args.p_preferred_time,urgency:call.args.p_urgency,additional_info:call.args.p_additional_info});
    } else {
      if (!row) return error('P0001');
      const assignment=db.assignments.find(item => item.request_id === row.id);
      if (call.name === 'cancel_service_request') {
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
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}${prefix}`;
  const browser=await chromium.launch({channel:process.env.AUTH_TEST_BROWSER || 'msedge',headless:true});
  let count=0;
  const assistant = id => ({id,role:'assistant',assistant:{id:'assistant-'+id,user_id:id,verification_status:'verified',training_status:'completed',availability:true}});
  async function scenario(name, run) {
    const db=backend(), contexts=[], errors=[];
    async function account(settings) {
      const context=await browser.newContext({viewport:{width:390,height:844}}); contexts.push(context);
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
  async function open(page,key) {
    await page.goto(base+pages[key]);
    await page.locator('#protected-content').waitFor({state:'visible'});
    if (key !== 'help') await page.getByRole('button',{name:'Refresh',exact:true}).waitFor({state:'visible'});
  }
  const message = (page,text) => page.locator('#service-message').filter({hasText:text}).waitFor();
  const cards = page => page.locator('article.item-card');
  const action = (page,name) => page.getByRole('button',{name,exact:true}).click();
  async function fillRequest(page, description='Please help me collect groceries') {
    await page.getByRole('button',{name:/Request Service/}).click();
    await page.locator('#serviceCategory').selectOption('grocery_collection');
    await page.locator('#serviceDescription').fill(description);
    await page.locator('#serviceLocation').fill('Community hall');
    await page.locator('#servicePreferredDate').fill('2099-12-31');
    await page.locator('#servicePreferredTime').fill('10:30');
    await page.locator('#serviceUrgency').selectOption('medium');
  }
  try {
    await scenario('service lifecycle persists across member and assistant accounts',async ({db,account}) => {
      const member=await account({id:'member'}), worker=await account(assistant('worker'));
      await open(member,'help'); await fillRequest(member);
      await action(member,'Submit request');
      await member.getByText('Your service request has been saved.',{exact:false}).waitFor();
      assert.equal(db.requests.length,1); assert.equal(db.requests[0].status,'open');
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
      await action(member,'Submit request');
      await member.locator('#requestServiceMessage').filter({hasText:'could not be completed'}).waitFor();
      assert.equal(await member.locator('#serviceDescription').inputValue(),'Please help me collect groceries');
      assert.equal(db.requests.length,1);
      await action(member,'Submit request');
      await member.getByText('Your service request has been saved.',{exact:false}).waitFor();
      const calls=db.calls.filter(call=>call.name==='create_service_request');
      assert.equal(calls.length,2); assert.equal(calls[0].args.p_request_id,calls[1].args.p_request_id);
      assert.equal(db.requests.length,1);
    });
    await scenario('blank description blocks submission and form fits mobile',async ({db,account}) => {
      const member=await account({id:'member'}); await open(member,'help'); await fillRequest(member,'   ');
      await action(member,'Submit request');
      assert.equal(await member.locator('#serviceDescription').evaluate(el=>el.validity.valid),false);
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
    await scenario('pagination exposes requests beyond the first fifty',async ({db,account}) => {
      for (let i=0;i<51;i++) db.request({description:'Request number '+i,created_at:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()});
      const member=await account({id:'member'}); await open(member,'mine'); await member.getByText('Request number 50',{exact:true}).waitFor();
      assert.equal(await cards(member).count(),50);
      await action(member,'Next'); await member.getByText('Request number 0',{exact:true}).waitFor();
      assert.equal(await cards(member).count(),1); assert.equal(await member.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
      await action(member,'Previous'); await member.getByText('Request number 50',{exact:true}).waitFor();
      assert.equal(await member.getByRole('button',{name:'Previous',exact:true}).isDisabled(),true);
    });
    console.log(`${count} service browser scenarios passed. Supabase SDK/backend are mocked; SQL concurrency/RLS and live deployment require separate verification.`);
  } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
