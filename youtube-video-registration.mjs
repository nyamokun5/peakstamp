// Pure TEST video registration planner. No network calls or side effects.
// A caller must resolve event/match IDs and verify slot metadata before writes.
export function canonicalVideoUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
    if (host === 'youtu.be' || host === 'youtube.com') {
      const id = host === 'youtu.be' ? u.pathname.slice(1) :
        u.pathname === '/watch' ? u.searchParams.get('v') :
        u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)$/)?.[1];
      if (/^[\w-]{11}$/.test(id || '')) return 'https://www.youtube.com/watch?v=' + id;
    }
    u.hash = '';
    return u.href;
  } catch { return ''; }
}
export function planVideoRegistration(requests, slots) {
  if (!Array.isArray(requests) || !Array.isArray(slots)) throw Error('Invalid registration inputs');
  const used = new Set();
  return requests.map(request => {
    const base = {source: request.source, target: request.target, url: request.url};
    const desired = canonicalVideoUrl(request.url);
    if (!desired) return {...base, status:'invalid_url'};
    const matches = slots.filter(slot =>
      slot.eventId === request.eventId &&
      slot.kind === request.kind &&
      (request.kind === 'goal_collection' ||
        (slot.matchId && slot.matchId === request.matchId)));
    if (matches.length !== 1) return {...base, status: matches.length ? 'ambiguous' : 'missing_slot'};
    const slot = matches[0];
    if (!slot.id || used.has(slot.id)) return {...base, status:'ambiguous'};
    used.add(slot.id);
    const current = slot.url ? canonicalVideoUrl(slot.url) : '';
    if (slot.url && !current) return {...base, slotId:slot.id, status:'conflict'};
    if (current === desired) return {...base, slotId:slot.id, status:'already_registered'};
    if (current) return {...base, slotId:slot.id, existingUrl:slot.url, status:'conflict'};
    return {...base, slotId:slot.id, status:'ready'};
  });
}


// The app label includes a date suffix; the events API returns date and name separately.
// Keep the approved date mandatory and let the caller reject zero or multiple matches.
export function registrationEvents(events,date,demo=false){
 const normalize=value=>String(value||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
 return events.filter(event=>event.date===date && (!demo ||
  ['日曜定期','日曜定期(10nov)'].includes(normalize(event.name))));
}
