import {verifyCompletedIndependentSnapshot} from './sposched-independent-completion.mjs';
import {prepareIndependentWorkerBatch} from './sposched-independent-worker-batch.mjs';
// Production-only UI adapter. TEST button paths and storage are untouched.
import {prepareProductionBatch,validateProductionReleaseEvidence,validateIndependentProductionReleaseEvidence,productionBatchStorageKey}
 from './sposched-production-release.mjs?v=production-bridge1';
import {verifyCompletedWorkerSnapshot} from './sposched-worker-batch.mjs?v=worker-helper-wait-side1';

export function productionResumePayload(job,eventId,requestId){
 if(job?.environment!=='PRODUCTION'||job.control_contract!=='event-pause-v1'||
    job.inspection_only!==true||job.execution_active!==false||
    job.event_id!==eventId||job.request_id!==requestId||!eventId||!requestId||
    job.status!=='paused'||job.phase!=='preparing'||job.pause_requested!==true||
    typeof job.pause_id!=='string'||!job.pause_id||
    !Number.isInteger(job.cursor)||job.cursor<0)
  throw Error('安全な停止位置を確認できません。結果不明の操作は再送しません');
 return {event_id:eventId,request_id:requestId,pause_id:job.pause_id,cursor:job.cursor,
  confirm:'PRODUCTION EVENT BATCH RESUME'};
}

export function installProductionUI({current,read,normalize,onComplete}){
 const $=id=>document.getElementById(id);
 let evidence=null,busy=false,polling=false,lastJob=null,restoredEvent='',revision=0;
 const active=()=>{const x=current();return x?.active&&x.snapshot?.eventId?x:null;};
 const status=v=>{$('productionStatus').textContent=v;};
 const key=id=>productionBatchStorageKey(id);
 async function post(path,body){
  if(!active()||body.event_id!==active().snapshot.eventId)throw Error('本番のイベントを正式に読み込んでください');
  const token=$('ssBridgeToken').value.trim();
  if(!token)throw Error('本番用のBRIDGE_TOKENが必要です');
  const r=await fetch('https://shoot-sunday-sync.yomax1979.workers.dev'+path,{
   method:'POST',mode:'cors',cache:'no-store',
   headers:{'X-SS-Bridge-Token':token,'Content-Type':'application/json'},
   redirect:'error',body:JSON.stringify(body)
  });
  const result=await r.json();
  if(!r.ok)throw Object.assign(Error(result?.error?.message||'本番Worker HTTP '+r.status),
   {code:result?.error?.code||'upstream_error'});
  return result;
 }
 async function inspect(){
  const x=active();if(!x)throw Error('本番イベントを選択してください');
  const id=x.snapshot.eventId,startedRevision=revision;
  const independentFormat=['1team','2teams_1pitch','3teams_1pitch'].includes(x.snapshot.officialFormat);
  const [release,official,latestRaw]=await Promise.all([
   read('/production/release-state?event_id='+encodeURIComponent(id)),
   read('/production/inspect?event_id='+encodeURIComponent(id)),
   read('/snapshot?event_id='+encodeURIComponent(id))
  ]);
  if(revision!==startedRevision||active()?.snapshot?.eventId!==id)throw Error('確認中に本番イベントが変更されました');
  const newest=normalize(latestRaw);
  const validate=independentFormat?validateIndependentProductionReleaseEvidence:validateProductionReleaseEvidence;
  const baseline=validate(x.snapshot,official,release);
  const updated=validate(newest,official,release);
  if(JSON.stringify(baseline.fixture_ids)!==JSON.stringify(updated.fixture_ids))
   throw Error('最新の試合IDが変わりました');
  const prepare=independentFormat?prepareIndependentWorkerBatch:prepareProductionBatch;
  const plan=prepare({snapshot:x.snapshot,rows:x.rows,decisions:x.decisions,
   requestId:crypto.randomUUID()});
  return {id,date:baseline.date,teamId:baseline.team_id,
   matchIds:baseline.fixture_ids,plan};
 }
 function render(){
  revision++;lastJob=null;
  $('productionResume').hidden=true;
  const x=active();
  $('productionPanel').hidden=!x;
  $('autoRegisterHeading').hidden=Boolean(x);
  evidence=null;
  $('productionPlan').hidden=true;
  $('productionAudit').hidden=true;
  $('productionStart').disabled=true;
  $('productionDecision').hidden=true;
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
  const id=x.snapshot.eventId,startedRevision=revision,requestId=localStorage.getItem(key(id));
  if(!requestId)return;
  polling=true;$('productionRefresh').disabled=true;
  lastJob=null;$('productionResume').hidden=true;
  try{
   const result=await post('/production/batch/inspect',{event_id:id,request_id:requestId});
   if(revision!==startedRevision||!active()||active().snapshot.eventId!==id)return;
   if(result.environment!=='PRODUCTION'||result.event_id!==id||
      result.request_id!==requestId||result.inspection_only!==true)
    throw Error('保存済みの本番ジョブの識別情報が不一致');
   lastJob=result;
   try{productionResumePayload(result,id,requestId);$('productionResume').hidden=false;}
   catch{$('productionResume').hidden=true;}
   const stateLabel={running:'登録中',completed:'登録完了',blocked:'要確認',
    needs_decision:'勝者の指定が必要',paused:'一時停止'}[result.status]||result.status;
   status(stateLabel+'：'+result.completed+'/'+result.total+'件'+
    (result.status==='blocked'?'。送信済みの可能性があります。SSの試合・ゴールを照合してください。試合の削除・作り直しや再登録は行わないでください。':''));
   if(result.status==='running'&&result.execution_active!==true)
    status('処理の実行を確認できません：'+result.completed+'/'+result.total+'件。状態確認では処理を再開しません。再登録せず、SSの試合・ゴールと保存済みジョブを照合してください。');
   if(result.status==='paused')
    status('一時停止中：'+result.completed+'/'+result.total+'件。再開ボタンが表示されている場合、停止位置を再照合して続きから再開できます。表示されない場合は再送せず公式記録を照合してください。');
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
    if(result.layout_mode==='independent-fixtures-v1'&&
       (!Number.isInteger(result.fixture_count)||result.fixture_count<1||result.fixture_count>24||
        result.completed!==result.total||!result.inspection_only))
     throw Error('独立試合ジョブの完了証跡が不完全です');
    const newest=normalize(await read('/snapshot?event_id='+encodeURIComponent(id)));
    if(revision!==startedRevision||active()?.snapshot?.eventId!==id)return;
    if(result.layout_mode==='independent-fixtures-v1'){
     verifyCompletedIndependentSnapshot(result,newest,x.snapshot);
     onComplete(newest);
     status('✓ '+result.fixture_count+'試合の登録と終了をSSで確認しました。');
    }else{
     verifyCompletedWorkerSnapshot(result,newest,x.snapshot);
     onComplete(newest);
     status('✓ 4試合の登録と終了をSSで確認しました。');
    }
   }
   if(result.status==='running'&&result.execution_active===true)window.setTimeout(refresh,1500);
  }catch(e){status('本番ジョブ確認未了：'+e.message+'。新規送信せず進捗を確認してください。');}
  finally{polling=false;$('productionRefresh').disabled=false;}
 }
 $('productionResume').addEventListener('click',async()=>{
  const x=active(),job=lastJob;if(!x||busy||polling||!job)return;
  const eventId=x.snapshot.eventId,requestId=localStorage.getItem(key(eventId));
  const startedRevision=revision;let approved;
  try{approved=productionResumePayload(job,eventId,requestId);}catch{return;}
  busy=true;$('productionResume').disabled=true;
  lastJob=null;$('productionResume').hidden=true;
  try{
   const fresh=await post('/production/batch/inspect',{event_id:eventId,request_id:requestId});
   const latest=productionResumePayload(fresh,eventId,requestId);
   if(revision!==startedRevision||active()?.snapshot.eventId!==eventId||
      localStorage.getItem(key(eventId))!==requestId||JSON.stringify(latest)!==JSON.stringify(approved))
    throw Error('停止位置が変更されました。進捗を再取得してください');
   const release=await read('/production/release-state?event_id='+encodeURIComponent(eventId));
   if(revision!==startedRevision||active()?.snapshot.eventId!==eventId||
      localStorage.getItem(key(eventId))!==requestId||
      release.environment!=='PRODUCTION'||release.event_id!==eventId||
      release.target_event_id!==eventId||release.scope!=='current-target'||release.release_ready!==true)
    throw Error('現在の本番ターゲットの再開許可を確認できません');
   await post('/production/batch/resume',approved);
   await refresh();
  }catch(e){status('再開を確認できません：'+e.message+'。再送せず登録の進捗を確認してください。');}
  finally{busy=false;$('productionResume').disabled=false;}
 });
 $('productionRefresh').addEventListener('click',refresh);
 $('productionDecisionSend').addEventListener('click',async()=>{
  const x=active(),job=lastJob;if(!x||busy||job?.status!=='needs_decision')return;
  const winner=$('productionWinner').value;
  if(job.event_id!==x.snapshot.eventId||!job.decision?.choices?.includes(winner)||
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
