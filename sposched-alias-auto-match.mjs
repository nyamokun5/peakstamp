// Read-only alias matching against the currently loaded official SS roster.
const normalize=value=>String(value??'').trim().normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).replace(/[\s　]/g,'');
export function matchOfficialAlias(raw,entries,snapshot,fixtureSeq){
 const key=normalize(raw);
 if(!key||!Array.isArray(entries)||!snapshot?.memberIds||!snapshot?.playerTeam)return null;
 const names=new Set();
 const match=snapshot.matches?.find(m=>Number(m.seq)===Number(fixtureSeq));
 if(!match)return null;
 // Prefer an exact official roster name over an alias; never create a duplicate alias.
 const direct=(snapshot.players||[]).filter(name=>normalize(name)===key&&
  [match.leftTeam,match.rightTeam].includes(snapshot.playerTeam.get(name)));
 if(direct.length===1)return direct[0];
 if(direct.length>1)return null;
 for(const e of entries){
  if(normalize(e.alias)!==key)continue;
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
