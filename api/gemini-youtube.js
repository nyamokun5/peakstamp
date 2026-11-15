/** Authenticated public-YouTube analysis. Provider credentials stay server-side.
 * Only the two existing organizer tasks are exposed; clients cannot supply
 * prompts, models, provider URLs or credentials. One request, no paid retry.
 */
import {timingSafeEqual} from 'node:crypto';
import peakStampPrompt from '../youtube-ps-prompt.mjs';
import {normalizeUnifiedUtterances,PROMPT_REVISION} from './gemini-audio.js';
import {MAX_GEMINI_DURATION_SECONDS} from '../gemini-wav-chunks.mjs';

const MODEL='gemini-3.8-flash';
const ENDPOINT='https://generativelanguage.googleapis.com/v1beta/models/'+MODEL+':generateContent';
const VIDEO=/^[A-Za-z0-9_-]{11}$/;
const ORIGIN='https://nyamokun5.github.io';
const allowedOrigins=()=>[ORIGIN,'https://peakstamp-ss-stage-nyamokun5.pages.dev',
 ...String(process.env.PEAKSTAMP_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)];
const error=(res,status,message)=>res.status(status).json({error:message});
const equalSecret=(value,secret)=>{
 if(typeof value!=='string'||typeof secret!=='string'||!secret)return false;
 const a=Buffer.from(value,'utf8'),b=Buffer.from(secret,'utf8');
 return a.length===b.length&&timingSafeEqual(a,b);
};
const round=n=>Math.round(n*10)/10;
function parseJson(answer){
 const text=String(answer||'').trim().replace(/^\x60{3}(?:json)?\s*/i,'').replace(/\s*\x60{3}$/,'');
 return JSON.parse(text);
}
async function responseJson(response){
 const reader=response.body?.getReader();
 if(!reader)throw Error('missing_response');
 const chunks=[];let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>524288){await reader.cancel();throw Error('response_too_large');}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function answerText(google){
 const candidates=Array.isArray(google?.candidates)?google.candidates:[];
 return candidates.flatMap(c=>Array.isArray(c?.content?.parts)?c.content.parts:[])
  .filter(p=>p?.thought!==true&&typeof p?.text==='string').map(p=>p.text).join('\n').trim();
}
function durationValue(value){
 if(typeof value==='number')return value;
 if(typeof value!=='string')return NaN;
 if(/^\d+(?:\.\d+)?$/.test(value.trim()))return Number(value);
 const match=value.trim().match(/^(\d+):([0-5]\d(?:\.\d+)?)$/);
 return match?Number(match[1])*60+Number(match[2]):NaN;
}
export function normalizeYouTubeAnalysis(parsed,seconds){
 if(!Array.isArray(parsed?.events)||!Array.isArray(parsed?.utterances))
  throw Error('missing_analysis_arrays');
 const types=new Set(['goal_reaction','shot_reaction','save_reaction','excited_reaction','other','uncertain']);
 const clamp=n=>Math.max(0,Math.min(seconds,n)),events=[];
 for(const raw of parsed.events.slice(0,40)){
  if(raw?.reaction_time_seconds==null||raw.reaction_time_seconds==='')continue;
  const reaction=Number(raw.reaction_time_seconds);
  if(!Number.isFinite(reaction)||reaction<0||reaction>seconds+2)continue;
  const start=raw.suggested_clip_start_seconds==null?NaN:Number(raw.suggested_clip_start_seconds);
  const end=raw.suggested_clip_end_seconds==null?NaN:Number(raw.suggested_clip_end_seconds);
  events.push({reaction_time_seconds:round(clamp(reaction)),type:types.has(raw.type)?raw.type:'uncertain',
   confidence:['high','medium','low'].includes(raw.confidence)?raw.confidence:'low',
   quote:typeof raw.quote==='string'?raw.quote.slice(0,240):'',
   audible_clue:typeof raw.audible_clue==='string'?raw.audible_clue.slice(0,400):'',
   suggested_clip_start_seconds:round(clamp(Number.isFinite(start)?Math.min(start,reaction):reaction-8)),
   suggested_clip_end_seconds:round(clamp(Number.isFinite(end)?Math.max(end,reaction):reaction+5))});
 }
 return {duration_seconds:seconds,events:events.sort((a,b)=>a.reaction_time_seconds-b.reaction_time_seconds),
  utterances:normalizeUnifiedUtterances(parsed.utterances,seconds),
  limitations:'Audio-only results are not evidence that these shots or goals occurred.'};
}

export default async function handler(req,res){
 const origin=String(req.headers.origin||'');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Origin');
 if(allowedOrigins().includes(origin)){
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','content-type, x-peakstamp-access');
  res.setHeader('Access-Control-Max-Age','300');
 }
 if(origin&&!allowedOrigins().includes(origin))return error(res,403,'このサイトからのアクセスは許可されません。');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(req.method==='GET')return res.status(200).json({service:'peakstamp-gemini-youtube',model:MODEL,
  promptRevision:PROMPT_REVISION,maxDurationSeconds:MAX_GEMINI_DURATION_SECONDS});
 if(req.method!=='POST')return error(res,405,'POSTのみ対応します。');
 const key=process.env.GEMINI_API_KEY,access=process.env.PEAKSTAMP_ACCESS_CODE;
 if(!key||!access)return error(res,503,'Gemini APIのサーバー設定が未完了です。');
 if(!equalSecret(req.headers['x-peakstamp-access'],access))return error(res,401,'アクセスコードが違います。');
 if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))
  return error(res,415,'JSONリクエストを送ってください。');
 const body=req.body;
 if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.isBuffer(body))
  return error(res,400,'JSONリクエストを送ってください。');
 // Keep this endpoint a fixed-purpose match analyzer, not a general paid proxy.
 if(Object.keys(body).some(k=>!['videoId','mode','durationSeconds'].includes(k))||
    JSON.stringify(body).length>2048||!VIDEO.test(body.videoId||'')||
    !['duration','highlights'].includes(body.mode))
  return error(res,400,'YouTube動画IDと解析モードを確認してください。');
 let seconds;
 if(body.mode==='duration'){
  if(body.durationSeconds!==undefined)return error(res,400,'動画長の確認に解析時間は指定できません。');
 }else{
  seconds=body.durationSeconds;
  if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<1||seconds>MAX_GEMINI_DURATION_SECONDS)
   return error(res,400,'Gemini解析は動画1本あたり30分以下に対応します。');
 }
 const instruction=body.mode==='duration'
  ?'Return ONLY the entire duration of this public YouTube video in seconds as JSON {"duration":number}. Do not analyze scenes, dialogue, goals or names. Return no other keys.'
  :peakStampPrompt(seconds);
 let response,google;
 try{
  response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
   signal:AbortSignal.timeout(165000),redirect:'error',body:JSON.stringify({contents:[{parts:[
    {fileData:{fileUri:'https://www.youtube.com/watch?v='+body.videoId},
     ...(body.mode==='highlights'?{videoMetadata:{startOffset:'0s',endOffset:seconds+'s'}}:{})},
    {text:instruction}]}],
    generationConfig:{responseMimeType:'application/json',maxOutputTokens:body.mode==='duration'?128:8192}})});
  if(!response.ok){
   if(response.status===429)return error(res,429,'Geminiの利用枠を確認し、しばらく待ってください。');
   return error(res,502,'YouTube動画を解析できませんでした。公開設定とGeminiの設定を確認してください。');
  }
  google=await responseJson(response);
 }catch(e){
  return error(res,e?.name==='TimeoutError'||e?.name==='AbortError'?504:502,
   'Geminiの結果を確認できませんでした。自動再解析は行っていません。');
 }
 let parsed;
 try{parsed=parseJson(answerText(google));}
 catch{return error(res,502,'Geminiの回答を確認できません。解析結果は保存していません。');}
 const meta={model:MODEL,api:'generateContent',source:'youtube',mode:body.mode,promptRevision:PROMPT_REVISION,
  inputTokens:Number.isFinite(google?.usageMetadata?.promptTokenCount)?google.usageMetadata.promptTokenCount:null,
  outputTokens:Number.isFinite(google?.usageMetadata?.candidatesTokenCount)?google.usageMetadata.candidatesTokenCount:null};
 if(body.mode==='duration'){
  const duration=durationValue(parsed?.duration);
  if(!Number.isFinite(duration)||duration<1)return error(res,502,'動画長を確認できませんでした。');
  // Report the discovered length so the UI can reject long videos without a
  // second paid request. Highlights independently enforces the same limit.
  return res.status(200).json({duration,maxDurationSeconds:MAX_GEMINI_DURATION_SECONDS,meta});
 }
 let result;
 try{result=normalizeYouTubeAnalysis(parsed,seconds);}
 catch{return error(res,502,'PS形式のゴール・アシスト解析結果を確認できません。保存せずに停止しました。');}
 return res.status(200).json({...result,meta});
}
