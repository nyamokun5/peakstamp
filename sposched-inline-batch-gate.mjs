/** Read-only pre-submit gate. Does not create jobs or mutate SS.
 * Rejects a stale or contradictory official bracket before a single write.
 */
import {projectFourMatchTournament} from './sposched-inline-tournament.mjs';
const norm=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\s\u3000]/g,'');
export function validateInlineBatchReadiness(snapshot,rows){
 const result=projectFourMatchTournament(snapshot,rows);
 if(!result.ready)throw Error('第1・第2試合の引き分けは勝者を指定してください');
 if(!result.complete)throw Error('第3・第4試合の引き分けは勝者を指定してください');
 if(!snapshot.eventId)throw Error('SSイベントが未確定です');
 const fixtures=new Map(snapshot.matches.map(m=>[Number(m.seq),m]));
 for(const seq of [1,2,3,4]){
  const fixture=fixtures.get(seq);
  if(!fixture||!['scheduled','waiting'].includes(fixture.status))
   throw Error('第'+seq+'試合の状態が変更されました。SSを再取得してください');
  if(seq>2&&fixture.leftTeam&&fixture.rightTeam){
   const expected=seq===3?result.thirdPlace:result.final;
   const actual=[fixture.leftTeam,fixture.rightTeam].map(norm);
   if(!expected.every(t=>actual.includes(norm(t)))||actual[0]===actual[1])
    throw Error('第'+seq+'試合の正式対戦カードが計算結果と一致しません');
  }
 }
 return result;
}
