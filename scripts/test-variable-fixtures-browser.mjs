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
  let prod=0,posts=0,healthGets=0;
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
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
   if(scenario.retired&&['/staging/batch/inspect','/staging/batch/status'].includes(url.pathname)){
    return route.fulfill({status:200,json:{
     environment:'STAGING ONLY',event_id:E,
     request_id:'33333333-3333-4333-8333-333333333333',
     status:'completed',layout_mode:'four-knockout',fixture_count:4,
     inspection_only:true,inspection_contract:'event-inspect-v1',
     execution_active:false,
     fixture_ids:scenario.incomplete?{'1':matchId(11),'2':matchId(12)}:
      {'1':matchId(11),'2':matchId(12),'3':matchId(13),'4':matchId(14)},
     total:4,completed:4,updated_at:Date.now(),inspection_only:true
    },headers:{'Access-Control-Allow-Origin':'*'}});
   }
   // Model a Cloudflare Worker that still serves the old 4-match-only release.
   // This is GET-only and never contacts either real Worker.
   if(url.pathname==='/health'){
    healthGets++;
    return route.fulfill({status:200,json:{
     service:'shoot-sunday-sync-staging',write_mode:'test-only',
     batch_job_configured:true,independent_batch_contract:'durable-four-match-v1'
    },headers:{'Access-Control-Allow-Origin':'*'}});
   }
   const data=url.pathname==='/events'?
    {events:[{event_id:E,name:'TEST event',date:'2026-10-30',status:'target'}]}:
    url.pathname==='/snapshot'?{event_id:E,matches:scenario.fixtures,
     roster:{Team1:['Taro'],Team2:['Jiro'],Team3:['Saburo'],Team4:['Shiro'],
      Team5:['Goro'],Team6:['Roku']}}:{error:{message:'unsupported mocked path'}};
   return route.fulfill({status:url.pathname==='/events'||url.pathname==='/snapshot'?200:404,
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
   assert.equal(await page.locator('#quickIndividualTestTools').getAttribute('open'),
    scenario.automatic?null:'',scenario.label+' goal tools visibility');
   if(scenario.draw){
    assert.equal(await page.locator('#finishMatch').inputValue(),'1');
    assert.equal(await page.locator('#finishWinner option[value="draw"]').isEnabled(),true);
    await page.locator('#finishWinner').selectOption('draw');
    assert.equal(await page.locator('#finishExecute').isDisabled(),false);
   }
   if(scenario.retired){
    await page.waitForFunction(()=>
     document.querySelector('#workerBatchStatus')?.textContent.includes('旧4試合'));
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
     assert.match(await button.innerText(),/旧4試合.*新3試合.*TEST登録/);
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
   assert.equal(prod,0);assert.equal(posts,scenario.markerMismatch?3:scenario.retired?1:0,
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
