import { buildClipPlan, INTRO_SECONDS } from './exporter.mjs';

/**
 * Produce non-overlapping clips, in user-controlled file order.
 * Candidate times are always LOCAL to their source file.
 */
export function buildMultiClipPlan(sources, clipSeconds = 16) {
  const plan = [];
  for (const source of sources || []) {
    if (!source?.file || !source?.bins || !Number.isFinite(source.duration)) continue;
    const spans = buildClipPlan(source.candidates || [], source.duration, clipSeconds);
    for (const span of spans) {
      plan.push({ sourceId: source.id, sourceName: source.file.name,
        start: span.start, end: span.end });
    }
  }
  return plan;
}

/** Timestamps refer to the generated montage, not the original videos. */
export function montageChapters(plan, title = 'GOALS!', fps = 30) {
  if (!plan?.length) return '';
  const format = s => {
    const n = Math.floor(Math.max(0, s));
    const hh = Math.floor(n / 3600), mm = Math.floor(n % 3600 / 60), ss = n % 60;
    return hh ? [hh, mm, ss].map(x => String(x).padStart(2, '0')).join(':')
      : [mm, ss].map(x => String(x).padStart(2, '0')).join(':');
  };
  let at = 0;
  const lines = ['0:00 ' + (title || 'GOALS!').trim()];
  at += INTRO_SECONDS;
  let i = 0;
  for (const clip of plan) {
    const label = clip.sourceName || 'Video';
    lines.push(format(at) + ' Highlight ' + (++i) + ' — ' + label);
    at += Math.ceil((clip.end - clip.start) * fps) / fps;
  }
  return lines.join('\n');
}
