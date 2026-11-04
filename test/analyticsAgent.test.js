import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedNumbers, reviewsNeededForRating, runAnalysis, toBenchmarkRecords, verifyNarrativeNumbers } from '../src/analyticsAgent.js';
import { buildCompetitorTable } from '../src/marketPosition.js';
import { cohort, NOW } from './fixtures/cohort.js';

const table = () => buildCompetitorTable(cohort(), { now: NOW });

test('cohort statistics are computed from the table values', async () => {
  const a = await runAnalysis(table());
  const rating = a.metrics.find((m) => m.metric === 'google_rating');
  assert.equal(rating.status, 'ok');
  assert.equal(rating.prospect_value, 4.3);
  assert.equal(rating.competitors.n, 6);
  assert.equal(rating.competitors.median, 4.55);
  assert.equal(rating.best_competitor.business_name, 'Fixture Boutique');
  assert.equal(rating.severity, 'moderate');
  assert.ok(rating.citations.length >= 7);
  const followers = a.metrics.find((m) => m.metric === 'instagram_followers');
  assert.equal(followers.competitors.n, 5);
  assert.equal(followers.competitors.median, 9000);
  const fb = a.metrics.find((m) => m.metric === 'facebook_followers');
  assert.equal(fb.status, 'prospect_missing');
});

test('findings are ordered by severity and every finding is cited', async () => {
  const a = await runAnalysis(table());
  const order = { critical: 0, moderate: 1, on_par: 2, ahead: 3, leading: 4 };
  for (let i = 1; i < a.findings.length; i += 1) assert.ok(order[a.findings[i - 1].severity] <= order[a.findings[i].severity]);
  for (const f of a.findings) {
    assert.ok(f.citations.length > 0, f.id);
    assert.ok(f.headline && f.headline_ar && f.detail && f.detail_ar, f.id);
  }
  assert.ok(a.findings.some((f) => f.id === 'overall_position'));
  assert.ok(a.findings.some((f) => f.id === 'market_concentration'));
});

test('rating recovery: number of 5-star reviews needed', async () => {
  assert.equal(reviewsNeededForRating(4.3, 120, 4.6), 90); // 120×0.3/0.4
  assert.equal(reviewsNeededForRating(4.8, 10, 4.5), 0);
  assert.equal(reviewsNeededForRating(4.0, 10, 5), null);
  const a = await runAnalysis(table());
  const f = a.findings.find((x) => x.id === 'rating_recovery');
  assert.equal(f.reviews_needed, 90);
});

test('market concentration uses the HHI of review shares', async () => {
  const a = await runAnalysis(table());
  const shares = [120, 900, 1500, 60, 45, 300, 30].map((n) => n / 2955);
  const expected = Math.round(shares.reduce((acc, s) => acc + (s * 100) ** 2, 0));
  assert.equal(a.concentration.hhi, expected);
  assert.equal(a.concentration.level, 'highly_concentrated');
  assert.equal(a.concentration.top_business, 'Fixture Big Chain');
  assert.match(a.concentration.reference.url, /justice\.gov/);
});

test('relationships need at least 5 paired observations', async () => {
  const a = await runAnalysis(table());
  for (const r of a.relationships) assert.ok(r.n >= 5);
  const small = buildCompetitorTable({ ...cohort(), competitors: cohort().competitors.slice(0, 2) }, { now: NOW });
  const b = await runAnalysis(small);
  assert.deepEqual(b.relationships, []);
});

test('recommendations only target metrics where the prospect is behind', async () => {
  const a = await runAnalysis(table());
  assert.ok(a.recommendations.length > 0 && a.recommendations.length <= 5);
  for (const r of a.recommendations) {
    assert.ok(['high', 'medium'].includes(r.priority));
    assert.ok(r.title && r.title_ar && r.citations.length);
  }
});

test('data quality reports coverage and what is missing', async () => {
  const a = await runAnalysis(table());
  assert.ok(a.data_quality.coverage_pct > 0 && a.data_quality.coverage_pct < 100);
  assert.ok(['A', 'B', 'C', 'D'].includes(a.data_quality.grade));
  assert.ok(a.data_quality.not_collected_for_any_business.includes('facebook_followers'));
  const corner = a.data_quality.businesses.find((b) => b.business_name === 'Fixture Corner Spa');
  assert.ok(corner.missing.some((m) => m.metric === 'instagram_followers' && m.reason === 'no profile found'));
});

test('verifyNarrativeNumbers accepts numbers from the facts and rejects invented ones', () => {
  const facts = { rank: 6, of: 7, rating: 4.3, median: 4.55, followers: 2100, share: 4.06 };
  assert.ok(verifyNarrativeNumbers('Ranked 6 of 7, rating 4.3 vs 4.55, 2,100 followers, 4.1% share [3].', facts).ok);
  assert.ok(verifyNarrativeNumbers('المركز ٦ من ٧ والتقييم ٤٫٣', facts).ok, 'Arabic-Indic digits');
  const bad = verifyNarrativeNumbers('Competitors grow 37% faster and have 12,500 followers.', facts);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unverified, ['37', '12,500']);
  assert.ok(allowedNumbers(facts).has('2100'));
});

test('an LLM narrative is kept only when all of its numbers check out', async () => {
  const t = table();
  const honest = async () => `Fixture Prospect Spa ranks 6 of 7 with a 4.3 rating [12] against a median of 4.6 [1]. It has 2,100 Instagram followers [14].`;
  const a = await runAnalysis(t, { llm: honest });
  assert.equal(a.narrative_source, 'llm_verified');
  assert.match(a.narrative, /ranks 6 of 7/);

  const hallucinating = async () => 'Fixture Prospect Spa loses an estimated 230 clients a month and revenue is down 18%.';
  const b = await runAnalysis(t, { llm: hallucinating });
  assert.equal(b.narrative_source, 'deterministic_fallback');
  assert.deepEqual(b.narrative_check.unverified, ['230', '18']);
  assert.ok(!b.narrative.includes('230'));

  const broken = async () => { throw new Error('LLM down'); };
  const c = await runAnalysis(t, { llm: broken });
  assert.equal(c.narrative_source, 'deterministic_fallback');
  assert.match(c.narrative_check.error, /LLM down/);

  let prompt = '';
  await runAnalysis(t, { llm: async (p) => { prompt = p; return ''; } });
  assert.match(prompt, /Use ONLY the facts/);
  assert.match(prompt, /Fixture Prospect Spa/);
});

test('deterministic narrative in Arabic', async () => {
  const a = await runAnalysis(table(), { lang: 'ar' });
  assert.equal(a.language, 'ar');
  assert.match(a.narrative, /يحتل Fixture Prospect Spa المركز 6 من أصل 7/);
  assert.ok(a.methodology_ar.reputation);
});

test('benchmark records match the Base44 Benchmark entity', async () => {
  const a = await runAnalysis(table());
  const rows = toBenchmarkRecords('p1', a.metrics);
  assert.ok(rows.length >= 5);
  const allowed = ['critical', 'moderate', 'on_par', 'ahead', 'leading'];
  for (const r of rows) {
    assert.equal(r.prospect_id, 'p1');
    assert.ok(allowed.includes(r.gap_severity));
    assert.equal(typeof r.prospect_value, 'number');
    assert.match(r.gap_description, /sources \[\d+\]/);
  }
});
