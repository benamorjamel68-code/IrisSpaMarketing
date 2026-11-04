import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOutputs } from '../scripts/build-base44.mjs';
import * as src from '../src/index.js';
import { cohort, NOW } from './fixtures/cohort.js';
import { fakeBase44 } from './fixtures/fakeBase44.js';

const outputs = buildOutputs();

test('committed base44/dist matches the source (run npm run build:base44)', () => {
  for (const [rel, content] of Object.entries(outputs)) {
    assert.equal(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'), content, `${rel} is out of date`);
  }
});

test('engine bundle exports the same API and produces identical output', async () => {
  const bundle = await import('../base44/dist/engine.bundle.js');
  for (const name of ['buildCompetitorTable', 'runAnalysis', 'generateCompetitivePositionReport', 'handleGenerateCompetitivePosition']) {
    assert.equal(typeof bundle[name], 'function', name);
  }
  const a = await src.generateCompetitivePositionReport(cohort(), { now: NOW, languages: ['en', 'ar'] });
  const b = await bundle.generateCompetitivePositionReport(cohort(), { now: NOW, languages: ['en', 'ar'] });
  assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)));
});

test('each Base44 function file is self-contained and serves requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'b44-'));
  for (const name of ['generateCompetitivePosition', 'refreshMarketData']) {
    const code = outputs[`base44/dist/functions/${name}.js`];
    assert.match(code, /^import \{ createClientFromRequest \} from 'npm:@base44\/sdk@[\d.]+';$/m);
    assert.equal((code.match(/^import /gm) || []).length, 1, 'only the SDK import remains');
    assert.match(code, /Deno\.serve\(toRequestHandler\(/);

    // Run it in Node with the SDK import replaced by a fake client and Deno.serve captured.
    const c = cohort();
    globalThis.__fake = fakeBase44({
      Prospect: [{ ...c.prospect, report_language: 'en' }], Competitor: c.competitors,
      SocialProfile: c.socialProfiles.map((p, i) => ({ id: `sp${i}`, ...p })), ReviewData: c.reviews.map((r, i) => ({ id: `rd${i}`, ...r })),
      AgencySettings: [{ id: 's', agency_name: 'OnSocial', api_keys: {} }], Report: [], Benchmark: [],
    });
    let served;
    globalThis.Deno = { serve: (h) => { served = h; } };
    const runnable = code.replace(/^import \{ createClientFromRequest \} from .*$/m, 'const createClientFromRequest = () => globalThis.__fake;');
    const file = join(dir, `${name}.mjs`);
    writeFileSync(file, runnable);
    await import(file);
    assert.equal(typeof served, 'function');
    const res = await served(new Request('https://app/functions/x', { method: 'POST', body: JSON.stringify({ prospect_id: 'p1', use_llm: false }) }));
    assert.equal(res.status, 200, await res.clone().text());
    const json = await res.json();
    if (name === 'generateCompetitivePosition') assert.equal(json.rank, 6);
    else assert.equal(json.skipped.length, 2);
  }
  delete globalThis.Deno;
  delete globalThis.__fake;
});
