/** Pure tournament score projection. No network calls or SS mutations.
 * First-round outcomes establish the third-place and final opponents.
 * A tied knockout game needs a human winner decision.
 */
import {inferFirstRoundBracket} from './sposched-inline-bracket.mjs';

const norm=v=>String(v??'').normalize('NFKC').toLowerCase()
 .replace(/\s/g,'').replace(/^チーム/,'team').replace(/^(?:team)?(\d+)$/,'team$1');

export function projectFourMatchTournament(snapshot,rows){
 const bracket=inferFirstRoundBracket(snapshot,rows);
 if(!bracket.ready)return {...bracket,knockout:null,complete:false};
 const pairs=new Map([[3,bracket.thirdPlace],[4,bracket.final]]);
 const totals=new Map([[3,[0,0]],[4,[0,0]]]);
 const seen=new Set();
 for(const [index,row] of rows.entries()){
  if(row.include===false||![3,4].includes(Number(row.seq)))continue;
  const seq=Number(row.seq),pair=pairs.get(seq);
  const sourceName=String(row.goal?.source?.name||'');
  const goalId=String(row.goal?.id||'');
  if(sourceName&&goalId){
   const key=sourceName+'::'+goalId;
   if(seen.has(key))throw Error('同じ動画ゴールが重複しています');
   seen.add(key);
  }
  if(!row.scorer||!snapshot.playerTeam?.has(row.scorer))
   throw Error('ゴール'+(index+1)+'：得点者がSS名簿にありません');
  if(!['named','none'].includes(row.assistMode)||
     (row.assistMode==='named'&&!snapshot.playerTeam?.has(row.assist)))
   throw Error('ゴール'+(index+1)+'：アシストが未確定です');
  const team=norm(snapshot.playerTeam.get(row.scorer));
  const side=pair.findIndex(t=>norm(t)===team);
  if(side<0)throw Error('ゴール'+(index+1)+'：得点者の所属が勝敗から決まった対戦カードと一致しません');
  totals.get(seq)[side]++;
 }
 const knockout=[3,4].map(seq=>{
  const [leftTeam,rightTeam]=pairs.get(seq);
  const [left,right]=totals.get(seq);
  return {seq,leftTeam,rightTeam,left,right,winner:left===right?null:left>right?leftTeam:rightTeam,
   requiresDecision:left===right};
 });
 return {...bracket,knockout,complete:knockout.every(m=>!m.requiresDecision)};
}
