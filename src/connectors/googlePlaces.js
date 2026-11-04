// Google Places API (New) connector: resolves the prospect and finds real
// competitors in the radius. Every value it returns carries provenance
// (`data_sources`), so the report can cite it.
//
// Docs: https://developers.google.com/maps/documentation/places/web-service/op-overview

import { haversineMiles } from '../stats.js';

export const PLACES_BASE_URL = 'https://places.googleapis.com/v1';
export const MILES_TO_METERS = 1609.344;

const PLACE_FIELDS = [
  'id', 'displayName', 'formattedAddress', 'location', 'rating', 'userRatingCount',
  'websiteUri', 'nationalPhoneNumber', 'internationalPhoneNumber', 'primaryType', 'types', 'googleMapsUri', 'businessStatus',
];

/** Field mask for searchText / searchNearby (fields are prefixed with `places.`). */
export const SEARCH_FIELD_MASK = PLACE_FIELDS.map((f) => `places.${f}`).join(',');

export class PlacesApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'PlacesApiError';
    this.status = status;
    this.body = body;
  }
}

async function post(path, body, { apiKey, fetchImpl, fieldMask }) {
  if (!apiKey) throw new PlacesApiError('Google Places API key is missing (AgencySettings.api_keys.google_maps)', 0, null);
  const res = await fetchImpl(`${PLACES_BASE_URL}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': fieldMask },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || `HTTP ${res.status}`;
    throw new PlacesApiError(`Google Places ${path} failed: ${msg}`, res.status, json);
  }
  return json;
}

function provenanceFor(place, fetchedAt) {
  const meta = { source: 'google_places', url: place.googleMapsUri || null, fetched_at: fetchedAt };
  const ds = {};
  for (const field of ['google_rating', 'google_review_count', 'latitude', 'longitude', 'address', 'website', 'phone', 'category']) {
    ds[field] = meta;
  }
  return ds;
}

/** Map a Places API place to the fields of the Base44 Prospect / Competitor entities. */
export function placeToRecord(place, fetchedAt) {
  return {
    business_name: (place.displayName && place.displayName.text) || '',
    google_place_id: place.id,
    address: place.formattedAddress ?? null,
    latitude: place.location ? place.location.latitude : null,
    longitude: place.location ? place.location.longitude : null,
    google_rating: typeof place.rating === 'number' ? place.rating : null,
    google_review_count: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    website: place.websiteUri ?? null,
    phone: place.internationalPhoneNumber || place.nationalPhoneNumber || null,
    category: place.primaryType ?? null,
    google_maps_url: place.googleMapsUri ?? null,
    business_status: place.businessStatus ?? null,
    data_sources: provenanceFor(place, fetchedAt),
  };
}

/**
 * Resolve the prospect from its name and/or address with Text Search.
 * Returns the best match as a Prospect-shaped record, or null.
 */
export async function findProspect({ query, apiKey, languageCode = 'en', regionCode = 'SA', fetchImpl = fetch, now }) {
  const fetchedAt = now || new Date().toISOString();
  const json = await post('places:searchText', { textQuery: query, languageCode, regionCode, pageSize: 5 },
    { apiKey, fetchImpl, fieldMask: SEARCH_FIELD_MASK });
  const place = (json.places || [])[0];
  return place ? placeToRecord(place, fetchedAt) : null;
}

/**
 * Find competitors within `radiusMiles` of the prospect with Nearby Search.
 * Searches each included type (max 20 results per type, an API limit),
 * removes the prospect, permanently closed places and duplicates, and
 * computes distance and rank score.
 */
export async function findCompetitors({
  prospect, apiKey, includedTypes, radiusMiles = 5, languageCode = 'en', fetchImpl = fetch, now, maxResults = 20,
}) {
  if (typeof prospect.latitude !== 'number' || typeof prospect.longitude !== 'number') {
    throw new PlacesApiError('Prospect has no coordinates; resolve it with findProspect first', 0, null);
  }
  const fetchedAt = now || new Date().toISOString();
  const types = includedTypes && includedTypes.length ? includedTypes : [prospect.category].filter(Boolean);
  if (!types.length) throw new PlacesApiError('No place type to search for (set includedTypes or prospect.category)', 0, null);
  const radius = Math.min(50000, radiusMiles * MILES_TO_METERS);

  const seen = new Map();
  for (const type of types) {
    const json = await post('places:searchNearby', {
      includedTypes: [type],
      maxResultCount: Math.min(20, maxResults),
      rankPreference: 'POPULARITY',
      languageCode,
      locationRestriction: { circle: { center: { latitude: prospect.latitude, longitude: prospect.longitude }, radius } },
    }, { apiKey, fetchImpl, fieldMask: SEARCH_FIELD_MASK });
    for (const place of json.places || []) {
      if (!place.id || place.id === prospect.google_place_id || seen.has(place.id)) continue;
      if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') continue;
      seen.set(place.id, place);
    }
  }

  const competitors = [...seen.values()].map((place) => {
    const rec = placeToRecord(place, fetchedAt);
    if (typeof rec.latitude === 'number' && typeof rec.longitude === 'number') {
      rec.distance_miles = Math.round(haversineMiles(prospect.latitude, prospect.longitude, rec.latitude, rec.longitude) * 100) / 100;
      rec.data_sources.distance_miles = { source: 'google_places', url: rec.google_maps_url, fetched_at: fetchedAt,
        note: 'Great-circle distance between Google Places coordinates' };
    }
    // Same ranking used by the existing Competitor Mapper: rating × log(review count).
    rec.rank_score = rec.google_rating && rec.google_review_count
      ? Math.round(rec.google_rating * Math.log10(rec.google_review_count + 1) * 100) / 100
      : 0;
    return rec;
  }).filter((c) => c.distance_miles === undefined || c.distance_miles <= radiusMiles);

  return competitors.sort((a, b) => b.rank_score - a.rank_score).slice(0, maxResults);
}
