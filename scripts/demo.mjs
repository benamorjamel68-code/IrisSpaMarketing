// Prints the competitor table and analytical report for the test fixture.
// Usage: node scripts/demo.mjs [en|ar]
import { generateCompetitivePositionReport } from '../src/index.js';
import { cohort, NOW } from '../test/fixtures/cohort.js';

const lang = process.argv[2] === 'ar' ? 'ar' : 'en';
const out = await generateCompetitivePositionReport(cohort(), { now: NOW, languages: [lang] });
console.log(out.versions[lang].markdown);
