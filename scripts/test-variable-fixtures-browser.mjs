// Browser-level TEST-only fixture-count acceptance. All SS calls mocked;
// no actual Worker or SpoSched mutation, no production endpoint allowed.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildStagingSite} from './build-staging-site.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const temp=await mkdtemp(path.join(tmpdir(),'peakstamp-variable-match-browser-'));
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const matchId=n=>'22222222-2222-4222-8222-'+String(n).padStart(12,'0');
const match=(seq,left,right,title,status='scheduled')=>({
 seq,match_id:matchId(seq),left_team:left,right_team:right,title,
 status,left_score:0,right_score:0,goals:[]
});
const scenarios=[
 {label:'manual goal refetches updated event roster',fixtures:[
   match(1,'Team1','Team2','#1 紅白戦'),
   match(2,'Team1','Team2','#2 紅白戦')],automatic:false,draw:true,manual:true,rosterShift:true},
 {label:'manual goal refuses a failed latest-roster refresh',fixtures:[
   match(1,'Team1','Team2','#1 紅白戦'),
   match(2,'Team1','Team2','#2 紅白戦')],automatic:false,draw:true,manual:true,refreshFail:true},
 {label:'two-team manual goal without source video',fixtures:[
   match(1,'Team1','Team2','#1 紅白戦'),
   match(2,'Team1','Team2','#2 紅白戦')],automatic:false,draw:true,manual:true},
 {label:'two-team one official match',fixtures:[
   match(1,'Team1','Team2','#1 対外試合')],automatic:false,draw:true},
 {label:'two-team two games same pair',fixtures:[
   match(1,'Team1','Team2','#1 紅白戦'),
   match(2,'Team1','Team2','#2 紅白戦')],automatic:false,draw:true},
 {label:'two-team three games repeated pairing',fixtures:[
   match(1,'Team1','Team2','#1 紅白戦'),
   match(2,'Team1','Team2','#2 紅白戦'),
   match(3,'Team1','Team2','#3 紅白戦')],automatic:false,draw:true},
  {label:'external one match',fixtures:[match(1,'Team1','External','対外試合')],automatic:false},
 {label:'scrimmage repeated pair',fixtures:Array.from({length:5},(_,i)=>
   match(i+1,'Team1','Team2','#'+(i+1)+' 紅白戦')),automatic:false},
 {label:'three-team league',fixtures:[
   match(1,'Team1','Team2','#1 リーグ'),match(2,'Team2','Team3','#2 リーグ'),
   match(3,'Team3','Team1','#3 リーグ')],automatic:false,draw:true},
 {label:'retired 2-match same two-team event re-created with new match IDs',fixtures:[
   match(1,'Team1','Team2','#1 紅白戦'),match(2,'Team1','Team2','#2 紅白戦')
 ],automatic:false,retired:true,retiredSameCount:true,recreateSmoke:true},
 {label:'retired four-match now three-fixture league',fixtures:[
   match(1,'Team1','Team2','#1 リーグ'),match(2,'Team1','Team3','#2 リーグ'),
   match(3,'Team2','Team3','#3 リーグ')],automatic:false,retired:true},
 {label:'retired Worker but local marker points to another job',fixtures:[
   match(1,'Team1','Team2','#1 リーグ'),match(2,'Team1','Team3','#2 リーグ'),
   match(3,'Team2','Team3','#3 リーグ')],automatic:false,retired:true,markerMismatch:true},
 {label:'retired incomplete old fixture IDs',fixtures:[
   match(1,'Team1','Team2','#1 リーグ'),match(2,'Team1','Team3','#2 リーグ'),
   match(3,'Team2','Team3','#3 リーグ')],automatic:false,retired:true,incomplete:true},
 {label:'four-team knockout',fixtures:[
   match(1,'Team1','Team2','#1 準決勝'),match(2,'Team3','Team4','#2 準決勝'),
   match(3,'','','#3 ３位決定戦','waiting'),match(4,'','','#4 決勝','waiting')],automatic:true},
 {label:'six-team concurrent pitches',fixtures:[
   match(1,'Team1','Team2','#1 Pitch1'),match(2,'Team3','Team4','#1 Pitch2'),
   match(3,'Team5','Team6','#2 Pitch1'),match(4,'Team1','Team3','#2 Pitch2'),
   match(5,'Team2','Team5','#3 Pitch1'),match(6,'Team4','Team6','#3 Pitch2'),
   match(7,'','','#4 3位決定戦','waiting'),
   match(8,'','','#4 決勝','waiting')],automatic:false}
];
try{
 await buildStagingSite(temp);
 for(const scenario of scenarios){
  let prod=0,posts=0,healthGets=0,submittedPlan=null,snapshotGets=0;
  let recreatePosts=0,confirmedRecreate=0;
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(scenario.recreateSmoke)page.on('dialog',async dialog=>{
   if(dialog.type()==='confirm'&&dialog.message().includes('旧2試合')){
    confirmedRecreate++;await dialog.accept();
   }else await dialog.dismiss();
  });
  if(scenario.retired)await page.addInitScript(({eventId,requestId})=>{
   localStorage.setItem('peakstamp:test:worker-batch:'+eventId,requestId);
  },{eventId:E,requestId:scenario.markerMismatch
    ?'44444444-4444-4444-8444-444444444444':'33333333-3333-4333-8333-333333333333'});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='peakstamp-stage.local'){
    const name=url.pathname.slice(1)||'index.html';
    try{return route.fulfill({body:await readFile(path.join(temp,name)),
     contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'})}
    catch{return route.fulfill({status:404,body:'missing TEST asset '+name})}
   }
   if(url.hostname==='shoot-sunday-sync.yomax1979.workers.dev'){
    prod++;return route.fulfill({status:403,body:'production is disallowed'});
   }
   assert.equal(url.hostname,'shoot-sunday-sync-staging.yomax1979.workers.dev');
   if(route.request().method()!=='GET')posts++;
   if(scenario.manual&&url.pathname==='/staging/batch/start'){
    submittedPlan=route.request().postDataJSON();
    return route.fulfill({status:202,json:{
     environment:'STAGING ONLY',event_id:E,request_id:submittedPlan.request_id,
     status:'running',write_sent:false
    },headers:{'Access-Control-Allow-Origin':'*'}});
   }
   if(scenario.manual&&url.pathname==='/staging/batch/status'){
    return route.fulfill({status:200,json:{
     environment:'STAGING ONLY',event_id:E,request_id:submittedPlan?.request_id,
     status:'blocked',phase:'preparing',layout_mode:'independent-fixtures-v1',
     fixture_count:2,fixture_ids:{'1':matchId(1),'2':matchId(2)},
     completed:0,total:3,blocked_reason:'mock-only: no upstream writes',
     write_sent:false
    },headers:{'Access-Control-Allow-Origin':'*'}});
   }
   if(scenario.recreateSmoke&&url.pathname==='/staging/batch/recreate'){
    recreatePosts++;
    submittedPlan=route.request().postDataJSON();
    return route.fulfill({status:202,json:{
     environment:'STAGING ONLY',event_id:E,
     request_id:submittedPlan.request_id,layout_mode:'independent-fixtures-v1',
     fixture_count:2,status:'running',phase:'preparing',cursor:0,completed:0,
     fixture_ids:{'1':matchId(1),'2':matchId(2)},write_sent:false
    },headers:{'Access-Control-Allow-Origin':'*'}});
   }
   if(scenario.recreateSmoke&&recreatePosts>0&&
      ['/staging/batch/inspect','/staging/batch/status'].includes(url.pathname)){
    return route.fulfill({status:200,json:{
     environment:'STAGING ONLY',event_id:E,
     request_id:submittedPlan.request_id,layout_mode:'independent-fixtures-v1',
     fixture_count:2,status:'blocked',phase:'preparing',cursor:0,completed:0,
     blocked_reason:'mock-only: new generation is not sent upstream',
     fixture_ids:{'1':matchId(1),'2':matchId(2)},write_sent:false,
     execution_active:false
    },headers:{'Access-Control-Allow-Origin':'*'}});
   }
   if(scenario.retired&&['/staging/batch/inspect','/staging/batch/status'].includes(url.pathname)){
    return route.fulfill({status:200,json:{
     environment:'STAGING ONLY',event_id:E,
     request_id:'33333333-3333-4333-8333-333333333333',
     status:'completed',
     layout_mode:scenario.retiredSameCount?'independent-fixtures-v1':'four-knockout',
     fixture_count:scenario.retiredSameCount?2:4,
     inspection_only:true,inspection_contract:'event-inspect-v1',
     execution_active:false,
     fixture_ids:scenario.retiredSameCount||scenario.incomplete
      ?{'1':matchId(11),'2':matchId(12)}:
       {'1':matchId(11),'2':matchId(12),'3':matchId(13),'4':matchId(14)},
     total:scenario.retiredSameCount?2:4,completed:scenario.retiredSameCount?2:4,
     updated_at:Date.now(),inspection_only:true
    },headers:{'Access-Control-Allow-Origin':'*'}});
   }
   // Model a Cloudflare Worker that still serves the old 4-match-only release.
   // This is GET-only and never contacts either real Worker.
   if(url.pathname==='/health'){
    healthGets++;
    return route.fulfill({status:200,json:{
     service:'shoot-sunday-sync-staging',write_mode:'test-only',
     batch_job_configured:true,independent_batch_contract:
      scenario.manual||scenario.recreateSmoke?
      'independent-fixtures-v1':'durable-four-match-v1',
     retired_generation_contract:scenario.recreateSmoke?'retired-independent-v1':undefined
    },headers:{'Access-Control-Allow-Origin':'*'}});
   }
   if(url.pathname==='/snapshot'){
    snapshotGets++;
    if(scenario.refreshFail&&snapshotGets>1)
     return route.fulfill({status:503,json:{error:{message:'TEST roster temporarily unavailable'}},
      headers:{'Access-Control-Allow-Origin':'*'}});
    const beforeShift=scenario.rosterShift&&snapshotGets===1;
    return route.fulfill({status:200,json:{
     event_id:E,event:{name:'TEST event',date:'2026-10-30'},
     roster_source:'official-current-event-teams',
     matches:scenario.fixtures,
     roster:beforeShift?
      {Team1:['OldCaptain'],Team2:['Jiro'],Team3:['Saburo']}:
      {Team1:['Taro','Aki'],Team2:['Jiro'],Team3:['Saburo'],Team4:['Shiro'],
       Team5:['Goro'],Team6:['Roku']}
    },headers:{'Access-Control-Allow-Origin':'*'}});
   }
   const data=url.pathname==='/events'?
    {events:[{event_id:E,name:'TEST event',date:'2026-10-30',status:'target'}]}:
    {error:{message:'unsupported mocked path'}};
   return route.fulfill({status:url.pathname==='/events'?200:404,
    json:data,headers:{'Access-Control-Allow-Origin':'*'}});
  });
  try{
   await page.goto('https://peakstamp-stage.local/sposched-review.html');
   await page.fill('#ssBridgeToken','mock-test-password');
   await page.click('#ssLoadEvents');
   await page.locator('#ssLoadSnapshot').waitFor({state:'visible'});
   await page.click('#ssLoadSnapshot');
   await page.locator('#ssFixtureOverview p').first().waitFor();
   const text=await page.locator('#ssFixtureOverview').innerText();
   assert.match(text,new RegExp(String(scenario.fixtures.length)+'試合'));
   assert.match(text,/SS公式/);
   assert.equal(await page.locator('#autoPanel').isVisible(),true,
    scenario.label+' must show the official fixture summary');
   const worker=page.locator('#workerBatchRun');
   if(scenario.automatic)assert.match(await worker.innerText(),/4試合/);
   else {
    assert.match(await worker.innerText(),new RegExp(String(scenario.fixtures.length)+'試合'));
    assert.equal(await worker.isDisabled(),Boolean(scenario.retired)||
     scenario.fixtures.some(m=>m.status==='waiting'));
    assert.equal(await page.locator('#legacyBatchDetails').isVisible(),false,
     'generic fixture schedules must never expose legacy knockout register');
   }
   assert.equal(await page.locator('#quickIndividualTestTools').getAttribute('open'),null,
    scenario.label+' exception-only goal tools should be collapsed in normal flow');
   if(scenario.draw){
    // Exception-only individual finish controls are intentionally closed in
    // the new one-click workflow, but remain available when opened.
    const fallback=page.locator('#individualFinishTools');
    await fallback.locator('summary').first().click();
    assert.equal(await fallback.getAttribute('open'),'');
    assert.equal(await page.locator('#finishMatch').inputValue(),'1');
    assert.equal(await page.locator('#finishWinner option[value="draw"]').isEnabled(),true);
    await page.locator('#finishWinner').selectOption('draw');
    assert.equal(await page.locator('#finishExecute').isDisabled(),false);
    await fallback.locator('summary').first().click();
   }
   if(scenario.retired){
    const oldCount=scenario.retiredSameCount?2:4;
    await page.waitForFunction(oldN=>
     document.querySelector('#workerBatchStatus')?.textContent.includes('旧'+oldN+'試合'),oldCount);
    const status=await page.locator('#workerBatchStatus').innerText();
    const button=page.locator('#workerBatchRecreate');
    if(scenario.incomplete||scenario.markerMismatch){
     assert.equal(await button.isVisible(),false);
     assert.match(status,/別のTESTイベント/);
     if(scenario.markerMismatch) {
      assert.match(status,/保存ジョブIDとWorkerが一致しません/);
      assert.match(status,/旧4試合.*3試合/);
     }
    }else{
     assert.equal(await button.isVisible(),true);
     assert.match(await button.innerText(),
      new RegExp('旧'+oldCount+'試合.*新'+scenario.fixtures.length+'試合.*TEST登録'));
     assert.match(status,/再送せず/);
    }
    assert.equal(await page.locator('#ssResultPanel').isVisible(),false,
     'retired job is NOT a success for the new three fixtures');
    assert.doesNotMatch(status,/完了後の4試合を取得できません/);
    if(scenario.markerMismatch){
     const reconnect=page.locator('#workerBatchReconnect');
     assert.equal(await reconnect.isVisible(),true,
      'Worker completed journal should offer local-only reconnection');
     assert.equal(await page.locator('#workerBatchRecreate').isVisible(),false,
      'fixture recreation remains forbidden before local verification');
     await reconnect.click();
     await page.waitForFunction(eventId=>
      localStorage.getItem('peakstamp:test:worker-batch:'+eventId)===
       '33333333-3333-4333-8333-333333333333',E);
     const backup=await page.evaluate(eventId=>localStorage.getItem(
      'peakstamp:test:worker-batch:reconnect-backup:'+eventId+
      ':44444444-4444-4444-8444-444444444444'),E);
     assert.equal(JSON.parse(backup).previous_request_id,
      '44444444-4444-4444-8444-444444444444',
      'previous local request ID must survive as an immutable backup');
     assert.equal(await page.locator('#workerBatchReconnect').isVisible(),false);
     assert.equal(await page.locator('#workerBatchRecreate').isVisible(),true,
      'only verified server-side 404/recreate path can now be separately offered');
    }
   }
   if(scenario.recreateSmoke){
    // Completed old 2-match Worker job is still present, but the official
    // current 2 fixtures have NEW IDs. A new video-free goal MUST join the
    // explicit recreate plan, never /start, and cannot replay the old IDs.
    assert.equal(await page.locator('#manualEntryPanel').isVisible(),true);
    assert.equal(await worker.isDisabled(),true,'existing Worker job blocks /start');
    await page.click('#manualEntryAdd');
    const draft=page.locator('.manual-entry-goal').first();
    await draft.waitFor();
    await draft.locator('select[aria-label="ゴール1の試合"]').selectOption('2');
    await draft.locator('select[aria-label="ゴール1の得点者"]').selectOption('Jiro');
    assert.match(await page.locator('#manualEntryPreview').innerText(),
     /#2\s+Team1 0 – 1 Team2/);
    const button=page.locator('#workerBatchRecreate');
    assert.equal(await button.isVisible(),true);
    assert.equal(recreatePosts,0,'manual draft/edit is read-only');
    await button.click();
    await page.waitForFunction(()=>
     document.querySelector('#workerBatchStatus')?.textContent.includes('mock-only'));
    assert.equal(confirmedRecreate,1,'exactly one explicit new-generation approval');
    assert.equal(recreatePosts,1,'exactly one new-generation POST, no replay');
    assert.equal(healthGets,1,'real public health feature gate checked before recreate');
    assert.equal(submittedPlan.layout_mode,'independent-fixtures-v1');
    assert.equal(submittedPlan.fixture_count,2);
    assert.equal(submittedPlan.previous_request_id,
     '33333333-3333-4333-8333-333333333333');
    assert.equal(submittedPlan.confirm_recreation,'TEST-ONLY RECREATE DELETED FIXTURES');
    assert.deepEqual(submittedPlan.operations.map(x=>[x.action,x.seq,x.expected_match_id]),[
      ['finish',1,matchId(1)],['create',2,matchId(2)],['finish',2,matchId(2)]
    ]);
    assert.deepEqual(submittedPlan.operations.filter(x=>x.action==='finish')
      .map(x=>x.winner),['draw','auto']);
    assert.equal(submittedPlan.operations[1].scorer,'Jiro');
    assert.ok(submittedPlan.operations.every(x=>![matchId(11),matchId(12)].includes(x.expected_match_id)),
     'old fixture IDs can never appear in new-generation operations');
    assert.equal(await worker.isDisabled(),true,'old job cannot be overwritten by /start');
    assert.equal(prod,0,'browser must never invoke production');
    assert.deepEqual(errors,[]);
   }
   if(scenario.manual){
    assert.equal(await page.locator('#manualEntryPanel').isVisible(),true,
     'manual entry is immediately discoverable in normal quick view');
    await page.click('#manualEntryAdd');
    if(scenario.refreshFail){
     await page.waitForFunction(()=>
      document.querySelector('#manualAddStatus')?.textContent.includes('最新名簿を確認できません'));
     assert.equal(await page.locator('.manual-entry-goal').count(),0);
     assert.equal(await page.locator('#manualEntryAdd').isDisabled(),true);
     assert.equal(await worker.isDisabled(),true);
     assert.equal(snapshotGets,2);
     assert.equal(posts,0);
     assert.equal(prod,0);
     assert.deepEqual(errors,[]);
     continue;
    }
    assert.equal(snapshotGets,2,'current roster fetched before draft creation');
    assert.match(await page.locator('#manualEventScope').innerText(),
     /登録先のSSイベント：TEST event.*2試合.*対戦チーム：Team1・Team2.*イベントID/);
    const first=page.locator('.manual-entry-goal').first();
    await first.waitFor();
    assert.equal(await first.locator('input[type=checkbox]').count(),0,
     'no confirmation checkbox per manual goal');
    await first.locator('select[aria-label="ゴール1の試合"]').selectOption('1');
    const scorer=first.locator('select[aria-label="ゴール1の得点者"]');
    const choices=await scorer.locator('option').allTextContents();
    assert.ok(choices.some(x=>x.includes('Taro')&&x.includes('Team1')));
    assert.ok(choices.some(x=>x.includes('Jiro')&&x.includes('Team2')));
    assert.ok(choices.every(x=>!/Team3|Team4|Team5|Team6/.test(x)));
    if(scenario.rosterShift){
     assert.ok(!choices.some(x=>x.includes('OldCaptain')));
     assert.ok(!choices.some(x=>x.includes('Saburo')));
     assert.match(await page.locator('#manualAddStatus').innerText(),/更新されています/);
    }
    await scorer.selectOption('Taro');
    await first.locator('select[aria-label="ゴール1のアシスト有無"]').selectOption('named');
    const assist=first.locator('select[aria-label="ゴール1のアシスト者"]');
    assert.ok((await assist.locator('option').allTextContents()).some(x=>x.includes('Aki')));
    assert.ok((await assist.locator('option').allTextContents()).every(x=>!x.includes('Jiro')));
    await assist.selectOption('Aki');
    assert.match(await page.locator('#manualEntryPreview').innerText(),/Team1 1 – 0 Team2/);
    assert.equal(await worker.isDisabled(),false,'one final submit only');
    assert.match(await page.locator('#manualEntryAdd').innerText(),/2点目/);
    await page.click('#manualEntryAdd');
    assert.equal(snapshotGets,3,'every new goal refreshes the SS current roster');
    await page.locator('.manual-entry-goal').nth(1).waitFor();
    assert.equal(await page.locator('.manual-entry-goal').count(),2);
    await page.locator('select[aria-label="ゴール2の得点者"]').selectOption('Jiro');
    assert.match(await page.locator('#manualEntryPreview').innerText(),/Team1 1 – 1 Team2/);
    assert.match(await page.locator('#manualEntryPreview').innerText(),/Team1 0 – 0 Team2/);
    assert.match(await page.locator('#manualEntryAdd').innerText(),/3点目/);
    const ties=page.locator('#manualEntryPreview select[aria-label*="同点時の結果"]');
    assert.equal(await ties.count(),2);
    assert.equal(await ties.nth(0).inputValue(),'draw');
    assert.equal(await ties.nth(1).inputValue(),'draw');
    await page.click('#manualEntryReview');
    assert.equal(posts,0,'final preview scroll must never write to SS');
    await worker.click();
    await page.waitForFunction(()=>
     document.querySelector('#workerBatchStatus')?.textContent.includes('mock-only'));
    assert.equal(healthGets,1);
    assert.equal(submittedPlan?.layout_mode,'independent-fixtures-v1');
    assert.equal(submittedPlan?.fixture_count,2);
    assert.deepEqual(submittedPlan.operations.map(x=>[x.action,x.seq,x.expected_match_id]),[
     ['create',1,matchId(1)],['create',1,matchId(1)],
     ['finish',1,matchId(1)],['finish',2,matchId(2)]
    ]);
    assert.deepEqual(submittedPlan.operations.filter(x=>x.action==='finish')
     .map(x=>x.winner),['draw','draw']);
    assert.deepEqual(submittedPlan.operations.filter(x=>x.action==='create')
     .map(x=>[x.team,x.scorer,x.assist]),[['Team1','Taro','Aki'],['Team2','Jiro','']]);
    assert.equal(posts,2,'one start and one passive status only, no real upstream write');
    assert.equal(await worker.isDisabled(),true,'blocked job must not be replayed');
   }
   assert.equal(prod,0);
   if(!scenario.manual&&!scenario.recreateSmoke)assert.equal(posts,scenario.markerMismatch?3:scenario.retired?1:0,
    'only passive inspection POST is allowed; no start/recreate mutation');
   assert.deepEqual(errors,[],scenario.label+' JS errors');
   if(scenario.label==='external one match'){
    assert.equal(await worker.isDisabled(),false,'clean 1-match fixture should offer TEST batch');
    const localKeys=await page.evaluate(()=>Object.keys(localStorage).sort());
    await worker.click();
    await page.waitForFunction(()=>
     document.querySelector('#workerBatchStatus')?.textContent.includes('最新版'));
    assert.match(await page.locator('#workerBatchStatus').innerText(),/TEST Worker.*最新版/);
    assert.equal(healthGets,1,'one public GET health capability preflight');
    assert.equal(posts,0,'stale Worker must not receive any POST');
    assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).sort()),localKeys,
     'failed capability check cannot persist a pending batch marker');
   }
   console.log('PASS: '+scenario.label+' official fixtures='+scenario.fixtures.length+', no writes');
  }finally{await page.close()}
 }
}finally{
 await browser.close();await rm(temp,{recursive:true,force:true});
}
