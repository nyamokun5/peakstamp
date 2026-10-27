// UI-only browser regression. All bridge calls intercepted; no real SS traffic.
// PLAYWRIGHT_MODULE may point at a locally installed Playwright entry module.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const ids=[1,2,3,4].map(n=>`22222222-2222-4222-8222-22222222222${n}`);
const matches=ids.map((match_id,i)=>({match_id,seq:i+1,title:i===2?'3位決定戦':i===3?'決勝':'準決勝',status:i<2?'scheduled':'waiting',
 left_team:i<2?'チーム'+(i*2+1):'',right_team:i<2?'チーム'+(i*2+2):'',left_score:i<2?1:0,right_score:0,winner:null,goals:[]}));
const snapshot=()=>({event_id:E,matches,roster:{'チーム1':['山田'],'チーム2':['西村','徳永'],'チーム3':['田中'],'チーム4':['橋本']}});
let writes=0,stale=false;
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.host==='peakstamp.local'){
  const path=u.pathname==='/'?'sposched-review.html':u.pathname.slice(1);
  try{return await route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),contentType:path.endsWith('.html')?'text/html':'text/javascript'})}
  catch{return route.fulfill({status:404,body:'Not found'})}
 }
 assert.equal(u.host,'shoot-sunday-sync-staging.yomax1979.workers.dev','never use production or another host');
 const body=route.request().postDataJSON();let data;
 if(u.pathname==='/events')data={events:[{event_id:E,name:'TEST',date:'2026-10-25'}]};
 else if(u.pathname==='/snapshot')data=snapshot();
 else if(u.pathname==='/staging/status')data={status:'idle'};
 else if(u.pathname==='/staging/preview')data={environment:'STAGING ONLY',plan:{action:'finish'},preview_token:'fake-preview'};
 else if(u.pathname==='/staging/execute'){
  writes++;const m=matches.find(m=>m.match_id===body.match_id);assert.equal(body.action,'finish');
  m.status='finished';m.winner=body.winner;
  if(m.seq<=2){const side=m.seq===1?'left_team':'right_team';
   matches[2][side]=m.right_team;matches[3][side]=m.left_team;
   for(const n of matches.slice(2))if(n.left_team&&n.right_team)n.status='scheduled';
  }
  data={environment:'STAGING ONLY',operation:'finish',write_sent:true,
   readback:{verified:true,status:'finished',left_score:m.left_score,right_score:m.right_score,winner:m.winner}};
 }else throw Error('Unexpected API '+u.pathname);
 await route.fulfill({json:structuredClone(data),headers:{'Access-Control-Allow-Origin':'*'}});
});
await page.addInitScript(()=>{
 const file={name:'IMG_0289.MOV',size:1234,lastModified:1000};
 localStorage.setItem('peakstamp_current_video_project_v1',JSON.stringify({version:1,projectId:'test-project',files:[file],updatedAt:1000}));
 localStorage.setItem('peakstamp_confirmed_goals_v1:IMG_0289.MOV::1234::1000',JSON.stringify({source:file,items:[{
  id:'third-goal',origin:'manual',status:'confirmed',timeSeconds:238,goalTimeSeconds:238,
  scorer:'西村',assistStatus:'named',assist:'徳永',matchSeq:3
 }]}));
});
try{
 await page.goto('http://peakstamp.local/');
 await page.selectOption('#ssEnvironment','staging');await page.fill('#ssBridgeToken','mock-token');
 await page.click('#ssLoadEvents');await page.click('#ssLoadSnapshot');
 await page.locator('#finishPanel').waitFor({state:'visible'});
 assert.match(await page.locator('#flowGuide').innerText(),/スコアを確認して試合を終了/);
 assert.match(await page.locator('#quickGoals').innerText(),/対戦待ち/);
 // Detailed editing is never a dead end: fixed footer + inline top/bottom exits.
 await page.locator('#quickPanel details.help summary').click();
 await page.click('#quickEdit');
 assert.equal(await page.locator('#reviewArea').isVisible(),true);
 assert.equal(await page.locator('#detailReturnBar').isVisible(),true);
 await page.click('#quickBackFixed');
 assert.equal(await page.locator('#reviewArea').isVisible(),false);
 assert.equal(await page.locator('#detailReturnBar').isVisible(),false);
 await page.click('#quickEdit');
 await page.click('#quickBackBottom');
 assert.equal(await page.locator('#reviewArea').isVisible(),false);
 for(const seq of ['1','2']){
  await page.selectOption('#finishMatch',seq);
  assert.equal(await page.locator('#finishWinnerWrap').isVisible(),false);
  await page.click('#finishPreview');
  await page.locator('#finishConfirm').waitFor({state:'visible'});
  // Human approves only once after seeing the signed TEST preview: no extra checkbox.
  assert.equal(await page.locator('#finishExecute').isEnabled(),true);
  assert.equal(await page.locator('#finishApproved').count(),0);
  await page.click('#finishExecute');
  await page.waitForFunction(()=>document.getElementById('finishStatus').textContent.startsWith('✓'));
 }
 assert.equal(writes,2);
 assert.match(await page.locator('#flowGuide').innerText(),/ゴール/);
 assert.match(await page.locator('#quickGoals').innerText(),/西村/);
 assert.match(await page.locator('#quickGoals').innerText(),/徳永/);
 assert.doesNotMatch(await page.locator('#quickGoals').innerText(),/対戦待ち・送信保留/);
 // A changed score invalidates confirmation without any result write.
 await page.selectOption('#finishMatch','3');
 // A tied TEST fixture asks for the winner; one-sided matches don't.
 assert.equal(await page.locator('#finishWinnerWrap').isVisible(),true);
 // This third-place goal is not yet registered: the finish preview must refuse.
 await page.click('#finishPreview');await page.waitForFunction(()=>document.getElementById('finishStatus').textContent.includes('未登録・要確認'));
 assert.equal(writes,2);assert.equal(await page.locator('#finishConfirm').isVisible(),false);
 await page.selectOption('#ssEnvironment','production');
 assert.equal(await page.locator('#finishPanel').isVisible(),false);
 assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS: mobile guided steps, persistent detail return, two-click finish, third-place goal preserved, pending-guard and production hidden');
}finally{await browser.close()}
