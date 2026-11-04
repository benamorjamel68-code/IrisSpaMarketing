// Small, dependency-free statistics helpers used by the market-position table
// and the analytical agent. All functions ignore null/undefined/NaN inputs.

export function clean(values) {
  return (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
}

export function sum(values) {
  return clean(values).reduce((a, b) => a + b, 0);
}

export function mean(values) {
  const v = clean(values);
  return v.length ? sum(v) / v.length : null;
}

/** Linear-interpolated quantile (same method as Excel PERCENTILE.INC / numpy default). */
export function quantile(values, q) {
  const v = clean(values).sort((a, b) => a - b);
  if (!v.length) return null;
  if (v.length === 1) return v[0];
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function median(values) {
  return quantile(values, 0.5);
}

/** Sample standard deviation (n − 1). */
export function stdev(values) {
  const v = clean(values);
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((acc, x) => acc + (x - m) ** 2, 0) / (v.length - 1));
}

export function min(values) {
  const v = clean(values);
  return v.length ? Math.min(...v) : null;
}

export function max(values) {
  const v = clean(values);
  return v.length ? Math.max(...v) : null;
}

/**
 * Percentile rank of x within values (0–100), counting ties as half.
 * With a cohort of one, x is at the 50th percentile.
 */
export function percentileRank(values, x) {
  const v = clean(values);
  if (!v.length || typeof x !== 'number' || !Number.isFinite(x)) return null;
  let below = 0;
  let equal = 0;
  for (const y of v) {
    if (y < x) below += 1;
    else if (y === x) equal += 1;
  }
  return ((below + 0.5 * equal) / v.length) * 100;
}

export function zScore(values, x) {
  const s = stdev(values);
  const m = mean(values);
  if (s === null || s === 0 || m === null || typeof x !== 'number') return null;
  return (x - m) / s;
}

/**
 * Bayesian average rating: shrinks ratings with few reviews toward the cohort
 * mean, so a 5.0 from 3 reviews does not outrank a 4.7 from 900 reviews.
 * score = (C·m + n·r) / (C + n)
 */
export function bayesianRating(rating, reviewCount, priorMean, priorWeight) {
  if (typeof rating !== 'number' || !Number.isFinite(rating)) return null;
  const n = typeof reviewCount === 'number' && reviewCount > 0 ? reviewCount : 0;
  if (typeof priorMean !== 'number' || !Number.isFinite(priorMean)) return rating;
  const c = Math.max(0, priorWeight || 0);
  if (c + n === 0) return rating;
  return (c * priorMean + n * rating) / (c + n);
}

/** Herfindahl–Hirschman Index on shares expressed as fractions (0–1). Returns 0–10,000. */
export function hhi(shares) {
  return clean(shares).reduce((acc, s) => acc + (s * 100) ** 2, 0);
}

/** Pearson correlation coefficient of paired samples (pairs with a missing side are dropped). */
export function pearson(xs, ys) {
  const pairs = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
    const x = xs[i];
    const y = ys[i];
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) pairs.push([x, y]);
  }
  if (pairs.length < 3) return null;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export function round(x, digits = 0) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** Great-circle distance in miles. */
export function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.7613;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function describe(values) {
  const v = clean(values);
  return {
    n: v.length,
    mean: mean(v),
    median: median(v),
    p25: quantile(v, 0.25),
    p75: quantile(v, 0.75),
    min: min(v),
    max: max(v),
    stdev: stdev(v),
  };
}
