// Base44 backend-function handlers. They only use the Base44 SDK client that
// is passed in, so they run unchanged in a Base44 (Deno) function and in Node
// tests with a fake client.

import { findCompetitors, findProspect } from './connectors/googlePlaces.js';
import { fetchInstagramProfile, instagramHandle } from './connectors/metaGraph.js';
import { generateCompetitivePositionReport } from './pipeline.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function languagesFor(prospect, body) {
  if (Array.isArray(body.languages) && body.languages.length) return body.languages.filter((l) => l === 'en' || l === 'ar');
  const pref = prospect.report_language || 'both';
  return pref === 'both' ? ['en', 'ar'] : [pref];
}

async function requireUser(base44) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw new HttpError(401, 'Sign in required');
  return user;
}

async function loadProspect(entities, prospectId) {
  if (!prospectId) throw new HttpError(400, 'prospect_id is required');
  const prospect = await entities.Prospect.get(prospectId).catch(() => null);
  if (!prospect) throw new HttpError(404, `Prospect ${prospectId} not found`);
  return prospect;
}

async function agencySettings(entities) {
  const list = await entities.AgencySettings.list().catch(() => []);
  return (list && list[0]) || {};
}

function logEntry(prospect, agent, message, status = 'completed') {
  const log = Array.isArray(prospect.agent_log) ? prospect.agent_log.slice(-49) : [];
  log.push({ step: (log.length ? log[log.length - 1].step || log.length : 0) + 1, agent, status, message, timestamp: new Date().toISOString() });
  return log;
}

/**
 * generateCompetitivePosition: builds the competitor table + analytical
 * report from the stored records and writes it to Report / Benchmark /
 * Competitor. Body: { prospect_id, languages?: ['en','ar'], use_llm?: boolean }
 */
export async function handleGenerateCompetitivePosition(base44, body = {}, options = {}) {
  await requireUser(base44);
  const db = base44.asServiceRole.entities;
  const prospect = await loadProspect(db, body.prospect_id);
  const [competitors, socialProfiles, reviews, settings] = await Promise.all([
    db.Competitor.filter({ prospect_id: prospect.id }),
    db.SocialProfile.filter({ prospect_id: prospect.id }),
    db.ReviewData.filter({ prospect_id: prospect.id }),
    agencySettings(db),
  ]);
  const languages = languagesFor(prospect, body);
  const llm = body.use_llm === false ? undefined : async (prompt) => {
    const out = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt });
    return typeof out === 'string' ? out : JSON.stringify(out);
  };

  const result = await generateCompetitivePositionReport(
    { prospect, competitors: competitors.filter((c) => c.out_of_radius !== true), socialProfiles, reviews },
    { languages, llm, now: options.now, maxAgeDays: body.max_age_days ?? options.maxAgeDays, brandColor: settings.brand_color },
  );

  // Reports: one per language, paired.
  const existing = await db.Report.filter({ prospect_id: prospect.id });
  const saved = {};
  for (const lang of languages) {
    const fields = result.versions[lang].report_fields;
    const current = existing.find((r) => (r.language || 'en') === lang);
    const data = { ...fields, language: lang, vertical: prospect.vertical ?? current?.vertical ?? null };
    saved[lang] = current
      ? await db.Report.update(current.id, data)
      : await db.Report.create({ prospect_id: prospect.id, title: `${prospect.business_name} — ${lang === 'ar' ? 'تقرير المنافسة' : 'Competitive report'}`, ...data });
  }
  if (saved.en && saved.ar) {
    await db.Report.update(saved.en.id, { paired_report_id: saved.ar.id });
    await db.Report.update(saved.ar.id, { paired_report_id: saved.en.id });
  }

  // Benchmarks are replaced as a set.
  await db.Benchmark.deleteMany({ prospect_id: prospect.id });
  if (result.benchmarks.length) await db.Benchmark.bulkCreate(result.benchmarks);

  // Position on each competitor row (used by the dashboard).
  for (const row of result.table.rows.filter((r) => !r.is_prospect)) {
    await db.Competitor.update(row.business_id, {
      market_position: row.position, market_rank: row.rank, market_position_score: row.scores.composite,
    });
  }

  const first = result.versions[languages[0]].analysis;
  await db.Prospect.update(prospect.id, {
    agent_log: logEntry(prospect, 'Analytical Agent',
      `Ranked #${result.table.prospect_rank ?? '–'} of ${result.table.ranked_count}; ${first.findings.length} findings; data coverage ${first.data_quality.coverage_pct}% (${first.data_quality.grade}); narrative ${first.narrative_source}.`),
  });

  return {
    prospect_id: prospect.id,
    report_ids: Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, v.id])),
    rank: result.table.prospect_rank,
    ranked_count: result.table.ranked_count,
    position: result.table.prospect.position,
    data_coverage_pct: first.data_quality.coverage_pct,
    narrative_source: Object.fromEntries(languages.map((l) => [l, result.versions[l].analysis.narrative_source])),
    sources: result.table.sources.length,
  };
}

/**
 * refreshMarketData: pulls live numbers from Google Places (prospect +
 * competitors in the radius) and Meta Graph (Instagram profiles) and stores
 * them with provenance. Body: { prospect_id, radius_miles?: 5, included_types?: string[] }
 */
export async function handleRefreshMarketData(base44, body = {}, options = {}) {
  await requireUser(base44);
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date().toISOString();
  const db = base44.asServiceRole.entities;
  let prospect = await loadProspect(db, body.prospect_id);
  const settings = await agencySettings(db);
  const keys = settings.api_keys || {};
  const summary = { prospect_id: prospect.id, prospect_updated: false, competitors_created: 0, competitors_updated: 0,
    competitors_out_of_radius: 0, instagram_updated: 0, instagram_not_found: 0, skipped: [] };

  if (!keys.google_maps) {
    summary.skipped.push('Google Places: no API key in Agency Settings');
  } else {
    const query = [prospect.business_name, prospect.address].filter(Boolean).join(', ');
    const found = await findProspect({ query, apiKey: keys.google_maps, fetchImpl, now,
      languageCode: prospect.report_language === 'ar' ? 'ar' : 'en' });
    if (found) {
      const { business_name: _name, business_status: _status, ...placeFields } = found;
      prospect = await db.Prospect.update(prospect.id, {
        ...placeFields,
        data_sources: { ...(prospect.data_sources || {}), ...found.data_sources },
      });
      summary.prospect_updated = true;
    } else {
      summary.skipped.push(`Google Places: no match for "${query}"`);
    }

    if (typeof prospect.latitude === 'number') {
      const competitors = await findCompetitors({
        prospect, apiKey: keys.google_maps, fetchImpl, now,
        radiusMiles: body.radius_miles ?? 5, includedTypes: body.included_types,
      });
      const existing = await db.Competitor.filter({ prospect_id: prospect.id });
      const byPlace = new Map(existing.filter((c) => c.google_place_id).map((c) => [c.google_place_id, c]));
      const seen = new Set();
      for (const c of competitors) {
        seen.add(c.google_place_id);
        const { business_status: _status, ...rec } = c;
        const match = byPlace.get(c.google_place_id);
        if (match) {
          await db.Competitor.update(match.id, { ...rec, out_of_radius: false, last_seen_at: now });
          summary.competitors_updated += 1;
        } else {
          await db.Competitor.create({ prospect_id: prospect.id, ...rec, out_of_radius: false, last_seen_at: now });
          summary.competitors_created += 1;
        }
      }
      for (const c of existing) {
        if (c.google_place_id && !seen.has(c.google_place_id) && c.out_of_radius !== true) {
          await db.Competitor.update(c.id, { out_of_radius: true });
          summary.competitors_out_of_radius += 1;
        }
      }
    }
  }

  if (!keys.meta_graph || !keys.meta_ig_user_id) {
    summary.skipped.push('Instagram: Meta Graph token or Instagram business account id missing in Agency Settings');
  } else {
    const profiles = (await db.SocialProfile.filter({ prospect_id: prospect.id })).filter((p) => p.platform === 'instagram');
    for (const p of profiles) {
      const handle = instagramHandle(p.handle || p.profile_url);
      if (!handle) continue;
      const data = await fetchInstagramProfile({ handle, igUserId: keys.meta_ig_user_id, accessToken: keys.meta_graph, fetchImpl, now });
      const { not_found_reason: reason, ...fields } = data;
      await db.SocialProfile.update(p.id, { ...fields, ...(reason ? { not_found_reason: reason } : {}) });
      if (data.profile_found) summary.instagram_updated += 1;
      else summary.instagram_not_found += 1;
    }
  }

  await db.Prospect.update(prospect.id, {
    agent_log: logEntry(prospect, 'Market Data Agent',
      `Google Places: ${summary.competitors_created} new, ${summary.competitors_updated} refreshed competitors; Instagram: ${summary.instagram_updated} profiles refreshed.${summary.skipped.length ? ` Skipped: ${summary.skipped.join('; ')}` : ''}`),
  });
  return summary;
}

/** Wraps a handler as a Deno.serve-style request handler. */
export function toRequestHandler(handler, createClientFromRequest) {
  return async (req) => {
    try {
      const base44 = createClientFromRequest(req);
      const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
      const result = await handler(base44, body);
      return Response.json(result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      return Response.json({ error: String(err && err.message ? err.message : err) }, { status });
    }
  };
}
