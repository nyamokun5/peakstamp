// Shared local/YouTube display policy; no AI calls, writes or media playback.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{
 for(const youtube of [false,true]){
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());assert.equal(u.host,'peakstamp.local');assert.equal(route.request().method(),'GET');
   const file=u.pathname==='/'?'index.html':u.pathname.slice(1);
   let body=await readFile(new URL('../'+file,import.meta.url));
   if(file==='app.mjs')body=body.toString()+'\nwindow.__focus={state,syncSources,drawResults,workflow};';
   await route.fulfill({body,contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
  });
  await page.goto('http://peakstamp.local/'+(youtube?'?youtube=1':''));await page.waitForFunction(()=>window.__focus);if(youtube)await page.locator('#yt-urls').waitFor();
  await page.evaluate(youtube=>{
   const id='abcdefghijk';const make=(id,quote,extra={})=>({id,sourceId:'abcdefghijk',origin:'gemini',time:6,peakSeconds:10,manualEnd:null,title:'ナイスプレイ！',geminiType:'excited_reaction',geminiQuote:quote,enabled:false,rejected:false,...extra});
   const source={id,file:new File(['fixture'],'match.mov',{type:'video/quicktime',lastModified:1}),duration:100,matchNumber:1,
    ...(youtube?{youtubeId:id,analyzed:true,info:{}}:{bins:[{time:0,rms:.1,peak:.2}]}),
    candidates:[make('shot','ナイシュー'),make('low','いいボール'),make('edited','うまい',{highlightUserEdited:true}),make('kept','ナイス',{enabled:true}),make('goal','',{geminiType:'goal_reaction',title:'ゴール'}),make('title-only','',{geminiType:'shot_reaction',title:'惜しい！'})]};
   window.__focus.state.sources=[source];window.__focus.syncSources();window.__focus.workflow.setStage('edit',{scroll:false});window.__focus.drawResults();
  },youtube);
  const ids=()=>page.locator('#highlightList .highlight-entry').evaluateAll(es=>es.map(e=>e.dataset.sceneId));
  assert.deepEqual(await ids(),['shot','edited','goal']);assert.equal(await page.locator('#tabAllCount').textContent(),'3');assert.equal(await page.locator('#tabOtherCount').textContent(),'2');assert.equal(await page.locator('#resultCount').textContent(),'4');
  assert.equal(await page.locator('#selectedSummary .highlight-kind-label').textContent(),'その他');
  assert.equal(await page.locator('[data-scene-id=shot] .highlight-kind-label').textContent(),'ナイシュー');
  await page.locator('#tabOther').click();assert.deepEqual(await ids(),['low','title-only']);
  assert.equal(await page.locator('[data-scene-id=title-only] .highlight-kind-label').textContent(),'判定情報なし');
  await page.locator('#tabReviewed').click();assert.equal((await ids()).length,6);
  await page.locator('#tabKept').click();assert.deepEqual(await ids(),['kept']);
  assert.equal(await page.locator('#highlightList .highlight-kind-label').textContent(),'その他');
  if(process.env.HIGHLIGHT_LABEL_SCREENSHOT&&!youtube){await page.locator('#selectedSummary').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.HIGHLIGHT_LABEL_SCREENSHOT});}
  await page.locator('#tabAll').click();assert.deepEqual(await ids(),['shot','edited','goal']);
  assert.equal(await page.evaluate(()=>window.__focus.state.sources[0].candidates.length),6,'filter never deletes low candidates');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('PASS focused highlights: local/YouTube default, other/all/kept, counts, preserved edits and no writes');
}finally{await browser.close();}
