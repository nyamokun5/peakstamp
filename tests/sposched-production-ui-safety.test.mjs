import test from 'node:test';
import assert from 'node:assert/strict';
import {installProductionUI} from '../sposched-production-ui.mjs';

const E='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const T='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const ids=[1,2,3,4].map(n=>'11111111-2222-4111-8111-11111111111'+n);
const snapshot={eventId:E,matches:ids.map((matchId,i)=>({seq:i+1,matchId,
 status:i<2?'scheduled':'waiting'})),playerTeam:new Map(),players:[]};

function createUI({state={active:true,snapshot,rows:[],decisions:[]},releaseOverride=null,readOverride=null}={}){
 const elements=new Map();
 const get=id=>{
  if(!elements.has(id)){
   const events={};
   elements.set(id,{id,hidden:false,disabled:false,checked:false,value:'',
    textContent:'',options:[],events,
    addEventListener(name,callback){events[name]=callback;}
   });
  }
  return elements.get(id);
 };
 const globals={document:globalThis.document,localStorage:globalThis.localStorage};
 const storage=new Map();
 globalThis.document={getElementById:get};
 globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(k,v)=>storage.set(k,v)};
 const events=[];
 const read=async path=>{
  events.push(path);
  if(readOverride)return readOverride(path);
  if(path.startsWith('/production/release-state'))return {
   environment:'PRODUCTION',event_id:E,release_ready:false,...releaseOverride};
  if(path.startsWith('/production/inspect'))return {
   environment:'PRODUCTION',mode:'read-only',team_pinned:true,
   write_allowed:false,release_approved:false,event_id:E,team_id:T,
   matches:ids.map((match_id,i)=>({seq:i+1,match_id,
    status:i<2?'scheduled':'waiting'}))};
  if(path.startsWith('/snapshot'))return {event_id:E,matches:[]};
  throw Error('unexpected read '+path);
 };
 const ui=installProductionUI({current:()=>state,
  read,normalize:x=>x,onComplete:()=>{throw Error('must not complete');}});
 return {get,ui,events,restore:()=>{globalThis.document=globals.document;
  globalThis.localStorage=globals.localStorage;}};
}

test('production panel cannot enable a send with disabled server release',async()=>{
 const x=createUI();
 try{
  x.ui.render();
  assert.equal(x.get('productionPanel').hidden,false);
  assert.equal(x.get('productionStart').disabled,true);
  await x.get('productionCheck').events.click();
  assert.equal(x.get('productionStart').disabled,true);
  assert.match(x.get('productionPlan').textContent,/確認未完了/);
  assert.equal(x.events.length,3);
  assert.ok(x.events.every(q=>q.startsWith('/production/')||q.startsWith('/snapshot')));
 }finally{x.restore();}
});

for(const [format,count] of [['1team',1],['2teams_1pitch',2],['3teams_1pitch',3]])
 test('independent '+format+' uses the shared send journal and never retries a lost response',async()=>{
  const s={...snapshot,officialFormat:format,matches:snapshot.matches.slice(0,count).map(m=>({...m,status:'scheduled',leftTeam:'Home '+m.seq,rightTeam:'Away '+m.seq}))};
  let enabled=true;
  const x=createUI({state:{active:true,snapshot:s,rows:[],decisions:[]},readOverride:async path=>{
   if(path.startsWith('/production/release-state'))return {environment:'PRODUCTION',event_id:E,
    target_event_id:E,scope:'current-target',release_ready:true,
    independent_fixture_contract:'independent-fixtures-v1',independent_batch_writes:enabled,
    batch_start_path:'/production/batch/start'};
   if(path.startsWith('/snapshot'))return s;
   return {environment:'PRODUCTION',event_id:E,team_id:T,mode:'read-only',team_pinned:true,
    write_allowed:false,release_approved:false,matches:s.matches.map(m=>({seq:m.seq,match_id:m.matchId,status:m.status,left_team:m.leftTeam,right_team:m.rightTeam}))};
  }});
  const oldFetch=globalThis.fetch;let sends=0;
  try{
   globalThis.fetch=async(url,options)=>{
    sends++;
    assert.equal(url,'https://shoot-sunday-sync.yomax1979.workers.dev/production/batch/start');
    const plan=JSON.parse(options.body);
    assert.equal(plan.layout_mode,'independent-fixtures-v1');
    assert.equal(plan.fixture_count,count);
    assert.equal(plan.confirm,'PRODUCTION EVENT BATCH WRITE');
    assert.equal(globalThis.localStorage.getItem('peakstamp:production:worker-batch:'+E),plan.request_id);
    assert.equal(options.redirect,'error');
    throw Error('response lost after upstream commit');
   };
   x.get('ssBridgeToken').value='test-fixture';
   x.ui.render();
   enabled=false;
   await x.get('productionCheck').events.click();
   assert.equal(x.get('productionStart').disabled,true);
   enabled=true;
   await x.get('productionCheck').events.click();
   assert.equal(x.get('productionStart').disabled,false);
   assert.match(x.get('productionStart').textContent,new RegExp(count+'試合'));
   await x.get('productionStart').events.click();
   await x.get('productionStart').events.click();
   await x.get('productionCheck').events.click();
   assert.equal(sends,1);
   assert.equal(x.get('productionStart').disabled,true);
  }finally{globalThis.fetch=oldFetch;x.restore();}
 });

test('a rerender during preflight invalidates old evidence even for the same event',async()=>{
 let releaseRead;
 const pending=new Promise(resolve=>{releaseRead=resolve;});
 const x=createUI({readOverride:async path=>{
  await pending;
  if(path.startsWith('/production/release-state'))return {environment:'PRODUCTION',event_id:E,
   target_event_id:E,scope:'current-target',release_ready:true};
  if(path.startsWith('/snapshot'))return snapshot;
  return {environment:'PRODUCTION',event_id:E,team_id:T,mode:'read-only',team_pinned:true,
   write_allowed:false,release_approved:false,matches:snapshot.matches.map(m=>({seq:m.seq,match_id:m.matchId,status:m.status}))};
 }});
 try{
  x.ui.render();
  const checking=x.get('productionCheck').events.click();
  x.ui.render();
  releaseRead();
  await checking;
  assert.equal(x.get('productionStart').disabled,true);
  assert.match(x.get('productionPlan').textContent,/変更されました/);
 }finally{x.restore();}
});

for(const [status,execution_active,expectedTimers,message] of [
 ['running',false,0,/状態確認では処理を再開しません/],
 ['running',undefined,0,/実行を確認できません/],
 ['running',true,1,/登録中/],
 ['blocked',false,0,/試合の削除・作り直し/],
 ['paused',false,0,/再開ボタン/]
])test('inspection recovery '+status+' active='+execution_active,async()=>{
 const x=createUI(),oldFetch=globalThis.fetch,oldWindow=globalThis.window;
 const requestId='cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';let calls=0,timers=0;
 try{
  x.ui.render();
  globalThis.localStorage.setItem('peakstamp:production:worker-batch:'+E,requestId);
  x.get('ssBridgeToken').value='mock';
  globalThis.window={setTimeout:()=>timers++};
  globalThis.fetch=async(url,options)=>{
   calls++;assert.ok(url.endsWith('/production/batch/inspect'));
   assert.deepEqual(JSON.parse(options.body),{event_id:E,request_id:requestId});
   return Response.json({environment:'PRODUCTION',event_id:E,request_id:requestId,
    inspection_only:true,status,execution_active,completed:1,total:4});
  };
  await x.ui.refresh();
  assert.equal(calls,1);assert.equal(timers,expectedTimers);
  assert.match(x.get('productionStatus').textContent,message);
  assert.equal(x.get('productionStart').disabled,true);
  assert.equal(globalThis.localStorage.getItem('peakstamp:production:worker-batch:'+E),requestId);
 }finally{globalThis.fetch=oldFetch;globalThis.window=oldWindow;x.restore();}
});

for(const scenario of ['success','stale-pause','stale-cursor','wrong-target','lost-response','event-change']){
 test('production resume '+scenario,async()=>{
  const state={active:true,snapshot,rows:[],decisions:[]};
  const x=createUI({state,readOverride:async()=>{
   if(scenario==='event-change')state.active=false;
   return {environment:'PRODUCTION',event_id:E,target_event_id:scenario==='wrong-target'?T:E,scope:'current-target',release_ready:true};
  }});
  const old=globalThis.fetch,requestId='cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';
  let inspected=0,resumed=0;
  const job={environment:'PRODUCTION',control_contract:'event-pause-v1',inspection_only:true,
   execution_active:false,event_id:E,request_id:requestId,status:'paused',phase:'preparing',
   pause_requested:true,pause_id:'pause-one',cursor:1,completed:1,total:4};
  try{
   x.ui.render();x.get('ssBridgeToken').value='mock';
   localStorage.setItem('peakstamp:production:worker-batch:'+E,requestId);
   globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/inspect')){
     inspected++;
     return Response.json({...job,
      ...(inspected>1&&scenario==='stale-pause'?{pause_id:'pause-two'}:{}),
      ...(inspected>1&&scenario==='stale-cursor'?{cursor:2}:{}),
      ...(resumed?{status:'needs_decision',decision:{seq:2,choices:['left'],left_team:'A',right_team:'B',left_score:0,right_score:0}}:{})});
    }
    assert.ok(url.endsWith('/resume'));resumed++;
    assert.deepEqual(JSON.parse(options.body),{event_id:E,request_id:requestId,
     pause_id:'pause-one',cursor:1,confirm:'PRODUCTION EVENT BATCH RESUME'});
    if(scenario==='lost-response')throw Error('lost response');
    return Response.json({});
   };
   await x.ui.refresh();assert.equal(x.get('productionResume').hidden,false);
   await x.get('productionResume').events.click();
   await x.get('productionResume').events.click();
   assert.equal(resumed,['success','lost-response'].includes(scenario)?1:0);
   assert.equal(localStorage.getItem('peakstamp:production:worker-batch:'+E),requestId);
   if(scenario==='lost-response')assert.match(x.get('productionStatus').textContent,/再送せず/);
  }finally{globalThis.fetch=old;x.restore();}
 });
}
test('unsafe or unidentified production states never authorize resume',async()=>{
 const {productionResumePayload}=await import('../sposched-production-ui.mjs');
 const j={environment:'PRODUCTION',control_contract:'event-pause-v1',inspection_only:true,
  execution_active:false,event_id:E,request_id:T,status:'paused',phase:'preparing',
  pause_requested:true,pause_id:'pause',cursor:1};
 for(const change of [{status:'blocked'},{phase:'executing'},{execution_active:true},
  {inspection_only:false},{event_id:T},{request_id:E},{pause_requested:false},
  {pause_id:null},{cursor:-1},{cursor:1.5},{control_contract:null},{environment:'STAGING ONLY'}])
  assert.throws(()=>productionResumePayload({...j,...change},E,T));
});

 test('empty official fixtures show SS creation instructions and cannot prepare or submit',async()=>{
 const state={active:true,snapshot:{...snapshot,matches:[]},rows:[],decisions:[]};
 const x=createUI({state});
 try{
  x.ui.render();
  assert.match(x.get('productionStatus').textContent,/SS側で試合が作成されていません/);
  assert.match(x.get('productionStatus').textContent,/「スコア入力」から「試合作成」/);
  assert.equal(x.get('productionCheck').disabled,true);
  assert.equal(x.get('productionStart').disabled,true);
  await x.get('productionCheck').events.click();
  await x.get('productionStart').events.click();
  assert.deepEqual(x.events,[]);
  state.snapshot=snapshot;
  x.ui.render();
  assert.equal(x.get('productionCheck').disabled,false);
  assert.equal(x.get('productionStart').disabled,true);
 }finally{x.restore();}
});
