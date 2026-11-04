# Installing into the OnSocial Base44 app

Target app: **OnSocial prospecting agent**, Base44 app `6a05e4818d8ca2a744ac7efc`
(editor: https://app.base44.com/apps/6a05e4818d8ca2a744ac7efc/editor/preview).

The app already has the entities `AgencySettings`, `Prospect`, `Competitor`, `SocialProfile`, `ReviewData`, `Benchmark`, `Report` and `Proposal`. This install only **adds** fields, functions and UI. It does not remove or rename anything.

## 1. Entity fields

Add the fields listed in [`base44/entities/schema-changes.json`](../base44/entities/schema-changes.json):

- `data_sources` (object) on Prospect, Competitor, SocialProfile and ReviewData. This holds the provenance of each field.
- On Competitor: `market_position`, `market_rank`, `market_position_score`, `out_of_radius` and `last_seen_at`.
- On Report: `competitor_table`, `analytical_report`, `analytical_summary`, `data_sources`, `data_quality`, `market_position`, `market_rank`, `market_position_score` and `analysis_generated_at`.
- On AgencySettings: `api_keys.meta_ig_user_id`.

## 2. Backend functions

Create two backend functions. Paste in the generated files exactly as they are. Each one is a single self-contained Deno file:

| Function | File | Body |
| --- | --- | --- |
| `refreshMarketData` | `base44/dist/functions/refreshMarketData.js` | `{ prospect_id, radius_miles?, included_types? }` |
| `generateCompetitivePosition` | `base44/dist/functions/generateCompetitivePosition.js` | `{ prospect_id, languages?, use_llm? }` |

Both functions require a signed-in user and use the service role for reads and writes. `generateCompetitivePosition` does the following:

- Writes the EN and/or AR `Report` (following `Prospect.report_language`) and pairs them.
- Replaces the prospect's `Benchmark` rows.
- Sets the position on each `Competitor`.
- Appends an "Analytical Agent" entry to `Prospect.agent_log`.

Do not edit `base44/dist` by hand. Change `src/`, run `npm run build:base44`, and paste the files again.

## 3. Pipeline wiring

In the orchestrator, after the Review Analyzer step and before the Strategy and Proposal steps, add:

```js
await base44.functions.invoke('refreshMarketData', { prospect_id });
await base44.functions.invoke('generateCompetitivePosition', { prospect_id });
```

Once these run, the Strategy Generator and Proposal Builder can use `Report.analytical_report.findings` and `recommendations` instead of free-form LLM text, so the pitch matches the measured gaps.

## 4. Report page

Copy `base44/components/CompetitorPositionTable.jsx` and `AnalyticalReportSection.jsx` to `src/components/report/` and render the section on the report page and the public share page:

```jsx
import AnalyticalReportSection from '@/components/report/AnalyticalReportSection';

<AnalyticalReportSection
  report={report}
  brandColor={settings.brand_color}
  regenerating={busy}
  onRegenerate={async () => { setBusy(true); await base44.functions.invoke('generateCompetitivePosition', { prospect_id: report.prospect_id }); await refetch(); setBusy(false); }}
/>
```

Both components use Tailwind only and lay themselves out right-to-left when the report language is Arabic. For the PDF export, `renderCompetitorTableHtml()` in `src/render.js` produces the same table as standalone HTML with inline CSS.

## 5. Agency settings

In **Settings**, fill in the Google Maps key (with the Places API (New) enabled), the Meta Graph token and the Instagram Business account ID. If any of these are missing, the refresh step lists it as skipped, and the report shows the related metrics as "n/a" instead of inventing them.
