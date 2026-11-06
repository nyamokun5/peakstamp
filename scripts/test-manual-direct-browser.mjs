// Reuse the isolated Playwright network-routing pattern from test-helper-browser.
// Every API response is local; no request reaches a real Worker or SpoSched.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111',M='22222222-2222-4222-8222-222222222222';
const P='33333333-3333-4333-8333-333333333333',Q='44444444-4444-4444-8444-444444444444';
try{for(const fromVideo of [false,true]){
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[],dialogs=[];let writes=0,previews=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.dismiss()});
 const goals=()=>writes?[{goal_id:'55555555-5555-4555-8555-555555555555',scorer:'Alice',team:'Team1',assist:null}]:[];
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url()),method=route.request().method();
  if(u.hostname==='peakstamp.local'){
   const path=u.pathname==='/'?'sposched-review.html':u.pathname.slice(1);
   try{return route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),contentType:path.endsWith('.html')?'text/html':'text/javascript'})}
   catch{return route.fulfill({status:404,body:'No test source'})}
  }
  assert.equal(u.hostname,'shoot-sunday-sync-staging.yomax1979.workers.dev');
  let data;
  if(u.pathname==='/events')data={events:[{event_id:E,name:'Manual TEST',date:'2026-11-06'}]};
  else if(u.pathname==='/snapshot')data={event_id:E,roster:{Team1:['Alice'],Team2:['Bob']},matches:[{seq:1,match_id:M,status:'scheduled',left_team:'Team1',right_team:'Team2',left_score:writes,right_score:0,goals:goals()}]};
  else if(u.pathname==='/match')data={match_id:M,event_id:E,status:'scheduled',goals:goals(),left:{name:'Team1',players:[{name:'Alice',player_id:P}],helpers:[]},right:{name:'Team2',players:[{name:'Bob',player_id:Q}],helpers:[]}};
  else if(u.pathname==='/staging/preview'){
   assert.equal(method,'POST');previews++;const a=route.request().postDataJSON();
   assert.equal(a.action,'create');assert.equal(a.match_id,M);assert.equal(a.scorer_id,P);
   data={environment:'STAGING ONLY',team_id:'dbb50f85-9d9a-408c-9482-497abbca399c',preview_token:'mock-only',plan:{action:'create',match_id:M,side:'left',after:{scorer:'Alice',assist:null},before:null}};
  }else if(u.pathname==='/staging/execute'){
   assert.equal(method,'POST');const a=route.request().postDataJSON();assert.equal(a.action,'create');assert.equal(a.confirm,'TEST-ONLY WRITE');assert.equal(a.preview_token,'mock-only');writes++;
   data={write_sent:true,readback:{verified:true}};
  }else throw Error('Unexpected network '+method+' '+u.pathname);
  if(!u.pathname.startsWith('/staging/'))assert.equal(method,'GET');
  await route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}});
 });
 if(fromVideo)await page.addInitScript(()=>{
  const source={name:'part1.mov',size:100,lastModified:1};
  localStorage.setItem('peakstamp_current_video_project_v1',JSON.stringify({version:1,projectId:'manual-video',files:[source],updatedAt:1}));
  localStorage.setItem('peakstamp_confirmed_goals_v1:part1.mov::100::1',JSON.stringify({source,items:[{id:'manual-video-goal',origin:'manual',status:'confirmed',scorer:'Alice',assistStatus:'none',timeSeconds:12,goalTimeSeconds:12,matchSeq:1}]}));
 });
 await page.goto('https://peakstamp.local/');await page.selectOption('#ssEnvironment','staging');await page.fill('#ssBridgeToken','mock-only');await page.click('#ssLoadEvents');
 await page.waitForFunction(()=>document.querySelector('#ssEventSelect')?.options.length>0);await page.click('#ssLoadSnapshot');
 await page.locator('#quickPanel').waitFor();
 if(fromVideo){assert.match(await page.locator('#quickGoals').innerText(),/手動入力/);assert.doesNotMatch(await page.locator('#quickGoals .quick-compare-label').first().innerText(),/AI/);}
 await page.click('#quickEdit');
 if(!fromVideo){
  await page.click('#manualAddGoal');
  const row=page.locator('#review-goal-1');
  await row.getByLabel('得点者',{exact:true}).selectOption('Alice');
  await row.getByLabel('アシスト',{exact:true}).selectOption('none');
  await row.getByLabel('得点チーム',{exact:true}).selectOption('Team1');
 }
 await page.locator('[data-manual-register]').click();
 await page.waitForFunction(()=>document.querySelector('#manualAddStatus').textContent.includes('1ゴールを登録・照合'));
 assert.equal(writes,1);assert.equal(previews,1);assert.deepEqual(dialogs,[]);assert.deepEqual(errors,[]);
 console.log('PASS: iPhone manual '+(fromVideo?'video':'standalone')+' goal registers with one click, no finish, no live traffic');
 await page.close();
}}finally{await browser.close()}
