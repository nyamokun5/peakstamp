// Read-only alias matching against the currently loaded official SS roster.
const normalize=value=>String(value??'').trim().normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).replace(/[\s　]/g,'');
// Spoken Japanese honorifics are not part of a player's identity. Only remove
// a terminal honorific; never infer a different kanji spelling without a
// verified roster alias.
const knownSpeechVariants=new Map([['足川','芦川']]);
const spokenKeys=value=>{
 const key=normalize(value);
 const base=key.replace(/(?:さん|さま|様)$/,'');
 const variant=knownSpeechVariants.get(base);
 return [...new Set([key,base,...(variant?[variant,variant+'さん']:[])].filter(Boolean))];
};
// Convert audible kana to a comparable romanized reading. Kanji names are
// never assigned a guessed reading: they need a verified alias.
const digraphs={しゃ:'sha',しゅ:'shu',しょ:'sho',ちゃ:'cha',ちゅ:'chu',ちょ:'cho',じゃ:'ja',じゅ:'ju',じょ:'jo',きゃ:'kya',きゅ:'kyu',きょ:'kyo',ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',にゃ:'nya',にゅ:'nyu',にょ:'nyo',ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',びゃ:'bya',びゅ:'byu',びょ:'byo',ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',りゃ:'rya',りゅ:'ryu',りょ:'ryo'};
const syllables=['あいうえお','かきくけこ','さしすせそ','たちつてと','なにぬねの','はひふへほ','まみむめも','や ゆ よ','らりるれろ','わ   を','がぎぐげご','ざじずぜぞ','だぢづでど','ばびぶべぼ','ぱぴぷぺぽ'];
const sounds=['aiueo','kakikukeko','sashisuseso','tachitsuteto','naninuneno','hahifuheho','mamimumemo','ya yu yo','rarirurero','wa   wo','gagigugego','zajizuzezo','dadidzudedo','babibubebo','papipupepo'];
const kanaMap={};
const romanRows=[['あ','a'],['い','i'],['う','u'],['え','e'],['お','o']];
const rows=[['かきくけこ',['ka','ki','ku','ke','ko']],['さしすせそ',['sa','shi','su','se','so']],['たちつてと',['ta','chi','tsu','te','to']],['なにぬねの',['na','ni','nu','ne','no']],['はひふへほ',['ha','hi','fu','he','ho']],['まみむめも',['ma','mi','mu','me','mo']],['やゆよ',['ya','yu','yo']],['らりるれろ',['ra','ri','ru','re','ro']],['わを',['wa','wo']],['がぎぐげご',['ga','gi','gu','ge','go']],['ざじずぜぞ',['za','ji','zu','ze','zo']],['だぢづでど',['da','ji','zu','de','do']],['ばびぶべぼ',['ba','bi','bu','be','bo']],['ぱぴぷぺぽ',['pa','pi','pu','pe','po']]];
for(const [chars,values] of rows)for(let i=0;i<chars.length;i++)kanaMap[chars[i]]=values[i];
for(const [k,v] of romanRows)kanaMap[k]=v;
kanaMap['ん']='n';
export function phoneticRoman(value){
 const v=normalize(value).replace(/(?:さん|くん|ちゃん|さま)$/,'');
 if(!/^[ぁ-ゖー]+$/.test(v))return null;
 let out='';
 for(let i=0;i<v.length;i++){
  if(v[i]==='っ'){
   const next=digraphs[v.slice(i+1,i+3)]||kanaMap[v[i+1]];
   if(!next)return null;out+=next[0];continue;
  }
  if(v[i]==='ー'){const vowel=out.match(/[aeiou]$/)?.[0];if(!vowel)return null;out+=vowel;continue;}
  const pair=digraphs[v.slice(i,i+2)];
  if(pair){out+=pair;i++;continue;}
  if(!kanaMap[v[i]])return null;
  out+=kanaMap[v[i]];
 }
 return out;
}
export function matchOfficialAlias(raw,entries,snapshot,fixtureSeq){
 const keys=spokenKeys(raw);
 const key=keys[0];
 if(!key||!Array.isArray(entries)||!snapshot?.memberIds||!snapshot?.playerTeam)return null;
 const names=new Set();
 const match=snapshot.matches?.find(m=>Number(m.seq)===Number(fixtureSeq));
 if(!match)return null;
 // Prefer an exact official roster name over an alias; never create a duplicate alias.
 const direct=(snapshot.players||[]).filter(name=>keys.includes(normalize(name)));
 if(direct.length===1)return snapshot.memberIds.has(direct[0])&&
  [match.leftTeam,match.rightTeam].includes(snapshot.playerTeam.get(direct[0]))?direct[0]:null;
 if(direct.length>1)return null;
 // Shared aliases remain ambiguous even when one member is outside this fixture.
 const targets=new Set(entries.filter(e=>keys.includes(normalize(e.alias))).map(e=>String(e.member_id).toLowerCase()));
 // The observed speech recognition 足川 corresponds to the roster spelling
 // Ashikawa only when it is unique in the selected fixture and no alias
 // points to a different member. This is not a general fuzzy-name guess.
 if(targets.size===0&&normalize(raw).replace(/さん$/,'')==='足川'){
  const candidates=(snapshot.players||[]).filter(name=>normalize(name)==='ashikawa');
  if(candidates.length===1&&snapshot.memberIds.has(candidates[0])&&
     [match.leftTeam,match.rightTeam].includes(snapshot.playerTeam.get(candidates[0])))return candidates[0];
 }
 // Phonetic match is a suggestion only if exactly one verified official
 // participant has this romanized reading and no stored alias conflicts.
 if(targets.size===0){
  const reading=phoneticRoman(raw);
  if(reading){
   const candidates=(snapshot.players||[]).filter(name=>normalize(name).replace(/[^a-z]/g,'')===reading);
   if(candidates.length===1&&snapshot.memberIds.has(candidates[0])&&
      [match.leftTeam,match.rightTeam].includes(snapshot.playerTeam.get(candidates[0])))return candidates[0];
  }
 }
 if(targets.size!==1)return null;
 for(const e of entries){
  if(!keys.includes(normalize(e.alias)))continue;
  const official=[...snapshot.memberIds.entries()].filter(([,id])=>String(id).toLowerCase()===String(e.member_id).toLowerCase());
  for(const [name] of official){
   if(!snapshot.players.includes(name))continue;
   const team=snapshot.playerTeam.get(name);
   if(!team||!match||![match.leftTeam,match.rightTeam].includes(team))continue;
   names.add(name);
  }
 }
 return names.size===1?[...names][0]:null;
}
