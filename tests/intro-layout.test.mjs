import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTRO_ANCHORS,INTRO_SECONDS,normalizeIntroPoint,introPreset,
  coverRect,overlayRect,imageDimensions,drawCover,drawIntroOverlay
} from '../intro-layout.mjs';
import { drawIntro, introTitleRect } from '../exporter.mjs';

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

test('legacy default text stays centered if position was never specified',()=>{
  const places=[];
  const ctx={
    createLinearGradient:()=>({addColorStop:()=>{}}),
    fillRect:()=>{},
    measureText:s=>({width:s.length*50}),
    fillText:(text,x,y)=>places.push({text,x,y})
  };
  drawIntro(ctx,1280,720,'GOALS!');
  assert.deepEqual(places,[{text:'GOALS!',x:640,y:360}]);
});
test('default text title uses nine-place presets even without uploaded PNG',()=>{
  for(let i=0;i<9;i++){
    const places=[];
    const ctx={
      measureText:s=>({width:s.length*25}),
      fillText:(text,x,y)=>places.push({text,x,y})
    };
    const pos=introPreset(i);
    drawIntro(ctx,1280,720,'GOALS!',{skipBackground:true,position:pos});
    const rect=introTitleRect(ctx,1280,720,'GOALS!',{position:pos});
    assert.deepEqual(places,[{text:'GOALS!',x:rect.x,y:rect.y}]);
    assert.ok(rect.left>=0 && rect.top>=0);
    assert.ok(rect.left+rect.width<=1280 && rect.top+rect.height<=720);
  }
});
test('free-position title uses the same geometry with image or video backgrounds',()=>{
  const calls=[];
  const ctx={
    drawImage:()=>calls.push('image'),measureText:s=>({width:s.length*32}),
    fillText:(_s,x,y)=>calls.push([x,y])
  };
  const pos={x:.31,y:.78},bg={naturalWidth:1280,naturalHeight:720};
  drawIntro(ctx,640,360,'MATCH DAY',{backgroundImage:bg,position:pos});
  const textRect=introTitleRect(ctx,640,360,'MATCH DAY',{position:pos});
  assert.deepEqual(calls,['image',[textRect.x,textRect.y]]);
  const onlyText=[];
  const videoCtx={measureText:s=>({width:s.length*32}),fillText:(_s,x,y)=>onlyText.push([x,y])};
  drawIntro(videoCtx,640,360,'MATCH DAY',{skipBackground:true,position:pos});
  assert.deepEqual(onlyText,[[textRect.x,textRect.y]]);
});
test('title bounding box reacts to font-size and clamps to portrait canvas',()=>{
  const ctx={measureText:s=>({width:s.length*18})};
  const normal=introTitleRect(ctx,360,640,'GOALS!',{size:100,position:{x:.95,y:.97}});
  const big=introTitleRect(ctx,360,640,'GOALS!',{size:150,position:{x:1,y:1}});
  assert.ok(big.font>normal.font);
  assert.ok(big.width>=normal.width);
  for(const box of [normal,big]){
    assert.ok(box.left>=0 && box.top>=0);
    assert.ok(box.left+box.width<=360 && box.top+box.height<=640);
  }
});
test('drag hit bounds correspond to exactly the rendered centered text',()=>{
  const ctx={measureText:s=>({width:s.length*24})};
  const place={x:.6,y:.23};
  const rect=introTitleRect(ctx,960,540,'HIGHLIGHTS!',{size:90,position:place});
  const coordinates=[];
  const drawCtx={measureText:ctx.measureText,fillText:(_s,x,y)=>coordinates.push([x,y])};
  drawIntro(drawCtx,960,540,'HIGHLIGHTS!',{
    skipBackground:true,size:90,position:place
  });
  assert.deepEqual(coordinates,[[rect.x,rect.y]]);
  assert.ok(rect.width>0 && rect.height>0);
});

test('very long movable titles remain within 90 percent canvas width',()=>{
  const context={measureText:()=>({width:1000}),fillText(...args){this.call=args}};
  drawIntro(context,320,180,'SUPER LONG SHOOT SUNDAY HIGHLIGHT',{
    skipBackground:true,position:{x:1,y:1}
  });
  const bounds=introTitleRect(context,320,180,'SUPER LONG SHOOT SUNDAY HIGHLIGHT',{
    position:{x:1,y:1}
  });
  assert.ok(bounds.width<=288 && bounds.left>=0 && bounds.left+bounds.width<=320);
  assert.equal(context.call[3],288);
});
