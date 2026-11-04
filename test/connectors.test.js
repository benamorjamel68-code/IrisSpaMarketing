import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCompetitors, findProspect, PlacesApiError, SEARCH_FIELD_MASK } from '../src/connectors/googlePlaces.js';
import { fetchInstagramProfile, GraphApiError, instagramHandle, postsPerWeek } from '../src/connectors/metaGraph.js';
import { buildCompetitorTable } from '../src/marketPosition.js';

const NOW = '2026-11-04T10:00:00.000Z';

function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const { status = 200, json } = await handler(url, init, calls.length);
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
}

const place = (id, name, lat, lng, rating, count, extra = {}) => ({
  id, displayName: { text: name }, formattedAddress: `${name}, Riyadh`, location: { latitude: lat, longitude: lng },
  rating, userRatingCount: count, primaryType: 'spa', googleMapsUri: `https://maps.google.com/?cid=${id}`,
  businessStatus: 'OPERATIONAL', ...extra,
});

test('findProspect calls Places Text Search with key + field mask and maps provenance', async () => {
  const f = mockFetch(() => ({ json: { places: [place('P', 'Real Spa', 24.71, 46.67, 4.4, 210)] } }));
  const p = await findProspect({ query: 'Real Spa, Riyadh', apiKey: 'KEY', fetchImpl: f, now: NOW });
  assert.equal(f.calls[0].url, 'https://places.googleapis.com/v1/places:searchText');
  assert.equal(f.calls[0].init.headers['X-Goog-Api-Key'], 'KEY');
  assert.equal(f.calls[0].init.headers['X-Goog-FieldMask'], SEARCH_FIELD_MASK);
  assert.equal(f.calls[0].body.textQuery, 'Real Spa, Riyadh');
  assert.equal(f.calls[0].body.regionCode, 'SA');
  assert.equal(p.business_name, 'Real Spa');
  assert.equal(p.google_review_count, 210);
  assert.deepEqual(p.data_sources.google_rating, { source: 'google_places', url: 'https://maps.google.com/?cid=P', fetched_at: NOW });
});

test('findProspect returns null with no match and throws on API errors / missing key', async () => {
  assert.equal(await findProspect({ query: 'x', apiKey: 'K', fetchImpl: mockFetch(() => ({ json: {} })) }), null);
  await assert.rejects(findProspect({ query: 'x', apiKey: 'K', fetchImpl: mockFetch(() => ({ status: 403, json: { error: { message: 'API key not valid' } } })) }),
    (e) => e instanceof PlacesApiError && e.status === 403 && /API key not valid/.test(e.message));
  await assert.rejects(findProspect({ query: 'x', apiKey: '', fetchImpl: mockFetch(() => ({ json: {} })) }), /key is missing/);
});

test('findCompetitors searches each type in a 5-mile circle, dedupes and filters', async () => {
  const prospect = { google_place_id: 'P', latitude: 24.7136, longitude: 46.6753, category: 'spa' };
  const f = mockFetch((url, init, n) => ({ json: { places: n === 1
    ? [place('P', 'Self', 24.7136, 46.6753, 4.4, 210), place('A', 'Spa A', 24.72, 46.68, 4.8, 900),
      place('B', 'Spa B', 24.70, 46.66, 4.1, 50), place('Z', 'Closed Spa', 24.71, 46.67, 5, 10, { businessStatus: 'CLOSED_PERMANENTLY' })]
    : [place('A', 'Spa A', 24.72, 46.68, 4.8, 900), place('C', 'Massage C', 24.73, 46.69, 4.6, 120),
      place('FAR', 'Far Spa', 25.2, 46.6, 4.9, 999)] } }));
  const list = await findCompetitors({ prospect, apiKey: 'K', includedTypes: ['spa', 'massage'], fetchImpl: f, now: NOW });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, 'https://places.googleapis.com/v1/places:searchNearby');
  assert.deepEqual(f.calls[0].body.includedTypes, ['spa']);
  assert.equal(f.calls[0].body.maxResultCount, 20);
  assert.equal(Math.round(f.calls[0].body.locationRestriction.circle.radius), 8047);
  assert.deepEqual(list.map((c) => c.google_place_id), ['A', 'C', 'B']); // sorted by rank score; self, closed, far removed
  for (const c of list) {
    assert.ok(c.distance_miles <= 5);
    assert.equal(c.data_sources.distance_miles.source, 'google_places');
  }
  await assert.rejects(findCompetitors({ prospect: {}, apiKey: 'K', fetchImpl: f }), /no coordinates/);
});

test('Places output feeds straight into the competitor table with citations', async () => {
  const prospect = { id: 'p', business_name: 'Real Spa', google_place_id: 'P', latitude: 24.7136, longitude: 46.6753, category: 'spa',
    google_rating: 4.4, google_review_count: 210,
    data_sources: { google_rating: { source: 'google_places', url: 'https://maps.google.com/?cid=P', fetched_at: NOW },
      google_review_count: { source: 'google_places', url: 'https://maps.google.com/?cid=P', fetched_at: NOW } } };
  const f = mockFetch(() => ({ json: { places: [place('A', 'Spa A', 24.72, 46.68, 4.8, 900), place('B', 'Spa B', 24.70, 46.66, 4.1, 50)] } }));
  const competitors = (await findCompetitors({ prospect, apiKey: 'K', fetchImpl: f, now: NOW })).map((c, i) => ({ id: `c${i}`, ...c }));
  const t = buildCompetitorTable({ prospect, competitors }, { now: NOW });
  assert.equal(t.cohort_size, 3);
  assert.ok(t.rows.every((r) => r.cells.google_rating.value !== null && r.cells.google_rating.citations.length));
  assert.ok(t.sources.every((s) => s.url.startsWith('https://maps.google.com/')));
});

test('instagramHandle parses URLs and handles', () => {
  assert.equal(instagramHandle('https://www.instagram.com/iris.spa/?hl=en'), 'iris.spa');
  assert.equal(instagramHandle('@iris_spa'), 'iris_spa');
  assert.equal(instagramHandle('https://www.instagram.com/p/ABC123/'), null);
  assert.equal(instagramHandle('not a handle!'), null);
  assert.equal(instagramHandle(''), null);
});

test('postsPerWeek uses the time span of the sample', () => {
  const ts = ['2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z', '2026-10-15T00:00:00Z', '2026-10-29T00:00:00Z'];
  assert.equal(postsPerWeek(ts, '2026-10-29T00:00:00Z'), 1);
  assert.equal(postsPerWeek(['2026-10-01T00:00:00Z']), null);
});

test('fetchInstagramProfile computes engagement from recent posts and records provenance', async () => {
  const media = Array.from({ length: 4 }, (_, i) => ({ like_count: 100 + i * 10, comments_count: 5, timestamp: `2026-10-${String(1 + i * 7).padStart(2, '0')}T10:00:00+0000` }));
  const f = mockFetch(() => ({ json: { business_discovery: { username: 'iris.spa', followers_count: 5000, media_count: 321, media: { data: media } } } }));
  const p = await fetchInstagramProfile({ handle: 'https://instagram.com/iris.spa', igUserId: '1784', accessToken: 'TOKEN', fetchImpl: f, now: NOW });
  const url = decodeURIComponent(f.calls[0].url);
  assert.match(url, /^https:\/\/graph\.facebook\.com\/v24\.0\/1784\?fields=business_discovery\.username\(iris\.spa\)/);
  assert.match(url, /followers_count/);
  assert.equal(p.profile_found, true);
  assert.equal(p.followers, 5000);
  assert.equal(p.avg_likes, 115);
  assert.equal(p.engagement_rate, 2.4); // (115 + 5) / 5000 × 100
  assert.equal(p.data_sources.followers.source, 'meta_graph');
  assert.equal(p.data_sources.engagement_rate.url, 'https://www.instagram.com/iris.spa/');
  assert.match(p.post_frequency, /posts\/week/);
});

test('fetchInstagramProfile reports not-found accounts and raises other errors', async () => {
  const nf = mockFetch(() => ({ status: 400, json: { error: { code: 110, message: 'Invalid user id' } } }));
  const p = await fetchInstagramProfile({ handle: 'personal', igUserId: '1', accessToken: 't', fetchImpl: nf });
  assert.equal(p.profile_found, false);
  const err = mockFetch(() => ({ status: 400, json: { error: { code: 190, message: 'Invalid OAuth access token' } } }));
  await assert.rejects(fetchInstagramProfile({ handle: 'x', igUserId: '1', accessToken: 't', fetchImpl: err }), GraphApiError);
  await assert.rejects(fetchInstagramProfile({ handle: 'x', fetchImpl: err }), /credentials missing/);
  assert.equal((await fetchInstagramProfile({ handle: 'bad handle!', fetchImpl: err })).profile_found, false);
});
