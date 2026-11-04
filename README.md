# IrisSpaMarketing: OnSocial report engine

This repo holds the reporting engine behind the OnSocial prospect reports, the competitor analysis that the OnSocial prospecting agent (a Base44 app) sends to local businesses. It adds three things to those reports:

1. **A competitor market-position table.** It has one row for the prospect and one for each competitor in the search radius. Each row shows a rank, a market-position quadrant (Market Leader, Challenger, Hidden Gem or Falling Behind) and a 0–100 position score. It also shows Google rating, review volume, share of local reviews, Instagram reach and engagement, and distance.
2. **Real numbers only, each with a source.** Each value in a report carries its source, link and fetch date, and has a numbered footnote. A missing, stale or placeholder value shows as **"n/a"** along with the reason. The engine never estimates a number.
3. **An analytical agent.** It reads the numbers and writes an analytical report. The report covers cohort statistics, the prospect's gaps against the median and the best competitor, market concentration (HHI), how the metrics relate to each other, outliers, the number of 5-star reviews needed to reach the local median, ranked findings, recommendations and a data-quality grade. An LLM can write the summary paragraph, but its text is used only if every number in it matches the computed data. Otherwise the engine falls back to a summary built directly from the data.

The engine writes English and Arabic reports, and the Arabic version is laid out right-to-left.

## Quick start

```bash
npm test               # 56 tests (Node 22+, no dependencies)
npm run demo           # prints the analytical report for the test fixture
npm run demo -- ar     # same, in Arabic
npm run build:base44   # regenerates the Base44 backend functions in base44/dist/
npm run check          # verifies base44/dist is up to date, then runs the tests
```

The demo uses **fictional fixture data** (businesses named "Fixture …"). Real reports get their numbers from the Google Places API and the Meta Graph API through `refreshMarketData`.

## Layout

| Path | What it is |
| --- | --- |
| `src/provenance.js` | Source registry, placeholder detection, freshness checks, citation ledger |
| `src/stats.js` | Statistics helpers: mean, median, quantiles, percentile rank, Bayesian rating, HHI, Pearson correlation, haversine distance |
| `src/marketPosition.js` | `buildCompetitorTable()`, which builds the competitor market-position table |
| `src/analyticsAgent.js` | `runAnalysis()`, the analytical agent, plus LLM number verification |
| `src/render.js` | Markdown and HTML renderers (EN/AR, footnoted) |
| `src/pipeline.js` | `generateCompetitivePositionReport()`, which runs end to end and returns `Report` fields |
| `src/connectors/googlePlaces.js` | Google Places API (New): resolves the prospect and finds competitors in a radius |
| `src/connectors/metaGraph.js` | Meta Graph Business Discovery: Instagram followers, engagement and posting rate |
| `src/base44Handlers.js` | Handlers for the two Base44 backend functions |
| `base44/dist/functions/*.js` | **Generated** single-file Base44 (Deno) functions, ready to paste into the app |
| `base44/components/*.jsx` | React components for the report page |
| `base44/entities/schema-changes.json` | Fields to add to the existing Base44 entities |
| `docs/` | Methodology, data sources and the Base44 install guide |

## Documentation

- [docs/METHODOLOGY.md](docs/METHODOLOGY.md) explains every score and finding and the formula behind it.
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) covers where the numbers come from, the API keys needed, and the provenance and freshness rules.
- [docs/BASE44_INTEGRATION.md](docs/BASE44_INTEGRATION.md) gives the steps to install this into the OnSocial Base44 app.
