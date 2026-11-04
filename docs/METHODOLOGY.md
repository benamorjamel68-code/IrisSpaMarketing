# Methodology

Every score in this document is **relative to the local cohort**, which is the prospect plus the competitors found in the search radius (5 miles by default, with up to 15 competitors in the table). All values are computed only from cells that have a recorded source (see [DATA_SOURCES.md](DATA_SOURCES.md)). A cell with no source is left out of the calculation. The engine never fills it with an estimate.

## Table columns

| Column | Definition | Source |
| --- | --- | --- |
| Google rating | Average star rating | Google Places `rating`, or the review-analysis record when one exists |
| Google reviews | Total number of ratings | Google Places `userRatingCount` |
| Share of local reviews | Business reviews ÷ total Google reviews across the cohort × 100. This stands in for share of local customer attention. | Derived from the review counts above |
| New reviews (30 days) | Reviews posted in the last 30 days | Review scraper (SerpAPI or Apify) |
| Owner reply rate | % of reviews with an owner response | Review scraper |
| Instagram followers | `followers_count` | Meta Graph Business Discovery |
| Instagram engagement | (average likes + average comments over the latest 12 posts) ÷ followers × 100 | Meta Graph Business Discovery |
| TikTok / Facebook followers | Follower count | Apify / Meta Graph |
| Total social followers | Sum of the platforms that have a sourced follower count. The cell's note lists which platforms are included. | Derived |
| Distance | Great-circle distance from the prospect | Google Places coordinates |

## Scores (0–100)

- **Percentile rank** is the share of the cohort below the value, with ties counted as half. A cohort of one sits at 50.
- **Reputation** is the percentile rank of the **Bayesian-adjusted rating**:
  `(C × m + n × r) ÷ (C + n)`, where `r` is the rating, `n` is the review count, `m` is the cohort mean rating and `C` is the cohort median review count (minimum 10). The adjustment keeps a 5.0★ from 3 reviews from outranking a 4.8★ from 900 reviews.
- **Visibility** is the average of the percentile ranks of Google review count and total social followers.
- **Engagement** is the percentile rank of Instagram engagement rate.
- **Position score** is a weighted average: reputation 0.4, visibility 0.4, engagement 0.2. When a component has no data, the remaining weights are re-normalised. Weights can be configured per call.
- **Data coverage** is the share of table metrics with a sourced value for that business.

## Market position quadrants

| | Visibility ≥ 50 | Visibility < 50 |
| --- | --- | --- |
| **Reputation ≥ 50** | Market Leader (رائد السوق) | Hidden Gem (جوهرة مخفية) |
| **Reputation < 50** | Challenger (منافس صاعد) | Falling Behind (متأخر) |

A business with no sourced rating or no visibility metric is labelled **Not enough data** and gets no rank.

## Analytical agent

For each metric, the agent computes the cohort's n, mean, median, P25, P75, min, max and standard deviation. It does this for the whole cohort and for competitors only. It then places the prospect against those figures with its percentile, z-score, gap to the competitor median (absolute and %) and gap to the best competitor.

| Severity | Rule |
| --- | --- |
| leading | The prospect is the best in the cohort |
| ahead | Percentile ≥ 75 |
| on_par | Percentile 50–75 |
| moderate | Percentile 25–50 |
| critical | Percentile < 25 |

If fewer than 3 competitors have a metric, the finding is flagged as **indicative**.

The agent also produces the following findings:

- **Overall position**: the prospect's rank, quadrant and position score compared with the leader's.
- **Rating recovery**: the number of 5-star reviews needed to lift the rating to the local median, `ceil(n × (target − r) ÷ (5 − target))`.
- **Market concentration**: the Herfindahl–Hirschman Index of review shares, `Σ(share%)²`. Thresholds follow the [2023 U.S. DOJ/FTC Merger Guidelines](https://www.justice.gov/atr/2023-merger-guidelines): above 1,800 is highly concentrated, 1,000–1,800 is moderately concentrated, and below 1,000 is fragmented.
- **Relationships**: the Pearson correlation for a fixed set of metric pairs, reported only when n ≥ 5 and |r| ≥ 0.4, with a reminder that correlation is not causation.
- **Outliers**: values with |z| ≥ 2, computed when at least 5 businesses have the metric.

Findings are sorted from critical to leading. Recommendations are taken from the critical and moderate findings, at most five. Each one maps the gap to a concrete marketing lever.

## Narrative and the number check

The summary paragraph comes from one of two places:

1. **Data-built (default)**: a template filled from the findings.
2. **LLM (optional, via Base44 `InvokeLLM`)**: the model receives only the computed facts and is told not to add any number. Every number in its reply, including Arabic-Indic digits, is checked against the facts. **If any number cannot be traced to the facts, the reply is discarded** and the data-built summary is used instead. `narrative_source` records which version was kept (`llm_verified`, `deterministic` or `deterministic_fallback`), and `narrative_check` lists any numbers that failed the check.
