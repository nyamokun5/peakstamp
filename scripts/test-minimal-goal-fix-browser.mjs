// Mobile UI test. All SS traffic is intercepted and mocked; no network writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildStagingReviewHtml} from './build-staging-site.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const M='22222222-2222-4222-8222-222222222222';
const G='33333333-3333-4333-8333-333333333333';
const A='44444444-4444-4444-8444-444444444444';
const T='55555555-5555-4555-8555-555555555555';
const X='66666666-6666-4666-8666-666666666666';
const fixtures=[1,2,3,4].map(seq=>({
 seq,match_id:seq===2?M:'77777777-7777-4777-8777-77777777777'+seq,
 title:seq<3?'準決勝':seq===3?'3位決定戦':'決勝',status:'finished',winner:seq===2?'left':'draw',
 left_team:seq===2?'チーム3':seq===3?'チーム2':'チーム1',
 right_team:seq===2||seq===3?'チーム4':'チーム3',
 left_score:0,right_score:0,goals:[]
}));
let previewCount=0,executeCount=0;
const officialMatch=()=>{
 const m=fixtures[1];
 const player=(player_id,name)=>({player_id,name});
 return {
  match_id:M,event_id:E,number:2,status:'finished',winner:m.winner,
  left:{name:'チーム3',score:m.left_score,players:[player(A,'芦川'),player(T,'達夫')],helpers:[]},
  right:{name:'チーム4',score:0,players:[player(X,'田中')],helpers:[]},
  goals:m.goals.map(g=>({goal_id:g.goal_id,side:'left',own_goal:false,
   scorer:player(A,'芦川'),assist:g.assist?player(T,'達夫'):null}))
 };
};
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
 if(u.host==='shoot-sunday-sync-staging.yomax1979.workers.dev'&&u.pathname==='/staging/alias/list'&&route.request().method()==='GET')
  return route.fulfill({json:{aliases:[]}});
  if(u.host==='peakstamp.local'){
   const path=u.pathname==='/'?'sposched-review.html':u.pathname.slice(1);
   if(path==='staging-production-disabled.mjs')
    return route.fulfill({body:'export function installProductionUI(){return {render(){},refresh(){}}}',contentType:'text/javascript'});
   let body=await readFile(new URL('../'+path,import.meta.url),'utf8');
   if(path==='sposched-review.html')body=buildStagingReviewHtml(body);
   return route.fulfill({body,contentType:path.endsWith('.html')?'text/html':'text/javascript'});
  }
  assert.equal(u.host,'shoot-sunday-sync-staging.yomax1979.workers.dev');
  const cors={'Access-Control-Allow-Origin':'*'};
  if(route.request().method()==='POST'){
   const data=route.request().postDataJSON();posts.push({path:u.pathname,data});
   if(u.pathname==='/staging/preview'){
    previewCount++;
    assert.equal(data.match_id,M);
    assert.equal(data.scorer_id,A);
    return route.fulfill({json:{
     environment:'STAGING ONLY',team_id:'dbb50f85-9d9a-408c-9482-497abbca399c',
     preview_token:'mock-signed-preview',
     plan:{action:data.action,match_id:M,side:'left',after:{scorer:'芦川',assist:data.assist_id?'達夫':null}}
    },headers:cors});
   }
   if(u.pathname==='/staging/execute'){
    executeCount++;
    assert.equal(data.preview_token,'mock-signed-preview');
    assert.equal(data.confirm,'TEST-ONLY WRITE');
    if(data.action==='create'){
     assert.equal(fixtures[1].goals.length,0);
     fixtures[1].goals.push({goal_id:G,team:'チーム3',scorer:'芦川',assist:'達夫'});
     fixtures[1].left_score=1;
    }else if(data.action==='patch'){
     assert.equal(data.goal_id,G);
     fixtures[1].goals[0].assist=null;
    }else throw Error('unexpected mutation '+data.action);
    return route.fulfill({json:{write_sent:true,
     readback:{verified:true,goal_id:G,status:'finished',left_score:1,right_score:0}
    },headers:cors});
   }
   throw Error('unexpected POST '+u.pathname);
  }
  if(u.pathname==='/match'){
   assert.equal(u.searchParams.get('match_id'),M);
   return route.fulfill({json:officialMatch(),headers:cors});
  }
  const data=u.pathname==='/events'?
   {events:[{event_id:E,name:'日曜定期',date:'2026-11-08'}]}:{
    event_id:E,matches:fixtures,
    roster_source:'official-current-event-teams',
    roster:{チーム1:['山田'],チーム2:['西村'],チーム3:['芦川','達夫'],チーム4:['田中']},
    roster_players:[{name:'芦川',team:'チーム3',player_id:A},
     {name:'達夫',team:'チーム3',player_id:T},{name:'田中',team:'チーム4',player_id:X}]
   };
  return route.fulfill({json:data,headers:cors});
 });
 await page.addInitScript(()=>{
  const file={name:'test.mov',size:1234,lastModified:1000};
  localStorage.setItem('peakstamp_current_video_project_v1',
   JSON.stringify({version:1,projectId:'fix-test',files:[file],updatedAt:1000}));
  localStorage.setItem('peakstamp_confirmed_goals_v1:test.mov::1234::1000',
   JSON.stringify({source:file,items:[{id:'goal',origin:'manual',
    status:'confirmed',timeSeconds:20,scorer:'芦川',assist:'達夫',
    assistStatus:'named',matchSeq:2}]}));
 });
 await page.goto('https://peakstamp.local/');
 await page.fill('#ssBridgeToken','mock-token');
 await page.click('#ssLoadEvents');await page.click('#ssLoadSnapshot');
 await page.locator('#simpleSaveArea').waitFor({state:'visible'});
 assert.equal(await page.getByRole('button',{name:'ゴールを修正'}).count(),1);
 await page.getByRole('button',{name:'ゴールを修正'}).click();
 assert.equal(await page.getByRole('dialog',{name:'ゴールを修正'}).count(),1);
 assert.equal(await page.getByLabel('修正 得点者').inputValue(),'芦川');
 assert.equal(await page.getByLabel('修正 アシスト').inputValue(),'達夫');
 assert.equal(await page.locator('#minimalGoalFix select').count(),2);
 assert.equal(await page.locator('#reviewArea').isVisible(),false,
  'old long edit form is not opened');
 assert.equal(posts.length,0,'merely opening correction must not write');
 await page.getByRole('dialog').getByRole('button',{name:'保存'}).click();
 await page.getByRole('dialog').getByRole('button',{name:'この内容で登録'}).waitFor();
 assert.equal(previewCount,1);assert.equal(executeCount,0);
 await page.getByRole('dialog').getByRole('button',{name:'この内容で登録'}).click();
 await page.waitForFunction(()=>document.querySelector('#minimalGoalFix')?.hidden);
 assert.equal(executeCount,1);
 assert.equal(fixtures[1].left_score,1);
 assert.equal(fixtures[1].goals.length,1);
 assert.equal(await page.locator('.simple-match').nth(1).getByRole('button',{name:'修正',exact:true}).count(),1);
 // Same compact sheet also patches an existing goal without adding a duplicate.
 await page.locator('.simple-match').nth(1).getByRole('button',{name:'修正',exact:true}).click();
 assert.equal(await page.getByLabel('修正 アシスト').inputValue(),'達夫');
 await page.getByLabel('修正 アシスト').selectOption('');
 await page.getByRole('dialog').getByRole('button',{name:'保存'}).click();
 await page.getByRole('dialog').getByRole('button',{name:'この内容で登録'}).click();
 await page.waitForFunction(()=>document.querySelector('#minimalGoalFix')?.hidden);
 assert.equal(executeCount,2);
 assert.equal(fixtures[1].left_score,1);
 assert.equal(fixtures[1].goals.length,1);
 assert.equal(fixtures[1].goals[0].assist,null);
 assert.deepEqual(posts.filter(x=>x.path==='/staging/execute').map(x=>x.data.action),['create','patch']);
 assert.equal(posts.some(x=>x.path.startsWith('/staging/batch/')),false,'must not re-send all fixtures');
 assert.deepEqual(errors,[]);
 console.log('PASS minimal goal fix mobile: add + patch + official readback');
 await page.close();
}finally{await browser.close()}
