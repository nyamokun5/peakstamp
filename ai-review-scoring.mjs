/**
 * PeakStamp AI re-evaluation scorer, v4 (heuristic only).
 * Two independent cues: actual acoustic event strength and credible soccer shouts.
 * Do not infer a goal from speech alone. Never override the user's keep/reject.
 * Audio scores and ASR text are both unreliable in isolation.
 */
export const GROUPS = [
  {kind:'ゴール反応',strength:'強',bonus:18,words:['ゴール','ごーる','入った','はいった','決まった','きまった']},
  {kind:'ナイシュー（ナイスシュート）',strength:'強',bonus:17,words:['ナイシュー','ナイシュ','ないしゅー','ないしゅ','ナイスシュー','ナイスシュート']},
  {kind:'ナイスキー（ナイスキーパー）',strength:'強',bonus:17,words:['ナイスキー','ナイスキ','ないすきー','ないすき','ナイスキーパー','ナイスセーブ']},
  {kind:'惜しい反応',strength:'強',bonus:15,words:['惜しい','おしい','おしー','おっしー']},
  {kind:'うまい反応',strength:'強',bonus:14,words:['うまい','上手い','上手','うまっ','うめえ','うめぇ']},
  {kind:'その他のポジティブ反応',strength:'弱',bonus:5,words:['ナイスパス','ナイス','すごい','すげえ']}
];
export const LABELS = Object.freeze([
  {value:'unreviewed',text:'未評価',positive:null},
  {value:'goal',text:'実際にゴール',positive:true},
  {value:'good',text:'実際に好プレー',positive:true},
  {value:'close',text:'実際に惜しい',positive:true},
  {value:'ordinary',text:'通常プレー',positive:false},
  {value:'noise',text:'ノイズ・誤検出',positive:false}
]);
const strip=value=>String(value??'').normalize('NFKC')
  .toLowerCase().replace(/\s+/gu,'').replace(/[！!。．、,？?\-ー]/gu,'');
const prepare=value=>String(value??'').normalize('NFKC').trim().toLowerCase();

/**
 * Deliberate recognition suppression, not a guarantee of correctly heard speech.
 * Repeated hallucinations and parenthesized sound labels are not playable speech.
 */
export function plausibleSpeech(text, seconds=4) {
  const original=prepare(text);
  const s=strip(text);
  if(!s || s.length>Math.max(35,Math.ceil(seconds*13)))return false;
  // Common Whisper substitutions for isolated noise or laughter.
  if(/^[（(][^)）]{1,12}[）)]$/u.test(original))return false;
  if(/^(?:笑|わら|ww+|www+|laugh|laughter)$/iu.test(s))return false;
  if(/(.)\1{9,}/u.test(s))return false;
  if(/(.{2,5})\1{6,}/u.test(s))return false;
  if(s.length>=35&&new Set([...s]).size/s.length<.14)return false;
  return true;
}

/** Recognize only narrow, explicit soccer shout pronunciation variants.
 * Does NOT do generic fuzzy matching: it would turn background chatter into goals.
 */
function isSportShout(text,word,group){
  const raw=prepare(text).replace(/[！!。．、,？?\s]+$/gu,'');
  if(raw.length>22)return false;
  const i=raw.indexOf(prepare(word));
  if(i<0)return false;
  const after=raw.slice(i+prepare(word).length);
  // Do not mistake soccer terminology or conversation for a goal celebration.
  if(group.kind==='ゴール反応'){
    if(/^(?:キック|ライン|前|近|の|に|を|から|まで|する|したら)/u.test(after))return false;
    if(after&&!/^(?:だ+|だね|だよ|ねぇ?|よ+|ー+|っ+|すごい)$/u.test(after))return false;
  }
  // 'ナイス' is weaker than a dedicated shot/save shout.
  if(word==='ナイス'&&/ナイシュー|ナイスシュート|ナイスキー|ナイスキーパー|ナイスパス|ナイスセーブ/u.test(raw))return false;
  return raw.length<=18;
}
function phoneticReaction(transcript) {
  const t=prepare(transcript);
  // e.g. "おーしー！" (candidate for 惜しい), but not arbitrary "おし" in a sentence.
  if(/^(?:おー?しー+|おしい+|おっしー+|惜しー+)(?:[！!？?。、\s]|$)/u.test(t) ||
     /^(?:おー?しー+|おしい+|おっしー+|惜しー+)$/u.test(t))
    return {kind:'惜しい反応（発音近似・要確認）',strength:'弱',bonus:8,phrases:['惜しい？'],matchType:'発音近似'};
  // Only near-isolated shouts are allowed as pronunciation-based evidence.
  if(/^(?:ないしー+|ナイシー+)[！!？?\s]*$/u.test(t))
    return {kind:'好プレー反応（発音近似・要確認）',strength:'弱',bonus:5,phrases:['ナイス？'],matchType:'発音近似'};
  return null;
}

export function classifyEvidence(transcripts=[],speechDetected=false,peakSeconds=null) {
  if(!speechDetected||!Array.isArray(transcripts)||!transcripts.length)
    return {kind:'音響のみ',bonus:0,phrases:[],matchType:'なし',hasUsableSpeech:false};
  const usable=transcripts.filter(x=>{
    if(!x||x.speechDetected===false||!plausibleSpeech(x.text,x.seconds))return false;
    // Only reactions close to the audio peak may influence its ranking.
    if(Number.isFinite(peakSeconds)&&Number.isFinite(x.when)){
      const centre=x.when+(Number(x.seconds)||0)/2;
      return Math.abs(centre-peakSeconds)<=4;
    }
    return true;
  });
  if(!usable.length)
    return {kind:'発話あり・認識不明',bonus:0,phrases:[],matchType:'なし',hasUsableSpeech:false};
  let best=null;
  for(const segment of usable){
    const s=strip(segment.text);
    for(const group of GROUPS){
      const hits=group.words.filter(word=>isSportShout(segment.text,word,group));
      if(hits.length){
        const candidate={kind:group.kind,strength:group.strength,bonus:group.bonus,phrases:hits.slice(0,3),
          matchType:'直接一致',hasUsableSpeech:true};
        if(!best||candidate.bonus>best.bonus)best=candidate;
      }
    }
    const weak=phoneticReaction(segment.text);
    if(weak && (!best||weak.bonus>best.bonus))
      best={...weak,hasUsableSpeech:true};
  }
  return best||{kind:'発話あり・掛け声不明',bonus:0,phrases:[],matchType:'なし',hasUsableSpeech:true};
}

/** Relative acoustic strength rather than arbitrary 9-point rank steps.
 * When acoustic peaks differ by only ~5%, a confirmed shout may change ordering.
 * A very weak peak still cannot jump above a strong event with a short phrase.
 */
export function rankSceneEvidence(entries=[]) {
  const baseline=[...entries].sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)||
    (Number(a.peakSeconds)||0)-(Number(b.peakSeconds)||0));
  const maxScore=Math.max(0.0001,...baseline.map(x=>Math.max(0,Number(x.score)||0)));
  const scored=baseline.map((x,index)=>{
    const evidence=classifyEvidence(x.ai?.transcripts||[],x.ai?.speechDetected===true,x.peakSeconds);
    const acousticIndex=100*Math.max(0,Number(x.score)||0)/maxScore;
    return {...x,baseRank:index+1,acousticIndex:+acousticIndex.toFixed(2),
      aiIndex:+(acousticIndex+evidence.bonus).toFixed(2),evidence};
  });
  return scored.sort((a,b)=>b.aiIndex-a.aiIndex||a.baseRank-b.baseRank)
    .map((x,index)=>({...x,aiRank:index+1}));
}
export function precisionAtK(entries,key,labels,k=3) {
  const sorted=[...entries].sort((a,b)=>(Number(a[key])||0)-(Number(b[key])||0)).slice(0,k);
  if(sorted.length<k)return null;
  const mapped=sorted.map(x=>LABELS.find(l=>l.value===labels[x.key])?.positive);
  if(mapped.some(x=>x===null||x===undefined))return null;
  return {hits:mapped.filter(Boolean).length,count:k};
}
