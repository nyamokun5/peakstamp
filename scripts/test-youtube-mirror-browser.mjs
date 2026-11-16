// Mobile UI + real short-share publisher/reader; all remote writes are mocked.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{for(const scenario of ['success','lost-response','prewrite-error']){
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(15000);const errors=[],writes=[],values=new Map();let reads=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());
  if(u.host==='peakstamp.local'){const file=u.pathname==='/'?'index.html':u.pathname.slice(1);let body=await readFile(new URL('../'+file,import.meta.url));if(file==='index.html')body=body.toString().replace(/<script type="module" src="(?:\.\/)?app\.mjs[^<]+<\/script>/,'');return route.fulfill({body,contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'})}
  if(u.host==='www.youtube.com'&&u.pathname==='/iframe_api')return route.fulfill({contentType:'text/javascript',body:`window.YT={PlayerState:{PLAYING:1},Player:function(id,o){this.getVideoData=()=>({video_id:o.videoId});this.getPlayerState=()=>2;this.seekTo=t=>window.lastSeek=t;this.playVideo=()=>{};this.pauseVideo=()=>{};setTimeout(()=>o.events.onReady(),0)}};window.onYouTubeIframeAPIReady();`});
  assert.equal(u.host,'shoot-sunday-sync.yomax1979.workers.dev');assert.equal(u.pathname,'/youtube/share');
  if(u.searchParams.has('capabilities'))return route.fulfill({json:{contract:'short-share-v2',environment:'PRODUCTION'}});
  if(r.method()==='GET'){reads++;const clips=values.get(u.searchParams.get('id'));return route.fulfill(clips?{json:{version:1,clips}}:{status:404,json:{error:'not found'}})}
  assert.equal(r.method(),'POST');assert.equal(r.headers()['x-peakstamp-access'],'mock-code');const clips=r.postDataJSON().clips;writes.push(clips);
  if(scenario==='prewrite-error'&&writes.length===1)return route.fulfill({status:503,json:{error:'保存前の接続失敗',write_state:'not_started'}});
  const id=createHash('sha256').update(r.headers()['x-edit-key']).digest('hex');values.set(id,clips);
  if(scenario==='lost-response'&&writes.length===1)return route.abort('failed');return route.fulfill({json:{id}});
 });
 await page.goto('https://peakstamp.local/');await page.evaluate(s=>window.shortScenario=s,scenario);await page.evaluate(async()=>{
  const {initYouTubeMirror}=await import('/youtube-mirror-ui.mjs'),{buildMultiClipPlan}=await import('/multi-plan.mjs'),{saveGoalDrafts}=await import('/goal-stats.mjs');
  const source={id:'local1',file:new File(['x'],'match.mp4',{lastModified:1}),duration:90,matchNumber:1,bins:[{}],candidates:[{enabled:true,time:10.3,manualEnd:18.6,peakSeconds:14},{enabled:true,time:40.1,manualEnd:49.8,peakSeconds:46}]};
  saveGoalDrafts(source,localStorage,[{id:'g1',origin:'manual',timeSeconds:14,goalTimeSeconds:14,scorer:'西村',assist:'高崎',assistStatus:'named',status:'confirmed'},{id:'g2',origin:'manual',timeSeconds:46,goalTimeSeconds:46,scorer:'東',assist:'山田',assistStatus:'named',status:'confirmed'}]);
  const state={sources:[source]};document.getElementById('montagePanel').hidden=false;document.body.dataset.psStage='export';document.getElementById('geminiMainAccess').value=window.shortScenario==='success'?'':'mock-code';
  localStorage.setItem('peakstamp-youtube-mirror-production-v1',JSON.stringify({urls:{},jobs:{old:{status:'pending',id:'a'.repeat(64)}}}));
  window.mirrorTest={source,ui:initYouTubeMirror(state,{getPlan:()=>buildMultiClipPlan(state.sources)})};
 });
 await page.locator('#youtubeMirror > summary').click();await page.locator('#youtubeMirror input[type=url]').fill('https://youtu.be/-sEOeqqTyuw');
 await page.locator('#youtubeMirrorCreate').click();assert.equal(writes.length,0);assert.match(await page.locator('#youtubeMirrorStatus').innerText(),/開始位置/);
 if(scenario==='success')await page.locator('#youtubeMirror input[type=password]').fill('mock-code');
 await page.locator('#youtubeMirror input[type=checkbox]').check();await page.locator('#youtubeMirrorCreate').click();
 if(scenario==='lost-response'){
  await page.waitForFunction(()=>document.getElementById('youtubeMirrorCreate').textContent==='結果を確認');assert.equal(await page.locator('#youtubeMirror a').isVisible(),false);assert.equal(writes.length,1);
  await page.locator('#youtubeMirrorCreate').click();
 }else if(scenario==='prewrite-error'){
  await page.waitForFunction(()=>document.getElementById('youtubeMirrorStatus').textContent.includes('保存前の接続失敗'));assert.equal(await page.locator('#youtubeMirror a').isVisible(),false);assert.equal(writes.length,1);
  await page.locator('#youtubeMirrorCreate').click();
 }
 await page.locator('#youtubeMirror a').waitFor({state:'visible'});const first=await page.locator('#youtubeMirror a').getAttribute('href');const url=new URL(first);assert.equal(url.hash,'');assert.match(url.searchParams.get('id'),/^[a-f0-9]{64}$/);assert.ok(first.length<150);
 assert.equal(writes[0][0].start,10.3);assert.equal(writes[0][0].end,18.6);assert.equal(writes[0][0].scorer,'西村');assert.equal(writes[0][0].assist,'高崎');
 const before=writes.length;await page.locator('#youtubeMirrorCreate').click();assert.equal(writes.length,before);if(scenario==='lost-response'){assert.equal(writes.length,1);assert.ok(reads>=1)}
 if(scenario==='success'){
  await page.evaluate(()=>{window.mirrorTest.source.candidates[0].manualEnd=21.2;window.mirrorTest.ui.refresh()});assert.equal(await page.locator('#youtubeMirror a').isVisible(),false);await page.locator('#youtubeMirrorCreate').click();await page.locator('#youtubeMirror a').waitFor({state:'visible'});assert.equal(writes.length,2);assert.equal(writes[1][0].end,21.2);
  const changed=await page.locator('#youtubeMirror a').getAttribute('href');assert.notEqual(changed,first);await page.goto(changed);await page.locator('#play').waitFor({state:'visible'});await page.locator('#play').click();assert.equal(await page.evaluate(()=>window.lastSeek),10.3);assert.match(await page.locator('#list').textContent(),/ゴール\(西村\)\/アシスト\(高崎\)/);await page.getByRole('button',{name:'山田',exact:true}).click();assert.equal(await page.evaluate(()=>window.lastSeek),40.1);
 }
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('peakstamp-youtube-mirror-production-v1')).jobs.old.status),'pending');assert.deepEqual(errors,[]);console.log('PASS short-link-only, '+scenario+', no fallback/replay, names and ranges preserved');await page.close();
}}finally{await browser.close()}
