// Human-only SS alias learning UI. All bridge HTTP is mocked; no SS writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildStagingReviewHtml} from './build-staging-site.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const EVENT='11111111-1111-4111-8111-111111111111';
const A='22222222-2222-4222-8222-222222222222';
const B='33333333-3333-4333-8333-333333333333';
const PLAYER_A='44444444-4444-4444-8444-444444444444';
const PLAYER_B='55555555-5555-4555-8555-555555555555';
const race=process.env.TEST_ALIAS_RACE==='1';
const matches=[1,2,3,4].map(seq=>({
 seq,match_id:'66666666-6666-4666-8666-66666666666'+seq,
 title:seq<3?'準決勝':seq===3?'3位決定戦':'決勝',
 status:'scheduled',left_team:seq===1?'チーム1':seq===2?'チーム3':'チーム1',
 right_team:seq===1?'チーム2':seq===2?'チーム4':'チーム2',
 left_score:0,right_score:0,goals:[]
}));
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[],writes=[],reads=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.host==='peakstamp.local'){
   const path=u.pathname==='/'?'sposched-review.html':u.pathname.slice(1);
   if(path==='staging-production-disabled.mjs')
    return route.fulfill({body:'export function installProductionUI(){return {render(){},refresh(){}}}',contentType:'text/javascript'});
   let body=await readFile(new URL('../'+path,import.meta.url),'utf8');
   if(path==='sposched-review.html')body=buildStagingReviewHtml(body);
   return route.fulfill({body,contentType:path.endsWith('.html')?'text/html':'text/javascript'});
  }
  assert.equal(u.host,'shoot-sunday-sync-staging.yomax1979.workers.dev');
  if(u.pathname==='/staging/alias/resolve'){
   assert.equal(route.request().method(),'GET');
   assert.equal(u.searchParams.get('query'),'たいせい');
   reads.push('resolve');
   if(race&&reads.length===1)await new Promise(resolve=>setTimeout(resolve,500));
   return route.fulfill({json:race?{status:'unknown',candidates:[]}:
    {status:'matched',candidates:[{type:'member',name:'大成B',user_id:B}]},
    headers:{'Access-Control-Allow-Origin':'*'}});
  }
  if(u.pathname==='/staging/alias/confirm'){
   assert.equal(route.request().method(),'POST');
   const body=route.request().postDataJSON();writes.push(body);
   return route.fulfill({json:{ok:true,saved:true,user_id:body.member_id,
    alias:body.alias,shared:true,created:true},
    headers:{'Access-Control-Allow-Origin':'*'}});
  }
  if(route.request().method()==='POST')
   throw Error('unexpected SS goal/fixture mutation: '+u.pathname);
  const data=u.pathname==='/events'?{events:[{event_id:EVENT,name:'日曜SS',date:'2026-11-08'}]}:
   {event_id:EVENT,matches,
    roster_source:'official-current-event-teams',
    roster:race?
     {チーム1:['大成A','大成B'],チーム2:[],チーム3:['田中'],チーム4:['鈴木']}:
     {チーム1:['大成A'],チーム2:['大成B'],チーム3:['田中'],チーム4:['鈴木']},
    roster_players:[{name:'大成A',team:'チーム1',user_id:A,player_id:PLAYER_A,type:'member'},
     {name:'大成B',team:race?'チーム1':'チーム2',user_id:B,player_id:PLAYER_B,type:'member'}]};
  return route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}});
 });
 await page.addInitScript(()=>{
  const file={name:'IMG_1000.mov',size:1234,lastModified:1000};
  localStorage.setItem('peakstamp_current_video_project_v1',
   JSON.stringify({version:1,projectId:'alias-test',files:[file],updatedAt:1000}));
  localStorage.setItem('peakstamp_confirmed_goals_v1:IMG_1000.mov::1234::1000',
   JSON.stringify({source:file,items:[{id:'goal-a',origin:'manual',status:'confirmed',
    timeSeconds:20,scorer:'たいせい',assistStatus:'none',matchSeq:1}]}));
 });
 await page.goto('https://peakstamp.local/');
 await page.fill('#ssBridgeToken','mock-token');
 await page.click('#ssLoadEvents');await page.click('#ssLoadSnapshot');
 await page.locator('#simpleSaveArea').waitFor({state:'visible'});
 assert.deepEqual(writes,[],'AI prefill/render must never write aliases');
 const scorer=page.getByLabel(/ゴール 1 得点者/);
 assert.equal(await scorer.count(),1);
 await scorer.selectOption('大成A');
 if(race){
  // Select the second member before the first slow alias lookup returns.
  // Never save the earlier name after the user chooses someone else.
  await page.getByLabel(/ゴール 1 得点者/).selectOption('大成B');
 }
 await page.waitForTimeout(race?900:500);
 assert.deepEqual(reads,race?['resolve','resolve']:['resolve']);
 assert.equal(writes.length,1,'only the final human choice may persist a nickname');
 assert.deepEqual(writes[0],race?{
  event_id:EVENT,member_id:B,name:'大成B',team:'チーム1',
  alias:'たいせい',source:'local-video',confirmed:true
 }:{
  event_id:EVENT,member_id:A,name:'大成A',team:'チーム1',
  alias:'たいせい',source:'local-video',confirmed:true
 });
 assert.deepEqual(errors,[]);
 console.log('PASS human alias learning: 1 explicit choice, 1 member-id verified write, 0 score writes');
 await page.close();
}finally{await browser.close();}
