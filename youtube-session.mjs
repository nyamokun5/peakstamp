export const sampleIds=['-sEOeqqTyuw','ey1_5PaMvBo','9zA4YCs8Ass','Ngp_ilKW91E'];
export const validId=id=>typeof id==='string'&&/^[\w-]{11}$/.test(id);
export function videoId(input){
 try {
  const u=new URL(input);
  if(!['http:','https:'].includes(u.protocol))return null;
  const host=u.hostname.toLowerCase().replace(/^(www\.|m\.)/,'');
  let id;
  if(host==='youtu.be')id=u.pathname.slice(1);
  if(host==='youtube.com')id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)$/)?.[1];
  return validId(id)?id:null;
 }catch{return null}
}
export function matchInfo(title){
 const t=title.normalize('NFKC');
 const date=t.match(/\b(20\d\d)[年./ -]?(\d{2})[月./ -]?(\d{2})日?/);
 const teams=t.match(/(?:チーム|team|T)\s*(\d+)\s*(?:vs\.?|対|[-–×])\s*(?:チーム|team|T)?\s*(\d+)/i);
 const round=t.match(/3位決定戦|3決|準決勝|決勝|第\s*\d+\s*試合/);
 return {date:date?date.slice(1,4).join('-'):'',teamA:teams?'チーム'+teams[1]:'',teamB:teams?'チーム'+teams[2]:'',round:round?.[0]?.replace(/^3決$/,'3位決定戦')||'',drone:/drone|ドローン/i.test(t)};
}
export function matchName(s){
 return [s.info.date,s.info.round,[s.info.teamA,s.info.teamB].filter(Boolean).join(' vs ')].filter(Boolean).join('　')||s.title||s.id;
}
export function selected(sources){
 return sources.filter(s=>!s.info.drone).flatMap(s=>s.candidates.filter(c=>c.enabled===true&&!c.rejected)
  .sort((a,b)=>a.time-b.time).map(c=>{
   const goal=c.goal?.status==='confirmed'?c.goal:null;
   return {video:s.id,match:matchName(s),start:c.time,end:c.manualEnd,label:goal?'⚽ ゴール':c.title,
    scorer:goal?.scorer||'',assist:goal?.assistStatus==='named'?goal.assist:''};
  }));
}
export function forMember(clips,name){
 return name?clips.filter(c=>c.scorer===name||c.assist===name):clips;
}
export function seconds(value){
 if(typeof value==='number')return value;
 if(typeof value!=='string')return NaN;
 const t=value.trim();
 if(/^\d+(?:\.\d+)?$/.test(t))return Number(t);
 if(/^\d+:[0-5]\d(?:\.\d+)?$/.test(t)){
  const [minutes,secs]=t.split(':');return Number(minutes)*60+Number(secs);
 }
 return NaN;
}
export function shortRange(start,end,peak){
 if(end-start<=12)return {start,end};
 return {start:Math.max(start,peak-8),end:Math.min(end,peak+4)};
}
export function analysisResult(result,source,report={}){
 if(result?.status!=='ok'||!Array.isArray(result.scenes))throw Error('動画の解析結果を確認できませんでした。');
 const seen=new Set();
 report.invalid=0;
 const candidates=result.scenes.flatMap((raw,i)=>{
  const x={...raw,start:seconds(raw?.start),end:seconds(raw?.end),peak:seconds(raw?.peak)};
  if(x.start>=-1)x.start=Math.max(0,x.start);
  if(x.end<=source.duration+2)x.end=Math.min(source.duration,x.end);
  if(![x.start,x.end,x.peak].every(Number.isFinite)||x.start<0||x.end-x.start<0.3||x.peak<x.start||x.peak>x.end||x.end>source.duration+0.1)
   {report.invalid++;return []}
  const range=shortRange(x.start,x.end,x.peak);
  return {id:source.id+'-'+i,sourceId:source.id,time:range.start,manualEnd:range.end,peakSeconds:x.peak,
   origin:'gemini',enabled:false,rejected:false,title:String(x.label||'好プレー'),geminiQuote:String(x.quote||''),
   goalHint:x.goal===true,scorerHint:String(x.scorer||''),assistHint:String(x.assist||'')};
 }).filter(c=>{const key=[c.time,c.manualEnd,c.peakSeconds].join('/');if(seen.has(key))return false;seen.add(key);return true;});
 if(report.invalid&&!candidates.length)throw Error('候補'+report.invalid+'件すべての時刻が不正でした。この試合を再解析してください。');
 return candidates;
}
