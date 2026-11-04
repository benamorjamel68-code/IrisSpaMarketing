import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../src/stats.js';

test('descriptive statistics ignore missing values', () => {
  const v = [1, 2, null, 3, 4, undefined, NaN];
  assert.equal(s.mean(v), 2.5);
  assert.equal(s.median(v), 2.5);
  assert.equal(s.quantile(v, 0.25), 1.75);
  assert.equal(s.round(s.stdev(v), 4), 1.291);
  assert.equal(s.min(v), 1);
  assert.equal(s.max(v), 4);
  assert.equal(s.mean([]), null);
  assert.equal(s.stdev([5]), null);
  assert.deepEqual(s.describe([2]), { n: 1, mean: 2, median: 2, p25: 2, p75: 2, min: 2, max: 2, stdev: null });
});

test('percentileRank counts ties as half', () => {
  assert.equal(s.percentileRank([1, 2, 3, 4], 4), 87.5);
  assert.equal(s.percentileRank([1, 2, 3, 4], 1), 12.5);
  assert.equal(s.percentileRank([5, 5], 5), 50);
  assert.equal(s.percentileRank([7], 7), 50);
  assert.equal(s.percentileRank([], 1), null);
});

test('bayesianRating shrinks small samples toward the prior', () => {
  const few = s.bayesianRating(5, 3, 4.4, 50);
  const many = s.bayesianRating(4.7, 900, 4.4, 50);
  assert.ok(many > few, 'a 4.7 from 900 reviews should outrank a 5.0 from 3');
  assert.equal(s.bayesianRating(4.2, 0, 4.4, 0), 4.2);
  assert.equal(s.bayesianRating(null, 10, 4, 10), null);
});

test('hhi, pearson, zScore, haversine', () => {
  assert.equal(s.hhi([1]), 10000);
  assert.equal(s.hhi([0.5, 0.5]), 5000);
  assert.equal(s.round(s.pearson([1, 2, 3, 4], [2, 4, 6, 8]), 6), 1);
  assert.equal(s.round(s.pearson([1, 2, 3, 4], [8, 6, 4, 2]), 6), -1);
  assert.equal(s.pearson([1, 2], [1, 2]), null);
  assert.equal(s.pearson([1, 1, 1], [1, 2, 3]), null);
  assert.equal(s.zScore([1, 1, 1], 1), null);
  // Riyadh (Kingdom Centre) to Al Faisaliah Tower ≈ 1.6 mi
  const d = s.haversineMiles(24.7114, 46.6744, 24.6905, 46.6853);
  assert.ok(d > 1.4 && d < 1.8, String(d));
});
