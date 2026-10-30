// Production-only UI adapter. TEST button paths and storage are untouched.
import {prepareProductionBatch,validateProductionReleaseEvidence,productionBatchStorageKey}
 from './sposched-production-release.mjs?v=production-bridge1';
import {verifyCompletedWorkerSnapshot} from './sposched-worker-batch.mjs?v=worker-helper-wait-side1';

export function installProductionUI({current,read,normalize,onComplete}){
 const $=id=>document.getElementById(id);
 let evidence=null,busy=false,polling=false,lastJob=null,restoredEvent='';
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
  const baseline=validateProductionReleaseEvidence(x.snapshot,official,release);
  const updated=validateProductionReleaseEvidence(newest,official,release);
  if(JSON.stringify(baseline.fixture_ids)!==JSON.stringify(updated.fixture_ids))
   throw Error('最新の試合IDが変わりました');
  const plan=prepareProductionBatch({snapshot:x.snapshot,rows:x.rows,decisions:x.decisions,
   requestId:crypto.randomUUID()});
  return {id,date:baseline.date,teamId:baseline.team_id,
   matchIds:baseline.fixture_ids,plan};
 }
 function render(){
  const x=active();
  $('productionPanel').hidden=!x;
  $('autoRegisterHeading').hidden=Boolean(x);
  evidence=null;
  $('productionPlan').hidden=true;
  $('productionStart').disabled=true;
  $('productionDecision').hidden=true;
  if(!x)return;
  const prior=localStorage.getItem(key(x.snapshot.eventId));
  $('productionRefresh').hidden=!prior;
  status(prior?'前回の本番登録ジョブがあります。再登録せず保存済みの進捗を確認します。':
   '現在のSSターゲットのみ本番登録できます。公式データと登録内容を確認してください。');
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
   out.textContent='本番団体：'+x.teamId+'\n開催日：'+x.date+
    '\nイベント：'+x.id+'\n'+goals+'ゴール＋4試合の結果を登録予定\n'+
    x.matchIds.map((id,i)=>'#'+(i+1)+' '+id).join('\n');
   $('productionStart').disabled=false;
   status('現在のターゲットと登録内容の照合が完了しました。登録ボタンで送信できます。');
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
   status('本番ジョブ：'+result.status+' / '+result.completed+'/'+result.total+'操作'+
    (result.status==='blocked'?'。結果不明につき再送信禁止':''));
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
    verifyCompletedWorkerSnapshot(result,newest,x.snapshot);
    onComplete(newest);
    status('✓ 本番4試合の終了と試合IDを公式SSデータで照合しました。再送信はしません。');
   }
   if(result.status==='running')window.setTimeout(refresh,1500);
  }catch(e){status('本番ジョブ確認未了：'+e.message+'。新規送信せず進捗を確認してください。');}
  finally{polling=false;$('productionRefresh').disabled=false;}
 }
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
