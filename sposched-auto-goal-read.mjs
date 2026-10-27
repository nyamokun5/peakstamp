// Exactly one parallel pair of read-only SpoSched calls before a reviewed
// TEST goal's single signed preview + single write. No write is in this module.
import {normalizeTeam} from './sposched-review-core.mjs';

export async function resolveAutoGoalRead({snapshot,operation,readSnapshot,readMatch,
 normalizeSnapshot,assertNumbered,toAction}){
 if(!snapshot?.eventId||!operation?.args||operation.action!=='record_goal')
  throw Error('TEST新規ゴールの正式な確認内容がありません');
 const seq=Number(operation.args.seq);
 const expected=snapshot.matches?.find(m=>m.seq===seq);
 if(!Number.isInteger(seq)||seq<1||!expected?.matchId)
  throw Error('TESTの正式な試合番号を再取得してください');
 // Two *independent* authenticated reads can be concurrent: neither mutates.
 const [snapshotData,match]=await Promise.all([
  readSnapshot(snapshot.eventId),readMatch(expected.matchId)
 ]);
 const latest=normalizeSnapshot(snapshotData);
 assertNumbered(snapshot,latest,seq);
 const current=latest.matches.find(m=>m.seq===seq);
 if(match?.match_id!==current.matchId||match.event_id!==snapshot.eventId||
    match.status!==current.status||match.status!=='scheduled'||
    normalizeTeam(match.left?.name)!==normalizeTeam(current.leftTeam)||
    normalizeTeam(match.right?.name)!==normalizeTeam(current.rightTeam))
  throw Error('試合の状態・対戦相手・正式IDが変わりました。再取得してください');
 const action=toAction(snapshot,operation,match);
 if(action.action!=='create'||action.match_id!==match.match_id)
  throw Error('自動ゴールの書き込み先が正式試合と一致しません');
 // This exact before-image is persisted to the recovery journal immediately
 // BEFORE the POST, so a second /match GET is unnecessary.
 return {action,before:match};
}
