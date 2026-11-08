// Isolated mobile presentation regression. All requests are fulfilled locally;
// VP8/WebM avoids proprietary H.264 decoder differences in CI Chromium.
// test hooks are appended to the served module only, never shipped in the app.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=path.join(tmpdir(),'peakstamp-ui-fixture.webm');
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=640x360:d=20','-c:v','libvpx','-pix_fmt','yuv420p','-y',fixture]);
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{
 for(const viewport of [{width:375,height:667},{width:390,height:700},{width:430,height:740}]){
  const page=await browser.newPage({viewport,isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   assert.equal(u.host,'peakstamp.local','no external service calls permitted');
   const file=u.pathname==='/'?'index.html':u.pathname.slice(1);
   if(file==='fixture.webm')return route.fulfill({body:await readFile(fixture),contentType:'video/webm'});
   try{
    let body=await readFile(new URL('../'+file,import.meta.url),'utf8');
    if(file==='app.mjs')body+='\nwindow.__uiTest={state,syncSources,goalReview,workflow,coaching,analysisCompleted};';
    // Replace only the encoder in this UI test. Capture the actual arguments
    // and settle each attempt explicitly, including after a visibility change.
    if(file==='exporter.mjs')body=body.replace('export async function exportMontage(', 'async function realExportMontage(')+
      '\nexport async function exportMontage(options){window.attempts.push(options);return new Promise((resolve,reject)=>{window.finishExport=()=>resolve(new Blob([new Uint8Array(2048)],{type:"video/mp4"}));window.failExport=()=>reject(Error("encoder stopped"));});}';
    await route.fulfill({body,contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
   }catch{return route.fulfill({status:404,body:'Not found'})}
  });
  await page.goto('http://peakstamp.local/');
  await page.waitForFunction(()=>window.__uiTest);
  assert.equal(await page.locator('#firstRunOverlay').isVisible(),false);
  await page.evaluate(async()=>{
   const {state,syncSources,workflow}=window.__uiTest;
   const blob=await(await fetch('/fixture.webm')).blob();
   const file=new File([blob],'TEST.webm',{type:'video/webm',lastModified:1});
   const source={id:'fixture',file,objectUrl:URL.createObjectURL(file),duration:20,matchNumber:1,
    bins:Array.from({length:80},()=>({rms:.1,peak:.2})),
    candidates:[{id:'highlight',sourceId:'fixture',time:4,peakSeconds:8,manualEnd:12,db:-20,title:'シュート'}]};
   localStorage.setItem('peakstamp_callout_pilot_v2:TEST.webm::'+file.size+'::1::whole',JSON.stringify({utterances:[
    {kind:'match_start',time_seconds:0,match_label:'1 vs 2'},
    {kind:'goal_call',time_seconds:15,scorer:'西村',assist:'田中',quote:'西村ゴール'}]}));
   state.sources=[source];syncSources();workflow.setStage('edit',{scroll:false});
  });
  await page.evaluate(()=>window.__uiTest.analysisCompleted({success:true}));
  await page.locator('#matchReview input').first().fill('赤');
  await page.locator('#matchReview input').nth(1).fill('青');
  await page.click('#matchReview button');
  await page.click('#journeyDialogPrimary');
  assert.match(await page.locator('.goal-match-card').first().textContent(),/赤 対 青/);
  await page.evaluate(()=>{
   window.__goalFrames=0;
   const v=document.querySelector('#goalStatsPreview');
   const tick=()=>{window.__goalFrames++;v.requestVideoFrameCallback(tick)};
   v.requestVideoFrameCallback(tick);
  });
  await page.click('.goal-scene-replay');
  await page.waitForFunction(()=>{const v=document.querySelector('#goalStatsPreview');return !v.paused && v.currentTime>10.5 && v.readyState>=2 && window.__goalFrames>=2;});
  await page.click('#goalStatsViewer .scene-pause-button');
  assert.equal(await page.locator('#goalStatsPreview').evaluate(v=>v.paused),true);
  await page.evaluate(()=>{window.__goalFrames=0});
  await page.click('.goal-scene-replay');
  await page.waitForFunction(()=>{const v=document.querySelector('#goalStatsPreview');return !v.paused && v.currentTime>10.5 && window.__goalFrames>=2;});
  const goalHeight=await page.evaluate(()=>{
   const a=document.querySelector('#goalStatsViewer').getBoundingClientRect();
   const b=document.querySelector('.goal-review-video-actions').getBoundingClientRect();
   return b.bottom-a.top;
  });
  assert.ok(goalHeight<=viewport.height-24,`goal controls ${goalHeight}px must fit ${viewport.height}px`);
  assert.equal(await page.locator('.goal-native-playback').isVisible(),false);
  assert.equal(await page.locator('#goalStatsViewer .range-legend').isVisible(),false);
  assert.equal(await page.locator('#goalStatsViewer .range-inputs').isVisible(),false);
  assert.equal(await page.locator('#goalStatsViewer .range-current').isVisible(),true);
  assert.ok(await page.locator('#goalStatsViewer .range-track').isVisible());
  await page.locator('#goalStatsViewer').scrollIntoViewIfNeeded();
  if(process.env.UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,`goals-${viewport.width}.png`)});
  await page.locator('#goalStatsViewer .exact-times summary').click();
  await page.locator('#goalStatsViewer .range-time').first().fill('00:03.0');
  await page.locator('#goalStatsViewer .range-time').first().press('Tab');
  assert.equal(await page.locator('#goalStatsViewer .range-time').first().inputValue(),'00:03.0');
  await page.locator('#goalStatsViewer .exact-times summary').click();
  await page.click('.goal-review-confirm');
  await page.evaluate(()=>{
   const source=window.__uiTest.state.sources[0];
   source.candidates.push({id:'next-highlight',sourceId:source.id,time:1,peakSeconds:2,manualEnd:4,title:'シュート'});
  });
  await page.click('.goal-review-video-keep');
  await page.waitForFunction(()=>document.querySelector('.highlight-entry.preview-active video')?.readyState>=2);
  const highlightHeight=await page.locator('.highlight-entry.preview-active').evaluate(e=>e.getBoundingClientRect().height);
  assert.ok(highlightHeight<=viewport.height-24,`highlight controls ${highlightHeight}px must fit ${viewport.height}px`);
  await page.locator('.highlight-entry.preview-active').scrollIntoViewIfNeeded();
  if(process.env.UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,`highlights-${viewport.width}.png`)});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
  // Reproduce a completed review: Keep must advance, not return to empty pending.
  await page.evaluate(()=>{
   const t=window.__uiTest,src=t.state.sources[0];
   src.candidates=Array.from({length:3},(_,i)=>({id:'revisit-'+i,sourceId:src.id,time:1+i*3,peakSeconds:2+i*3,manualEnd:3+i*3,enabled:true,title:'シュート'}));
   t.syncSources();
  });
  for(const tab of ['#tabKept','#tabReviewed']){
   await page.click(tab);
   await page.locator('#highlightList .play-btn').first().click();
   for(let i=0;i<3;i++){
    assert.equal(await page.locator('.highlight-entry.preview-active').getAttribute('data-scene-id'),'revisit-'+i);
    await page.locator('.highlight-entry.preview-active .review-keep').click();
    if(i<2)assert.equal(await page.locator('#journeyDialog').isVisible(),false);
   }
   assert.equal(await page.locator('#journeyDialog').isVisible(),true);
   await page.click('#journeyDialogSecondary');
   assert.equal(await page.locator('.highlight-entry.preview-active').getAttribute('data-scene-id'),'revisit-0');
  }
  if(viewport.width===375){
   await page.evaluate(()=>{
    window.__uiTest.workflow.setStage('export',{scroll:false});
    window.attempts=[];window.shared=[];window.releases=0;
    Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:async()=>Object.assign(new EventTarget(),{release:async()=>{window.releases++}})}});
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{window.shared.push(files[0])}});
   });
   const start=page.locator('#montageExport');
   await start.click();
   assert.equal(await start.isDisabled(),true);
   await page.evaluate(()=>window.finishExport());
   await page.click('#journeyDialogDismiss');
   await start.click();await start.click();
   assert.deepEqual(await page.evaluate(()=>[attempts.length,shared.length,releases]),[1,2,1]);
   await page.click('#hsJsonShareFinal');
   assert.equal(await page.evaluate(async()=>JSON.parse(await shared.at(-1).text()).kind),'peakstamp-edit-transfer');
   await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));
   const downloadEvent=page.waitForEvent('download');
   await start.click();
   assert.match((await downloadEvent).suggestedFilename(),/\.mp4$/);
   assert.equal(await page.evaluate(()=>attempts.length),1);
   await page.locator('#montageTitle').fill('SECOND');
   assert.match(await start.textContent(),/変更を反映/);
   await start.click();
   await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document,'hidden',{configurable:true,value:false});
    document.dispatchEvent(new Event('visibilitychange'));
    attempts.at(-1).onProgress('処理中',40);
   });
   assert.equal(await page.locator('#montagePercent').textContent(),'40%');
   await page.evaluate(()=>window.failExport());
   assert.match(await start.textContent(),/もう一度/);
   assert.match(await page.locator('#montageError').textContent(),/中断/);
   await start.click();
   assert.deepEqual(await page.evaluate(()=>attempts.map(x=>x.title)),['GOALS!','SECOND','SECOND']);
   await page.evaluate(()=>window.finishExport());
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS ${viewport.width}x${viewport.height}: goals ${Math.round(goalHeight)}px, highlights ${Math.round(highlightHeight)}px; trim, confirm and review-again`);
  await page.close();
 }
}finally{await browser.close()}
