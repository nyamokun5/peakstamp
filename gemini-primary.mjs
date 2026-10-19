/**
 * Primary Gemini-only workflow: local MOV -> compressed M4A -> authenticated API
 * -> on-device scene review. Never calls Whisper or acoustic peak detection.
 */
import { extractAudioOnly, formatFileSize } from './cloud-audio-export.mjs?v=2';
import { parseAudioEvents } from './cloud-audio-eval.mjs?v=3';

// Set only after deployment URL and ownership are verified; never guess a host.
const API_ENDPOINT = '';
const MAX_AUDIO_BYTES = 2_900_000;
const CACHE_KEY = 'peakstamp_gemini_primary_json_v1';
const $ = id => document.getElementById(id);
let selected = 0, processing = false, generation = 0, abortController = null;
const fileKey = source => [
 source?.file?.name || '', source?.file?.size || 0, source?.file?.lastModified || 0
].join('::');
function cachedResult(source) {
 try {
  const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  const obj = all[fileKey(source)];
  return obj?.events && Array.isArray(obj.events) ? obj : null;
 } catch (_) { return null; }
}
function saveResult(source, response) {
 try {
  const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  all[fileKey(source)] = response;
  const keys = Object.keys(all);
  if (keys.length > 12) for(const key of keys.slice(0,keys.length-12)) delete all[key];
  localStorage.setItem(CACHE_KEY, JSON.stringify(all));
 } catch (_) { /* Safari private browsing or storage quota. */ }
}
function status(message) {
 const el = $('geminiMainStatus');
 if (el) el.textContent = message;
}
function candidates(state) {
 return (state?.sources || []).filter(s=>s?.file && s?.objectUrl);
}
function selectedSource(state) {
 return candidates(state)[selected] || null;
}
function elapsed(start) { return ((performance.now()-start)/1000).toFixed(1)+'秒'; }
function blobToBase64(blob) {
 return new Promise((resolve,reject)=>{
  const reader = new FileReader();
  reader.onerror=()=>reject(Error('M4Aを読み取れませんでした。'));
  reader.onabort=()=>reject(Error('M4Aの読み取りをキャンセルしました。'));
  reader.onload=()=>{
   const url=String(reader.result||'');
   const delimiter=url.indexOf(',');
   if(delimiter<0)reject(Error('M4Aの読み取り形式が不正です。'));
   else resolve(url.slice(delimiter+1));
  };
  reader.readAsDataURL(blob);
 });
}
export function refreshGeminiPrimary(state) {
 const picker=$('geminiMainSource'),button=$('geminiMainRun');
 const second=$('geminiMainForce');
 if(!picker||!button||!second)return;
 const sources=candidates(state);
 const current=picker.value;
 picker.replaceChildren();
 for(const [i,source] of sources.entries()){
  const opt=document.createElement('option');
  opt.value=String(i);
  opt.textContent=source.file.name;
  picker.append(opt);
 }
 selected=Math.min(selected,Math.max(0,sources.length-1));
 if(current!=='' && Number.isInteger(Number(current)) && Number(current)>=0 && Number(current)<sources.length)
  selected=Number(current);
 picker.value=sources.length?String(selected):'';
 const source=sources[selected]||null;
 const cache=source&&cachedResult(source);
 picker.disabled=processing||sources.length<2;
 button.disabled=processing||!source||state.working||state.exporting||(!cache && !API_ENDPOINT);
 second.disabled=button.disabled;
 button.textContent=processing?'Gemini処理中…':cache?'保存済みのGemini結果を復元':(!API_ENDPOINT?'Gemini APIサーバー接続待ち':'Geminiで音声解析する →');
 second.hidden=!cache||processing||!API_ENDPOINT;
 $('geminiMainCancel').hidden=!processing;
 $('geminiMainFileHelp').textContent=source
   ?'選択中：'+source.file.name+'。元動画は送信せず、約40kbpsの音声だけをGoogleへ送ります。'
   :'まず上の「動画を選ぶ」からMOV/MP4を選択してください。';
 if(!API_ENDPOINT && !cache && !processing){
  status('現在はAPIサーバーのデプロイ権限とGemini APIキーの設定待ちです。手動解析は「旧Gemini手動比較」から継続できます。');
 }
}
async function callApi(audio,duration,access,signal) {
 if(audio.bytes>MAX_AUDIO_BYTES)
  throw Error('音声ファイルが2.9MBを超えました。10分以下の動画をお試しください。');
 const base64=await blobToBase64(audio.blob);
 if(signal.aborted)throw Error('解析をキャンセルしました。');
 const response=await fetch(API_ENDPOINT,{
  method:'POST',mode:'cors',signal,
  headers:{'Content-Type':'application/json','X-PeakStamp-Access':access},
  body:JSON.stringify({audioBase64:base64,durationSeconds:duration})
 });
 let result=null;
 try{result=await response.json();}catch(_){}
 if(!response.ok)throw Error(result?.error||('Geminiサーバーの応答エラー HTTP '+response.status));
 if(!result || !Array.isArray(result.events))
  throw Error('Geminiからの候補データを読み取れませんでした。');
 return result;
}
export function initGeminiPrimary(state,{decodeAudio,commitResults}) {
 if(!$('geminiMainRun')||typeof decodeAudio!=='function'||typeof commitResults!=='function')return;
 $('geminiMainSource').addEventListener('change',()=>{
  selected=Number($('geminiMainSource').value)||0;
  refreshGeminiPrimary(state);
 });
 $('geminiMainCancel').addEventListener('click',()=>{
  generation++;
  abortController?.abort();
  status('解析を中止しました。既に送信された音声のAPI料金は発生する場合があります。');
  // Audio conversion cannot be interrupted mid-execution on every device.
 });
 const run=async force=>{
  const source=selectedSource(state);
  if(!source||processing||state.working||state.exporting)return;
  const cache=force?null:cachedResult(source);
  const access=$('geminiMainAccess').value.trim();
  if(!cache && !API_ENDPOINT){
   status('APIサーバーの公開先が未設定です。Vercelでサーバーをデプロイしてから使用できます。');
   return;
  }
  if(!cache && !access){
   status('Gemini APIアクセスコードを入力してください。コードは端末に保存しません。');
   $('geminiMainAccess').focus();
   return;
  }
  if(!cache && !$('geminiMainConsent').checked){
   status('音声をGoogleに送信することへの同意をチェックしてください。元動画は送信されません。');
   return;
  }
  const started=performance.now();
  const id=++generation;
  processing=true;
  abortController=new AbortController();
  const signal=abortController.signal;
  const alive=()=>{
   if(signal.aborted||id!==generation)throw Error('解析を中止しました。');
   if(!state.sources.includes(source))throw Error('動画が削除されたため解析を中止しました。');
  };
  refreshGeminiPrimary(state);
  try{
   status('iPhone内で音声だけを圧縮しています。元動画はアップロードしません。');
   let audio=await extractAudioOnly(source.file,{
    mode:'api',isCancelled:()=>signal.aborted||id!==generation,
    onProgress:percent=>{if(id===generation)status('音声を圧縮中… '+percent+'%');}
   });
   alive();
   if(audio.bytes>MAX_AUDIO_BYTES){
    status('音声が2.9MBを超えたため、さらに圧縮しています…');
    audio=await extractAudioOnly(source.file,{mode:'api-low',
     isCancelled:()=>signal.aborted||id!==generation});
    alive();
   }
   if(audio.bytes>MAX_AUDIO_BYTES)throw Error('音声が2.9MBを超えました。動画を短く分割してください。');
   const duration=Number(audio.durationSeconds);
   if(!(duration>0)||duration>900)throw Error('15分を超える動画は現在のAPIモードに対応していません。');
   let answer;
   if(cache){
    answer=cache;
    status('保存済みのGemini結果を復元しています。APIへの再送信はありません。');
   }else{
    status(formatFileSize(audio.bytes)+'の音声だけをGeminiへ送信して解析しています…');
    answer=await callApi(audio,duration,access,signal);
    alive();
    saveResult(source,answer);
   }
   const parsed=parseAudioEvents(JSON.stringify(answer),duration);
   alive();
   status('Gemini候補'+parsed.events.length+'件。確認用の音声波形をiPhone内で準備しています…');
   const decoded=await decodeAudio(audio.file,
    (label,progress)=>{if(id===generation)status('確認用波形を準備中… '+Math.round(progress)+'%');},
    alive);
   alive();
   const summary=await commitResults({source,parsed,audio,decoded,answer,fromCache:!!cache});
   alive();
   status('Gemini解析完了：'+summary.candidates+'件の候補（'+summary.merged+'件の近接反応を統合）。'+
    (cache?'保存済みのAI結果を利用。':'送信した音声 '+formatFileSize(audio.bytes)+'。')+
    ' 所要 '+elapsed(started)+'。下の「確認してキープ」で再生できます。');
  }catch(e){
   if(id===generation)status('Gemini解析エラー：'+(e?.message||String(e)));
  }finally{
   if(id===generation){
    processing=false;abortController=null;
    refreshGeminiPrimary(state);
   }
  }
 };
 $('geminiMainRun').addEventListener('click',()=>run(false));
 $('geminiMainForce').addEventListener('click',()=>run(true));
 refreshGeminiPrimary(state);
}
