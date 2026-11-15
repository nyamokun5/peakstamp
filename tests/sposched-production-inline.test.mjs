import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionInlineController} from '../sposched-production-inline.mjs';
import {productionBatchStorageKey} from '../sposched-production-release.mjs';
const id=n=>n.toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111';
const E=id(1),T=id(2),R=id(3),M=[1,2,3,4].map(n=>id(n+10));
const people=['Alice','Bob','Carol','Dan'];
const team=['Team 1','Team 2','Team 3','Team 4'];
const makeStorage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}};
function fixture(options={}){
 const storage=makeStorage(),sent=[],statuses=[];
 let phase='initial',job=null,releaseReady=true,scorerChanged=false,activeEvent=E;
 const snapshot=()=>({environment:'production',eventId:activeEvent,officialFormat:options.independent?'2teams_1pitch':'4teams_1pitch',
  players:people,playerTeam:new Map(people.map((p,i)=>[p,team[i]])),
  memberIds:new Map(people.map((p,i)=>[p,id(30+i)])),playerIds:new Map(people.map((p,i)=>[p,id(40+i)])),
  rosterSource:'official-current-event-teams',
  matches:(options.independent?[1]:[1,2,3,4]).map(seq=>({seq,
   matchId:options.independent||seq<3||phase!=='initial'?M[seq-1]:'',
   status:phase==='done'||phase==='later'&&seq<3?'finished':seq>=3&&phase==='initial'?'waiting':'scheduled',
   leftTeam:seq===1?'Team 1':seq===2?'Team 3':seq===3?(phase==='initial'?'':'Team 2'):(phase==='initial'?'':'Team 1'),
   rightTeam:seq===1?'Team 2':seq===2?'Team 4':seq===3?(phase==='initial'?'':'Team 4'):(phase==='initial'?'':'Team 3'),
   leftScore:phase==='done'||phase==='later'&&seq<3?1:0,rightScore:0,existingGoals:[]}))});
 const getGoals=()=>({exportedAt:new Date().toISOString(),goals:(options.independent?[1]:[1,2,3,4]).map(seq=>{
  const index=seq===1||seq===4?0:seq===2?2:1;
  const m=snapshot().matches.find(m=>m.seq===seq);
  return {id:'goal-'+seq,source:{name:'video.mov'},matchSeq:String(seq),
   teamA:seq===3?'Team 2':seq===4?'Team 1':m.leftTeam,teamB:seq===3?'Team 4':seq===4?'Team 3':m.rightTeam,
   matchupConfirmed:true,scorer:scorerChanged?'Changed':people[index],rawScorer:people[index],assist:'',assistStatus:'none',manual:false,
   ssIdentity:{environment:'production',eventId:E,matchId:m.matchId,seq,
    scorer:{name:people[index],team:team[index],memberId:id(30+index),playerId:id(40+index),manual:true}}};
 })});
 const publishJob=(status)=>{const s=snapshot();job={environment:'PRODUCTION',event_id:E,request_id:R,
  inspection_only:true,inspection_contract:'event-inspect-v1',scope:'event',
  execution_active:false,phase:'preparing',layout_mode:options.independent?'independent-fixtures-v1':'four-knockout-staged-v1',
  fixture_count:s.matches.length,status,cursor:phase==='done'?8:4,completed:phase==='done'?8:4,total:phase==='done'?8:4,
  fixture_ids:Object.fromEntries(s.matches.filter(m=>m.matchId).map(m=>[m.seq,m.matchId])),goal_receipts:[]};return job;};
 const controller=createProductionInlineController({getSnapshot:snapshot,getGoals,refreshContext:async()=>snapshot(),
  readOfficial:async path=>{
   const s=snapshot();options.onRead?.();
   if(path.startsWith('/production/inspect'))return {environment:'PRODUCTION',event_id:E,team_id:T,mode:'read-only',team_pinned:true,
    write_allowed:false,release_approved:false,event_date:'2026-11-15',matches:s.matches.map(m=>({seq:m.seq,match_id:m.matchId,status:m.status,left_team:m.leftTeam,right_team:m.rightTeam}))};
   return {environment:'PRODUCTION',event_id:E,target_event_id:releaseReady?E:T,scope:'current-target',release_ready:releaseReady,
    independent_fixture_contract:'independent-fixtures-v1',independent_batch_writes:true,batch_start_path:'/production/batch/start'};
  },inspectBatch:async()=>job,
  startBatch:async plan=>{sent.push(plan);phase=options.independent?'done':'later';publishJob(options.independent?'completed':'awaiting_second_round');
   if(options.loseStart)throw Error('lost start response');return {event_id:E,request_id:R};},
  appendSecondRound:async plan=>{sent.push(plan);if(!options.loseAppend){phase='done';publishJob('completed');}
   if(options.loseAppend)throw Error('lost append response');return {event_id:E,request_id:R};},
  decideBatch:async plan=>{sent.push(plan);if(options.loseDecision)throw Error('lost decision response');phase='done';publishJob('completed');return {event_id:E,request_id:R};},
  storage,randomUUID:()=>R,wait:async()=>{},maxChecks:3,onStatus:s=>statuses.push(s)});
 return {controller,storage,sent,statuses,snapshot,getGoals,publishJob,
  setPhase:v=>{phase=v;},setJob:v=>{job=v;},disableRelease:()=>{releaseReady=false;},changeGoals:()=>{scorerChanged=true;},switchEvent:()=>{activeEvent=T;}};
}

test('one explicit production click registers semifinals and later rounds without navigation or TEST contracts',async()=>{
 const f=fixture();const job=await f.controller.start();
 assert.equal(job.status,'completed');assert.equal(f.sent.length,2);
 assert.equal(f.sent[0].confirm,'PRODUCTION EVENT BATCH WRITE');
 assert.deepEqual([...new Set(f.sent[0].operations.map(o=>o.seq))],[1,2]);
 assert.equal(f.sent[1].confirm,'PRODUCTION EVENT BATCH APPEND');
 assert.deepEqual([...new Set(f.sent[1].operations.map(o=>o.seq))],[3,4]);
 assert.ok(f.sent[1].operations.every(o=>M.slice(2).includes(o.expected_match_id)));
 assert.equal(f.storage.getItem(productionBatchStorageKey(E)),R);
 assert.match(f.statuses.at(-1),/4試合の登録完了/);
 await f.controller.start();assert.equal(f.sent.length,2,'completed job is inspected, never sent again');
});
test('independent official fixtures use the production contract and completion verifier',async()=>{
 const f=fixture({independent:true});await f.controller.start();
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].layout_mode,'independent-fixtures-v1');
 assert.equal(f.sent[0].confirm,'PRODUCTION EVENT BATCH WRITE');
 assert.match(f.statuses.at(-1),/1試合の登録完了/);
});
test('target denial blocks before any mutation or local send marker',async()=>{
 const f=fixture();f.disableRelease();await assert.rejects(f.controller.start(),/対象イベント/);
 assert.equal(f.sent.length,0);assert.equal(f.storage.getItem(productionBatchStorageKey(E)),null);
});
test('unknown start outcome retains its marker; passive inspection never appends',async()=>{
 const f=fixture({loseStart:true});await assert.rejects(f.controller.start(),/lost start/);
 assert.equal(f.sent.length,1);assert.equal(f.storage.getItem(productionBatchStorageKey(E)),R);
 await f.controller.inspect();assert.equal(f.sent.length,1);
 assert.match(f.statuses.at(-1),/準決勝は登録済み/);
 await f.controller.start();assert.equal(f.sent.length,2,'explicit continuation reuses the job, never repeats start');
});
test('unknown append receipt is never retried even on another explicit registration click',async()=>{
 const f=fixture({loseAppend:true});await assert.rejects(f.controller.start(),/lost append/);
 await f.controller.inspect();assert.equal(f.sent.length,2);
 await assert.rejects(f.controller.start(),/送信済みの可能性/);assert.equal(f.sent.length,2);
});
test('a local marker with no server record fails closed',async()=>{
 const f=fixture();f.storage.setItem(productionBatchStorageKey(E),R);
 await assert.rejects(f.controller.start(),/送信履歴/);assert.equal(f.sent.length,0);
});
test('existing production job from the external screen is passively restored, with no new start',async()=>{
 const f=fixture();f.setPhase('later');f.publishJob('awaiting_second_round');
 await f.controller.inspect();assert.equal(f.sent.length,0);
 await f.controller.start();assert.equal(f.sent.length,1);assert.equal(f.sent[0].confirm,'PRODUCTION EVENT BATCH APPEND');
});
test('changed reviewed inputs cannot reuse a partially submitted job',async()=>{
 const f=fixture({loseStart:true});await assert.rejects(f.controller.start());f.changeGoals();
 await assert.rejects(f.controller.start(),/前回送信したゴール/);assert.equal(f.sent.length,1);
});
test('TEST inspection evidence cannot be used to enable production registration',async()=>{
 const f=fixture();f.setPhase('later');const job=f.publishJob('awaiting_second_round');job.environment='TEST';
 await assert.rejects(f.controller.start(),/本番の保存済み/);assert.equal(f.sent.length,0);
});

test('changed inputs during release checks fail before a write',async()=>{
 const options={},f=fixture(options);options.onRead=()=>f.changeGoals();
 await assert.rejects(f.controller.start(),/登録内容が変更/);assert.equal(f.sent.length,0);
});
test('same-page explicit tie decision completes only the inspected current fixture',async()=>{
 const f=fixture();f.setPhase('later');const job=f.publishJob('needs_decision');
 job.decision={seq:3,match_id:M[2],left_team:'Team 2',right_team:'Team 4',left_score:0,right_score:0,choices:['left','right','draw']};
 await f.controller.inspect();assert.equal(f.sent.length,0);
 await f.controller.decide('draw');
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].confirm,'PRODUCTION EVENT BATCH DECISION');
 assert.equal(f.sent[0].seq,3);assert.equal(f.sent[0].winner,'draw');
 assert.match(f.statuses.at(-1),/登録完了/);
});
test('unknown decision response retains its intent and prevents a repeated result write',async()=>{
 const f=fixture({loseDecision:true});f.setPhase('later');const job=f.publishJob('needs_decision');
 job.decision={seq:3,match_id:M[2],left_team:'Team 2',right_team:'Team 4',left_score:0,right_score:0,choices:['left','right','draw']};
 await f.controller.inspect();await assert.rejects(f.controller.decide('draw'),/lost decision/);
 await f.controller.inspect();await assert.rejects(f.controller.decide('draw'),/送信済みの可能性/);
 assert.equal(f.sent.length,1);
});
test('completed receipt must identify an official goal in its exact match',async()=>{
 const f=fixture();f.setPhase('done');const job=f.publishJob('completed');
 job.goal_receipts=[{official_goal_id:id(99),official_match_id:M[0]}];
 await assert.rejects(f.controller.inspect(),/公式記録/);assert.equal(f.sent.length,0);
});

test('event changes while official reads are in flight cannot dispatch a job',async()=>{
 const options={},f=fixture(options);options.onRead=()=>f.switchEvent();
 await assert.rejects(f.controller.start(),/イベントが変更/);assert.equal(f.sent.length,0);
});
test('a tie decision also rejects changed known fixture IDs from the saved job',async()=>{
 const f=fixture();f.setPhase('later');const job=f.publishJob('needs_decision');
 job.decision={seq:3,match_id:M[2],left_team:'Team 2',right_team:'Team 4',left_score:0,right_score:0,choices:['left','right','draw']};
 job.fixture_ids[1]=id(999);
 await f.controller.inspect();await assert.rejects(f.controller.decide('draw'),/公式試合ID/);assert.equal(f.sent.length,0);
});
