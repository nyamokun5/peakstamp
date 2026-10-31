// Actual PeakStamp HTML -> actual paired Worker router/DO/executor/gates.
// Only upstream SpoSched data is synthetic. All browser traffic is intercepted.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isAbsolute,resolve,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {manualStoreKey} from '../sposched-manual-goals.mjs';
import {productionBatchStorageKey} from '../sposched-production-release.mjs';
import {productionSubmissionKey} from '../sposched-production-submission.mjs';
const checkout=process.env.WORKER_CHECKOUT_PATH;
assert.ok(checkout&&isAbsolute(checkout),'WORKER_CHECKOUT_PATH must identify the paired Worker checkout; no canned-response fallback');
const {createProductionBrowserHarness}=await import(pathToFileURL(resolve(checkout,'test-support/production-browser-harness.mjs')).href);
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='https://nyamokun5.github.io';
const workerOrigin='https://shoot-sunday-sync.yomax1979.workers.dev';
const pageURL=origin+'/peakstamp/sposched-review.html';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
async function withSignalDeadline(promise,label,timeoutMs=15000){
 let timer;
 try{
  return await Promise.race([promise,new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(Error('Timed out after '+timeoutMs+'ms waiting for '+label)),timeoutMs);
  })]);
 }finally{clearTimeout(timer);}
}
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
async function scenario({fixtureCount=2,lostStartResponse=false,lostGoalResponse=false,storageFailure=false,crossTabChange=false}={}){
 const harness=createProductionBrowserHarness({fixtureCount,lostStartResponse,lostGoalResponse});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();
 const errors=[],routeErrors=[],corsResponses=[];
 page.on('pageerror',error=>errors.push(error.message));
 const accepted=deferred(),startGate=deferred(),snapshotHeld=deferred(),snapshotGate=deferred();
 let starts=0,heldSnapshot=false,startAccepted=false;
 const manualKey=manualStoreKey('production',harness.eventId);
 const markerKey=productionBatchStorageKey(harness.eventId);
 const receiptKey=productionSubmissionKey(harness.eventId);
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  try{
   if(url.origin===origin){
    assert.equal(req.method(),'GET');assert.ok(url.pathname.startsWith('/peakstamp/'));
    const file=resolve(root,decodeURIComponent(url.pathname.slice('/peakstamp/'.length)));
    assert.ok(file.startsWith(root+sep),'local asset path must remain inside PeakStamp');
    return await route.fulfill({body:await readFile(file),contentType:file.endsWith('.html')?'text/html':'text/javascript'});
   }
   assert.equal(url.origin,workerOrigin,'unexpected browser network destination');
   const headers=new Headers(await req.allHeaders());
   assert.equal(headers.get('origin'),origin,'browser must use the real approved production origin');
   const body=req.method()==='GET'||req.method()==='HEAD'?undefined:req.postData();
   let response;
   try{response=await harness.fetchWorker(new Request(req.url(),{method:req.method(),headers,body}));}
   catch(error){
    if(lostStartResponse&&url.pathname==='/production/batch/start'&&req.method()==='POST'){
     assert.match(error.message,/synthetic start ACK lost after Worker acceptance/);
     starts++;startAccepted=true;accepted.resolve();return await route.abort('failed');
    }
    throw error;
   }
   assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin,'CORS must come from the actual Worker, never this harness');
   corsResponses.push({method:req.method(),path:url.pathname,status:response.status});
   if(url.pathname==='/production/batch/start'&&req.method()==='POST'){
    starts++;assert.equal(response.status,202);startAccepted=true;accepted.resolve();
    await startGate.promise;
   }
   if(crossTabChange&&startAccepted&&url.pathname==='/snapshot'&&!heldSnapshot&&harness.snapshotMatches().every(m=>m.status==='finished')){
    heldSnapshot=true;snapshotHeld.resolve();await snapshotGate.promise;
   }
   return await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  }catch(error){routeErrors.push(error.message);accepted.resolve();snapshotHeld.resolve();await route.abort('failed').catch(()=>{});}
 });
 const stored=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'[]'),manualKey);
 const status=()=>page.locator('#productionStatus').innerText();
 async function load(){
  await page.goto(pageURL);await page.fill('#ssBridgeToken',harness.bridgeToken);await page.click('#ssLoadEvents');
  await page.locator('#ssLoadSnapshot').waitFor({state:'visible'});await page.click('#ssLoadSnapshot');
  await page.locator('#productionPanel').waitFor({state:'visible'});
 }
 async function refresh(){
  await page.waitForFunction(()=>!document.getElementById('productionRefresh').disabled);
  await page.click('#productionRefresh');
  await page.waitForFunction(()=>!document.getElementById('productionRefresh').disabled);
 }
 async function settle(){
  for(let i=0;i<fixtureCount+4;i++){
   await harness.drain();await refresh();
   if((await status()).includes('SSで確認'))return;
   if(await page.locator('#productionDecision').isVisible()){
    const choices=await page.locator('#productionWinner option').evaluateAll(options=>options.filter(o=>!o.disabled).map(o=>o.value));
    assert.ok(choices.includes('draw'),'independent drawn match must explicitly offer draw');
    await page.selectOption('#productionWinner','draw');await page.click('#productionDecisionSend');
    await page.waitForFunction(()=>!document.getElementById('productionDecisionSend').disabled);
   }
  }
  throw Error('paired completion did not settle: '+await status());
 }
 try{
  await load();await page.click('#quickEdit');await page.click('#manualAddGoal');
  const row=page.locator('#goalRows article').first(),fields=row.locator('.fields select');
  await fields.nth(0).selectOption('1');await fields.nth(1).selectOption('A');
  await fields.nth(2).selectOption('named');await fields.nth(3).selectOption('Assist A');await fields.nth(4).selectOption('Blue');
  await row.locator('label').filter({hasText:'このゴールの試合・選手を確認した'}).locator('input').check();
  const originalId=(await stored())[0].id;
  await page.click('#productionCheck');
  await page.waitForFunction(()=>!document.getElementById('productionStart').disabled);
  if(storageFailure)await page.evaluate(()=>{
   const original=Storage.prototype.setItem;
   Storage.prototype.setItem=function(key,value){if(key.startsWith('peakstamp:production:submission-v1:'))throw new DOMException('synthetic quota','QuotaExceededError');return original.call(this,key,value)};
  });
  await page.click('#productionStart');
  if(storageFailure){
   await page.waitForFunction(()=>document.getElementById('productionStatus').textContent.includes('本番登録を停止'));
   assert.equal(starts,0);assert.equal(harness.upstreamCalls.filter(c=>c.method!=='GET').length,0);
   assert.equal(await page.evaluate(k=>localStorage.getItem(k),markerKey),null);assert.equal((await stored())[0].sent,false);
  }else{
   await withSignalDeadline(accepted.promise,'actual Worker batch/start acceptance');assert.deepEqual(routeErrors,[]);assert.equal(starts,1);
   const marker=await page.evaluate(k=>localStorage.getItem(k),markerKey);
   const receipt=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),receiptKey);
   assert.equal(marker,receipt.request_id);assert.equal((await stored())[0].sent,false);
   let lateId;
   if(!lostStartResponse&&!lostGoalResponse&&!crossTabChange){
    await page.click('#manualAddGoal');lateId=(await stored()).find(g=>g.id!==originalId).id;
   }
   startGate.resolve();await harness.drain();
   if(lostStartResponse){
    await page.waitForFunction(()=>document.getElementById('productionStatus').textContent.includes('送信結果が不確定'));
    // The real job may have advanced; reopen the receipt, never resubmit.
    await load();
   }
   if(crossTabChange){
    assert.equal(fixtureCount,1);await withSignalDeadline(snapshotHeld.promise,'completed official snapshot interception');assert.deepEqual(routeErrors,[]);
    const replacement='77777777-7777-4777-8777-777777777777';
    await page.evaluate(({k,v})=>localStorage.setItem(k,v),{k:markerKey,v:replacement});snapshotGate.resolve();
    await page.waitForFunction(()=>document.getElementById('productionStatus').textContent.includes('保存済み本番ジョブが変更'));
    assert.equal((await stored())[0].sent,false);assert.equal(await page.evaluate(k=>localStorage.getItem(k),markerKey),replacement);
   }else if(lostGoalResponse){
    await refresh();assert.match(await status(),/要確認/);
    assert.equal((await stored())[0].sent,false);assert.equal(harness.snapshotMatches()[0].goals.length,1);
    const before=harness.upstreamCalls.filter(c=>c.method!=='GET').length;
    await load();await refresh();assert.equal(starts,1);
    assert.equal(harness.upstreamCalls.filter(c=>c.method!=='GET').length,before,'unknown upstream ACK never replays writes');
   }else{
    await settle();
    let drafts=await stored();assert.equal(drafts.find(g=>g.id===originalId).sent,true);
    if(lateId)assert.equal(drafts.find(g=>g.id===lateId).sent,false);
    const matches=harness.snapshotMatches();assert.equal(matches.length,fixtureCount);assert.ok(matches.every(m=>m.status==='finished'));
    assert.equal(matches[0].left.score,1);assert.equal(matches[0].right.score,0);
    assert.equal(matches[0].goals[0].scorer.name,'A');assert.equal(matches[0].goals[0].assist.name,'Assist A');
    assert.ok(matches.slice(1).every(m=>m.winner==='draw'&&m.left.score===0&&m.right.score===0));
    const writes=harness.upstreamCalls.filter(c=>c.method!=='GET').length;
    await load();await refresh();drafts=await stored();
    assert.equal(drafts.find(g=>g.id===originalId).sent,true);if(lateId)assert.equal(drafts.find(g=>g.id===lateId).sent,false);
    assert.equal(starts,1);assert.equal(harness.upstreamCalls.filter(c=>c.method!=='GET').length,writes);
   }
  }
  assert.equal(await page.evaluate(k=>localStorage.getItem(k),manualStoreKey('staging',harness.eventId)),null);
  assert.deepEqual(errors,[]);assert.deepEqual(routeErrors,[]);
  assert.ok(corsResponses.some(c=>c.path==='/production/inspect'&&c.status===200));
  console.log('PASS paired actual HTML/Worker:',JSON.stringify({fixtureCount,lostStartResponse,lostGoalResponse,storageFailure,crossTabChange,starts}));
 }catch(error){
  console.error('Paired scenario diagnostic:',JSON.stringify({fixtureCount,lostStartResponse,lostGoalResponse,storageFailure,crossTabChange,status:await status().catch(()=>''),routeErrors,errors}));throw error;
 }finally{
  startGate.resolve();snapshotGate.resolve();await context.close();await harness.close();
 }
}
try{
 const counts=process.env.PAIRED_FIXTURE_COUNTS?process.env.PAIRED_FIXTURE_COUNTS.split(',').map(Number):[1,2,3,4,8,24];
 assert.ok(counts.length&&counts.every(n=>Number.isInteger(n)&&n>=1&&n<=24),'invalid paired fixture counts');
 for(const fixtureCount of counts)await scenario({fixtureCount});
 if(!process.env.PAIRED_SUCCESS_ONLY){
  await scenario({fixtureCount:2,lostStartResponse:true});await scenario({fixtureCount:2,lostGoalResponse:true});
  await scenario({fixtureCount:1,storageFailure:true});await scenario({fixtureCount:1,crossTabChange:true});
 }
 console.log('PASS paired production browser matrix; no live HTTP or deployed storage exercised');
}finally{await browser.close();}
