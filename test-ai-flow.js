import fs from 'fs';
import { execFileSync } from 'child_process';

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function check(cmd, args) { execFileSync(cmd, args, { stdio: 'pipe' }); }

const server = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

check(process.execPath, ['--check', new URL('./server.js', import.meta.url).pathname]);
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
for (const script of scripts) new Function(script);

[
  'parseInterventionDraft',
  'findServiceCandidates',
  'findCompanyCandidates',
  'continuePendingInterventionDraft',
  'validateInterventionAction',
  'resolveNextInterventionStep',
  'interventionDraftToReply'
].forEach(name => assert(server.includes('function ' + name), 'Manca funzione ' + name));

assert(server.includes("type: 'continue_intervention_draft'"), 'Manca action continue_intervention_draft');
assert(server.includes('safeToApply'), 'Manca contratto safeToApply');
assert(server.includes('AI_DEBUG'), 'Manca AI_DEBUG');
assert(html.includes('pendingInterventionDraft'), 'Frontend non mantiene pendingInterventionDraft');
assert(html.includes('ctx.pendingInterventionDraft'), 'Frontend non invia pendingInterventionDraft nel context');
assert(html.includes("continue_intervention_draft"), 'Frontend non gestisce continue_intervention_draft');
assert(html.includes("Modifica prestazione"), 'Mancano bottoni modifica bozza');

console.log('OK: smoke test AI flow superato. Sintassi server/html e contratto bozza verificati.');
