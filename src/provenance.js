// Provenance: every number that reaches a prospect-facing report must carry
// where it came from, when it was fetched, and a link a reader can check.
// Values that cannot be traced to a source are never shown as numbers; they
// are reported as "not available" with the reason, so a report can never
// contain an invented or placeholder figure.

/** Registry of the data sources the engine knows how to cite. */
export const SOURCE_REGISTRY = Object.freeze({
  google_places: {
    label: 'Google Places API (New)',
    label_ar: 'واجهة Google Places البرمجية',
    reference_url: 'https://developers.google.com/maps/documentation/places/web-service/op-overview',
    kind: 'api',
  },
  meta_graph: {
    label: 'Meta Graph API (Instagram Business Discovery)',
    label_ar: 'واجهة Meta Graph البرمجية (اكتشاف حسابات إنستغرام التجارية)',
    reference_url: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery',
    kind: 'api',
  },
  facebook_graph: {
    label: 'Meta Graph API (Facebook Page)',
    label_ar: 'واجهة Meta Graph البرمجية (صفحة فيسبوك)',
    reference_url: 'https://developers.facebook.com/docs/graph-api/reference/page/',
    kind: 'api',
  },
  serpapi: {
    label: 'SerpAPI (Google Maps Reviews)',
    label_ar: 'SerpAPI (مراجعات خرائط Google)',
    reference_url: 'https://serpapi.com/google-maps-reviews-api',
    kind: 'api',
  },
  apify: {
    label: 'Apify public-profile scraper',
    label_ar: 'أداة Apify لجمع بيانات الحسابات العامة',
    reference_url: 'https://apify.com/store',
    kind: 'scraper',
  },
  manual: {
    label: 'Manually verified by analyst',
    label_ar: 'تم التحقق يدويًا من قبل المحلل',
    reference_url: null,
    kind: 'manual',
  },
  derived: {
    label: 'Computed by OnSocial from the cited inputs',
    label_ar: 'محسوب من قبل OnSocial من المدخلات المذكورة',
    reference_url: null,
    kind: 'derived',
  },
});

const PLACEHOLDER_STRINGS = new Set([
  '', 'n/a', 'na', 'none', 'null', 'undefined', 'nan', 'tbd', 'tba', 'todo', 'unknown',
  'placeholder', 'sample', 'example', 'lorem', 'lorem ipsum', 'xx', 'xxx', 'x', '-', '--', '—',
  '?', '??', 'pending', 'coming soon', 'estimate', 'estimated', '0000',
]);

/** True when a value is empty or a placeholder rather than a real measurement. */
export function isPlaceholder(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (PLACEHOLDER_STRINGS.has(s)) return true;
    if (/^x+$/.test(s) || /lorem ipsum/.test(s) || /\{\{.*\}\}/.test(s) || /^\[.*\]$/.test(s)) return true;
    return false;
  }
  return false;
}

/** Parse numbers that may arrive as strings ("1,234", "4.6", "12.5%"). Returns null if not numeric. */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || isPlaceholder(value)) return null;
  const cleaned = value.replace(/[,\s%]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Wrap a value with its provenance.
 * @param {*} value
 * @param {{source: string, url?: string|null, fetched_at?: string, method?: string, note?: string}} meta
 */
export function sourced(value, meta = {}) {
  return Object.freeze({
    value,
    source: meta.source ?? null,
    url: meta.url ?? null,
    fetched_at: meta.fetched_at ?? null,
    method: meta.method ?? null,
    note: meta.note ?? null,
  });
}

/** A metric cell that has no trustworthy value, with the reason why. */
export function missing(reason) {
  return Object.freeze({ value: null, missing_reason: reason });
}

function daysBetween(isoA, isoB) {
  return (Date.parse(isoB) - Date.parse(isoA)) / 86_400_000;
}

/**
 * Validate a sourced cell. Returns a list of problems (empty when the cell is citable).
 * @param {{value:*, source?:string, url?:string, fetched_at?:string}} cell
 * @param {{now?: string, maxAgeDays?: number}} [opts]
 */
export function validateSourced(cell, opts = {}) {
  const problems = [];
  if (!cell || typeof cell !== 'object') return ['cell is not an object'];
  if (isPlaceholder(cell.value)) problems.push('value is empty or a placeholder');
  if (!cell.source) problems.push('no source recorded');
  else if (!SOURCE_REGISTRY[cell.source]) problems.push(`unknown source "${cell.source}"`);
  if (cell.source === 'manual' && !cell.url) problems.push('manual values need a URL a reader can check');
  if (cell.source && cell.source !== 'derived') {
    if (!cell.fetched_at) problems.push('no fetch timestamp');
    else if (Number.isNaN(Date.parse(cell.fetched_at))) problems.push('fetch timestamp is not a valid date');
    else if (opts.now && opts.maxAgeDays != null) {
      const age = daysBetween(cell.fetched_at, opts.now);
      if (age > opts.maxAgeDays) problems.push(`data is ${Math.floor(age)} days old (limit ${opts.maxAgeDays})`);
      if (age < -1) problems.push('fetch timestamp is in the future');
    }
  }
  return problems;
}

/**
 * Read one field of a Base44 record as a sourced cell.
 *
 * Records written by the connectors carry a `data_sources` map:
 *   { google_rating: { source: 'google_places', url, fetched_at } }
 * Older records may only have a record-level `data_source` + `fetched_at`
 * (or `updated_date`), which is accepted as a fallback. A value with no
 * provenance at all is returned as missing, never as a number.
 */
export function readSourcedField(record, field, opts = {}) {
  if (!record) return missing('record not found');
  const raw = record[field];
  if (isPlaceholder(raw)) return missing('not collected');
  const value = opts.numeric === false ? raw : toNumber(raw);
  if (value === null) return missing(`value "${String(raw)}" is not a number`);

  const perField = record.data_sources && record.data_sources[field];
  const meta = perField || (record.data_source
    ? { source: record.data_source, url: record.source_url ?? record.profile_url ?? record.google_maps_url ?? null,
        fetched_at: record.fetched_at ?? record.updated_date ?? null }
    : null);
  if (!meta) return missing('no source recorded for this value');

  const cell = sourced(value, meta);
  const problems = validateSourced(cell, opts);
  if (problems.length) return missing(problems.join('; '));
  return cell;
}

/**
 * Keeps a numbered, de-duplicated list of citations for a report and hands
 * out footnote numbers. Two cells with the same source + url share a number.
 */
export class CitationLedger {
  constructor() {
    this.entries = [];
    this.index = new Map();
  }

  cite(cell) {
    if (!cell || cell.value === null || cell.value === undefined || !cell.source) return null;
    const key = `${cell.source}|${cell.url ?? ''}`;
    if (this.index.has(key)) {
      const entry = this.entries[this.index.get(key) - 1];
      if (cell.fetched_at && (!entry.fetched_at || cell.fetched_at > entry.fetched_at)) entry.fetched_at = cell.fetched_at;
      return entry.id;
    }
    const reg = SOURCE_REGISTRY[cell.source] || {};
    const entry = {
      id: this.entries.length + 1,
      source: cell.source,
      label: reg.label ?? cell.source,
      label_ar: reg.label_ar ?? reg.label ?? cell.source,
      url: cell.url ?? reg.reference_url ?? null,
      reference_url: reg.reference_url ?? null,
      fetched_at: cell.fetched_at ?? null,
    };
    this.entries.push(entry);
    this.index.set(key, entry.id);
    return entry.id;
  }

  list() {
    return this.entries.map((e) => ({ ...e }));
  }
}
