export function mergeIntervals(intervals, epsilon = .003) {
  const sorted = intervals
    .map(([start, end]) => [clamp01(Math.min(start, end)), clamp01(Math.max(start, end))])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (!last || interval[0] > last[1] + epsilon) merged.push([...interval]);
    else last[1] = Math.max(last[1], interval[1]);
  }
  return merged;
}

export function subtractCoverage(target, covered, minimumGap = .012) {
  const [targetStart, targetEnd] = [clamp01(Math.min(...target)), clamp01(Math.max(...target))];
  let remaining = [[targetStart, targetEnd]];
  for (const [coveredStart, coveredEnd] of mergeIntervals(covered)) {
    remaining = remaining.flatMap(([start, end]) => {
      if (coveredEnd <= start || coveredStart >= end) return [[start, end]];
      const pieces = [];
      if (coveredStart - start >= minimumGap) pieces.push([start, Math.min(end, coveredStart)]);
      if (end - coveredEnd >= minimumGap) pieces.push([Math.max(start, coveredEnd), end]);
      return pieces;
    });
  }
  return mergeIntervals(remaining).filter(([start, end]) => end - start >= minimumGap);
}

export function intervalLength(intervals) {
  return mergeIntervals(intervals).reduce((sum, [start, end]) => sum + end - start, 0);
}

export function subtractIntervals(source, removed) {
  return mergeIntervals(source.flatMap((interval) => subtractCoverage(interval, removed, 0)));
}

export function synchronizedAnimationDelay(now, cycleMs) {
  const cycle = Number(cycleMs);
  if (!Number.isFinite(cycle) || cycle <= 0) return 0;
  const time = Number.isFinite(Number(now)) ? Number(now) : 0;
  const phase = ((time % cycle) + cycle) % cycle;
  return phase === 0 ? 0 : -phase;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}
