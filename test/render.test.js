import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAnalysis } from '../src/analyticsAgent.js';
import { buildCompetitorTable } from '../src/marketPosition.js';
import { cite, formatValue, renderAnalyticalReportMarkdown, renderCompetitorTableHtml, renderCompetitorTableMarkdown } from '../src/render.js';
import { cohort, NOW } from './fixtures/cohort.js';

const table = buildCompetitorTable(cohort(), { now: NOW });

test('cite compresses consecutive footnotes', () => {
  assert.equal(cite([1, 2, 3, 5, 7, 8]), '[1–3][5][7][8]');
  assert.equal(cite([4]), '[4]');
  assert.equal(cite([]), '');
  assert.equal(cite([3, 1, 2, 2]), '[1–3]');
});

test('formatValue prints units and n/a for missing values', () => {
  const col = (unit, digits) => ({ unit, digits });
  assert.equal(formatValue(col('stars', 1), { value: 4.25 }), '4.3★');
  assert.equal(formatValue(col('pct', 2), { value: 1.4 }), '1.40%');
  assert.equal(formatValue(col('count', 0), { value: 45000 }), '45,000');
  assert.equal(formatValue(col('miles', 1), { value: 2.46 }), '2.5 mi');
  assert.equal(formatValue(col('count', 0), { value: null }), 'n/a');
  assert.equal(formatValue(col('count', 0), { value: null }, 'ar'), 'غير متوفر');
  assert.equal(formatValue(col('count', 0), { value: 1200 }, 'ar'), '١٬٢٠٠');
});

test('markdown table has one row per business, marks the prospect and lists sources', () => {
  const md = renderCompetitorTableMarkdown(table);
  const rows = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| ---') && !l.startsWith('| #'));
  assert.equal(rows.length, 7);
  assert.match(md, /\*\*Fixture Prospect Spa\*\* \(you\)/);
  assert.match(md, /4\.8★\[1\]/);
  for (const s of table.sources) assert.ok(md.includes(`${s.id}. `));
  assert.match(md, /nothing is estimated/);
});

test('Arabic markdown uses Arabic labels', () => {
  const md = renderCompetitorTableMarkdown(table, { lang: 'ar' });
  assert.match(md, /المكانة السوقية للمنافسين/);
  assert.match(md, /رائد السوق/);
  assert.match(md, /\(أنت\)/);
});

test('HTML table escapes names, links footnotes and sets RTL for Arabic', () => {
  const evil = cohort();
  evil.competitors[0].business_name = '<script>alert(1)</script>';
  const t = buildCompetitorTable(evil, { now: NOW });
  const html = renderCompetitorTableHtml(t);
  assert.ok(!html.includes('<script>alert'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="#src-1">1<\/a>/);
  assert.match(html, /<li id="src-1">/);
  assert.match(renderCompetitorTableHtml(t, { lang: 'ar' }), /dir="rtl"/);
});

test('full analytical report markdown contains every section', async () => {
  const analysis = await runAnalysis(table);
  const md = renderAnalyticalReportMarkdown(analysis, table);
  for (const h of ['## Analytical report', '### Key findings', '### What to fix first', '### Competitor market position', '### Data quality', '### Methodology']) {
    assert.ok(md.includes(h), h);
  }
  assert.match(md, /Not collected for any business: .*Facebook followers/);
  const ar = renderAnalyticalReportMarkdown(await runAnalysis(table, { lang: 'ar' }), table, { lang: 'ar' });
  assert.match(ar, /## التقرير التحليلي/);
  assert.match(ar, /\*\*السمعة:\*\*/);
});
