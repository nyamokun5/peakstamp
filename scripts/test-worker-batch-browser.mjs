// iPhone-sized browser acceptance for the NEW Worker-managed TEST batch.
// All requests are intercepted. Absolutely no SpoSched or Worker live writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const ids=[1,2,3,4].map(n=>'22222222-2222-4222-8222-22222222222'+n);
const matches=ids.map((match_id,i)=>({
 match_id,seq:i+1,title:i<2?'準決勝':i===2?'3位決定戦':'決勝',
 status:i<2?'scheduled':'waiting',
 left_team:i<2?'チーム'+(i*2+1):'',right_team:i<2?'チーム'+(i*2+2):'',
 left_score:0,right_score:0,winner:null,goals:[]
}));
const snapshot=()=>({event_id:E,matches,roster:{
 チーム1:['山田'],チーム2:['西村'],チーム3:['田中'],チーム4:['橋本']
}});
let starts=0,decisions=0,statusCalls=0,lastRequestId=null,step='idle',otherWrites=0;
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('dialog',d=>d.accept());
await page.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.host==='peakstamp.local'){
  const path=url.pathname==='/'?'sposched-review.html':url.pathname.slice(1);
  try{return await route.fulfill({
   body:await readFile(new URL('../'+path,import.meta.url)),
   contentType:path.endsWith('.html')?'text/html':'text/javascript'
  })}catch{return route.fulfill({status:404,body:'Missing test module'})}
 }
 assert.equal(url.host,'shoot-sunday-sync-staging.yomax1979.workers.dev');
 let data,method=route.request().method();
 const body=method==='POST'?route.request().postDataJSON():null;
 if(url.pathname==='/events')data={events:[{event_id:E,name:'TEST',date:'2026-10-25'}]};
 else if(url.pathname==='/snapshot')data=snapshot();
 else if(url.pathname==='/staging/batch/start'){
  starts++;assert.equal(starts,1,'starting twice is forbidden');
  assert.equal(body.event_id,E);
  assert.equal(body.confirm,'TEST-ONLY BATCH WRITE');
  assert.deepEqual(body.operations.map(op=>[op.action,op.seq]),[
   ['finish',1],['finish',2],['finish',3],['finish',4]
  ]);
  assert.deepEqual(body.operations.map(op=>op.expected_match_id),ids);
  assert.ok(/^[0-9a-f-]{36}$/i.test(body.request_id));
  lastRequestId=body.request_id;step='running';
  data={environment:'STAGING ONLY',event_id:E,request_id:lastRequestId,
   status:'running',cursor:0,completed:0,total:4};
 }else if(url.pathname==='/staging/batch/status'){
  statusCalls++;
  assert.equal(body.event_id,E);
  if(step==='running')step='needs_decision';
  data={environment:'STAGING ONLY',event_id:E,request_id:lastRequestId,
   status:step,cursor:step==='completed'?4:3,completed:step==='completed'?4:3,total:4,
   decision:step==='needs_decision'?{
    seq:4,match_id:ids[3],left_team:'チーム1',right_team:'チーム3',
    left_score:0,right_score:0,choices:['left','right','draw']
   }:null};
 }else if(url.pathname==='/staging/batch/decision'){
  decisions++;assert.equal(decisions,1);
  assert.equal(body.request_id,lastRequestId);
  assert.equal(body.seq,4);assert.equal(body.winner,'draw');
  assert.equal(body.confirm,'TEST-ONLY BATCH DECISION');
  step='completed';
  matches.forEach(x=>{x.status='finished';x.winner=x.seq===4?'draw':'left'});
  data={environment:'STAGING ONLY',status:'running',cursor:3,completed:3,total:4};
 }else{
  otherWrites++;
  throw Error('Unexpected browser API '+method+' '+url.pathname);
 }
 await route.fulfill({json:structuredClone(data),headers:{
  'Access-Control-Allow-Origin':'*'
 }});
});
try{
 await page.goto('http://peakstamp.local/');
 await page.selectOption('#ssEnvironment','staging');
 await page.fill('#ssBridgeToken','intercepted-secret-only');
 await page.click('#ssLoadEvents');
 await page.click('#ssLoadSnapshot');
 await page.locator('#workerBatchArea').waitFor({state:'visible'});
 assert.equal(await page.locator('#workerBatchRun').isEnabled(),true);
 await page.click('#workerBatchRun');
 await page.locator('#workerBatchDecision').waitFor({state:'visible'});
 assert.match(await page.locator('#workerBatchQuestion').innerText(),/0 - 0/);
 assert.equal(starts,1);assert.equal(decisions,0);
 await page.selectOption('#workerBatchWinner','draw');
 await page.click('#workerBatchSubmitDecision');
 await page.waitForFunction(()=>document.getElementById('workerBatchStatus').textContent.includes('全操作の登録・照合'));
 assert.equal(starts,1);assert.equal(decisions,1);
 assert.ok(statusCalls>=2);
 assert.equal(otherWrites,0,'browser must never directly POST goal or result');
 const stored=await page.evaluate(eventId=>localStorage.getItem('peakstamp:test:worker-batch:'+eventId),E);
 assert.equal(stored,lastRequestId);
 assert.equal(await page.locator('#workerBatchRun').isDisabled(),true);
 assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS: mobile TEST Worker batch: one start, progress poll, tied-final choice, no browser mutation replay and idempotent reconnect marker');
}finally{await browser.close()}
