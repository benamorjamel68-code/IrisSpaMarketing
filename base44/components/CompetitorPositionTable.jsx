// Competitor market-position table for the report page (and public share page).
// Drop into the Base44 app at src/components/report/CompetitorPositionTable.jsx
// and render with: <CompetitorPositionTable table={report.competitor_table} lang={report.language} />
import React, { useMemo, useState } from 'react';

const LABELS = {
  en: { title: 'Competitor market position', rank: '#', business: 'Business', position: 'Market position', score: 'Score',
    you: 'You', na: 'n/a', sources: 'Sources', fetched: 'fetched', all: 'All metrics', compact: 'Key metrics',
    legend: 'Scores are 0–100 and relative to this local market. "n/a" means no sourced value was available; nothing is estimated.' },
  ar: { title: 'المكانة السوقية للمنافسين', rank: '#', business: 'النشاط', position: 'المكانة السوقية', score: 'المؤشر',
    you: 'أنت', na: 'غير متوفر', sources: 'المصادر', fetched: 'تاريخ الجمع', all: 'كل المؤشرات', compact: 'المؤشرات الرئيسية',
    legend: 'المؤشرات من 0 إلى 100 وهي نسبية لهذا السوق المحلي. «غير متوفر» تعني عدم وجود قيمة موثقة؛ ولا يتم تقدير أي رقم.' },
};

const KEY_COLUMNS = ['google_rating', 'google_review_count', 'review_share_pct', 'instagram_followers', 'instagram_engagement_rate', 'distance_miles'];

const POSITION_STYLE = {
  leader: 'bg-green-100 text-green-800',
  challenger: 'bg-yellow-100 text-yellow-800',
  niche: 'bg-indigo-100 text-indigo-800',
  laggard: 'bg-red-100 text-red-800',
  insufficient: 'bg-slate-100 text-slate-600',
};

function formatCell(column, cell, lang, na) {
  if (!cell || cell.value === null || cell.value === undefined) return na;
  const n = Number(cell.value).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', {
    minimumFractionDigits: column.digits, maximumFractionDigits: column.digits,
  });
  if (column.unit === 'pct') return `${n}%`;
  if (column.unit === 'stars') return `${n}★`;
  if (column.unit === 'miles') return lang === 'ar' ? `${n} ميل` : `${n} mi`;
  return n;
}

export default function CompetitorPositionTable({ table, lang = 'en', brandColor = '#3B82F6' }) {
  const t = LABELS[lang] || LABELS.en;
  const [showAll, setShowAll] = useState(false);
  const columns = useMemo(() => {
    if (!table) return [];
    return showAll ? table.columns : table.columns.filter((c) => KEY_COLUMNS.includes(c.key));
  }, [table, showAll]);

  if (!table || !table.rows || !table.rows.length) return null;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <section dir={dir} lang={lang} className="w-full">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-slate-900">{t.title}</h3>
        <button type="button" onClick={() => setShowAll((v) => !v)}
          className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 print:hidden">
          {showAll ? t.compact : t.all}
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t.rank}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t.business}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t.position}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t.score}</th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="whitespace-nowrap px-3 py-2 text-start font-medium">
                  {lang === 'ar' ? c.label_ar : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.business_id} className="border-t border-slate-100"
                style={row.is_prospect ? { backgroundColor: `${brandColor}14` } : undefined}>
                <td className="px-3 py-2 text-slate-500">{row.rank ?? '–'}</td>
                <th scope="row" className="whitespace-nowrap px-3 py-2 text-start font-medium text-slate-900">
                  {row.business_name}
                  {row.is_prospect && (
                    <span className="ms-2 rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: brandColor }}>{t.you}</span>
                  )}
                </th>
                <td className="px-3 py-2">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${POSITION_STYLE[row.position] || POSITION_STYLE.insufficient}`}>
                    {lang === 'ar' ? row.position_label_ar : row.position_label}
                  </span>
                </td>
                <td className="px-3 py-2 font-semibold text-slate-900">{row.scores?.composite ?? t.na}</td>
                {columns.map((c) => {
                  const cell = row.cells[c.key];
                  const missing = !cell || cell.value === null;
                  return (
                    <td key={c.key} title={missing ? cell?.missing_reason : cell.note || ''}
                      className={`whitespace-nowrap px-3 py-2 ${missing ? 'text-slate-400' : 'text-slate-800'}`}>
                      {formatCell(c, cell, lang, t.na)}
                      {!missing && cell.citations?.length > 0 && (
                        <sup className="ms-0.5 text-[10px] text-slate-400">
                          {cell.citations.map((id, i) => (
                            <a key={id} href={`#source-${id}`} className="hover:underline">{i ? ',' : ''}{id}</a>
                          ))}
                        </sup>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">{t.legend}</p>
      {table.sources?.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.sources}</h4>
          <ol className="mt-1 list-decimal space-y-0.5 ps-5 text-xs text-slate-500">
            {table.sources.map((s) => (
              <li key={s.id} id={`source-${s.id}`}>
                {lang === 'ar' ? s.label_ar : s.label}
                {s.url && (<> — <a href={s.url} target="_blank" rel="noreferrer" className="break-all underline">{s.url}</a></>)}
                {s.fetched_at && ` (${t.fetched} ${s.fetched_at.slice(0, 10)})`}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
