/**
 * PeakStamp experimental AI re-review (top 5 acoustic candidates).
 * No mutation of candidate score, ordering, keep/reject or video export.
 * AI index is a heuristic, not a probability. Feedback provides ground truth.
 */
import { extractSnippet, snippetWindow } from './whisper-experiment.mjs?v=whisper21';
import { DEFAULT_CONTEXT, parseContextVocabulary, contextualHints, speechSegmentsByVAD } from './soccer-speech-context.mjs?v=2';
import { plausibleSpeech, rankSceneEvidence, LABELS, precisionAtK } from './ai-review-scoring.mjs?v=2';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'peakstamp_ai_scene_labels_v1';
const VOCAB_KEY = 'peakstamp_soccer_vocabulary_v1';
const MODEL = 'onnx-community/whisper-base';
const MODEL_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MAX_SCENES = 5;
const MAX_SPEECH_SEGMENTS = 2;
let recognizerPromise = null;
let running = false;
let records = [];
let snapshot = '';
let note = '';
let activeVideo = null;
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
  const entries=[];
  for(const source of state.sources||[]) {
    if(!source?.bins || !(source.duration>0)) continue;
    for(const candidate of source.candidates||[]) {
      const score=Number(candidate.score);
      if(!Number.isFinite(score)) continue;
      entries.push({
        key:srcKey(source,candidate),
        sourceId:source.id, candidateId:candidate.id,
        fileName:source.file.name, duration:source.duration,
        peakSeconds:candidate.peakSeconds, time:candidate.time,
        score,source,candidate
      });
    }
  }
  return entries.sort((a,b)=>b.score-a.score || a.peakSeconds-b.peakSeconds).slice(0,MAX_SCENES);
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
async function analyzeEntry(entry, update, isStillCurrent) {
  const span=snippetWindow(entry.peakSeconds,entry.duration,12);
  update('音声を抽出中：'+entry.fileName+' '+safeTime(span.start));
  const audio=await extractSnippet(entry.source.file,span.start,span.end);
  if(!isStillCurrent())throw Error('動画の候補が変更されました。再評価をやり直してください。');
  if(audio.length<16000 || rms(audio)<.002) {
    return {speechDetected:false,transcripts:[],reason:'無音または非常に小さい音',window:span};
  }
  update('VADで人の声を検出中…');
  const detected=await speechSegmentsByVAD(audio,update);
  if(!isStillCurrent())throw Error('動画の候補が変更されました。');
  if(!detected.length)return {speechDetected:false,transcripts:[],reason:'VADで発話なし（歓声を見落とす可能性）',window:span};
  const selected=partsNearPeak(detected,entry.peakSeconds,span.start);
  const recognizer=await loadASR(update);
  const results=[];
  for(let i=0;i<selected.length;i++){
    if(!isStillCurrent())throw Error('候補が変更されました。');
    const part=selected[i];
    const left=Math.max(0,Math.floor(part.start*16000));
    const right=Math.min(audio.length,Math.ceil(part.end*16000));
    const samples=audio.slice(left,right);
    if(samples.length<16000*.35 || rms(samples)<.002)continue;
    update('Whisper Baseで掛け声解析中：'+(i+1)+'/'+selected.length);
    const recognized=await recognizer(samples,{
      language:'japanese',task:'transcribe',return_timestamps:false,
      temperature:0,max_new_tokens:64
    });
    const transcript=String(recognized?.text||'').trim();
    results.push({
      text:transcript,seconds:samples.length/16000,
      speechDetected:true,when:span.start+part.start,
      usable:plausibleSpeech(transcript,samples.length/16000)
    });
  }
  return {speechDetected:true,transcripts:results,reason:'VAD発話候補 '+detected.length+'件、文字起こし '+results.length+'区間',window:span};
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
  heading.append(el('span',(rankType==='ai'?'AI':'従来')+' '+(rankType==='ai'?item.aiRank:item.baseRank)+'位'));
  heading.append(el('span',item.fileName+' '+safeTime(item.peakSeconds)));
  card.append(heading);
  const meta=el('p','');
  meta.style.cssText='font-size:13px;line-height:1.55;margin:6px 0;color:#bdd2e4';
  meta.textContent='従来 '+item.baseRank+'位 → AI参考 '+item.aiRank+'位 ／ 音響スコア '+item.score.toFixed(3)+
    ' ／ '+item.evidence.kind+(item.evidence.phrases.length?'（'+item.evidence.phrases.join('・')+'）':'');
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
  reason.textContent='AI参考指数：'+item.aiIndex+'（確率ではありません）／ '+(item.ai?.reason||'未解析')+
     ' ／ 認識：'+phraseInfo(item);
  details.append(reason);
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
  const caption=el('label','実際のシーンを見た評価（次回もこの端末に保存）');
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
function refreshMetrics() {
  const target=$('aiRerankMetrics');
  if(!target||!records.length)return;
  const positiveCount=records.filter(x=>positive(feedback[x.key])===true).length;
  const negativeCount=records.filter(x=>positive(feedback[x.key])===false).length;
  const original=precisionAtK(records,'baseRank',feedback,3);
  const newRank=precisionAtK(records,'aiRank',feedback,3);
  target.textContent='実際のシーン評価：'+positiveCount+'件が見どころ ／ '+negativeCount+'件が通常・ノイズ。'+
    (original&&newRank
      ? ' 上位3件の的中：従来 '+original.hits+'/3、AI '+newRank.hits+'/3（評価済みシーンのみで算定）'
      : ' 従来・AIそれぞれの上位3件をすべて評価すると比較できます。')+
    ' ※上位5候補に含まれない見逃しシーンはこの指標では測れません。';
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
  summary.append(el('strong','従来順位 vs AI参考順位（上位5候補）'));
  const metrics=el('p','');
  metrics.id='aiRerankMetrics';
  metrics.style.cssText='font-size:13px;line-height:1.65';
  summary.append(metrics);
  wrapper.append(summary);
  const aiHeader=el('h4','AI参考順位');
  aiHeader.style.cssText='font-size:15px;margin:15px 0 6px';
  wrapper.append(aiHeader);
  for(const item of [...records].sort((a,b)=>a.aiRank-b.aiRank))wrapper.append(makeCard(item,'ai'));
  const oldDetails=document.createElement('details');
  oldDetails.style.cssText='margin-top:15px';
  oldDetails.append(el('summary','従来順位との比較一覧を見る'));
  const originalList=document.createElement('ol');
  originalList.style.cssText='padding-left:20px;font-size:13px;line-height:1.9';
  for(const item of [...records].sort((a,b)=>a.baseRank-b.baseRank)){
    const li=el('li',item.fileName+' '+safeTime(item.peakSeconds)+
      ' → AI '+item.aiRank+'位'+
      (feedback[item.key]?' ／ '+(LABELS.find(x=>x.value===feedback[item.key])?.text||''):''));
    li.style.overflowWrap='anywhere';
    originalList.append(li);
  }
  oldDetails.append(originalList);
  wrapper.append(oldDetails);
  const exportButton=btn('評価データをJSONで保存',()=>exportResults(),'ai-rerank-export');
  exportButton.style.cssText='display:block;width:100%;margin-top:12px';
  wrapper.append(exportButton);
  const caution=el('p','音声を認識できないゴール・無言の好プレーもあります。AIはキープ/不採用やシーン位置を変更しません。');
  caution.style.cssText='font-size:12px;color:#bdd2e4';
  wrapper.append(caution);
  refreshMetrics();
}
function exportResults() {
  const payload={
    exportedAt:new Date().toISOString(),tool:'PeakStamp AI再評価β',
    caution:'辞書照合は確定認識ではない。指数は確率ではない。対象は音響上位5件のみ。',
    scenes:records.map(item=>({
      file:item.fileName,timeSeconds:item.peakSeconds,
      acousticScore:item.score,baseRank:item.baseRank,aiRank:item.aiRank,
      aiIndex:item.aiIndex,evidence:item.evidence,
      speech:item.ai?.transcripts?.map(x=>({text:x.text,when:x.when,usable:x.usable}))||[],
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
  const entries=getTopCandidates(state);
  const current=keyOf(entries);
  if(snapshot && snapshot!==current && !running) {
    records=[];snapshot='';render();
    setStatus(entries.length?'候補が変わりました。再評価をやり直してください。':'');
  }
  button.disabled=running||state.working||state.exporting||!entries.length;
  button.textContent=running?'AI再評価中…':'音響上位'+Math.min(entries.length,MAX_SCENES)+'件をAIで再評価';
  $('aiRerankHelp').textContent=entries.length
    ? '音響上位'+entries.length+'件が対象。VAD→Whisper Base→サッカー反応の厳密一致で参考順位を比較。'
    : '先に音声を解析してハイライト候補を作成してください。';
}
export function initAIReview(state) {
  const button=$('aiRerankButton');
  if(!button)return;
  button.addEventListener('click',async()=>{
    if(running||state.working||state.exporting)return;
    const entries=getTopCandidates(state);
    if(!entries.length)return;
    const signature=keyOf(entries);
    snapshot=signature;
    running=true;records=[];render();refreshAIReview(state);
    const isCurrent=()=>keyOf(getTopCandidates(state))===signature;
    let vadUnavailable=false,asrFailed=false;
    const collected=[];
    setStatus('AI再評価を準備中…（初回は発話検出とWhisperのモデルを取得します）');
    try{
      for(let i=0;i<entries.length;i++){
        const entry=entries[i];
        const update=message=>setStatus('候補 '+(i+1)+'/'+entries.length+'：'+message);
        let ai;
        if(vadUnavailable){
          ai={speechDetected:false,transcripts:[],reason:'VADを利用できないため音響順位を保持',error:'VADの読み込みに失敗'};
        }else if(asrFailed){
          ai={speechDetected:false,transcripts:[],reason:'Whisperが使用できないため音響順位を保持'};
        }else {
          try {
            ai=await analyzeEntry(entry,update,isCurrent);
          }catch(e){
            const message=String(e?.message||e);
            if(!isCurrent())throw Error('候補が変更されたので結果を破棄しました');
            if(/発話検出|VAD|onnx|silero|wasm/i.test(message))vadUnavailable=true;
            if(/Whisper|model|pipeline|tokenizer/i.test(message))asrFailed=true;
            ai={speechDetected:false,transcripts:[],reason:'解析できず音響順位を保持',error:message};
          }
        }
        collected.push({...entry,ai});
        if(!isCurrent())throw Error('候補が変更されたので結果を破棄しました');
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      const ranked=rankSceneEvidence(collected);
      records=ranked;
      note='完了しました。各シーンを再生して、実際の内容を評価してください。';
      const failures=collected.filter(x=>x.ai?.error).length;
      setStatus(note+(failures?'（AI解析できなかった候補 '+failures+'件は音響順位を維持）':''));
      render();
    }catch(e){
      records=[];snapshot='';render();setStatus('AI再評価を中断しました：'+(e?.message||String(e)));
    }finally{
      running=false;refreshAIReview(state);
    }
  });
  refreshAIReview(state);
}
