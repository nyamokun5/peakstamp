import test from 'node:test';
import assert from 'node:assert/strict';
import {installProductionUI} from '../sposched-production-ui.mjs';
import {productionBatchStorageKey} from '../sposched-production-release.mjs';
import {productionSubmissionKey,makeProductionSubmission,reconcileProductionManualGoals} from '../sposched-production-submission.mjs';
const id=n=>'78787878-7878-4787-8787-'+String(n).padStart(12,'0');
const E=id(90),G=id(92),OTHER=id(99),TEAM=id(89);
function setup(){
 const prior={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch};
 const elements=new Map(),data=new Map(),calls=[],completions=[];
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',disabled:false,hidden:false,textContent:'',options:[],events:{},addEventListener(name,fn){this.events[name]=fn}});return elements.get(id)};
 const review={seq:1,team:'Blue',scorer:'A',assist:'B',assistMode:'named',guest:false,include:true};
 let goals=[{id:G,manual:true,sent:false,source:{name:'SS手動入力'},review:{...review}}];
 const rows=[{...review,key:'SS手動入力::'+G,goal:goals[0]}];
 const snapshot={eventId:E,rosterSource:'official-current-event-teams',players:['A','B','C'],playerTeam:new Map([['A','Blue'],['B','Blue'],['C','Red']]),matches:[1,2].map(seq=>({seq,matchId:id(seq),status:'scheduled',title:'League',leftTeam:'Blue',rightTeam:'Red',leftScore:0,rightScore:0,existingGoals:[]}))};
 const latest=structuredClone(snapshot);let requestId,failKey,pause;
 globalThis.document={getElementById:el};
 globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(k===failKey)throw Error('synthetic storage unavailable');data.set(k,v)}};
 el('ssBridgeToken').value='synthetic-only';
 const read=async path=>{
  if(path.startsWith('/production/release-state'))return {environment:'PRODUCTION',event_id:E,target_event_id:E,scope:'current-target',release_ready:true};
  if(path.startsWith('/production/inspect'))return {environment:'PRODUCTION',mode:'read-only',event_id:E,team_id:TEAM,team_pinned:true,write_allowed:false,release_approved:false,matches:snapshot.matches.map(m=>({seq:m.seq,match_id:m.matchId,status:m.status}))};
  if(path.startsWith('/snapshot')){if(pause)await pause;return structuredClone(latest)}
  throw Error('unexpected mocked read');
 };
 globalThis.fetch=async(url,init)=>{
  const path=new URL(url).pathname,body=JSON.parse(init.body);calls.push({path,body});
  if(path.endsWith('/start')){requestId=body.request_id;throw Error('synthetic unknown ACK')}
  if(path.endsWith('/inspect'))return Response.json({environment:'PRODUCTION',event_id:E,request_id:requestId,inspection_only:true,status:'completed',completed:3,total:3,fixture_count:2,layout_mode:'independent-fixtures-v1',fixture_ids:{1:id(1),2:id(2)}});
  throw Error('unexpected mocked POST');
 };
 const ui=installProductionUI({current:()=>({active:true,connectionRevision:1,snapshot,rows,decisions:rows.map(()=>({state:'manual'}))}),read,normalize:x=>x,onComplete:(fresh,meta)=>{const next=reconcileProductionManualGoals(goals,meta.submission,meta.eventId,meta.requestId);goals=next.goals;completions.push(next.completedKeys)}});
 const marker=productionBatchStorageKey(E),receipt=productionSubmissionKey(E);
 return {el,data,calls,completions,ui,marker,receipt,goals:()=>goals,
  fail:k=>{failKey=k},
  prepare:async()=>{await el('productionCheck').events.click();assert.equal(el('productionStart').disabled,false)},
  start:()=>el('productionStart').events.click(),
  finish:()=>{latest.matches.forEach(m=>m.status='finished');latest.matches[0].leftScore=1;latest.matches[0].existingGoals=[{team:'Blue',scorer:'A',assist:'B',ownGoal:false}]},
  pause:()=>{let resume;pause=new Promise(r=>resume=r);return ()=>{pause=null;resume()}},
  otherReceipt:()=>JSON.stringify(makeProductionSubmission({teamId:TEAM,rows:[],plan:{event_id:E,request_id:OTHER,confirm:'PRODUCTION EVENT BATCH WRITE',layout_mode:'independent-fixtures-v1',fixture_count:2,operations:[{seq:1,action:'finish',winner:'auto',expected_match_id:id(1)},{seq:2,action:'finish',winner:'auto',expected_match_id:id(2)}]}})),
  close:()=>Object.assign(globalThis,prior)};
}
const tick=()=>new Promise(r=>setImmediate(r));
for(const kind of ['receipt','marker'])test(`failed ${kind} persistence prevents every upstream start`,async()=>{
 const x=setup();try{
  await x.prepare();x.fail(x[kind]);await x.start();
  assert.equal(x.calls.length,0);assert.equal(x.data.get(x.marker),undefined);assert.match(x.el('productionStatus').textContent,/停止/);
 }finally{x.close()}
});
test('another tab claiming a request during final inspection is never overwritten or submitted',async()=>{
 const x=setup();try{
  await x.prepare();const resume=x.pause(),pending=x.start();await tick();
  const other=x.otherReceipt();x.data.set(x.marker,OTHER);x.data.set(x.receipt,other);resume();await pending;
  assert.equal(x.calls.length,0,'must recheck ownership after awaited official reads');
  assert.equal(x.data.get(x.marker),OTHER);assert.equal(x.data.get(x.receipt),other);
 }finally{x.close()}
});
test('another tab changing only submission evidence during final inspection is preserved',async()=>{
 const x=setup();try{
  await x.prepare();const resume=x.pause(),pending=x.start();await tick();
  const other=x.otherReceipt();x.data.set(x.receipt,other);resume();await pending;
  assert.equal(x.calls.length,0,'changed receipt must block before persistence and POST even without a marker');
  assert.equal(x.data.get(x.marker),undefined);assert.equal(x.data.get(x.receipt),other);
  assert.match(x.el('productionStatus').textContent,/別のタブ/);
 }finally{x.close()}
});
test('request marker changed while reading completed snapshot prevents draft mutation',async()=>{
 const x=setup();try{
  await x.prepare();await x.start();x.finish();
  const resume=x.pause(),pending=x.ui.refresh();await tick();x.data.set(x.marker,OTHER);resume();await pending;
  assert.deepEqual(x.completions,[]);assert.equal(x.goals()[0].sent,false);assert.equal(x.data.get(x.marker),OTHER);
  assert.equal(x.calls.filter(c=>c.path.endsWith('/start')).length,1);
 }finally{x.close()}
});
test('stale submission receipt blocks completed reconciliation without retrying start',async()=>{
 const x=setup();try{
  await x.prepare();await x.start();x.finish();x.data.set(x.receipt,x.otherReceipt());await x.ui.refresh();
  assert.deepEqual(x.completions,[]);assert.equal(x.goals()[0].sent,false);assert.ok(x.data.get(x.marker));
  assert.equal(x.calls.filter(c=>c.path.endsWith('/start')).length,1);
 }finally{x.close()}
});
test('legacy missing receipt may verify job but never infer submitted draft identity',async()=>{
 const x=setup();try{
  await x.prepare();await x.start();x.finish();x.data.delete(x.receipt);await x.ui.refresh();
  assert.deepEqual(x.completions,[[]]);assert.equal(x.goals()[0].sent,false);assert.ok(x.data.get(x.marker));
  assert.equal(x.calls.filter(c=>c.path.endsWith('/start')).length,1);
 }finally{x.close()}
});
