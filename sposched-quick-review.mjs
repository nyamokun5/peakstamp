/** Primary TEST-only workflow: verified video goals -> one batch approval.
 * This module only prepares summaries and already-validated operations.
 * It does not issue network requests or grant permission to write.
 */
import {
 normalizePerson,normalizeTeam,validateGoalRow,matchingExistingGoals,buildReviewPayload
} from './sposched-review-core.mjs';

export function quickGoalDecisions(snapshot,rows) {
 const decisions=(rows||[]).map((row,index)=>{
  const g=row.goal||{};
  const item={index,key:row.key,source:g.source?.name||'',time:g.goalTimeSeconds??null,
    seq:row.seq,team:row.team||'',scorer:row.scorer||'',
    assist:row.assistMode==='named'?row.assist||'':'なし',
    state:'attention',reason:'確認が必要です'};
  if(g.manual)return {...item,state:'manual',reason:'手動入力は詳細モードで扱います'};
  if(row.updateGoalId)return {...item,state:'patch',reason:'既存ゴールの修正は詳細モードで扱います'};
  if(!row.include)return {...item,state:'skipped',reason:'登録対象から除外済み'};
  if(matchingExistingGoals(row,snapshot).length)
   return {...item,state:'duplicate',reason:'SSに同じ得点者・アシストの組み合わせがあります'};
  if(row.guest)return {...item,reason:'ゲスト得点は現在のTEST一括登録で対応していません'};
  const issue=validateGoalRow({...row,confirmed:true},snapshot);
  if(issue)return {...item,reason:issue};
  const manualCorrection=row.quickEdited===true;
  if(!manualCorrection && (row.matchGuess?.ambiguous||row.matchGuess?.conflict))
   return {...item,reason:'実況と試合の対戦カードが曖昧です'};
  if(!manualCorrection && row.matchGuess?.confidence!=='high' &&
      !(snapshot.matches.length===1&&Number(row.seq)===Number(snapshot.matches[0].seq)))
   return {...item,reason:'試合番号の特定が不確かです'};
  if(!manualCorrection && row.scorerGuess?.confidence!=='high')
   return {...item,reason:'得点者の候補を確認・修正してください'};
  if(!manualCorrection && row.assistMode==='named' && row.assistGuess?.confidence!=='high')
   return {...item,reason:'アシスト者の候補を確認・修正してください'};
  return {...item,state:'ready',reason:'最終一覧で確認してください'};
 });
 // The pinned SpoSched TEST API rejects same-match/same-scorer/same-assist
 // duplicates, including multiple "legitimate" goals. Do not silently send.
 const signatures=new Map();
 for(const item of decisions) {
  if(item.state!=='ready')continue;
  const row=rows[item.index];
  const sig=[row.seq,normalizeTeam(row.team),
    normalizePerson(row.scorer),normalizePerson(row.assistMode==='named'?row.assist:'')].join('|');
  signatures.set(sig,(signatures.get(sig)||[]).concat(item.index));
 }
 for(const indices of signatures.values())if(indices.length>1)for(const index of indices){
  decisions[index]={...decisions[index],state:'attention',
   reason:'今回の一括候補内に同一得点者・アシストが複数あります。個別確認が必要です'};
 }
 return decisions;
}
export function prepareQuickGoalBatch(snapshot,rows){
 const decisions=quickGoalDecisions(snapshot,rows);
 const selected=decisions.filter(x=>x.state==='ready');
 // These AI proposals are NOT per-row human confirmed. The operator must
 // inspect the complete reviewed summary and click the final TEST submit.
 const approved=selected.map(item=>({...rows[item.index],confirmed:true}));
 const payload=approved.length?buildReviewPayload(snapshot,approved,[]):null;
 if(payload && payload.operations.some(x=>x.action!=='record_goal'))
  throw Error('一括新規登録では既存ゴールの修正はできません');
 return {decisions,selected,payload,held:decisions.filter(x=>x.state!=='ready')};
}
