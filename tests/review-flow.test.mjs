import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PLAY_LABEL, PLAY_LABELS, judgeScene, restoreJudgment,
  nextUndecided, orderedScenes, visibleScenes, replayBounds } from '../review-flow.mjs';
import { getCandidateEnd } from '../editing-rules.mjs';

const source=(id, candidates)=>({
  id,file:{name:id+'.mov'},bins:[{time:0,rms:0.1}],duration:80,candidates,
});
const scene=(id, enabled=false, rejected=false)=>({
  id, enabled, rejected, time:5, peakSeconds:12, manualEnd:25, title:DEFAULT_PLAY_LABEL
});

test('default play label and dropdown options preserve exact requested Japanese text',()=>{
  assert.equal(DEFAULT_PLAY_LABEL,'ナイスプレイ！');
  assert.deepEqual(PLAY_LABELS, [
    'ナイスプレイ！','ゴール','ナイスキーパー','惜しい！','ナイスディフェンス！'
  ]);
});
test('keep marks a clip selected and advances to the next untouched clip',()=>{
  const a=scene('a'), b=scene('b'), c=scene('c');
  const sources=[source('one',[a,b]),source('two',[c])];
  const previous=judgeScene(a,'kept');
  assert.deepEqual(previous,{enabled:false,rejected:false});
  assert.equal(a.enabled,true);
  assert.equal(a.rejected,false);
  assert.equal(nextUndecided(sources,a).item,b);
});
test('reject hides a candidate immediately in All and Keep lists',()=>{
  const a=scene('a'),b=scene('b',true),c=scene('c');
  const sources=[source('one',[a,b,c])];
  judgeScene(a,'rejected');
  assert.equal(a.enabled,false);
  assert.equal(a.rejected,true);
  assert.deepEqual(visibleScenes(sources,'all').map(x=>x.item.id),['c']);
  assert.deepEqual(visibleScenes(sources,'kept').map(x=>x.item.id),['b']);
  assert.equal(nextUndecided(sources,a).item,c);
});
test('Undo restores the exact prior decision state',()=>{
  const item=scene('a',true,false);
  const previous=judgeScene(item,'rejected');
  restoreJudgment(item,previous);
  assert.equal(item.enabled,true);
  assert.equal(item.rejected,false);
});
test('next undecided wraps to first source and ignores kept/rejected clips',()=>{
  const a=scene('a'), b=scene('b',true), c=scene('c',false,true);
  const sources=[source('one',[a]),source('two',[b,c])];
  assert.equal(nextUndecided(sources,c).item,a);
  assert.equal(nextUndecided(sources,a),null);
});
test('individual scene ordering follows source order across separate files',()=>{
  const sources=[source('B',[scene('b1')]),source('A',[scene('a1'),scene('a2')])];
  assert.deepEqual(orderedScenes(sources).map(x=>x.item.id),['b1','a1','a2']);
});
test('replay starts at chosen clip start and stops at manual clip end',()=>{
  const item=scene('goal');
  item.time=10;
  item.manualEnd=32;
  const src=source('match',[item]);
  const b=replayBounds(src,item,(s,i)=>getCandidateEnd(s,i,{mode:'quiet'}));
  assert.deepEqual(b,{start:10,end:32});
});
test('replay endpoint honors source duration and zero',()=>{
  const src=source('match',[]);
  assert.deepEqual(replayBounds(src,{time:78},()=>120),{start:78,end:80});
  assert.deepEqual(replayBounds(src,{time:-3},()=>4),{start:0,end:4});
});
test('invalid judging action is rejected',()=>{
  assert.throws(()=>judgeScene(scene('a'),'ignore'));
});

test('kept scene disappears from undecided list but remains in kept tab',()=>{
 const a=scene('a'),b=scene('b');
 const sources=[source('one',[a,b])];
 judgeScene(a,'kept');
 assert.deepEqual(visibleScenes(sources,'all').map(x=>x.item.id),['b']);
 assert.deepEqual(visibleScenes(sources,'kept').map(x=>x.item.id),['a']);
 assert.equal(nextUndecided(sources,a).item,b);
});

test('last kept or rejected scene leaves no undecided successor for export',()=>{
 for(const outcome of ['kept','rejected']){
  const a=scene('a'),b=scene('b');
  const sources=[source('one',[a,b])];
  judgeScene(a,'kept');
  judgeScene(b,outcome);
  assert.equal(nextUndecided(sources,b),null);
 }
});
