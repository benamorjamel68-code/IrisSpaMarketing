// End-to-end: Base44 records in, competitor table + analytical report out,
// in one or both languages, with fields shaped for the Base44 `Report` entity.

import { runAnalysis, toBenchmarkRecords } from './analyticsAgent.js';
import { buildCompetitorTable } from './marketPosition.js';
import { renderAnalyticalReportMarkdown, renderCompetitorTableHtml, renderCompetitorTableMarkdown } from './render.js';

/**
 * @param {object} input  { prospect, competitors, socialProfiles, reviews }
 * @param {object} [options]
 * @param {('en'|'ar')[]} [options.languages=['en']]
 * @param {(prompt: string) => Promise<string>} [options.llm]
 * @param {string} [options.now]
 * @param {number} [options.maxAgeDays]
 * @param {object} [options.weights]
 * @param {string} [options.brandColor]
 */
export async function generateCompetitivePositionReport(input, options = {}) {
  const languages = options.languages && options.languages.length ? options.languages : ['en'];
  const table = buildCompetitorTable(input, options);
  const versions = {};
  for (const lang of languages) {
    const analysis = await runAnalysis(table, { lang, llm: options.llm });
    versions[lang] = {
      analysis,
      markdown: renderAnalyticalReportMarkdown(analysis, table, { lang }),
      table_markdown: renderCompetitorTableMarkdown(table, { lang }),
      table_html: renderCompetitorTableHtml(table, { lang, brandColor: options.brandColor }),
      report_fields: toReportFields(table, analysis, lang),
    };
  }
  const first = versions[languages[0]].analysis;
  return {
    table,
    versions,
    benchmarks: toBenchmarkRecords(input.prospect.id, first.metrics),
  };
}

/** Fields written onto the Base44 `Report` record for one language. */
export function toReportFields(table, analysis, lang) {
  const p = table.prospect;
  const strengths = analysis.findings.filter((f) => f.severity === 'ahead' || f.severity === 'leading')
    .map((f) => (lang === 'ar' ? f.headline_ar : f.headline));
  const weaknesses = analysis.findings.filter((f) => f.severity === 'critical' || f.severity === 'moderate')
    .map((f) => (lang === 'ar' ? f.headline_ar : f.headline));
  const overall = analysis.findings.find((f) => f.id === 'overall_position');
  return {
    competitor_count: table.competitor_count,
    competitive_position: overall ? (lang === 'ar' ? `${overall.headline_ar} ${overall.detail_ar}` : `${overall.headline} ${overall.detail}`) : null,
    market_position: p.position,
    market_rank: p.rank,
    market_position_score: p.scores.composite,
    key_strengths: strengths,
    key_weaknesses: weaknesses,
    competitor_table: table,
    analytical_report: analysis,
    analytical_summary: analysis.narrative,
    data_sources: table.sources,
    data_quality: { coverage_pct: analysis.data_quality.coverage_pct, grade: analysis.data_quality.grade },
    analysis_generated_at: table.generated_at,
  };
}
