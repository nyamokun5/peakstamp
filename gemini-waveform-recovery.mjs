/** Safari recovery for a fully recognized Gemini answer whose preview WAV waveform
 * cannot be re-decoded from a stale iCloud/Photos-backed File handle.
 * The fallback is a FLAT, clearly disclosed timeline, not an audio waveform.
 * Never re-submit any WAV to Gemini or invent acoustic peaks.
 */
import {MAX_GEMINI_DURATION_SECONDS} from './gemini-wav-chunks.mjs';
const finite=x=>Number.isFinite(Number(x));
export function usableWaveform(decoded,durationSeconds){
 const arr=decoded?.bins;
 return Array.isArray(arr)&&arr.length>0&&
  finite(decoded.duration)&&Number(decoded.duration)>0&&
  arr.every(bin=>finite(bin.time)&&Number(bin.time)>=0&&finite(bin.rms)&&Number(bin.rms)>=0);
}
export function isUnavailableFileError(error){
 const n=String(error?.name||'');
 const message=String(error?.message||error||'').toLowerCase();
 return n==='NotFoundError'||n==='NotReadableError'||
  /the object can not be found here|the object cannot be found here|the file could not be read|could not be found|file not found|unable to read file|the requested file|no such file/.test(message);
}
export function blankReviewTimeline(durationSeconds,{binSeconds=.25}={}){
 const duration=Number(durationSeconds);
 if(!Number.isFinite(duration)||duration<=0||duration>MAX_GEMINI_DURATION_SECONDS)
  throw Error('元動画の長さが不明なため、確認画面を復元できません。');
 if(!(binSeconds>0&&binSeconds<=1))throw Error('タイムライン間隔が不正です。');
 const n=Math.ceil(duration/binSeconds);
 return {duration,bins:Array.from({length:n},(_,i)=>({time:+(i*binSeconds).toFixed(3),rms:0})),
  waveformUnavailable:true};
}
/** If the AI answer already exists and the file provider's reference expired,
 * allow event review without rebuilding unavailable waveform bytes. A new
 * re-selected local File is still required for actual video replay/export.
 */
export async function restoreGeminiReviewWaveform({
 durationSeconds,existing,streamed,stored,decodeAudio,onProgress=()=>{},check=()=>{}
}={}){
 check();
 for(const candidate of [existing,streamed,stored]){
  if(usableWaveform(candidate))return {decoded:candidate,recovered:false};
 }
 if(typeof decodeAudio!=='function')throw Error('音声デコーダーがありません。');
 try{
  const decoded=await decodeAudio((label,progress)=>onProgress(label,progress),check);
  check();
  if(!usableWaveform(decoded))throw Error('確認用の音声波形を準備できませんでした。');
  return {decoded,recovered:false};
 }catch(error){
  check();
  if(!isUnavailableFileError(error))throw error;
  return {decoded:blankReviewTimeline(durationSeconds),recovered:true,error};
 }
}
