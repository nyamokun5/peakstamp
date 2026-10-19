/** PeakStamp Gemini proxy. Disabled unless both server-side secrets are set. */
import { timingSafeEqual } from 'node:crypto';

const MAX_BYTES=2900000;
const MODEL='gemini-2.5-flash';
const SAFE_ORIGIN='https://nyamokun5.github.io';
const allowedOrigins=()=>[SAFE_ORIGIN,...String(process.env.PEAKSTAMP_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)];
const send=(res,status,message)=>res.status(status).json({error:message});
const safeEqual=(a,b)=>{
 if(typeof a!=='string'||!b)return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
};
function prompt(duration){
 return [
  'Analyze this ENTIRE audio-only recording of an amateur Japanese/English soccer/futsal match.',
  'Recording duration: '+Math.round(duration)+' seconds. There is NO VIDEO.',
  'Find up to 24 distinct moments suggesting goals, shots, near misses, goalkeeper saves, or notable play.',
  'Listen for Japanese remarks including 惜しい、ナイシュー、ナイスキー、ゴール、打て and relevant English remarks.',
  'Focus on spoken CONTEXT before/after reactions, not only volume. Ignore ordinary chatter.',
  'Do not hallucinate words, events, or exact timestamps; uncertain events must say uncertain.',
  'Use reaction onset as time, not kick time. If reactions refer to the SAME play, consolidate into ONE event.',
  'For each event, output reaction_time_seconds, type, confidence, audible_clue, quote, suggested_clip_start_seconds (8 seconds before reaction), suggested_clip_end_seconds (5 seconds after).',
  'Types: goal_reaction,shot_reaction,save_reaction,excited_reaction,other,uncertain. Confidence: high,medium,low.',
  'Quote only clearly audible phrases, otherwise empty string. Clip boundaries within recording duration.',
  'Only return a JSON object like {"duration_seconds":'+Math.round(duration)+',"events":[{"reaction_time_seconds":125.3,"type":"shot_reaction","confidence":"medium","audible_clue":"possible near miss","quote":"惜しい","suggested_clip_start_seconds":117.3,"suggested_clip_end_seconds":130.3}],"limitations":"Audio only; not proof of shots/goals."}.',
  'The event at 125.3 seconds is a FICTIONAL EXAMPLE; never copy it unless independently heard.'
 ].join('\n');
}
export default async function handler(req,res){
 const origin=String(req.headers.origin||'');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Vary','Origin');
 if(origin&&allowedOrigins().includes(origin)){
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','content-type, x-peakstamp-access');
 }
 if(origin&&!allowedOrigins().includes(origin))return send(res,403,'このサイトからのアクセスは許可されません。');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(req.method!=='POST')return send(res,405,'POSTのみ対応します。');
 const key=process.env.GEMINI_API_KEY,access=process.env.PEAKSTAMP_ACCESS_CODE;
 if(!key||!access)return send(res,503,'APIサーバーの設定が未完了です。管理者にお問い合わせください。');
 if(!safeEqual(req.headers['x-peakstamp-access'],access))return send(res,401,'アクセスコードが違います。');
 // Authenticated, zero-cost readiness probe. Never forwards data to Gemini.
 // Verifies endpoint, access code and presence of env secrets, not Google key validity.
 if(req.body?.probe===true)
  return res.status(200).json({ok:true,service:'PeakStamp Gemini audio',ready:true,googleKeyVerified:false});
 const body=req.body;
 if(!body||typeof body!=='object'||Array.isArray(body))return send(res,400,'JSONリクエストを送ってください。');
 const seconds=Number(body.durationSeconds),base64=body.audioBase64;
 if(!Number.isFinite(seconds)||seconds<1||seconds>600)
  return send(res,400,'音声の長さは1秒以上10分以下で指定してください。');
 if(typeof base64!=='string'||base64.length>Math.ceil(MAX_BYTES/3)*4||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
  return send(res,413,'音声容量が大きすぎます。軽量モードで音声を抽出してください。');
 const raw=Buffer.from(base64,'base64');
 if(!raw.length||raw.length>MAX_BYTES)return send(res,413,'音声の上限は2.9MBです。');
 let upstream;
 try{
  upstream=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+MODEL+':generateContent',{
   method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
   body:JSON.stringify({
    contents:[{role:'user',parts:[{text:prompt(seconds)},{inline_data:{mime_type:'audio/mp4',data:base64}}]}],
    generationConfig:{responseMimeType:'application/json',temperature:0.15,maxOutputTokens:4096}
   }),signal:AbortSignal.timeout(120000)
  });
 }catch(e){return send(res,504,'Geminiに接続できませんでした。時間を置いて再試行してください。');}
 if(!upstream.ok){
  if(upstream.status===429)return send(res,429,'Geminiの利用上限に達しました。');
  if(upstream.status===401||upstream.status===403)return send(res,502,'Gemini APIの認証・請求設定を確認してください。');
  return send(res,502,'Gemini APIがエラーを返しました (HTTP '+upstream.status+')。');
 }
 let google;
 try{google=await upstream.json();}catch(_){return send(res,502,'Geminiの応答がJSONではありません。');}
 const text=(google?.candidates||[]).flatMap(c=>c?.content?.parts||[]).map(p=>p?.text||'').join('\n').trim();
 if(!text)return send(res,502,'Geminiから回答が返りませんでした。');
 let data;
 try{data=JSON.parse(text);}
 catch(_){return send(res,502,'Geminiの回答が不完全です。もう一度試してください。');}
 if(!Array.isArray(data?.events))return send(res,502,'Geminiの回答にevents配列がありません。');
 const TYPES=new Set(['goal_reaction','shot_reaction','save_reaction','excited_reaction','other','uncertain']);
 const clamp=x=>Math.min(seconds,Math.max(0,x));
 const events=data.events.slice(0,40).flatMap(e=>{
  const time=Number(e?.reaction_time_seconds);
  if(!Number.isFinite(time)||time<0||time>seconds+2)return [];
  const n=x=>Math.round(x*10)/10;
  const start=Number(e?.suggested_clip_start_seconds),end=Number(e?.suggested_clip_end_seconds);
  return [{
   reaction_time_seconds:n(time),
   type:TYPES.has(e.type)?e.type:'uncertain',
   confidence:['high','medium','low'].includes(e.confidence)?e.confidence:'low',
   audible_clue:String(e.audible_clue||'').slice(0,400),
   quote:String(e.quote||'').slice(0,120),
   suggested_clip_start_seconds:n(clamp(Number.isFinite(start)?Math.min(start,time):time-8)),
   suggested_clip_end_seconds:n(clamp(Number.isFinite(end)?Math.max(end,time):time+5))
  }];
 });
 return res.status(200).json({
  duration_seconds:seconds,events,limitations:'Audio only; not proof of shots/goals.',
  meta:{model:MODEL,inputTokens:google?.usageMetadata?.promptTokenCount??null,
    outputTokens:google?.usageMetadata?.candidatesTokenCount??null}
 });
}
