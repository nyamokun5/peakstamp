/**
 * Low-cost acoustic descriptors collected while decoding the original audio.
 * No machine learning, network request, or second video/audio decoding pass.
 * The broad "bands" are approximated by inexpensive one-pole filters, not FFT.
 */
export function createAudioBinCollector(binSeconds = 0.25) {
  const energy = [], counts = [], lowEnergy = [], midEnergy = [],
    highEnergy = [], bandCounts = [], peak = [];
  let low=0, upper=0, rate=0, filterStride=0, alphaLow=0, alphaUpper=0;
  let lastTime=-Infinity, sampleCounter=0;

  function push(time, rmsSquared, sampleValue, sampleRate, sourceStride = 4) {
    if (!Number.isFinite(time) || time < 0) return;
    const index=Math.floor(time/binSeconds);
    const power=Number.isFinite(rmsSquared) ? Math.max(0,rmsSquared) : 0;
    energy[index]=(energy[index]||0)+power;
    counts[index]=(counts[index]||0)+1;
    peak[index]=Math.max(peak[index]||0,Math.sqrt(power));

    // Use every second RMS sample for low-cost broad spectral descriptors.
    if (sampleCounter++%2!==0 || !Number.isFinite(sampleValue)) return;
    if (sampleRate!==rate || sourceStride!==filterStride) {
      rate=sampleRate;
      filterStride=sourceStride;
      const seconds=sourceStride*2/Math.max(1,sampleRate);
      alphaLow=1-Math.exp(-2*Math.PI*180*seconds);
      alphaUpper=1-Math.exp(-2*Math.PI*1350*seconds);
    }
    if (time-lastTime>0.12) low=upper=0;
    lastTime=time;
    low+=alphaLow*(sampleValue-low);
    upper+=alphaUpper*(sampleValue-upper);
    const l=low, m=upper-low, h=sampleValue-upper;
    lowEnergy[index]=(lowEnergy[index]||0)+l*l;
    midEnergy[index]=(midEnergy[index]||0)+m*m;
    highEnergy[index]=(highEnergy[index]||0)+h*h;
    bandCounts[index]=(bandCounts[index]||0)+1;
  }

  function finish(duration) {
    const length=Math.max(0,Math.ceil(duration/binSeconds));
    return Array.from({length},(_,index)=>{
      const rms=Math.sqrt((energy[index]||0)/Math.max(1,counts[index]||0));
      const total=(lowEnergy[index]||0)+(midEnergy[index]||0)+(highEnergy[index]||0);
      // Missing bands are intentionally omitted for backward compatibility.
      return {
        time:index*binSeconds,
        rms,
        ...(bandCounts[index] && total>1e-12 ? {
          lowRatio:(lowEnergy[index]||0)/total,
          highRatio:(highEnergy[index]||0)/total,
        } : {}),
        crest:rms>1e-8 ? Math.min(12,(peak[index]||0)/rms) : 0,
      };
    });
  }
  return {push,finish};
}
