// Renderers for the competitor table and the analytical report.
// Markdown (for PDFs / LLM context / email) and self-contained HTML
// (for the public share page). Arabic output is right-to-left.

import { round } from './stats.js';

const T = {
  en: {
    tableTitle: 'Competitor market position',
    rank: '#', business: 'Business', position: 'Market position', score: 'Position score',
    you: '(you)', na: 'n/a', sources: 'Sources', fetched: 'fetched', notAvailable: 'Not available',
    analysis: 'Analytical report', findings: 'Key findings', recs: 'What to fix first',
    quality: 'Data quality', coverage: 'Metric coverage', method: 'Methodology',
    concentration: 'Market concentration', priority: { high: 'High', medium: 'Medium', low: 'Low' },
    notCollected: 'Not collected for any business',
    legend: 'Scores are 0–100 and relative to this local market. "n/a" means no sourced value was available; nothing is estimated.',
  },
  ar: {
    tableTitle: 'المكانة السوقية للمنافسين',
    rank: '#', business: 'النشاط', position: 'المكانة السوقية', score: 'مؤشر المكانة',
    you: '(أنت)', na: 'غير متوفر', sources: 'المصادر', fetched: 'تاريخ الجمع', notAvailable: 'غير متوفر',
    analysis: 'التقرير التحليلي', findings: 'أهم النتائج', recs: 'الأولويات',
    quality: 'جودة البيانات', coverage: 'نسبة توفر المؤشرات', method: 'المنهجية',
    concentration: 'تركّز السوق', priority: { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' },
    notCollected: 'لم تُجمع لأي نشاط',
    legend: 'المؤشرات من 0 إلى 100 وهي نسبية لهذا السوق المحلي. «غير متوفر» تعني عدم وجود قيمة موثقة؛ ولا يتم تقدير أي رقم.',
  },
};

/** Default columns for the report (a compact subset of the full table). */
export const DEFAULT_REPORT_COLUMNS = [
  'google_rating', 'google_review_count', 'review_share_pct', 'instagram_followers',
  'instagram_engagement_rate', 'total_social_followers', 'distance_miles',
];

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mdEsc(s) {
  return String(s ?? '').replace(/\|/g, '\\|');
}

export function formatValue(column, cell, lang = 'en') {
  if (!cell || cell.value === null || cell.value === undefined) return T[lang].na;
  const r = round(cell.value, column.digits);
  const n = r.toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: column.digits, maximumFractionDigits: column.digits });
  if (column.unit === 'pct') return `${n}%`;
  if (column.unit === 'stars') return `${n}★`;
  if (column.unit === 'miles') return lang === 'ar' ? `${n} ميل` : `${n} mi`;
  return n;
}

/** "[1][2][3][5]" → "[1–3][5]" so long citation lists stay readable. */
export function cite(ids) {
  if (!ids || !ids.length) return '';
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const out = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const id of [...sorted.slice(1), null]) {
    if (id === prev + 1) { prev = id; continue; }
    out.push(start === prev ? `[${start}]` : prev === start + 1 ? `[${start}][${prev}]` : `[${start}–${prev}]`);
    start = id;
    prev = id;
  }
  return out.join('');
}

const METHOD_LABELS = {
  en: { cohort: 'Cohort', percentile: 'Percentile', reputation: 'Reputation', visibility: 'Visibility', engagement: 'Engagement',
    composite: 'Position score', position: 'Market position', concentration: 'Concentration' },
  ar: { cohort: 'المجموعة', percentile: 'المئين', reputation: 'السمعة', visibility: 'الحضور', engagement: 'التفاعل',
    composite: 'مؤشر المكانة', position: 'المكانة السوقية', concentration: 'التركّز' },
};

function pickColumns(table, keys) {
  const wanted = keys || DEFAULT_REPORT_COLUMNS;
  return wanted.map((k) => table.columns.find((c) => c.key === k)).filter(Boolean);
}

function sourceLine(s, lang) {
  const label = lang === 'ar' ? s.label_ar : s.label;
  const date = s.fetched_at ? ` (${T[lang].fetched} ${s.fetched_at.slice(0, 10)})` : '';
  return `${label}${s.url ? ` — ${s.url}` : ''}${date}`;
}

export function renderCompetitorTableMarkdown(table, { lang = 'en', columns } = {}) {
  const t = T[lang];
  const cols = pickColumns(table, columns);
  const header = [t.rank, t.business, t.position, t.score, ...cols.map((c) => (lang === 'ar' ? c.label_ar : c.label))];
  const lines = [
    `### ${t.tableTitle}`,
    '',
    `| ${header.map(mdEsc).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  for (const r of table.rows) {
    const name = r.is_prospect ? `**${mdEsc(r.business_name)}** ${t.you}` : mdEsc(r.business_name);
    const cells = cols.map((c) => {
      const cell = r.cells[c.key];
      return `${formatValue(c, cell, lang)}${cite(cell.citations)}`;
    });
    lines.push(`| ${r.rank ?? '–'} | ${name} | ${lang === 'ar' ? r.position_label_ar : r.position_label} | ${r.scores.composite ?? t.na} | ${cells.join(' | ')} |`);
  }
  lines.push('', `_${t.legend}_`, '', `**${t.sources}**`, '');
  for (const s of table.sources) lines.push(`${s.id}. ${sourceLine(s, lang)}`);
  return lines.join('\n');
}

export function renderAnalyticalReportMarkdown(report, table, { lang = 'en' } = {}) {
  const t = T[lang];
  const lines = [`## ${t.analysis}`, '', report.narrative, '', `### ${t.findings}`, ''];
  for (const f of report.findings) {
    lines.push(`- **${lang === 'ar' ? f.headline_ar : f.headline}** ${lang === 'ar' ? f.detail_ar : f.detail} ${cite(f.citations)}`.trim());
  }
  if (report.recommendations.length) {
    lines.push('', `### ${t.recs}`, '');
    report.recommendations.forEach((r, i) => {
      lines.push(`${i + 1}. **${lang === 'ar' ? r.title_ar : r.title}** (${t.priority[r.priority]}) — ${lang === 'ar' ? r.gap_addressed_ar : r.gap_addressed} ${cite(r.citations)}`.trim());
    });
  }
  lines.push('', renderCompetitorTableMarkdown(table, { lang }));
  lines.push('', `### ${t.quality}`, '', `${t.coverage}: ${report.data_quality.coverage_pct}% (${report.data_quality.grade})`, '');
  const skip = new Set(report.data_quality.not_collected_for_any_business || []);
  if (skip.size) {
    const labels = table.columns.filter((c) => skip.has(c.key)).map((c) => (lang === 'ar' ? c.label_ar : c.label));
    lines.push(`- ${t.notCollected}: ${labels.join(', ')}`);
  }
  for (const b of report.data_quality.businesses) {
    const miss = b.missing.filter((m) => !skip.has(m.metric));
    if (!miss.length) continue;
    lines.push(`- ${b.business_name}: ${miss.map((m) => `${lang === 'ar' ? m.label_ar : m.label} (${m.reason})`).join(', ')}`);
  }
  lines.push('', `### ${t.method}`, '');
  const method = lang === 'ar' && report.methodology_ar ? report.methodology_ar : report.methodology;
  for (const [k, v] of Object.entries(method)) lines.push(`- **${METHOD_LABELS[lang][k] || k}:** ${v}`);
  return lines.join('\n');
}

export function renderCompetitorTableHtml(table, { lang = 'en', columns, brandColor = '#3B82F6' } = {}) {
  const t = T[lang];
  const cols = pickColumns(table, columns);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const head = [t.rank, t.business, t.position, t.score, ...cols.map((c) => (lang === 'ar' ? c.label_ar : c.label))]
    .map((h) => `<th scope="col">${esc(h)}</th>`).join('');
  const body = table.rows.map((r) => {
    const tds = cols.map((c) => {
      const cell = r.cells[c.key];
      const title = cell.value === null ? cell.missing_reason : (cell.note || '');
      const sup = cell.citations.length ? `<sup>${cell.citations.map((i) => `<a href="#src-${i}">${i}</a>`).join(',')}</sup>` : '';
      return `<td title="${esc(title)}" class="${cell.value === null ? 'na' : ''}">${esc(formatValue(c, cell, lang))}${sup}</td>`;
    }).join('');
    return `<tr class="${r.is_prospect ? 'prospect' : ''}"><td>${r.rank ?? '–'}</td><th scope="row">${esc(r.business_name)}${r.is_prospect ? ` <span class="you">${esc(t.you)}</span>` : ''}</th>`
      + `<td><span class="pos pos-${esc(r.position)}">${esc(lang === 'ar' ? r.position_label_ar : r.position_label)}</span></td>`
      + `<td><strong>${r.scores.composite ?? esc(t.na)}</strong></td>${tds}</tr>`;
  }).join('\n');
  const sources = table.sources.map((s) => `<li id="src-${s.id}">${esc(sourceLine(s, lang))}</li>`).join('');
  return `<section class="competitor-table" dir="${dir}" lang="${lang}" style="--brand:${esc(brandColor)}">
<h3>${esc(t.tableTitle)}</h3>
<div class="scroll"><table>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody></table></div>
<p class="legend">${esc(t.legend)}</p>
<ol class="sources">${sources}</ol>
<style>
.competitor-table{font-family:system-ui,sans-serif;color:#0f172a}
.competitor-table .scroll{overflow-x:auto}
.competitor-table table{border-collapse:collapse;width:100%;font-size:14px}
.competitor-table th,.competitor-table td{padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:start;white-space:nowrap}
.competitor-table thead th{background:#f8fafc;font-weight:600}
.competitor-table tr.prospect{background:color-mix(in srgb,var(--brand) 10%,white)}
.competitor-table td.na{color:#94a3b8}
.competitor-table .you{color:var(--brand);font-weight:600}
.competitor-table .pos{padding:2px 8px;border-radius:999px;font-size:12px;background:#e2e8f0}
.competitor-table .pos-leader{background:#dcfce7;color:#166534}
.competitor-table .pos-challenger{background:#fef9c3;color:#854d0e}
.competitor-table .pos-niche{background:#e0e7ff;color:#3730a3}
.competitor-table .pos-laggard{background:#fee2e2;color:#991b1b}
.competitor-table .legend,.competitor-table .sources{font-size:12px;color:#475569}
</style>
</section>`;
}
