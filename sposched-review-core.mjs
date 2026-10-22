/** PeakStamp → Shoot Sunday (SpoSched) review-only bridge.
 * Inputs come from explicitly imported event snapshots. NO HTTP endpoints,
 * tokens, writes, or automatic state mutations are assumed here.
 */
const string=x=>String(x??'').trim();
export const normalizePerson=x=>string(x).normalize('NFKC').toLowerCase()
 .replace(/[\s.・_\-（）()]/g,'').replace(/(さん|くん|君|氏|様)$/,'');
export const normalizeTeam=x=>string(x).normalize('NFKC').toLowerCase()
 .replace(/\s/g,'').replace(/^チーム/,'team').replace(/team(\d+)/,'team$1');
const number=x=>Number.isInteger(Number(x))&&Number(x)>0?Number(x):null;
export function normalizeSpoSnapshot(raw){
 const input=raw?.result&&typeof raw.result==='object'?raw.result:raw;
 if(!input||typeof input!=='object')throw Error('SpoSchedの試合結果JSONを指定してください');
 const obj=input.matches&&Array.isArray(input.matches)?input:
  input.match_results?.matches?input.match_results:null;
 if(!obj)throw Error('SpoSchedの試合結果JSONにmatches配列がありません');
 const eventId=string(obj.event_id||obj.event?.id||input.event_id);
 if(!eventId)throw Error('イベントIDがありません。get_match_resultsのJSONを読み込んでください');
 const matches=obj.matches.filter(m=>number(m.seq)!==null).map(m=>({
  seq:number(m.seq),title:string(m.title||'#'+m.seq),
  leftTeam:string(m.left_team||''),rightTeam:string(m.right_team||''),
  leftScore:Number.isInteger(m.left_score)&&m.left_score>=0?m.left_score:null,
  rightScore:Number.isInteger(m.right_score)&&m.right_score>=0?m.right_score:null,
  existingGoals:Array.isArray(m.goals)?m.goals.filter(Boolean).map(g=>({
   id:string(g.goal_id),scorer:string(g.scorer),assist:string(g.assist),team:string(g.team)
  })):[]
 })).sort((a,b)=>a.seq-b.seq);
 const seqs=new Set();
 for(const m of matches){
  if(seqs.has(m.seq))throw Error('試合番号seqが重複しています: '+m.seq);
  seqs.add(m.seq);
 }
 const roster=obj.roster&&typeof obj.roster==='object'?obj.roster:{};
 const players=[...new Set([
  ...Object.values(roster).flatMap(x=>Array.isArray(x)?x.map(string):[]),
  ...matches.flatMap(m=>m.existingGoals.flatMap(g=>[g.scorer,g.assist]))
 ].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));
 const playerTeam=new Map();
 for(const [team,names] of Object.entries(roster))for(const name of Array.isArray(names)?names:[])
  playerTeam.set(string(name),string(team));
 return {eventId,eventName:string(obj.event?.name||obj.event||''),matches,players,roster,playerTeam};
}
export function selectPlayerCandidates(text,snapshot,team='',limit=7){
 const term=normalizePerson(text);
 if(!term)return [];
 const targetTeam=normalizeTeam(team);
 const results=snapshot.players.map(name=>{
  const norm=normalizePerson(name);
  let score=norm===term?100:norm.startsWith(term)||term.startsWith(norm)?72:
   norm.includes(term)||term.includes(norm)?56:0;
  const teamName=snapshot.playerTeam.get(name)||'';
  // Team membership may break ties only after a genuine name match.
  // Otherwise every person on the expected team becomes a false candidate.
  if(score>0&&targetTeam&&normalizeTeam(teamName)===targetTeam)score+=12;
  return {name,team:teamName,score};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ja'));
 return results.slice(0,limit);
}
export function prepareGoalRows(rawGoals,snapshot){
 const goals=Array.isArray(rawGoals?.goals)?rawGoals.goals:[];
 return goals.map((g,i)=>{
  const seq=number(g.matchSeq);
  const match=snapshot.matches.find(m=>m.seq===seq)||null;
  const label=normalizeTeam(g.teamA),other=normalizeTeam(g.teamB);
  const explicit=label&&other?snapshot.matches.filter(m=>
   [normalizeTeam(m.leftTeam),normalizeTeam(m.rightTeam)].sort().join('::')===
   [label,other].sort().join('::')):[];
  const onlyMatch=match||(explicit.length===1?explicit[0]:null);
  const scorerHints=selectPlayerCandidates(g.scorer,snapshot,onlyMatch?.leftTeam||'');
  const assistHints=selectPlayerCandidates(g.assist,snapshot,'');
  return {key:string(g.source?.name||'video')+'::'+string(g.id||i),
   goal:g,seq:onlyMatch?.seq??null,
   scorer:'',assist:'',assistMode:g.assistStatus==='none'?'none':
    g.assistStatus==='named'?'named':'unknown',
   scorerHints,assistHints,team:'',confirmed:false,include:true,
   scoreConfirmed:false,duplicateApproved:false};
 });
}
export function validateGoalRow(row,snapshot){
 if(!row.include)return null;
 if(!row.confirmed)return '選手・試合の確認が必要です';
 const match=snapshot.matches.find(m=>m.seq===number(row.seq));
 if(!match)return '試合番号を選択してください';
 if(!row.scorer||!snapshot.players.includes(row.scorer))return '得点者を選択してください';
 if(row.assistMode==='unknown')return 'アシストあり／なし／不明を明示的に確認してください';
 if(row.assistMode==='named'&&(!row.assist||!snapshot.players.includes(row.assist)))
  return 'アシスト選手を選択してください';
 const actualTeam=string(snapshot.playerTeam.get(row.scorer)||'');
 if(!row.team&&!actualTeam)return '得点チームを選択してください';
 const team=row.team||actualTeam;
 if(![normalizeTeam(match.leftTeam),normalizeTeam(match.rightTeam)].includes(normalizeTeam(team)))
  return '得点チームがこの試合の対戦チームと異なります';
 if(row.assistMode==='named'&&row.scorer===row.assist)
  return '得点者とアシストが同一です';
 return null;
}
/** Goals already registered IN Shoot Sunday for the selected official match.
 * These are not PeakStamp drafts or browser cache items.
 */
export function existingGoalsForMatch(row,snapshot){
 const match=snapshot.matches.find(m=>m.seq===number(row.seq));
 return match?.existingGoals||[];
}
/** Warn on a matching scorer/assist/team combination, but don't assert that
 * two goals with the same participants must be identical. Only a human who
 * watched both goal scenes can decide that.
 */
export function matchingExistingGoals(row,snapshot){
 if(!row.scorer)return [];
 const team=row.team||snapshot.playerTeam.get(row.scorer)||'';
 const assist=row.assistMode==='named'?row.assist:'';
 if(row.assistMode==='named'&&!row.assist)return [];
 if(row.assistMode==='unknown')return [];
 return existingGoalsForMatch(row,snapshot).filter(g=>
  normalizePerson(g.scorer)===normalizePerson(row.scorer)&&
  normalizePerson(g.assist)===normalizePerson(assist)&&
  normalizeTeam(g.team)===normalizeTeam(team));
}
export function findPotentialDuplicate(row,snapshot){
 return matchingExistingGoals(row,snapshot).length>0;
}
export function buildReviewPayload(snapshot,rows,scoreRows=[]){
 const items=rows.filter(row=>row.include!==false);
 if(!items.length&&!scoreRows.some(row=>row.include))
  throw Error('追加するゴールはありません。既にShoot Sundayに登録済みなら、再登録は不要です。');
 const missing=items.map((row,i)=>({i,problem:validateGoalRow(row,snapshot)}))
  .filter(x=>x.problem);
 if(missing.length)throw Error((missing[0].i+1)+'件目：'+missing[0].problem);
 const duplicates=items.filter(row=>findPotentialDuplicate(row,snapshot)&&row.duplicateApproved!==true);
 if(duplicates.length)throw Error('Shoot Sundayに同じ得点者・アシストの登録済みゴールが'+duplicates.length+'件あります。「登録済みなので送らない」か「別ゴールとして追加」を選んでください。');
 const operationGoals=items.map(row=>{
  const team=row.team||snapshot.playerTeam.get(row.scorer)||'';
  const args={event_id:snapshot.eventId,seq:number(row.seq),scorer:row.scorer,team};
  if(row.assistMode==='named')args.assist=row.assist;
  return {action:'record_goal',args,fromPeakStamp:{
   goalId:row.goal.id,source:row.goal.source?.name,
   goalTimeSeconds:row.goal.goalTimeSeconds,quote:row.goal.quote
  }};
 });
 const operationMatches=[];
 for(const item of scoreRows){
  if(!item.include)continue;
  const match=snapshot.matches.find(m=>m.seq===number(item.seq));
  if(!match)throw Error('不明な試合番号');
  if(!item.confirmed)throw Error('試合 #'+item.seq+' のスコアを確認してください');
  if(!Number.isInteger(Number(item.leftScore))||Number(item.leftScore)<0||
     !Number.isInteger(Number(item.rightScore))||Number(item.rightScore)<0)
   throw Error('試合 #'+item.seq+' のスコアが不正です');
  const left=Number(item.leftScore),right=Number(item.rightScore);
  const winner=left>right?'left':left<right?'right':string(item.winner||'');
  if(!winner)throw Error('同点の試合 #'+item.seq+' は引分／じゃんけん勝者を指定してください');
  operationMatches.push({action:'record_match',args:{
   event_id:snapshot.eventId,seq:item.seq,left_team:match.leftTeam,
   right_team:match.rightTeam,left_score:left,right_score:right,winner
  }});
 }
 return {kind:'peakstamp-sposched-reviewed-draft',version:1,
  eventId:snapshot.eventId,eventName:snapshot.eventName,
  status:'human-reviewed-NOT-SENT',
  source:'PeakStamp local goal confirmations and imported SpoSched event snapshot',
  operations:[...operationMatches,...operationGoals]};
}
