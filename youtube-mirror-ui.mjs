import {mirrorClips,publishMirror} from './youtube-mirror.mjs?v=short1';
import {youtubeApi,youtubeEnvironment} from './youtube-api.mjs';
import {goalSourceKey} from './goal-stats.mjs';
import {sourceDisplayName} from './match-label.mjs';
export function initYouTubeMirror(state,{getPlan,document:doc=globalThis.document,storage=localStorage}={}){
 const key='peakstamp-youtube-mirror-'+youtubeEnvironment+'-v1';let record;
 try{record=JSON.parse(storage.getItem(key)||'null')}catch{}
 if(!record||!record.urls||!record.jobs)record={urls:{},jobs:{}};
 const save=()=>storage.setItem(key,JSON.stringify(record));
 const el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n};
 const root=el('details');root.id='youtubeMirror';root.className='youtube-output';root.append(el('summary','同じ範囲でYouTubeハイライトも作る'));
 root.append(el('p','同じ元動画のYouTube URLを指定すると、今の開始・終了時刻で短い共有リンクを発行します。解析で使用したアクセスコードで保存します。再解析は不要です。'));
 const accessLabel=el('label','共有用アクセスコード（解析時と同じ）'),accessInput=el('input');accessInput.type='password';accessInput.autocomplete='off';accessLabel.append(accessInput);
 accessInput.oninput=()=>{const main=doc.getElementById('geminiMainAccess');main.value=accessInput.value;main.dispatchEvent(new Event('change',{bubbles:true}));};
 const fields=el('div'),summary=el('p'),label=el('label'),aligned=el('input');aligned.type='checkbox';label.append(aligned,doc.createTextNode('YouTubeは元動画と同じ内容・開始位置です'));
 const note=el('p','タイトル・画角・切り替え効果はYouTube再生には反映されません。');note.className='fine-print';
 const button=el('button','短い共有リンクを発行');button.id='youtubeMirrorCreate';button.type='button';button.className='main-button';
 const status=el('p');status.id='youtubeMirrorStatus';status.setAttribute('role','status');
 const result=el('div'),open=el('a','YouTubeハイライトを開く');open.target='_blank';open.rel='noopener';open.hidden=true;
 const copy=el('button','短いリンクをコピー');copy.type='button';copy.hidden=true;copy.onclick=async()=>{try{await navigator.clipboard.writeText(open.href);status.textContent='コピーしました。'}catch{status.textContent=open.href}};
 result.append(open,copy);root.append(fields,summary,label,accessLabel,note,button,status,result);doc.getElementById('montageExport').after(root);
 let busy=false,signature='',planStamp='',showAccess=false;const inputs=new Map();
 const refresh=()=>{
  const access=doc.getElementById('geminiMainAccess').value;accessLabel.hidden=Boolean(access)&&!showAccess&&doc.activeElement!==accessInput;if(doc.activeElement!==accessInput)accessInput.value=access;
  const plan=getPlan();let stamp;try{stamp=JSON.stringify(mirrorClips(state.sources,plan,record.urls))}catch{stamp=JSON.stringify(plan)};if(stamp!==planStamp){const hadLink=!open.hidden;planStamp=stamp;open.hidden=copy.hidden=true;if(hadLink)status.textContent='切り取り・得点情報が変わりました。リンクを作成し直してください。';button.textContent='短い共有リンクを発行';}root.hidden=Boolean(new URLSearchParams(location.search).has('youtube'))||!plan.length;
  const sources=state.sources.filter(s=>plan.some(c=>c.sourceId===s.id));const next=sources.map(goalSourceKey).join('|');
  if(next!==signature){signature=next;fields.replaceChildren();inputs.clear();aligned.checked=false;
   for(const source of sources){const k=goalSourceKey(source),box=el('label',sourceDisplayName(source)+'（'+source.file.name+'）：YouTube URL'),input=el('input');input.type='url';input.placeholder='https://youtu.be/…';input.setAttribute('aria-label',sourceDisplayName(source)+'のYouTube URL');input.value=record.urls[k]||'';
    input.oninput=()=>{record.urls[k]=input.value.trim();save();aligned.checked=false;open.hidden=copy.hidden=true};box.append(input);fields.append(box);inputs.set(k,input);}}
  summary.textContent=plan.length+'場面・切り取り合計 '+(plan.reduce((n,c)=>n+c.end-c.start,0)).toFixed(1)+'秒（MP4と同じ切り取り範囲）';
  button.disabled=busy||state.working||state.exporting||state.geminiProcessing;
 };
 button.onclick=async()=>{
  if(busy||state.working||state.exporting||state.geminiProcessing)return;
  try{if(!aligned.checked)throw Error('元動画と同じ内容・開始位置であることを確認してください。');
   const clips=mirrorClips(state.sources,getPlan(),record.urls);
   busy=true;refresh();button.textContent='作成・結果を確認中…';status.textContent='同じ切り取り範囲で作成しています…';
   const job=await publishMirror({clips,access:doc.getElementById('geminiMainAccess').value.trim(),record,save,endpoint:youtubeApi('share'),requireContract:youtubeEnvironment==='production'});
   const href=new URL('./youtube-watch.html?id='+job.id,location.href).href;
   if(JSON.stringify(mirrorClips(state.sources,getPlan(),record.urls))!==JSON.stringify(clips)){status.textContent='範囲またはURLが変更されました。最新の範囲で作成してください。';return;}
   showAccess=false;open.href=href;open.hidden=copy.hidden=false;status.textContent='短い共有リンクを発行しました。再解析は行っていません。';
  }catch(e){if(e.message.includes('アクセスコード'))showAccess=true;status.textContent=e.message;button.textContent='短い共有リンクを発行';}
  finally{busy=false;refresh();if(open.hidden&&status.textContent.includes('再送'))button.textContent='結果を確認';else if(!open.hidden)button.textContent='YouTubeハイライトを確認';}
 };
 globalThis.addEventListener('montage-export-state',refresh);
 globalThis.addEventListener('gemini-processing-state',refresh);
 refresh();return {refresh};
}
