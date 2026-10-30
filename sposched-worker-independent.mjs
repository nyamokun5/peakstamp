/** Build an independent official-fixtures batch for the TEST Worker.
 * Pure function; the worker re-verifies current SS IDs, tenant and scores.
 * Existing four-match knockout is handled by the old separate builder.
 */
import {describeOfficialFixtures} from './sposched-fixture-layout.mjs';
import {normalizeTeam,normalizePerson} from './sposched-review-core.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=reason=>{throw Error(reason)};
const name=v=>typeof v==='string'?v.trim():'';
/** A public GET /health preflight, before the first mutation or local job marker.
 * Verify the deployed STAGING Worker actually supports the independent batch path.
 */
export function assertIndependentWorkerHealth(health){
 if(health?.service!=='shoot-sunday-sync-staging'||
    health?.write_mode!=='test-only'||
    health?.batch_job_configured!==true||
    health?.independent_batch_contract!=='independent-fixtures-v1')
  fail('TEST Workerが可変試合数の最新版ではありません。Cloudflare WorkerのSTAGINGデプロイを確認してください。送信は開始していません');
 return true;
}
/** Pure UI eligibility: an older COMPLETED generation may have been deleted
 * and replaced by a new independent schedule within the SAME TEST event.
 * This is only a button visibility gate. The Worker MUST still prove that
 * every old UUID returns HTTP 404 before any new job is persisted.
 */
export function isRetiredIndependentJob(state,snapshot){
 if(!state||!snapshot||state.event_id!==snapshot.eventId||
    state.status!=='completed')return false;
 const layout=describeOfficialFixtures(snapshot);
 if(layout.automaticFourMatch||layout.count<1||layout.count>24||
    layout.ready!==layout.count||layout.waiting||layout.finished)return false;
 const old=state.fixture_ids||{},oldCount=state.fixture_count||4;
 if(!Number.isInteger(oldCount)||oldCount<1||oldCount>24||
    Object.keys(old).length!==oldCount||
    !Array.from({length:oldCount},(_,i)=>String(i+1)).every(k=>UUID.test(old[k]||'')))
  return false;
 const oldIds=new Set(Object.values(old).map(id=>id.toLowerCase()));
 if(oldIds.size!==oldCount)return false;
 const newIds=new Set();
 for(let i=0;i<layout.count;i++){
  const m=layout.matches[i];
  if(m.seq!==i+1||!UUID.test(m.matchId||'')||
     m.status!=='scheduled'||!m.leftTeam||!m.rightTeam||
     m.leftTeam===m.rightTeam||m.leftScore!==0||m.rightScore!==0||
     m.existingGoals?.length!==0||
     /準決勝|3位決定|３位決定|順位決定|決勝|semifinal|semi-final|final|playoff/i.test(m.title||''))
   return false;
  const id=m.matchId.toLowerCase();
  if(oldIds.has(id)||newIds.has(id))return false;
  newIds.add(id);
 }
 return true;
}
export function prepareWorkerIndependent({snapshot,rows,decisions,requestId}){
 if(!snapshot||!UUID.test(snapshot.eventId||'')||!UUID.test(requestId||''))
  fail('正式なTESTイベントとジョブIDを確認できません');
 const layout=describeOfficialFixtures(snapshot);
 if(layout.automaticFourMatch||layout.count<1||layout.count>24)
  fail('この試合構成では独立試合の一括登録は使えません');
 if(layout.waiting||layout.finished||layout.ready!==layout.count){
  // Report exactly which SS fixture blocks a safe whole-event write, without
  // guessing a pending/finished match is safe to replay.
  const unsafe=layout.matches.filter(m=>m.status!=='scheduled'||
   !m.matchId||!m.leftTeam||!m.rightTeam);
  const details=unsafe.slice(0,6).map(m=>'#'+m.seq+' '+
   (m.status==='finished'?'終了済み':
    m.status==='waiting'?'対戦待ち':
    m.status!=='scheduled'?'状態 '+(m.status||'不明'):
    '対戦相手または公式試合IDが未設定')).join(' / ');
  fail('対戦確定待ち・終了済みの試合があります。'+
   (details?'該当するSS公式試合：'+details+'。':'')+
   '再登録せずSSの正式な試合状態を確認してください');
 }
 if(!layout.matches.every((m,i)=>m.seq===i+1&&UUID.test(m.matchId||'')&&
    m.status==='scheduled'&&m.leftTeam&&m.rightTeam&&
    m.leftTeam!==m.rightTeam&&m.existingGoals.length===0&&
    m.leftScore===0&&m.rightScore===0))
  fail('試合番号・公式試合ID・初期スコアを確認してください。既存ゴールがある場合は個別確認してください');
 if(layout.matches.some(m=>/準決勝|3位決定|３位決定|順位決定|決勝|semifinal|semi-final|final|playoff/i.test(m.title||'')))
  fail('順位決定戦・トーナメントの対戦は独立試合として登録できません');
 if(!Array.isArray(rows)||!Array.isArray(decisions)||decisions.length!==rows.length)
  fail('ゴールの確認結果が揃っていません');
 const selected=[],used=new Set();
 for(let i=0;i<rows.length;i++){
  const row=rows[i],decision=decisions[i];
  if(!row?.include)continue;
  if(decision?.state!=='ready')
   fail('ゴール'+(i+1)+'：'+(decision?.reason||'選手・試合の確認が必要です'));
  if(row.goal?.manual||row.updateGoalId||row.guest||row.fixtureIdentityChanged||
     decision.helperPlan||decision.deferredAssist)
   fail('ゴール'+(i+1)+'：手動追加・助っ人・既存修正は個別登録を使ってください');
  const seq=Number(row.seq),match=layout.matches.find(m=>m.seq===seq);
  const team=name(row.team||snapshot.playerTeam?.get(row.scorer)),scorer=name(row.scorer);
  const assist=row.assistMode==='named'?name(row.assist):'';
  if(!match||!team||!scorer||!['named','none'].includes(row.assistMode)||
     row.assistMode==='named'&&!assist||
     ![match.leftTeam,match.rightTeam].some(t=>normalizeTeam(t)===normalizeTeam(team))||
     !snapshot.playerTeam?.has(scorer)||
     normalizeTeam(snapshot.playerTeam.get(scorer))!==normalizeTeam(team)||
     assist&&(!snapshot.playerTeam.has(assist)||
       normalizeTeam(snapshot.playerTeam.get(assist))!==normalizeTeam(team)||
       normalizePerson(assist)===normalizePerson(scorer)))
   fail('ゴール'+(i+1)+'：試合・得点者・所属チームを確認してください');
  const key=[seq,normalizeTeam(team),normalizePerson(scorer),normalizePerson(assist)].join('|');
  if(used.has(key))fail('ゴール'+(i+1)+'：重複の可能性があります。個別確認してください');
  used.add(key);
  selected.push({seq,action:'create',team,scorer,assist,expected_match_id:match.matchId});
 }
 if(selected.length>20)fail('一括登録できるゴールは最大20件です');
 const operations=[];
 for(const m of layout.matches){
  operations.push(...selected.filter(g=>g.seq===m.seq));
  operations.push({seq:m.seq,action:'finish',winner:'auto',expected_match_id:m.matchId});
 }
 return {event_id:snapshot.eventId,request_id:requestId,confirm:'TEST-ONLY BATCH WRITE',
  layout_mode:'independent-fixtures-v1',fixture_count:layout.count,operations};
}
export function verifyIndependentWorkerCompletion(state,fresh,previous){
 if(state?.status!=='completed'||state?.layout_mode!=='independent-fixtures-v1'||
    fresh?.eventId!==state.event_id||previous?.eventId!==state.event_id)
  fail('独立試合ジョブの終了イベントが一致しません');
 const n=state.fixture_count;
 if(!Number.isInteger(n)||n<1||n>24||fresh.matches?.length!==n)
  fail('登録後のSS試合数が一致しません');
 for(const seq of Array.from({length:n},(_,i)=>i+1)){
  const m=fresh.matches.find(item=>item.seq===seq);
  const expected=state.fixture_ids?.[seq];
  if(!m||!UUID.test(expected||'')||m.matchId.toLowerCase()!==expected.toLowerCase()||
     m.status!=='finished')fail('試合 #'+seq+' の正式ID・終了状態を確認できません');
 }
 return true;
}
