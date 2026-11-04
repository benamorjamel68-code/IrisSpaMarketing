# Data sources and provenance

## The rule

A number can appear in a report only if all of the following are true:

1. Its record has a **source** for that field: `data_sources[field] = { source, url, fetched_at }`. Older records may instead carry a record-level `data_source` plus `fetched_at`.
2. The source is in the registry (`src/provenance.js`): `google_places`, `meta_graph`, `facebook_graph`, `serpapi`, `apify` or `manual`. A `manual` value also needs a URL that a reader can check.
3. It has a valid `fetched_at` that is no older than `maxAgeDays` (default **90**) and not in the future.
4. It is a real number and not a placeholder such as `N/A`, `TBD`, `xxx`, `{{...}}`, `lorem ipsum` or an empty value.

A value that fails any of these checks is shown as **n/a** with the reason (for example "no source recorded for this value" or "data is 120 days old (limit 90)"). The data-quality section of the report lists these values.

Derived values (share of reviews, total followers, distance) cite the inputs they were computed from. Each report ends with a numbered source list. Each entry gives the API name, the exact profile or Maps URL and the fetch date.

## Connectors

### Google Places API (New): prospect and competitors

- Text Search (`places:searchText`) resolves the prospect from its name and address.
- Nearby Search (`places:searchNearby`) finds competitors within a circle of the given radius (5 mi = 8,047 m). It runs once per place type, returns at most 20 results per type (an API limit), removes duplicates, and drops businesses that are not operational.
- It returns rating, review count, coordinates, address, website, phone, primary type and Maps URL.
- **Key:** `AgencySettings.api_keys.google_maps` must be a key with the *Places API (New)* enabled. Places API pricing is listed at https://developers.google.com/maps/billing-and-pricing/pricing.
- Docs: https://developers.google.com/maps/documentation/places/web-service/nearby-search

### Meta Graph API: Instagram Business Discovery

- `GET /{ig-user-id}?fields=business_discovery.username(handle){followers_count,media_count,media.limit(12){like_count,comments_count,timestamp}}`
- Engagement is calculated as (average likes + average comments) ÷ followers × 100 over the latest 12 posts. Posting rate is calculated from the time span those posts cover.
- Only **Business and Creator** accounts can be looked up. A personal account is stored as `profile_found: false` with the reason.
- **Keys:** `AgencySettings.api_keys.meta_graph` (an access token with `instagram_basic` and `pages_read_engagement`) and `AgencySettings.api_keys.meta_ig_user_id`, the Instagram Business account ID of OnSocial's own account.
- Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery

### Reviews detail (optional)

`recent_review_count_30d`, `owner_response_rate` and sentiment come from the existing Review Analyzer (SerpAPI Google Maps Reviews or Apify). For those values to be cited, the analyzer must write `data_sources` on each `ReviewData` record, for example:

```json
{ "owner_response_rate": { "source": "serpapi", "url": "https://serpapi.com/search?engine=google_maps_reviews&place_id=…", "fetched_at": "2026-11-04T10:00:00Z" } }
```

## Refreshing data

`refreshMarketData` updates the prospect and its competitors from Google Places and refreshes every Instagram profile on file. It marks competitors that are no longer within the radius as `out_of_radius`, and those competitors are left out of reports. If a key is missing, it lists that step under `skipped` and writes it to the prospect's agent log. It never fails silently.
