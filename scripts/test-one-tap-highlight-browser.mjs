import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const folder=await mkdtemp(join(tmpdir(),'peakstamp-one-tap-'));
// The Playwright Chromium bundled on Linux has no H.264 decoder.
const checkExport=Boolean(process.env.MEDIABUNNY_MODULE);
const extension=checkExport?'mp4':'webm';
const fixtureName='phone.'+extension;
const fixturePath=join(folder,fixtureName);
const codecs=checkExport
  ? ['-c:v','libx264','-c:a','aac','-movflags','+faststart']
  : ['-c:v','libvpx-vp9','-c:a','libopus'];
let fixture;
try {
  execFileSync('ffmpeg',[
    '-v','error','-f','lavfi','-i','color=c=blue:s=160x90:r=10:d=24',
    '-f','lavfi','-i','sine=frequency=440:duration=24','-pix_fmt','yuv420p',
    ...codecs,fixturePath
  ]);
  fixture=await readFile(fixturePath);
} finally {
  await rm(folder,{recursive:true,force:true});
}
const browser=await chromium.launch({
  headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})
});
try {
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    assert.equal(route.request().method(),'GET');
    if(url.hostname==='cdn.jsdelivr.net'&&process.env.MEDIABUNNY_MODULE){
      await route.fulfill({path:process.env.MEDIABUNNY_MODULE,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}});
      return;
    }
    assert.equal(url.hostname,'peakstamp.local');
    const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
    let body=await readFile(new URL('../'+file,import.meta.url));
    if(file==='app.mjs')body=body.toString()+'\nwindow.fixture={state,buildMultiClipPlan,commitGeminiResults};';
    await route.fulfill({body,contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
  });
  await page.goto('https://peakstamp.local/');
  await page.waitForFunction(()=>window.fixture);
  const accept=page.getByRole('button',{name:'採用',exact:true});
  assert.equal(await accept.isVisible(),false);
  await page.locator('#fileInput').setInputFiles({name:fixtureName,mimeType:'video/'+extension,buffer:fixture});
  await page.locator('#loadPreview').click();
  await page.waitForFunction(()=>!document.querySelector('#acceptHighlight').disabled||
    document.querySelector('#preview').error);
  assert.ok(await accept.isEnabled(),'fixture video must finish loading');
  assert.ok((await accept.boundingBox()).height>=44);

  const seek=seconds=>page.locator('#preview').evaluate(async(video,at)=>{
    video.currentTime=at;
    if(video.seeking)await new Promise(resolve=>video.addEventListener('seeked',resolve,{once:true}));
  },seconds);
  const clips=()=>page.evaluate(()=>window.fixture.state.sources[0].candidates);
  await seek(12);
  await page.locator('#preview').evaluate(video=>video.play());
  await accept.tap();
  const first=(await clips())[0];
  assert.ok(first.peakSeconds>=12);
  assert.equal(first.time,first.peakSeconds-10);
  assert.equal(first.manualEnd,first.peakSeconds+5);
  await page.waitForFunction(at=>{
    const video=document.querySelector('#preview');
    return !video.paused&&video.currentTime>at+.25;
  },first.peakSeconds);
  assert.equal(await page.locator('#acceptHighlightStatus').textContent(),'採用しました');

  const duration=await page.locator('#preview').evaluate(video=>{video.pause();return video.duration;});
  await seek(0);
  await accept.tap();
  await accept.tap();
  await seek(duration);
  await accept.tap();
  const added=await clips();
  assert.equal(added.length,4);
  assert.deepEqual(added.slice(1,3).map(item=>[item.time,item.manualEnd]),[[0,5],[0,5]]);
  assert.equal(added[3].manualEnd,duration);
  assert.equal(new Set(added.map(item=>item.id)).size,4);
  assert.ok(added.every(item=>item.sourceId===first.sourceId));
  assert.equal(await page.locator('#preview').evaluate(video=>video.currentTime),duration);

  await page.locator('[data-journey-step="1"]').click();
  assert.equal(await page.locator('#highlightList .highlight-entry').count(),4);
  const firstRow=page.locator(`[data-scene-id="${first.id}"]`);
  await firstRow.getByLabel('切り取り終了時刻').evaluate(input=>{
    input.value='00:16.0';
    input.dispatchEvent(new Event('change'));
  });
  assert.equal((await clips())[0].manualEnd,16);
  assert.ok(await page.evaluate(()=>window.fixture.buildMultiClipPlan(window.fixture.state.sources).length));
  await page.locator('[data-journey-step="2"]').click();
  assert.ok(await page.locator('#montageExport').isEnabled());
  if(checkExport){
    await page.locator('[name=exportQuality][value=compact]').check();
    await page.locator('#montageExport').click();
    await page.waitForFunction(()=>!document.querySelector('#montageDownload').hidden||
      !document.querySelector('#montageError').hidden,{},{timeout:90_000});
    assert.equal(await page.locator('#montageError').isHidden(),true,await page.locator('#montageError').textContent());
    const result=await page.locator('#montageDownload').evaluate(async link=>{
      const bytes=await (await fetch(link.href)).arrayBuffer();
      return new TextDecoder().decode(bytes.slice(4,8));
    });
    assert.equal(result,'ftyp');
  }

  await page.evaluate(async duration=>{
    const {state,commitGeminiResults}=window.fixture;
    await commitGeminiResults({
      source:state.sources[0],audio:{durationSeconds:duration},
      decoded:{duration,bins:[{time:0,rms:0}]},
      parsed:{events:[{timeSeconds:12,type:'shot_reaction',quote:'ナイシュー'}]},batch:true
    });
  },duration);
  const afterAnalysis=await clips();
  assert.equal(afterAnalysis.filter(item=>item.origin==='gemini').length,1);
  assert.deepEqual(new Set(afterAnalysis.filter(item=>item.origin==='manual').map(item=>item.id)),new Set(added.map(item=>item.id)));
  assert.deepEqual(errors,[]);
  console.log('PASS one-tap highlight: mobile target, live playback, bounds, duplicate taps, editor and Gemini coexistence');
} finally {
  await browser.close();
}
