/**
 * Decode the ORIGINAL local MOV/MP4 track to bounded 16 kHz PCM WAV segments.
 * Avoids encoding a temporary mono AAC/M4A and Safari's decodeAudioData path.
 * The video is never uploaded; only each small WAV segment leaves the device.
 */
import { WAV_SAMPLE_RATE, wavSegmentRanges } from './gemini-wav-chunks.mjs?v=unifiedga2';

const MEDIABUNNY_URL='https://cdn.jsdelivr.net/npm/mediabunny@1.61.3/dist/bundles/mediabunny.min.mjs';
const MAX_WAV_BYTES=2_900_000;

/** Exported for unit testing without browser codecs. Each sample is closed here. */
export async function encodeWavSegment(samples, range, {isCancelled=()=>false}={}) {
  const start=Number(range.startSeconds),end=Number(range.endSeconds);
  const frames=Math.round((end-start)*WAV_SAMPLE_RATE);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||!(end>start)||frames<1||frames>WAV_SAMPLE_RATE*70+1)
    throw Error('WAV区間の長さが不正です。');
  const sums=new Float32Array(frames);
  const counts=new Uint16Array(frames);
  let populated=0;
  for await(const sample of samples){
    try{
      if(isCancelled())throw Error('WAV変換を中止しました。');
      const rate=sample.sampleRate,channels=sample.numberOfChannels;
      if(!(rate>=8000&&rate<=192000)||!(channels>=1&&channels<=32))throw Error('音声トラックの形式が不正です。');
      const options={planeIndex:0,format:'f32'};
      const raw=new Float32Array(sample.allocationSize(options)/4);
      sample.copyTo(raw,options);
      const first=Math.max(0,Math.ceil((start-sample.timestamp)*rate-1e-6));
      const last=Math.min(sample.numberOfFrames,Math.ceil((end-sample.timestamp)*rate-1e-6));
      for(let frame=first;frame<last;frame++){
        const target=Math.floor((sample.timestamp+frame/rate-start)*WAV_SAMPLE_RATE+1e-5);
        if(target<0||target>=frames)continue;
        let mono=0;
        for(let channel=0;channel<channels;channel++)mono+=raw[frame*channels+channel]||0;
        sums[target]+=mono/channels;
        counts[target]++;
        populated++;
      }
    }finally{sample.close();}
  }
  if(isCancelled())throw Error('WAV変換を中止しました。');
  if(!populated)throw Error('この区間の音声をデコードできませんでした。元動画の音声形式をご確認ください。');
  // Interpolate unpopulated samples on low sample-rate inputs (e.g. 8 kHz).
  let previous=-1,previousValue=0;
  for(let i=0;i<frames;i++){
    if(!counts[i])continue;
    const value=sums[i]/counts[i];
    if(previous>=0&&i>previous+1){
      for(let j=previous+1;j<i;j++)sums[j]=previousValue+(value-previousValue)*(j-previous)/(i-previous);
    }
    previous=i;
    previousValue=value;
    sums[i]=value;
  }
  const bytes=44+frames*2;
  if(bytes>MAX_WAV_BYTES)throw Error('WAV区間がAPIの容量上限を超えました。');
  const buffer=new ArrayBuffer(bytes),view=new DataView(buffer);
  const write=(offset,str)=>{for(let i=0;i<str.length;i++)view.setUint8(offset+i,str.charCodeAt(i));};
  write(0,'RIFF');view.setUint32(4,bytes-8,true);
  write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,WAV_SAMPLE_RATE,true);view.setUint32(28,WAV_SAMPLE_RATE*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);
  write(36,'data');view.setUint32(40,frames*2,true);
  for(let i=0;i<frames;i++){
    const v=sums[i];
    view.setInt16(44+i*2,Math.max(-32768,Math.min(32767,Math.round(Math.max(-1,Math.min(1,v))*32767))),true);
  }
  return {blob:new Blob([buffer],{type:'audio/wav'}),bytes,startSeconds:start,
    endSeconds:end,durationSeconds:Number(range.durationSeconds)||end-start};
}

/** Lazily decode one <=70 second region at a time, releasing every audio frame. */
export async function openVideoWavSegmenter(video,{isCancelled=()=>false,
  loadDecoder=()=>import(MEDIABUNNY_URL)}={}){
  if(!(video instanceof Blob)||!video.size)throw Error('元動画が選択されていません。');
  if(isCancelled())throw Error('WAV変換を中止しました。');
  const {Input,BlobSource,ALL_FORMATS,AudioSampleSink}=await loadDecoder();
  const input=new Input({formats:ALL_FORMATS,
    source:new BlobSource(video,{maxCacheSize:4*1024*1024})});
  try{
    const track=await input.getPrimaryAudioTrack();
    if(!track)throw Error('元動画に音声トラックがありません。');
    if(!await track.canDecode())throw Error('元動画の音声コーデックにiPhoneのSafariが対応していません。');
    const durationSeconds=await input.computeDuration();
    const ranges=wavSegmentRanges(durationSeconds);
    const sink=new AudioSampleSink(track);
    let closed=false;
    return {durationSeconds,ranges,
      async makeSegment(range){
        if(closed||isCancelled())throw Error('WAV変換を中止しました。');
        return encodeWavSegment(sink.samples(Math.max(0,range.startSeconds-1),range.endSeconds),range,{isCancelled});
      },
      async close(){if(closed)return;closed=true;input.dispose();}
    };
  }catch(error){input.dispose();throw error;}
}
