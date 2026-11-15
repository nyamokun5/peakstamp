// Full in-page UI + real production transport, with every API response mocked.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{
 for(const scenario of ['success','lost-append','unconfirmed','official-guest']){
  const uncertain=scenario==='lost-append',unconfirmed=scenario==='unconfirmed',guest=scenario==='official-guest';
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());assert.equal(u.host,'peakstamp.local');assert.equal(route.request().method(),'GET');
   const path=u.pathname==='/'?'index.html':u.pathname.slice(1);
   let body=await readFile(new URL('../'+path,import.meta.url));
   if(path==='index.html')body=body.toString().replace(/<script type="module" src="(?:\.\/)?app\.mjs[^<]+<\/script>/,'');
   await route.fulfill({body,contentType:path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript'});
  });
  await page.goto('https://peakstamp.local/');
  await page.evaluate(async({uncertain,unconfirmed,guest})=>{
   const {initAnalysisNames}=await import('/sposched-analysis-names.mjs');
   const {initGoalStatsReview}=await import('/goal-stats-ui.mjs');
   const {installProductionInline}=await import('/sposched-production-inline.mjs');
   const id=n=>String(n).repeat(8)+'-1111-4111-8111-111111111111';
   const E=id(9),T=id(8),ids=[1,2,3,4].map(id),pair=guest?[[1,2],[3,4],[2,3],[1,4]]:[[1,2],[3,4],[2,4],[1,3]];
   const playerName=n=>guest&&n===4?'公式_guest':'選手'+n;
   const scorerTeam=seq=>guest&&[2,4].includes(seq)?4:pair[seq-1][0];
   const raw={environment:'PRODUCTION',event_id:E,event:{name:'mock event',match_format:'4teams_1pitch'},roster_source:'official-current-event-teams',
    roster:Object.fromEntries([1,2,3,4].map(n=>['チーム'+n,[playerName(n)]])),
    roster_players:[1,2,3,4].map(n=>({name:playerName(n),team:'チーム'+n,player_id:id(n),
     user_id:guest&&n===4?null:id(n),type:guest&&n===4?'guest':'member'})),
    matches:ids.map((match_id,i)=>({seq:i+1,match_id:i<2?match_id:'',status:i<2?'scheduled':'waiting',
     left_team:i<2?'チーム'+pair[i][0]:'',right_team:i<2?'チーム'+pair[i][1]:'',left_score:0,right_score:0,goals:[]}))};
   let job=null;window.sends=[];window.apiCalls=[];window.holdInspection=true;
   const official=()=>({environment:'PRODUCTION',mode:'read-only',event_id:E,team_id:T,team_pinned:true,
    write_allowed:false,release_approved:false,event_date:'2026-11-15',matches:raw.matches});
   const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
   globalThis.fetch=async(url,options={})=>{
    const u=new URL(url);if(u.host!=='shoot-sunday-sync.yomax1979.workers.dev')throw Error('Wrong gateway');
    const path=u.pathname,body=options.body?JSON.parse(options.body):null;window.apiCalls.push(path);
    if(path==='/events')return response({events:[{event_id:E,date:'2026-11-15',name:'mock event'}]});
    if(path==='/snapshot')return response(structuredClone(raw));
    if(path==='/production/alias/list')return response({aliases:[]});
    if(path==='/production/inspect')return response(official());
    if(path==='/production/release-state')return response({environment:'PRODUCTION',event_id:E,target_event_id:E,scope:'current-target',release_ready:true});
    if(path==='/production/batch/inspect'){
     if(window.holdInspection){window.holdInspection=false;await new Promise(resolve=>window.releaseInspection=resolve);}
     return job?response(structuredClone(job)):response({error:{code:'not_found'}},404);
    }
    if(!['/production/batch/start','/production/batch/append-second-round'].includes(path))throw Error('Unexpected route '+path);
    window.sends.push({path,body});
    if(path.endsWith('/append-second-round')&&uncertain)throw Error('mock lost reply');
    const seqs=path.endsWith('/start')?[1,2]:[3,4];
    for(const seq of seqs){
     const m=raw.matches[seq-1];m.status='finished';m.match_id=ids[seq-1];
     m.left_team='チーム'+pair[seq-1][0];m.right_team='チーム'+pair[seq-1][1];
     m.left_score=scorerTeam(seq)===pair[seq-1][0]?1:0;m.right_score=1-m.left_score;
     m.goals=[{goal_id:id(seq+4),scorer:playerName(scorerTeam(seq)),assist:'',team:'チーム'+scorerTeam(seq)}];
    }
    if(path.endsWith('/start'))for(const seq of [3,4])Object.assign(raw.matches[seq-1],{
     match_id:ids[seq-1],status:'scheduled',left_team:'チーム'+pair[seq-1][0],right_team:'チーム'+pair[seq-1][1]});
    const total=path.endsWith('/start')?4:8;
    job={environment:'PRODUCTION',event_id:E,request_id:body.request_id,layout_mode:'four-knockout-staged-v1',
     inspection_only:true,inspection_contract:'event-inspect-v1',scope:'event',execution_active:false,
     status:path.endsWith('/start')?'awaiting_second_round':'completed',phase:'preparing',cursor:total,total,completed:total,
     fixture_ids:Object.fromEntries((path.endsWith('/start')?[1,2]:[1,2,3,4]).map(n=>[n,ids[n-1]])),goal_receipts:[]};
    return response(structuredClone(job));
   };
   const sources=[1,2,3,4].map(seq=>{
    const file=new File(['x'],'game'+seq+'.mov',{lastModified:1});
    const source={id:'s'+seq,file,objectUrl:'blob:mock'+seq,duration:60,matchNumber:seq,candidates:[]};
    const scorer=unconfirmed&&seq===1?'未確認の呼び名':playerName(scorerTeam(seq));
    localStorage.setItem('peakstamp_confirmed_goals_v1:'+file.name+'::1::1',JSON.stringify({items:[{
     id:'g'+seq,origin:'audio',timeSeconds:30,goalTimeSeconds:20,scorer,rawScorer:scorer,assist:'',assistStatus:'none',
     matchSeq:String(seq),teamA:'チーム'+pair[seq-1][0],teamB:'チーム'+pair[seq-1][1],matchupConfirmed:true,
     matchLabel:pair[seq-1].join(' vs '),status:unconfirmed&&seq===1?'draft':'confirmed',videoDecision:'kept'}]}));return source;
   });
   const state={sources};const review=initGoalStatsReview(state);
   const names=initAnalysisNames(state,{onChange:()=>review.refresh()});
   window.controller=installProductionInline({state,ssNames:names,goalReview:review,wait:async()=>{},maxChecks:5});
   document.getElementById('geminiPrimaryPanel').hidden=false;
   window.eventId=E;
  },{uncertain,unconfirmed,guest});
  await page.fill('#ssAnalysisToken','mock-only');await page.click('#ssAnalysisConnect');
  await page.selectOption('#ssAnalysisEvent',await page.evaluate(()=>window.eventId));
  await page.waitForFunction(()=>document.getElementById('ssAnalysisLabel').textContent.includes('mock event'));
  await page.click('#ssInlinePreview');
  if(unconfirmed){
   assert.equal(await page.locator('#ssInlineStatus').isVisible(),true);
   assert.match(await page.locator('#ssInlineStatus').innerText(),/未確定のゴールが1件/);
   assert.equal(await page.evaluate(()=>sends.length),0);
   assert.equal(await page.locator('#ssInlinePreview').isEnabled(),true);
   assert.deepEqual(errors,[]);await page.close();
   console.log('PASS unconfirmed goal error is visible beside registration button; no batch requests');continue;
  }
  await page.waitForFunction(()=>typeof window.releaseInspection==='function');
  assert.equal(await page.locator('#ssInlineStatus').isVisible(),true);
  assert.match(await page.locator('#ssInlineStatus').innerText(),/登録履歴を確認中/);
  assert.equal(await page.locator('#ssInlinePreview').innerText(),'確認中…');
  assert.equal(await page.locator('#ssInlinePreview').isDisabled(),true);
  assert.equal(await page.locator('#ssInlinePreview').getAttribute('aria-busy'),'true');
  assert.equal(await page.evaluate(()=>sends.length),0,'no mutation while initial inspection is pending');
  await page.evaluate(()=>window.releaseInspection());
  await page.waitForFunction(()=>!window.controller.isBusy());
  const status=await page.locator('#ssInlineStatus').innerText();
  assert.equal(await page.locator('#ssInlineStatus').isVisible(),true,'registration feedback must actually be visible on iPhone');
  assert.match(status,uncertain?/再送せず/:/登録完了/);
  assert.equal(await page.locator('#ssInlinePreview').innerText(),'ゴールをSSに登録');
  assert.equal(await page.locator('#ssInlinePreview').getAttribute('aria-busy'),null);
  assert.deepEqual(await page.evaluate(()=>sends.map(x=>x.path)),['/production/batch/start','/production/batch/append-second-round']);
  if(guest){
   const report=await page.evaluate(()=>({
    goal:JSON.parse(localStorage.getItem('peakstamp_confirmed_goals_v1:game4.mov::1::1')).items[0],
    later:sends[1].body.operations.find(op=>op.action==='create'&&op.seq===4),
    aliasWrites:apiCalls.filter(path=>path.endsWith('/alias/confirm')).length
   }));
   assert.equal(report.goal.ssIdentity.scorer.type,'guest');
   assert.equal(report.goal.ssIdentity.scorer.memberId,null);
   assert.equal(report.goal.ssIdentity.scorer.playerId,'44444444-1111-4111-8111-111111111111');
   assert.equal(report.later.scorer,'公式_guest');assert.equal(report.later.team,'チーム4');
   assert.equal(report.aliasWrites,0,'event guests must never be learned as member aliases');
  }
  await page.click('#ssInlinePreview');await page.waitForFunction(()=>!window.controller.isBusy());
  assert.equal(await page.evaluate(()=>sends.length),2,'second click must never replay a phase');
  assert.equal(await page.evaluate(()=>window.opener),null);assert.equal(page.url(),'https://peakstamp.local/');
  assert.deepEqual(errors,[]);await page.close();
  console.log('PASS one-click in-page production UI + transport + waiting roster export; scenario='+scenario+'; no navigation/replay');
 }
}finally{await browser.close();}
