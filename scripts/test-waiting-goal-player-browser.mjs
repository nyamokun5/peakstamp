// Regression for the third-game iPhone selector. All requests are local files.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{
 for(const confirmed of [false,true]){
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   assert.equal(request.method(),'GET');assert.equal(url.host,'peakstamp.local');
   const path=url.pathname==='/'?'index.html':url.pathname.slice(1);
   let body=await readFile(new URL('../'+path,import.meta.url));
   if(path==='index.html')body=body.toString().replace(/<script type="module" src="(?:\.\/)?app\.mjs[^<]+<\/script>/,'');
   await route.fulfill({body,contentType:path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript'});
  });
  await page.goto('http://peakstamp.local/');
  await page.evaluate(async confirmed=>{
   const {initGoalStatsReview}=await import('/goal-stats-ui.mjs');
   const {saveVideoMatchup}=await import('/video-matchup.mjs');
   const id=n=>String(n).repeat(8)+'-1111-4111-8111-111111111111';
   const source={file:new File(['x'],'third.mov',{lastModified:1}),objectUrl:'blob:mock',duration:60,matchNumber:3,candidates:[]};
   const snapshot={environment:'production',eventId:id(1),rosterSource:'official-current-event-teams',
    matches:[{seq:3,matchId:'',status:'waiting',leftTeam:'',rightTeam:''}],
    players:['選手2','アシスト2','選手4','他チーム'],playerTeam:new Map([['選手2','チーム2'],['アシスト2','チーム2'],['選手4','チーム4'],['他チーム','チーム1']]),
    memberIds:new Map([['選手2',id(2)],['アシスト2',id(3)],['選手4',id(4)]]),playerIds:new Map([['選手2',id(2)],['アシスト2',id(3)],['選手4',id(4)]])};
   localStorage.setItem('peakstamp_confirmed_goals_v1:third.mov::1::1',JSON.stringify({items:[{id:'goal3',origin:'audio',timeSeconds:30,goalTimeSeconds:20,
    matchSeq:'3',teamA:'チーム2',teamB:'チーム4',scorer:'不明',rawScorer:'不明',assist:'',assistStatus:'named',status:'draft'}]}));
   if(confirmed)saveVideoMatchup(source,localStorage,'2','4');
   document.getElementById('geminiPrimaryPanel').hidden=false;
   const review=initGoalStatsReview({sources:[source],ssNameEnabled:true,ssNameEnvironment:'production',ssNameContext:{environment:'production',snapshot,aliases:[]}});
   review.refresh();
  },confirmed);
  const scorer=page.getByRole('combobox',{name:'得点者（ゴール）',exact:true});
  if(!confirmed){
   assert.equal(await scorer.isDisabled(),true);
   assert.match(await scorer.innerText(),/先に対戦カードを確認/);
   await page.getByRole('button',{name:'対戦カードを確認',exact:true}).click();
  }
  assert.equal(await scorer.isEnabled(),true);
  assert.deepEqual(await scorer.locator('option').evaluateAll(options=>options.map(x=>x.value)),['','選手2','アシスト2','選手4']);
  await scorer.selectOption('選手2');
  await page.getByRole('combobox',{name:'アシスト者',exact:true}).selectOption('アシスト2');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('peakstamp_confirmed_goals_v1:third.mov::1::1')).items[0]);
  assert.equal(saved.ssIdentity.scorer.name,'選手2');assert.equal(saved.ssIdentity.assist.name,'アシスト2');
  assert.equal(saved.ssIdentity.matchId,'');assert.deepEqual(errors,[]);
  await page.close();console.log('PASS third-game selectors: '+(confirmed?'confirmed video inherited':'explicit confirmation unlocks')+'; no SS requests');
 }
}finally{await browser.close();}
