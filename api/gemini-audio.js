/**
 * PeakStamp Gemini proxy. All secrets are server-only.
 *
 * Audio is forwarded to Google Gemini; minimal Interactions API is the primary
 * request, with generateContent tried once only on a 400 or 404.
 * The video itself is never sent; this function stores no media or transcripts.
 * Requires GEMINI_API_KEY and PEAKSTAMP_ACCESS_CODE.
 */
import { timingSafeEqual } from 'node:crypto';

const MODEL='gemini-3.8-flash';
const MAX_BYTES=2900000;
const MAX_DURATION_SECONDS=600;
const ORIGIN='https://nyamokun5.github.io';
const allowedOrigins=()=>[ORIGIN,...String(process.env.PEAKSTAMP_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)];
const reply=(res,status,message)=>res.status(status).json({error:message});
const equalSecret=(value,secret)=>{
 if(typeof value!=='string'||typeof secret!=='string'||!secret)return false;
 const a=Buffer.from(value,'utf8'),b=Buffer.from(secret,'utf8');
 return a.length===b.length&&timingSafeEqual(a,b);
};
function prompt(duration){
 return [
  'You hear AUDIO ONLY recorded at a Japanese/English amateur football/futsal match.',
  'Audio recording length: '+Math.round(duration)+' seconds. Analyze the WHOLE recording.',
  'Return a single JSON object listing up to 24 DISTINCT audible reactions associated with goals, shots, near misses, goalkeeper saves and good play.',
  'Listen for Japanese ナイシュー、ナイスシュート、惜しい、ゴール、ナイスキー、うまい、打て and English comments. Use language and nearby audio context, not loudness alone.',
  'Do not infer actual visual events as certainty: you CANNOT see the video. Do not invent words, timestamps, or goals.',
  'Use reaction onset seconds from recording start as reaction_time_seconds, not estimated kick time.',
  'Deduplicate cheers and remarks referring to the SAME play, particularly within 6 seconds.',
  'Types: goal_reaction, shot_reaction, save_reaction, excited_reaction, other, uncertain. Confidence: high, medium, low.',
  'For each event, quote only clearly audible words (else empty string) and briefly explain audible_clue.',
  'Set suggested_clip_start_seconds to about 8 seconds before the reaction and suggested_clip_end_seconds to about 5 seconds afterward. Clamp both to recording length.',
  'If nothing noteworthy is audible, events must be empty. No fabricated example events.',
  'The limitations field must state that audio reactions cannot verify the video plays.',
  'Return VALID JSON text only, not Markdown and not an explanation.',
  'The top-level JSON keys MUST be exactly duration_seconds, events, limitations.',
  'duration_seconds is a number. limitations is a string. events is an array.',
  'Each object in events MUST contain numeric reaction_time_seconds, string type, string confidence, string quote, string audible_clue, numeric suggested_clip_start_seconds and numeric suggested_clip_end_seconds.',
  'If there are no valid scenes, return this structure: {"duration_seconds":'+Math.round(duration)+',"events":[],"limitations":"Audio-only; no visual verification."}.'
 ].join('\n');
}
const trimError=message=>String(message||'')
 .replace(/AIza[0-9A-Za-z_-]{15,}/g,'[API_KEY]')
 .replace(/(?:key|api[_-]?key|token|authorization)\s*[:=]\s*\S+/ig,'[SECRET]')
 .replace(/[A-Za-z0-9+/]{80,}={0,2}/g,'[BINARY_DATA]')
 .replace(/[\u0000-\u001f]+/g,' ')
 .slice(0,420);
async function googleError(response){
 let details='';
 try{
  const provider=await response.json();
  details=trimError(provider?.error?.message||provider?.message||'');
 }catch(_){}
 if(response.status===400)return 'Google APIがリクエストを拒否しました（HTTP 400）。'+(details?'詳細: '+details:'詳細は取得できませんでした。');
 if(response.status===404)return 'Geminiモデル '+MODEL+' が見つからないか、このAPIでは利用できません（Google HTTP 404）。'+(details?' '+details:'');
 if(response.status===429)return 'Geminiの利用上限に達しました（Google HTTP 429）。';
 if(response.status===401||response.status===403)return 'Gemini APIキー・請求設定・利用権限を確認してください（Google HTTP '+response.status+'）。';
 return 'Google Gemini APIがエラーを返しました（HTTP '+response.status+'）。'+(details?' '+details:'');
}

/*
 * Two documented request shapes:
 *  1. Minimal Interactions API, without structured-output schema or tuning.
 *  2. Core generateContent API as a fallback only on HTTP 400 or 404.
 * This avoids multiple paid successful generations for one video.
 */
async function requestGemini(base64,seconds,key){
 const inputs=[
  {
   label:'Interactions API',
   url:'https://generativelanguage.googleapis.com/v1beta/interactions',
   body:{
    model:MODEL,
    input:[{type:'text',text:prompt(seconds)},{type:'audio',data:base64,mime_type:'audio/m4a'}],
    store:false
   }
  },
  {
   label:'generateContent API',
   url:'https://generativelanguage.googleapis.com/v1beta/models/'+MODEL+':generateContent',
   body:{
    contents:[{role:'user',parts:[
      {text:prompt(seconds)},
      {inlineData:{mimeType:'audio/mp4',data:base64}}
    ]}],
    generationConfig:{maxOutputTokens:8192}
   }
  }
 ];
 const errors=[];
 for(let i=0;i<inputs.length;i++){
  const attempt=inputs[i];
  let response;
  try{
   response=await fetch(attempt.url,{
    method:'POST',
    headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify(attempt.body),
    signal:AbortSignal.timeout(135000)
   });
  }catch(e){
   const msg=e?.name==='TimeoutError'?'Geminiの解析が時間切れになりました。':'Googleへの接続に失敗しました。';
   return {error:msg,code:504};
  }
  if(!response.ok){
   const message=await googleError(response);
   errors.push(attempt.label+'：'+message);
   // Only invalid requests or unsupported endpoints can trigger a second try.
   // Never retry auth failures, rate limits or potentially billed/server errors.
   if((response.status===400||response.status===404)&&i===0)continue;
   return {error:errors.join(' / ').slice(0,940),code:502};
  }
  let data;
  try{data=await response.json();}
  catch(_){return {error:attempt.label+'：Googleの応答JSONを読み取れませんでした。',code:502};}
  return {data,api:i===0?'interactions':'generateContent',fallback:i>0};
 }
 return {error:errors.join(' / ').slice(0,940)||'Google APIを利用できません。',code:502};
}
/** Safely parse strict or Markdown-fenced JSON in non-schema responses. */
function parseModelJson(answer){
 const cleaned=String(answer||'').trim().replace(/^\x60{3}(?:json)?\s*/i,'').replace(/\s*\x60{3}$/,'');
 const a=cleaned.indexOf('{'),b=cleaned.lastIndexOf('}');
 const inputs=[cleaned];
 if(a>=0&&b>a)inputs.push(cleaned.slice(a,b+1));
 for(const input of inputs){
  try{return JSON.parse(input);}catch(_){}
  let inString=false,escaped=false,fixed='';
  for(const c of input){
   if(escaped){fixed+=c;escaped=false;continue;}
   if(inString&&c==='\\'){fixed+=c;escaped=true;continue;}
   if(c==='"'){inString=!inString;fixed+=c;continue;}
   fixed+=inString&&(c==='\n'||c==='\r')?' ':c;
  }
  try{return JSON.parse(fixed);}catch(_){}
 }
 throw Error('Geminiの回答をJSONとして解釈できませんでした。');
}

const round=n=>Math.round(n*10)/10;
export default async function handler(req,res){
 const origin=String(req.headers.origin||'');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Vary','Origin');
 if(allowedOrigins().includes(origin)){
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','content-type, x-peakstamp-access');
  res.setHeader('Access-Control-Max-Age','300');
 }
 if(origin&&!allowedOrigins().includes(origin))return reply(res,403,'このサイトからのアクセスは許可されません。');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(req.method!=='POST')return reply(res,405,'POSTのみ対応します。');

 const key=process.env.GEMINI_API_KEY,access=process.env.PEAKSTAMP_ACCESS_CODE;
 if(!key||!access)return reply(res,503,'Gemini APIのサーバー設定が未完了です。');
 if(!equalSecret(req.headers['x-peakstamp-access'],access))return reply(res,401,'アクセスコードが違います。');
 if(req.body?.probe===true){
  let probe;
  try{
   probe=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+MODEL,{
    method:'GET',headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(15000)
   });
  }catch(_){return reply(res,504,'Googleのモデル情報を確認できませんでした。');}
  if(!probe.ok)return reply(res,502,await googleError(probe));
  return res.status(200).json({ok:true,ready:true,service:'PeakStamp Gemini audio',
    model:MODEL,googleKeyVerified:true,modelAvailable:true,
    note:'Model metadata verified; audio requests have not been tested.'});
 }

 const body=req.body;
 if(!body||typeof body!=='object'||Array.isArray(body))return reply(res,400,'JSONリクエストを送ってください。');
 const seconds=Number(body.durationSeconds);
 const base64=body.audioBase64;
 if(!Number.isFinite(seconds)||seconds<1||seconds>MAX_DURATION_SECONDS)
  return reply(res,400,'音声の長さは1秒以上10分以下で指定してください。');
 if(typeof base64!=='string'||base64.length<128||base64.length>Math.ceil(MAX_BYTES/3)*4||
    base64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
  return reply(res,413,'音声形式または容量が不正です。2.9MB以下のM4Aにしてください。');
 const audio=Buffer.from(base64,'base64');
 if(audio.length<96||audio.length>MAX_BYTES)return reply(res,413,'音声は2.9MB以下にしてください。');
 // For an MP4/M4A container, the file type box follows the first 4 bytes.
 if(audio.toString('ascii',4,8)!=='ftyp')
  return reply(res,400,'抽出した音声が正常なM4Aコンテナではありません。音声を再抽出してください。');

 const result=await requestGemini(base64,seconds,key);
 if(result.error)return reply(res,result.code,result.error);
 const google=result.data;
 if(result.api==='interactions'&&google.status&&google.status!=='completed')
  return reply(res,502,'Geminiの処理が完了していません（'+String(google.status).slice(0,50)+'）。');
 let answer='';
 if(result.api==='interactions'){
  const outputs=(Array.isArray(google.steps)?google.steps:[]).filter(step=>step?.type==='model_output');
  answer=outputs.flatMap(step=>Array.isArray(step.content)?step.content:[])
   .filter(item=>item?.type==='text').map(item=>item.text||'').join('\n').trim();
 }else{
  answer=(Array.isArray(google.candidates)?google.candidates:[])
   .flatMap(candidate=>Array.isArray(candidate?.content?.parts)?candidate.content.parts:[])
   .map(part=>part?.text||'').join('\n').trim();
 }
 if(!answer)return reply(res,502,'Geminiは回答テキストを返しませんでした。');
 let parsed;
 try{parsed=parseModelJson(answer);}
 catch(_){return reply(res,502,'Geminiの回答に有効なJSONがありません。解析結果の保存前に停止しました。');}
 if(!Array.isArray(parsed?.events))return reply(res,502,'Geminiの回答にevents配列がありません。');
 const validTypes=new Set(['goal_reaction','shot_reaction','save_reaction','excited_reaction','other','uncertain']);
 const clamp=n=>Math.max(0,Math.min(seconds,n));
 const events=[];
 for(const raw of parsed.events.slice(0,40)){
  const reaction=Number(raw?.reaction_time_seconds);
  if(!Number.isFinite(reaction)||reaction<0||reaction>seconds+2)continue;
  const start=raw?.suggested_clip_start_seconds==null?NaN:Number(raw.suggested_clip_start_seconds);
  const end=raw?.suggested_clip_end_seconds==null?NaN:Number(raw.suggested_clip_end_seconds);
  events.push({
   reaction_time_seconds:round(clamp(reaction)),
   type:validTypes.has(raw.type)?raw.type:'uncertain',
   confidence:['high','medium','low'].includes(raw.confidence)?raw.confidence:'low',
   audible_clue:String(raw.audible_clue||'').slice(0,400),
   quote:String(raw.quote||'').slice(0,120),
   suggested_clip_start_seconds:round(clamp(Number.isFinite(start)?Math.min(start,reaction):reaction-8)),
   suggested_clip_end_seconds:round(clamp(Number.isFinite(end)?Math.max(end,reaction):reaction+5))
  });
 }
 return res.status(200).json({
  duration_seconds:seconds,events,
  limitations:'Audio-only results are not evidence that these shots or goals occurred.',
  meta:{model:MODEL,api:result.api,usedFallback:result.fallback,
   inputTokens:result.api==='interactions'?(google?.usage?.total_input_tokens??null):
    (google?.usageMetadata?.promptTokenCount??null),
   outputTokens:result.api==='interactions'?(google?.usage?.total_output_tokens??null):
    (google?.usageMetadata?.candidatesTokenCount??null)}
 });
}
