// Production-only UI adapter. TEST button paths and storage are untouched.
import {prepareProductionBatch,validateProductionReleaseEvidence,productionBatchStorageKey}
 from './sposched-production-release.mjs?v=production-bridge1';
import {verifyCompletedWorkerSnapshot} from './sposched-worker-batch.mjs?v=worker-helper-wait-side1';
import {prepareIndependentProductionBatch,validateIndependentProductionEvidence} from './sposched-production-independent.mjs';
import {describeOfficialFixtures} from './sposched-fixture-layout.mjs';
import {verifyIndependentWorkerCompletion} from './sposched-worker-independent.mjs';

export function installProductionUI({current,read,normalize,onComplete}){
 const $=id=>document.getElementById(id);
 let evidence=null,recreateEvidence=null,busy=false,polling=false,lastJob=null,restoredEvent='';
 const active=()=>{const x=current();return x?.active&&x.snapshot?.eventId?x:null;};
 const status=v=>{$('productionStatus').textContent=v;};
 const key=id=>productionBatchStorageKey(id);
 async function post(path,body){
  if(!active())throw Error('本番のイベントを正式に読み込んでください');
  const token=$('ssBridgeToken').value.trim();
  if(!token)throw Error('本番用のBRIDGE_TOKENが必要です');
  const r=await fetch('https://shoot-sunday-sync.yomax1979.workers.dev'+path,{
   method:'POST',mode:'cors',cache:'no-store',
   headers:{'X-SS-Bridge-Token':token,'Content-Type':'application/json'},
   body:JSON.stringify(body)
  });
  const result=await r.json();
  if(!r.ok)throw Object.assign(Error(result?.error?.message||'本番Worker HTTP '+r.status),
   {code:result?.error?.code||'upstream_error'});
  return result;
 }
 async function inspect(){
  const x=active();if(!x)throw Error('本番イベントを選択してください');
  const id=x.snapshot.eventId;
  const [release,official,latestRaw]=await Promise.all([
   read('/production/release-state?event_id='+encodeURIComponent(id)),
   read('/production/inspect?event_id='+encodeURIComponent(id)),
   read('/snapshot?event_id='+encodeURIComponent(id))
  ]);
  if(active()?.snapshot?.eventId!==id)throw Error('確認中に本番イベントが変更されました');
  const newest=normalize(latestRaw);
  const layout=describeOfficialFixtures(x.snapshot);
  // The official legacy four-match bracket may omit titles while placement
  // fixtures are still waiting. Never route those unresolved IDs into the
  // independent writer, which requires every fixture to be scheduled.
  const independent=!layout.automaticFourMatch&&layout.waiting===0&&layout.finished===0;
  const validate=independent?validateIndependentProductionEvidence:validateProductionReleaseEvidence;
  const baseline=validate(x.snapshot,official,release);
  const updated=validate(newest,official,release);
  if(independent&&newest.rosterSource!=='official-current-event-teams')
   throw Error('最新のSS公式チーム名簿を確認できません');
  if(JSON.stringify(baseline.fixture_ids)!==JSON.stringify(updated.fixture_ids))
   throw Error('最新の試合IDが変わりました');
  const args={snapshot:x.snapshot,rows:x.rows,decisions:x.decisions,
   requestId:crypto.randomUUID()};
  const plan=independent?prepareIndependentProductionBatch(args):prepareProductionBatch(args);
  return {id,date:baseline.date,teamId:baseline.team_id,
   matchIds:baseline.fixture_ids,plan};
 }
 function render(){
  const x=active();
  $('productionPanel').hidden=!x;
  $('autoRegisterHeading').hidden=Boolean(x);
  evidence=null;recreateEvidence=null;
  $('productionRecreate').hidden=!x||!localStorage.getItem(key(x.snapshot.eventId));
  $('productionRecreateStart').disabled=true;
  $('productionRecreatePlan').hidden=true;
  $('productionPlan').hidden=true;
  $('productionAudit').hidden=true;
  $('productionStart').disabled=true;
  $('productionDecision').hidden=true;
  $('productionStart').textContent='② '+(x?.snapshot?.matches?.length||4)+'試合を本番登録';
  if(!x)return;
  const prior=localStorage.getItem(key(x.snapshot.eventId));
  $('productionRefresh').hidden=!prior;
  status(prior?'前回の登録があります。「登録の進捗を確認」を押してください。':
   'まず①で登録内容を確認してください。');
  if(prior&&restoredEvent!==x.snapshot.eventId){
   restoredEvent=x.snapshot.eventId;
   Promise.resolve().then(refresh);
  }
 }
 $('productionCheck').addEventListener('click',async()=>{
  if(!active()||busy)return;
  busy=true;$('productionCheck').disabled=true;
  evidence=null;$('productionStart').disabled=true;
  const out=$('productionPlan');out.hidden=false;
  out.textContent='正式データを読み取りで確認中…';
  try{
   if(localStorage.getItem(key(active().snapshot.eventId)))
    throw Error('既存の本番登録ジョブがあるため、新しい送信はできません');
   const x=await inspect();
   evidence=x;
   const goals=x.plan.operations.filter(o=>o.action==='create').length;
   out.textContent='開催日：'+x.date+'\n登録予定：ゴール'+goals+'件、'+x.matchIds.length+'試合の結果';
   $('productionAuditIds').textContent='団体ID：'+x.teamId+'\nイベントID：'+x.id+'\n'+
    x.matchIds.map((id,i)=>'第'+(i+1)+'試合：'+(id||'対戦確定後に発行')).join('\n');
   $('productionAudit').hidden=false;
   $('productionStart').textContent='② '+x.matchIds.length+'試合を本番登録';
   $('productionStart').disabled=false;
   status('確認完了。②で本番登録できます。');
  }catch(e){out.textContent='確認未完了：'+e.message;status('本番への送信は行っていません。');}
  finally{busy=false;$('productionCheck').disabled=false;}
 });
 $('productionStart').addEventListener('click',async()=>{
  if(!active()||busy||!evidence)return;
  const earlier=evidence,eventId=earlier.id;
  if(localStorage.getItem(key(eventId)))return;
  busy=true;$('productionStart').disabled=true;
  try{
   const latest=await inspect();
   const normalized={...latest.plan,request_id:earlier.plan.request_id};
   if(!active()||active().snapshot.eventId!==eventId||
     latest.teamId!==earlier.teamId||
     JSON.stringify(latest.matchIds)!==JSON.stringify(earlier.matchIds)||
     JSON.stringify(normalized)!==JSON.stringify(earlier.plan))
    throw Error('本番の試合IDまたは登録予定が変わりました。再度確認してください');
   // Remember the request BEFORE sending. Unknown outcome cannot be retried.
   localStorage.setItem(key(eventId),earlier.plan.request_id);
   $('productionRefresh').hidden=false;evidence=null;
   try{await post('/production/batch/start',earlier.plan);}
   catch(e){status('送信結果が不確定です：'+e.message+'。再送しないで進捗を確認してください。');return;}
   await refresh();
  }catch(e){status('本番登録を停止：'+e.message);}
  finally{busy=false;$('productionStart').disabled=true;}
 });
 async function refresh(){
  const x=active();if(!x||polling)return;
  const id=x.snapshot.eventId,requestId=localStorage.getItem(key(id));
  if(!requestId)return;
  polling=true;$('productionRefresh').disabled=true;
  try{
   const result=await post('/production/batch/inspect',{event_id:id,request_id:requestId});
   if(!active()||active().snapshot.eventId!==id)return;
   if(result.environment!=='PRODUCTION'||result.event_id!==id||
      result.request_id!==requestId||result.inspection_only!==true)
    throw Error('保存済みの本番ジョブの識別情報が不一致');
   lastJob=result;
   $('productionRecreate').hidden=result.status!=='completed';
   const stateLabel={running:'登録中',completed:'登録完了',blocked:'要確認',
    needs_decision:'勝者の指定が必要',paused:'一時停止'}[result.status]||result.status;
   status(stateLabel+'：'+result.completed+'/'+result.total+'件'+
    (result.status==='blocked'?'。再送せず進捗を確認してください。':''));
   $('productionDecision').hidden=result.status!=='needs_decision';
   if(result.status==='needs_decision'){
    const d=result.decision;
    $('productionDecisionText').textContent='試合#'+d.seq+' '+d.left_team+' '+
      d.left_score+' - '+d.right_score+' '+d.right_team;
    for(const opt of $('productionWinner').options){
     if(!opt.value)continue;
     opt.disabled=!d.choices.includes(opt.value);
     opt.hidden=opt.disabled;
    }
    $('productionWinner').value='';
   }
   if(result.status==='completed'){
    const newest=normalize(await read('/snapshot?event_id='+encodeURIComponent(id)));
    if(!['four-knockout','independent-fixtures-v1'].includes(result.layout_mode))
     throw Error('登録ジョブの試合形式を確認できません');
    if(result.layout_mode==='independent-fixtures-v1')
     verifyIndependentWorkerCompletion(result,newest,x.snapshot);
    else verifyCompletedWorkerSnapshot(result,newest,x.snapshot);
    onComplete(newest);
    status('✓ '+(result.fixture_count||4)+'試合の登録と終了をSSで確認しました。');
   }
   if(result.status==='running')window.setTimeout(refresh,1500);
  }catch(e){status('本番ジョブ確認未了：'+e.message+'。新規送信せず進捗を確認してください。');}
  finally{polling=false;$('productionRefresh').disabled=false;}
 }
 $('productionRecreateCheck').addEventListener('click',async()=>{
  const x=active();if(!x||busy)return;
  busy=true;recreateEvidence=null;
  $('productionRecreateStart').disabled=true;
  const out=$('productionRecreatePlan');out.hidden=false;
  out.textContent='新しい正式試合を確認中…';
  try{
   const previous=localStorage.getItem(key(x.snapshot.eventId));
   const job=await post('/production/batch/inspect',{event_id:x.snapshot.eventId,request_id:previous});
   if(job.status!=='completed'||job.request_id!==previous||job.event_id!==x.snapshot.eventId)
    throw Error('完了済みの旧登録ジョブを確認できません');
   const next=await inspect();
   if(next.plan.layout_mode!=='independent-fixtures-v1')
    throw Error('新しい独立試合形式の正式登録先が必要です');
   const oldIds=Object.values(job.fixture_ids||{}).filter(Boolean).map(v=>v.toLowerCase());
   const newIds=next.matchIds.map(v=>v?.toLowerCase());
   if(oldIds.length!==(job.fixture_count||4)||newIds.some(id=>!id||oldIds.includes(id)))
    throw Error('旧試合と異なる新しい試合IDを確認できません');
   if(active()?.snapshot?.eventId!==next.id)throw Error('イベントが変更されました');
   recreateEvidence={next,previous};
   out.textContent='旧ジョブ：'+previous+'\n新しいイベント：'+next.id+
    '\n新しい正式試合ID：\n'+next.matchIds.join('\n')+
    '\n送信時にWorkerが旧試合削除と新試合未登録を再確認します。';
   $('productionRecreateStart').disabled=false;
  }catch(e){out.textContent='再登録確認未完了：'+e.message;}
  finally{busy=false;}
 });
 $('productionRecreateStart').addEventListener('click',async()=>{
  const checked=recreateEvidence,x=active();if(!checked||!x||busy)return;
  const {next,previous}=checked;
  if(x.snapshot.eventId!==next.id||localStorage.getItem(key(next.id))!==previous)return;
  if(!window.confirm('旧試合がSSで削除済みであることを確認しましたか？ 新しい'+next.matchIds.length+'試合へ本番再登録します。'))return;
  busy=true;$('productionRecreateStart').disabled=true;
  try{
   const latest=await inspect();
   if(latest.id!==next.id||latest.teamId!==next.teamId||
      JSON.stringify(latest.matchIds)!==JSON.stringify(next.matchIds)||
      JSON.stringify({...latest.plan,request_id:next.plan.request_id})!==JSON.stringify(next.plan))
    throw Error('正式試合または登録内容が変更されました。再確認してください');
   // Record the new ID before any network mutation; unknown replies must not be resent.
   localStorage.setItem(key(next.id),next.plan.request_id);
   recreateEvidence=null;
   try{
    await post('/production/batch/recreate',{...next.plan,
     previous_request_id:previous,
     confirm_recreation:'PRODUCTION EVENT RECREATE DELETED FIXTURES'});
   }catch(e){
    status('再登録の送信結果が不確定です：'+e.message+'。自動再送しません。進捗を確認してください。');
    return;
   }
   await refresh();
  }catch(e){status('再登録を停止：'+e.message);}
  finally{busy=false;}
 });
 $('productionRefresh').addEventListener('click',refresh);
 $('productionDecisionSend').addEventListener('click',async()=>{
  const x=active(),job=lastJob;if(!x||busy||job?.status!=='needs_decision')return;
  const winner=$('productionWinner').value;
  if(!job.decision?.choices?.includes(winner)||
     localStorage.getItem(key(x.snapshot.eventId))!==job.request_id)return;
  busy=true;$('productionDecisionSend').disabled=true;
  try{
   await post('/production/batch/decision',{
    event_id:job.event_id,request_id:job.request_id,
    seq:job.decision.seq,winner,confirm:'PRODUCTION EVENT BATCH DECISION'
   });
   $('productionDecision').hidden=true;
   await refresh();
  }catch(e){status('本番結果指定が不確定です：'+e.message+'。再送せず保存済み進捗を確認してください。');}
  finally{busy=false;$('productionDecisionSend').disabled=false;}
 });
 return {render,refresh};
}
