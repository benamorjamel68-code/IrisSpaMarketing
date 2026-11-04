import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CitationLedger, isPlaceholder, readSourcedField, sourced, toNumber, validateSourced } from '../src/provenance.js';

const NOW = '2026-11-04T00:00:00Z';
const meta = { source: 'google_places', url: 'https://maps.google.com/?cid=1', fetched_at: '2026-11-01T00:00:00Z' };

test('isPlaceholder catches empty and placeholder values but not real ones', () => {
  for (const v of [null, undefined, NaN, Infinity, '', '  ', 'N/A', 'tbd', 'TODO', 'xxx', '--', 'Lorem ipsum dolor', '{{followers}}', '[number]', 'unknown']) {
    assert.equal(isPlaceholder(v), true, `expected placeholder: ${String(v)}`);
  }
  for (const v of [0, 4.6, '4.6', '1,234', 'Riyadh', false]) assert.equal(isPlaceholder(v), false, String(v));
});

test('toNumber parses formatted numbers and rejects junk', () => {
  assert.equal(toNumber('1,234'), 1234);
  assert.equal(toNumber('12.5%'), 12.5);
  assert.equal(toNumber(' 7 '), 7);
  assert.equal(toNumber('12k'), null);
  assert.equal(toNumber('N/A'), null);
  assert.equal(toNumber(NaN), null);
});

test('validateSourced requires a known source, a timestamp and fresh data', () => {
  assert.deepEqual(validateSourced(sourced(4.5, meta), { now: NOW, maxAgeDays: 90 }), []);
  assert.match(validateSourced(sourced(4.5, {}))[0], /no source/);
  assert.match(validateSourced(sourced(4.5, { source: 'made_up', fetched_at: NOW })).join(), /unknown source/);
  assert.match(validateSourced(sourced(4.5, { source: 'google_places' })).join(), /no fetch timestamp/);
  assert.match(validateSourced(sourced(4.5, { ...meta, fetched_at: 'yesterday' })).join(), /not a valid date/);
  assert.match(validateSourced(sourced(4.5, { ...meta, fetched_at: '2026-01-01T00:00:00Z' }), { now: NOW, maxAgeDays: 90 }).join(), /days old/);
  assert.match(validateSourced(sourced(4.5, { ...meta, fetched_at: '2027-01-01T00:00:00Z' }), { now: NOW, maxAgeDays: 90 }).join(), /future/);
  assert.match(validateSourced(sourced(4.5, { source: 'manual', fetched_at: NOW })).join(), /URL/);
  assert.match(validateSourced(sourced('N/A', meta)).join(), /placeholder/);
  assert.deepEqual(validateSourced(sourced(10, { source: 'derived' })), []);
});

test('readSourcedField uses per-field provenance, then record-level, else missing', () => {
  const rec = { google_rating: 4.4, data_sources: { google_rating: meta } };
  assert.equal(readSourcedField(rec, 'google_rating', { now: NOW, maxAgeDays: 90 }).value, 4.4);
  const legacy = { followers: '1,200', data_source: 'meta_graph', profile_url: 'https://instagram.com/x', fetched_at: '2026-11-02T00:00:00Z' };
  const cell = readSourcedField(legacy, 'followers');
  assert.equal(cell.value, 1200);
  assert.equal(cell.url, 'https://instagram.com/x');
  assert.equal(readSourcedField({ followers: 5000 }, 'followers').value, null);
  assert.match(readSourcedField({ followers: 5000 }, 'followers').missing_reason, /no source/);
  assert.match(readSourcedField({ followers: 'N/A' }, 'followers').missing_reason, /not collected/);
  assert.match(readSourcedField({ followers: 'lots', data_sources: { followers: meta } }, 'followers').missing_reason, /not a number/);
  assert.match(readSourcedField(null, 'x').missing_reason, /record not found/);
});

test('CitationLedger de-duplicates by source + url and numbers from 1', () => {
  const l = new CitationLedger();
  assert.equal(l.cite(sourced(1, meta)), 1);
  assert.equal(l.cite(sourced(2, meta)), 1);
  assert.equal(l.cite(sourced(3, { ...meta, url: 'https://other' })), 2);
  assert.equal(l.cite({ value: null, source: 'google_places' }), null);
  const list = l.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].label, 'Google Places API (New)');
  assert.ok(list[0].label_ar);
});
