// Production UI acceptance with intercepted HTTP only: no live SpoSched writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const T='22222222-2222-4222-8222-222222222222';
const ids=[1,2,3,4].map(n=>'33333333-3333-4333-8333-33333333333'+n);
const snapshot={event_id:E,
 event:{date:'2026-11-01',name:'Sunday',status:'target'},
 matches:ids.map((match_id,i)=>({seq:i+1,match_id,
  status:i<2?'scheduled':'waiting',left_team:i<2?'Team '+(i*2+1):'',
  right_team:i<2?'Team '+(i*2+2):'',
  left_score:0,right_score:0,goals:[]})),
 roster:{'Team 1':['Taro Sato','Tatsuo Nishimura','A'],'Team 2':['B'],'Team 3':['C'],'Team 4':['D']}
};
let releaseReady=false,productionWrites=0,checks=0,otherReads=0;
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
// A locally confirmed Gemini audio goal exists in PeakStamp before SS is opened.
// Data remain browser-local; no Worker or SpoSched mutation is allowed here.
await page.addInitScript(()=>{
 const file={name:'MATCH_1.MOV',size:1234,lastModified:1769817600000};
 localStorage.setItem('peakstamp_current_video_project_v1',JSON.stringify({
  version:1,projectId:'test-goal-review',updatedAt:1769817600000,files:[file]
 }));
 localStorage.setItem('peakstamp_confirmed_goals_v1:MATCH_1.MOV::1234::1769817600000',
  JSON.stringify({version:1,source:file,items:[{
   id:'goal-1',origin:'audio',timeSeconds:25,goalTimeSeconds:22,
   quote:'佐藤さんゴール',scorer:'佐藤さん',assist:'',assistStatus:'none',
   matchSeq:'1',matchLabel:'チーム1対チーム2',teamA:'1',teamB:'2',
   status:'confirmed',confirmedAt:'2026-10-30T00:00:00Z'
  },{
   id:'goal-tatsuo',origin:'audio',timeSeconds:64,goalTimeSeconds:62,
   quote:'達夫さんゴール',scorer:'達夫',assist:'',assistStatus:'none',
   matchSeq:'1',matchLabel:'チーム1対チーム2',teamA:'1',teamB:'2',
   status:'confirmed',confirmedAt:'2026-10-30T00:00:00Z'
  }]}));
});
await page.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.host==='peakstamp.local'){
  const path=url.pathname==='/'?'sposched-review.html':url.pathname.slice(1);
  try{return route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),
   contentType:path.endsWith('.html')?'text/html':'text/javascript'})}
  catch{return route.fulfill({status:404,body:'Missing local asset '+path})}
 }
 assert.equal(url.host,'shoot-sunday-sync.yomax1979.workers.dev');
 if(route.request().method()!=='GET'){productionWrites++;throw Error('Unexpected production mutation');}
 let response;
 if(url.pathname==='/events')response={events:[{event_id:E,date:'2026-11-01',name:'Sunday',status:'target'}]};
 else if(url.pathname==='/snapshot')response=snapshot;
 else if(url.pathname==='/production/release-state'){
  checks++;response={environment:'PRODUCTION',event_id:E,release_ready:releaseReady};
 }else if(url.pathname==='/production/inspect'){
  response={environment:'PRODUCTION',mode:'read-only',event_id:E,
   team_pinned:true,team_id:T,event_date:'2026-11-01',write_allowed:false,
   release_approved:false,matches:ids.map((match_id,i)=>({
    seq:i+1,match_id,status:i<2?'scheduled':'waiting'}))};
 }else{otherReads++;throw Error('Unexpected read '+url.pathname);}
 return route.fulfill({json:response,headers:{'Access-Control-Allow-Origin':'*'}});
});
try{
 await page.goto('https://peakstamp.local/');
 await page.fill('#ssBridgeToken','production-bridge-mock-only');
 await page.click('#ssLoadEvents');
 await page.locator('#ssLoadSnapshot').waitFor({state:'visible'});
 await page.click('#ssLoadSnapshot');
 await page.locator('#productionPanel').waitFor({state:'visible'});
 await page.locator('#quickPanel').waitFor({state:'visible'});
 await page.locator('#quickGoals .quick-goal').first().waitFor({state:'visible'});
 const review=await page.locator('#quickGoals .quick-goal').first().innerText();
 assert.match(review,/AI提案/);
 assert.match(review,/SS登録予定（名簿照合）/);
 assert.match(review,/佐藤さん/);
 assert.match(review,/Taro Sato/,'official romanized scorer roster match must be visible in production');
 const tatsuoCard=page.locator('#quickGoals .quick-goal').filter({hasText:'Tatsuo Nishimura'});
 await tatsuoCard.waitFor({state:'visible'});
 const tatsuoReview=await tatsuoCard.innerText();
 assert.match(tatsuoReview,/達夫/,'AI original kanji name must remain visible');
 assert.match(tatsuoReview,/Tatsuo Nishimura/,'AI 達夫 must infer the official Tatsuo name in production UI');
 assert.equal(await page.locator('#quickProductionHelp').isVisible(),true);
 assert.equal(await page.locator('#quickTestHelp').isVisible(),false);
 assert.equal(await page.locator('#quickIndividualTestTools').isVisible(),false);
 assert.equal(await page.locator('#autoRegisterHeading').isVisible(),false);
 assert.equal(await page.locator('#reviewArea').isVisible(),false);
 assert.equal(await page.locator('#productionStart').isDisabled(),true);
 assert.equal(await page.locator('#workerBatchRun').isVisible(),false);
 await page.click('#productionCheck');
 await page.waitForFunction(()=>document.getElementById('productionPlan').textContent.includes('確認未完了'));
 assert.equal(await page.locator('#productionStart').isDisabled(),true);
 assert.equal(await page.locator('#productionApproveWrap').isVisible(),false);
 releaseReady=true;
 await page.click('#productionCheck');
 await page.locator('#productionApproveWrap').waitFor({state:'visible'});
 assert.equal(await page.locator('#productionStart').isDisabled(),true,
  'production release cannot start without direct operator confirmation');
 assert.ok(checks>=2);
 assert.equal(productionWrites,0);
 assert.equal(otherReads,0);
 assert.deepEqual(errors,[]);
 console.log('PASS: mobile production gate stays closed when disabled, requires fresh official GET and explicit approval; zero writes');
}finally{await browser.close()}
