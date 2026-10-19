/**
 * PeakStamp optional expanded discovery and AI re-review (up to 20 events).
 * Separate from normal candidate selection, editing and video export.
 * AI index is a heuristic, not a probability. Feedback provides ground truth.
 */
import { extractSnippet, snippetWindow } from './whisper-experiment.mjs?v=whisper21';
import { DEFAULT_CONTEXT, parseContextVocabulary, contextualHints, speechSegmentsByVAD } from './soccer-speech-context.mjs?v=4';
import { plausibleSpeech, rankSceneEvidence, LABELS } from './ai-review-scoring.mjs?v=5';
import { discoverScenePool, EXPLORATION_LIMIT } from './ai-candidate-discovery.mjs?v=1';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'peakstamp_ai_scene_labels_v1';
const VOCAB_KEY = 'peakstamp_soccer_vocabulary_v1';
const MODEL = 'onnx-community/whisper-base';
const MODEL_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MAX_SCENES = EXPLORATION_LIMIT;
const MAX_ASR_SCENES = 10;
const MAX_SPEECH_SEGMENTS = 1;
let recognizerPromise = null;
let running = false;
let records = [];
let snapshot = '';
let note = '';
let activeVideo = null;
let currentStatistics = null;
let speechAnalyzedCount = 0;
let vadAnalyzedCount = 0;
let feedback = {};

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) feedback = saved;
} catch (_) { feedback = {}; }

function safeTime(sec) {
  const value = Math.max(0, Math.floor(sec || 0));
  return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
}
function srcKey(source, candidate) {
  // Stable when the same iPhone file is re-selected next week or after reload.
  return [source.file.name,source.file.size,source.file.lastModified,Math.round(candidate.peakSeconds*1000)].join('::');
}
function getTopCandidates(state) {
  return discoverScenePool(state.sources,{limit:MAX_SCENES}).entries;
}
function keyOf(items) {
  return items.map(x=>[x.sourceId,x.candidateId,x.score,x.fileName].join(':')).join('|');
}
function setStatus(text) { const el=$('aiRerankStatus'); if(el)el.textContent=text; }
function btn(label,handler,css='') {
  const e=document.createElement('button');
  e.type='button';e.className=css;e.textContent=label;
  e.addEventListener('click',handler);
  return e;
}
function el(tag,text,css='') {
  const n=document.createElement(tag);
  n.textContent=text;
  if(css)n.className=css;
  return n;
}
function persistFeedback() {
  // Avoid unbounded browser storage and preserve the most recent 300 labels.
  const keys=Object.keys(feedback);
  for(const key of keys.slice(0,Math.max(0,keys.length-300)))delete feedback[key];
  try {localStorage.setItem(STORAGE_KEY,JSON.stringify(feedback));} catch (_) {}
}
function positive(value) {
  return LABELS.find(x=>x.value===value)?.positive ?? null;
}
function stopPreview() {
  if(!activeVideo)return;
  activeVideo.pause();
  activeVideo.removeAttribute('src');
  activeVideo.load();
  activeVideo=null;
}
function beginPreview(source, candidate, host) {
  stopPreview();
  const video=document.createElement('video');
  video.controls=true;video.playsInline=true;video.setAttribute('playsinline','');
  video.preload='metadata';
  video.style.cssText='display:block;width:100%;max-height:260px;margin:8px 0;border-radius:10px;background:#050e18';
  video.src=source.objectUrl;
  host.replaceChildren(video);
  activeVideo=video;
  const editedStart=Number.isFinite(candidate.time)?candidate.time:candidate.peakSeconds-7;
  const where=Math.max(0,Math.min(source.duration-0.3,Math.max(0,editedStart)));
  const seek=()=> {
    if(activeVideo!==video)return;
    try{video.currentTime=where;}catch(_){}
    video.removeEventListener('loadedmetadata',seek);
  };
  video.addEventListener('loadedmetadata',seek);
  if(video.readyState>=1)seek();
  const stopAt=Math.min(source.duration,Math.max(candidate.peakSeconds+6,where+12));
  video.addEventListener('timeupdate',()=>{
    if(video===activeVideo && video.currentTime>=stopAt-.06){
      video.pause();
      video.currentTime=where;
    }
  });
  // iOS playback stays behind a user gesture via native controls.
}
async function loadASR(update) {
  if(!recognizerPromise) {
    recognizerPromise=(async()=>{
      const {pipeline,env}=await import(MODEL_CDN);
      env.allowLocalModels=false;
      return pipeline('automatic-speech-recognition',MODEL,{
        dtype:'q8',device:'wasm',
        progress_callback:x=>{
          if(x?.status==='progress'&&Number.isFinite(x.progress))update('Whisper Base取得中：'+Math.round(x.progress)+'%');
        }
      });
    })().catch(error=>{recognizerPromise=null;throw error;});
  }
  return recognizerPromise;
}
function rms(audio) {
  let sum=0;
  for(let i=0;i<audio.length;i++)sum+=audio[i]*audio[i];
  return Math.sqrt(sum/Math.max(1,audio.length));
}
function partsNearPeak(parts, absolutePeak, windowStart, maxCount=MAX_SPEECH_SEGMENTS) {
  const localPeak=absolutePeak-windowStart;
  const prepared=[];
  for (const part of parts) {
    if(!(part.end>part.start))continue;
    // Keep about 4.5 seconds around the peak-nearest part of a long utterance.
    const duration=part.end-part.start;
    let start=part.start,end=part.end;
    if(duration>4.5) {
      start=Math.max(part.start,Math.min(localPeak-2.25,part.end-4.5));
      end=start+4.5;
    }
    const center=(start+end)/2;
    const distance=Math.abs(center-localPeak);
    prepared.push({...part,start,end,distance});
  }
  return prepared.sort((a,b)=>a.distance-b.distance).slice(0,maxCount)
    .sort((a,b)=>a.start-b.start);
}
async function scanEntry(entry, update, isStillCurrent) {
  const span=snippetWindow(entry.peakSeconds,entry.duration,10);
  update('広域候補の音声を抽出：'+entry.fileName+' '+safeTime(span.start));
  const audio=await extractSnippet(entry.source.file,span.start,span.end);
  if(!isStillCurrent())throw Error('動画の候補が変更されました。再評価をやり直してください。');
  if(audio.length<16000 || rms(audio)<.002){
    return {ai:{speechDetected:false,transcripts:[],reason:'音声が小さい／無音',window:span},clips:[]};
  }
  update('VADで発話の有無を確認中…');
  const detected=await speechSegmentsByVAD(audio,update);
  if(!isStillCurrent())throw Error('候補が変更されました。');
  if(!detected.length)return {
    ai:{speechDetected:false,transcripts:[],reason:'VADで声なし（短い歓声は見落としの可能性）',window:span},
    clips:[]
  };
  const selected=partsNearPeak(detected,entry.peakSeconds,span.start);
  const clips=selected.map(part=>{
    const left=Math.max(0,Math.floor(part.start*16000));
    const right=Math.min(audio.length,Math.ceil(part.end*16000));
    return {audio:audio.slice(left,right),when:span.start+part.start};
  }).filter(clip=>clip.audio.length>16000*.35 && rms(clip.audio)>=.002);
  return {ai:{
    speechDetected:clips.length>0,transcripts:[],
    reason:clips.length?'VAD発話候補 '+detected.length+'件（文字起こし待ち）':'VAD検出あり・有効な声が短すぎる',
    window:span
  },clips};
}
async function transcribeScanned(candidate,update,isStillCurrent) {
  const ai=candidate.ai;
  const clips=candidate._clips||[];
  if(!clips.length)return;
  update('Whisper Base準備中…');
  const recognizer=await loadASR(update);
  const results=[];
  for(let i=0;i<clips.length;i++){
    if(!isStillCurrent())throw Error('候補が変更されました。');
    update('Whisperで掛け声を判定中：'+(i+1)+'/'+clips.length);
    const result=await recognizer(clips[i].audio,{
      language:'japanese',task:'transcribe',return_timestamps:false,
      temperature:0,max_new_tokens:64
    });
    const transcript=String(result?.text||'').trim();
    results.push({
      text:transcript,seconds:clips[i].audio.length/16000,
      speechDetected:true,when:clips[i].when,
      usable:plausibleSpeech(transcript,clips[i].audio.length/16000)
    });
  }
  ai.transcripts=results;
  ai.reason='VADで発話検出・Whisper '+results.length+'区間を解析';
}
function pickASRCandidates(items,limit=MAX_ASR_SCENES) {
  const speaking=items.filter(x=>x.ai?.speechDetected===true && x._clips?.length);
  const ranked=[...speaking].sort((a,b)=>b.score-a.score||a.peakSeconds-b.peakSeconds);
  const old=ranked.filter(x=>x.discovery==='existing');
  const novel=ranked.filter(x=>x.discovery!=='existing');
  const picked=[];
  // At least 60% of ASR capacity is reserved for newly discovered clips.
  // This prevents all inference budget going to the same old top five.
  picked.push(...novel.slice(0,Math.ceil(limit*.6)));
  picked.push(...old.slice(0,Math.floor(limit*.4)));
  for(const x of ranked){
    if(picked.length>=limit)break;
    if(!picked.includes(x))picked.push(x);
  }
  return picked.slice(0,limit).sort((a,b)=>b.score-a.score);
}
function phraseInfo(item) {
  const transcripts=(item.ai?.transcripts||[]).filter(t=>t.usable).map(t=>t.text).filter(Boolean);
  if(!transcripts.length)return '掛け声の認識なし';
  return transcripts.map(t=>t.length>50?t.slice(0,50)+'…':t).join(' / ');
}
function makeCard(item, rankType) {
  const card=el('div','');
  card.style.cssText='background:#0c2033;border:1px solid #304759;border-radius:12px;padding:12px;margin:9px 0';
  const heading=el('div','');
  heading.style.cssText='font-weight:700;font-size:15px;display:flex;gap:8px;flex-wrap:wrap;align-items:center';
  heading.append(el('span',(rankType==='ai'?'AI探索':'広域音響')+' '+(rankType==='ai'?item.aiRank:item.baseRank)+'位'));
  if(item.discovery!=='existing'){
    const newTag=el('span','新規候補');
    newTag.style.cssText='font-size:11px;border:1px solid #72cbb7;color:#8de9cc;border-radius:12px;padding:2px 6px';
    heading.append(newTag);
  }
  heading.append(el('span',item.fileName+' '+safeTime(item.peakSeconds)));
  card.append(heading);
  const meta=el('p','');
  meta.style.cssText='font-size:13px;line-height:1.55;margin:6px 0;color:#bdd2e4';
  const strength=item.evidence.strength||'なし';
  const initialPlace=Number.isFinite(item.originalRank)?'従来候補 '+item.originalRank+'位':'従来の候補外（新規探索）';
  meta.textContent=initialPlace+' ／ 広域音響 '+item.baseRank+'位 → AI参考 '+item.aiRank+'位 ／ 音響スコア '+item.score.toFixed(3)+
    ' ／ '+item.evidence.kind+(item.evidence.phrases.length?'（'+item.evidence.phrases.join('・')+'）':'')+
    ' ／ 掛け声の関連性：'+strength+
    (item.evidence.matchType==='発音近似'?'（近い発音・要確認）':
     item.evidence.matchType==='発音曖昧'?'（ナイスー／ナイシューの区別未確定）':'');
  card.append(meta);
  const preview=el('div','');
  const previewButton=btn('▶ 実際のシーンを見る',()=>{
    if(preview.firstChild){stopPreview();preview.replaceChildren();}
    else beginPreview(item.source,item.candidate,preview);
  },'ai-rerank-preview');
  card.append(previewButton,preview);
  const details=document.createElement('details');
  const sum=el('summary','音声・評価理由を見る');
  details.append(sum);
  const reason=el('p','');
  reason.style.cssText='font-size:13px;line-height:1.6;color:#bdd2e4;overflow-wrap:anywhere';
  reason.textContent='AI参考指数：'+item.aiIndex+'（確率ではありません）'+
     '＝音響指数 '+item.acousticIndex+' ＋ 掛け声の証拠 '+item.evidence.bonus+
     ' ／ '+(item.ai?.reason||'未解析')+' ／ 認識：'+phraseInfo(item);
  details.append(reason);
  if(item.evidence.ambiguity){
    const warning=el('p','⚠ '+item.evidence.ambiguity+'。実際の映像を見てご確認ください。');
    warning.style.cssText='font-size:13px;color:#f4d29d;line-height:1.5';
    details.append(warning);
  }
  const accepted=(item.ai?.transcripts||[]).filter(t=>t.usable);
  const vocabulary=loadVocabulary();
  for(const chunk of accepted){
    const nearby=contextualHints(chunk.text,vocabulary).map(x=>x.term+'（'+x.kind+'）').join(' / ');
    if(nearby)details.append(el('p','辞書候補：'+nearby));
  }
  if(item.ai?.error)details.append(el('p','AI解析エラー：'+item.ai.error));
  card.append(details);
  const labelRow=el('div','');
  labelRow.style.cssText='margin-top:10px';
  const caption=el('label','実際の映像を確認して評価（この端末に保存）');
  caption.style.cssText='display:block;font-size:12px;color:#bdd2e4;margin-bottom:5px';
  const dropdown=document.createElement('select');
  dropdown.setAttribute('aria-label',item.fileName+' '+safeTime(item.peakSeconds)+'の実際の評価');
  dropdown.style.cssText='width:100%;max-width:100%;padding:10px;border-radius:8px;color:#152c41;background:#eaf4fa';
  for(const option of LABELS){
    const child=document.createElement('option');
    child.value=option.value;child.textContent=option.text;
    dropdown.append(child);
  }
  dropdown.value=feedback[item.key] || 'unreviewed';
  dropdown.addEventListener('change',()=>{
    if(dropdown.value==='unreviewed')delete feedback[item.key];
    else feedback[item.key]=dropdown.value;
    persistFeedback();refreshMetrics();
  });
  labelRow.append(caption,dropdown);
  card.append(labelRow);
  return card;
}
function loadVocabulary() {
  let text=DEFAULT_CONTEXT;
  try{text=localStorage.getItem(VOCAB_KEY)||DEFAULT_CONTEXT;}catch(_){}
  return parseContextVocabulary(text);
}
function precision(items) {
  if(items.length!==5)return null;
  const values=items.map(x=>positive(feedback[x.key]));
  if(values.some(v=>v===null))return null;
  return values.filter(Boolean).length;
}
function refreshMetrics() {
  const target=$('aiRerankMetrics');
  if(!target||!records.length)return;
  const positiveCount=records.filter(x=>positive(feedback[x.key])===true).length;
  const negativeCount=records.filter(x=>positive(feedback[x.key])===false).length;
  const original=records.filter(x=>Number.isFinite(x.originalRank))
    .sort((a,b)=>a.originalRank-b.originalRank).slice(0,5);
  const aiTop=[...records].sort((a,b)=>a.aiRank-b.aiRank).slice(0,5);
  const originalHits=precision(original),aiHits=precision(aiTop);
  target.textContent='評価済み：見どころ '+positiveCount+'件 ／ 通常・ノイズ '+negativeCount+'件。'+
    (originalHits!==null&&aiHits!==null
      ? ' 上位5件の的中：従来 '+originalHits+'/5、AI探索 '+aiHits+'/5'
      : ' 従来上位5件とAI探索上位5件を評価すると、的中率を比較できます。')+
    ' ※全動画の見逃し率はこの数値では測れません。';
}
function render() {
  const wrapper=$('aiRerankResults');
  if(!wrapper)return;
  stopPreview();
  wrapper.replaceChildren();
  if(!records.length){wrapper.hidden=true;return;}
  wrapper.hidden=false;
  const summary=el('div','');
  summary.style.cssText='background:#152d43;border-radius:10px;padding:10px;margin-bottom:12px';
  const stats=currentStatistics;
  summary.append(el('strong','広域音声探索：候補 '+records.length+'件'));
  summary.append(el('p','従来候補 '+(stats?.existing??0)+'件＋新規探索 '+(stats?.newFound??0)+'件。感度を上げたピーク探索と、短間隔の音量変化から追加しています。'));
  summary.append(el('p','Whisper解析 '+speechAnalyzedCount+'件 ／ 発話スクリーニング '+vadAnalyzedCount+'件。AI順位はあくまで音声の参考指標です。'));
  const metrics=el('p','');
  metrics.id='aiRerankMetrics';
  metrics.style.cssText='font-size:13px;line-height:1.65';
  summary.append(metrics);
  wrapper.append(summary);
  const aiHeader=el('h4','AI探索 上位5件');
  aiHeader.style.cssText='font-size:15px;margin:15px 0 6px';
  wrapper.append(aiHeader);
  const byAI=[...records].sort((a,b)=>a.aiRank-b.aiRank);
  for(const item of byAI.slice(0,5))wrapper.append(makeCard(item,'ai'));
  const extra=document.createElement('details');
  extra.style.cssText='margin-top:14px;padding:10px;background:#092238;border-radius:10px';
  extra.append(el('summary','その他の探索候補 '+Math.max(0,byAI.length-5)+'件を表示（従来の候補外も確認）'));
  const extraItems=byAI.slice(5);
  // Put genuinely new scenes first for quick visual inspection.
  extraItems.sort((a,b)=>(a.discovery==='existing'?1:0)-(b.discovery==='existing'?1:0)||a.aiRank-b.aiRank);
  for(const item of extraItems)extra.append(makeCard(item,'ai'));
  wrapper.append(extra);
  const oldDetails=document.createElement('details');
  oldDetails.style.cssText='margin-top:15px';
  oldDetails.append(el('summary','従来候補と広域音響順位の比較一覧を見る'));
  const originalList=document.createElement('ol');
  originalList.style.cssText='padding-left:20px;font-size:13px;line-height:1.9';
  for(const item of [...records].sort((a,b)=>a.baseRank-b.baseRank)){
    const li=el('li',item.fileName+' '+safeTime(item.peakSeconds)+
      (Number.isFinite(item.originalRank)?' ／ 従来 '+item.originalRank+'位':' ／ 新規探索')+
      ' → AI '+item.aiRank+'位'+
      (feedback[item.key]?' ／ '+(LABELS.find(x=>x.value===feedback[item.key])?.text||''):''));
    li.style.overflowWrap='anywhere';
    originalList.append(li);
  }
  oldDetails.append(originalList);
  wrapper.append(oldDetails);
  const exportButton=btn('評価データをJSONで保存',()=>exportResults(),'ai-rerank-export');
  exportButton.style.cssText='display:block;width:100%;margin-top:12px';
  exportButton.disabled=running;
  wrapper.append(exportButton);
  const caution=el('p','候補数を広げても、無言の好プレー・音の小さな場面を見逃すことがあります。新規候補は通常のハイライト一覧に自動追加しません。各シーンを見て評価してください。');
  caution.style.cssText='font-size:12px;color:#bdd2e4';
  wrapper.append(caution);
  refreshMetrics();
}
function exportResults() {
  const payload={
    exportedAt:new Date().toISOString(),tool:'PeakStamp AI再評価β',
    scoringVersion:'6-wide-candidate-discovery',
    candidateDiscovery:'existing+detector-sensitive+raw-surge',
    statistics:currentStatistics,
    aiTranscribedCount:speechAnalyzedCount,
    vadCheckedCount:vadAnalyzedCount,
    caution:'参考指数は確率ではない。候補は最大20件まで。静かな見どころは検出対象外の可能性。',
    scenes:records.map(item=>({
      file:item.fileName,timeSeconds:item.peakSeconds,
      acousticScore:item.score,baseRank:item.baseRank,originalRank:item.originalRank,
      discovery:item.discovery,aiRank:item.aiRank,
      acousticIndex:item.acousticIndex,aiIndex:item.aiIndex,evidence:item.evidence,
      speech:item.ai?.transcripts?.map(x=>({text:x.text,when:x.when,seconds:x.seconds,usable:x.usable}))||[],
      aiReason:item.ai?.reason||'',aiError:item.ai?.error||'',
      userLabel:feedback[item.key]||'unreviewed',
    }))
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download='PeakStamp-AI-review.json';
  document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
}
export function refreshAIReview(state) {
  const button=$('aiRerankButton');
  if(!button)return;
  const pool=discoverScenePool(state.sources,{limit:MAX_SCENES});
  const entries=pool.entries;
  const current=keyOf(entries);
  if(snapshot && snapshot!==current && !running){
    records=[];snapshot='';render();
    setStatus(entries.length?'候補が変わったため、広域探索をやり直してください。':'');
  }
  button.disabled=running||state.working||state.exporting||!entries.length;
  button.textContent=running?'広域探索中…':'最大'+entries.length+'件の見どころを広域探索';
  $('aiRerankHelp').textContent=entries.length
    ? '既存候補以外も '+pool.statistics.newFound+'件発見可能。最大'+MAX_SCENES+'件を調べ、VADで発話を確認後、Whisperは最大'+MAX_ASR_SCENES+'件だけ解析します。'
    : '先に音声を解析してから実行してください。';
}
export function initAIReview(state) {
  const button=$('aiRerankButton');
  if(!button)return;
  button.addEventListener('click',async()=>{
    if(running||state.working||state.exporting)return;
    const pool=discoverScenePool(state.sources,{limit:MAX_SCENES});
    const entries=pool.entries;
    if(!entries.length)return;
    const signature=keyOf(entries);
    snapshot=signature;
    currentStatistics=pool.statistics;
    vadAnalyzedCount=0;speechAnalyzedCount=0;
    running=true;
    const isCurrent=()=>keyOf(getTopCandidates(state))===signature;
    // Show the expanded pool immediately so the user can inspect genuinely new
    // scenes even before the heavy speech models have finished.
    records=rankSceneEvidence(entries.map(x=>({
      ...x,ai:{speechDetected:false,transcripts:[],reason:'音声の広域候補（AIスクリーニング前）'}
    })));
    refreshAIReview(state);
    render();
    let vadUnavailable=false,asrFailed=false;
    const collected=[];
    setStatus('従来の候補以外に '+pool.statistics.newFound+'件の探索候補を用意しました。VAD検査を開始します。');
    try{
      for(let i=0;i<entries.length;i++){
        if(!isCurrent())throw Error('動画の候補が変わったため中止しました');
        const entry=entries[i];
        const update=message=>setStatus('発話検査 '+(i+1)+'/'+entries.length+'：'+message);
        let candidate={...entry,ai:{speechDetected:false,transcripts:[],reason:'発話検査前'},_clips:[]};
        if(vadUnavailable){
          candidate.ai.reason='VADが使用不可。広域音響候補として残します。';
        }else{
          try{
            const scan=await scanEntry(entry,update,isCurrent);
            candidate.ai=scan.ai;candidate._clips=scan.clips;
            vadAnalyzedCount++;
          }catch(e){
            if(!isCurrent())throw Error('候補が変更されました');
            const message=String(e?.message||e);
            if(/発話検出|VAD|onnx|silero|wasm/i.test(message))vadUnavailable=true;
            candidate.ai.reason='発話検出失敗（広域音響候補は維持）';
            candidate.ai.error=message;
          }
        }
        collected.push(candidate);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      const chosen=vadUnavailable?[]:pickASRCandidates(collected,MAX_ASR_SCENES);
      for(let i=0;i<chosen.length;i++){
        if(!isCurrent())throw Error('候補が変更されました');
        const candidate=chosen[i];
        const update=message=>setStatus('掛け声検査 '+(i+1)+'/'+chosen.length+'：'+message);
        if(asrFailed){candidate.ai.reason='Whisperモデルを利用できませんでした';continue;}
        try{
          await transcribeScanned(candidate,update,isCurrent);
          speechAnalyzedCount++;
        }catch(e){
          if(!isCurrent())throw Error('候補が変更されました');
          const message=String(e?.message||e);
          if(/Whisper|model|pipeline|tokenizer|wasm/i.test(message))asrFailed=true;
          candidate.ai.error=message;
          candidate.ai.reason='掛け声解析失敗（候補は維持）';
        }
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      for(const candidate of collected){
        delete candidate._clips;
        if(candidate.ai.speechDetected && !candidate.ai.transcripts?.length &&
          !candidate.ai.error)candidate.ai.reason='VADで声あり・Whisper対象外（処理上限）';
      }
      records=rankSceneEvidence(collected);
      setStatus('探索完了：'+records.length+'件の候補、うち新規'+pool.statistics.newFound+'件。'+
        'VAD検査'+vadAnalyzedCount+'件、Whisper解析'+speechAnalyzedCount+'件。'+
        '実際のプレーを確認し、評価データを保存してください。');
      render();
    }catch(e){
      records=[];snapshot='';render();
      setStatus('広域探索を中断しました：'+(e?.message||String(e)));
    }finally{
      running=false;
      refreshAIReview(state);
      if(records.length)render(); // re-enable JSON download
    }
  });
  refreshAIReview(state);
}
