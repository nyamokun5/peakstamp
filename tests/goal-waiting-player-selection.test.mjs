import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCard,inheritVideoMatchupConfirmation} from '../match-review.mjs';
import {saveVideoMatchup} from '../video-matchup.mjs';
import {matchStorageKey} from '../match-label.mjs';
import {saveGoalDrafts,confirmedGoalExport} from '../goal-stats.mjs';
import {prepareGoalRows} from '../sposched-review-core.mjs';
import {fixturePeople,resolveAnalysisGoal,verifiedAnalysisPerson} from '../sposched-analysis-identity.mjs';
const uuid=n=>String(n).repeat(8)+'-1111-4111-8111-111111111111';
const source={file:{name:'third.mov',size:1,lastModified:1},matchNumber:3};
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}};
const goal=()=>({matchSeq:'3',teamA:'チーム2',teamB:'チーム4',scorer:'未照合',rawScorer:'未照合',assistStatus:'none',status:'draft'});
const snapshot=()=>({environment:'production',eventId:uuid(1),rosterSource:'official-current-event-teams',
 matches:[1,2,3,4].map(seq=>({seq,matchId:seq<3?uuid(seq+2):'',status:seq<3?'scheduled':'waiting',leftTeam:'',rightTeam:''})),
 players:['選手2','選手4','他チーム'],playerTeam:new Map([['選手2','チーム2'],['選手4','チーム4'],['他チーム','チーム1']]),
 memberIds:new Map([['選手2',uuid(5)],['選手4',uuid(6)],['他チーム',uuid(7)]]),
 playerIds:new Map([['選手2',uuid(8)],['選手4',uuid(9)],['他チーム',uuid(2)]])});

test('third-game roster uses the manually confirmed video pairing before SS issues its match ID',()=>{
 const store=storage(),ss=snapshot();
 saveVideoMatchup(source,store,'2','4');
 const item=inheritVideoMatchupConfirmation(goal(),source,store);
 assert.equal(item.matchupConfirmed,true);
 assert.deepEqual(fixturePeople(ss,3,item),['選手2','選手4']);
 const resolved=resolveAnalysisGoal({...item,scorer:'選手2',userEditedGoalFields:['scorer']},{environment:'production',snapshot:ss,aliases:[]});
 assert.equal(resolved.ssIdentity.scorer.memberId,uuid(5));
 assert.equal(resolved.ssIdentity.matchId,'');
 assert.equal(verifiedAnalysisPerson(resolved,ss,3,'scorer')?.name,'選手2');
 ss.matches[2]={...ss.matches[2],status:'scheduled',matchId:uuid(4),leftTeam:'チーム1',rightTeam:'チーム4'};
 assert.equal(verifiedAnalysisPerson(resolved,ss,3,'scorer'),null,'published official opponents still invalidate conflicting identities');
});
test('AI-only, changed pairing, different match number and same-team cards stay unconfirmed',()=>{
 const store=storage(),item=goal();
 assert.equal(inheritVideoMatchupConfirmation(item,source,store),item);
 store.setItem('peakstamp_matchup_v1:third.mov::1::1',JSON.stringify({origin:'audio',teamA:'2',teamB:'4'}));
 assert.equal(inheritVideoMatchupConfirmation(item,source,store),item);
 saveVideoMatchup(source,store,'2','4');
 for(const changed of [{...item,teamB:'チーム3'},{...item,matchSeq:'4'}])
  assert.equal(inheritVideoMatchupConfirmation(changed,source,store),changed);
 saveVideoMatchup(source,store,'2','2');
 assert.equal(inheritVideoMatchupConfirmation({...item,teamB:'チーム2'},source,store).matchupConfirmed,undefined);
});
test('explicit match-card confirmation enables roster selection and clears old identities',()=>{
 const item=applyCard({...goal(),ssIdentity:{scorer:{memberId:uuid(7)}}},{seq:3,a:'チーム2',b:'チーム4'});
 assert.equal(item.matchupConfirmed,true);
 assert.equal(item.ssIdentity,null);
 assert.deepEqual(fixturePeople(snapshot(),3,item),['選手2','選手4']);
});
test('previously saved match-review cards also unlock existing goal drafts without another tap',()=>{
 const store=storage(),item=goal();
 store.setItem('peakstamp_card_v1:'+matchStorageKey(source),JSON.stringify({seq:3,a:'2',b:'4'}));
 assert.equal(inheritVideoMatchupConfirmation(item,source,store).matchupConfirmed,true);
 store.setItem('peakstamp_card_v1:'+matchStorageKey(source),JSON.stringify({seq:4,a:'2',b:'4'}));
 assert.equal(inheritVideoMatchupConfirmation(item,source,store),item);
});
test('same-page registration export preserves reviewed waiting matchup and official player identity',()=>{
 const store=storage(),ss=snapshot();
 const item=resolveAnalysisGoal({...goal(),id:'g3',origin:'audio',timeSeconds:30,goalTimeSeconds:20,
  videoDecision:'kept',matchupConfirmed:true,scorer:'選手2',userEditedGoalFields:['scorer']},
  {environment:'production',snapshot:ss,aliases:[]});
 saveGoalDrafts(source,store,[item]);
 const exported=confirmedGoalExport([source],store);
 assert.equal(exported.goals.length,1);
 assert.equal(exported.goals[0].matchupConfirmed,true);
 assert.equal(prepareGoalRows(exported,ss)[0].scorer,'選手2');
});
