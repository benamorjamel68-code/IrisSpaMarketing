// Analytical Agent section for the report page.
// Drop into the Base44 app at src/components/report/AnalyticalReportSection.jsx and render with:
//   <AnalyticalReportSection report={report} onRegenerate={() => base44.functions.invoke('generateCompetitivePosition', { prospect_id })} />
import React from 'react';
import CompetitorPositionTable from './CompetitorPositionTable';

const L = {
  en: { title: 'Analytical report', findings: 'Key findings', fix: 'What to fix first', quality: 'Data quality',
    coverage: 'metric coverage', method: 'Methodology', regenerate: 'Refresh analysis', verified: 'Narrative checked against the data',
    concentration: 'Market concentration', priority: { high: 'High', medium: 'Medium', low: 'Low' } },
  ar: { title: 'التقرير التحليلي', findings: 'أهم النتائج', fix: 'الأولويات', quality: 'جودة البيانات',
    coverage: 'نسبة توفر المؤشرات', method: 'المنهجية', regenerate: 'تحديث التحليل', verified: 'تم التحقق من أرقام النص مقابل البيانات',
    concentration: 'تركّز السوق', priority: { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' } },
};

const SEVERITY_DOT = {
  critical: 'bg-red-500', moderate: 'bg-amber-500', on_par: 'bg-slate-400', ahead: 'bg-green-500', leading: 'bg-emerald-600',
};

function Cite({ ids }) {
  if (!ids || !ids.length) return null;
  return (
    <sup className="ms-1 text-[10px] text-slate-400">
      {ids.map((id, i) => <a key={id} href={`#source-${id}`} className="hover:underline">{i ? ',' : ''}{id}</a>)}
    </sup>
  );
}

export default function AnalyticalReportSection({ report, brandColor, onRegenerate, regenerating = false }) {
  const analysis = report?.analytical_report;
  if (!analysis) {
    return onRegenerate ? (
      <button type="button" onClick={onRegenerate} disabled={regenerating}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {regenerating ? '…' : L.en.regenerate}
      </button>
    ) : null;
  }
  const lang = analysis.language || report.language || 'en';
  const t = L[lang] || L.en;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const method = lang === 'ar' && analysis.methodology_ar ? analysis.methodology_ar : analysis.methodology;

  return (
    <section dir={dir} lang={lang} className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t.title}</h2>
          {analysis.narrative_source === 'llm_verified' && (
            <p className="mt-1 text-xs text-green-700">✓ {t.verified}</p>
          )}
        </div>
        {onRegenerate && (
          <button type="button" onClick={onRegenerate} disabled={regenerating}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 print:hidden">
            {regenerating ? '…' : t.regenerate}
          </button>
        )}
      </div>

      <div className="whitespace-pre-line rounded-lg bg-slate-50 p-4 leading-relaxed text-slate-800">{analysis.narrative}</div>

      <div>
        <h3 className="mb-3 text-lg font-semibold text-slate-900">{t.findings}</h3>
        <ul className="space-y-2">
          {analysis.findings.map((f) => (
            <li key={f.id} className="flex gap-3">
              <span className={`mt-1.5 h-2.5 w-2.5 flex-none rounded-full ${SEVERITY_DOT[f.severity] || 'bg-slate-300'}`} />
              <div>
                <p className="font-medium text-slate-900">{lang === 'ar' ? f.headline_ar : f.headline}<Cite ids={f.citations} /></p>
                <p className="text-sm text-slate-600">{lang === 'ar' ? f.detail_ar : f.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {analysis.recommendations?.length > 0 && (
        <div>
          <h3 className="mb-3 text-lg font-semibold text-slate-900">{t.fix}</h3>
          <ol className="list-none space-y-2 p-0">
            {analysis.recommendations.map((r, i) => (
              <li key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">{i + 1}. {lang === 'ar' ? r.title_ar : r.title}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.priority === 'high' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                    {t.priority[r.priority]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{lang === 'ar' ? r.gap_addressed_ar : r.gap_addressed}<Cite ids={r.citations} /></p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <CompetitorPositionTable table={report.competitor_table} lang={lang} brandColor={brandColor} />

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{t.quality}</h3>
          <p className="text-3xl font-bold text-slate-900">{analysis.data_quality.coverage_pct}%
            <span className="ms-2 text-base font-medium text-slate-500">{t.coverage} · {analysis.data_quality.grade}</span></p>
          {analysis.concentration && (
            <p className="mt-2 text-sm text-slate-600">{t.concentration}: HHI {analysis.concentration.hhi.toLocaleString()}</p>
          )}
        </div>
        <details className="text-sm text-slate-600">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-500">{t.method}</summary>
          <ul className="mt-2 list-disc space-y-1 ps-5">
            {Object.entries(method || {}).map(([k, v]) => <li key={k}>{v}</li>)}
          </ul>
        </details>
      </div>
    </section>
  );
}
