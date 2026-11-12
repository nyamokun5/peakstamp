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
