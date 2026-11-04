// Analytical agent.
//
// Reads the sourced numbers in the competitor table and produces an analytical
// report: cohort statistics, the prospect's gaps, market concentration,
// relationships between metrics, outliers and a ranked list of findings.
// Every finding is computed deterministically from cited data. An LLM can be
// plugged in to write the narrative, but its text is only kept if every number
// it contains can be traced back to the computed facts.

import { METRICS } from './marketPosition.js';
import { describe, hhi, max, min, pearson, percentileRank, round, zScore } from './stats.js';

export const HHI_REFERENCE = Object.freeze({
  label: 'U.S. DOJ & FTC Merger Guidelines (2023), §2.1: HHI above 1,800 is highly concentrated; 1,000–1,800 moderately concentrated',
  url: 'https://www.justice.gov/atr/2023-merger-guidelines',
});

const SEVERITY_ORDER = { critical: 0, moderate: 1, on_par: 2, ahead: 3, leading: 4 };

/** Which marketing lever moves which metric (used for recommendations). */
const LEVERS = {
  google_rating: { platform: 'google_business', lever: 'Post-visit review requests to happy clients and fast replies to every negative review',
    lever_ar: 'طلب التقييم من العملاء الراضين بعد الزيارة والرد السريع على كل تقييم سلبي' },
  google_review_count: { platform: 'google_business', lever: 'Automated review request by WhatsApp/SMS after every appointment',
    lever_ar: 'إرسال طلب تقييم تلقائي عبر واتساب أو رسالة نصية بعد كل موعد' },
  review_share_pct: { platform: 'google_business', lever: 'Review generation campaign to win share of local customer attention',
    lever_ar: 'حملة لجمع التقييمات لزيادة الحصة من اهتمام العملاء المحليين' },
  reviews_last_30d: { platform: 'google_business', lever: 'Steady monthly review flow (review velocity drives local ranking)',
    lever_ar: 'تدفق شهري منتظم للتقييمات (سرعة التقييمات تؤثر على الترتيب المحلي)' },
  owner_response_rate: { platform: 'google_business', lever: 'Reply to 100% of reviews within 48 hours',
    lever_ar: 'الرد على جميع التقييمات خلال 48 ساعة' },
  instagram_followers: { platform: 'instagram', lever: 'Reels-first content calendar and local creator collaborations',
    lever_ar: 'خطة محتوى تعتمد على الريلز والتعاون مع صناع محتوى محليين' },
  instagram_engagement_rate: { platform: 'instagram', lever: 'Content built around offers, before/after and client stories, with clear calls to action',
    lever_ar: 'محتوى قائم على العروض وقصص العملاء ونتائج قبل وبعد مع دعوات واضحة للتفاعل' },
  tiktok_followers: { platform: 'tiktok', lever: 'Short-form video presence on TikTok', lever_ar: 'حضور بفيديوهات قصيرة على تيك توك' },
  facebook_followers: { platform: 'facebook', lever: 'Facebook page with local targeting', lever_ar: 'صفحة فيسبوك مع استهداف محلي' },
  total_social_followers: { platform: 'social', lever: 'Consistent multi-platform publishing', lever_ar: 'نشر منتظم على عدة منصات' },
};

function severityFor(percentile, isBest) {
  if (isBest) return 'leading';
  if (percentile < 25) return 'critical';
  if (percentile < 50) return 'moderate';
  if (percentile < 75) return 'on_par';
  return 'ahead';
}

function fmt(x, digits = 0) {
  const r = round(x, digits);
  if (r === null) return 'n/a';
  return r.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function unitText(metric, value) {
  if (metric.unit === 'pct') return `${fmt(value, metric.digits)}%`;
  if (metric.unit === 'stars') return `${fmt(value, metric.digits)}★`;
  if (metric.unit === 'miles') return `${fmt(value, metric.digits)} mi`;
  return fmt(value, metric.digits);
}

/** 5-star reviews needed to lift an average rating r over n reviews to target t. */
export function reviewsNeededForRating(rating, count, target) {
  if ([rating, count, target].some((x) => typeof x !== 'number' || !Number.isFinite(x))) return null;
  if (rating >= target) return 0;
  if (target >= 5) return null;
  return Math.ceil((count * (target - rating)) / (5 - target));
}

function metricAnalysis(table, metric) {
  const rows = table.rows;
  const prospect = table.prospect;
  const values = rows.map((r) => r.cells[metric.key].value);
  const competitorValues = rows.filter((r) => !r.is_prospect).map((r) => r.cells[metric.key].value);
  const pv = prospect.cells[metric.key].value;
  const cohort = describe(values);
  const competitors = describe(competitorValues);
  const citations = [...new Set(rows.flatMap((r) => r.cells[metric.key].citations))].sort((a, b) => a - b);
  const result = {
    metric: metric.key,
    label: metric.label,
    label_ar: metric.label_ar,
    unit: metric.unit,
    digits: metric.digits,
    prospect_value: pv,
    cohort,
    competitors,
    citations,
    sample_size: cohort.n,
  };
  if (pv === null || competitors.n === 0) {
    result.status = pv === null ? 'prospect_missing' : 'no_competitor_data';
    return result;
  }
  const bestComp = metric.higherIsBetter === false ? min(competitorValues) : max(competitorValues);
  const leaderRow = rows.find((r) => !r.is_prospect && r.cells[metric.key].value === bestComp);
  const pct = percentileRank(values, pv);
  const isBest = metric.higherIsBetter !== false ? pv >= max(values) : pv <= min(values);
  result.status = 'ok';
  result.percentile = round(pct, 0);
  result.z_score = round(zScore(values, pv), 2);
  result.gap_vs_median = pv - competitors.median;
  result.gap_vs_median_pct = competitors.median ? ((pv - competitors.median) / Math.abs(competitors.median)) * 100 : null;
  result.gap_vs_best = pv - bestComp;
  result.gap_vs_best_pct = bestComp ? ((pv - bestComp) / Math.abs(bestComp)) * 100 : null;
  result.best_competitor = leaderRow ? { business_name: leaderRow.business_name, value: bestComp } : null;
  result.severity = metric.higherIsBetter === null ? null : severityFor(pct, isBest);
  return result;
}

function concentration(table) {
  const shares = table.rows.map((r) => r.cells.review_share_pct.value).filter((v) => v !== null).map((v) => v / 100);
  if (shares.length < 2) return null;
  const index = hhi(shares);
  const level = index > 1800 ? 'highly_concentrated' : index >= 1000 ? 'moderately_concentrated' : 'fragmented';
  const top = table.rows.filter((r) => r.cells.review_share_pct.value !== null)
    .sort((a, b) => b.cells.review_share_pct.value - a.cells.review_share_pct.value)[0];
  const top3 = table.rows.map((r) => r.cells.review_share_pct.value).filter((v) => v !== null)
    .sort((a, b) => b - a).slice(0, 3).reduce((a, x) => a + x, 0);
  return {
    basis: 'share of Google reviews within the radius',
    hhi: round(index, 0),
    level,
    top_business: top.business_name,
    top_share_pct: round(top.cells.review_share_pct.value, 1),
    top3_share_pct: round(top3, 1),
    reference: HHI_REFERENCE,
    citations: [...new Set(table.rows.flatMap((r) => r.cells.review_share_pct.citations))].sort((a, b) => a - b),
  };
}

function relationships(table) {
  const pairs = [
    ['total_social_followers', 'google_review_count'],
    ['instagram_engagement_rate', 'google_rating'],
    ['google_rating', 'google_review_count'],
    ['distance_miles', 'google_review_count'],
  ];
  const out = [];
  for (const [a, b] of pairs) {
    const xs = table.rows.map((r) => r.cells[a].value);
    const ys = table.rows.map((r) => r.cells[b].value);
    const n = xs.filter((x, i) => x !== null && ys[i] !== null).length;
    if (n < 5) continue;
    const r = pearson(xs, ys);
    if (r === null) continue;
    const strength = Math.abs(r) >= 0.7 ? 'strong' : Math.abs(r) >= 0.4 ? 'moderate' : 'weak';
    out.push({ x: a, y: b, r: round(r, 2), n, strength, direction: r >= 0 ? 'positive' : 'negative',
      caveat: 'Correlation in a small local sample; it does not prove cause and effect.' });
  }
  return out;
}

function outliers(table) {
  const out = [];
  for (const m of METRICS) {
    if (m.key === 'distance_miles') continue;
    const values = table.rows.map((r) => r.cells[m.key].value);
    if (values.filter((v) => v !== null).length < 5) continue;
    for (const r of table.rows) {
      const v = r.cells[m.key].value;
      if (v === null) continue;
      const z = zScore(values, v);
      if (z !== null && Math.abs(z) >= 2) {
        out.push({ business_name: r.business_name, is_prospect: r.is_prospect, metric: m.key, value: v, z_score: round(z, 2) });
      }
    }
  }
  return out;
}

function dataQuality(table) {
  const scored = METRICS.filter((m) => m.key !== 'distance_miles');
  const notCollected = scored.filter((m) => table.rows.every((r) => r.cells[m.key].value === null)).map((m) => m.key);
  const perBusiness = table.rows.map((r) => ({
    business_name: r.business_name,
    is_prospect: r.is_prospect,
    coverage_pct: r.scores.data_coverage_pct,
    missing: scored.filter((m) => r.cells[m.key].value === null)
      .map((m) => ({ metric: m.key, label: m.label, label_ar: m.label_ar, reason: r.cells[m.key].missing_reason })),
  }));
  const total = perBusiness.length * scored.length;
  const filled = perBusiness.reduce((a, b) => a + (scored.length - b.missing.length), 0);
  const coverage = total ? (filled / total) * 100 : 0;
  return {
    coverage_pct: round(coverage, 0),
    grade: coverage >= 80 ? 'A' : coverage >= 60 ? 'B' : coverage >= 40 ? 'C' : 'D',
    businesses: perBusiness,
    not_collected_for_any_business: notCollected,
    sources: table.sources,
    rule: 'Only values with a recorded source and fetch date are used. Missing values are shown as "not available", never estimated.',
  };
}

function buildFindings(table, metrics, conc, rels) {
  const findings = [];
  const p = table.prospect;
  const leader = table.leader;
  const allCitations = [...new Set(table.rows.flatMap((r) => Object.values(r.cells).flatMap((c) => c.citations)))].sort((a, b) => a - b);

  if (p.rank !== null) {
    findings.push({
      id: 'overall_position',
      severity: p.rank === 1 ? 'leading' : p.scores.composite >= 50 ? 'on_par' : p.scores.composite >= 25 ? 'moderate' : 'critical',
      headline: `${p.business_name} ranks #${p.rank} of ${table.ranked_count} local businesses (${p.position_label}).`,
      headline_ar: `يحتل ${p.business_name} المركز ${p.rank} من أصل ${table.ranked_count} نشاطًا محليًا (${p.position_label_ar}).`,
      detail: leader && !leader.is_prospect
        ? `Market position score ${p.scores.composite}/100 vs ${leader.scores.composite}/100 for the leader, ${leader.business_name}.`
        : `Market position score ${p.scores.composite}/100, the highest in the local market.`,
      detail_ar: leader && !leader.is_prospect
        ? `مؤشر المكانة السوقية ${p.scores.composite}/100 مقابل ${leader.scores.composite}/100 للرائد ${leader.business_name}.`
        : `مؤشر المكانة السوقية ${p.scores.composite}/100، وهو الأعلى في السوق المحلي.`,
      metrics: ['composite'],
      citations: allCitations,
    });
  }

  for (const m of metrics) {
    if (m.status !== 'ok' || m.severity === null) continue;
    const meta = METRICS.find((x) => x.key === m.metric);
    const pv = unitText(meta, m.prospect_value);
    const med = unitText(meta, m.competitors.median);
    const best = m.best_competitor ? unitText(meta, m.best_competitor.value) : null;
    const behind = m.severity === 'critical' || m.severity === 'moderate';
    const cmp = Math.sign(meta.higherIsBetter === false ? m.competitors.median - m.prospect_value : m.prospect_value - m.competitors.median);
    const bestText = best && cmp < 0 ? ` (best: ${m.best_competitor.business_name}, ${best})` : '';
    const bestTextAr = best && cmp < 0 ? ` (الأفضل: ${m.best_competitor.business_name}، ${best})` : '';
    const lowSample = m.competitors.n < 3;
    findings.push({
      id: `metric_${m.metric}`,
      severity: m.severity,
      headline: cmp > 0
        ? `${meta.label}: ${pv}, ahead of the competitor median of ${med}.`
        : cmp < 0
          ? `${meta.label}: ${pv} vs a competitor median of ${med}${bestText}.`
          : `${meta.label}: ${pv}, in line with the competitor median.`,
      headline_ar: cmp > 0
        ? `${meta.label_ar}: ${pv}، أعلى من وسيط المنافسين ${med}.`
        : cmp < 0
          ? `${meta.label_ar}: ${pv} مقابل وسيط المنافسين ${med}${bestTextAr}.`
          : `${meta.label_ar}: ${pv}، مماثل لوسيط المنافسين.`,
      detail: `Percentile ${m.percentile} among ${m.sample_size} businesses with this metric.${lowSample ? ` Only ${m.competitors.n} competitor(s) had sourced data, so treat this as indicative.` : ''}`,
      detail_ar: `المئين ${m.percentile} بين ${m.sample_size} نشاطًا تتوفر لديهم هذه البيانات.${lowSample ? ` تتوفر بيانات موثقة لعدد ${m.competitors.n} من المنافسين فقط، لذا تُعد النتيجة استرشادية.` : ''}`,
      metrics: [m.metric],
      citations: m.citations,
      lever: behind && LEVERS[m.metric] ? LEVERS[m.metric] : null,
      low_sample: lowSample,
      gap_vs_median_pct: round(m.gap_vs_median_pct, 1),
    });
  }

  const rating = metrics.find((m) => m.metric === 'google_rating');
  const count = metrics.find((m) => m.metric === 'google_review_count');
  if (rating && count && rating.status === 'ok' && count.prospect_value !== null && rating.prospect_value < rating.competitors.median) {
    const target = round(rating.competitors.median, 1);
    const needed = reviewsNeededForRating(rating.prospect_value, count.prospect_value, target);
    if (needed !== null && needed > 0) {
      findings.push({
        id: 'rating_recovery',
        severity: 'moderate',
        headline: `${needed} new 5-star reviews would lift the rating from ${fmt(rating.prospect_value, 1)} to the local median of ${fmt(target, 1)}.`,
        headline_ar: `يحتاج النشاط إلى ${needed} تقييمًا جديدًا بخمس نجوم لرفع التقييم من ${fmt(rating.prospect_value, 1)} إلى الوسيط المحلي ${fmt(target, 1)}.`,
        detail: `Computed as n×(target − rating) ÷ (5 − target) from ${fmt(count.prospect_value)} existing reviews.`,
        detail_ar: `محسوب بالمعادلة n×(الهدف − التقييم) ÷ (5 − الهدف) من ${fmt(count.prospect_value)} تقييمًا حاليًا.`,
        metrics: ['google_rating', 'google_review_count'],
        citations: [...new Set([...rating.citations, ...count.citations])].sort((a, b) => a - b),
        reviews_needed: needed,
      });
    }
  }

  if (conc) {
    const levelText = { highly_concentrated: 'highly concentrated', moderately_concentrated: 'moderately concentrated', fragmented: 'fragmented' }[conc.level];
    const levelAr = { highly_concentrated: 'شديد التركّز', moderately_concentrated: 'متوسط التركّز', fragmented: 'مجزأ' }[conc.level];
    findings.push({
      id: 'market_concentration',
      severity: 'on_par',
      headline: `The local market is ${levelText} (HHI ${fmt(conc.hhi)}); ${conc.top_business} holds ${fmt(conc.top_share_pct, 1)}% of local reviews.`,
      headline_ar: `السوق المحلي ${levelAr} (مؤشر HHI ${fmt(conc.hhi)})؛ ويستحوذ ${conc.top_business} على ${fmt(conc.top_share_pct, 1)}% من التقييمات المحلية.`,
      detail: conc.level === 'fragmented'
        ? 'No business dominates, so a focused review and content push can move the prospect up quickly.'
        : 'A few businesses dominate attention; the prospect must out-execute them on reviews and content.',
      detail_ar: conc.level === 'fragmented'
        ? 'لا يوجد نشاط مهيمن، لذا يمكن لحملة مركزة على التقييمات والمحتوى أن ترفع ترتيب النشاط بسرعة.'
        : 'عدد قليل من الأنشطة يستحوذ على الاهتمام؛ ويجب على النشاط التفوق عليهم في التقييمات والمحتوى.',
      metrics: ['review_share_pct'],
      citations: conc.citations,
    });
  }

  for (const rel of rels.filter((x) => x.strength !== 'weak')) {
    const a = METRICS.find((m) => m.key === rel.x);
    const b = METRICS.find((m) => m.key === rel.y);
    findings.push({
      id: `relationship_${rel.x}_${rel.y}`,
      severity: 'on_par',
      headline: `In this market, ${a.label.toLowerCase()} and ${b.label.toLowerCase()} move together (${rel.strength} ${rel.direction} correlation, r = ${fmt(rel.r, 2)}, n = ${rel.n}).`,
      headline_ar: `في هذا السوق يرتبط ${a.label_ar} مع ${b.label_ar} (ارتباط ${rel.direction === 'positive' ? 'طردي' : 'عكسي'}، r = ${fmt(rel.r, 2)}، n = ${rel.n}).`,
      detail: rel.caveat,
      detail_ar: 'ارتباط في عينة محلية صغيرة ولا يثبت علاقة سببية.',
      metrics: [rel.x, rel.y],
      citations: [...new Set(table.rows.flatMap((r) => [...r.cells[rel.x].citations, ...r.cells[rel.y].citations]))].sort((a, b) => a - b),
    });
  }

  return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Rows ready to be stored in the Base44 `Benchmark` entity. */
export function toBenchmarkRecords(prospectId, metrics) {
  return metrics.filter((m) => m.status === 'ok' && m.severity !== null).map((m) => ({
    prospect_id: prospectId,
    metric_name: m.metric,
    platform: (LEVERS[m.metric] && LEVERS[m.metric].platform) || 'google_business',
    prospect_value: round(m.prospect_value, m.digits),
    competitor_avg: round(m.competitors.mean, m.digits),
    competitor_best: m.best_competitor ? round(m.best_competitor.value, m.digits) : null,
    competitor_worst: round(m.competitors.min, m.digits),
    percentile_rank: m.percentile,
    gap_severity: m.severity,
    gap_description: `${m.label}: ${round(m.prospect_value, m.digits)} vs competitor median ${round(m.competitors.median, m.digits)} (percentile ${m.percentile}, sources ${m.citations.map((c) => `[${c}]`).join('')})`,
  }));
}

/** Every number the narrative is allowed to mention, as strings at the precisions we print. */
export function allowedNumbers(facts) {
  const allowed = new Set();
  const add = (n) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return;
    for (const d of [0, 1, 2]) {
      const r = round(n, d);
      allowed.add(String(r));
      allowed.add(r.toFixed(d));
    }
    allowed.add(String(Math.abs(round(n, 0))));
    allowed.add(String(Math.abs(round(n, 1))));
  };
  const walk = (v) => {
    if (typeof v === 'number') add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    else if (typeof v === 'string') (v.match(/-?\d[\d,]*(?:\.\d+)?/g) || []).forEach((s) => add(Number(s.replace(/,/g, ''))));
  };
  walk(facts);
  for (let i = 0; i <= 10; i += 1) allowed.add(String(i));
  ['30', '48', '90', '100'].forEach((s) => allowed.add(s));
  return allowed;
}

const ARABIC_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '٫': '.', '٬': ',' };

/**
 * Check that every number in an LLM narrative appears in the computed facts.
 * Returns {ok, unverified: string[]}.
 */
export function verifyNarrativeNumbers(text, facts) {
  const normalized = String(text || '').replace(/[٠-٩٫٬]/g, (c) => ARABIC_DIGITS[c]);
  const found = normalized.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
  const allowed = allowedNumbers(facts);
  const unverified = [];
  for (const raw of found) {
    const s = raw.replace(/,/g, '').replace(/^-/, '');
    const n = Number(s);
    if (!Number.isFinite(n)) continue;
    const candidates = [s, String(n), String(round(n, 0)), n.toFixed(1), n.toFixed(2)];
    if (!candidates.some((c) => allowed.has(c))) unverified.push(raw);
  }
  return { ok: unverified.length === 0, unverified };
}

function deterministicNarrative(table, findings, lang) {
  const p = table.prospect;
  const top = findings.filter((f) => f.id !== 'overall_position' && (f.severity === 'critical' || f.severity === 'moderate')).slice(0, 3);
  const strengths = findings.filter((f) => f.id !== 'overall_position' && (f.severity === 'ahead' || f.severity === 'leading')).slice(0, 2);
  if (lang === 'ar') {
    const parts = [];
    if (p.rank !== null) parts.push(`يحتل ${p.business_name} المركز ${p.rank} من أصل ${table.ranked_count} نشاطًا في نطاق المنافسة المحلي، ويُصنَّف «${p.position_label_ar}».`);
    if (strengths.length) parts.push(`نقاط القوة: ${strengths.map((f) => f.headline_ar).join(' ')}`);
    if (top.length) parts.push(`أهم الفجوات: ${top.map((f) => f.headline_ar).join(' ')}`);
    parts.push('جميع الأرقام مأخوذة من المصادر المذكورة في الحواشي.');
    return parts.join('\n\n');
  }
  const parts = [];
  if (p.rank !== null) parts.push(`${p.business_name} ranks #${p.rank} of ${table.ranked_count} businesses in its local competitive set and is classed as "${p.position_label}".`);
  if (strengths.length) parts.push(`Strengths: ${strengths.map((f) => f.headline).join(' ')}`);
  if (top.length) parts.push(`Biggest gaps: ${top.map((f) => f.headline).join(' ')}`);
  parts.push('Every number above comes from the sources cited in the footnotes.');
  return parts.join('\n\n');
}

function narrativePrompt(facts, lang) {
  const language = lang === 'ar' ? 'Modern Standard Arabic' : 'English';
  return [
    `You are the analytical agent of OnSocial, a social media marketing agency in Saudi Arabia.`,
    `Write a 150-220 word executive analysis in ${language} for the owner of ${facts.prospect.business_name}.`,
    'Rules:',
    '- Use ONLY the facts in the JSON below. Do not add any number, percentage, ranking or statistic that is not in it.',
    '- Do not estimate, extrapolate or round differently from the JSON. If something is missing, say it was not available.',
    '- Mention the market position, the 2-3 largest gaps and 1-2 strengths, then what to fix first.',
    '- Keep footnote markers like [1] after numbers, using the "citations" arrays.',
    '- Plain prose, no headings, no bullet points.',
    '',
    'FACTS:',
    JSON.stringify(facts),
  ].join('\n');
}

/**
 * Run the analytical agent over a competitor table.
 *
 * @param {object} table   Output of buildCompetitorTable
 * @param {object} [options]
 * @param {'en'|'ar'} [options.lang='en']
 * @param {(prompt: string) => Promise<string>} [options.llm] Optional narrative writer (e.g. Base44 InvokeLLM)
 */
export async function runAnalysis(table, options = {}) {
  const lang = options.lang || 'en';
  const metrics = METRICS.filter((m) => m.key !== 'distance_miles').map((m) => metricAnalysis(table, m));
  const conc = concentration(table);
  const rels = relationships(table);
  const outs = outliers(table);
  const quality = dataQuality(table);
  const findings = buildFindings(table, metrics, conc, rels);

  const recommendations = findings
    .filter((f) => f.lever && (f.severity === 'critical' || f.severity === 'moderate'))
    .slice(0, 5)
    .map((f) => ({
      title: f.lever.lever,
      title_ar: f.lever.lever_ar,
      platform: f.lever.platform,
      priority: f.severity === 'critical' ? 'high' : 'medium',
      gap_addressed: f.headline,
      gap_addressed_ar: f.headline_ar,
      citations: f.citations,
    }));

  const facts = {
    prospect: { business_name: table.prospect.business_name, rank: table.prospect.rank, of: table.ranked_count,
      position: lang === 'ar' ? table.prospect.position_label_ar : table.prospect.position_label, scores: table.prospect.scores },
    leader: table.leader ? { business_name: table.leader.business_name, scores: table.leader.scores } : null,
    prospect_metrics: Object.fromEntries(metrics.filter((m) => m.prospect_value !== null)
      .map((m) => [m.metric, { value: round(m.prospect_value, m.digits), competitor_median: round(m.competitors.median, m.digits),
        percentile: m.percentile ?? null, citations: m.citations }])),
    findings: findings.map((f) => ({ severity: f.severity, text: lang === 'ar' ? f.headline_ar : f.headline, citations: f.citations })),
    concentration: conc ? { hhi: conc.hhi, level: conc.level, top_business: conc.top_business, top_share_pct: conc.top_share_pct } : null,
    data_coverage_pct: quality.coverage_pct,
  };

  let narrative = deterministicNarrative(table, findings, lang);
  let narrativeSource = 'deterministic';
  let narrativeCheck = null;
  if (typeof options.llm === 'function') {
    try {
      const text = await options.llm(narrativePrompt(facts, lang));
      const candidate = typeof text === 'string' ? text.trim() : '';
      narrativeCheck = verifyNarrativeNumbers(candidate, { facts, sources: table.sources.map((s) => s.id) });
      if (candidate && narrativeCheck.ok) {
        narrative = candidate;
        narrativeSource = 'llm_verified';
      } else {
        narrativeSource = 'deterministic_fallback';
      }
    } catch (err) {
      narrativeSource = 'deterministic_fallback';
      narrativeCheck = { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  return {
    generated_at: table.generated_at,
    language: lang,
    narrative,
    narrative_source: narrativeSource,
    narrative_check: narrativeCheck,
    findings,
    recommendations,
    metrics,
    concentration: conc,
    relationships: rels,
    outliers: outs,
    data_quality: quality,
    sources: table.sources,
    methodology: {
      cohort: `The prospect plus ${table.competitor_count} competitors found in the search radius.`,
      percentile: 'Percentile rank within the cohort, ties counted as half (0 = lowest, 100 = highest).',
      reputation: `Bayesian-adjusted Google rating: (C×m + n×r) ÷ (C + n) with m = cohort mean rating (${table.scoring.prior_mean_rating}) and C = ${table.scoring.prior_weight_reviews} reviews, then ranked as a percentile.`,
      visibility: 'Average of the percentile ranks of Google review count and total sourced social followers.',
      engagement: 'Percentile rank of Instagram engagement rate (average likes + comments per post ÷ followers).',
      composite: `Weighted average of available scores: reputation ${table.weights.reputation}, visibility ${table.weights.visibility}, engagement ${table.weights.engagement}; weights are re-normalised when a score is unavailable.`,
      position: 'Market Leader: reputation ≥ 50 and visibility ≥ 50. Challenger: visibility ≥ 50, reputation < 50. Hidden Gem: reputation ≥ 50, visibility < 50. Falling Behind: both < 50.',
      concentration: HHI_REFERENCE.label,
    },
    methodology_ar: {
      cohort: `النشاط المستهدف و${table.competitor_count} منافسًا ضمن نطاق البحث.`,
      percentile: 'الترتيب المئيني داخل المجموعة، مع احتساب القيم المتساوية بالنصف (0 = الأدنى، 100 = الأعلى).',
      reputation: `تقييم Google المعدَّل بايزيًا: (C×m + n×r) ÷ (C + n) حيث m = متوسط تقييم المجموعة (${table.scoring.prior_mean_rating}) وC = ${table.scoring.prior_weight_reviews} تقييمًا، ثم يُحوَّل إلى ترتيب مئيني.`,
      visibility: 'متوسط الترتيب المئيني لعدد تقييمات Google وإجمالي المتابعين الموثقين.',
      engagement: 'الترتيب المئيني لمعدل التفاعل على إنستغرام (متوسط الإعجابات والتعليقات لكل منشور ÷ المتابعين).',
      composite: `متوسط مرجّح للمؤشرات المتاحة: السمعة ${table.weights.reputation}، الحضور ${table.weights.visibility}، التفاعل ${table.weights.engagement}؛ ويُعاد توزيع الأوزان عند غياب أحد المؤشرات.`,
      position: 'رائد السوق: سمعة ≥ 50 وحضور ≥ 50. منافس صاعد: حضور ≥ 50 وسمعة < 50. جوهرة مخفية: سمعة ≥ 50 وحضور < 50. متأخر: كلاهما < 50.',
      concentration: 'إرشادات الاندماج الأمريكية (وزارة العدل ولجنة التجارة الفيدرالية 2023): مؤشر HHI فوق 1,800 يعني سوقًا شديد التركّز، ومن 1,000 إلى 1,800 متوسط التركّز.',
    },
  };
}
