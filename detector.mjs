/**
 * PeakStamp audio highlight detector.
 * Bin = {time, rms}, default spacing 0.25 seconds.
 * This detects volume surges; it DOES NOT semantically detect goals.
 */
export function detectHighlights(bins, options = {}) {
  const { sensitivity = 'normal', leadSeconds = 7, maxResults = 8,
    minGapSeconds = 18, binSeconds = 0.25 } = options;
  if (!Array.isArray(bins) || bins.length === 0) return [];
  const profile = {
    sensitive: { threshold: 0.34, minDb: -37 },
    normal: { threshold: 0.48, minDb: -33 },
    strict: { threshold: 0.65, minDb: -28 },
  }[sensitivity] ?? { threshold: 0.48, minDb: -33 };

  const n = bins.length;
  const smooth = Array(n).fill(0);
  const energies = bins.map(b => Math.pow(Math.max(0, Number(b.rms) || 0), 2));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + energies[i];
  const smoothSize = Math.max(1, Math.round(1 / binSeconds));
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - smoothSize + 1);
    smooth[i] = Math.sqrt((prefix[i + 1] - prefix[a]) / (i + 1 - a));
  }
  const sorted = [...smooth].sort((a,b)=>a-b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)] || 0;
  const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] || 1e-7;
  const scale = Math.max(0.0001, p95 - median);
  const lookback = Math.max(1, Math.round(10 / binSeconds));
  const events = [];

  for (let i = smoothSize; i < n - smoothSize; i++) {
    const value = smooth[i];
    const db = 20 * Math.log10(Math.max(1e-8, value));
    if (db < profile.minDb) continue;
    const b0 = Math.max(0, i - lookback);
    const b1 = Math.max(b0 + 1, i - smoothSize);
    const baseline = Math.sqrt((prefix[b1] - prefix[b0]) / (b1 - b0));
    const contrast = value / Math.max(0.003, baseline);
    const prominence = (value - median) / scale;
    const localWindow = Math.max(1, Math.round(2 / binSeconds));
    let isPeak = true;
    for (let j = Math.max(0, i - localWindow); j <= Math.min(n - 1, i + localWindow); j++) {
      if (smooth[j] > value + 1e-10 || (j < i && Math.abs(smooth[j] - value) < 1e-10)) {
        isPeak = false; break;
      }
    }
    if (!isPeak) continue;
    const score = (Math.min(1.6, Math.max(0, prominence)) * 0.43) +
      (Math.min(3, Math.max(0, contrast - 1)) / 3 * 0.42) +
      (Math.min(1, Math.max(0, (db + 40) / 30)) * 0.15);
    if (score < profile.threshold) continue;
    events.push({ peakSeconds: Math.max(0, bins[i].time), score: +score.toFixed(3), db: +db.toFixed(1) });
  }

  events.sort((a,b) => b.score - a.score);
  const selected = [];
  for (const event of events) {
    if (selected.length >= maxResults) break;
    if (selected.some(s => Math.abs(s.peakSeconds - event.peakSeconds) < minGapSeconds)) continue;
    selected.push({
      ...event,
      time: Math.max(0, Math.floor(event.peakSeconds - leadSeconds)),
      id: 'peak-' + Math.round(event.peakSeconds * 1000),
      enabled: false,
      title: '🔥 盛り上がりシーン',
    });
  }
  return selected.sort((a,b)=>a.time-b.time);
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  return h ? h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') : String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

export function makeComment(items, heading = '⚽ Shoot Sunday Highlights') {
  const lines = items.filter(item => item.enabled).sort((a,b)=>a.time-b.time)
    .map(item => formatTime(item.time) + ' ' + (item.title.trim() || '🔥 盛り上がりシーン'));
  return lines.length ? heading + '\n' + lines.join('\n') : '';
}
