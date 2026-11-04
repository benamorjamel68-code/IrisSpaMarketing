// Competitor market-position table.
//
// Builds one row per business (the prospect plus every competitor found in the
// radius) from the Base44 records, keeps the provenance of every number, and
// scores each business's market position relative to the local cohort.

import { CitationLedger, missing, readSourcedField, sourced } from './provenance.js';
import { bayesianRating, haversineMiles, median, mean, percentileRank, round } from './stats.js';

export const POSITIONS = Object.freeze({
  leader: { key: 'leader', label: 'Market Leader', label_ar: 'رائد السوق',
    meaning: 'Strong reputation and high visibility.', meaning_ar: 'سمعة قوية وحضور واسع.' },
  challenger: { key: 'challenger', label: 'Challenger', label_ar: 'منافس صاعد',
    meaning: 'Highly visible, but its reputation trails the market.', meaning_ar: 'حضور واسع لكن سمعته أقل من السوق.' },
  niche: { key: 'niche', label: 'Hidden Gem', label_ar: 'جوهرة مخفية',
    meaning: 'Well rated, but few people see it.', meaning_ar: 'تقييم مرتفع لكن انتشار محدود.' },
  laggard: { key: 'laggard', label: 'Falling Behind', label_ar: 'متأخر',
    meaning: 'Below the market on both reputation and visibility.', meaning_ar: 'أقل من السوق في السمعة والحضور.' },
  insufficient: { key: 'insufficient', label: 'Not enough data', label_ar: 'بيانات غير كافية',
    meaning: 'Too few sourced metrics to place this business.', meaning_ar: 'لا تتوفر بيانات موثقة كافية لتصنيف هذا النشاط.' },
});

/** Columns of the table, in display order. */
export const METRICS = Object.freeze([
  { key: 'google_rating', label: 'Google rating', label_ar: 'تقييم Google', unit: 'stars', digits: 1, higherIsBetter: true },
  { key: 'google_review_count', label: 'Google reviews', label_ar: 'مراجعات Google', unit: 'count', digits: 0, higherIsBetter: true },
  { key: 'review_share_pct', label: 'Share of local reviews', label_ar: 'الحصة من المراجعات المحلية', unit: 'pct', digits: 1, higherIsBetter: true, derived: true },
  { key: 'reviews_last_30d', label: 'New reviews (30 days)', label_ar: 'مراجعات جديدة (30 يومًا)', unit: 'count', digits: 0, higherIsBetter: true },
  { key: 'owner_response_rate', label: 'Owner reply rate', label_ar: 'نسبة رد المالك', unit: 'pct', digits: 0, higherIsBetter: true },
  { key: 'instagram_followers', label: 'Instagram followers', label_ar: 'متابعو إنستغرام', unit: 'count', digits: 0, higherIsBetter: true },
  { key: 'instagram_engagement_rate', label: 'Instagram engagement', label_ar: 'التفاعل على إنستغرام', unit: 'pct', digits: 2, higherIsBetter: true },
  { key: 'tiktok_followers', label: 'TikTok followers', label_ar: 'متابعو تيك توك', unit: 'count', digits: 0, higherIsBetter: true },
  { key: 'facebook_followers', label: 'Facebook followers', label_ar: 'متابعو فيسبوك', unit: 'count', digits: 0, higherIsBetter: true },
  { key: 'total_social_followers', label: 'Total social followers', label_ar: 'إجمالي المتابعين', unit: 'count', digits: 0, higherIsBetter: true, derived: true },
  { key: 'distance_miles', label: 'Distance', label_ar: 'المسافة', unit: 'miles', digits: 1, higherIsBetter: null },
]);

export const DEFAULT_WEIGHTS = Object.freeze({ reputation: 0.4, visibility: 0.4, engagement: 0.2 });

const SOCIAL_PLATFORMS = ['instagram', 'tiktok', 'facebook', 'youtube', 'linkedin'];

/** A value computed from other sourced cells; it cites its inputs. */
function derivedCell(value, note, inputs) {
  return { ...sourced(value, { source: 'derived', note }), inputs };
}

function belongsTo(record, business) {
  if (business.is_prospect) return record.is_prospect === true || (record.business_type === 'prospect');
  return !record.is_prospect && (record.competitor_id === business.id || record.business_id === business.id);
}

function socialCell(profiles, platform, field, opts) {
  const p = profiles.find((x) => x.platform === platform);
  if (!p) return missing('profile not searched');
  if (p.profile_found === false) return missing('no profile found');
  return readSourcedField(p, field, opts);
}

function reviewCell(reviews, field, opts) {
  const r = reviews.find((x) => x.platform === 'google');
  if (!r) return missing('review data not collected');
  return readSourcedField(r, field, opts);
}

/** Prefer the review-analysis record; fall back to the Places fields on the business itself. */
function firstAvailable(...cells) {
  return cells.find((c) => c && c.value !== null) || cells[cells.length - 1];
}

function collectBusiness(business, ctx, opts) {
  const profiles = ctx.socialProfiles.filter((p) => belongsTo(p, business));
  const reviews = ctx.reviews.filter((r) => belongsTo(r, business));
  const cells = {};

  cells.google_rating = firstAvailable(
    reviewCell(reviews, 'average_rating', opts),
    readSourcedField(business.record, 'google_rating', opts),
  );
  cells.google_review_count = firstAvailable(
    reviewCell(reviews, 'total_reviews', opts),
    readSourcedField(business.record, 'google_review_count', opts),
  );
  cells.reviews_last_30d = reviewCell(reviews, 'recent_review_count_30d', opts);
  cells.owner_response_rate = reviewCell(reviews, 'owner_response_rate', opts);
  cells.instagram_followers = socialCell(profiles, 'instagram', 'followers', opts);
  cells.instagram_engagement_rate = socialCell(profiles, 'instagram', 'engagement_rate', opts);
  cells.tiktok_followers = socialCell(profiles, 'tiktok', 'followers', opts);
  cells.facebook_followers = socialCell(profiles, 'facebook', 'followers', opts);

  // Total followers: only sums platforms whose counts are sourced.
  const followerCells = SOCIAL_PLATFORMS.map((pl) => ({ pl, cell: socialCell(profiles, pl, 'followers', opts) }))
    .filter((x) => x.cell.value !== null);
  cells.total_social_followers = followerCells.length
    ? derivedCell(followerCells.reduce((a, x) => a + x.cell.value, 0),
      `Sum of ${followerCells.map((x) => x.pl).join(', ')} followers`, followerCells.map((x) => x.cell))
    : missing('no sourced social follower counts');

  if (business.is_prospect) {
    cells.distance_miles = derivedCell(0, 'Prospect location (origin of the radius search)', []);
  } else {
    const d = readSourcedField(business.record, 'distance_miles', opts);
    if (d.value !== null) cells.distance_miles = d;
    else {
      const lat = readSourcedField(business.record, 'latitude', opts);
      const lng = readSourcedField(business.record, 'longitude', opts);
      const plat = readSourcedField(ctx.prospect, 'latitude', opts);
      const plng = readSourcedField(ctx.prospect, 'longitude', opts);
      cells.distance_miles = [lat, lng, plat, plng].every((c) => c.value !== null)
        ? derivedCell(haversineMiles(plat.value, plng.value, lat.value, lng.value),
          'Great-circle distance from sourced coordinates', [lat, lng, plat, plng])
        : missing('no sourced distance or coordinates');
    }
  }
  return cells;
}

function positionFor(scores) {
  if (scores.reputation === null || scores.visibility === null) return POSITIONS.insufficient;
  const highRep = scores.reputation >= 50;
  const highVis = scores.visibility >= 50;
  if (highRep && highVis) return POSITIONS.leader;
  if (!highRep && highVis) return POSITIONS.challenger;
  if (highRep && !highVis) return POSITIONS.niche;
  return POSITIONS.laggard;
}

function weightedComposite(parts, weights) {
  let total = 0;
  let wsum = 0;
  for (const [k, v] of Object.entries(parts)) {
    if (v === null || v === undefined) continue;
    total += v * weights[k];
    wsum += weights[k];
  }
  return wsum ? total / wsum : null;
}

/**
 * Build the competitor market-position table.
 *
 * @param {object} input
 * @param {object} input.prospect          Base44 Prospect record
 * @param {object[]} input.competitors     Base44 Competitor records
 * @param {object[]} [input.socialProfiles] Base44 SocialProfile records
 * @param {object[]} [input.reviews]       Base44 ReviewData records
 * @param {object} [options]
 * @param {string} [options.now]           ISO timestamp used for freshness checks
 * @param {number} [options.maxAgeDays=90] Values older than this are treated as missing
 * @param {object} [options.weights]       Composite weights {reputation, visibility, engagement}
 * @param {number} [options.maxCompetitors=15] Only the N closest/strongest competitors are tabled
 */
export function buildCompetitorTable(input, options = {}) {
  const now = options.now || new Date().toISOString();
  const opts = { now, maxAgeDays: options.maxAgeDays ?? 90 };
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
  const maxCompetitors = options.maxCompetitors ?? 15;

  const prospect = input.prospect;
  if (!prospect || !prospect.business_name) throw new Error('buildCompetitorTable: prospect with business_name is required');
  const competitorRecords = (input.competitors || [])
    .filter((c) => c && c.business_name && c.out_of_radius !== true
      && !(c.google_place_id && c.google_place_id === prospect.google_place_id))
    .slice()
    .sort((a, b) => (b.rank_score ?? 0) - (a.rank_score ?? 0) || (a.distance_miles ?? 99) - (b.distance_miles ?? 99))
    .slice(0, maxCompetitors);

  const ctx = { prospect, socialProfiles: input.socialProfiles || [], reviews: input.reviews || [] };
  const businesses = [
    { id: prospect.id ?? 'prospect', is_prospect: true, record: prospect },
    ...competitorRecords.map((c) => ({ id: c.id, is_prospect: false, record: c })),
  ].map((b) => ({ ...b, business_name: b.record.business_name, cells: collectBusiness(b, ctx, opts) }));

  // Share of local reviews (proxy for share of customer attention in the radius).
  const counted = businesses.filter((b) => b.cells.google_review_count.value !== null);
  const totalReviews = counted.reduce((a, b) => a + b.cells.google_review_count.value, 0);
  for (const b of businesses) {
    b.cells.review_share_pct = b.cells.google_review_count.value !== null && totalReviews > 0
      ? derivedCell((b.cells.google_review_count.value / totalReviews) * 100,
        `Reviews ÷ ${totalReviews} total Google reviews across ${counted.length} local businesses`, [b.cells.google_review_count])
      : missing('no sourced review count');
  }

  // Scores (all relative to the cohort, 0–100).
  const ratings = businesses.map((b) => b.cells.google_rating.value);
  const counts = businesses.map((b) => b.cells.google_review_count.value);
  const priorMean = mean(ratings);
  const priorWeight = Math.max(10, median(counts) ?? 10);
  for (const b of businesses) {
    b.bayesian_rating = bayesianRating(b.cells.google_rating.value, b.cells.google_review_count.value, priorMean, priorWeight);
  }
  const bayes = businesses.map((b) => b.bayesian_rating);
  const followers = businesses.map((b) => b.cells.total_social_followers.value);
  const engagement = businesses.map((b) => b.cells.instagram_engagement_rate.value);

  for (const b of businesses) {
    const reputation = b.bayesian_rating === null ? null : percentileRank(bayes, b.bayesian_rating);
    const visParts = [
      b.cells.google_review_count.value === null ? null : percentileRank(counts, b.cells.google_review_count.value),
      b.cells.total_social_followers.value === null ? null : percentileRank(followers, b.cells.total_social_followers.value),
    ].filter((x) => x !== null);
    const visibility = visParts.length ? visParts.reduce((a, x) => a + x, 0) / visParts.length : null;
    const eng = b.cells.instagram_engagement_rate.value === null ? null : percentileRank(engagement, b.cells.instagram_engagement_rate.value);
    const composite = weightedComposite({ reputation, visibility, engagement: eng }, weights);
    const scored = METRICS.filter((m) => m.key !== 'distance_miles');
    const coverage = scored.filter((m) => b.cells[m.key] && b.cells[m.key].value !== null).length / scored.length;
    b.scores = {
      reputation: round(reputation, 0),
      visibility: round(visibility, 0),
      engagement: round(eng, 0),
      composite: round(composite, 0),
      bayesian_rating: round(b.bayesian_rating, 2),
      data_coverage_pct: round(coverage * 100, 0),
    };
    b.position = positionFor(b.scores);
  }

  // Rank by composite (missing composite sorts last), prospect wins ties so it is never hidden.
  businesses.sort((a, b) => (b.scores.composite ?? -1) - (a.scores.composite ?? -1) || (a.is_prospect ? -1 : b.is_prospect ? 1 : 0));
  businesses.forEach((b, i) => { b.rank = b.scores.composite === null ? null : i + 1; });

  // Citations: every non-derived input gets a footnote number.
  const ledger = new CitationLedger();
  const citeCell = (cell) => {
    if (!cell || cell.value === null) return [];
    if (cell.source === 'derived') return [...new Set((cell.inputs || []).flatMap(citeCell))];
    const id = ledger.cite(cell);
    return id ? [id] : [];
  };

  const rows = businesses.map((b) => {
    const cells = {};
    for (const m of METRICS) {
      const c = b.cells[m.key] || missing('not collected');
      cells[m.key] = c.value === null
        ? { value: null, display_value: null, missing_reason: c.missing_reason, citations: [] }
        : { value: c.value, display_value: round(c.value, m.digits), source: c.source, note: c.note ?? null,
          fetched_at: c.fetched_at ?? null, url: c.url ?? null, citations: citeCell(c) };
    }
    return {
      business_id: b.id,
      business_name: b.business_name,
      is_prospect: b.is_prospect,
      rank: b.rank,
      position: b.position.key,
      position_label: b.position.label,
      position_label_ar: b.position.label_ar,
      scores: b.scores,
      cells,
    };
  });

  const prospectRow = rows.find((r) => r.is_prospect);
  const leaderRow = rows.find((r) => r.rank === 1) || null;
  const rankedCount = rows.filter((r) => r.rank !== null).length;

  return {
    generated_at: now,
    cohort_size: rows.length,
    competitor_count: rows.length - 1,
    ranked_count: rankedCount,
    columns: METRICS.map((m) => ({ ...m })),
    rows,
    prospect: prospectRow,
    leader: leaderRow,
    prospect_rank: prospectRow.rank,
    total_local_reviews: totalReviews,
    weights,
    scoring: {
      prior_mean_rating: round(priorMean, 3),
      prior_weight_reviews: round(priorWeight, 0),
    },
    sources: ledger.list(),
    positions: Object.values(POSITIONS).map((p) => ({ ...p })),
  };
}
