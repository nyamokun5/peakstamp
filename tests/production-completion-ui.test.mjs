import test from 'node:test';
import assert from 'node:assert/strict';
import {installProductionUI} from '../sposched-production-ui.mjs';
import {productionBatchStorageKey} from '../sposched-production-release.mjs';
import {productionSubmissionKey,reconcileProductionManualGoals} from '../sposched-production-submission.mjs';
const id=n=>'21234567-89ab-4cde-8abc-'+String(n).padStart(12,'0');
const E=id(90),G=id(92);
function setup(){
 const globals={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch};
 const elements=new Map(),data=new Map(),calls=[],completed=[];
 const get=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,textContent:'',options:[],events:{},
  addEventListener(name,fn){this.events[name]=fn}});return elements.get(id)};
 const review={seq:1,team:'Blue',scorer:'A',assist:'B',assistMode:'named',guest:false,include:true};
 const draft={id:G,manual:true,sent:false,source:{name:'SS手動入力'},review:{...review}};
 let goals=[draft],rows=[{...review,key:'SS手動入力::'+G,goal:draft}];
 const snapshot={eventId:E,rosterSource:'official-current-event-teams',players:['A','B','C'],
  playerTeam:new Map([['A','Blue'],['B','Blue'],['C','Red']]),
  matches:[1,2].map(seq=>({seq,matchId:id(seq),status:'scheduled',title:'League',
   leftTeam:'Blue',rightTeam:'Red',leftScore:0,rightScore:0,existingGoals:[]}))};
 const latest=structuredClone(snapshot);let revision=1,active=true,requestId,unknown=false,wrongRequest=false,delaySnapshot;
 globalThis.document={getElementById:get};
 globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 get('ssBridgeToken').value='mock-only';
 const read=async path=>{
  if(path.startsWith('/production/release-state'))return {environment:'PRODUCTION',event_id:E,target_event_id:E,scope:'current-target',release_ready:true};
  if(path.startsWith('/production/inspect'))return {environment:'PRODUCTION',mode:'read-only',event_id:E,team_id:id(89),team_pinned:true,
   write_allowed:false,release_approved:false,matches:snapshot.matches.map(m=>({seq:m.seq,match_id:m.matchId,status:m.status}))};
  if(path.startsWith('/snapshot')){if(delaySnapshot)await delaySnapshot;return structuredClone(latest)}
  throw Error('Unexpected read');
 };
 globalThis.fetch=async(url,opts)=>{
  const body=JSON.parse(opts.body);calls.push({path:new URL(url).pathname,body});
  if(String(url).endsWith('/start')){
   // Both receipt and marker MUST already exist before the network mutation.
   const saved=JSON.parse(data.get(productionSubmissionKey(E)));
   assert.equal(saved.request_id,body.request_id);assert.equal(data.get(productionBatchStorageKey(E)),body.request_id);
   requestId=body.request_id;
   if(unknown)throw Error('lost ACK');
   return Response.json({status:'running'});
  }
  if(String(url).endsWith('/inspect'))return Response.json({environment:'PRODUCTION',event_id:E,
   request_id:wrongRequest?id(99):requestId,inspection_only:true,status:'completed',completed:3,total:3,
   fixture_count:2,layout_mode:'independent-fixtures-v1',fixture_ids:{1:id(1),2:id(2)}});
  throw Error('Unexpected post');
 };
 const create=()=>installProductionUI({current:()=>({active,connectionRevision:revision,snapshot,rows,decisions:rows.map(()=>({state:'manual'}))}),read,normalize:x=>x,
  onComplete:(fresh,meta)=>{const result=reconcileProductionManualGoals(goals,meta.submission,meta.eventId,meta.requestId);goals=result.goals;completed.push(result.completedKeys)}});
 const finish=()=>{latest.matches.forEach(m=>m.status='finished');latest.matches[0].leftScore=1;
  latest.matches[0].existingGoals=[{scorer:'A',assist:'B',team:'Blue',ownGoal:false}]};
 const restore=()=>Object.assign(globalThis,globals);
 return {get,data,calls,completed,create,restore,finish,latest,
  goals:()=>goals,add:()=>goals.push({...structuredClone(draft),id:id(98)}),edit:()=>goals[0].review.scorer='C',
  unknown:v=>unknown=v,wrongRequest:v=>wrongRequest=v,switch:()=>{revision++;active=false},
  pauseSnapshot:()=>{let done;delaySnapshot=new Promise(r=>done=r);return ()=>{delaySnapshot=null;done()}},
  knockout:()=>{snapshot.matches=[1,2,3,4].map(seq=>({seq,matchId:id(seq),status:seq<3?'scheduled':'waiting',title:seq<3?'準決勝':seq===3?'3位決定戦':'決勝',leftTeam:'Blue',rightTeam:'Red',leftScore:0,rightScore:0,existingGoals:[]}));latest.matches=structuredClone(snapshot.matches)},
  installRequest:r=>{requestId=r;data.set(productionBatchStorageKey(E),r)}};
}
async function prepare(x,ui){await x.get('productionCheck').events.click();assert.equal(x.get('productionStart').disabled,false)}
test('unknown ACK retains receipt; reload reconciles only submitted unchanged drafts and never resends',async()=>{
 const x=setup();try{
  let ui=x.create();await prepare(x,ui);x.unknown(true);
  await x.get('productionStart').events.click();
  assert.match(x.get('productionStatus').textContent,/不確定/);assert.equal(x.calls.length,1);
  x.add();x.finish();ui=x.create();await ui.refresh();
  assert.equal(x.goals()[0].sent,true);assert.equal(x.goals()[1].sent,false);
  assert.deepEqual(x.completed,[['SS手動入力::'+G]]);
  await x.get('productionStart').events.click();
  assert.equal(x.calls.filter(c=>c.path.endsWith('/start')).length,1);
  assert.ok(x.data.get(productionBatchStorageKey(E)));
 }finally{x.restore()}
});
test('edited drafts remain unsent despite a matching completed official job',async()=>{
 const x=setup();try{
  const ui=x.create();await prepare(x,ui);x.unknown(true);await x.get('productionStart').events.click();
  x.edit();x.finish();await ui.refresh();assert.equal(x.goals()[0].sent,false);assert.deepEqual(x.completed,[[]]);
 }finally{x.restore()}
});
test('wrong request, fixture, assist or score blocks completion and preserves request marker',async()=>{
 for(const corrupt of ['request','fixture','assist','score']){
  const x=setup();try{
   const ui=x.create();await prepare(x,ui);x.unknown(true);await x.get('productionStart').events.click();x.finish();
   if(corrupt==='request')x.wrongRequest(true);
   if(corrupt==='fixture')x.latest.matches[0].matchId=id(99);
   if(corrupt==='assist')x.latest.matches[0].existingGoals[0].assist='';
   if(corrupt==='score')x.latest.matches[0].leftScore=2;
   await ui.refresh();assert.deepEqual(x.completed,[]);assert.equal(x.goals()[0].sent,false);
   assert.ok(x.data.get(productionBatchStorageKey(E)));
  }finally{x.restore()}
 }
});
test('connection switch while awaiting official completion snapshot cannot mutate current drafts',async()=>{
 const x=setup();try{
  const ui=x.create();await prepare(x,ui);x.unknown(true);await x.get('productionStart').events.click();x.finish();
  const release=x.pauseSnapshot(),pending=ui.refresh();await new Promise(r=>setImmediate(r));x.switch();release();await pending;
  assert.deepEqual(x.completed,[]);assert.equal(x.goals()[0].sent,false);
 }finally{x.restore()}
});
test('legacy request marker without receipt never guesses submitted manual identities',async()=>{
 const x=setup();try{
  const ui=x.create();x.installRequest(id(91));x.finish();await ui.refresh();
  assert.deepEqual(x.completed,[[]]);assert.equal(x.goals()[0].sent,false);
 }finally{x.restore()}
});

test('unsupported manual knockout submission stops before any POST or local request marker',async()=>{
 const x=setup();try{
  x.knockout();x.create();await x.get('productionCheck').events.click();
  assert.equal(x.get('productionStart').disabled,true);assert.match(x.get('productionPlan').textContent,/確認未完了/);
  await x.get('productionStart').events.click();assert.equal(x.calls.length,0);
  assert.equal(x.data.get(productionBatchStorageKey(E)),undefined);
 }finally{x.restore()}
});
