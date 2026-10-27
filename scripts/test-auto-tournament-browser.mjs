// End-to-end mobile regression with a fully intercepted TEST-only backend.
// Exercises 2 semifinals -> bracket advancement -> third-place video goal -> final tie choice.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const ids=[1,2,3,4].map(n=>`22222222-2222-4222-8222-22222222222${n}`);
const players={
 'チーム1':['山田'],'チーム2':['西村','徳永'],
 'チーム3':['田中'],'チーム4':['橋本']
};
const playerIds=Object.fromEntries(Object.values(players).flat().map((name,i)=>[name,`33333333-3333-4333-8333-33333333333${i+1}`]));
const matches=ids.map((match_id,i)=>({match_id,seq:i+1,title:i===2?'3位決定戦':i===3?'決勝':'準決勝',
 status:i<2?'scheduled':'waiting',
 left_team:i<2?'チーム'+(i*2+1):'',
 right_team:i<2?'チーム'+(i*2+2):'',
 left_score:i<2?1:0,right_score:0,winner:null,goals:[]}));
const snapshot=()=>({event_id:E,matches,roster:players});
const official=match=>({
 match_id:match.match_id,event_id:E,seq:match.seq,number:match.seq,status:match.status,
 left:{name:match.left_team,players:(players[match.left_team]||[]).map(name=>({name,player_id:playerIds[name]}))},
 right:{name:match.right_team,players:(players[match.right_team]||[]).map(name=>({name,player_id:playerIds[name]}))},
 goals:match.goals
});
let writes=0,goalWrites=0,finishWrites=0,previews=0;
const order=[];
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.host==='peakstamp.local'){
  const path=u.pathname==='/'?'sposched-review.html':u.pathname.slice(1);
  try{return await route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),contentType:path.endsWith('.html')?'text/html':'text/javascript'})}
  catch{return route.fulfill({status:404,body:'Not found'})}
 }
 assert.equal(u.host,'shoot-sunday-sync-staging.yomax1979.workers.dev','production bridge must never be reached');
 const body=route.request().postDataJSON(),method=route.request().method();
 let data;
 if(u.pathname==='/events')data={events:[{event_id:E,name:'TEST',date:'2026-10-25'}]};
 else if(u.pathname==='/snapshot')data=snapshot();
 else if(u.pathname==='/match'){
  const m=matches.find(m=>m.match_id===u.searchParams.get('match_id'));
  assert.ok(m,'match must exist');data=official(m);
 }
 else if(u.pathname==='/staging/status')data={status:'idle'};
 else if(u.pathname==='/staging/preview'){
  assert.equal(method,'POST');previews++;
  if(body.action==='create'){
   assert.equal(body.side,'left');assert.equal(body.match_id,ids[2]);
   data={environment:'STAGING ONLY',team_id:'dbb50f85-9d9a-408c-9482-497abbca399c',
    preview_token:'signed-fake-goal-token',
    plan:{action:'create',match_id:body.match_id,side:'left',before:null,
     after:{scorer:'西村',assist:'徳永'},title:'3位決定戦'}};
  }else{
   assert.equal(body.action,'finish');
   data={environment:'STAGING ONLY',preview_token:'signed-fake-finish-token',
    plan:{action:'finish'}};
  }
 }
 else if(u.pathname==='/staging/execute'){
  assert.equal(body.confirm,'TEST-ONLY WRITE');writes++;
  const m=matches.find(x=>x.match_id===body.match_id);assert.ok(m);
  if(body.action==='create'){
   goalWrites++;order.push('goal#'+m.seq);
   const goal_id='44444444-4444-4444-8444-444444444444';
   m.goals.push({goal_id,side:'left',scorer:'西村',assist:'徳永',team:'チーム2',own_goal:false});
   m.left_score+=1;
   data={environment:'STAGING ONLY',operation:'create',write_sent:true,
    readback:{verified:true,goal_id}};
  }else{
   assert.equal(body.action,'finish');finishWrites++;order.push('finish#'+m.seq);
   m.status='finished';m.winner=body.winner;
   if(m.seq<3){
    const side=m.seq===1?'left_team':'right_team';
    matches[2][side]=m.right_team;matches[3][side]=m.left_team;
    for(const n of matches.slice(2))if(n.left_team&&n.right_team)n.status='scheduled';
   }
   data={environment:'STAGING ONLY',operation:'finish',write_sent:true,
    readback:{verified:true,status:'finished',left_score:m.left_score,
     right_score:m.right_score,winner:m.winner}};
  }
 }else throw Error('Unexpected API '+u.pathname);
 await route.fulfill({json:structuredClone(data),headers:{'Access-Control-Allow-Origin':'*'}});
});
await page.addInitScript(()=>{
 const file={name:'IMG_0289.MOV',size:1234,lastModified:1000};
 localStorage.setItem('peakstamp_current_video_project_v1',JSON.stringify({
  version:1,projectId:'test-project',files:[file],updatedAt:1000}));
 localStorage.setItem('peakstamp_confirmed_goals_v1:IMG_0289.MOV::1234::1000',JSON.stringify({
  source:file,items:[{id:'third-goal',origin:'manual',status:'confirmed',timeSeconds:238,
   goalTimeSeconds:238,scorer:'西村',assistStatus:'named',assist:'徳永',matchSeq:3}]}));
});
try {
 await page.goto('http://peakstamp.local/');
 await page.selectOption('#ssEnvironment','staging');
 await page.fill('#ssBridgeToken','mock-token');
 await page.click('#ssLoadEvents');await page.click('#ssLoadSnapshot');
 assert.equal(await page.locator('#autoRun').isVisible(),true);
 assert.equal(await page.locator('#autoRun').isEnabled(),true);
 assert.equal(await page.locator('#quickPreview').isVisible(),false);
 assert.equal(writes,0);assert.equal(previews,0);
 // One approval auto-finishes both semis and the third-place game.
 await page.click('#autoRun');
 await page.waitForFunction(()=>document.getElementById('autoConflict').hidden===false);
 assert.match(await page.locator('#autoIssue').innerText(),/試合 #4/);
 assert.equal(await page.locator('#autoWinnerWrap').isVisible(),true);
 assert.equal(finishWrites,3);
 assert.equal(goalWrites,1);
 assert.deepEqual(order,['finish#1','finish#2','goal#3','finish#3']);
 assert.equal(await page.locator('#autoProgressBar').getAttribute('max'),'4');
 assert.match(await page.locator('#autoCount').innerText(),/3 \/ 4/);
 // Tie in the final is the only human input before the remaining result write.
 await page.selectOption('#autoWinner','right');
 await page.click('#autoResume');
 await page.waitForFunction(()=>document.getElementById('autoStage').textContent.includes('全4試合'));
 assert.equal(finishWrites,4);assert.equal(goalWrites,1);
 assert.equal(matches[3].winner,'right');
 assert.deepEqual(order,['finish#1','finish#2','goal#3','finish#3','finish#4']);
 assert.equal(await page.locator('#autoRun').isDisabled(),true);
 assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS: one approval -> two semifinal results -> official refresh -> third-place goal/result -> final tie winner; progress, no hidden duplicate confirmation, no production traffic');
}finally{await browser.close()}
