/**
 * PeakStamp beta AI re-review scoring. No scene selection or export mutations.
 * IMPORTANT: these are sortable HEURISTIC indices, never calibrated probabilities.
 * Only speech-confirmed, non-hallucination, exact soccer reaction phrases can
 * increase the ranking; fuzzy dictionary suggestions and player names never do.
 */
const GROUPS = [
  { kind: 'ゴール反応', bonus: 20, words: ['ゴール', '入った', '決まった', '決めた', 'やった', 'ナイスシュート'] },
  { kind: '好プレー反応', bonus: 16, words: ['ナイスパス', 'ナイスセーブ', 'ナイスプレー', 'ナイス', '上手い', 'うまい', 'すごい', 'すげえ', '最高'] },
  { kind: '惜しい反応', bonus: 12, words: ['惜しい', 'おしい', 'あぶない', '危ない'] }
];
export const LABELS = Object.freeze([
  { value:'unreviewed', text:'未評価', positive:null },
  { value:'goal', text:'実際にゴール', positive:true },
  { value:'good', text:'実際に好プレー', positive:true },
  { value:'close', text:'実際に惜しい', positive:true },
  { value:'ordinary', text:'通常プレー', positive:false },
  { value:'noise', text:'ノイズ・誤検出', positive:false }
]);
const strip=(value)=>String(value??'').normalize('NFKC').replace(/\s+/gu,'')
  .replace(/[！!。．、,？?\-ー]/gu,'').toLowerCase();

/**
 * Speech-recognition junk filter, deliberately conservative.
 * Passing this does not prove transcript correctness.
 */
export function plausibleSpeech(text, seconds=4) {
  const s=strip(text);
  if(!s || s.length>Math.max(35,Math.ceil(seconds*13)))return false;
  if(/(.)\1{9,}/u.test(s))return false;
  if(/(.{2,5})\1{6,}/u.test(s))return false;
  if(s.length>=35 && new Set([...s]).size/s.length<.14)return false;
  return true;
}
export function classifyEvidence(transcripts=[],speechDetected=false) {
  const segments=Array.isArray(transcripts)?transcripts:[];
  if(!speechDetected || !segments.length)return {kind:'音響のみ',bonus:0,phrases:[],hasUsableSpeech:false};
  const usable=segments.filter(x=>x && x.speechDetected!==false && plausibleSpeech(x.text,x.seconds));
  if(!usable.length)return {kind:'発話あり・認識不明',bonus:0,phrases:[],hasUsableSpeech:false};
  const texts=usable.map(x=>strip(x.text));
  const candidates=GROUPS.map(g=>({...g,hits:g.words.filter(word=>texts.some(t=>t.includes(strip(word))))}))
    .filter(g=>g.hits.length);
  if(!candidates.length)return {kind:'発話あり・掛け声不明',bonus:0,phrases:[],hasUsableSpeech:true};
  const best=candidates[0];
  // Score once per category; repeated single short names or fuzzy matches are not evidence.
  return {kind:best.kind,bonus:best.bonus,phrases:best.hits.slice(0,3),hasUsableSpeech:true};
}
/** Top 5 shortlist only: a ranking cannot find an event absent from the shortlist. */
export function rankSceneEvidence(entries=[]) {
  const baseline=[...entries].sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)||
    (Number(a.peakSeconds)||0)-(Number(b.peakSeconds)||0));
  const scored=baseline.map((x,index)=>{
    const evidence=classifyEvidence(x.ai?.transcripts||[],x.ai?.speechDetected===true);
    // Acoustic ranking must remain dominant. Bonus can move a plausible event
    // about one or two places, but cannot automatically reject a quiet goal.
    const baseIndex=100-index*9;
    return {...x,baseRank:index+1,acousticIndex:baseIndex,
      aiIndex:baseIndex+evidence.bonus,evidence};
  });
  return [...scored].sort((a,b)=>b.aiIndex-a.aiIndex||
      a.baseRank-b.baseRank).map((x,index)=>({...x,aiRank:index+1}));
}
export function precisionAtK(entries, key, labels, k=3) {
  const sorted=[...entries].sort((a,b)=>(a[key]||0)-(b[key]||0)).slice(0,k);
  if(sorted.length<k)return null;
  const mapped=sorted.map(x=>LABELS.find(l=>l.value===labels[x.key])?.positive);
  if(mapped.some(x=>x===null||x===undefined))return null;
  return {hits:mapped.filter(Boolean).length,count:k};
}
