/** TEST-only read-only preflight for fixtures 1 and 2.
 * Waiting third-place/final goals must not block this stage.
 * This module never starts a Worker job or mutates SS.
 */
import {inferFirstRoundBracket} from './sposched-inline-bracket.mjs';
import {quickGoalDecisions} from './sposched-quick-review.mjs';
export function inspectFirstRound(snapshot,rows){
 if(!snapshot?.eventId||!Array.isArray(rows))throw Error('SSイベントとゴールを取得してください');
 const firstRows=rows.filter(row=>row?.include!==false&&[1,2].includes(Number(row.seq)));
 const bracket=inferFirstRoundBracket(snapshot,firstRows);
 const decisions=quickGoalDecisions(snapshot,firstRows);
 const invalid=decisions.find(d=>d.state!=='ready');
 if(invalid)throw Error('第1・第2試合のゴール'+(invalid.index+1)+'：'+invalid.reason);
 if(!bracket.ready)throw Error('第1・第2試合の勝者が未確定です');
 for(const seq of [1,2]){
  const fixture=snapshot.matches.find(m=>Number(m.seq)===seq);
  if(!fixture?.matchId||fixture.status!=='scheduled'||!fixture.leftTeam||!fixture.rightTeam)
   throw Error('第'+seq+'試合の正式な登録先を確認できません');
 }
 return {bracket,firstRows,decisions};
}
