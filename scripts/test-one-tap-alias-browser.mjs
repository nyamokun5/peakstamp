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
const matches=[1,2,3,4].map(seq=>({
 seq,match_id:'66666666-6666-4666-8666-66666666666'+seq,
 title:seq<3?'準決勝':seq===3?'3位決定戦':'決勝',
 status:'finished',winner:'left',left_team:seq===1?'チーム1':seq===2?'チーム3':'チーム1',
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
   return route.fulfill({json:{status:'matched',candidates:[{type:'member',name:'大成B',user_id:B}]},
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
    roster:{チーム1:['大成A'],チーム2:['大成B'],チーム3:['田中'],チーム4:['鈴木']},
    roster_players:[{name:'大成A',team:'チーム1',user_id:A,player_id:PLAYER_A,type:'member'},
     {name:'大成B',team:'チーム2',user_id:B,player_id:PLAYER_B,type:'member'}]};
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
 assert.deepEqual(writes,[],'render must not learn any nickname');
 // A finished fixture previously had only a goal-correction button.
 // The new action must work without modifying score, result, or a goal.
 assert.equal(await page.getByRole('button',{name:'「たいせい」を名寄せ登録'}).count(),1);
 assert.equal(await page.locator('.simple-match').first().getByText('保存済み').count(),1);
 await page.getByRole('button',{name:'「たいせい」を名寄せ登録'}).click();
 const menu=page.getByLabel('ゴール 1 scorer 別名の選手');
 assert.equal(await menu.count(),1);
 const choices=await menu.locator('option').allTextContents();
 assert.ok(choices.some(x=>x.includes('大成A　チーム1')));
 assert.ok(choices.some(x=>x.includes('大成B　チーム2')));
 assert.equal(writes.length,0,'opening and choosing cannot write');
 await menu.selectOption('大成A');
 assert.equal(writes.length,0,'must press 登録 explicitly');
 await page.locator('.simple-alias button').getByText('登録',{exact:true}).click();
 await page.locator('.simple-alias [role="status"]').getByText(/SSに登録しました/).waitFor();
 assert.deepEqual(reads,['resolve']);
 assert.equal(writes.length,1);
 assert.deepEqual(writes[0],{
  event_id:EVENT,member_id:A,name:'大成A',team:'チーム1',
  alias:'たいせい',source:'local-video',confirmed:true
 });
 assert.equal(matches[0].left_score,0,'alias learning never alters goal scores');
 assert.deepEqual(errors,[]);
 console.log('PASS finished-match one-tap alias: choose registered member; no goal/fixture write');
 await page.close();
}finally{await browser.close();}
