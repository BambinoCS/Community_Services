// Browser regression tests use a mocked Supabase SDK, never live accounts.
// Requires Playwright and installed Edge; see README for commands.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const policy = require('../frontend/auth-policy.js');
const prefix = '/Community_Services/';
const sdkMock = `(() => {
 const scenario = window.testScenario;
 let cb, initialized = false;
 const identity = {id:'test-user'};
 function read() { return JSON.parse(sessionStorage.getItem('test-session') || 'null'); }
 function save(value) { sessionStorage.setItem('test-session',JSON.stringify(value)); }
 const session = {user:identity};
 function initialize() {
   if(initialized) return;
   initialized=true;
   if(scenario.recovery && location.hash.includes('access_token=')) { save(session); cb('PASSWORD_RECOVERY',session); }
   else if(scenario.confirmation && location.hash.includes('access_token=')) { save(session); cb('SIGNED_IN',session); }
 }
 window.supabase = {createClient:()=>({
  auth: {
   onAuthStateChange(fn){cb=fn;return {data:{subscription:{unsubscribe(){}}}};},
   async getSession(){initialize();return {data:{session:read()}};},
   async getUser(){return {data:{user:read()?.user}};},
   async signInWithPassword(input){
     window.testCalls.push({method:'login'});
     if(scenario.loginError) return {error:{code:scenario.loginError}};
     save(session); cb('SIGNED_IN',session); return {data:{session}};
   },
   async signUp(input){
     window.testCalls.push({method:'signup', metadata:input.options.data, redirect:input.options.emailRedirectTo});
     return {data:{session:null}};
   },
   async resetPasswordForEmail(email,options){window.testCalls.push({method:'forgot',redirect:options.redirectTo});return {};},
   async resend(){window.testCalls.push({method:'resend'});return {};},
   async updateUser(){window.testCalls.push({method:'updatePassword'});return {};},
   async signOut(){save(null);cb('SIGNED_OUT',null);return {};}
  },
  storage:{from(bucket){return {
    getPublicUrl(objectPath){return {data:{publicUrl:'https://images.example.invalid/'+objectPath}};},
    async upload(objectPath,file,options){window.testCalls.push({method:'upload',bucket,objectPath,type:file.type,options});
      return scenario.uploadError ? {error:{message:'denied'}} : {data:{path:objectPath}};}
  };}},
  from(table){let patch, target;return {select(){return this;},eq(column,id){target=id;return this;},
   update(data){patch=data;return this;},
   async single(){window.testCalls.push({method:'profileUpdate',table,target,patch});
    if(scenario.saveError)return {error:{message:'denied'}};
    const profile={id:identity.id,role:scenario.role||'community_user',...JSON.parse(sessionStorage.getItem('test-profile')||'{}'),...patch};
    sessionStorage.setItem('test-profile',JSON.stringify(profile));return {data:profile};},
   async maybeSingle(){
    if(scenario.failTable===table)return {error:{message:'private detail'}};
    return {data: table==='profiles' ? (scenario.missingProfile?null:{id:identity.id,role:scenario.role||'community_user',first_name:'Test',last_name:'Member',...JSON.parse(sessionStorage.getItem('test-profile')||'{}')}) :
      table==='assistants' ? scenario.assistant||null : scenario.developer ? {user_id:identity.id} : null};
  }}}
 })};
})();`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + pathname.replace(/^\/Community_Services/, ''));
  if (!file.startsWith(root + path.sep) || !/\.(html|js|css)$/.test(file) || !fs.existsSync(file)) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  const browser = await chromium.launch({ channel: process.env.AUTH_TEST_BROWSER || 'msedge', headless: true });
  let count = 0;
  let actualSDK;
  async function scenario(name, settings, run) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(settings => {
      if (location.origin === 'null') return;
      window.testScenario = settings; window.testCalls = [];
      if (!sessionStorage.getItem('test-initialized')) {
        sessionStorage.setItem('test-initialized', 'true');
        sessionStorage.setItem('test-session', JSON.stringify(settings.signedIn ? { user: { id: 'test-user' } } : null));
        if (settings.forged) {
          const fake = JSON.stringify({ userId: 'test-user', view: 'admin' });
          sessionStorage.setItem('community-services.developer-view', fake);
          localStorage.setItem('community-services.developer-view', fake);
        }
      }
    }, settings);
    await context.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: settings.actualSDK ? actualSDK : sdkMock }));
    if (settings.actualSDK) {
      const user = { id: 'test-user', aud: 'authenticated', role: 'authenticated',
        app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
      await context.route('**/auth/v1/**', route => {
        if (route.request().url().includes('/logout')) return route.fulfill({ status: 204 });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(user) });
      });
      await context.route('**/rest/v1/**', route => route.fulfill({ contentType: 'application/json',
        body: JSON.stringify(route.request().url().includes('/profiles?') ? [{ id: 'test-user', role: 'community_user' }] : []) }));
    }
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try { await run(page); assert.deepEqual(errors, []); console.log('PASS ' + name); count++; }
    finally { await context.close(); }
  }
  const password = () => randomBytes(18).toString('base64url');
  const open = (page, file) => page.goto(base + file);
  const shown = async page => { await page.locator('#protected-content').waitFor({ state: 'visible' }); };
  try {
    for (const file of [...Object.values(policy.destinations), 'developer.html', 'profile.html']) {
      await scenario('anonymous denied: ' + file, {}, async page => {
        await open(page, file); await page.waitForURL(base + 'login.html');
      });
    }
    await scenario('community cannot forge admin/developer access; refresh persists session', { signedIn: true, forged: true }, async page => {
      await open(page, policy.destinations.admin); await page.waitForURL(base + policy.destinations.community_user); await shown(page);
      assert.equal(await page.locator('#developer-switcher').count(), 0);
      await page.reload(); await shown(page);
      await open(page, 'developer.html'); await page.waitForURL(base + policy.destinations.community_user);
    });
    await scenario('pending assistant denied', { signedIn: true, role: 'assistant' }, async page => {
      await open(page, policy.destinations.assistant); await page.waitForURL(base + policy.destinations.community_user);
    });
    for (const [role, assistant] of [['admin', null], ['assistant', { verification_status: 'verified', training_status: 'completed' }]]) {
      await scenario(role + ' trusted login routing and logout', { signedIn: true, role, assistant }, async page => {
        await open(page, 'index.html');
        await open(page, 'login.html'); await page.waitForURL(base + policy.destinations[role]); await shown(page);
        await page.locator('#protected-content [data-auth-logout]').click(); await page.waitForURL(base + 'login.html');
        await page.goBack(); assert.equal(await page.locator('#protected-content:visible').count(), 0);
      });
    }
    await scenario('developer views, mobile dialog, Escape, exit, remembered view and logout', { signedIn: true, developer: true, role: 'admin' }, async page => {
      await open(page, 'login.html'); await page.waitForURL(base + 'developer.html'); await shown(page);
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await shown(page);
      assert.equal(await page.locator('#developer-choices button').count(), 4);
      await page.locator('#developer-choices button').filter({ hasText: 'Community User' }).click();
      await page.waitForURL(base + policy.destinations.community_user); await shown(page);
      await page.reload(); await shown(page);
      await page.locator('.dev-floating').click(); await page.locator('dialog').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog').isVisible(), false);
      assert.equal(await page.locator('.dev-floating').evaluate(el => el === document.activeElement), true);
      for (const [view, label] of [['assistant', 'Verified Assistant'], ['admin', 'Administrator']]) {
        await page.locator('.dev-floating').click();
        await page.locator('dialog button').filter({ hasText: label }).click();
        await page.waitForURL(base + policy.destinations[view]); await shown(page);
      }
      await page.locator('.dev-floating').click();
      await page.locator('dialog button').filter({ hasText: 'Exit Developer Mode' }).click();
      await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('community-services.developer-view')).view === 'normal');
      await page.reload(); await shown(page);
      assert.ok(page.url().endsWith(policy.destinations.admin));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('#protected-content [data-auth-logout]').click(); await page.waitForURL(base + 'login.html');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('community-services.developer-view')), null);
    });
    for (const failTable of ['profiles', 'assistants', 'developer_accounts']) {
      await scenario('fail closed: ' + failTable, { signedIn: true, developer: true, role: 'admin', failTable }, async page => {
        await open(page, policy.destinations.admin);
        await page.getByText('Your account access could not be loaded.', { exact: false }).waitFor();
        assert.equal(await page.locator('#protected-content').isVisible(), false);
      });
    }
    await scenario('registration validation and safe metadata/confirmation redirect', {}, async page => {
      await open(page, 'register.html'); await page.locator('button[type=submit]').click();
      assert.equal(await page.evaluate(() => testCalls.length), 0);
      await page.locator('#first_name').fill('Test'); await page.locator('#last_name').fill('Member');
      await page.locator('#email').fill('invalid'); await page.locator('button[type=submit]').click();
      assert.equal(await page.evaluate(() => testCalls.length), 0);
      await page.locator('#email').fill('test@example.invalid');
      await page.locator('#password').fill(password()); await page.locator('#confirm').fill(password());
      await page.locator('button[type=submit]').click(); await page.getByText('The passwords do not match.', { exact: true }).waitFor();
      const value = password(); await page.locator('#password').fill(value); await page.locator('#confirm').fill(value);
      await page.locator('button[type=submit]').click(); await page.getByText('Check your inbox to confirm', { exact: false }).waitFor();
      const call = await page.evaluate(() => testCalls[0]);
      assert.deepEqual(Object.keys(call.metadata).sort(), ['first_name', 'last_name', 'phone']);
      assert.equal(call.redirect, base + 'auth-callback.html');
    });
    for (const loginError of ['invalid_credentials', 'email_not_confirmed', null]) {
      await scenario('login: ' + (loginError || 'success'), { loginError }, async page => {
        await open(page, 'login.html'); await page.locator('#email').fill('test@example.invalid');
        await page.locator('#password').fill(password()); await page.locator('button[type=submit]').click();
        if (loginError) await page.locator('#auth-message').filter({ hasText: loginError === 'invalid_credentials' ? 'incorrect' : 'confirm' }).waitFor();
        else { await page.waitForURL(base + policy.destinations.community_user); await shown(page); }
      });
    }
    await scenario('forgot password uses deployed recovery URL and generic response', {}, async page => {
      await open(page, 'forgot-password.html'); await page.locator('#email').fill('test@example.invalid');
      await page.locator('button[type=submit]').click(); await page.getByText('If an account exists', { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => testCalls[0].redirect), base + 'reset-password.html');
    });
    await scenario('ordinary authenticated session cannot open recovery form', { signedIn: true }, async page => {
      await open(page, 'reset-password.html'); await page.getByText('Open a valid password reset link', { exact: false }).waitFor();
      assert.equal(await page.locator('form').isVisible(), false);
    });
    await scenario('recovery callback survives refresh then updates password and signs out', { recovery: true }, async page => {
      await open(page, 'reset-password.html#access_token=test&type=recovery'); await page.locator('form').waitFor({ state: 'visible' });
      assert.equal(new URL(page.url()).hash, '');
      await page.reload(); await page.locator('form').waitFor({ state: 'visible' });
      const value = password(); await page.locator('#password').fill(value); await page.locator('#confirm').fill(value);
      await page.locator('button[type=submit]').click(); await page.getByText('Password updated.', { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('test-session'))), null);
    });
    await scenario('confirmation callback routes and removes URL credentials', { confirmation: true }, async page => {
      await open(page, 'auth-callback.html#access_token=test&type=signup');
      await page.waitForURL(base + policy.destinations.community_user); await shown(page);
    });
    await scenario('invalid callback stays public and explains expired link', {}, async page => {
      await open(page, 'auth-callback.html#error=access_denied&error_description=expired');
      await page.getByText('This email link is invalid or expired.', { exact: false }).waitFor();
      assert.equal(new URL(page.url()).hash, '');
    });
    await scenario('profile navigation, own details save, refresh and unsaved changes', {signedIn:true}, async page => {
      await open(page, policy.destinations.community_user); await shown(page);
      await page.getByRole('button',{name:'Profile',exact:true}).click(); await page.waitForURL(base+'profile.html');
      await page.locator('#first_name:enabled').waitFor();
      assert.equal(await page.locator('#first_name').inputValue(),'Test');
      await page.locator('#first_name').fill('Updated'); await page.locator('#phone').fill('+27 123 456 789');
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange'))); await shown(page);
      assert.equal(await page.locator('#first_name').inputValue(),'Updated');
      await page.locator('#save-profile').click(); await page.getByText('Your profile has been saved.',{exact:true}).waitFor();
      const call=await page.evaluate(()=>testCalls.find(c=>c.method==='profileUpdate'));
      assert.equal(call.target,'test-user'); assert.deepEqual(Object.keys(call.patch).sort(),['first_name','last_name','phone']);
      await page.reload(); await page.locator('#first_name:enabled').waitFor();
      assert.equal(await page.locator('#first_name').inputValue(),'Updated');
      await page.locator('#first_name').fill('Unsaved'); await page.locator('#cancel-profile').click();
      assert.equal(await page.locator('#first_name').inputValue(),'Updated');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
      await page.screenshot({path:path.join(root,'test-results/profile-mobile.png'),fullPage:true});
    });
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1cAAAAASUVORK5CYII=','base64');
    for(const failure of [null,'uploadError','saveError']) {
      await scenario('profile photo upload: '+(failure||'success'), {signedIn:true,[failure||'success']:true},async page=>{
        await open(page,'profile.html'); await page.locator('#first_name:enabled').waitFor();
        await page.locator('#avatar').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});
        await page.getByText('Photo selected.',{exact:false}).waitFor();
        await page.locator('#save-profile').click();
        await page.getByText(failure==='uploadError'?'Your photo could not be uploaded.':failure==='saveError'?'Your profile could not be saved.':'Your profile has been saved.',{exact:false}).waitFor();
        const calls=await page.evaluate(()=>testCalls);
        const upload=calls.find(c=>c.method==='upload');assert.equal(upload.bucket,'avatars');
        assert.ok(upload.objectPath.startsWith('test-user/'));assert.equal(upload.options.upsert,false);
        if(failure==='uploadError')assert.equal(calls.some(c=>c.method==='profileUpdate'),false);
        if(!failure){await page.locator('#remove-photo').click();await page.locator('#save-profile').click();
          await page.getByText('Your profile has been saved.',{exact:true}).waitFor();
          assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('test-profile')).avatar_path),null);}
      });
    }
    await scenario('invalid avatar files never upload', {signedIn:true},async page=>{
      await open(page,'profile.html'); await page.locator('#first_name:enabled').waitFor();
      for(const file of [{name:'file.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')},
        {name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(5*1024*1024+1)},
        {name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')}]) {
        await page.locator('#avatar').setInputFiles(file);
        await page.locator('#profile-message').filter({hasText:file.name==='broken.png'?'could not be read':'no larger than 5 MB'}).waitFor();
      }
      assert.equal(await page.evaluate(()=>testCalls.length),0);
    });
    // Exercise the pinned SDK's real implicit callback parsing/event ordering against mocked HTTP.
    if (process.env.AUTH_TEST_OFFLINE !== '1') {
    const response = await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js', { signal: AbortSignal.timeout(20000) });
    assert.ok(response.ok); actualSDK = await response.text();
    for (const type of ['signup', 'recovery']) {
      await scenario('real SDK callback parsing: ' + type, { actualSDK: true }, async page => {
        const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        const token = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: 'test-user', aud: 'authenticated', iat: now, exp: now + 3600 }) + '.' + randomBytes(32).toString('base64url');
        const fragment = new URLSearchParams({ access_token: token, refresh_token: randomBytes(24).toString('hex'),
          expires_in: '3600', token_type: 'bearer', type });
        await open(page, (type === 'signup' ? 'auth-callback.html' : 'reset-password.html') + '#' + fragment);
        if (type === 'signup') { await page.waitForURL(base + policy.destinations.community_user); await shown(page); }
        else {
          await page.locator('form').waitFor({ state: 'visible' });
          assert.equal(new URL(page.url()).hash, '');
          await page.reload(); await page.locator('form').waitFor({ state: 'visible' });
          const value = password(); await page.locator('#password').fill(value); await page.locator('#confirm').fill(value);
          await page.locator('button[type=submit]').click(); await page.getByText('Password updated.', { exact: false }).waitFor();
        }
      });
    }
    } else console.log('SKIP: 2 real SDK callback cases (AUTH_TEST_OFFLINE=1; network download disabled).');
    console.log(`${count} browser scenarios passed. These are not live account tests.`);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
