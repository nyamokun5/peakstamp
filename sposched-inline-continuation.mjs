// Rebind confirmed identities only after matching the active generation to ALL
// official fixtures. Recreating a fixture never authorizes a changed player.
import {resolveAnalysisGoal,verifiedAnalysisPerson} from './sposched-analysis-identity.mjs';
import {prepareGoalRows} from './sposched-review-core.mjs';
import {buildInlineSecondRoundPlan} from './sposched-inline-plan.mjs';
export function prepareInlineContinuation({snapshot,goals,workerJob}){
 if(workerJob?.event_id!==snapshot?.eventId||workerJob.status!=='awaiting_second_round')
  throw Error('後半登録待ちのジョブを確認できません');
 for(const seq of [1,2,3,4]){
  const matches=snapshot.matches.filter(m=>Number(m.seq)===seq);
  if(matches.length!==1||!workerJob.fixture_ids?.[seq]||matches[0].matchId!==workerJob.fixture_ids[seq])
   throw Error('現在の試合IDと登録ジョブが一致しません。再送しないでください');
 }
 if(!Array.isArray(goals?.goals)||goals.goals.some(g=>![1,2,3,4].includes(Number(g.matchSeq))))
  throw Error('全ゴールの試合番号を確認してください');
 const later=goals.goals.filter(g=>[3,4].includes(Number(g.matchSeq))).map(g=>{
  if(!g.ssIdentity)return g; // Canonical planner still demands verified names.
  const old=g.ssIdentity,seq=Number(g.matchSeq);
  if(old.environment!=='staging'||old.eventId!==snapshot.eventId||old.seq!==seq)
   throw Error('後半ゴールのイベント・試合番号が一致しません');
  const fields=['scorer',...(g.assistStatus==='named'?['assist']:[])];
  for(const field of fields){
   const person=old[field],name=g[field];
   if(!person||person.name!==name||!person.memberId||!person.playerId||
      snapshot.memberIds?.get(name)!==person.memberId||snapshot.playerIds?.get(name)!==person.playerId||
      snapshot.playerTeam?.get(name)!==person.team)
    throw Error('後半ゴールの選手・所属が変わっています。名簿を確認してください');
  }
  // Pin the already-confirmed exact player; never guess again from aliases.
  // resolveAnalysisGoal independently checks the freshly published opponents.
  const resolved=resolveAnalysisGoal({...g,userEditedGoalFields:fields},{snapshot,aliases:[]});
  for(const field of fields)if(!verifiedAnalysisPerson(resolved,snapshot,seq,field))
   throw Error('動画とSSの後半対戦カード・選手を照合できません');
  return resolved;
 });
 const rows=prepareGoalRows({goals:later},snapshot);
 return buildInlineSecondRoundPlan({snapshot,rows,workerJob});
}
