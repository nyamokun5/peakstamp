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
 let entries=[],aliasError=false;
 try{if(aliases.status!=='fulfilled')throw Error();entries=normalizeAliasList(aliases.value);}
 catch{aliasError=true;}
 return {snapshot,aliases:entries,aliasError};
}
export function initAnalysisNames(state,{onChange=()=>{}}={}){
 const $=id=>document.getElementById(id),panel=$('ssAnalysisNames');
 if(!panel||document.body.dataset.ssAnalysis!=='staging')return {refresh:async()=>{}};
 state.ssNameEnabled=true;panel.hidden=false;
 const token=$('ssAnalysisToken'),event=$('ssAnalysisEvent'),remember=$('ssAnalysisRemember');
 const status=$('ssAnalysisStatus'),connect=$('ssAnalysisConnect');
 let revision=0;
 const savedEvent=()=>{try{return sessionStorage.getItem(ANALYSIS_EVENT_KEY)||''}catch{return ''}};
 token.value=restoreBridgeSession(sessionStorage,'staging');remember.checked=Boolean(token.value);
 const invalidate=()=>{revision++;state.ssNameContext=null;onChange();};
 const read=async path=>{
  const password=token.value.trim();if(!password)throw Error('SS連携パスワードを入力してください。');
  const response=await fetch(gateway+path,{method:'GET',headers:{'X-SS-Bridge-Token':password},
   mode:'cors',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok){
   if([401,403].includes(response.status))clearBridgeSession(sessionStorage,'staging');
   throw Error('SSに接続できません。パスワードと通信を確認してください。');
  }
  return response.json();
 };
 async function refresh(){
  const current=++revision,id=event.value;
  state.ssNameContext=null;
  if(!id){status.textContent='SSイベントを選ぶと正式名で表示します。';onChange();return;}
  try{
   const context=await readAnalysisContext({eventId:id,read});
   if(current!==revision)return;
   state.ssNameContext=context;
   status.textContent=context.aliasError?'呼び名を取得できません。未確定の選手を選んでください。':'';
   $('ssAnalysisLabel').textContent='SS：'+event.selectedOptions[0].textContent;
   if(remember.checked)rememberBridgeSession(sessionStorage,'staging',token.value.trim());
   sessionStorage.setItem(ANALYSIS_EVENT_KEY,id);
   if(!context.aliasError)panel.open=false;
  }catch(error){if(current!==revision)return;status.textContent=error.message;panel.open=true;}
  onChange();
 }
 async function load(){
  const current=++revision;state.ssNameContext=null;onChange();connect.disabled=true;
  try{
   const data=await read('/events?limit=100');if(current!==revision)return;
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
 remember.addEventListener('change',()=>{if(!remember.checked)clearBridgeSession(sessionStorage,'staging');});
 event.addEventListener('change',()=>{invalidate();try{sessionStorage.removeItem(ANALYSIS_EVENT_KEY)}catch{}refresh();});
 connect.addEventListener('click',load);
 if(token.value)load();
 return {refresh};
}
