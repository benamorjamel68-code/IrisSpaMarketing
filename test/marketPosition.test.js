import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompetitorTable, METRICS } from '../src/marketPosition.js';
import { cohort, NOW } from './fixtures/cohort.js';

const build = (overrides = {}, opts = {}) => buildCompetitorTable({ ...cohort(), ...overrides }, { now: NOW, ...opts });

test('one row per business, prospect included, ranked by composite score', () => {
  const t = build();
  assert.equal(t.cohort_size, 7);
  assert.equal(t.competitor_count, 6);
  assert.equal(t.rows.filter((r) => r.is_prospect).length, 1);
  const ranks = t.rows.map((r) => r.rank);
  assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6, 7]);
  for (let i = 1; i < t.rows.length; i += 1) assert.ok(t.rows[i - 1].scores.composite >= t.rows[i].scores.composite);
  assert.equal(t.leader.business_name, 'Fixture Leader Spa');
  assert.equal(t.prospect.business_name, 'Fixture Prospect Spa');
  assert.equal(t.prospect_rank, t.prospect.rank);
  assert.deepEqual(t.columns.map((c) => c.key), METRICS.map((m) => m.key));
});

test('positions follow the reputation × visibility quadrants', () => {
  const t = build();
  const by = Object.fromEntries(t.rows.map((r) => [r.business_name, r]));
  assert.equal(by['Fixture Leader Spa'].position, 'leader');
  assert.equal(by['Fixture Big Chain'].position, 'challenger'); // most reviews/followers, low rating
  assert.equal(by['Fixture Boutique'].position, 'niche');       // 4.9★ but small
  assert.equal(by['Fixture Corner Spa'].position, 'laggard');
  for (const r of t.rows) {
    const { reputation, visibility } = r.scores;
    const expected = reputation >= 50 && visibility >= 50 ? 'leader' : visibility >= 50 ? 'challenger' : reputation >= 50 ? 'niche' : 'laggard';
    assert.equal(r.position, expected, r.business_name);
  }
});

test('a 5.0 rating from a handful of reviews does not beat a strong 4.8 from hundreds', () => {
  const base = cohort();
  base.competitors.push({ id: 'c7', business_name: 'Fixture Three Reviews', google_place_id: 'gp-c7', google_rating: 5, google_review_count: 3,
    distance_miles: 1, rank_score: 1, data_sources: { google_rating: base.competitors[0].data_sources.google_rating,
      google_review_count: base.competitors[0].data_sources.google_review_count, distance_miles: base.competitors[0].data_sources.distance_miles } });
  const t = buildCompetitorTable(base, { now: NOW });
  const by = Object.fromEntries(t.rows.map((r) => [r.business_name, r]));
  assert.ok(by['Fixture Leader Spa'].scores.reputation > by['Fixture Three Reviews'].scores.reputation);
});

test('unsourced numbers never reach the table', () => {
  const t = build();
  const corner = t.rows.find((r) => r.business_name === 'Fixture Corner Spa');
  assert.equal(corner.cells.tiktok_followers.value, null);           // 99999 with no source in the fixture
  assert.match(corner.cells.tiktok_followers.missing_reason, /no source/);
  assert.equal(corner.cells.instagram_followers.value, null);
  assert.equal(corner.cells.instagram_followers.missing_reason, 'no profile found');
  const json = JSON.stringify(t);
  assert.ok(!json.includes('99999'), 'unsourced value leaked into the table');
});

test('stale values are dropped with the reason', () => {
  const base = cohort();
  base.competitors[1].data_sources = { ...base.competitors[1].data_sources,
    google_rating: { source: 'google_places', url: 'https://maps.google.com/?cid=old', fetched_at: '2025-01-01T00:00:00Z' } };
  const t = buildCompetitorTable(base, { now: NOW, maxAgeDays: 90 });
  const chain = t.rows.find((r) => r.business_name === 'Fixture Big Chain');
  assert.equal(chain.cells.google_rating.value, null);
  assert.match(chain.cells.google_rating.missing_reason, /days old/);
  // A fresh review-analysis record wins over a stale Places value.
  const leader = t.rows.find((r) => r.business_name === 'Fixture Leader Spa');
  assert.equal(leader.cells.google_rating.value, 4.8);
});

test('every displayed value has at least one citation, and citations point to real sources', () => {
  const t = build();
  const ids = new Set(t.sources.map((s) => s.id));
  for (const r of t.rows) {
    for (const [key, cell] of Object.entries(r.cells)) {
      if (cell.value === null) continue;
      if (r.is_prospect && key === 'distance_miles') continue; // origin of the search
      assert.ok(cell.citations.length > 0, `${r.business_name}.${key} has no citation`);
      for (const c of cell.citations) assert.ok(ids.has(c));
    }
  }
  assert.ok(t.sources.every((s) => s.url && s.fetched_at));
});

test('share of local reviews sums to 100% and is derived from sourced counts', () => {
  const t = build();
  const total = t.rows.reduce((a, r) => a + (r.cells.review_share_pct.value || 0), 0);
  assert.ok(Math.abs(total - 100) < 1e-9);
  assert.equal(t.total_local_reviews, 120 + 900 + 1500 + 60 + 45 + 300 + 30);
});

test('total social followers only sums sourced platforms', () => {
  const base = cohort();
  base.socialProfiles.push({ prospect_id: 'p1', is_prospect: true, platform: 'tiktok', profile_found: true, followers: 500,
    data_sources: { followers: { source: 'apify', url: 'https://www.tiktok.com/@prospectspa', fetched_at: '2026-11-01T00:00:00Z' } } });
  base.socialProfiles.push({ prospect_id: 'p1', is_prospect: true, platform: 'facebook', profile_found: true, followers: 7777 });
  const t = buildCompetitorTable(base, { now: NOW });
  assert.equal(t.prospect.cells.total_social_followers.value, 2600);
});

test('competitors flagged out_of_radius and the prospect itself are excluded', () => {
  const base = cohort();
  base.competitors[1].out_of_radius = true;
  base.competitors.push({ ...base.competitors[0], id: 'dup', google_place_id: 'gp-p1', business_name: 'Prospect again' });
  const t = buildCompetitorTable(base, { now: NOW });
  assert.equal(t.competitor_count, 5);
  assert.ok(!t.rows.some((r) => r.business_name === 'Fixture Big Chain' || r.business_name === 'Prospect again'));
});

test('distance falls back to sourced coordinates', () => {
  const base = cohort();
  const c = base.competitors[0];
  delete c.distance_miles;
  c.latitude = 24.7236; c.longitude = 46.6853;
  const t = buildCompetitorTable(base, { now: NOW });
  const row = t.rows.find((r) => r.business_name === c.business_name);
  assert.ok(row.cells.distance_miles.value > 0.5 && row.cells.distance_miles.value < 1.2);
  assert.equal(row.cells.distance_miles.source, 'derived');
  assert.ok(row.cells.distance_miles.citations.length > 0);
});

test('handles a prospect with no competitors and no data', () => {
  const t = buildCompetitorTable({ prospect: { id: 'x', business_name: 'Lonely Spa' }, competitors: [] }, { now: NOW });
  assert.equal(t.cohort_size, 1);
  assert.equal(t.prospect.position, 'insufficient');
  assert.equal(t.prospect.rank, null);
  assert.deepEqual(t.sources, []);
  assert.throws(() => buildCompetitorTable({ prospect: {} }), /business_name/);
});

test('maxCompetitors keeps the strongest competitors', () => {
  const t = build({}, { maxCompetitors: 3 });
  assert.equal(t.competitor_count, 3);
  assert.deepEqual(t.rows.filter((r) => !r.is_prospect).map((r) => r.business_name).sort(),
    ['Fixture Big Chain', 'Fixture Leader Spa', 'Fixture Mall Spa']);
});

test('custom weights change the composite', () => {
  const a = build();
  const b = build({}, { weights: { reputation: 1, visibility: 0, engagement: 0 } });
  const boutiqueA = a.rows.find((r) => r.business_name === 'Fixture Boutique');
  const boutiqueB = b.rows.find((r) => r.business_name === 'Fixture Boutique');
  assert.equal(boutiqueB.scores.composite, boutiqueB.scores.reputation);
  assert.notEqual(boutiqueA.scores.composite, boutiqueB.scores.composite);
});
