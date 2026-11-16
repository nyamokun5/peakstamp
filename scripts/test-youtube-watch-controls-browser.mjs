// Exercise the shared viewer without contacting YouTube or saving any data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const clips=[{video:'abcdefghijk',match:'第1試合',start:10,end:15,label:'⚽ ゴール',scorer:'Alice',assist:''},
 {video:'lmnopqrstuv',match:'第2試合',start:20,end:25,label:'ハイライト',scorer:'',assist:''}];
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());assert.equal(req.method(),'GET');
  if(u.host==='shoot-sunday-sync.yomax1979.workers.dev')return route.fulfill({json:{clips}});
  if(u.href==='https://www.youtube.com/iframe_api')return route.fulfill({contentType:'text/javascript',body:`
   window.YT={PlayerState:{PLAYING:1},Player:class {
    constructor(id,options){
     window.mockPlayer=this;window.mockOptions=options.playerVars;this.events=options.events;this.state=2;this.time=options.playerVars.start;this.video=options.videoId;
     const frame=document.createElement('iframe');frame.title='mock YouTube';document.getElementById(id).replaceWith(frame);
     queueMicrotask(()=>this.events.onReady());
    }
    getVideoData(){return {video_id:this.video}} getPlayerState(){return this.state} getCurrentTime(){return this.time}
    seekTo(t){this.time=t} playVideo(){this.state=1;this.events.onStateChange({data:1})} pauseVideo(){this.state=2;this.events.onStateChange({data:2})}
    loadVideoById(v){this.video=v.videoId;this.time=v.startSeconds;this.playVideo()}
   }};window.onYouTubeIframeAPIReady();`});
  assert.equal(u.host,'peakstamp.local');
  const file=u.pathname.slice(1);
  return route.fulfill({body:await readFile(new URL('../'+file,import.meta.url)),contentType:file.endsWith('.html')?'text/html':'text/javascript'});
 });
 await page.goto('http://peakstamp.local/youtube-watch.html?id='+'a'.repeat(64));
 const play=page.locator('#play');await play.waitFor({state:'visible'});
 assert.deepEqual(await page.evaluate(()=>Object.fromEntries(['playsinline','controls','fs','disablekb'].map(k=>[k,window.mockOptions[k]]))),{playsinline:1,controls:0,fs:0,disablekb:1});
 await play.click();await page.waitForFunction(()=>document.getElementById('play').textContent.includes('一時停止'));
 await page.waitForTimeout(300);await play.click();
 assert.equal(await page.evaluate(()=>window.mockPlayer.state),2);assert.match(await play.textContent(),/続きから再生/);
 await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.mockPlayer.video),'abcdefghijk');
 await play.click();assert.equal(await page.evaluate(()=>window.mockPlayer.state),1);
 await page.evaluate(()=>{window.mockPlayer.time=15});
 await page.waitForFunction(()=>window.mockPlayer.video==='lmnopqrstuv');
 assert.equal(await page.evaluate(()=>window.mockPlayer.time),20);
 await page.waitForTimeout(300);await page.evaluate(()=>{window.mockPlayer.time=25});
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('終了しました'));
 assert.equal(await page.evaluate(()=>window.mockPlayer.state),2);
 await play.click();assert.equal(await page.evaluate(()=>window.mockPlayer.video),'abcdefghijk');assert.equal(await page.evaluate(()=>window.mockPlayer.time),10);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);console.log('Shared YouTube: inline control-free player, external pause/resume, timed scene advance and restart passed');
}finally{await browser.close();}
