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
 チーム1:['山田','Taro Fujii','Tatsuo Sato'],チーム2:['西村'],チーム3:['田中'],チーム4:['橋本']
}});
const exercisePause=process.env.TEST_BATCH_PAUSE==='1';
const loseResumeReply=process.env.TEST_RESUME_LOST_REPLY==='1';
const losePauseReply=process.env.TEST_PAUSE_LOST_REPLY==='1';
const reloadPaused=process.env.TEST_PAUSE_RELOAD==='1';
const reloadRunning=process.env.TEST_RUNNING_RELOAD==='1';
const cancelFirstContinue=process.env.TEST_CANCEL_RUNNING_CONTINUE==='1';
let explicitlyRefreshedRunning=false;
let pauses=0,resumes=0;
let failFinalSnapshot=process.env.TEST_FINAL_SNAPSHOT_FAILURE==='1';
let incompleteFinalSnapshot=failFinalSnapshot;
let starts=0,decisions=0,statusCalls=0,inspectCalls=0,gateAuditReads=0,lastRequestId=null,step='idle',otherWrites=0;
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let dialogs=0;let cancelledResume=false;page.on('dialog',d=>{dialogs++;if(cancelFirstContinue&&!cancelledResume){cancelledResume=true;d.dismiss()}else d.accept()});
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
 else if(url.pathname==='/snapshot'){
  if(step==='completed'&&failFinalSnapshot)return route.fulfill({status:503,
   json:{error:{message:'simulated final snapshot outage'}},headers:{'Access-Control-Allow-Origin':'*'}});
  data=structuredClone(snapshot());
  if(step==='completed'&&incompleteFinalSnapshot){
   data.matches[3]={...data.matches[3],status:'scheduled'};
  }
 }
 else if(url.pathname==='/staging/batch/start'){
  starts++;assert.equal(starts,1,'starting twice is forbidden');
  assert.equal(body.event_id,E);
  assert.equal(body.confirm,'TEST-ONLY BATCH WRITE');
  assert.deepEqual(body.operations.map(op=>[op.action,op.seq]),[
   ['finish',1],['finish',2],['create',3],['finish',3],['finish',4]
  ],'waiting third-place goal is included automatically with no extra approval');
  assert.deepEqual(body.operations.map(op=>op.expected_match_id),[ids[0],ids[1],ids[2],ids[2],ids[3]]);
 assert.equal(body.operations.find(op=>op.action==='create'&&op.seq===3).scorer,'Taro Fujii');
 assert.equal(body.operations.find(op=>op.action==='create'&&op.seq===3).assist,'Tatsuo Sato');
  assert.ok(/^[0-9a-f-]{36}$/i.test(body.request_id));
  lastRequestId=body.request_id;step='running';
  data={environment:'STAGING ONLY',event_id:E,request_id:lastRequestId,
   status:'running',cursor:0,completed:0,total:5};
 }else if(url.pathname==='/staging/batch/pause'){
  pauses++;assert.equal(pauses,1);assert.equal(body.request_id,lastRequestId);
  assert.equal(body.confirm,'TEST-ONLY BATCH PAUSE');step='paused';data={status:'paused'};
  if(losePauseReply)return route.fulfill({status:503,json:{error:{message:'lost pause reply'}},headers:{'Access-Control-Allow-Origin':'*'}});
 }else if(url.pathname==='/staging/batch/resume'){
  resumes++;assert.equal(resumes,1);assert.equal(body.request_id,lastRequestId);
  assert.equal(body.confirm,'TEST-ONLY BATCH RESUME');assert.equal(body.pause_id,'pause-receipt');
  assert.equal(body.cursor,4);step='needs_decision';data={status:'needs_decision'};
  if(loseResumeReply)return route.fulfill({status:503,json:{error:{message:'lost resume reply'}},headers:{'Access-Control-Allow-Origin':'*'}});
 }else if(url.pathname==='/staging/status'){
  gateAuditReads++;assert.ok(ids.includes(body.match_id));
  data={environment:'STAGING ONLY',status:'verified',write_sent:false};
 }else if(url.pathname==='/staging/batch/status'||url.pathname==='/staging/batch/inspect'){
  const inspecting=url.pathname==='/staging/batch/inspect';
  if(inspecting)inspectCalls++;else statusCalls++;
  assert.equal(body.event_id,E);
  if(step==='running'&&!exercisePause&&!inspecting&&(!reloadRunning||explicitlyRefreshedRunning))step='needs_decision';
  data={environment:'STAGING ONLY',event_id:E,request_id:lastRequestId,
   ...(exercisePause?{control_contract:'event-pause-v1',phase:'preparing',pause_requested:step==='paused',pause_id:step==='paused'?'pause-receipt':null}:{}),
   ...(inspecting?{inspection_contract:'event-inspect-v1',inspection_only:true}:{}),
   status:step,cursor:step==='completed'?5:4,completed:step==='completed'?5:4,total:5,
   decision:step==='needs_decision'?{
    seq:4,match_id:ids[3],left_team:'チーム1',right_team:'チーム3',
    left_score:0,right_score:0,choices:['left','right','draw']
   }:null,
    metrics:step==='completed'?{
     steps:5,preflight_ms:1200,preview_ms:1800,execute_ms:5200,
     total_ms:8200,decision_wait_ms:1500,total_elapsed_ms:10800,
     by_step:[
      {seq:1,action:'finish',total_ms:2400},
      {seq:2,action:'finish',total_ms:2500},
      {seq:3,action:'create',total_ms:800},
      {seq:3,action:'finish',total_ms:1700},
      {seq:4,action:'finish',total_ms:1600}
     ]
    }:null};
 }else if(url.pathname==='/staging/batch/decision'){
  decisions++;assert.equal(decisions,1);
  assert.equal(body.request_id,lastRequestId);
  assert.equal(body.seq,4);assert.equal(body.winner,'draw');
  assert.equal(body.confirm,'TEST-ONLY BATCH DECISION');
  step='completed';
  matches.forEach(x=>{x.status='finished';x.winner=x.seq===4?'draw':'left'});
  data={environment:'STAGING ONLY',status:'running',cursor:4,completed:4,total:5};
 }else{
  otherWrites++;
  throw Error('Unexpected browser API '+method+' '+url.pathname);
 }
 await route.fulfill({json:structuredClone(data),headers:{
  'Access-Control-Allow-Origin':'*'
 }});
});
await page.addInitScript(()=>{
 const file={name:'IMG_0289.MOV',size:1234,lastModified:1000};
 localStorage.setItem('peakstamp_current_video_project_v1',JSON.stringify({
  version:1,projectId:'waiting-goal-test',files:[file],updatedAt:1000
 }));
 localStorage.setItem('peakstamp_confirmed_goals_v1:IMG_0289.MOV::1234::1000',
  JSON.stringify({source:file,items:[{
   id:'third-place',origin:'manual',status:'confirmed',
   timeSeconds:238,goalTimeSeconds:238,scorer:'藤井さん',
   assistStatus:'named',assist:'達夫',matchSeq:3
  }]}));
});
try{
 await page.goto('https://peakstamp.local/');
 await page.selectOption('#ssEnvironment','staging');
 await page.fill('#ssBridgeToken','intercepted-secret-only');
 await page.click('#ssLoadEvents');
 await page.click('#ssLoadSnapshot');
 await page.locator('#workerBatchArea').waitFor({state:'visible'});
 assert.equal(await page.locator('#quickGoals .quick-goal').count(),1);
 assert.match(await page.locator('#quickGoals').innerText(),/対戦確定後に自動登録/);
 assert.match(await page.locator('#quickGoals .quick-compare').innerText(),/AI提案/);
 assert.match(await page.locator('#quickGoals .quick-compare').innerText(),/藤井さん/);
 assert.match(await page.locator('#quickGoals .quick-compare').innerText(),/達夫/);
 assert.match(await page.locator('#quickGoals .quick-compare').innerText(),/Taro Fujii/);
 assert.match(await page.locator('#quickGoals .quick-compare').innerText(),/Tatsuo Sato/);
 assert.equal(await page.getByRole('button',{name:/試合番号・得点者・アシストを確認して進む/}).count(),0,
  'no redundant waiting-goal confirmation button');
 assert.equal(await page.locator('#workerBatchRun').isEnabled(),true);
 await page.locator('#workerGateAudit').waitFor({state:'visible'});
 await page.click('#workerGateAudit');
 await page.waitForFunction(()=>document.getElementById('workerGateAuditStatus').textContent.includes('未確定送信なし'));
 assert.equal(gateAuditReads,4,'one audit must check the four actual TEST match write gates');
 assert.equal(otherWrites,0,'auditing must not mutate SpoSched');
 await page.click('#workerBatchRun');
 assert.equal(dialogs,0,'one reviewed TEST batch button requires no duplicate native confirm');
 if(reloadRunning){
  await page.waitForFunction(()=>document.getElementById('workerBatchStatus').textContent.includes('順次処理中'));
  await page.reload();
  await page.selectOption('#ssEnvironment','staging');
  await page.fill('#ssBridgeToken','intercepted-secret-only');
  await page.click('#ssLoadEvents');
  const before=statusCalls;
  await page.click('#ssLoadSnapshot');
  await page.waitForFunction(()=>document.getElementById('workerBatchStatus').textContent.includes('自動再開しません'));
  assert.ok(inspectCalls>=1,'running page reload must use passive inspection');
  await page.waitForTimeout(1700);
  assert.equal(statusCalls,before,'running page reload must not resume through status polling');
  assert.equal(starts,1,'running page reload must not repeat start');
  assert.equal(await page.locator('#workerBatchRun').isDisabled(),true);
  if(cancelFirstContinue){
   const beforeCancelled=statusCalls;
   await page.click('#workerBatchRefresh');
   assert.equal(cancelledResume,true,'user must be able to decline TEST job continuation');
   assert.equal(statusCalls,beforeCancelled,'cancelled continuation cannot call active /status');
   assert.equal(starts,1,'cancelled continuation never resends the batch');
  }
  explicitlyRefreshedRunning=true;
  await page.click('#workerBatchRefresh');
  assert.ok(dialogs>=1,'running job continuation must require a visible confirmation');
 }

 if(exercisePause){
  await page.locator('#workerBatchPause').waitFor({state:'visible'});
  await page.click('#workerBatchPause');
  if(losePauseReply){
   await page.waitForFunction(()=>document.getElementById('workerBatchStatus').textContent.includes('操作を再送せず'));
   assert.equal(await page.locator('#workerBatchResume').isVisible(),false);
   assert.equal(pauses,1,'lost pause reply must not repeat pause');
   await page.click('#workerBatchRefresh');
  }
  await page.locator('#workerBatchResume').waitFor({state:'visible'});
  assert.match(await page.locator('#workerBatchStatus').innerText(),/一時停止/);
  assert.equal(starts,1);assert.equal(pauses,1);assert.equal(resumes,0);
  if(reloadPaused){
   const statusBeforeReload=statusCalls;
   await page.reload();
   await page.selectOption('#ssEnvironment','staging');
   await page.fill('#ssBridgeToken','intercepted-secret-only');
   await page.click('#ssLoadEvents');
   await page.click('#ssLoadSnapshot');
   await page.waitForFunction(()=>document.getElementById('workerBatchStatus').textContent.includes('一時停止'));
   assert.equal(await page.locator('#workerBatchResume').isVisible(),false,
    'passive reload cannot expose a resume button without explicit state refresh');
   assert.equal(statusCalls,statusBeforeReload,'page reload must never call active /status');
   await page.click('#workerBatchRefresh');
   await page.locator('#workerBatchResume').waitFor({state:'visible'});
   assert.match(await page.locator('#workerBatchStatus').innerText(),/一時停止/);
   assert.equal(await page.locator('#workerBatchRun').isEnabled(),false);
   assert.equal(starts,1,'reload must preserve the existing job instead of starting again');
   assert.ok(inspectCalls>=1,'reload must use passive inspect');
   assert.equal(statusCalls,statusBeforeReload+1,'explicit refresh must call /status exactly once');
   assert.equal(pauses,1);assert.equal(resumes,0,'reload must not automatically resume');
  }
  await page.click('#workerBatchResume');
  if(loseResumeReply){
   await page.waitForFunction(()=>document.getElementById('workerBatchStatus').textContent.includes('操作を再送せず'));
   assert.equal(await page.locator('#workerBatchResume').isVisible(),false);
   await page.click('#workerBatchRefresh');
  }
  assert.equal(resumes,1);assert.equal(starts,1);
 }
 await page.locator('#workerBatchDecision').waitFor({state:'visible'});
 assert.match(await page.locator('#workerBatchQuestion').innerText(),/0 - 0/);
 assert.equal(starts,1);assert.equal(decisions,0);
 // The clock must keep running while the human decides a drawn final.
 await page.waitForTimeout(1350);
 await page.selectOption('#workerBatchWinner','draw');
 if(exercisePause){
  const statusReply=page.waitForResponse(r=>r.url().includes('/staging/batch/status'));
  await page.click('#workerBatchRefresh');
  await statusReply;
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#workerBatchWinner').inputValue(),'draw',
   'a read-only refresh must preserve the winner choice for the same fixture');
 }
 await page.click('#workerBatchSubmitDecision');
 if(failFinalSnapshot){
  await page.waitForFunction(()=>document.getElementById('workerBatchStatus').textContent.includes('状態確認を完了できません'));
  assert.equal(await page.locator('#ssResultPanel').isVisible(),false,
   'failed official final snapshot must not show completion');
  assert.equal(await page.locator('#workerBatchRun').isDisabled(),true);
  failFinalSnapshot=false;
  await page.click('#workerBatchRefresh');
  await page.waitForFunction(()=>document.getElementById('workerBatchStatus').textContent.includes('試合 #4 の終了状態'));
  assert.equal(await page.locator('#ssResultPanel').isVisible(),false,
   'unfinished official fixture must not show completion');
  assert.equal(starts,1,'readback failures must not restart the batch');
  incompleteFinalSnapshot=false;
  await page.click('#workerBatchRefresh');
 }
 try {
  await page.waitForFunction(()=>document.getElementById('workerBatchStatus').textContent.includes('全操作の登録・照合'),null,{timeout:10000});
 }catch(e){
  const actual=await page.evaluate(()=>({
   status:document.getElementById('workerBatchStatus')?.textContent,
   decisionVisible:!document.getElementById('workerBatchDecision')?.hidden,
   refreshVisible:!document.getElementById('workerBatchRefresh')?.hidden
  }));
  console.error('TEST batch completion diagnostic',JSON.stringify({actual,step,pauses,resumes,starts,decisions,statusCalls}));
  throw e;
 }
 assert.equal(starts,1);assert.equal(decisions,1);
 assert.ok(statusCalls>=2);
 assert.equal(otherWrites,0,'browser must never directly POST goal or result');
 const stored=await page.evaluate(eventId=>localStorage.getItem('peakstamp:test:worker-batch:'+eventId),E);
 assert.equal(stored,lastRequestId);
 assert.equal(await page.locator('#workerBatchRun').isDisabled(),true);
 await page.locator('#workerTimingDetails').waitFor({state:'visible'});
 await page.click('#workerTimingDetails summary');
 const breakdown=await page.locator('#workerTimingSummary').innerText();
 assert.match(breakdown,/完了操作 5\/5/);
 assert.match(breakdown,/事前確認 1\.2秒/);
 assert.match(breakdown,/登録＋再取得 5\.2秒/);
 assert.match(breakdown,/勝敗入力待ち 1\.5秒/);
 assert.match(breakdown,/入力待ちを除くWorker経過 9\.3秒/);
 assert.match(await page.locator('#workerTimingSlowest').innerText(),/#2 終了：2\.5秒/);
 await page.locator('#ssResultPanel').waitFor({state:'visible'});
 await page.waitForFunction(()=>document.getElementById('flowStepLabel').textContent==='✓ 完了');
 assert.equal(await page.locator('#flowJump').getAttribute('data-target'),'ssResultPanel');
 assert.equal(await page.locator('#workerBatchJumpToGoal').isVisible(),false);
 assert.match(await page.locator('#workerBatchReadiness').innerText(),/再登録は不要/);
 const elapsedText=await page.locator('#ssResultTime').innerText();
 const seconds=Number(elapsedText.match(/([0-9]+\.[0-9])秒/)?.[1]);
 assert.ok(seconds>=1.3,'entire workflow must include the tie pause, got '+elapsedText);
 assert.equal(await page.locator('#ssResultLink').getAttribute('href'),
  'https://testsundayfront.web.app/app/shoot/activity/?event=%E6%97%A5%E6%9B%9C%E5%AE%9A%E6%9C%9F%252825+Oct%2529');
 assert.equal(await page.locator('#ssResultLink').getAttribute('target'),'_blank');
 const timing=await page.evaluate(eventId=>localStorage.getItem('peakstamp:ss:test:worker-elapsed-v1:'+eventId),E);
 assert.equal(JSON.parse(timing).requestId,lastRequestId);
 assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS: mobile TEST Worker batch: one start, progress poll, tied-final choice, no browser mutation replay and idempotent reconnect marker');
}finally{await browser.close()}
