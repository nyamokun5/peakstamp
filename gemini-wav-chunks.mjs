/**
 * Locally decode PeakStamp's temporary M4A and produce small PCM WAV segments.
 * No original video bytes are sent. Output: 16 kHz, mono, signed 16-bit PCM.
 *
 * Each <=70s chunk is <=2.25MB, under the Vercel 4.5MB JSON-body ceiling
 * after base64. 5s overlaps help preserve speech near cut boundaries.
 */
export const WAV_SAMPLE_RATE=16000;
export const WAV_CHUNK_SECONDS=70;
export const WAV_OVERLAP_SECONDS=5;
// Per-file AI duration; 70s WAV chunks keep each request below the API body limit.
export const MAX_GEMINI_DURATION_SECONDS=1800;
export const WAV_SEGMENT_VERSION='pcm16-wav-direct-source-70s-5s-goalassist-v3';
export function wavSegmentRanges(duration,{length=WAV_CHUNK_SECONDS,overlap=WAV_OVERLAP_SECONDS}={}){
 const total=Number(duration);
 if(!Number.isFinite(total)||total<=0||total>MAX_GEMINI_DURATION_SECONDS)
  throw Error('Gemini音声解析は動画1本あたり30分以下に対応します。');
 if(!(length>1)||!(overlap>=0)||overlap>=length)throw Error('音声区間の設定が不正です。');
 const ranges=[];
 for(let start=0;start<total;start+=length-overlap){
  const end=Math.min(total,start+length);
  if(end-start<0.08)break;
  ranges.push({startSeconds:+start.toFixed(2),endSeconds:+end.toFixed(2),
   durationSeconds:+(end-start).toFixed(2)});
  if(end>=total-0.001)break;
 }
 return ranges;
}
function waveFromAudioBuffer(audioBuffer,startSeconds,endSeconds){
 const rate=Number(audioBuffer.sampleRate);
 if(!(rate>=8000&&rate<=192000))throw Error('音声サンプルレートが不正です。');
 const nChannels=Math.min(2,audioBuffer.numberOfChannels);
 if(nChannels<1)throw Error('音声にチャンネルがありません。');
 const channels=Array.from({length:nChannels},(_,i)=>audioBuffer.getChannelData(i));
 const outputSamples=Math.round((endSeconds-startSeconds)*WAV_SAMPLE_RATE);
 if(outputSamples<1||outputSamples>WAV_SAMPLE_RATE*WAV_CHUNK_SECONDS+1)
  throw Error('音声チャンクが長すぎます。');
 const buffer=new ArrayBuffer(44+outputSamples*2);
 const view=new DataView(buffer);
 const write=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
 write(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);
 write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);
 view.setUint16(20,1,true);view.setUint16(22,1,true);
 view.setUint32(24,WAV_SAMPLE_RATE,true);
 view.setUint32(28,WAV_SAMPLE_RATE*2,true);
 view.setUint16(32,2,true);view.setUint16(34,16,true);
 write(36,'data');view.setUint32(40,outputSamples*2,true);
 const ratio=rate/WAV_SAMPLE_RATE,base=startSeconds*rate;
 const srcLength=channels[0].length;
 for(let i=0;i<outputSamples;i++){
  // Short box-window averaging reduces aliasing when downsampling speech.
  const lo=Math.max(0,Math.min(srcLength-1,Math.floor(base+i*ratio)));
  const hi=Math.max(lo+1,Math.min(srcLength,Math.ceil(base+(i+1)*ratio)));
  let acc=0;
  for(let j=lo;j<hi;j++){
   let mix=0;
   for(let c=0;c<channels.length;c++)mix+=channels[c][j]/channels.length;
   acc+=mix;
  }
  const v=Math.max(-1,Math.min(1,acc/(hi-lo)));
  view.setInt16(44+2*i,Math.max(-32768,Math.min(32767,Math.round(v*32767))),true);
 }
 return new Blob([buffer],{type:'audio/wav'});
}
export async function openWavSegmenter(m4a,{isCancelled=()=>false}={}){
 if(!(m4a instanceof Blob)||m4a.size<128)throw Error('変換するM4A音声がありません。');
 if(isCancelled())throw Error('処理を中止しました。');
 const AudioCtx=window.AudioContext||window.webkitAudioContext;
 if(!AudioCtx)throw Error('このSafariはWAV変換に対応していません。');
 const audioContext=new AudioCtx();
 let decoded;
 try{
  const raw=await m4a.arrayBuffer();
  if(isCancelled())throw Error('WAV変換を中止しました。');
  decoded=await audioContext.decodeAudioData(raw);
  if(isCancelled())throw Error('WAV変換を中止しました。');
  if(!decoded||!(decoded.duration>0))throw Error('M4Aの音声デコードに失敗しました。');
 }catch(error){
  await audioContext.close().catch(()=>{});
  throw Error('iPhone内のM4AをWAVに変換できませんでした：'+(error?.message||String(error)));
 }
 const ranges=wavSegmentRanges(decoded.duration);
 let closed=false;
 return {
  durationSeconds:decoded.duration,
  ranges,
  makeSegment(range){
   if(closed||isCancelled())throw Error('WAV変換を中止しました。');
   const blob=waveFromAudioBuffer(decoded,range.startSeconds,range.endSeconds);
   if(blob.size>2_900_000)throw Error('WAV区間がAPIの容量上限を超えました。');
   return {blob,bytes:blob.size,startSeconds:range.startSeconds,
    endSeconds:range.endSeconds,durationSeconds:range.durationSeconds};
  },
  async close(){closed=true;decoded=null;await audioContext.close().catch(()=>{});}
 };
}
export function mergeWavSegmentEvents(responses,duration){
 const fullLength=Number(duration);
 const combined=[];
 for(const response of responses||[]){
  const start=Number(response?.startSeconds);
  if(!Number.isFinite(start)||start<0||!Array.isArray(response?.events))continue;
  for(const raw of response.events){
   const time=Number(raw?.reaction_time_seconds);
   if(!Number.isFinite(time)||time<0)continue;
   const absolute=start+time;
   if(absolute>fullLength+2)continue;
   const startClip=raw?.suggested_clip_start_seconds==null?time-8:Number(raw.suggested_clip_start_seconds);
   const endClip=raw?.suggested_clip_end_seconds==null?time+5:Number(raw.suggested_clip_end_seconds);
   const clipStart=Math.max(0,Math.min(fullLength,start+(Number.isFinite(startClip)?startClip:time-8)));
   const clipEnd=Math.max(0,Math.min(fullLength,start+(Number.isFinite(endClip)?endClip:time+5)));
   combined.push({...raw,reaction_time_seconds:+absolute.toFixed(1),
    suggested_clip_start_seconds:+clipStart.toFixed(1),
    suggested_clip_end_seconds:+clipEnd.toFixed(1)});
  }
 }
 combined.sort((a,b)=>a.reaction_time_seconds-b.reaction_time_seconds);
 const merged=[];
 const conf={high:3,medium:2,low:1};
 for(const ev of combined){
  const last=merged.at(-1);
  if(last && Math.abs(last.reaction_time_seconds-ev.reaction_time_seconds)<3 &&
     (last.type===ev.type || (last.quote&&ev.quote&&last.quote===ev.quote))){
   const better=(conf[ev.confidence]||0)>(conf[last.confidence]||0);
   if(better){
    merged[merged.length-1]={...ev,
      suggested_clip_start_seconds:Math.min(last.suggested_clip_start_seconds,ev.suggested_clip_start_seconds),
      suggested_clip_end_seconds:Math.max(last.suggested_clip_end_seconds,ev.suggested_clip_end_seconds)};
   }else{
    last.suggested_clip_start_seconds=Math.min(last.suggested_clip_start_seconds,ev.suggested_clip_start_seconds);
    last.suggested_clip_end_seconds=Math.max(last.suggested_clip_end_seconds,ev.suggested_clip_end_seconds);
   }
  }else merged.push(ev);
 }
 // The SAME Gemini response carries spoken goal/assist calls independently.
 const speech=[];
 for(const segment of responses||[]){
  const start=Number(segment?.startSeconds);
  if(!Number.isFinite(start)||start<0)continue;
  for(const utterance of Array.isArray(segment.utterances)?segment.utterances:[]){
   const local=Number(utterance?.time_seconds);
   if(utterance?.time_seconds==null||!Number.isFinite(local)||local<0)continue;
   const abs=start+local;
   if(abs>fullLength+2||!['goal_call','match_start'].includes(utterance.kind))continue;
   speech.push({...utterance,time_seconds:+Math.min(fullLength,abs).toFixed(1),
    _segmentStart:start});
  }
 }
 speech.sort((a,b)=>a.time_seconds-b.time_seconds);
 const joined=[];
 const confRank={high:3,medium:2,low:1};
 for(const entry of speech){
  const prev=[...joined].reverse().find(old=>{
   const gap=entry.time_seconds-old.time_seconds;
   if(gap>4||entry.kind!==old.kind)return false;
   if(old.kind==='match_start')
    return gap<=2&&(old.quote===entry.quote||old._segmentStart!==entry._segmentStart);
   const differs=(k)=>old[k]&&entry[k]&&
    String(old[k]).trim().toLowerCase()!==String(entry[k]).trim().toLowerCase();
   if(differs('scorer')||differs('assist'))return false;
   return old.quote===entry.quote||
     (old._segmentStart!==entry._segmentStart&&gap<=4);
  });
  if(!prev){joined.push(entry);continue;}
  for(const key of ['scorer','assist','match_label','team_a','team_b'])
   if(!prev[key]&&entry[key])prev[key]=entry[key];
  if((confRank[entry.confidence]||0)>(confRank[prev.confidence]||0))
   prev.confidence=entry.confidence;
  if(entry.quote&&!String(prev.quote||'').includes(entry.quote))
   prev.quote=String(prev.quote||'')+' / '+entry.quote;
 }
 const utterances=joined.map(({_segmentStart,...u})=>u);
 const unifiedGoalCalls=(responses||[]).length>0&&
  (responses||[]).every(segment=>segment?.unifiedGoalCalls===true||segment?.meta?.unifiedGoalCalls===true);
 return {duration_seconds:fullLength,events:merged,utterances,
  limitations:'Audio-only; spoken calls and goal reactions require video verification.',
  meta:{model:'gemini-3.8-flash',api:'generateContent-wav',
   segments:(responses||[]).length,unifiedGoalCalls,
   goalCallCount:utterances.filter(x=>x.kind==='goal_call').length}};
}
