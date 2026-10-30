import {assertCurrentNumberedFixture} from './sposched-staging-client.mjs?v=ss-live-map1';
const fail=message=>{throw Error(message)};
export function finishAction(loaded,latest,seq,winner,{drawAllowed=null}={}){
 const matchId=assertCurrentNumberedFixture(loaded,latest,seq);
 const m=latest.matches.find(x=>x.seq===Number(seq));
 if(m.status!=='scheduled')fail('未終了の試合を選んでください。終了済みの結果は変更しません');
 if(!Number.isInteger(m.leftScore)||m.leftScore<0||!Number.isInteger(m.rightScore)||m.rightScore<0)
  fail('SSの現在のスコアを取得できません');
 const automatic=m.leftScore>m.rightScore?'left':m.leftScore<m.rightScore?'right':null;
 if(!automatic&&!['left','right','draw'].includes(winner))
  fail('同点です。PKなどで決めた勝者、または引き分けを選択してください');
 if(!automatic&&winner==='draw'&&!(drawAllowed===null?Number(seq)>=3:drawAllowed===true))
  fail('この試合では勝ち上がりチームを指定してください。引き分け終了はできません');
 if(automatic&&winner&&winner!==automatic)fail('勝者がスコアと一致しません');
 return {action:'finish',match_id:matchId,event_id:latest.eventId,seq:Number(seq),
  left_score:m.leftScore,right_score:m.rightScore,winner:automatic||winner};
}
export function assertFinished(action,response){
 const r=response?.readback;
 if(response?.environment!=='STAGING ONLY'||response.operation!=='finish'||response.write_sent!==true||
  r?.verified!==true||r.status!=='finished'||r.left_score!==action.left_score||
  r.right_score!==action.right_score||r.winner!==action.winner)
  fail('試合終了の照合が完了していません。「終了結果を照合」で確認してください。自動再送はしません');
 return r;
}
export function unfinishedGoalCount(snapshot,rows,seq,decisions){
 return decisions.filter(d=>Number(rows[d.index]?.seq)===Number(seq)&&
  !['duplicate','skipped'].includes(d.state)).length;
}
