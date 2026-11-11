import test from 'node:test';
import assert from 'node:assert/strict';
import {goalSelectionStorageKey,saveConfirmedGoalSelection,restoreConfirmedGoalSelections} from '../sposched-goal-selection-draft.mjs';

const E='11111111-1111-4111-8111-111111111111';
const F='22222222-2222-4222-8222-222222222222';
const G='33333333-3333-4333-8333-333333333333';
const P1='44444444-4444-4444-8444-444444444444';
const P2='55555555-5555-4555-8555-555555555555';
const store=()=>{const data=new Map();return {
 getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),
 removeItem:k=>data.delete(k)
}};
const snapshot=()=>({
 eventId:E,rosterSource:'official-current-event-teams',
 matches:[{seq:1,matchId:F,leftTeam:'チーム1',rightTeam:'チーム2',status:'scheduled'}],
 players:['西村','山口','田中'],playerTeam:new Map([['西村','チーム2'],['山口','チーム2'],['田中','チーム1']]),
 playerIds:new Map([['西村',P1],['山口',P2]])
});
const source={name:'IMG_1234.mov',size:1000000,lastModified:1794160000000};
const original=()=>({
 key:'IMG_1234.mov::goal-1',seq:1,include:true,
 goal:{id:'goal-1',source,scorer:'よーさん',assist:'やまさん',
  assistStatus:'named',goalTimeSeconds:100},
 scorer:'',assist:'',assistMode:'named',team:'',
 matchGuess:{confidence:'high',seq:1},scorerGuess:{confidence:'none'}
});
const edited=()=>({...original(),scorer:'西村',assist:'山口',assistMode:'named',team:'チーム2',
 quickEdited:true,quickReviewedFields:{scorer:true,assist:true,match:true}});
test('reviewed scorer and assist survive a page reload in same SS TEST event/fixture',()=>{
 const mem=store(),s=snapshot(),row=edited();
 assert.equal(saveConfirmedGoalSelection(mem,s,row),true);
 const loaded=restoreConfirmedGoalSelections(mem,s,[original()])[0];
 assert.equal(loaded.scorer,'西村');
 assert.equal(loaded.assist,'山口');
 assert.equal(loaded.team,'チーム2');
 assert.equal(loaded.quickReviewedFields.scorer,true);
 assert.equal(loaded.quickReviewedFields.assist,true);
 assert.equal(loaded.quickReviewedFields.match,true);
 assert.equal(loaded.draftRestored,true);
});
test('SS bracket reset with changed match UUID shows previous names but does not approve them',()=>{
 const mem=store(),s=snapshot();
 assert.equal(saveConfirmedGoalSelection(mem,s,edited()),true);
 const newer=snapshot();newer.matches[0].matchId=G;
 const row=restoreConfirmedGoalSelections(mem,newer,[original()])[0];
 assert.equal(row.scorer,'');
 assert.equal(row.assist,'');
 assert.deepEqual(row.previousGoalSelection,{scorer:'西村',assist:'山口',assistMode:'named',team:'チーム2'});
 assert.equal(row.quickReviewedFields,undefined);
});
test('SS roster/team change cannot approve an old player identity',()=>{
 const mem=store(),s=snapshot();
 saveConfirmedGoalSelection(mem,s,edited());
 const newer=snapshot();newer.playerTeam.set('西村','チーム1');
 const row=restoreConfirmedGoalSelections(mem,newer,[original()])[0];
 assert.equal(row.scorer,'');
 assert.equal(row.previousGoalSelection.scorer,'西村');
});
test('changed official player ID never silently maps to the same display name',()=>{
 const mem=store(),s=snapshot();saveConfirmedGoalSelection(mem,s,edited());
 const newer=snapshot();newer.playerIds.set('西村',G);
 const row=restoreConfirmedGoalSelections(mem,newer,[original()])[0];
 assert.equal(row.scorer,'');
 assert.equal(row.previousGoalSelection.scorer,'西村');
});
test('wrong SS event, video source or goal timestamp never inherits another draft',()=>{
 const mem=store(),s=snapshot();saveConfirmedGoalSelection(mem,s,edited());
 const other={...snapshot(),eventId:G};
 assert.equal(restoreConfirmedGoalSelections(mem,other,[original()])[0].draftRestored,undefined);
 const another=original();another.goal={...another.goal,source:{...source,lastModified:source.lastModified+1}};
 assert.equal(restoreConfirmedGoalSelections(mem,s,[another])[0].draftRestored,undefined);
 const shifted=original();shifted.goal={...shifted.goal,goalTimeSeconds:140};
 assert.equal(restoreConfirmedGoalSelections(mem,s,[shifted])[0].draftRestored,undefined);
});
test('unknown roster identities, unapproved AI guesses and non-TEST snapshots cannot be stored',()=>{
 const mem=store(),s=snapshot();
 assert.equal(saveConfirmedGoalSelection(mem,s,{...edited(),scorer:'偽名'}),false);
 assert.equal(saveConfirmedGoalSelection(mem,s,{...edited(),quickEdited:false}),false);
 assert.equal(saveConfirmedGoalSelection(mem,snapshot(),original()),false);
 assert.equal(saveConfirmedGoalSelection(mem,{...s,rosterSource:'historical-fallback'},edited()),false);
});
test('assist-none is restored only after an explicit no-assist choice',()=>{
 const mem=store(),s=snapshot();
 const row={...edited(),assistMode:'none',assist:''};
 saveConfirmedGoalSelection(mem,s,row);
 const loaded=restoreConfirmedGoalSelections(mem,s,[original()])[0];
 assert.equal(loaded.assistMode,'none');
 assert.equal(loaded.assist,'');
 assert.equal(loaded.quickReviewedFields.assist,true);
});
test('storage corruption does not crash review and names remain independently visible in video data',()=>{
 const mem=store(),s=snapshot(),row=original();
 const key=goalSelectionStorageKey(E,row);
 mem.setItem(key,'{oops');
 const loaded=restoreConfirmedGoalSelections(mem,s,[row])[0];
 assert.equal(loaded.goal.scorer,'よーさん');
 assert.equal(loaded.scorer,'');
});
