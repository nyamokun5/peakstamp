import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpoSnapshot,prepareGoalRows} from '../sposched-review-core.mjs';
import {fixturePeople,resolveAnalysisGoal,verifiedAnalysisPerson,officialAnalysisPerson} from '../sposched-analysis-identity.mjs';
import {saveGoalDrafts,confirmedGoalExport} from '../goal-stats.mjs';
import {quickGoalDecisions} from '../sposched-quick-review.mjs';
import {aliasIntentsForCommittedGoal} from '../sposched-goal-commit-alias.mjs';

const id=n=>n.toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111';
const guest='正式_guest',eventId=id(1),playerId=id(2);
function raw(){return {environment:'PRODUCTION',event_id:eventId,roster_source:'official-current-event-teams',
 matches:[1,2,3,4].map(seq=>({seq,match_id:seq<3?id(seq+2):'',status:seq<3?'scheduled':'waiting',
  left_team:seq===1?'チーム1':seq===2?'チーム3':'',right_team:seq===1?'チーム2':seq===2?'チーム4':'',goals:[]})),
 roster:{チーム1:['登録選手'],チーム2:['相手選手'],チーム3:['別選手'],チーム4:[guest]},
 roster_players:[{name:guest,team:'チーム4',type:'guest',player_id:playerId,user_id:null}]};}
const goal=()=>({id:'g4',origin:'audio',status:'confirmed',videoDecision:'kept',timeSeconds:30,goalTimeSeconds:20,
 matchSeq:'4',matchupConfirmed:true,teamA:'チーム2',teamB:'チーム4',scorer:guest,rawScorer:guest,
 assistStatus:'none',userEditedGoalFields:['scorer']});
const resolved=ss=>resolveAnalysisGoal(goal(),{environment:'production',snapshot:ss,aliases:[]});

test('official event guest resolves and transfers to waiting final without a member ID',()=>{
 const ss=normalizeSpoSnapshot(raw());
 assert.equal(ss.memberIds,undefined,'guest-only IDs must not require an empty member map');
 assert.equal(ss.playerTypes.get(guest),'guest');
 assert.deepEqual(fixturePeople(ss,4,goal()),[guest]);
 const g=resolved(ss);
 assert.deepEqual(g.ssIdentity.scorer,{name:guest,type:'guest',memberId:null,playerId,team:'チーム4',manual:true});
 assert.equal(verifiedAnalysisPerson(g,ss,4,'scorer')?.name,guest);
 const rows=prepareGoalRows({goals:[g]},ss);
 assert.equal(rows[0].scorer,guest);assert.equal(rows[0].guest,false,'official roster participant is not ad-hoc guest-entry mode');
 assert.equal(quickGoalDecisions(ss,rows)[0].state,'waiting');
});
test('guest identity survives saved goal export and binds to a newly issued official final ID',()=>{
 const ss=normalizeSpoSnapshot(raw()),g=resolved(ss),data=new Map();
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 const source={file:{name:'final.mov',size:1,lastModified:1},matchNumber:4};
 saveGoalDrafts(source,storage,[g]);
 const exported=confirmedGoalExport([source],storage);
 assert.equal(prepareGoalRows(exported,ss)[0].scorer,guest);
 const official=normalizeSpoSnapshot(raw());
 official.matches[3]={...official.matches[3],matchId:id(20),status:'scheduled',leftTeam:'チーム2',rightTeam:'チーム4'};
 assert.equal(verifiedAnalysisPerson(g,official,4,'scorer'),null,'new official fixture needs fresh identity resolution');
 const fresh=resolveAnalysisGoal(exported.goals[0],{environment:'production',snapshot:official,aliases:[]});
 assert.equal(fresh.ssIdentity.matchId,id(20));
 assert.equal(verifiedAnalysisPerson(fresh,official,4,'scorer')?.playerId,playerId);
 assert.equal(prepareGoalRows({goals:[fresh]},official)[0].scorer,guest);
});
test('name suffix, unknown type, missing player UUID and fallback roster never establish a guest identity',()=>{
 for(const change of [r=>{delete r.roster_players[0].type},r=>{r.roster_players[0].type='member'},
  r=>{r.roster_players[0].type='child'},r=>{r.roster_players[0].player_id=null},
  r=>{r.roster_source='event-embedded-fallback'}]){
  const r=raw();change(r);const ss=normalizeSpoSnapshot(r);
  assert.equal(officialAnalysisPerson(ss,guest),null);
  assert.equal(resolved(ss).ssIdentity.scorer,null);
 }
});
test('event, team, type and player ID changes invalidate previously verified guest identities',()=>{
 const ss=normalizeSpoSnapshot(raw()),g=resolved(ss);
 const changes=[s=>{s.eventId=id(25)},s=>{s.environment='staging'},s=>{s.playerIds.set(guest,id(26))},
  s=>{s.playerTypes.set(guest,'member')},s=>{s.playerTypes.delete(guest)},s=>{s.playerTeam.set(guest,'チーム1')},
  s=>{s.matches[3].seq=3}];
 for(const change of changes){const current=normalizeSpoSnapshot(raw());change(current);assert.equal(verifiedAnalysisPerson(g,current,4,'scorer'),null);}
 const forged={...g,ssIdentity:{...g.ssIdentity,scorer:{...g.ssIdentity.scorer,type:undefined}}};
 assert.equal(verifiedAnalysisPerson(forged,ss,4,'scorer'),null);
});
test('conflicting current guest metadata and reused event player IDs fail closed',()=>{
 for(const change of [r=>{r.roster_players.push({...r.roster_players[0],type:'member'})},
  r=>{r.roster_players.push({...r.roster_players[0],player_id:id(99)})},
  r=>{r.roster['チーム4'].push('別のguest');r.roster_players.push({...r.roster_players[0],name:'別のguest'})}]){
  const r=raw();change(r);const ss=normalizeSpoSnapshot(r);
  assert.equal(officialAnalysisPerson(ss,guest),null);
 }
});
test('registered members still require both UUIDs and retain their existing identity shape',()=>{
 const r=raw();r.roster_players[0]={...r.roster_players[0],type:'member',user_id:id(30)};
 const ss=normalizeSpoSnapshot(r),g=resolved(ss);
 assert.equal(g.ssIdentity.scorer.memberId,id(30));assert.equal('type' in g.ssIdentity.scorer,false);
 const current=normalizeSpoSnapshot(r);current.memberIds.delete(guest);
 assert.equal(officialAnalysisPerson(current,guest),null);assert.equal(verifiedAnalysisPerson(g,current,4,'scorer'),null);
});
test('a current-event guest cannot acquire a shared member alias merely through a selected display name',()=>{
 const ss=normalizeSpoSnapshot(raw()),g=resolved(ss),row=prepareGoalRows({goals:[g]},ss)[0];
 row.goal.rawScorer='別の呼び名';row.quickReviewedAll=true;
 assert.deepEqual(aliasIntentsForCommittedGoal({row,snapshot:ss,goalVerified:true}),[]);
 ss.memberIds=new Map([[guest,id(30)]]);
 const withAccount=resolved(ss),sameGuest=prepareGoalRows({goals:[withAccount]},ss)[0];
 sameGuest.goal.rawScorer='別の呼び名';sameGuest.quickReviewedAll=true;
 assert.equal(withAccount.ssIdentity.scorer.type,'guest');
 assert.deepEqual(aliasIntentsForCommittedGoal({row:sameGuest,snapshot:ss,goalVerified:true}),[]);
});
