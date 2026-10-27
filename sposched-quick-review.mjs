/** Primary TEST-only workflow: verified video goals -> one batch approval.
 * This module only prepares summaries and already-validated operations.
 * It does not issue network requests or grant permission to write.
 */
import {
 normalizePerson,normalizeTeam,validateGoalRow,matchingExistingGoals,buildReviewPayload
} from './sposched-review-core.mjs';

/**
 * Show what PeakStamp AI ACTUALLY extracted, separate from the possibly
 * modified official SpoSched roster selection. Neither text nor candidate
 * rankings imply human confirmation. Never replace an uncertain extraction
 * with a plausible-sounding name.
 */
export function quickAIObservation(row){
 const goal=row?.goal||{};
 const heard=value=>typeof value==='string'?value.trim():'';
 const scorerRaw=heard(goal.scorer)||'聞き取れず';
 const spokenAssist=heard(goal.assist);
 const assistRaw=goal.assistStatus==='none'
  ?spokenAssist?spokenAssist+'（AI判定：アシストなし）':'なし（AI判定）'
  :spokenAssist||(
   goal.assistStatus==='named'?'名前を聞き取れず':'不明（AI判定）');
 const names=hints=>{
  const result=[],seen=new Set();
  for(const h of Array.isArray(hints)?hints:[]){
   const name=heard(h?.name);
   if(!name||seen.has(name))continue;
   result.push(name);seen.add(name);
   if(result.length>=3)break;
  }
  return result;
 };
 return {scorerRaw,assistRaw,
  scorerCandidates:names(row?.scorerHints),
  assistCandidates:goal.assistStatus==='none'?[]:names(row?.assistHints),
  noAssist:goal.assistStatus==='none'};
}

export function quickGoalDecisions(snapshot,rows) {
 const decisions=(rows||[]).map((row,index)=>{
  const g=row.goal||{};
  const item={index,key:row.key,source:g.source?.name||'',time:g.goalTimeSeconds??null,
    seq:row.seq,team:row.team||'',scorer:row.scorer||'',
    assist:row.assistMode==='named'?row.assist||'アシスト未確定':
     row.assistMode==='none'?'なし':'アシスト未確認',
    state:'attention',reason:'確認が必要です'};
  if(g.manual)return {...item,state:'manual',reason:'手動入力は詳細モードで扱います'};
  if(row.updateGoalId)return {...item,state:'patch',reason:'既存ゴールの修正は詳細モードで扱います'};
  if(!row.include)return {...item,state:'skipped',reason:'登録対象から除外済み'};
  if(row.fixtureIdentityChanged===true)return {...item,state:'attention',
   reason:'SSの正式な試合IDが前回から変更されました。試合番号を再確認するまで送信しません'};
  // Numbered knockout slots already have a stable match_id even while
  // SpoSched waits to learn which teams reached the final/third-place match.
  // Goals are kept in PeakStamp by matchSeq, but NEVER sent to waiting games.
  const fixture=snapshot.matches.find(m=>m.seq===Number(row.seq));
  if(fixture && (fixture.status==='waiting'||!fixture.matchId||
    !fixture.leftTeam||!fixture.rightTeam))
   return {...item,state:'waiting',
    reason:'SS試合枠 #'+fixture.seq+'（'+(fixture.title||'対戦チーム未確定')+
     '）に紐付け済み。正式な試合ID・対戦チームが確定するまで送信を保留します'};
  if(matchingExistingGoals(row,snapshot).length)
   return {...item,state:'duplicate',reason:'SSに同じ得点者・アシストの組み合わせがあります'};
  if(row.guest)return {...item,reason:'ゲスト得点は現在のTEST一括登録で対応していません'};
  const issue=validateGoalRow({...row,confirmed:true},snapshot);
  if(issue)return {...item,reason:issue};
  const team=row.team||snapshot.playerTeam.get(row.scorer)||'';
  const scorerTeam=snapshot.playerTeam.get(row.scorer);
  if(team&&scorerTeam&&normalizeTeam(team)!==normalizeTeam(scorerTeam))
   return {...item,reason:'得点者と得点チームが一致しません'};
  const assistTeam=row.assistMode==='named'?snapshot.playerTeam.get(row.assist):null;
  if(team&&assistTeam&&normalizeTeam(team)!==normalizeTeam(assistTeam))
   return {...item,reason:'アシスト者と得点チームが一致しません'};
  // An edit to an unrelated field must never clear AI ambiguity.
  // Only the field actually edited (or an explicit whole-row review)
  // can satisfy that field's human verification requirement.
  const fullReview=row.quickReviewedAll===true;
  const matchReviewed=fullReview||row.quickReviewedFields?.match===true;
  const scorerReviewed=fullReview||row.quickReviewedFields?.scorer===true;
  const assistReviewed=fullReview||row.quickReviewedFields?.assist===true;
  if(!matchReviewed && (row.matchGuess?.ambiguous||row.matchGuess?.conflict))
   return {...item,reason:'実況と試合の対戦カードが曖昧です'};
  if(!matchReviewed && row.matchGuess?.confidence!=='high' &&
      !(snapshot.matches.length===1&&Number(row.seq)===Number(snapshot.matches[0].seq)))
   return {...item,reason:'試合番号の特定が不確かです'};
  if(!scorerReviewed && row.scorerGuess?.confidence!=='high')
   return {...item,reason:'得点者の候補を確認・修正してください'};
  if(!assistReviewed && row.assistMode==='named' && row.assistGuess?.confidence!=='high')
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

/** Compact review corrections approve ONLY the selected field.
 * Final batch approval remains a separate explicit user click.
 */
export function editQuickGoalField(snapshot,row,field,value){
 if(!snapshot||!row||row.goal?.manual||row.updateGoalId||row.guest)
  throw Error('このゴールは詳細編集が必要です');
 const mark=name=>{
  row.quickReviewedFields={...(row.quickReviewedFields||{}),[name]:true};
 };
 row.quickEdited=true;row.quickReviewedAll=false;row.confirmed=false;
 row.duplicateApproved=false;
 if(field==='match'){
  const seq=Number(value),m=snapshot.matches.find(x=>x.seq===seq);
  if(!m)throw Error('試合番号が正しくありません');
  row.seq=seq;row.quickReviewedFields={match:true};
  // The user explicitly reselected this numbered fixture after any ID reset.
  row.fixtureIdentityChanged=false;
  if(row.team&&![normalizeTeam(m.leftTeam),normalizeTeam(m.rightTeam)]
   .includes(normalizeTeam(row.team)))row.team='';
 }else if(field==='scorer'){
  if(!snapshot.players.includes(value))throw Error('得点者が名簿にいません');
  row.scorer=value;mark('scorer');
  const m=snapshot.matches.find(x=>x.seq===Number(row.seq));
  const team=snapshot.playerTeam.get(value);
  if(m&&team&&[normalizeTeam(m.leftTeam),normalizeTeam(m.rightTeam)]
   .includes(normalizeTeam(team)))row.team=team;
 }else if(field==='assistMode'){
  if(!['none','named','unknown'].includes(value))throw Error('不正なアシスト状態です');
  // Switching from "unknown/no assist" to "named" must never resurrect a
  // previously inferred name without explicit player selection.
  if(value==='named'&&row.assistMode!=='named')row.assist='';
  row.assistMode=value;
  if(value!=='named')row.assist='';
  if(value==='none')mark('assist');
  else row.quickReviewedFields={...(row.quickReviewedFields||{}),assist:false};
 }else if(field==='assist'){
  if(!snapshot.players.includes(value))throw Error('アシスト者が名簿にいません');
  row.assist=value;row.assistMode='named';mark('assist');
 }else if(field==='team'){
  const m=snapshot.matches.find(x=>x.seq===Number(row.seq));
  if(!m||![normalizeTeam(m.leftTeam),normalizeTeam(m.rightTeam)]
   .includes(normalizeTeam(value)))throw Error('この試合の得点チームを選択してください');
  row.team=value;mark('team');
 }else throw Error('未知の入力項目です');
 return row;
}

/** Match-number-only grouping for PeakStamp's visible draft count.
 * These are detected goal candidates, NOT confirmed official match scores.
 */
export function goalCandidatesByMatchNumber(snapshot,rows){
 const totals=new Map();
 for(const r of Array.isArray(rows)?rows:[]){
  if(r.include===false||r.goal?.manual)continue;
  const seq=Number(r.seq);
  if(!Number.isInteger(seq)||seq<1)continue;
  totals.set(seq,(totals.get(seq)||0)+1);
 }
 return (snapshot?.matches||[]).map(m=>({
  seq:m.seq,matchId:m.matchId||null,title:m.title,
  teamReady:m.status!=='waiting'&&Boolean(m.matchId&&m.leftTeam&&m.rightTeam),
  goals:totals.get(m.seq)||0
 })).filter(m=>m.goals>0);
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
