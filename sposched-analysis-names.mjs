import {normalizeSpoSnapshot} from './sposched-review-core.mjs';
import {normalizeAliasList} from './sposched-alias-admin.mjs';
import {restoreBridgeSession,rememberBridgeSession,clearBridgeSession} from './sposched-bridge-session.mjs';
export const ANALYSIS_EVENT_KEY='peakstamp_ss_analysis_event_staging_v1';
const gateway='https://shoot-sunday-sync-staging.yomax1979.workers.dev';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
// GET-only, bounded, no retries. A failed dictionary still permits direct names.
export async function readAnalysisContext({eventId,read}){
 if(!uuid.test(eventId))throw Error('TESTイベントを選んでください。');
 const [roster,aliases]=await Promise.allSettled([
  read('/snapshot?event_id='+encodeURIComponent(eventId)),read('/staging/alias/list')]);
 if(roster.status!=='fulfilled')throw Error('SS名簿を取得できません。接続を確認してください。');
 const snapshot=normalizeSpoSnapshot(roster.value);
 if(snapshot.eventId!==eventId||snapshot.rosterSource!=='official-current-event-teams')
  throw Error('SSの正式名簿を取得できません。イベントを確認してください。');
 let entries=[],aliasError=false,aliasErrorReason='';
 try{if(aliases.status!=='fulfilled')throw aliases.reason||Error('呼び名APIへの接続に失敗');entries=normalizeAliasList(aliases.value);}
 catch(error){aliasError=true;aliasErrorReason=error?.message||'呼び名一覧の形式を確認できません';}
 return {snapshot,aliases:entries,aliasError,aliasErrorReason};
}
export function initAnalysisNames(state,{onChange=()=>{}}={}){
 const $=id=>document.getElementById(id),panel=$('ssAnalysisNames');
 if(!panel||document.body.dataset.ssAnalysis!=='staging')return {refresh:async()=>{}};
 state.ssNameEnabled=true;panel.hidden=false;
 const token=$('ssAnalysisToken'),event=$('ssAnalysisEvent'),remember=$('ssAnalysisRemember');
 const status=$('ssAnalysisStatus'),connect=$('ssAnalysisConnect');
 const retry=document.createElement('button');retry.type='button';retry.textContent='名寄せを再実行';retry.hidden=true;retry.className='whisper-run';status.after(retry);
 let revision=0;
 const savedEvent=()=>{try{return sessionStorage.getItem(ANALYSIS_EVENT_KEY)||localStorage.getItem(ANALYSIS_EVENT_KEY)||''}catch{return ''}};
 const persistentKey='peakstamp_ss_bridge_device_staging_v1';
 const readSaved=()=>{try{return localStorage.getItem(persistentKey)||''}catch{return ''}};
 const saveDevice=()=>{try{if(remember.checked&&token.value.trim())localStorage.setItem(persistentKey,token.value.trim());else localStorage.removeItem(persistentKey)}catch{}};
 token.value=restoreBridgeSession(sessionStorage,'staging')||readSaved();remember.checked=Boolean(readSaved());
 const invalidate=()=>{revision++;state.ssNameContext=null;onChange();};
 const inspectBatch=async eventId=>{
  const password=token.value.trim();
  if(!password)throw Error('SS連携パスワードを確認してください');
  // Read-only POST: do not retry a failed inspection and never treat it
  // as proof that a write can safely start.
  const {inspectInlineBatchJob}=await import('./sposched-inline-inspect.mjs');
  return inspectInlineBatchJob({eventId,postInspect:async body=>{
   const response=await fetch(gateway+'/staging/batch/inspect',{
    method:'POST',headers:{'X-SS-Bridge-Token':password,'Content-Type':'application/json'},
    body:JSON.stringify(body),mode:'cors',cache:'no-store',signal:AbortSignal.timeout(20000)});
   let data;
   try{data=await response.json();}catch{throw Error('Workerの応答を解析できません');}
   return {status:response.status,body:data};
  }});
 };
 const startBatch=async plan=>{
  const password=token.value.trim();
  if(!password||!plan||plan.confirm!=='TEST-ONLY BATCH WRITE')
   throw Error('TEST登録の認証と確認が必要です');
  // Never retry a write request. An uncertain response is reconciled
  // through /staging/batch/inspect using the persisted request ID.
  const response=await fetch(gateway+'/staging/batch/start',{
   method:'POST',headers:{'X-SS-Bridge-Token':password,'Content-Type':'application/json'},
   body:JSON.stringify(plan),mode:'cors',cache:'no-store',
   signal:AbortSignal.timeout(30000)});
  let data;
  try{data=await response.json();}catch{throw Error('Workerの登録応答を読み取れません。再送しないでください');}
  if(!response.ok)throw Error(data?.error?.message||'Worker登録エラー '+response.status+'。再送しないでください');
  return data;
 };
 const refreshOfficial=async eventId=>{
  if(!uuid.test(eventId)||event.value!==eventId)
   throw Error('SSイベントが変更されました');
  const snapshot=normalizeSpoSnapshot(await read('/snapshot?event_id='+encodeURIComponent(eventId)));
  if(snapshot.eventId!==eventId||snapshot.rosterSource!=='official-current-event-teams')
   throw Error('SSの正式な最新試合情報を確認できません');
  return snapshot;
 };
 const recreateBatch=async plan=>{
  const password=token.value.trim();
  if(!password||plan?.confirm!=='TEST-ONLY BATCH WRITE'||
     plan?.confirm_recreation!=='TEST-ONLY RECREATE DELETED FIXTURES'||
     !uuid.test(plan?.request_id||'')||!uuid.test(plan?.previous_request_id||''))
   throw Error('TEST再作成の認証・確認が不足しています');
  // One write attempt only. On an ambiguous response the caller must inspect.
  const response=await fetch(gateway+'/staging/batch/recreate',{
   method:'POST',headers:{'X-SS-Bridge-Token':password,'Content-Type':'application/json'},
   body:JSON.stringify(plan),mode:'cors',cache:'no-store',
   signal:AbortSignal.timeout(30000)});
  let data;
  try{data=await response.json();}catch{
   throw Error('再作成の応答が不明です。再送せずWorker履歴を確認してください');
  }
  if(!response.ok)throw Error(data?.error?.message||'再作成エラー '+response.status);
  if(data.request_id!==plan.request_id||data.event_id!==plan.event_id)
   throw Error('再作成の応答IDが一致しません。再送せず照合してください');
  return data;
 };
 const appendSecondRound=async plan=>{
  const password=token.value.trim();
  if(!password||plan?.confirm!=='TEST-ONLY BATCH APPEND')
   throw Error('後半登録の認証と確認が必要です');
  // Never retry. A lost response must be reconciled by inspect.
  const response=await fetch(gateway+'/staging/batch/append-second-round',{
   method:'POST',headers:{'X-SS-Bridge-Token':password,'Content-Type':'application/json'},
   body:JSON.stringify(plan),mode:'cors',cache:'no-store',
   signal:AbortSignal.timeout(30000)});
  let data;
  try{data=await response.json();}catch{throw Error('後半登録の応答が不明です。再送せずWorkerを確認してください');}
  if(!response.ok)throw Error(data?.error?.message||'後半登録エラー '+response.status);
  if(data.request_id!==plan.request_id||data.event_id!==plan.event_id)
   throw Error('後半登録の応答IDが一致しません。再送しないでください');
  return data;
 };
 const read=async path=>{
  const password=token.value.trim();if(!password)throw Error('SS連携パスワードを入力してください。');
  let response;
  for(let attempt=0;attempt<2;attempt++){
   try{
    response=await fetch(gateway+path,{method:'GET',headers:{'X-SS-Bridge-Token':password},
     mode:'cors',cache:'no-store',signal:AbortSignal.timeout(20000)});
    break;
   }catch(error){
    if(attempt===0)continue; // One bounded retry for transient iPhone network failures.
    throw Error(error?.name==='TimeoutError'?'SS接続がタイムアウトしました。通信状態を確認して再接続してください。':
     'SSサーバーに接続できません（通信エラー）。少し待って「SSに接続」を押してください。');
   }
  }
  if(!response.ok){
   if([401,403].includes(response.status)){clearBridgeSession(sessionStorage,'staging');try{localStorage.removeItem(persistentKey)}catch{}}
   throw Error([401,403].includes(response.status)?'SS連携パスワードを確認してください。':
    'SSサーバーからエラー '+response.status+' が返りました。少し待って再接続してください。');
  }
  try{return await response.json();}catch{throw Error('SSサーバーの応答を読み取れません。再接続してください。');}
 };
 async function refresh(){
  const current=++revision,id=event.value;
  state.ssNameContext=null;retry.hidden=true;
  if(!id){status.textContent='SSイベントを選ぶと正式名で表示します。';onChange();return;}
  try{
   const context=await readAnalysisContext({eventId:id,read});
   if(current!==revision)return;
   state.ssNameContext=context;
   retry.hidden=!context.aliasError;
   status.textContent=context.aliasError?'呼び名を取得できません（'+context.aliasErrorReason+'）。正式名簿は利用できます。SSに再接続すると再取得します。':'';
   $('ssAnalysisLabel').textContent='SS：'+event.selectedOptions[0].textContent;
   if(remember.checked){rememberBridgeSession(sessionStorage,'staging',token.value.trim());saveDevice();}
   sessionStorage.setItem(ANALYSIS_EVENT_KEY,id);
   try{localStorage.setItem(ANALYSIS_EVENT_KEY,id)}catch{}
   panel.open=context.aliasError;
  }catch(error){if(current!==revision)return;retry.hidden=true;status.textContent=error.message;panel.open=true;}
  onChange();
 }
 async function load(){
  const current=++revision;state.ssNameContext=null;onChange();connect.disabled=true;
  try{
   const data=await read('/events?limit=100');if(current!==revision)return;
   if(remember.checked)saveDevice();
   const selected=event.value||savedEvent();event.replaceChildren(new Option('イベントを選択',''));
   for(const e of (data.events||[]).filter(e=>uuid.test(e.event_id||'')).sort((a,b)=>String(b.date).localeCompare(String(a.date))))
    event.add(new Option((e.date||'')+' '+(e.name||'TEST'),e.event_id));
   event.value=[...event.options].some(o=>o.value===selected)?selected:'';
   event.hidden=false;status.textContent='イベントを選んでください。';
   if(event.value)await refresh();
  }catch(error){if(current===revision)status.textContent=error.message;}
  finally{connect.disabled=false;}
 }
 token.addEventListener('input',invalidate);
 remember.addEventListener('change',()=>{if(!remember.checked)clearBridgeSession(sessionStorage,'staging');saveDevice();});
 event.addEventListener('change',()=>{invalidate();try{sessionStorage.removeItem(ANALYSIS_EVENT_KEY);localStorage.removeItem(ANALYSIS_EVENT_KEY)}catch{}refresh();});
 connect.addEventListener('click',load);
 retry.addEventListener('click',()=>refresh());
 if(token.value)load();
 return {refresh,inspectBatch,startBatch,recreateBatch,appendSecondRound,refreshOfficial};
}
