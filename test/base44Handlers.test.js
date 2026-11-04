import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleGenerateCompetitivePosition, handleRefreshMarketData, HttpError, toRequestHandler } from '../src/base44Handlers.js';
import { cohort, NOW } from './fixtures/cohort.js';
import { fakeBase44 } from './fixtures/fakeBase44.js';

function seeded(extra = {}) {
  const c = cohort();
  return {
    Prospect: [{ ...c.prospect, report_language: 'both', agent_log: [] }],
    Competitor: c.competitors,
    SocialProfile: c.socialProfiles.map((p, i) => ({ id: `sp${i}`, ...p })),
    ReviewData: c.reviews.map((r, i) => ({ id: `rd${i}`, ...r })),
    AgencySettings: [{ id: 's1', agency_name: 'OnSocial', brand_color: '#123456', api_keys: {} }],
    Report: [{ id: 'r-en', prospect_id: 'p1', language: 'en', title: 'Existing report', executive_summary: 'keep me' }],
    Benchmark: [{ id: 'b-old', prospect_id: 'p1', metric_name: 'stale' }],
    ...extra,
  };
}

test('generateCompetitivePosition writes paired EN/AR reports, benchmarks and competitor positions', async () => {
  const b = fakeBase44(seeded());
  const out = await handleGenerateCompetitivePosition(b, { prospect_id: 'p1', use_llm: false }, { now: NOW });
  assert.equal(out.rank, 6);
  assert.equal(out.ranked_count, 7);
  assert.deepEqual(Object.keys(out.report_ids).sort(), ['ar', 'en']);
  assert.equal(out.report_ids.en, 'r-en', 'existing English report is updated, not duplicated');

  const reports = b.table('Report');
  assert.equal(reports.length, 2);
  const en = reports.find((r) => r.language === 'en');
  const ar = reports.find((r) => r.language === 'ar');
  assert.equal(en.executive_summary, 'keep me', 'unrelated fields are preserved');
  assert.equal(en.paired_report_id, ar.id);
  assert.equal(ar.paired_report_id, en.id);
  assert.equal(en.competitor_table.rows.length, 7);
  assert.equal(en.market_rank, 6);
  assert.equal(en.competitor_count, 6);
  assert.ok(en.key_weaknesses.length > 0);
  assert.equal(ar.analytical_report.language, 'ar');
  assert.ok(en.data_sources.length > 0);

  const bench = b.table('Benchmark');
  assert.ok(!bench.some((x) => x.id === 'b-old'), 'old benchmarks are replaced');
  assert.ok(bench.length >= 5);

  const leader = b.table('Competitor').find((c) => c.business_name === 'Fixture Leader Spa');
  assert.equal(leader.market_position, 'leader');
  assert.equal(leader.market_rank, 1);
  const log = b.table('Prospect')[0].agent_log;
  assert.equal(log.at(-1).agent, 'Analytical Agent');
  assert.match(log.at(-1).message, /Ranked #6 of 7/);
});

test('generateCompetitivePosition uses InvokeLLM and keeps only verified narratives', async () => {
  const good = fakeBase44(seeded(), { llm: () => 'Fixture Prospect Spa ranks 6 of 7 [12].' });
  const out = await handleGenerateCompetitivePosition(good, { prospect_id: 'p1', languages: ['en'] }, { now: NOW });
  assert.deepEqual(out.narrative_source, { en: 'llm_verified' });
  assert.equal(good.llmCalls.length, 1);
  assert.match(good.llmCalls[0].prompt, /Use ONLY the facts/);

  const bad = fakeBase44(seeded(), { llm: () => 'Revenue is down 42%.' });
  const out2 = await handleGenerateCompetitivePosition(bad, { prospect_id: 'p1', languages: ['en'] }, { now: NOW });
  assert.deepEqual(out2.narrative_source, { en: 'deterministic_fallback' });
  assert.ok(!bad.table('Report')[0].analytical_summary.includes('42'));
});

test('handlers reject anonymous callers and unknown prospects', async () => {
  await assert.rejects(handleGenerateCompetitivePosition(fakeBase44(seeded(), { user: null }), { prospect_id: 'p1' }),
    (e) => e instanceof HttpError && e.status === 401);
  await assert.rejects(handleGenerateCompetitivePosition(fakeBase44(seeded()), {}), (e) => e.status === 400);
  await assert.rejects(handleGenerateCompetitivePosition(fakeBase44(seeded()), { prospect_id: 'nope' }), (e) => e.status === 404);
});

function placesAndGraphFetch() {
  const place = (id, name, lat, lng, rating, count) => ({ id, displayName: { text: name }, location: { latitude: lat, longitude: lng },
    rating, userRatingCount: count, primaryType: 'spa', googleMapsUri: `https://maps.google.com/?cid=${id}`, businessStatus: 'OPERATIONAL' });
  return async (url) => {
    let json;
    if (url.endsWith(':searchText')) json = { places: [place('gp-p1', 'Fixture Prospect Spa', 24.7136, 46.6753, 4.35, 131)] };
    else if (url.endsWith(':searchNearby')) json = { places: [place('gp-c1', 'Fixture Leader Spa', 24.72, 46.68, 4.8, 950), place('gp-new', 'Brand New Spa', 24.70, 46.67, 4.7, 40)] };
    else if (url.startsWith('https://graph.facebook.com/')) {
      json = /username\(leaderspa\)/.test(decodeURIComponent(url))
        ? { business_discovery: { username: 'leaderspa', followers_count: 18500, media_count: 400,
          media: { data: [{ like_count: 500, comments_count: 20, timestamp: '2026-10-20T00:00:00Z' }, { like_count: 400, comments_count: 10, timestamp: '2026-10-27T00:00:00Z' }] } } }
        : null;
      if (!json) return { ok: false, status: 400, json: async () => ({ error: { code: 110, message: 'Invalid user id' } }) };
    }
    return { ok: true, status: 200, json: async () => json };
  };
}

test('refreshMarketData stores live Places + Instagram numbers with provenance', async () => {
  const s = seeded();
  s.AgencySettings[0].api_keys = { google_maps: 'K', meta_graph: 'T', meta_ig_user_id: '1784' };
  const b = fakeBase44(s);
  const out = await handleRefreshMarketData(b, { prospect_id: 'p1' }, { fetchImpl: placesAndGraphFetch(), now: NOW });
  assert.equal(out.prospect_updated, true);
  assert.equal(out.competitors_updated, 1);
  assert.equal(out.competitors_created, 1);
  assert.equal(out.competitors_out_of_radius, 5);
  assert.ok(out.instagram_updated >= 1);

  const prospect = b.table('Prospect')[0];
  assert.equal(prospect.google_review_count, 131);
  assert.equal(prospect.business_name, 'Fixture Prospect Spa');
  assert.equal(prospect.data_sources.google_review_count.fetched_at, NOW);
  const leader = b.table('Competitor').find((c) => c.google_place_id === 'gp-c1');
  assert.equal(leader.google_review_count, 950);
  assert.equal(leader.out_of_radius, false);
  assert.ok(b.table('Competitor').find((c) => c.google_place_id === 'gp-c2').out_of_radius);
  const ig = b.table('SocialProfile').find((p) => p.handle === 'leaderspa');
  assert.equal(ig.followers, 18500);
  assert.equal(ig.data_sources.followers.source, 'meta_graph');

  // And the next analysis uses the refreshed set only.
  const gen = await handleGenerateCompetitivePosition(b, { prospect_id: 'p1', use_llm: false, languages: ['en'] }, { now: NOW });
  assert.equal(gen.ranked_count, 3);
});

test('refreshMarketData explains what it skipped when keys are missing', async () => {
  const b = fakeBase44(seeded());
  const out = await handleRefreshMarketData(b, { prospect_id: 'p1' }, { fetchImpl: async () => { throw new Error('should not fetch'); }, now: NOW });
  assert.equal(out.skipped.length, 2);
  assert.match(out.skipped.join(' '), /Google Places: no API key/);
  assert.match(b.table('Prospect')[0].agent_log.at(-1).message, /Skipped/);
});

test('toRequestHandler returns JSON with the right status codes', async () => {
  const ok = toRequestHandler(async (_b, body) => ({ echo: body.x }), () => ({}));
  const res = await ok(new Request('https://x/fn', { method: 'POST', body: JSON.stringify({ x: 1 }) }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { echo: 1 });
  const denied = toRequestHandler(async () => { throw new HttpError(401, 'Sign in required'); }, () => ({}));
  const r2 = await denied(new Request('https://x/fn', { method: 'POST', body: '{}' }));
  assert.equal(r2.status, 401);
  const boom = toRequestHandler(async () => { throw new Error('kaboom'); }, () => ({}));
  const r3 = await boom(new Request('https://x/fn', { method: 'POST', body: 'not json' }));
  assert.equal(r3.status, 500);
  assert.match((await r3.json()).error, /kaboom/);
});
