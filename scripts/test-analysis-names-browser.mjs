// iPhone-sized DOM integration; every SS request is intercepted and GET-only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildStagingSite} from './build-staging-site.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
await buildStagingSite();
const E='11111111-1111-4111-8111-111111111111';
const M='22222222-2222-4222-8222-222222222222';
const A='33333333-3333-4333-8333-333333333333';
const B='44444444-4444-4444-8444-444444444444';
const snapshot={event_id:E,roster_source:'official-current-event-teams',
 matches:[{seq:1,match_id:M,status:'scheduled',left_team:'チーム1',right_team:'チーム2',left_score:0,right_score:0,goals:[]}],
 roster:{'チーム1':['濱直','やまだじょ'],'チーム3':['対象外']},
 roster_players:[{name:'濱直',team:'チーム1',player_id:A,user_id:A},
 {name:'やまだじょ',team:'チーム1',player_id:B,user_id:B}]};
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
let outage=false,delay=false,release;const errors=[],calls=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.host==='peakstamp.local'){
  const path=u.pathname==='/'?'index.html':u.pathname.slice(1);
  try{
   let body=await readFile(new URL('../dist/'+path,import.meta.url));
   if(path==='index.html')body=body.toString().replace(/<script type="module" src="(?:\.\/)?app\.mjs[^<]+<\/script>/,'');
   return route.fulfill({body,contentType:path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript'});
  }catch{return route.fulfill({status:404,body:''})}
 }
 assert.equal(u.host,'shoot-sunday-sync-staging.yomax1979.workers.dev');
 assert.equal(route.request().method(),'GET');calls.push(u.pathname);
 if(u.pathname==='/events')return route.fulfill({json:{events:[{event_id:E,date:'2026-11-08',name:'TEST'}]}});
 if(u.pathname==='/snapshot'){
  if(delay)await new Promise(r=>release=r);
  return route.fulfill({json:snapshot});
 }
 if(u.pathname==='/staging/alias/list')return route.fulfill(outage?{status:503,json:{}}:
  {json:{aliases:[{alias:'ハマさん',member_id:A},{alias:'ジョージさん',member_id:B}]}});
 // Review capability discovery is read-only and optional.
 return route.fulfill({status:404,json:{error:{message:'mock unsupported'}}});
});
try{
 await page.goto('http://peakstamp.local/');
 await page.evaluate(async E=>{
  const {initGoalStatsReview}=await import('/goal-stats-ui.mjs');
  const {initAnalysisNames}=await import('/sposched-analysis-names.mjs');
  const {saveCurrentGoalProject}=await import('/goal-project.mjs');
  const {confirmedGoalExport}=await import('/goal-stats.mjs');
  const src={id:'s1',file:new File(['x'],'test.mov',{lastModified:1}),objectUrl:'blob:mock',duration:60,matchNumber:1,candidates:[]};
  localStorage.setItem('peakstamp_gemini_primary_json_v1',JSON.stringify({'test.mov::1::1':{utterances:[
   {kind:'goal_call',time_seconds:30,scorer:'ハマさん',assist:'ジョージさん',quote:'ハマさん ゴール ジョージさん アシスト'}]}}));
  saveCurrentGoalProject(localStorage,[src]);
  const state={sources:[src]};window.testState=state;
  const review=initGoalStatsReview(state,{onKeepClip:()=>true});
  window.testNames=initAnalysisNames(state,{onChange:()=>review.refresh()});
  window.testExport=()=>confirmedGoalExport([src],localStorage);
  document.getElementById('geminiPrimaryPanel').hidden=false;
 },E);
 await page.fill('#ssAnalysisToken','mock');
 await page.check('#ssAnalysisRemember');
 await page.click('#ssAnalysisConnect');
 await page.selectOption('#ssAnalysisEvent',E);
 await page.waitForFunction(()=>window.testState.ssNameContext?.snapshot?.eventId);
 await page.locator('.goal-score-details summary').click();
 assert.equal(await page.locator('select[aria-label="得点者（ゴール）"]').inputValue(),'濱直');
 assert.equal(await page.locator('select[aria-label="アシスト者"]').inputValue(),'やまだじょ');
 assert.ok(!(await page.locator('select[aria-label="得点者（ゴール）"]').innerText()).includes('対象外'));
 // Correct an uncertain raw observation with one official selection.
 await page.evaluate(()=>{
  const key='peakstamp_confirmed_goals_v1:test.mov::1::1';
  const d=JSON.parse(localStorage.getItem(key));d.items[0].rawAssist='未知';d.items[0].assist='未知';
  localStorage.setItem(key,JSON.stringify(d));
 });
 await page.evaluate(()=>window.testNames.refresh());
 await page.locator('select[aria-label="アシスト者"]').selectOption('やまだじょ');
 // Keep uses the existing video-review action; it does not write to SS.
 const keep=page.locator('.goal-review-video-keep');await keep.click();
 await page.waitForFunction(()=>window.testExport().goals.length===1);
 const exported=await page.evaluate(()=>window.testExport());
 assert.equal(exported.goals[0].scorer,'濱直');assert.equal(exported.goals[0].rawScorer,'ハマさん');
 assert.equal(exported.goals[0].rawAssist,'未知');
 // API failure leaves video data intact and removes only automatic identity.
 outage=true;await page.evaluate(()=>window.testNames.refresh());
 assert.match(await page.locator('#ssAnalysisStatus').innerText(),/呼び名を取得できません/);
 assert.equal(await page.evaluate(()=>window.testState.sources[0].duration),60);
 outage=false;await page.evaluate(()=>window.testNames.refresh());
 // A response after password edit cannot install stale context.
 delay=true;const pending=page.evaluate(()=>window.testNames.refresh());
 while(!release)await page.waitForTimeout(10);await page.fill('#ssAnalysisToken','changed');
 release();await pending;delay=false;
 assert.equal(await page.evaluate(()=>window.testState.ssNameContext),null);
 await page.fill('#ssAnalysisToken','mock');await page.evaluate(()=>window.testNames.refresh());
 await page.goto('http://peakstamp.local/sposched-review.html');
 await page.click('#ssLoadEvents');
 await page.waitForFunction(E=>document.getElementById('ssEventSelect').value===E,E);
 await page.click('#ssLoadSnapshot');
 await page.waitForFunction(()=>document.getElementById('ssDirectStatus').textContent.includes('読み込み完了'));
 assert.match(await page.locator('#quickGoals').innerText(),/濱直/);
 assert.ok(calls.includes('/staging/alias/list'));
 assert.deepEqual(errors,[]);
 console.log('PASS mobile analysis selectors, Keep, raw transfer, alias outage, stale response, SS review; zero writes');
}finally{await browser.close()}
