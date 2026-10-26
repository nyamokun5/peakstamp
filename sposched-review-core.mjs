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
 const eventName=string(obj.event?.name||obj.event||'');
 // For an external one-off fixture, SpoSched may have Team1 vs null before
 // the score is registered. Only infer an opponent from its official title
 // when there is exactly ONE numbered match and human verification is required.
 const numbered=obj.matches.filter(m=>number(m.seq)!==null);
 const opponentFromTitle=numbered.length===1?
  string(eventName.match(/\bvs\.?\s+(.+?)\s*$/i)?.[1]):'';
 const matches=numbered.map(m=>({
  seq:number(m.seq),matchId:string(m.match_id),title:string(m.title||'#'+m.seq),
  leftTeam:string(m.left_team||''),
  rightTeam:string(m.right_team||opponentFromTitle||''),
  inferredRightTeam:!string(m.right_team)&&Boolean(opponentFromTitle),
  leftScore:Number.isInteger(m.left_score)&&m.left_score>=0?m.left_score:null,
  rightScore:Number.isInteger(m.right_score)&&m.right_score>=0?m.right_score:null,
  existingGoals:Array.isArray(m.goals)?m.goals.filter(Boolean).map(g=>({
   id:string(g.goal_id),scorer:string(g.scorer),assist:string(g.assist),team:string(g.team),
    ownGoal:g.own_goal===true,scoredAt:string(g.scored_at)
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
 return {eventId,eventName,matches,players,roster,playerTeam};
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

/** Spoken "2対3" means Team2 versus Team3, NOT match sequence #2 or score 2-3.
 * Use only the goal's preceding match_start context, never its score call.
 */
function nameForTeam(value){
 const v=normalizeTeam(value).replace(/(番|組|チーム)$/g,'');
 const numeric=v.match(/^(?:(?:team|第)?)(\d{1,2})$/);
 return numeric?'team'+Number(numeric[1]):v;
}
function spokenTeamPair(goal){
 const first=nameForTeam(goal?.teamA),second=nameForTeam(goal?.teamB);
 if(first&&second)return [first,second];
 const label=string(goal?.matchLabel).normalize('NFKC');
 const m=label.match(/(?:team|チーム|第)?\s*(\d{1,2})(?:番|チーム)?\s*(?:対|vs\.?|と|－|ー|[-–])\s*(?:team|チーム|第)?\s*(\d{1,2})(?:番|チーム)?/i);
 if(m)return ['team'+Number(m[1]),'team'+Number(m[2])];
 return null;
}
export function inferMatchFromCommentary(goal,snapshot){
 const selected=number(goal?.matchSeq),direct=snapshot.matches.find(x=>x.seq===selected);
 const pair=spokenTeamPair(goal);
 const pairMatches=pair?snapshot.matches.filter(m=>{
  const actual=[nameForTeam(m.leftTeam),nameForTeam(m.rightTeam)];
  return actual.sort().join('::')===pair.slice().sort().join('::');
 }):[];
 const commentary=string(goal?.matchLabel||[goal?.teamA,goal?.teamB].filter(Boolean).join('対'));
 // Explicitly reviewed matchSeq wins; still surface a mismatch for review.
 if(direct)return {seq:direct.seq,source:'PSで指定済みの試合番号',confidence:'high',
  evidence:commentary,ambiguous:false,
  conflict:pairMatches.length>0&&!pairMatches.some(m=>m.seq===direct.seq),
  candidates:pairMatches.map(m=>m.seq)};
 if(pairMatches.length===1)return {seq:pairMatches[0].seq,
  source:'実況の対戦宣言 '+(commentary||pair.join('対')),confidence:'high',
  evidence:commentary,ambiguous:false,conflict:false,candidates:[pairMatches[0].seq]};
 if(pairMatches.length>1)return {seq:null,source:'同じ対戦組み合わせが複数試合あります',
  confidence:'ambiguous',evidence:commentary,ambiguous:true,conflict:false,
  candidates:pairMatches.map(m=>m.seq)};
 const nth=string(goal?.matchLabel).normalize('NFKC').match(/(?:第\s*([1-9]\d*)\s*試合|試合\s*#?\s*([1-9]\d*)|#\s*([1-9]\d*)\s*(?:試合)?)/i);
 const byNumber=nth?snapshot.matches.find(m=>m.seq===Number(nth[1]||nth[2]||nth[3])):null;
 if(!pair&&byNumber)return {seq:byNumber.seq,
  source:'実況で宣言された試合番号',confidence:'medium',evidence:commentary,
  ambiguous:false,conflict:false,candidates:[byNumber.seq]};
 // One external fixture: don't force the user to choose a match sequence
 // when the event only has one numbered match. Never override a conflicting
 // spoken TEAM pair; that remains for manual review.
 if(!pair&&snapshot.matches.length===1)return {
  seq:snapshot.matches[0].seq,source:'このイベントには試合が1件のみ',
  confidence:'medium',evidence:commentary,ambiguous:false,conflict:false,
  candidates:[snapshot.matches[0].seq]
 };
 return {seq:null,source:pair?'対戦宣言に一致する試合がありません':'実況から試合を確定できません',
  confidence:'none',evidence:commentary,ambiguous:false,conflict:false,candidates:[]};
}
// Match Japanese-speaking commentary to romanized Shoot Sunday player names.
// Exact roster member names are always preferred. Small kana/kanji conventions
// are hints, never authoritative IDs; ambiguous matches are left unselected.
const knownKanjiReadings={
 '高崎':'takasaki','川田':'kawata','野田':'noda','小林':'kobayashi',
 '西村':'nishimura','山田':'yamada','渡邊':'watanabe',
 '渡辺':'watanabe','芦田':'ashida','徳永':'tokunaga',
 '佐藤':'sato','鈴木':'suzuki','松本':'matsumoto'
};
const kanaMap={
 'あ':'a','い':'i','う':'u','え':'e','お':'o',
 'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
 'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
 'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
 'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
 'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
 'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
 'や':'ya','ゆ':'yu','よ':'yo',
 'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
 'わ':'wa','を':'o','ん':'n',
 'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
 'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
 'だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do',
 'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
 'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po'
};
const digraph={や:'ya',ゆ:'yu',よ:'yo'};
function kanaRomanization(text){
 const source=string(text).normalize('NFKC').replace(/[ァ-ヶ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));
 let out='';
 for(let i=0;i<source.length;i++){
  const ch=source[i],next=source[i+1];
  if(ch==='っ'&&next){const n=kanaMap[next]||'';out+=n[0]||'';continue}
  if(ch==='ー'){if(out.length&&/[aeiou]$/.test(out))out+=out.at(-1);continue}
  if(digraph[next]&&/^(?:き|し|ち|に|ひ|み|り|ぎ|じ|び|ぴ)$/.test(ch)){
   const root=(kanaMap[ch]||'').replace(/i$/,'');out+=root+digraph[next];i++;continue;
  }
  out+=kanaMap[ch]??ch;
 }
 return out;
}
export function spokenNameTokens(text){
 const normalized=normalizePerson(text);
 if(!normalized)return [];
 const candidates=[normalized,kanaRomanization(normalized)];
 for(const [kanji,romaji] of Object.entries(knownKanjiReadings))
  if(normalized===kanji||normalized.includes(kanji))candidates.push(romaji);
 return [...new Set(candidates.filter(Boolean))];
}
export function scoredPlayerCandidates(text,snapshot,team='',limit=7){
 const tokens=spokenNameTokens(text);
 if(!tokens.length)return [];
 const targetTeam=nameForTeam(team);
 const ranked=snapshot.players.map(name=>{
  const norm=normalizePerson(name);
  const components=string(name).normalize('NFKC').toLowerCase()
   .split(/[\s.・_\-]+/).filter(Boolean);
  let score=0,why='';
  for(const token of tokens){
   let n=0,label='';
   if(norm===token){n=120;label='正式名と一致'}
   else if(components.includes(token)){n=98;label='氏名の一部が一致'}
   else if(components.some(p=>p.startsWith(token)&&token.length>=3)){n=88;label='名前の先頭が一致'}
   else if(components.some(p=>token.startsWith(p)&&p.length>=4)){n=85;label='名前の一部が一致'}
   else if(norm.includes(token)&&token.length>=4){n=78;label='部分一致'}
   if(n>score){score=n;why=label}
  }
  const teamName=snapshot.playerTeam.get(name)||'';
  if(score&&targetTeam&&nameForTeam(teamName)===targetTeam)score+=8;
  return {name,team:teamName,score,why};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ja'));
 return ranked.slice(0,limit);
}
export function suggestedPlayer(text,snapshot,team=''){
 const candidates=scoredPlayerCandidates(text,snapshot,team);
 const top=candidates[0],next=candidates[1];
 // Require an individual, convincing match. No player is marked confirmed.
 if(!top||top.score<88||(next&&top.score-next.score<15))
  return {name:'',confidence:'none',candidates};
 return {name:top.name,confidence:top.score>=98?'high':'medium',
  candidates,source:top.why};
}

export function prepareGoalRows(rawGoals,snapshot){
 const goals=Array.isArray(rawGoals?.goals)?rawGoals.goals:[];
 return goals.map((g,i)=>{
  const matchGuess=inferMatchFromCommentary(g,snapshot);
  const onlyMatch=snapshot.matches.find(m=>m.seq===matchGuess.seq)||null;
  const teamHint=onlyMatch?onlyMatch.leftTeam:'';
  const scorerGuess=suggestedPlayer(g.scorer,snapshot,teamHint);
  const assistGuess=suggestedPlayer(g.assist,snapshot,'');
  const scorerTeam=scorerGuess.name?snapshot.playerTeam.get(scorerGuess.name)||'':'';
  const sides=onlyMatch?[nameForTeam(onlyMatch.leftTeam),nameForTeam(onlyMatch.rightTeam)]:[];
  const prefilledTeam=scorerTeam&&sides.includes(nameForTeam(scorerTeam))?
   (sides[0]===nameForTeam(scorerTeam)?onlyMatch.leftTeam:onlyMatch.rightTeam):'';
  const scorerHints=scorerGuess.candidates;
  const assistHints=assistGuess.candidates;
  return {key:string(g.source?.name||'video')+'::'+string(g.id||i),
   goal:g,seq:onlyMatch?.seq??null,matchGuess,
   scorer:scorerGuess.name,assist:assistGuess.name,
   scorerGuess,assistGuess,
   assistMode:g.assistStatus==='none'?'none':
    g.assistStatus==='named'?'named':'unknown',
   scorerHints,assistHints,team:prefilledTeam,confirmed:false,include:true,
   guest:false,scoreConfirmed:false,duplicateApproved:false,updateGoalId:''};
 });
}
/** Carry forward edits to OTHER goals after one confirmed SpoSched write.
 * Rechecking every row is mandatory because the official score and registered
 * goals have changed. Never restore edits when the event changes.
 */
export function preserveReviewRows(nextRows,priorRows,{
 sameEvent=false,completedKeys=[],snapshot=null
}={}){
 if(!sameEvent||!Array.isArray(priorRows)||!Array.isArray(nextRows))return nextRows;
 const previous=new Map(priorRows.map(row=>[row.key,row]));
 const completed=new Set(completedKeys);
 return nextRows.map(row=>{
  const old=previous.get(row.key);
  if(!old)return row;
  const fields=['seq','scorer','assist','assistMode','team','guest','include'];
  for(const field of fields)row[field]=old[field];
  // A finished goal cannot be queued again after its successful readback.
  // Preserve other goals' edits but invalidate every confirmation/override.
  if(completed.has(row.key))row.include=false;
  row.confirmed=false;
  row.duplicateApproved=false;
  const match=snapshot?.matches?.find(m=>m.seq===Number(row.seq));
  row.updateGoalId=match?.existingGoals?.some(g=>g.id===old.updateGoalId)
   ?old.updateGoalId:'';
  return row;
 });
}
export function validateGoalRow(row,snapshot){
 if(!row.include)return null;
 if(!row.confirmed)return '選手・試合の確認が必要です';
 const match=snapshot.matches.find(m=>m.seq===number(row.seq));
 if(!match)return '試合番号を選択してください';
 if(!row.scorer||(!row.guest&&!snapshot.players.includes(row.scorer)))
  return row.guest?'外部選手の得点者名を入力してください':'得点者を選択してください';
 if(row.guest&&snapshot.players.includes(row.scorer))
  return '登録メンバーの得点にはゲスト指定を外してください';
 if(row.assistMode==='unknown')return 'アシストあり／なし／不明を明示的に確認してください';
 if(row.assistMode==='named'&&(!row.assist||(!row.guest&&!snapshot.players.includes(row.assist))))
  return row.guest?'外部選手のアシスト者名を入力してください':'アシスト選手を選択してください';
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
 const duplicates=items.filter(row=>!row.updateGoalId&&findPotentialDuplicate(row,snapshot)&&row.duplicateApproved!==true);
 if(duplicates.length)throw Error('Shoot Sundayに同じ得点者・アシストの登録済みゴールが'+duplicates.length+'件あります。「登録済みなので送らない」か「別ゴールとして追加」を選んでください。');
 const operationGoals=items.map(row=>{
  const team=row.team||snapshot.playerTeam.get(row.scorer)||'';
  const match=snapshot.matches.find(m=>m.seq===number(row.seq));
  if(row.updateGoalId){
   // Updates only target a specific registered goal and retain its scoring side.
   const original=match?.existingGoals.find(g=>g.id===row.updateGoalId);
   const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
   if(!original||!uuid.test(original.id)||!uuid.test(match.matchId))
    throw Error('更新対象のgoal_idまたはmatch_idを確認できません。SSから再取得してください。');
   if(original.ownGoal)throw Error('オウンゴールの変更はこの画面では対応していません。');
   if(row.guest)throw Error('ゲストの得点変更はこの画面では対応していません。');
   if(normalizeTeam(team)!==normalizeTeam(original.team))
    throw Error('得点チームが異なります。PATCHでは得点側を変更できません。');
   const scorerSide=snapshot.playerTeam.get(row.scorer);
   if(scorerSide&&normalizeTeam(scorerSide)!==normalizeTeam(team))
    throw Error('得点者が得点側のチームにいません。オウンゴールへの変更は未対応です。');
   if(row.assistMode==='named'){
    const assistSide=snapshot.playerTeam.get(row.assist);
    if(assistSide&&normalizeTeam(assistSide)!==normalizeTeam(team))
     throw Error('アシスト者が得点側のチームにいません。');
   }
   const expected={scorer:original.scorer,assist:original.assist||null,
    team:original.team,scored_at:original.scoredAt||null,own_goal:original.ownGoal};
   const patch={};
   if(normalizePerson(row.scorer)!==normalizePerson(original.scorer))patch.scorer={name:row.scorer};
   const newAssist=row.assistMode==='named'?row.assist:null;
   if(normalizePerson(newAssist)!==normalizePerson(original.assist))
    patch.assist=newAssist?{name:newAssist}:null;
   if(!Object.keys(patch).length)throw Error('選択した登録済みゴールと変更内容が同じです。更新は不要です。');
   return {action:'patch_goal',args:{event_id:snapshot.eventId,seq:match.seq,
    match_id:match.matchId,goal_id:original.id,patch},expected,fromPeakStamp:{
     goalId:row.goal.id,source:row.goal.source?.name,
     goalTimeSeconds:row.goal.goalTimeSeconds,quote:row.goal.quote
    }};
  }
  const args={event_id:snapshot.eventId,seq:number(row.seq),scorer:row.scorer,team};
  if(row.assistMode==='named')args.assist=row.assist;
  if(row.guest===true)args.guest=true;
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
