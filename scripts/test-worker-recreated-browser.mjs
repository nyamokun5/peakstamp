import test from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const REQ_OLD='21111111-1111-4111-8111-111111111111';
const oldIds=[1,2,3,4].map(n=>'22222222-2222-4222-8222-22222222222'+n);
const newIds=[1,2,3,4].map(n=>'33333333-3333-4333-8333-33333333333'+n);
const matchData=()=>newIds.map((match_id,i)=>({
 match_id,seq:i+1,title:i<2?'準決勝':'決勝',
 status:committed?'finished':i<2?'scheduled':'waiting',
 left_team:i<2?'チーム'+(i*2+1):'',
 right_team:i<2?'チーム'+(i*2+2):'',
 left_score:0,right_score:0,winner:null,goals:[]
}));
const latest=()=>({event_id:E,matches:matchData(),roster:{
 チーム1:['山田'],チーム2:['西村'],チーム3:['田中'],チーム4:['橋本']
}});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
let statusReads=0,started=0,otherMutations=0,newReq=null,committed=false;
await page.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.host==='peakstamp.local'){
  const path=url.pathname==='/'?'sposched-review.html':url.pathname.slice(1);
  try{return await route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),
   contentType:path.endsWith('.html')?'text/html':'text/javascript'})}
  catch{return route.fulfill({status:404,body:'local test file not found'})}
 }
 test.equal(url.host,'shoot-sunday-sync-staging.yomax1979.workers.dev');
 const method=route.request().method();
 const body=method==='POST'?route.request().postDataJSON():null;
 let data;
 if(url.pathname==='/events')data={events:[{event_id:E,name:'TEST',date:'2026-10-25'}]};
 else if(url.pathname==='/snapshot')data=latest();
 else if(url.pathname==='/staging/batch/status'){
  statusReads++;
  test.equal(body.event_id,E);
  data={environment:'STAGING ONLY',event_id:E,
   request_id:committed?newReq:REQ_OLD,
   fixture_ids:Object.fromEntries((committed?newIds:oldIds).map((id,i)=>[String(i+1),id])),
   status:'completed',completed:4,total:4,phase:'done',
   updated_at:Date.now()};
 }else if(url.pathname==='/staging/batch/recreate'){
  started++;
  test.equal(started,1,'must not re-create same event twice');
  test.equal(body.event_id,E);
  test.equal(body.previous_request_id,REQ_OLD);
  test.equal(body.confirm_recreation,'TEST-ONLY RECREATE DELETED FIXTURES');
  test.deepEqual(body.operations.map(op=>[op.seq,op.action,op.expected_match_id]),[
   [1,'finish',newIds[0]],[2,'finish',newIds[1]],
   [3,'finish',newIds[2]],[4,'finish',newIds[3]]
  ]);
  newReq=body.request_id;committed=true;
  data={environment:'STAGING ONLY',request_id:newReq,event_id:E,
   status:'running',completed:0,total:4,phase:'preparing'};
 }else{
  otherMutations++;
  throw Error('unexpected browser API '+method+' '+url.pathname);
 }
 await route.fulfill({json:structuredClone(data),
  headers:{'Access-Control-Allow-Origin':'*'}});
});
await page.addInitScript(({eventId,requestId})=>{
 localStorage.setItem('peakstamp:test:worker-batch:'+eventId,requestId);
},{eventId:E,requestId:REQ_OLD});
try{
 await page.goto('https://peakstamp.local/');
 await page.selectOption('#ssEnvironment','staging');
 await page.fill('#ssBridgeToken','mock-only');
 await page.click('#ssLoadEvents');await page.click('#ssLoadSnapshot');
 await page.locator('#workerBatchRecreate').waitFor({state:'visible'});
 test.equal(await page.locator('#workerBatchRun').isDisabled(),true);
 test.equal(await page.locator('#ssResultPanel').isVisible(),false,
  'old generation must never appear as newly completed');
 test.ok(statusReads>=1);
 await page.click('#workerBatchRecreate');
 await page.locator('#ssResultPanel').waitFor({state:'visible'});
 test.equal(started,1);test.equal(otherMutations,0);
 test.equal(await page.locator('#workerBatchRecreate').isVisible(),false);
 const marker=await page.evaluate(id=>localStorage.getItem('peakstamp:test:worker-batch:'+id),E);
 test.equal(marker,newReq);
 const pending=await page.evaluate(id=>localStorage.getItem('peakstamp:test:worker-batch:recreate-pending:'+id),E);
 test.equal(pending,null);
 const timing=await page.evaluate(id=>localStorage.getItem('peakstamp:ss:test:worker-elapsed-v1:'+id),E);
 test.equal(JSON.parse(timing).requestId,newReq);
 test.deepEqual(errors,[]);
 test.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS: iPhone recreated TEST bracket requires explicit approval, archives old generation, adopts new job ID with zero browser goal writes');
}finally{await browser.close()}
