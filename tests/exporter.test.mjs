import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClipPlan, montageSeconds, drawIntro, getExportSettings, FRAME_RATE, INTRO_SECONDS } from '../exporter.mjs';

test('only selected highlights are included and sorted chronologically', () => {
  const plan = buildClipPlan([{time:50,enabled:true}, {time:20,enabled:false},
    {time:4,enabled:true}], 100, 10);
  assert.deepEqual(plan,[{start:4,end:14},{start:50,end:60}]);
});
test('overlapping clips are merged so actions are not repeated', () => {
  const plan=buildClipPlan([{time:20,enabled:true},{time:24,enabled:true},
    {time:42,enabled:true}], 80, 10);
  assert.deepEqual(plan,[{start:20,end:34},{start:42,end:52}]);
});
test('a clip at the video end is trimmed to file duration', () => {
  assert.deepEqual(buildClipPlan([{time:59,enabled:true}],60,16),
    [{start:59,end:60}]);
});
test('negative and non-finite time points are safe', () => {
  const plan=buildClipPlan([{time:-3,enabled:true},{time:NaN,enabled:true},
    {time:Infinity,enabled:true}],20,8);
  assert.deepEqual(plan,[{start:0,end:8}]);
});
test('invalid durations and empty selection return empty plan', () => {
  assert.deepEqual(buildClipPlan([{time:2,enabled:false}],40),[]);
  assert.deepEqual(buildClipPlan([{time:2,enabled:true}],NaN),[]);
  assert.deepEqual(buildClipPlan([],100),[]);
});
test('montage length is clip durations plus five seconds of title', () => {
  assert.equal(INTRO_SECONDS,5);
  assert.equal(montageSeconds([{start:0,end:10},{start:25,end:39}]),28.5);
});
test('title card contains only the specified words', () => {
  const rendered=[];
  const ctx={
    createLinearGradient:()=>({addColorStop:()=>{}}),
    fillRect:()=>rendered.push('background'),
    measureText:text=>({width:text.length*10}),
    fillText:(text)=>rendered.push(text),
  };
  drawIntro(ctx,800,450,'GOALS!');
  assert.deepEqual(rendered,['background','GOALS!']);
});

test('high quality exports 1080p at 30fps and 10 Mbps', () => {
  assert.deepEqual(getExportSettings(3840,2160,'high'), {
    width: 1920, height: 1080, frameRate: 30, bitrate: 10000000,
  });
  assert.equal(FRAME_RATE, 30);
});
test('standard quality exports 720p with a smaller bitrate', () => {
  assert.deepEqual(getExportSettings(3840,2160,'standard'), {
    width: 1280, height: 720, frameRate: 30, bitrate: 4500000,
  });
});
test('small files are not upscaled and portrait stays portrait', () => {
  assert.deepEqual(getExportSettings(640,360,'high'), {
    width: 640, height: 360, frameRate: 30, bitrate: 10000000,
  });
  const portrait = getExportSettings(1080,1920,'high');
  assert.equal(portrait.height, 1080);
  assert.equal(portrait.width % 2, 0);
  assert.ok(portrait.width < portrait.height);
});
test('invalid source dimensions are rejected', () => {
  assert.throws(() => getExportSettings(0, 1080));
  assert.throws(() => getExportSettings(NaN, 1080));
});
