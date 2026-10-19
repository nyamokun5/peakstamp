/** Extract audio only from a local video file. No upload and no API key. */
const MEDIABUNNY_URL='https://cdn.jsdelivr.net/npm/mediabunny@1.61.3/dist/bundles/mediabunny.min.mjs';
export const CLOUD_AUDIO_EXTRACTION_VERSION='audio-export-1';
export function suggestedAudioName(file){
 const base=String(file?.name||'match').replace(/\.[^.]+$/,'').replace(/[^A-Za-z0-9_-]+/g,'-').slice(0,55);
 return 'PeakStamp-'+(base||'match')+'-audio.m4a';
}
export function formatFileSize(bytes){
 return bytes>=1024*1024?(bytes/(1024*1024)).toFixed(2)+' MB':(bytes/1024).toFixed(0)+' KB';
}
export async function extractAudioOnly(file,{mode='fast',onProgress=()=>{},isCancelled=()=>false}={}){
 if(!(file instanceof Blob)||file.size===0)throw Error('動画ファイルを選択してください。');
 if(isCancelled())throw Error('音声抽出をキャンセルしました。');
 const start=performance.now();
 const {Input,BlobSource,ALL_FORMATS,Output,BufferTarget,Mp4OutputFormat,Conversion,Quality}=await import(MEDIABUNNY_URL);
 const input=new Input({formats:ALL_FORMATS,source:new BlobSource(file,{maxCacheSize:4*1024*1024})});
 try{
  const audio=await input.getPrimaryAudioTrack();
  if(!audio)throw Error('選択した動画に音声トラックがありません。');
  const output=new Output({format:new Mp4OutputFormat(),target:new BufferTarget()});
  const options={input,output,tracks:'primary',video:{discard:true},audio:mode==='small'
    ?{codec:'aac',numberOfChannels:1,sampleRate:24000,quality:new Quality({bitrate:48000}),forceTranscode:true}
    :{codec:'aac'}};
  const conversion=await Conversion.init(options);
  if(!conversion.isValid)throw Error('この動画の音声形式はM4Aへの変換に対応していません。軽量モードもお試しください。');
  conversion.onProgress=value=>{if(isCancelled())return;onProgress(Math.round(Math.max(0,Math.min(1,value))*100));};
  if(isCancelled())throw Error('音声抽出をキャンセルしました。');
  await conversion.execute();
  if(isCancelled())throw Error('音声抽出をキャンセルしました。');
  const buffer=output.target.buffer;
  if(!buffer||buffer.byteLength<128)throw Error('音声データの出力が空でした。');
  const blob=new Blob([buffer],{type:'audio/mp4'});
  return {blob,file:new File([blob],suggestedAudioName(file),{type:'audio/mp4'}),
   bytes:blob.size,elapsedSeconds:+((performance.now()-start)/1000).toFixed(1),
   sourceBytes:file.size,compressionRatio:+(file.size/blob.size).toFixed(1),
   mode,warning:blob.size>18*1024*1024?'Google AI Studioのアップロード制限にご注意ください。':''};
 }finally{input.dispose();}
}
