import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());requests.push({url:req.url(),method:req.method()});assert.equal(req.method(),'GET');
  if(url.host==='www.youtube.com'&&url.pathname==='/embed/abcdefghijk')return route.fulfill({contentType:'text/html',body:'<html><body>mock iframe</body></html>'});
  assert.equal(url.host,'peakstamp.local');
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
  let body=await readFile(new URL('../'+file,import.meta.url));
  if(file==='index.html')body=body.toString().replace(/<script type="module" src="(?:\.\/)?app\.mjs[^<]+<\/script>/,'');
  return route.fulfill({body,contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
 });
 await page.goto('http://peakstamp.local/');
 await page.evaluate(async()=>{
  const {initGoalStatsReview}=await import('/goal-stats-ui.mjs');
  const {confirmedGoalExport}=await import('/goal-stats.mjs');
  const id=n=>String(n).repeat(8)+'-1111-4111-8111-111111111111';
  const source={id:'abcdefghijk',youtubeId:'abcdefghijk',file:{name:'YouTube-abcdefghijk',size:0,lastModified:0},objectUrl:'https://www.youtube.com/watch?v=abcdefghijk',duration:60,matchNumber:3,candidates:[]};
  const ss={environment:'production',eventId:id(1),rosterSource:'official-current-event-teams',
   matches:[{seq:3,matchId:'',status:'waiting',leftTeam:'',rightTeam:''}],players:['Alice','Bob'],
   playerTeam:new Map([['Alice','チーム2'],['Bob','チーム4']]),memberIds:new Map([['Alice',id(2)],['Bob',id(4)]]),playerIds:new Map([['Alice',id(2)],['Bob',id(4)]])};
  localStorage.setItem('peakstamp_confirmed_goals_v1:YouTube-abcdefghijk::0::0',JSON.stringify({items:[{id:'goal3',origin:'audio',timeSeconds:30,goalTimeSeconds:20,
   matchSeq:'3',teamA:'チーム2',teamB:'チーム4',matchupConfirmed:true,scorer:'Alice',rawScorer:'Alice',assistStatus:'none',status:'draft'}]}));
  document.getElementById('geminiPrimaryPanel').hidden=false;
  const state={sources:[source],ssNameEnabled:true,ssNameEnvironment:'production',ssNameContext:{environment:'production',snapshot:ss,aliases:[]}};
  let time=0,mute=false;
  const loadYouTubeAPI=async()=>({Player:class{constructor(frame,{events}){
   const remote={getCurrentTime:()=>time,getDuration:()=>60,seekTo:value=>{time=value;},
    playVideo:()=>events.onStateChange({data:1}),pauseVideo:()=>events.onStateChange({data:2}),mute:()=>{mute=true;},unMute:()=>{mute=false;},destroy:()=>{}};
   window.ytMock={remote,seek:value=>{time=value;},isMuted:()=>mute};queueMicrotask(()=>events.onReady({target:remote}));return remote;
  }}});
  window.goalCallbacks={keep:0,reject:0,edit:0};
  const review=initGoalStatsReview(state,{loadYouTubeAPI,onKeepClip:()=>{window.goalCallbacks.keep++;return true;},onRejectClip:()=>{window.goalCallbacks.reject++;return true;},onClipEdit:()=>{window.goalCallbacks.edit++;}});
  window.youtubeTest={source,state,review,export:()=>confirmedGoalExport(state.sources,localStorage)};
 });
 await page.evaluate(()=>window.youtubeTest.review.openAt(window.youtubeTest.source,20));
 await page.waitForFunction(()=>document.getElementById('goalStatsPreview').readyState===4);
 assert.equal(await page.locator('#goalStatsViewer iframe').count(),1);
 assert.equal(await page.locator('#goalStatsPreview').evaluate(v=>v.currentTime),25);
 await page.locator('.goal-score-details').evaluate(el=>{el.open=true;});
 const scorer=page.getByRole('combobox',{name:'得点者（ゴール）',exact:true});
 assert.deepEqual(await scorer.locator('option').evaluateAll(options=>options.map(o=>o.value)),['','Alice','Bob']);
 await scorer.selectOption('Bob');
 // Pause before entering exact trim times, matching the normal edit flow.
 await page.locator('.goal-scene-playback .scene-pause-button').click();
 assert.equal(await page.locator('#goalStatsPreview').evaluate(video=>video.paused),true);
 await page.locator('.goal-scene-range .exact-times summary').click();
 await page.locator('.goal-scene-range .range-time').nth(0).fill('00:24');
 await page.locator('.goal-scene-range .range-time').nth(0).press('Tab');
 await page.locator('.goal-scene-range .range-time').nth(1).fill('00:33');
 await page.locator('.goal-scene-range .range-time').nth(1).press('Tab');
 await page.evaluate(()=>window.ytMock.seek(28));
 await page.locator('.goal-review-time-adjust summary').click();
 await page.getByRole('button',{name:'現在の再生位置をゴール時刻に設定'}).click();
 await page.getByRole('button',{name:'動画を採用・次へ',exact:true}).click();
 const result=await page.evaluate(()=>({data:window.youtubeTest.export(),callbacks:window.goalCallbacks,
  saved:JSON.parse(localStorage.getItem('peakstamp_confirmed_goals_v1:YouTube-abcdefghijk::0::0')).items[0]}));
 assert.equal(result.callbacks.keep,1);assert.equal(result.data.goals[0].scorer,'Bob');
 assert.equal(result.data.goals[0].ssIdentity.scorer.team,'チーム4');assert.equal(result.saved.goalTimeSeconds,28);
 assert.equal(result.saved.clipStartSeconds,24);assert.equal(result.saved.clipEndSeconds,33);
 await page.evaluate(()=>{
  const local={file:new File(['x'],'local.mov',{lastModified:1}),objectUrl:'blob:local',duration:60,matchNumber:1,candidates:[]};
  localStorage.setItem('peakstamp_confirmed_goals_v1:local.mov::1::1',JSON.stringify({items:[{id:'local1',origin:'audio',timeSeconds:20,goalTimeSeconds:10,scorer:'Alice',assistStatus:'none',status:'draft'}]}));
  window.youtubeTest.state.sources=[local];window.youtubeTest.review.refresh();
 });
 assert.equal(await page.locator('#goalStatsViewer iframe').count(),0);
 assert.equal(await page.locator('#goalStatsPreview').evaluate(video=>video.play===HTMLMediaElement.prototype.play),true);
 assert.equal(await page.locator('#goalStatsPreview').evaluate(video=>Object.getOwnPropertyDescriptor(video,'currentTime')),undefined);
 assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'));
 console.log('PASS shared YouTube goal editor: iframe replay, same roster, trim/time, Keep identity export, restore native media; no writes');
}finally{await browser.close();}
