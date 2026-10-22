import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {savedGoalSessions,deleteGoalSessions} from '../goal-data-reset.mjs';
import {GOAL_STORE_PREFIX} from '../goal-stats.mjs';

function fakeStorage(){
 const map=new Map();
 return {
  get length(){return map.size},
  key:index=>[...map.keys()][index]??null,
  getItem:key=>map.get(key)??null,
  setItem:(key,value)=>map.set(key,String(value)),
  removeItem:key=>map.delete(key),
  entries:()=>[...map]
 };
}
const file=(name,lastModified,items=[])=>({
 name,size:355000,lastModified,
 items
});
const key=f=>GOAL_STORE_PREFIX+[f.name,f.size,f.lastModified].join('::');
const add=(storage,f)=>storage.setItem(key(f),JSON.stringify({
 version:1,source:{name:f.name,size:f.size,lastModified:f.lastModified},items:f.items
}));
test('lists local per-video goal saves with newest SOURCE FILE first and accurate counts',()=>{
 const storage=fakeStorage();
 const old=file('older.mov',1650000000000,[{videoDecision:'rejected'}]);
 const latest=file('IMG_5293.MOV',1792284336000,[
  {videoDecision:'kept',status:'confirmed',clipStartSeconds:300,clipZoom:1.8},
  {videoDecision:'rejected',clipEndSeconds:311},
  {status:'draft'}
 ]);
 add(storage,old);add(storage,latest);
 storage.setItem('peakstamp_callout_pilot_v2:'+latest.name,'keep transcript');
 storage.setItem('peakstamp_zoom_discovered_v1','yes');
 const sessions=savedGoalSessions(storage);
 assert.deepEqual(sessions.map(x=>x.name),['IMG_5293.MOV','older.mov']);
 assert.equal(sessions[0].kept,1);
 assert.equal(sessions[0].rejected,1);
 assert.equal(sessions[0].edited,2);
 assert.equal(sessions[0].confirmed,1);
 assert.equal(sessions[0].total,3);
 assert.equal(sessions[0].lastModified,1792284336000);
 assert.equal(sessions.length,2,'ignore Gemini caches and unrelated settings');
});
test('deletes ONLY the selected recent video goal decisions, assists and crop edits',()=>{
 const storage=fakeStorage();
 const a=file('IMG_5292.mov',1792283825000,[{videoDecision:'kept',clipZoom:2.5,assist:'A'}]);
 const b=file('IMG_5293.mov',1792284336000,[{videoDecision:'rejected',clipEndSeconds:22}]);
 add(storage,a);add(storage,b);
 const transcript='peakstamp_callout_pilot_v2:'+b.name+'::whole';
 storage.setItem(transcript,JSON.stringify({utterances:[{kind:'goal_call'}]}));
 storage.setItem('peakstamp_gemini_primary_json_v1','{"x":true}');
 storage.setItem('peakstamp_first_run_v1','done');
 assert.equal(deleteGoalSessions(storage,[key(b)]),1);
 assert.equal(storage.getItem(key(b)),null,'recent goal data deleted');
 assert.ok(storage.getItem(key(a)),'older video untouched');
 assert.ok(storage.getItem(transcript),'Gemini transcript untouched');
 assert.ok(storage.getItem('peakstamp_gemini_primary_json_v1'),'other AI state untouched');
 assert.ok(storage.getItem('peakstamp_first_run_v1'),'settings untouched');
 assert.deepEqual(savedGoalSessions(storage).map(x=>x.name),['IMG_5292.mov']);
});
test('delete requires explicit selection and does not accept unrelated keys',()=>{
 const storage=fakeStorage(),f=file('g.mov',1792284336000);
 add(storage,f);
 storage.setItem('unrelated','important');
 assert.throws(()=>deleteGoalSessions(storage,[]),/Select/);
 assert.throws(()=>deleteGoalSessions(storage,['unrelated']),/no longer exist/);
 assert.throws(()=>deleteGoalSessions(storage,['nonexistent']),/no longer exist/);
 assert.equal(storage.getItem('unrelated'),'important');
 assert.ok(storage.getItem(key(f)));
 assert.equal(deleteGoalSessions(storage,[key(f),key(f)]),1,'duplicate entries deleted once');
 assert.deepEqual(savedGoalSessions(storage),[]);
});
test('reset page requires explicit confirmation and does not run destructive code upon load',()=>{
 const html=readFileSync(new URL('../reset-goals.html',import.meta.url),'utf8');
 const main=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(main,/href="\.\/reset-goals\.html\?v=reset59"/);
 assert.match(html,/savedGoalSessions,deleteGoalSessions/);
 assert.match(html,/window\.confirm\(question\)/);
 assert.match(html,/erase\.addEventListener\('click'/);
 assert.match(html,/check\.type='checkbox'/);
 assert.doesNotMatch(html,/localStorage\.clear\s*\(/);
 assert.doesNotMatch(html,/sessionStorage\.clear\s*\(/);
 assert.match(html,/Geminiによる実況文字起こし/);
});
