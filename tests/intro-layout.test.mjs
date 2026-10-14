import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTRO_ANCHORS,INTRO_SECONDS,normalizeIntroPoint,introPreset,
  coverRect,overlayRect,imageDimensions,drawCover,drawIntroOverlay
} from '../intro-layout.mjs';
import { drawIntro } from '../exporter.mjs';

test('nine presets cover all three columns and rows with center default',()=>{
  assert.equal(INTRO_ANCHORS.length,9);
  assert.deepEqual(introPreset(4),{x:.5,y:.5});
  assert.deepEqual(introPreset(0),{x:.18,y:.18});
  assert.deepEqual(introPreset(8),{x:.82,y:.82});
  assert.deepEqual(introPreset(999),{x:.5,y:.5});
  assert.equal(INTRO_SECONDS,5);
});
test('pointer drags clamp inside the canvas and allow fractional free positioning',()=>{
  assert.deepEqual(normalizeIntroPoint({x:-.4,y:1.4}),{x:0,y:1});
  assert.deepEqual(normalizeIntroPoint({x:.37,y:.64}),{x:.37,y:.64});
  assert.deepEqual(normalizeIntroPoint(),{x:.5,y:.5});
});
test('cover crop preserves aspect ratio and fills widescreen from portrait image',()=>{
  assert.deepEqual(coverRect(1920,1080,1280,720),{x:0,y:0,width:1280,height:720});
  assert.deepEqual(coverRect(1080,1920,1280,720),{
    x:0,y:(720-1280*1920/1080)/2,width:1280,height:1280*1920/1080
  });
  assert.throws(()=>coverRect(0,200,640,360));
});
test('overlay preserves PNG aspect and stays inside the screen at all nine positions',()=>{
  for(let i=0;i<9;i++){
    const r=overlayRect(2000,400,1280,720,introPreset(i),.6);
    assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=1280+.001&&r.y+r.height<=720+.001);
    assert.ok(Math.abs(r.width/r.height-5)<1e-8);
  }
  const tall=overlayRect(300,1800,1280,720,{x:.9,y:.9},1);
  assert.ok(tall.height<=720*.9+.001);
  assert.ok(tall.x+tall.width<=1280+.001);
});
test('image sizes normalize browser image/video dimension naming',()=>{
  assert.deepEqual(imageDimensions({naturalWidth:640,naturalHeight:360}),{width:640,height:360});
  assert.deepEqual(imageDimensions({videoWidth:1080,videoHeight:1920}),{width:1080,height:1920});
});
test('background and PNG are painted in the correct order without duplicate text',()=>{
  const operations=[];
  const ctx={
    drawImage:(img,...rect)=>operations.push([img.id,...rect]),
    fillRect:()=>operations.push(['background']),
    createLinearGradient:()=>({addColorStop:()=>{}}),
    measureText:()=>({width:10}),
    fillText:()=>operations.push(['legacy-title'])
  };
  const background={id:'background-image',naturalWidth:1920,naturalHeight:1080};
  const overlay={id:'transparent-png',naturalWidth:800,naturalHeight:200};
  drawIntro(ctx,1280,720,'GOALS!',{
    backgroundImage:background,overlayImage:overlay,position:introPreset(2),overlayScale:.65
  });
  assert.deepEqual(operations.map(a=>a[0]),['background-image','transparent-png']);
  assert.ok(operations[1][1]>=0);
});
test('video intro foreground paints only alpha overlay without modifying video frame',()=>{
  const commands=[];
  const ctx={drawImage:()=>commands.push('overlay'),fillRect:()=>commands.push('clear')};
  const overlay={naturalWidth:240,naturalHeight:80};
  drawIntro(ctx,1280,720,'GOALS!',{skipBackground:true,
    overlayImage:overlay,position:{x:.3,y:.66},overlayScale:.6});
  assert.deepEqual(commands,['overlay']);
});
test('native video background without PNG falls back to configured title',()=>{
  const commands=[];
  const ctx={measureText:()=>({width:30}),fillText:()=>commands.push('title')};
  drawIntro(ctx,1280,720,'MATCH DAY',{skipBackground:true,font:'impact'});
  assert.deepEqual(commands,['title']);
});
test('legacy default intro still renders gradient and word only',()=>{
  const commands=[];
  const ctx={
    createLinearGradient:()=>({addColorStop:()=>{}}),
    fillRect:()=>commands.push('background'),fillText:()=>commands.push('GOALS!'),
    measureText:()=>({width:40})
  };
  drawIntro(ctx,1280,720,'GOALS!');
  assert.deepEqual(commands,['background','GOALS!']);
});
