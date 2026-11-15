/** Video-free TEST fixture entry: one final review, not one checkbox per goal.
 * Pure functions only; no network, local storage, or write permissions.
 * Worker still verifies each official match UUID and signed goal readback.
 */
import {normalizeTeam,normalizePerson,validateGoalRow,matchingExistingGoals} from './sposched-review-core.mjs';

export function summarizeManualFixtureEntry(snapshot,rows,decisions=[]){
 const matches=Array.isArray(snapshot?.matches)?snapshot.matches:[];
 const fixtures=matches.map(m=>({
  seq:m.seq,matchId:m.matchId,leftTeam:m.leftTeam,rightTeam:m.rightTeam,
  left:0,right:0,goals:[],status:m.status
 }));
 const bySeq=new Map(fixtures.map(m=>[m.seq,m]));
 const issues=[],seen=new Set();
 let manualCount=0,acceptedCount=0;
 for(const [index,row] of (Array.isArray(rows)?rows:[]).entries()){
  if(row?.include===false||row?.goal?.sent===true)continue;
  const manual=row?.goal?.manual===true;
  if(manual)manualCount++;
  const selected=bySeq.get(Number(row?.seq));
  if(!manual&&decisions[index]?.state!=='ready')continue; // older video review remains authoritative
  let issue='';
  if(!selected)issue='試合番号を選択してください';
  else if(manual){
   if(snapshot?.rosterSource!=='official-current-event-teams')
    issue='SSの最新チーム名簿を再取得してください';
   else if(row.guest||row.updateGoalId||row.fixtureIdentityChanged)
    issue='ゲスト・既存修正・試合ID変更は別の操作で確認してください';
   else issue=validateGoalRow({...row,confirmed:true},snapshot)||'';
  }
  const team=String(row?.team||snapshot?.playerTeam?.get(row?.scorer)||'');
  const scorer=String(row?.scorer||'');
  const assist=row?.assistMode==='named'?String(row?.assist||''):'';
  if(!issue&&selected){
   const scorerTeam=snapshot?.playerTeam?.get(scorer);
   const assistTeam=assist?snapshot?.playerTeam?.get(assist):null;
   if(!['none','named'].includes(row?.assistMode))
    issue='アシストあり・なしを選択してください';
   else if(!scorerTeam||normalizeTeam(scorerTeam)!==normalizeTeam(team))
    issue='得点者の所属チームを確認してください';
   else if(assist&&(!assistTeam||normalizeTeam(assistTeam)!==normalizeTeam(team)||
     normalizePerson(assist)===normalizePerson(scorer)))
    issue='アシスト者は得点者と同じチームの別選手を選択してください';
   else if(![selected.leftTeam,selected.rightTeam].some(t=>normalizeTeam(t)===normalizeTeam(team)))
    issue='得点チームが対戦チームと一致しません';
   else if(manual&&matchingExistingGoals(row,snapshot).length)
    issue='SSに同じ得点者・アシストのゴールが登録されています';
   else {
    const signature=[selected.seq,normalizeTeam(team),normalizePerson(scorer),normalizePerson(assist)].join('|');
    if(seen.has(signature))issue='同じ試合・得点者・アシストの組み合わせが重複しています';
    else seen.add(signature);
   }
  }
  if(issue){
   if(manual)issues.push({index,key:row?.key||'',reason:issue});
   continue;
  }
  if(!selected)continue;
  const side=normalizeTeam(team)===normalizeTeam(selected.leftTeam)?'left':'right';
  selected[side]++;
  selected.goals.push({index,key:row.key,side,team,scorer,assist,manual});
  acceptedCount++;
 }
 return {fixtures,manualCount,acceptedCount,issues,ready:issues.length===0};
}

/** Bind a tie choice to the current event, official fixture ID, AND projected score.
 * Changes to teams, match UUID, or counted goals automatically discard a
 * previous winner/PK selection; we default only independent league ties to draw.
 */
export function manualTieKey(eventId,fixture){
 return [eventId,fixture.seq,fixture.matchId,fixture.left,fixture.right].join(':');
}
export function manualFinishWinner(eventId,fixture,winners){
 if(!fixture||fixture.left!==fixture.right)return 'auto';
 const choice=winners?.get?.(manualTieKey(eventId,fixture));
 return ['draw','left','right'].includes(choice)?choice:'draw';
}
