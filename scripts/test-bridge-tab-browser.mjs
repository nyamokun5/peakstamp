// iPhone-size regression for optional per-tab Bridge authentication.
// All HTTP is fully intercepted: absolutely no live SpoSched/Worker requests.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[],calls=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.hostname==='peakstamp.local'){
  const path=url.pathname==='/'?'sposched-review.html':url.pathname.slice(1);
  try{return route.fulfill({
   body:await readFile(new URL('../'+path,import.meta.url)),
   contentType:path.endsWith('.html')?'text/html':'text/javascript'
  })}catch{return route.fulfill({status:404,body:'Test fixture missing'})}
 }
 assert.ok(['shoot-sunday-sync.yomax1979.workers.dev',
  'shoot-sunday-sync-staging.yomax1979.workers.dev'].includes(url.hostname),
 'unexpected network target '+url.hostname);
 assert.equal(route.request().method(),'GET','no mutations in auth test');
 assert.equal(url.pathname,'/events');
 const env=url.hostname.includes('-staging.')?'staging':'production';
 const actual=route.request().headers()['x-ss-bridge-token'];
 calls.push({env,actual});
 const ok=actual===(env==='staging'?'test-secret':'read-secret');
 return route.fulfill({status:ok?200:401,
  json:ok?{events:[{event_id:'11111111-1111-4111-8111-111111111111',
    name:'TEST',date:'2026-10-25'}]}:{error:{message:'認証に失敗しました'}},
  headers:{'Access-Control-Allow-Origin':'*'}});
});
try{
 await page.goto('https://peakstamp.local/');
 assert.equal(await page.locator('#ssBridgeToken').inputValue(),'');
 assert.equal(await page.locator('#ssBridgeToken').getAttribute('autocomplete'),'current-password');
 assert.equal(await page.locator('#ssRememberTab').isChecked(),false);
 await page.selectOption('#ssEnvironment','staging');
 await page.fill('#ssBridgeToken','test-secret');
 await page.check('#ssRememberTab');
 await page.click('#ssLoadEvents');
 await page.waitForFunction(()=>document.querySelector('#ssDirectStatus').textContent.includes('件取得'));
 const contents=await page.evaluate(()=>({
  tab:sessionStorage.getItem('peakstamp_ss_bridge_tab_v1:staging'),
  local:localStorage.getItem('peakstamp_ss_bridge_tab_v1:staging')
 }));
 assert.ok(contents.tab?.includes('test-secret'));
 assert.equal(contents.local,null,'never persist secret in localStorage');
 await page.reload();
 assert.equal(await page.locator('#ssBridgeToken').inputValue(),'','default PROD must not inherit staging');
 await page.selectOption('#ssEnvironment','staging');
 assert.equal(await page.locator('#ssBridgeToken').inputValue(),'test-secret');
 assert.equal(await page.locator('#ssRememberTab').isChecked(),true);
 await page.click('#ssLoadEvents');
 await page.waitForFunction(()=>document.querySelector('#ssDirectStatus').textContent.includes('件取得'));
 assert.deepEqual(calls.map(c=>c.env),['staging','staging']);
 await page.selectOption('#ssEnvironment','production');
 assert.equal(await page.locator('#ssBridgeToken').inputValue(),'');
 await page.fill('#ssBridgeToken','read-secret');
 await page.check('#ssRememberTab');
 await page.click('#ssLoadEvents');
 await page.waitForFunction(()=>document.querySelector('#ssDirectStatus').textContent.includes('件取得'));
 assert.equal(calls.at(-1).env,'production');
 await page.selectOption('#ssEnvironment','staging');
 assert.equal(await page.locator('#ssBridgeToken').inputValue(),'test-secret');
 await page.click('#ssForgetToken');
 assert.equal(await page.locator('#ssBridgeToken').inputValue(),'');
 assert.equal(await page.locator('#ssRememberTab').isChecked(),false);
 await page.reload();
 await page.selectOption('#ssEnvironment','staging');
 assert.equal(await page.locator('#ssBridgeToken').inputValue(),'');
 await page.selectOption('#ssEnvironment','production');
 assert.equal(await page.locator('#ssBridgeToken').inputValue(),'read-secret');
 await page.fill('#ssBridgeToken','wrong-secret');
 await page.click('#ssLoadEvents');
 await page.waitForFunction(()=>document.querySelector('#ssDirectStatus').textContent.includes('認証に失敗'));
 assert.equal(await page.locator('#ssRememberTab').isChecked(),false);
 await page.reload();
 assert.equal(await page.locator('#ssBridgeToken').inputValue(),'');
 assert.equal(errors.length,0,errors.join('\n'));
 assert.deepEqual(calls.map(({env,actual})=>[env,actual]),[
  ['staging','test-secret'],['staging','test-secret'],
  ['production','read-secret'],['production','wrong-secret']
 ]);
 console.log('PASS: optional 4h tab cache, environment isolation, Safari autofill, delete, auth rejection and no live writes');
}finally{await browser.close()}
