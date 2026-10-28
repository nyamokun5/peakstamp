import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWorkerTournament,workerBatchStorageKey,hasRecreatedBracket,workerBatchRecreatePendingKey} from '../sposched-worker-batch.mjs';
const eventId='01234567-89ab-4cde-8abc-0123456789ab';
const requestId='11234567-89ab-4cde-8abc-0123456789ab';
const ids=['21234567-89ab-4cde-8abc-0123456789ab',
 '31234567-89ab-4cde-8abc-0123456789ab',
 '41234567-89ab-4cde-8abc-0123456789ab',
 '51234567-89ab-4cde-8abc-0123456789ab'];
const snapshot={
 eventId,matches:[
  {seq:1,status:'scheduled',matchId:ids[0]},
  {seq:2,status:'scheduled',matchId:ids[1]},
  {seq:3,status:'waiting',matchId:ids[2]},
  {seq:4,status:'waiting',matchId:ids[3]}
 ],playerTeam:new Map([['Aki','White'],['Sora','White'],['Mika','Red']])
};
const rows=[
 {include:true,seq:1,team:'White',scorer:'Aki',assistMode:'named',assist:'Sora'},
 {include:true,seq:4,team:'Red',scorer:'Mika',assistMode:'none',assist:'',
  quickReviewedAll:true},
 {include:false,seq:2,team:'White',scorer:'Aki',assistMode:'none'}
];
const decisions=[{state:'ready'},{state:'waiting'},{state:'skipped'}];
const build=(overrides={})=>prepareWorkerTournament({
 snapshot,rows,decisions,requestId,...overrides
});
test('sends 4 official numbered fixtures in order, including explicitly reviewed future slot',()=>{
 const p=build();
 assert.equal(p.event_id,eventId);assert.equal(p.request_id,requestId);
 assert.equal(p.confirm,'TEST-ONLY BATCH WRITE');
 assert.deepEqual(p.operations,[
  {seq:1,action:'create',team:'White',scorer:'Aki',assist:'Sora',expected_match_id:ids[0]},
  {seq:1,action:'finish',winner:'auto',expected_match_id:ids[0]},
  {seq:2,action:'finish',winner:'auto',expected_match_id:ids[1]},
  {seq:3,action:'finish',winner:'auto',expected_match_id:ids[2]},
  {seq:4,action:'create',team:'Red',scorer:'Mika',assist:'',expected_match_id:ids[3]},
  {seq:4,action:'finish',winner:'auto',expected_match_id:ids[3]}
 ]);
 assert.equal(workerBatchStorageKey(eventId),'peakstamp:test:worker-batch:'+eventId);
});
test('accepts explicit semi-final tie winner but rejects semifinal draw',()=>{
 const p=build({winnerFor:seq=>seq===1?'right':''});
 assert.equal(p.operations[1].winner,'right');
 assert.throws(()=>build({winnerFor:seq=>seq===1?'draw':''}),/勝敗指定/);
});
test('waiting knockout goal needs no extra button when its match and scorer are reliable',()=>{
 const changed=rows.map(x=>({...x}));
 changed[1].quickReviewedAll=false;
 changed[1].matchGuess={seq:4,confidence:'high',ambiguous:false,conflict:false};
 changed[1].scorerGuess={confidence:'high'};
 assert.equal(build({rows:changed}).operations.length,6,
  'official opponents may be waiting: a reliable goal still joins the batch');
 changed[1].matchGuess={seq:4,confidence:'low'};
 assert.throws(()=>build({rows:changed}),/試合番号を確認/);
 changed[1].quickReviewedFields={match:true};
 assert.equal(build({rows:changed}).operations.length,6,
  'an uncertain match only needs its own explicit correction');
 changed[1].scorer='Not-on-roster';
 assert.throws(()=>build({rows:changed}),/名簿/);
});
test('no unreviewed, mismatched, unsupported or duplicated goal can enter Worker batch',()=>{
 assert.throws(()=>build({decisions:[{state:'attention',reason:'得点者不明'},...decisions.slice(1)]}),/得点者不明/);
 assert.throws(()=>build({rows:[{...rows[0],team:'Red'},...rows.slice(1)]}),/所属/);
 assert.throws(()=>build({rows:[{...rows[0],guest:true},...rows.slice(1)]}),/未対応/);
 assert.throws(()=>build({rows:[rows[0],rows[0],rows[1]],decisions:[
  {state:'ready'},{state:'ready'},{state:'waiting'}
 ]}),/複数/);
 assert.throws(()=>build({snapshot:{...snapshot,matches:[
  {...snapshot.matches[0],status:'finished'},...snapshot.matches.slice(1)]
 }}),/終了/);
 assert.throws(()=>build({requestId:'not-uuid'}),/イベント/);
});
test('unassigned included video goal cannot silently disappear from approval',()=>{
 const changed=[...rows,{include:true,scorer:'Aki',team:'White',assistMode:'none'}];
 assert.throws(()=>build({rows:changed,decisions:[...decisions,{state:'ready'}]}),/試合番号/);
});

test('a scheduled fixture cannot start without the approved official match UUID',()=>{
 const mismatched={...snapshot,matches:snapshot.matches.map(m=>m.seq===1?{...m,matchId:''}:m)};
 assert.throws(()=>build({snapshot:mismatched}),/match_id/);
});

test('a truly recreated four-fixture bracket is distinct from every known old Worker UUID',()=>{
 const prev={
  event_id:eventId,request_id:'11234567-89ab-4cde-8abc-0123456789ab',status:'completed',
  fixture_ids:{'1':ids[0],'2':ids[1],'3':ids[2],'4':ids[3]}
 };
 const recreated={...snapshot,matches:snapshot.matches.map((m,i)=>({
  ...m,matchId:[
   '61234567-89ab-4cde-8abc-0123456789ab',
   '71234567-89ab-4cde-8abc-0123456789ab',
   '81234567-89ab-4cde-8abc-0123456789ab',
   '91234567-89ab-4cde-8abc-0123456789ab'
  ][i]
 }))};
 assert.equal(hasRecreatedBracket(prev,recreated),true);
 assert.equal(hasRecreatedBracket(prev,snapshot),false);
 assert.equal(hasRecreatedBracket({...prev,event_id:'not-the-event'},recreated),false);
 assert.equal(hasRecreatedBracket({...prev,fixture_ids:{}},recreated),false);
 assert.equal(hasRecreatedBracket(prev,{...recreated,matches:recreated.matches.slice(0,3)}),false);
 assert.equal(workerBatchRecreatePendingKey(eventId),
  'peakstamp:test:worker-batch:recreate-pending:'+eventId);
});

test('completion requires fresh same-event finished fixtures with original identities',async()=>{
 const {verifyCompletedWorkerSnapshot:verify}=await import('../sposched-worker-batch.mjs');
 const state={event_id:eventId,status:'completed',fixture_ids:Object.fromEntries(ids.map((id,i)=>[i+1,id]))};
 const fresh={...snapshot,matches:snapshot.matches.map(m=>({...m,status:'finished'}))};
 assert.equal(verify(state,fresh,snapshot),true);
 for(const changed of [
  {...fresh,eventId:requestId},
  {...fresh,matches:fresh.matches.slice(0,3)},
  {...fresh,matches:fresh.matches.map(m=>m.seq===3?{...m,status:'waiting'}:m)},
  {...fresh,matches:fresh.matches.map(m=>m.seq===4?{...m,matchId:requestId}:m)},
  {...fresh,matches:[fresh.matches[0],fresh.matches[0],...fresh.matches.slice(2)]}
 ])assert.throws(()=>verify(state,changed,snapshot));
});
