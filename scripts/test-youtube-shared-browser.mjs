// Real entry point at iPhone size. Every external request is mocked; no paid or SS writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const raw={duration_seconds:120,events:[{reaction_time_seconds:40,type:'goal_reaction',confidence:'high',quote:'ゴール',suggested_clip_start_seconds:32,suggested_clip_end_seconds:44},{reaction_time_seconds:80,type:'save_reaction',confidence:'high',quote:'ナイスキーパー',suggested_clip_start_seconds:72,suggested_clip_end_seconds:84}],utterances:[{kind:'match_start',time_seconds:0,quote:'チーム1対チーム2',team_a:'チーム1',team_b:'チーム2'},{kind:'goal_call',time_seconds:48,quote:'得点は選手1 アシストなし',scorer:'選手1',assist:'',assist_status:'none'}]};
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[],calls=[];page.setDefaultTimeout(15000);
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message)});
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());
  if(u.host==='peakstamp.local'){const path=u.pathname==='/'?'index.html':u.pathname.slice(1);try{return route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),contentType:path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript'})}catch{return route.fulfill({status:404,body:''})}}
  calls.push({host:u.host,path:u.pathname,method:req.method()});
  if(u.pathname==='/youtube/title')return route.fulfill({json:{title:'2026-11-15 第1試合 チーム1 vs チーム2'}});
  if(u.pathname==='/api/gemini-youtube'){assert.equal(req.headers()['x-peakstamp-access'],'mock-access');assert.equal(req.headers()['x-goog-api-key'],undefined);const body=req.postDataJSON();return route.fulfill({json:body.mode==='duration'?{duration:120}:raw})}
  if(u.pathname==='/iframe_api')return route.fulfill({body:'window.YT={Player:function(frame,opts){this.getCurrentTime=()=>32;this.getDuration=()=>120;this.getPlayerState=()=>2;this.seekTo=()=>{};this.playVideo=()=>{};this.pauseVideo=()=>{};this.destroy=()=>{};this.isMuted=()=>false;this.mute=()=>{};this.unMute=()=>{};setTimeout(()=>opts.events.onReady({target:this}),0)}};window.onYouTubeIframeAPIReady?.();',contentType:'text/javascript'});
  if(u.host==='www.youtube.com')return route.fulfill({body:'<html></html>',contentType:'text/html'});
  assert.equal(req.method(),'GET');return route.fulfill({status:404,json:{error:'mock unavailable'}});
 });
 await page.goto('https://peakstamp.local/?youtube=1');await page.locator('#yt-urls').waitFor();
 await page.screenshot({path:'/tmp/youtube-shared-before-analysis.png'});
 assert.equal(await page.getByText('Gemini APIキー',{exact:false}).isVisible(),false);
 assert.equal(await page.locator('#journeyNav').isVisible(),true);
 await page.locator('#yt-urls').fill('https://youtu.be/-sEOeqqTyuw');await page.getByRole('button',{name:'URLを登録',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('geminiMainBatch').disabled===false);
 await page.locator('#geminiMainBatch').click();await page.waitForFunction(()=>document.getElementById('geminiMainStatus').textContent.includes('アクセスコードを入力'));
 assert.equal(calls.filter(c=>c.path==='/api/gemini-youtube').length,0);
 await page.locator('#geminiMainAccess').fill('mock-access');await page.locator('#geminiMainAccess').dispatchEvent('change');await page.locator('#geminiMainConsent').check();await page.locator('#geminiMainBatch').click();
 await page.locator('#matchReview').waitFor({state:'visible'});await page.locator('#matchReview button[type=submit]').click();
 await page.locator('#journeyDialogPrimary').click();
 await page.locator('#goalStatsPanel').waitFor({state:'visible'});
 assert.equal(await page.locator('#goalStatsEditor').isVisible(),true);
 assert.match(await page.locator('#goalStatsEditor').innerText(),/選手1/);
 assert.equal(await page.locator('#ssInlinePreview').isVisible(),true);
 await page.screenshot({path:'/tmp/youtube-shared-goal-review.png'});
 await page.getByRole('button',{name:'動画を採用・次へ',exact:true}).click();
 if(await page.locator('#journeyDialogDismiss').isVisible())await page.locator('#journeyDialogDismiss').click();
 await page.locator('[data-journey-step="2"]').click();await page.locator('#montageExport').waitFor({state:'visible'});await page.locator('#montageExport').click();assert.match(await page.locator('#montageError').innerText(),/元動画/);
 // Cache reuse must not make another paid request.
 const paid=calls.filter(c=>c.path==='/api/gemini-youtube').length;assert.equal(paid,2);
 await page.locator('[data-journey-step="0"]').click();await page.locator('#geminiMainBatch').click();
 await page.locator('#matchReview').waitFor({state:'visible'});assert.equal(calls.filter(c=>c.path==='/api/gemini-youtube').length,paid);
 await page.reload();await page.locator('#yt-urls').waitFor();assert.equal(await page.locator('#geminiMainAccess').inputValue(),'mock-access');
 await page.locator('[data-journey-step="1"]').click();await page.locator('#goalStatsPanel').waitFor({state:'visible'});assert.equal(calls.filter(c=>c.path==='/api/gemini-youtube').length,paid);
 assert.deepEqual(errors,[]);
 assert.equal(calls.some(c=>c.host==='generativelanguage.googleapis.com'),false);
 console.log(JSON.stringify({pass:true,paidRequestsMocked:paid,sharedSteps:true,sharedGoalEditor:true,sharedRegistration:true,errors}));
 await page.close();
}finally{await browser.close()}
