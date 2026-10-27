// iPhone-sized, fully intercepted TEST-only stale UUID recovery.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const OLD='99999999-9999-4999-8999-999999999999';
const P='33333333-3333-4333-8333-333333333331';
const ids=[1,2,3,4].map(n=>'22222222-2222-4222-8222-22222222222'+n);
const snapshot=()=>({event_id:E,matches:ids.map((match_id,i)=>({
 match_id,seq:i+1,title:'#'+(i+1),status:i<2?'scheduled':'waiting',
 left_score:0,right_score:0,left_team:i<2?'チーム'+(i*2+1):'',
 right_team:i<2?'チーム'+(i*2+2):'',goals:[]
})),roster:{チーム1:['山田'],チーム2:['西村'],チーム3:['田中'],チーム4:['橋本']}});
const pending={goalKey:'video::old-goal',event_id:E,match_id:OLD,
 action:'create',side:'left',scorer_id:P,assist_id:null,
 beforeGoalIds:[],startedAt:1793041200000};
async function runCase(gateState){
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>d.accept());
 let matchGets=0,snapshotGets=0,gateReads=0,writes=0;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.host==='peakstamp.local'){
   const path=url.pathname==='/'?'sposched-review.html':url.pathname.slice(1);
   try{return await route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),
    contentType:path.endsWith('.html')?'text/html':'text/javascript'})}
   catch{return route.fulfill({status:404,body:'Local test file missing'})}
  }
  assert.equal(url.host,'shoot-sunday-sync-staging.yomax1979.workers.dev');
  let data,code=200;
  if(url.pathname==='/events'){
   assert.equal(route.request().method(),'GET');
   data={events:[{event_id:E,name:'TEST',date:'2026-10-25'}]};
  }else if(url.pathname==='/snapshot'){
   assert.equal(route.request().method(),'GET');snapshotGets++;
   data=snapshot();
  }else if(url.pathname==='/match'){
   assert.equal(route.request().method(),'GET');matchGets++;
   assert.equal(url.searchParams.get('match_id'),OLD);
   data={error:{code:'not_found',message:'試合が見つかりません'}};code=404;
  }else if(url.pathname==='/staging/status'){
   assert.equal(route.request().method(),'POST');
   assert.equal(route.request().postDataJSON().match_id,OLD);
   gateReads++;
   data={environment:'STAGING ONLY',status:gateState,write_sent:false};
  }else{
   writes++;throw Error('unexpected mutation endpoint '+url.pathname);
  }
  await route.fulfill({status:code,json:data,headers:{'Access-Control-Allow-Origin':'*'}});
 });
 await page.addInitScript(({id,entry})=>{
  localStorage.setItem('peakstamp_ss_uncertain_writes_v1:staging:'+id,JSON.stringify([entry]));
 },{id:E,entry:pending});
 try{
  await page.goto('https://peakstamp.local/');
  await page.selectOption('#ssEnvironment','staging');
  await page.fill('#ssBridgeToken','mock-bridge');
  await page.click('#ssLoadEvents');await page.click('#ssLoadSnapshot');
  await page.locator('#workerBatchArea').waitFor({state:'visible'});
  assert.equal(await page.locator('#workerBatchRun').isDisabled(),true);
  await page.click('#workerBatchRecover');
  await page.waitForTimeout(900);
  console.log('STAGING RECOVERY DEBUG',JSON.stringify({
   status:await page.locator('#recoveryStatus').innerText(),
   details:await page.locator('#recoveryDetails').innerText(),
   gateState,matchGets,snapshotGets,gateReads,
   errors
  }));
  await page.getByRole('button',{name:'旧試合の送信記録を保管して再審査へ'}).waitFor({state:'visible',timeout:9000});
  assert.equal(matchGets,2);assert.equal(gateReads,1);
  assert.ok(snapshotGets>=3);
  assert.equal(writes,0);
  const statusText=await page.locator('#recoveryStatus').innerText();
  {
   const done=page.getByRole('button',{name:'旧試合の送信記録を保管して再審査へ'});
   assert.equal(await done.isDisabled(),true);
   await page.locator('#recoveryDetails input[type=checkbox]').first().check();
   assert.equal(await done.isDisabled(),true);
   await page.locator('#recoveryDetails input[type=checkbox]').nth(1).check();
   assert.equal(await done.isEnabled(),true);
   await done.click();
   assert.equal(matchGets,3,'old match rechecked at commit');
   assert.equal(gateReads,2,'old DO state rechecked at commit');
   assert.ok(snapshotGets>=4);
   const contents=await page.evaluate(id=>({
    pending:JSON.parse(localStorage.getItem('peakstamp_ss_uncertain_writes_v1:staging:'+id)),
    audit:JSON.parse(localStorage.getItem('peakstamp_ss_retired_attempt_audit_v1:staging:'+id))
   }),E);
   assert.deepEqual(contents.pending,[]);
   assert.equal(contents.audit.length,1);
   assert.equal(contents.audit[0].match_id,OLD);
   assert.equal(contents.audit[0].worker_gate_status,gateState);
   assert.equal(await page.locator('#workerBatchRun').isEnabled(),true);
  }
  assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  console.log('PASS: TEST historical match 404, gate '+gateState+', no write, archived only after explicit human confirmations');
 }finally{await page.close()}
}
try{
 await runCase('idle');
 await runCase('pending');
}finally{await browser.close()}
