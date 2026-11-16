import {goalLabelsForRange} from './highlight-goal-labels.mjs?v=history1';
import {videoId} from './youtube-session.mjs';
import {goalSourceKey} from './goal-stats.mjs';
import {sourceDisplayName} from './match-label.mjs';
// Consume the FINAL montage plan. Never recalculate candidate ranges or use cumulative offsets.
export function mirrorClips(sources,plan,urls,storage=globalThis.localStorage){
 if(plan.length>1000)throw Error('共有できる場面は1000件までです。');
 if(!plan.length)throw Error('先にハイライトをキープしてください。');
 return plan.map(clip=>{
  const source=sources.find(s=>s.id===clip.sourceId),id=source&&videoId(urls[goalSourceKey(source)]||'');
  if(!id)throw Error((source?sourceDisplayName(source):'動画')+' のYouTube URLを入力してください。');
  if(!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||clip.start<0||clip.end-clip.start<.29||clip.end>source.duration)throw Error('切り取り範囲を確認してください。');
  return {video:id,match:sourceDisplayName(source).slice(0,512),start:clip.start,end:clip.end,...goalLabelsForRange(source,clip.start,clip.end,storage)};
 });
}
export async function mirrorDigest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('')}
export async function publishMirror({clips,access,record,save,endpoint,fetchImpl=fetch,requireContract=false}){
 const signature=await mirrorDigest(JSON.stringify(clips));let job=record.jobs[signature];
 if(!job){
  if(!access)throw Error('解析で使用したアクセスコードを入力してください。');
  if(requireContract){const r=await fetchImpl(endpoint+'?capabilities=1',{signal:AbortSignal.timeout(20000)});let data;try{data=await r.json()}catch{}if(!r.ok||data?.contract!=='short-share-v2'||data.environment!=='PRODUCTION')throw Error('共有機能の準備を確認できませんでした。保存は開始していません。');}
  const editKey=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
  job={editKey,id:await mirrorDigest(editKey),status:'pending'};record.jobs[signature]=job;save();
  try{
   const r=await fetchImpl(endpoint,{method:'POST',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json','X-Edit-Key':editKey,'X-PeakStamp-Access':access},body:JSON.stringify({clips})});
   if(!r.ok){let data;try{data=await r.json()}catch{}if([400,401,403,413,415,429].includes(r.status)||data?.write_state==='not_started'){delete record.jobs[signature];save();throw Error(typeof data?.error==='string'?data.error:'作成できませんでした。アクセスコードとURLを確認してください。')}
    throw Error('作成結果が不明です。「結果を確認」で確認してください。');}
   const body=await r.json();if(body.id!==job.id)throw Error('共有リンクの応答を確認できません。「結果を確認」を押してください。');
   job.status='published';save();return job;
  }catch(e){if(!record.jobs[signature])throw e;throw Error('作成結果が不明です。同じデータは再送せず「結果を確認」を押してください。');}
 }
 if(job.status==='published')return job;
 const r=await fetchImpl(endpoint+'?id='+job.id,{signal:AbortSignal.timeout(20000)});
 if(r.ok){const body=await r.json();const fields=['video','match','start','end','label','scorer','assist'];
  if(Array.isArray(body.clips)&&body.clips.length===clips.length&&clips.every((c,i)=>fields.every(k=>c[k]===body.clips[i][k])&&JSON.stringify(c.participants||[])===JSON.stringify(body.clips[i].participants||[]))){job.status='published';save();return job;}}
 throw Error('作成済みか確認できません。共有リンクを確認してください。同じデータは再送しません。');
}
