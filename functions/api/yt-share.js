import {validId} from '../../youtube-session.mjs';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const idPattern=/^[0-9a-f]{64}$/;
export async function onRequestGet({request,env}){
 const id=new URL(request.url).searchParams.get('id');
 if(!idPattern.test(id||''))return reply({error:'リンクが正しくありません。'},400);
 const data=await env.HIGHLIGHTS.get(id,'json');
 return data?reply(data):reply({error:'共有データが見つかりません。発行直後は少し待ってください。'},404);
}
export async function onRequestPost({request,env}){
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply({error:'Invalid origin'},403);
 const secret=request.headers.get('X-Edit-Key')||'';
 if(!idPattern.test(secret))return reply({error:'編集キーが必要です。'},400);
 const raw=await request.text();
 if(raw.length>500000)return reply({error:'共有データが大きすぎます。'},413);
 let clips;
 try{clips=JSON.parse(raw).clips}catch{return reply({error:'Invalid JSON'},400)}
 if(!Array.isArray(clips)||!clips.length)return reply({error:'採用した場面がありません。'},400);
 const clean=[];
 for(const c of clips){
  if(!c||!validId(c.video)||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end-c.start<0.29||
   !['match','label','scorer','assist'].every(k=>typeof c[k]==='string'&&c[k].length<=512))return reply({error:'公開データの形式が正しくありません。'},400);
  clean.push({video:c.video,match:c.match,start:c.start,end:c.end,label:c.label,scorer:c.scorer,assist:c.assist});
 }
 const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret))),x=>x.toString(16).padStart(2,'0')).join('');
 const check=await fetch('https://peakstamp-gemini-api.vercel.app/api/gemini-audio',{method:'POST',headers:{'Content-Type':'application/json','X-PeakStamp-Access':request.headers.get('X-PeakStamp-Access')||''},body:'{"probe":true}'});
 if(!check.ok||(await check.json()).ready!==true)return reply({error:'PSアクセスコードを確認してください。'},403);
 await env.HIGHLIGHTS.put(id,JSON.stringify({version:1,clips:clean}));
 return reply({id});
}
