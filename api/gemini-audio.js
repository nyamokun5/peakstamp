/**
 * PeakStamp Gemini proxy. All secrets are server-only.
 *
 * Audio is temporarily forwarded to the Google Gemini Interactions API.
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
const requestSchema={
 type:'object',
 properties:{
  duration_seconds:{type:'number'},
  events:{type:'array',items:{type:'object',properties:{
   reaction_time_seconds:{type:'number'},
   type:{type:'string',enum:['goal_reaction','shot_reaction','save_reaction','excited_reaction','other','uncertain']},
   confidence:{type:'string',enum:['high','medium','low']},
   quote:{type:'string'},
   audible_clue:{type:'string'},
   suggested_clip_start_seconds:{type:'number'},
   suggested_clip_end_seconds:{type:'number'}
  },required:['reaction_time_seconds','type','confidence','quote','audible_clue','suggested_clip_start_seconds','suggested_clip_end_seconds']}},
  limitations:{type:'string'}
 },
 required:['duration_seconds','events','limitations']
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
  'The limitations field must state that audio reactions cannot verify the video plays.'
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

 let upstream;
 try{
  upstream=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
   method:'POST',
   headers:{'Content-Type':'application/json','x-goog-api-key':key},
   body:JSON.stringify({
    model:MODEL,
    input:[{type:'text',text:prompt(seconds)},
      {type:'audio',data:base64,mime_type:'audio/m4a'}],
    response_format:{type:'text',mime_type:'application/json',schema:requestSchema},
    generation_config:{max_output_tokens:8192,thinking_level:'low'},
    store:false
   }),
   signal:AbortSignal.timeout(135000)
  });
 }catch(e){
  const timeout=e?.name==='TimeoutError';
  return reply(res,504,timeout?'Geminiの解析が時間切れになりました。':'Geminiへの接続に失敗しました。');
 }
 if(!upstream.ok)return reply(res,502,await googleError(upstream));

 let google;
 try{google=await upstream.json();}
 catch(_){return reply(res,502,'Geminiの応答JSONを読み取れませんでした。');}
 if(google.status && google.status!=='completed')
  return reply(res,502,'Geminiの処理が完了していません（'+String(google.status).slice(0,50)+'）。');
 // Interactions REST returns model_output steps, not generateContent candidates.
 const outputs=(Array.isArray(google.steps)?google.steps:[]).filter(step=>step?.type==='model_output');
 const last=outputs.at(-1);
 const answer=(Array.isArray(last?.content)?last.content:[]).filter(item=>item?.type==='text')
  .map(item=>item.text||'').join('\n').trim();
 if(!answer)return reply(res,502,'Geminiの回答が空でした。');
 let parsed;
 try{parsed=JSON.parse(answer);}
 catch(_){return reply(res,502,'GeminiからのJSONが不完全でした。もう一度お試しください。');}
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
  meta:{model:MODEL,api:'interactions',inputTokens:google?.usage?.total_input_tokens??null,
   outputTokens:google?.usage?.total_output_tokens??null}
 });
}
