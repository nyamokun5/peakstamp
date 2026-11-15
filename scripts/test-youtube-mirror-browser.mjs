// iPhone DOM + actual montage plan and share publisher; all HTTP mutations mocked.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());
 if(u.host==='peakstamp.local'){const file=u.pathname==='/'?'index.html':u.pathname.slice(1);let body=await readFile(new URL('../'+file,import.meta.url));if(file==='index.html')body=body.toString().replace(/<script type="module" src="(?:\.\/)?app\.mjs[^<]+<\/script>/,'');return route.fulfill({body,contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'})}
 if(u.host==='www.youtube.com'&&u.pathname==='/iframe_api')return route.fulfill({contentType:'text/javascript',body:`window.YT={PlayerState:{PLAYING:1},Player:function(id,opts){this.getVideoData=()=>({video_id:opts.videoId});this.getPlayerState=()=>2;this.seekTo=t=>window.lastSeek=t;this.playVideo=()=>{};this.loadVideoById=()=>{};this.pauseVideo=()=>{};setTimeout(()=>opts.events.onReady(),0);}};window.onYouTubeIframeAPIReady();`});
 throw Error('Mirror must not make external requests: '+u.pathname);
 });
 await page.goto('https://peakstamp.local/');await page.evaluate(async()=>{
 const {initYouTubeMirror}=await import('/youtube-mirror-ui.mjs');const {buildMultiClipPlan}=await import('/multi-plan.mjs');
 const source={id:'local1',file:new File(['x'],'match.mp4',{lastModified:1}),duration:90,matchNumber:1,bins:[{}],candidates:[{enabled:true,time:10.3,manualEnd:18.6,peakSeconds:14}]};
 const state={sources:[source]};document.getElementById('montagePanel').hidden=false;document.body.dataset.psStage='export';document.getElementById('geminiMainAccess').value='';
 localStorage.setItem('peakstamp-youtube-mirror-production-v1',JSON.stringify({urls:{},jobs:{old:{status:'pending',id:'a'.repeat(64)}}}));
 window.mirrorTest={source,ui:initYouTubeMirror(state,{getPlan:()=>buildMultiClipPlan(state.sources)})};});
 await page.locator('#youtubeMirror > summary').click();await page.locator('#youtubeMirror input[type=url]').fill('https://youtu.be/-sEOeqqTyuw');
 await page.locator('#youtubeMirrorCreate').click();assert.equal(writes.length,0);assert.match(await page.locator('#youtubeMirrorStatus').innerText(),/開始位置/);
 await page.locator('#youtubeMirror input[type=checkbox]').check();await page.locator('#youtubeMirrorCreate').click();await page.locator('#youtubeMirror a').waitFor({state:'visible'});
 const first=await page.locator('#youtubeMirror a').getAttribute('href');const parsed=await page.evaluate(async u=>(await import('/youtube-inline-share.mjs')).inlineShareClips(new URL(u).hash),first);assert.equal(parsed[0].start,10.3);assert.equal(parsed[0].end,18.6);assert.equal(writes.length,0);
 await page.locator('#youtubeMirrorCreate').click();assert.equal(await page.locator('#youtubeMirror a').getAttribute('href'),first);
 await page.evaluate(()=>{window.mirrorTest.source.candidates[0].manualEnd=21.2;window.mirrorTest.ui.refresh()});assert.equal(await page.locator('#youtubeMirror a').isVisible(),false);
 await page.locator('#youtubeMirrorCreate').click();await page.locator('#youtubeMirror a').waitFor({state:'visible'});const changed=await page.locator('#youtubeMirror a').getAttribute('href');assert.notEqual(changed,first);assert.equal((await page.evaluate(async u=>(await import('/youtube-inline-share.mjs')).inlineShareClips(new URL(u).hash),changed))[0].end,21.2);assert.equal(writes.length,0);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('peakstamp-youtube-mirror-production-v1')).jobs.old.status),'pending');
 await page.goto(changed);await page.locator('#play').waitFor({state:'visible'});await page.locator('#play').click();assert.equal(await page.evaluate(()=>window.lastSeek),10.3);assert.match(await page.locator('#status').innerText(),/1 \/ 1/);
 assert.deepEqual(errors,[]);console.log('PASS local montage → exact YouTube ranges, one click, inline link, edited range invalidation, legacy pending preserved; zero network writes');
}finally{await browser.close()}
