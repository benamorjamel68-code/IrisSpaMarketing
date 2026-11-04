// TEST FIXTURE — fictional businesses with made-up numbers, used only to
// exercise the engine. Real reports are built from live API data.

export const NOW = '2026-11-04T12:00:00.000Z';
const F = '2026-11-01T09:00:00.000Z';
const gp = (id) => ({ source: 'google_places', url: `https://maps.google.com/?cid=${id}`, fetched_at: F });
const ig = (h) => ({ source: 'meta_graph', url: `https://www.instagram.com/${h}/`, fetched_at: F });
const places = (id) => ({ google_rating: gp(id), google_review_count: gp(id), latitude: gp(id), longitude: gp(id), distance_miles: gp(id) });

export function cohort() {
  const prospect = {
    id: 'p1', business_name: 'Fixture Prospect Spa', google_place_id: 'gp-p1', category: 'spa',
    google_rating: 4.3, google_review_count: 120, latitude: 24.7136, longitude: 46.6753,
    data_sources: places('p1'),
  };
  const comp = (id, name, rating, count, dist, rank) => ({
    id, prospect_id: 'p1', business_name: name, google_place_id: `gp-${id}`, google_rating: rating, google_review_count: count,
    distance_miles: dist, rank_score: rank, data_sources: places(id),
  });
  const competitors = [
    comp('c1', 'Fixture Leader Spa', 4.8, 900, 1.2, 14),
    comp('c2', 'Fixture Big Chain', 4.1, 1500, 2.5, 13),
    comp('c3', 'Fixture Boutique', 4.9, 60, 0.8, 9),
    comp('c4', 'Fixture Corner Spa', 3.9, 45, 3.1, 6),
    comp('c5', 'Fixture Mall Spa', 4.5, 300, 4.0, 11),
    comp('c6', 'Fixture New Spa', 4.6, 30, 1.9, 7),
  ];
  const sp = (owner, platform, followers, er, handle) => ({
    prospect_id: 'p1', is_prospect: owner === 'p1', competitor_id: owner === 'p1' ? undefined : owner, platform,
    handle, profile_found: true, followers, engagement_rate: er,
    data_sources: { followers: ig(handle), engagement_rate: ig(handle) },
  });
  const socialProfiles = [
    sp('p1', 'instagram', 2100, 1.4, 'prospectspa'),
    sp('c1', 'instagram', 18000, 2.9, 'leaderspa'),
    sp('c2', 'instagram', 45000, 0.6, 'bigchain'),
    sp('c3', 'instagram', 3200, 4.1, 'boutique'),
    sp('c5', 'instagram', 9000, 1.8, 'mallspa'),
    sp('c6', 'instagram', 1500, 3.0, 'newspa'),
    { prospect_id: 'p1', competitor_id: 'c4', platform: 'instagram', profile_found: false },
    // An unsourced number: must never reach the report.
    { prospect_id: 'p1', competitor_id: 'c4', platform: 'tiktok', profile_found: true, followers: 99999 },
  ];
  const reviews = [
    { prospect_id: 'p1', is_prospect: true, platform: 'google', average_rating: 4.3, total_reviews: 120, recent_review_count_30d: 4,
      owner_response_rate: 20, data_sources: { average_rating: gp('p1'), total_reviews: gp('p1'),
        recent_review_count_30d: { source: 'serpapi', url: 'https://serpapi.com/search?engine=google_maps_reviews&place_id=gp-p1', fetched_at: F },
        owner_response_rate: { source: 'serpapi', url: 'https://serpapi.com/search?engine=google_maps_reviews&place_id=gp-p1', fetched_at: F } } },
    { prospect_id: 'p1', competitor_id: 'c1', platform: 'google', average_rating: 4.8, total_reviews: 900, recent_review_count_30d: 35,
      owner_response_rate: 95, data_sources: { average_rating: gp('c1'), total_reviews: gp('c1'),
        recent_review_count_30d: { source: 'serpapi', url: 'https://serpapi.com/x?c1', fetched_at: F },
        owner_response_rate: { source: 'serpapi', url: 'https://serpapi.com/x?c1', fetched_at: F } } },
  ];
  return { prospect, competitors, socialProfiles, reviews };
}
