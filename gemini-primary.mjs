/**
 * Primary Gemini-only workflow: local MOV -> streamed PCM WAV -> authenticated API
 * -> on-device scene review. Never calls Whisper or acoustic peak detection.
 */
import { openVideoWavSegmenter } from './gemini-wav-stream.mjs?v=1';
import { runGeminiFastPipeline } from './gemini-fast-pipeline.mjs?v=1';
import { createGeminiFastWaveform } from './gemini-fast-waveform.mjs?v=1';
import { parseAudioEvents } from './cloud-audio-eval.mjs?v=3';
import { mergeWavSegmentEvents, WAV_SEGMENT_VERSION } from './gemini-wav-chunks.mjs?v=2';

// Verified owner project: Vercel production domain for nyamokun5/peakstamp.
const API_ENDPOINT = 'https://peakstamp-gemini-api.vercel.app/api/gemini-audio';
const MAX_AUDIO_BYTES = 2_900_000;
const CACHE_KEY = 'peakstamp_gemini_primary_json_v1';
const SEGMENT_CACHE_KEY='peakstamp_gemini_wav_segments_v1';
const segmentCacheId=source=>fileKey(source)+'::'+WAV_SEGMENT_VERSION;
function getSavedChunks(source){
 try{return JSON.parse(localStorage.getItem(SEGMENT_CACHE_KEY+'::'+segmentCacheId(source))||'{}');}
 catch(_){return {};}
}
function saveChunk(source,range,answer){
 try{
  const key=SEGMENT_CACHE_KEY+'::'+segmentCacheId(source);
  const cache=getSavedChunks(source);
  cache[range.startSeconds+':'+range.durationSeconds]={
   startSeconds:range.startSeconds,events:answer.events,
   model:answer?.meta?.model||'unknown'
  };
  localStorage.setItem(key,JSON.stringify(cache));
 }catch(_){/* Private Safari/limited storage; processing still continues. */}
}
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
  reader.onerror=()=>reject(Error('音声データを読み取れませんでした。'));
  reader.onabort=()=>reject(Error('音声データの読み取りをキャンセルしました。'));
  reader.onload=()=>{
   const url=String(reader.result||'');
   const delimiter=url.indexOf(',');
   if(delimiter<0)reject(Error('音声データの読み取り形式が不正です。'));
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
   ?'選択中：'+source.file.name+'。元動画は送信せず、音声を約70秒ずつWAV形式で送信します。'
   :'まず上の「動画を選ぶ」からMOV/MP4を選択してください。';
 if(!API_ENDPOINT && !cache && !processing){
  status('現在はAPIサーバーのデプロイ権限とGemini APIキーの設定待ちです。手動解析は「旧Gemini手動比較」から継続できます。');
 }
}
async function callApi(audio,duration,access,signal,format='m4a') {
 if(audio.bytes>MAX_AUDIO_BYTES)
  throw Error('音声ファイルが2.9MBを超えました。');
 const base64=await blobToBase64(audio.blob);
 if(signal.aborted)throw Error('解析をキャンセルしました。');
 const response=await fetch(API_ENDPOINT,{
  method:'POST',mode:'cors',signal,
  headers:{'Content-Type':'application/json','X-PeakStamp-Access':access},
  body:JSON.stringify({audioBase64:base64,durationSeconds:duration,audioFormat:format})
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
 const checkConnection=$('geminiMainCheck');
 if(checkConnection)checkConnection.addEventListener('click',async()=>{
  const access=$('geminiMainAccess').value.trim();
  if(!access){
   status('まずVercelのPEAKSTAMP_ACCESS_CODEに登録したアクセスコードを入力してください。');
   $('geminiMainAccess').focus();
   return;
  }
  const previousLabel=checkConnection.textContent;
  checkConnection.disabled=true;
  checkConnection.textContent='接続確認中…';
  status('VercelのAPIサーバーとアクセスコードを確認中。音声送信・Gemini課金はありません。');
  try{
   const controller=new AbortController();
   const timeout=setTimeout(()=>controller.abort(),18000);
   let response;
   try{
    response=await fetch(API_ENDPOINT,{method:'POST',mode:'cors',signal:controller.signal,
     headers:{'Content-Type':'application/json','X-PeakStamp-Access':access},
     body:JSON.stringify({probe:true})});
   }finally{clearTimeout(timeout);}
   let body={};
   try{body=await response.json();}catch(_){}
   const error=String(body?.error||'');
   if(response.ok && body?.ok===true && body?.ready===true && body?.googleKeyVerified===true){
    status('接続成功！Google APIキーと '+String(body.model||'Gemini')+' の利用可能状態を確認しました。音声の送信はありません。動画を選んで解析できます。');
   }else if(response.status===401){
    status('APIには到達しましたが、アクセスコードが一致しません。Vercelに設定したPEAKSTAMP_ACCESS_CODEを確認してください。');
   }else if(response.status===503){
    status('APIには到達しましたが、GEMINI_API_KEYかPEAKSTAMP_ACCESS_CODEがサーバーに反映されていません。Vercelで再デプロイしてください。');
   }else if(response.status===404){
    status('APIの公開先が見つかりません。Vercelのデプロイと/api/gemini-audioの配置を確認してください。');
   }else{
    status('API接続確認でHTTP '+response.status+'。'+(error||'APIサーバーの設定を確認してください。'));
   }
  }catch(e){
   status('APIに接続できません：'+(e?.name==='AbortError'?'時間切れです。':
    '通信またはCORSで拒否されました。')+' VercelのDeployment Protectionやデプロイ状態を確認してください。');
  }finally{
   checkConnection.disabled=false;
   checkConnection.textContent=previousLabel;
  }
 });
 const runDiagnostic=$('geminiMainDiagnostic');
 if(runDiagnostic)runDiagnostic.addEventListener('click',async()=>{
  const access=$('geminiMainAccess').value.trim();
  if(!access){
   status('まずAPIアクセスコードを入力してください。');
   $('geminiMainAccess').focus();
   return;
  }
  if(!window.confirm('音声APIの診断を行います。1秒の人工音声だけをGoogleに送信し、2回以下の短いGemini解析を行います。ごく少額のAPI料金が発生する場合があります。試合動画・会話は送信しません。続けますか？'))return;
  const original=runDiagnostic.textContent;
  runDiagnostic.disabled=true;
  runDiagnostic.textContent='音声API診断中…';
  status('テキストのみの解析と1秒の人工WAV音声を順番に確認中…');
  try{
   const controller=new AbortController();
   const timeout=setTimeout(()=>controller.abort(),80000);
   let response;
   try{
    response=await fetch(API_ENDPOINT,{method:'POST',mode:'cors',signal:controller.signal,
     headers:{'Content-Type':'application/json','X-PeakStamp-Access':access},
     body:JSON.stringify({diagnostic:'audio-compat',confirmSmallCost:true})});
   }finally{clearTimeout(timeout);}
   let body={};
   try{body=await response.json();}catch(_){}
   if(!response.ok || !body?.diagnostic){
    status('音声API診断を開始できませんでした（HTTP '+response.status+'）：'+
     String(body?.error||'接続や公開状態を確認してください。'));
    return;
   }
   const steps=(body.steps||[]).map(item=>item.name+'：'+
    (item.ok?'成功':'失敗 (HTTP '+(item.status??'接続エラー')+')'+
     (item.error?' '+item.error:''))).join(' ／ ');
   status('Gemini音声診断結果 — '+steps+'。'+String(body.conclusion||''));
  }catch(e){
   status('音声API診断の通信エラー：'+(e?.name==='AbortError'?'時間切れ':'接続できませんでした'));
  }finally{
   runDiagnostic.disabled=false;
   runDiagnostic.textContent=original;
  }
 });
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
   let duration=Number(cache?.duration_seconds);
   let answer;
   let decodedDuringGemini=null;
   let geminiSeconds=0;
   let waveformSeconds=0;
   if(cache){
    answer=cache;
    status('保存済みのGemini結果を復元しています。APIへの再送信はありません。');
   }else{
    status('元動画のWAVを準備しながらGeminiへ最大2区間ずつ送信します…');
    const geminiStarted=performance.now();
    const segmenter=await openVideoWavSegmenter(source.file,{
     isCancelled:()=>signal.aborted||id!==generation
    });
    try{
     alive();
     duration=segmenter.durationSeconds;
     const previous=getSavedChunks(source);
     const waveform=createGeminiFastWaveform(duration);
     let waveformFailed=false;
     const completed=await runGeminiFastPipeline({
      ranges:segmenter.ranges,
      makeSegment:range=>segmenter.makeSegment(range),
      // Reuse already decoded 16 kHz audio for the preview waveform,
      // avoiding another full MOV audio decode on a fresh run.
      onWav:async wav=>{
       if(waveformFailed)return;
       try{await waveform.add(wav);}
       catch(_){waveformFailed=true;}
      },
      request:(wav,range)=>callApi(wav,range.durationSeconds,access,signal,'wav'),
      cached:range=>previous[range.startSeconds+':'+range.durationSeconds],
      save:(range,response)=>{alive();saveChunk(source,range,response);},
      isCancelled:()=>signal.aborted||id!==generation,
      onFailure:()=>{if(id===generation)abortController?.abort();},
      onProgress:({index,phase,done,total,reused,inFlight})=>{
       if(id!==generation)return;
       const location=' 区間 '+(index+1)+'/'+total;
       if(phase==='decoding')status('音声をWAVに変換中：'+location+' / 完了 '+done+'/'+total);
       else if(phase==='submitted')status('Geminiへ並列送信中：完了 '+done+'/'+total+' / 処理中 '+inFlight+' 区間');
       else if(phase==='cached')status('保存済みの区間を再利用：完了 '+done+'/'+total+'（再利用 '+reused+'）');
       else if(phase==='received')status('Gemini解析が進行中：完了 '+done+'/'+total+' / 処理中 '+inFlight+' 区間');
      }
     });
     geminiSeconds=(performance.now()-geminiStarted)/1000;
     alive();
     answer=mergeWavSegmentEvents(completed.responses,segmenter.durationSeconds);
     if(!waveformFailed)decodedDuringGemini=waveform.finish();
     saveResult(source,answer);
    }finally{
     await segmenter.close();
    }
   }
   const parsed=parseAudioEvents(JSON.stringify(answer),duration);
   alive();
   const waveformStarted=performance.now();
   status('Gemini候補'+parsed.events.length+'件。確認用の音声波形を準備しています…');
   // Existing waveform wins, then the one reused from streamed WAV segments.
   // Partial chunk caches may still need the legacy local-only decoder.
   const decoded=source.bins?.length?{bins:source.bins,duration:source.duration}:
    decodedDuringGemini||await decodeAudio(source.file,
     (label,progress)=>{if(id===generation)status('確認用波形を準備中… '+Math.round(progress)+'%');},
     alive);
   waveformSeconds=(performance.now()-waveformStarted)/1000;
   alive();
   const summary=await commitResults({source,parsed,audio:{durationSeconds:duration},decoded,answer,fromCache:!!cache});
   alive();
   status('Gemini解析完了：'+summary.candidates+'件の候補（'+summary.merged+'件の近接反応を統合）。'+
    (cache?'保存済みのAI結果を利用。':'WAV音声を '+(answer.meta?.segments||'?')+' 区間に分けて並列解析。')+
    ' API方式：'+(answer.meta?.api||'不明')+'。'+
    ' 所要 '+elapsed(started)+'（区間解析 '+geminiSeconds.toFixed(1)+'秒、波形 '+waveformSeconds.toFixed(1)+'秒）。'+
    ' 下の「確認してキープ」で再生できます。');
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
