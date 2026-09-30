/* Real migrations + browser UI, with a local disposable SQL backend and fake Auth.
 * No deployed Supabase connection, identity or data is used. PGlite serializes calls.
 */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {chromium}=require('playwright');const {PGlite}=require(process.env.SERVICE_TEST_PGLITE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'../..');
const sdk=`window.supabase={createClient:()=>({auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},async getSession(){return {data:{session:{user:{id:window.testUser}}}}},async getUser(){return {data:{user:{id:window.testUser}}}}},from(table){const q={kind:'query',table,filters:[],orders:[]};const b={select(columns){q.columns=columns;return b},eq(k,v){q.filters.push([k,'=',v]);return b},lt(k,v){q.filters.push([k,'<',v]);return b},order(k,o){q.orders.push([k,o?.ascending!==false]);return b},range(a,z){q.offset=a;q.limit=z-a+1;return b},limit(n){q.limit=n;return b},single(){q.single=true;q.strictSingle=true;return window.database(q)},maybeSingle(){q.single=true;return window.database(q)},then(a,z){return window.database(q).then(a,z)}};return b},rpc(name,args){return window.database({kind:'rpc',name,args})}})};`;
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname.replace(/^\/Community_Services/,'');const file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+path.sep)||!/\.(html|js)$/.test(file)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(fs.readFileSync(file));
});
const sqlFns={admin_overview:[],admin_list_records:['p_kind','p_offset','p_filters','p_search'],admin_moderate_record:['p_kind','p_id','p_note'],item_handoff_participants:['p_id'],start_item_handoff:['p_id','p_source_type','p_source_id','p_mode','p_location'],waiting_item_deliveries:['p_offset'],claim_item_delivery:['p_id'],finish_item_handoff:['p_id','p_action'],send_chat_message:['p_handoff_id','p_client_id','p_body']};
let db,browser,base,queue=Promise.resolve(),failSend=false;
async function request(user,call){
 let release;const prior=queue;queue=new Promise(r=>release=r);await prior;
 try{
  await db.exec('begin;set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
  let rows;
  if(call.kind==='rpc'){
   assert.ok(sqlFns[call.name]);const args=sqlFns[call.name].map(k=>call.args?.[k]??(k==='p_offset'?0:null));
   rows=(await db.query(`select * from public.${call.name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args)).rows;
  }else{
   assert.ok(['profiles','assistants','developer_accounts','donations','requests','item_handoffs','chat_messages'].includes(call.table));
   const columns=call.columns||'*';assert.match(columns,/^[a-z_,*]+$/);
   const values=[];const predicates=call.filters.map(([key,op,value])=>{assert.match(key,/^[a-z_]+$/);assert.ok(['=','<'].includes(op));values.push(value);return `${key} ${op} $${values.length}`;});
   const order=call.orders.map(([key,asc])=>{assert.match(key,/^[a-z_]+$/);return key+(asc?' asc':' desc');}).join(',');
   rows=(await db.query(`select ${columns} from public.${call.table}${predicates.length?' where '+predicates.join(' and '):''}${order?' order by '+order:''} limit ${Number(call.limit||1000)} offset ${Number(call.offset||0)}`,values)).rows;
  }
  await db.exec('commit');
  if(call.name==='send_chat_message'&&failSend){failSend=false;return {error:{code:'network',message:'Response lost'}};}
  if(call.strictSingle && rows.length!==1)return {error:{code:'PGRST116'}};
  if(call.kind==='rpc' && call.name.startsWith('admin_'))return {data:rows[0]?.[call.name]??null};
  return {data:call.kind==='rpc'&&!['waiting_item_deliveries','item_handoff_participants'].includes(call.name)?rows[0]:call.single?rows[0]||null:rows};
 }catch(error){await db.exec('rollback');return {error:{code:error.code||'test',message:error.message}};}finally{release();}
}
(async()=>{
 db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const setupBundle=process.env.WORKFLOW_SETUP_BUNDLE==='1';
 for(const file of fs.readdirSync(path.join(root,'shared/supabase/migrations')).filter(n=>n.endsWith('.sql')&&!n.startsWith('002')&&(!setupBundle||!/^(007|008|009)_/.test(n))).sort())await db.exec(fs.readFileSync(path.join(root,'shared/supabase/migrations',file),'utf8'));
 if(setupBundle)await db.exec(require('../scripts/build-workflow-setup.cjs').buildWorkflowSetup());
 // Supabase default table privileges provide this grant for migration 003.
 await db.exec('grant select on public.developer_accounts to authenticated');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}/Community_Services/`;
 browser=await chromium.launch({channel:process.env.AUTH_TEST_BROWSER||'msedge',headless:true});fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 let count=0;
 async function scenario(name,fn){
  await db.exec('truncate auth.users cascade');const ids={donor:randomUUID(),recipient:randomUUID(),helper:randomUUID(),stranger:randomUUID(),admin:randomUUID()};
  for(const [role,id] of Object.entries(ids))await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[id,JSON.stringify({first_name:{donor:'Lerato',recipient:'Naledi',helper:'Thabo',stranger:'Other',admin:'Admin'}[role],last_name:'Community'})]);
  await db.query("insert into public.assistants(user_id,verification_status,training_status,availability) values($1,'verified','completed','unavailable')",[ids.helper]);
  const donation=(await db.query("insert into public.donations(donor_id,item_name,category,description,quantity,location) values($1,'Winter blankets','clothing','Two clean blankets for a neighbour',2,'Community hall') returning id",[ids.donor])).rows[0].id;
  const need=(await db.query("insert into public.requests(user_id,request_type,category,item_name,description,quantity,location) values($1,'resource','clothing','Winter jackets','Need warm jackets',2,'Recipient meeting place') returning id",[ids.recipient])).rows[0].id;
  await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
  const contexts=[],errors=[];
  async function pageFor(role,preview=null){const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);await context.addInitScript(([id,view])=>{window.testUser=id;if(view)sessionStorage.setItem('community-services.developer-view',JSON.stringify({userId:id,view}));},[ids[role],preview]);await context.exposeBinding('database',(_,call)=>request(ids[role],call));await context.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.request().url().startsWith('https://cdn.jsdelivr.net/')?r.fulfill({contentType:'text/javascript',body:sdk}):r.abort());const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());return page;}
  try{await fn({ids,donation,need,pageFor});assert.deepEqual(errors,[]);count++;console.log('PASS '+name);}finally{await Promise.all(contexts.map(c=>c.close()));}
 }
 async function open(page,query=''){await page.goto(base+'chat.html'+query);try{await page.locator('#protected-content').waitFor({state:'visible'});}catch(error){console.log(await page.locator('#auth-shell').innerText());throw error;}}
 async function choose(page,choice,address=''){await page.locator('input[name=transport][value='+choice+']').check();if(address)await page.locator('#handoff-location').fill(address);await page.locator('#start-chat').click();await page.locator('#message-form').waitFor({state:'visible'});}
 async function send(page,body){await page.locator('#message-body').fill(body);await page.locator('#send-message').click();await page.locator('#send-feedback').filter({hasText:'Message sent.'}).waitFor();}
 const refresh=async page=>{await page.locator('#refresh-chat').click();};
 try{
  await scenario('self collection opens private chat across two accounts and recipient confirms receipt',async({donation,pageFor})=>{
   const recipient=await pageFor('recipient'),donor=await pageFor('donor');await open(recipient,'?donation='+donation);
   await recipient.locator('#transport-question').filter({hasText:'collect'}).waitFor();await choose(recipient,'direct');await send(recipient,'Can I collect at 10 tomorrow?');
   const url=new URL(recipient.url()).search;await open(donor,url);await donor.locator('#messages').filter({hasText:'Can I collect at 10 tomorrow?'}).waitFor();await send(donor,'Yes, meet me at the community hall.');
   await refresh(recipient);await recipient.locator('#messages').filter({hasText:'Yes, meet me'}).waitFor();
   assert.ok(await recipient.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await recipient.screenshot({path:path.join(root,'test-results/item-chat-mobile.png'),fullPage:true});
   await recipient.setViewportSize({width:1360,height:900});await recipient.screenshot({path:path.join(root,'test-results/item-chat-desktop.png'),fullPage:true});
   await recipient.getByRole('button',{name:'Confirm received'}).click();await recipient.locator('#send-feedback').filter({hasText:'closed'}).waitFor();assert.equal((await db.query('select status from public.donations where id=$1',[donation])).rows[0].status,'collected');
  });
  await scenario('donor offers requested item with self delivery and recipient can cancel',async({need,pageFor})=>{
   const donor=await pageFor('donor');await open(donor,'?request='+need);await donor.locator('#transport-question').filter({hasText:'deliver'}).waitFor();await choose(donor,'direct','Donor collection point');await send(donor,'I can bring the jackets on Friday.');
   const recipient=await pageFor('recipient');await open(recipient,new URL(donor.url()).search);await recipient.locator('#messages').filter({hasText:'Friday'}).waitFor();await recipient.getByRole('button',{name:'Cancel arrangement'}).click();await recipient.locator('#send-feedback').filter({hasText:'closed'}).waitFor();assert.equal((await db.query('select status from public.requests where id=$1',[need])).rows[0].status,'open');
  });
  await scenario('requesting donation with assistance connects available helper to the same chat',async({ids,donation,pageFor})=>{
   await db.query("update public.assistants set availability='available' where user_id=$1",[ids.helper]);
   const recipient=await pageFor('recipient');await open(recipient,'?donation='+donation);await choose(recipient,'assistance','Recipient meeting place');await recipient.locator('#conversation-summary').filter({hasText:'Assistant connected'}).waitFor();
   const helper=await pageFor('helper');await open(helper);await helper.locator('#conversations button').filter({hasText:'Winter blankets'}).click();await send(helper,'I can collect and deliver these blankets.');
   await refresh(recipient);await recipient.locator('#messages').filter({hasText:'collect and deliver'}).waitFor();assert.equal(await helper.getByRole('button',{name:'Confirm received'}).count(),0);
  });
  await scenario('donor needing assistance waits when none is free and helper can accept later',async({ids,need,pageFor})=>{
   const donor=await pageFor('donor');await open(donor,'?request='+need);await choose(donor,'assistance','Donor address');await donor.locator('#conversation-summary').filter({hasText:'Waiting for an assistant'}).waitFor();
   await db.query("update public.assistants set availability='available' where user_id=$1",[ids.helper]);
   const helper=await pageFor('helper');await open(helper);await helper.getByRole('button',{name:'Accept delivery'}).click();await helper.locator('#conversation-summary').filter({hasText:'Assistant connected'}).waitFor();await send(helper,'I will help with the delivery.');
   await refresh(donor);await donor.locator('#messages').filter({hasText:'help with the delivery'}).waitFor();
  });
  await scenario('lost message response preserves draft and retries without duplicating messages',async({donation,pageFor})=>{
   const page=await pageFor('recipient');await open(page,'?donation='+donation);await choose(page,'direct');failSend=true;
   await page.locator('#message-body').fill('Keep this message exactly once.');await page.locator('#send-message').click();await page.locator('#send-feedback').filter({hasText:'unsent text is kept'}).waitFor();assert.equal(await page.locator('#message-body').inputValue(),'Keep this message exactly once.');
   await page.reload();await page.locator('#message-form').waitFor({state:'visible'});assert.equal(await page.locator('#message-body').inputValue(),'Keep this message exactly once.');await page.locator('#send-message').click();await page.locator('#send-feedback').filter({hasText:'Message sent.'}).waitFor();assert.equal((await db.query('select count(*)::int as n from public.chat_messages')).rows[0].n,1);
  });
  await scenario('chat history paginates safely and untrusted message text cannot execute',async({ids,donation,pageFor})=>{
   const page=await pageFor('recipient');await open(page,'?donation='+donation);await choose(page,'direct');const id=new URL(page.url()).searchParams.get('id');
   for(let i=0;i<55;i++)await request(ids.donor,{kind:'rpc',name:'send_chat_message',args:{p_handoff_id:id,p_client_id:randomUUID(),p_body:i===54?'<img src=x onerror="window.hacked=true">':'Message '+i}});
   await refresh(page);await page.locator('#messages li').nth(49).waitFor();assert.equal(await page.locator('#messages li').count(),50);await page.locator('#older-messages').click();await page.locator('#messages li').nth(54).waitFor();assert.equal(await page.locator('#messages img').count(),0);assert.equal(await page.evaluate(()=>window.hacked),undefined);
   await page.locator('#message-body').fill('Still typing');await refresh(page);assert.equal(await page.locator('#message-body').inputValue(),'Still typing');
  });
  await scenario('outsider cannot load a guessed conversation or a reserved donation',async({donation,pageFor})=>{
   const recipient=await pageFor('recipient');await open(recipient,'?donation='+donation);await choose(recipient,'direct');await send(recipient,'Private collection address');
   const outsider=await pageFor('stranger');await open(outsider,new URL(recipient.url()).search);await outsider.locator('#conversation-title').filter({hasText:'unavailable'}).waitFor();assert.equal(await outsider.locator('#messages').textContent(),'');assert.equal(await outsider.locator('#message-form').isVisible(),false);
   await open(outsider,'?donation='+donation);await outsider.locator('#arrange-feedback').filter({hasText:'unavailable'}).waitFor();assert.equal(await outsider.locator('#start-chat').isDisabled(),true);
  });
  await scenario('admin dashboard and users show actual totals with server-side search',async({pageFor})=>{
   const page=await pageFor('admin');await page.goto(base+'admin/frontend/admin_dashboard.html');await page.locator('#statsContainer .stat-card').nth(8).waitFor();assert.equal(await page.locator('#statsContainer .stat-value').first().textContent(),'5');
   await page.goto(base+'admin/frontend/admin_users.html');await page.locator('#usersTableBody tr').nth(4).waitFor();await page.locator('#searchInput').fill('Naledi');await page.locator('#admin-feedback').filter({hasText:'1 record on'}).waitFor();assert.equal(await page.locator('#usersTableBody tr').count(),1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });
  await scenario('admin reviews reports and cancels only open requests and donations',async({ids,need,donation,pageFor})=>{
   await db.query("insert into public.reports(user_id,category,description) values($1,'community_issue','Damaged pavement')",[ids.recipient]);
   const page=await pageFor('admin');await page.goto(base+'admin/frontend/admin_reports.html');await page.getByRole('button',{name:'Review report'}).click();await page.locator('#admin-note').fill('Contacted the maintenance team');await page.getByRole('button',{name:'Save review'}).click();await page.locator('#admin-feedback').filter({hasText:'Review saved'}).waitFor();await page.locator('#reportsContainer').filter({hasText:'Reviewed'}).waitFor();
   await page.goto(base+'admin/frontend/admin_requests.html');await page.getByRole('button',{name:'View details'}).click();await page.locator('#admin-note').fill('Duplicate request');await page.getByRole('button',{name:'Cancel request',exact:true}).click();await page.locator('#admin-feedback').filter({hasText:'Cancellation saved'}).waitFor();assert.equal((await db.query('select status from public.requests where id=$1',[need])).rows[0].status,'cancelled');
   await page.goto(base+'admin/frontend/admin_donations.html');await page.getByRole('button',{name:'View details'}).click();await page.locator('#admin-note').fill('Item no longer available');await page.getByRole('button',{name:'Cancel donation',exact:true}).click();await page.locator('#admin-feedback').filter({hasText:'Cancellation saved'}).waitFor();assert.equal((await db.query('select status from public.donations where id=$1',[donation])).rows[0].status,'cancelled');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(root,'test-results/admin-donations-mobile.png'),fullPage:true});
  });
  await scenario('developer preview cannot load administrator totals or records',async({ids,pageFor})=>{
   await db.query('insert into public.developer_accounts(user_id) values($1)',[ids.stranger]);const page=await pageFor('stranger','admin');await page.goto(base+'admin/frontend/admin_dashboard.html');await page.locator('#admin-feedback').filter({hasText:'real administrator'}).waitFor();assert.equal(await page.locator('#statsContainer .stat-card').count(),0);
  });
  console.log(count+' chat/admin browser scenarios passed using real migrations and RLS in disposable PGlite.');
 }finally{await browser.close();browser=null;server.close();await db.close();db=null;}
})().catch(async error=>{console.error(error);if(browser)await browser.close();server.close();if(db)await db.close();process.exitCode=1;});
