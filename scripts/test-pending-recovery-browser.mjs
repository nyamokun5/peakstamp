// Fully intercepted TEST-only iPhone regression for the old localStorage
// uncertain-write record blocking both the legacy and Worker registration flows.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const M='22222222-2222-4222-8222-222222222221';
const P='33333333-3333-4333-8333-333333333331';
const ids=[1,2,3,4].map(n=>'22222222-2222-4222-8222-22222222222'+n);
const snapshot=()=>({event_id:E,matches:ids.map((match_id,i)=>({
 match_id,seq:i+1,title:'#'+(i+1),
 status:i<2?'scheduled':'waiting',left_score:0,right_score:0,
 left_team:i<2?'チーム'+(i*2+1):'',right_team:i<2?'チーム'+(i*2+2):'',goals:[]
})),roster:{チーム1:['山田'],チーム2:['西村'],チーム3:['田中'],チーム4:['橋本']}});
const match=()=>({
 match_id:M,event_id:E,seq:1,number:1,status:'scheduled',
 left:{name:'チーム1',score:0,players:[{name:'山田',player_id:P}]},
 right:{name:'チーム2',score:0,players:[]},goals:[]
});
const pending={
 goalKey:'video::old-goal',event_id:E,match_id:M,action:'create',side:'left',
 scorer_id:P,assist_id:null,beforeGoalIds:[],startedAt:1793041200000
};
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
let eventGets=0,matchGets=0,otherWrites=0;
const exceptions=[];page.on('pageerror',e=>exceptions.push(e.message));
await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.host==='peakstamp.local'){
  const path=u.pathname==='/'?'sposched-review.html':u.pathname.slice(1);
  try{return await route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),
   contentType:path.endsWith('.html')?'text/html':'text/javascript'})}
  catch{return route.fulfill({status:404,body:'Missing local test file'})}
 }
 assert.equal(u.host,'shoot-sunday-sync-staging.yomax1979.workers.dev');
 assert.equal(route.request().method(),'GET','recovery must be read-only');
 let response;
 if(u.pathname==='/events')response={events:[{event_id:E,name:'TEST',date:'2026-10-25'}]};
 else if(u.pathname==='/snapshot'){eventGets++;response=snapshot()}
 else if(u.pathname==='/match'){matchGets++;response=match()}
 else{otherWrites++;throw Error('unexpected API '+u.pathname)}
 await route.fulfill({json:response,headers:{'Access-Control-Allow-Origin':'*'}});
});
await page.addInitScript(({eventId,entry})=>{
 localStorage.setItem('peakstamp_ss_uncertain_writes_v1:staging:'+eventId,
  JSON.stringify([entry]));
},{eventId:E,entry:pending});
try{
 await page.goto('https://peakstamp.local/');
 await page.selectOption('#ssEnvironment','staging');
 await page.fill('#ssBridgeToken','mock-test-token');
 await page.click('#ssLoadEvents');await page.click('#ssLoadSnapshot');
 await page.locator('#workerBatchArea').waitFor({state:'visible'});
 assert.equal(await page.locator('#workerBatchRun').isDisabled(),true);
 assert.equal(await page.locator('#autoRun').isDisabled(),true);
 assert.equal(await page.locator('#workerBatchRecover').isVisible(),true);
 assert.match(await page.locator('#workerBatchStatus').innerText(),/前回の未照合/);
 assert.equal(otherWrites,0);
 await page.click('#workerBatchRecover');
 await page.waitForFunction(()=>
  document.getElementById('recoveryStatus').textContent.includes('読み取り完了'));
 assert.ok(eventGets>=2);
 assert.equal(matchGets,1);
 assert.match(await page.locator('#recoveryDetails').innerText(),/反映された証拠は見つかりません/);
 const retry=page.getByRole('button',{name:'SSに未登録と確認 → 再審査に戻す'});
 assert.equal(await retry.isDisabled(),true,'recovery must never clear before explicit checkbox');
 await page.locator('#recoveryDetails input[type=checkbox]').check();
 assert.equal(await retry.isEnabled(),true);
 await retry.click();
 const stored=await page.evaluate(eventId=>
  localStorage.getItem('peakstamp_ss_uncertain_writes_v1:staging:'+eventId),E);
 assert.equal(stored,'[]');
 assert.equal(await page.locator('#workerBatchRecover').isVisible(),false);
 assert.equal(await page.locator('#workerBatchRun').isEnabled(),true);
 assert.equal(otherWrites,0);
 assert.deepEqual(exceptions,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS: prior uncertain TEST write blocks both launch buttons; one-tap official GET recovery requires human review before journal clear; no upstream writes');
}finally{await browser.close()}
