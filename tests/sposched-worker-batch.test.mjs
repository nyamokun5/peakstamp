import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWorkerTournament,workerBatchStorageKey} from '../sposched-worker-batch.mjs';
const eventId='01234567-89ab-4cde-8abc-0123456789ab';
const requestId='11234567-89ab-4cde-8abc-0123456789ab';
const snapshot={
 eventId,matches:[
  {seq:1,status:'scheduled',matchId:'a'},
  {seq:2,status:'scheduled',matchId:'b'},
  {seq:3,status:'waiting',matchId:'c'},
  {seq:4,status:'waiting',matchId:'d'}
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
  {seq:1,action:'create',team:'White',scorer:'Aki',assist:'Sora'},
  {seq:1,action:'finish',winner:'auto'},
  {seq:2,action:'finish',winner:'auto'},
  {seq:3,action:'finish',winner:'auto'},
  {seq:4,action:'create',team:'Red',scorer:'Mika',assist:''},
  {seq:4,action:'finish',winner:'auto'}
 ]);
 assert.equal(workerBatchStorageKey(eventId),'peakstamp:test:worker-batch:'+eventId);
});
test('accepts explicit semi-final tie winner but rejects semifinal draw',()=>{
 const p=build({winnerFor:seq=>seq===1?'right':''});
 assert.equal(p.operations[1].winner,'right');
 assert.throws(()=>build({winnerFor:seq=>seq===1?'draw':''}),/勝敗指定/);
});
test('waiting-goal rows require explicit human confirmation of match, scorer and assist',()=>{
 const changed=rows.map(x=>({...x}));
 changed[1].quickReviewedAll=false;
 assert.throws(()=>build({rows:changed}),/明示的/);
 changed[1].quickReviewedFields={match:true,scorer:true,assist:true};
 assert.equal(build({rows:changed}).operations.length,6);
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
