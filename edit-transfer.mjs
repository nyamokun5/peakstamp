/**
 * Versioned PeakStamp -> Shoot Sunday Highlight Studio edit-only interchange.
 * Video/audio bytes and detection data never leave the device.
 * This exports FINAL clip boundaries, not the settings used to calculate them.
 */
export const EDIT_TRANSFER_KIND = 'peakstamp-edit-transfer';
export const EDIT_TRANSFER_VERSION = 1;

export function createEditTransfer(sources, plan, createdAt = new Date().toISOString()) {
  if (!Array.isArray(sources) || !Array.isArray(plan) || !plan.length)
    throw new Error('キープしたシーンがありません。');
  if (plan.length > 200) throw new Error('一度に出力できるシーンは200件までです。');
  const included = new Set(plan.map(clip => clip.sourceId));
  const keys = new Map();
  const exportedSources = [];
  for (const source of sources) {
    if (!included.has(source.id)) continue;
    const {file, duration} = source;
    if (!file || typeof file.name !== 'string' || !Number.isSafeInteger(file.size) ||
        file.size <= 0 || !Number.isFinite(duration) || duration <= 0)
      throw new Error('元動画の情報が不足しています。');
    const key = 'src-' + exportedSources.length;
    keys.set(source.id, key);
    exportedSources.push({
      key, name:file.name, size:file.size, duration,
      lastModified:Number.isFinite(Number(file.lastModified)) ? Number(file.lastModified) : null
    });
  }
  if (included.size !== keys.size) throw new Error('クリップの元動画が見つかりません。');
  const clips = plan.map(clip => {
    const source = sources.find(s => s.id === clip.sourceId);
    if (!source || !Number.isFinite(clip.start) || !Number.isFinite(clip.end) ||
        clip.start < 0 || clip.end - clip.start < .3 || clip.end > source.duration + .01)
      throw new Error('クリップの開始・終了時刻が不正です。');
    const zoom = Number(clip.zoom ?? 1);
    if (!Number.isFinite(zoom) || zoom < 1 || zoom > 3)
      throw new Error('ズーム値が不正です。');
    const focusX = Number(clip.zoomX ?? .5), focusY = Number(clip.zoomY ?? .5);
    if (![focusX,focusY].every(v => Number.isFinite(v) && v >= 0 && v <= 1))
      throw new Error('画角の中心位置が不正です。');
    const nearest = (source.candidates || []).filter(c => c.enabled === true)
      .sort((a,b) => Math.abs(a.time - clip.start) - Math.abs(b.time - clip.start))[0];
    return {
      sourceKey:keys.get(clip.sourceId), start:clip.start, end:clip.end,
      zoom, zoomX:focusX, zoomY:focusY,
      title:typeof nearest?.title === 'string' ? nearest.title.slice(0,100) : 'ナイスプレイ！'
    };
  });
  return {kind:EDIT_TRANSFER_KIND,version:EDIT_TRANSFER_VERSION,createdAt,
    sources:exportedSources,clips};
}
