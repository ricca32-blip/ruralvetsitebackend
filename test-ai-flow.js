import fs from 'fs';
import { execFileSync } from 'child_process';

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function check(cmd, args) { execFileSync(cmd, args, { stdio: 'pipe' }); }

const here = new URL('.', import.meta.url);
function existing(...names) { for (const name of names) { const u = new URL(name, here); if (fs.existsSync(u)) return u; } throw new Error('File non trovato: ' + names.join(' / ')); }
const serverUrl = existing('./server.js', './rural-vet-server-ai-analytics-interventions.js');
const htmlUrl = existing('./index.html', './rural-vet-index-ai-analytics-interventions.html');
const server = fs.readFileSync(serverUrl, 'utf8');
const html = fs.readFileSync(htmlUrl, 'utf8');

check(process.execPath, ['--check', serverUrl.pathname]);
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

assert(server.includes('draftProgressLine'), 'Manca progress line wizard intervento');
assert(server.includes('buildQuantityChoiceReply'), 'Manca step modifica quantità');
assert(server.includes("Aggiungi prestazione"), 'Manca bottone aggiungi prestazione');
assert(html.includes('interventionDraftQuickReplies'), 'Frontend non genera quick replies dinamiche per bozza');
assert(html.includes("Modifica quantità"), 'Manca bottone modifica quantità frontend');
assert(server.includes('chartResponse'), 'Manca generazione grafici AI backend');
assert(server.includes('ui.chart') || server.includes('{ chart }'), 'Manca contratto ui.chart/chart');
assert(html.includes('chartHtml'), 'Frontend non renderizza grafici AI');
assert(html.includes('lastAiChart'), 'Frontend non conserva grafico AI ultimo messaggio');
assert(server.includes('KPI periodo'), 'Mancano quick replies KPI analytics');
assert(server.includes('ruralVetAiBriefingQuery'), 'Manca briefing gestionale Rural Vet AI');
assert(server.includes('managementInsights'), 'Mancano insight gestionali Rural Vet AI');
assert(server.includes('dataQualityQuery'), 'Manca controllo qualità dati Rural Vet AI');
assert(server.includes('inactiveClientsQuery'), 'Manca analisi clienti fermi Rural Vet AI');
assert(server.includes('nextActionsQuery'), 'Manca motore priorità operative Rural Vet AI');
assert(server.includes('priorityTasks'), 'Manca generatore priorità Rural Vet AI');
assert(server.includes('Sei Rural Vet AI'), 'Prompt backend non nomina Rural Vet AI');
assert(html.includes('Rural Vet AI'), 'Frontend non mostra Rural Vet AI');
assert(html.includes('Controllo dati mancanti'), 'Mancano quick replies qualità dati frontend');
assert(html.includes('Clienti fermi'), 'Mancano quick replies clienti fermi frontend');
assert(!html.includes('>AI</') && !html.includes('content:"AI"'), 'Rimane una label AI generica visibile');

assert(server.includes('auditGestionaleQuery'), 'Manca audit gestionale Rural Vet AI v8.5');
assert(server.includes('businessHealthScore'), 'Manca score salute gestionale v8.5');
assert(server.includes('cashflowQuery'), 'Manca cash flow Rural Vet AI v8.5');
assert(server.includes('interventionAnomaliesQuery'), 'Manca controllo anomalie interventi v8.5');
assert(server.includes('listinoQualityQuery'), 'Manca controllo qualità listino v8.5');
assert(server.includes('smartSuggestionsQuery'), 'Manca motore suggerimenti operativi v8.5');
assert(html.includes('rvAiInsightGrid'), 'Frontend non renderizza card insight v8.5');
assert(html.includes('lastAiInsights'), 'Frontend non conserva insight Rural Vet AI v8.5');
assert(html.includes('Audit gestionale'), 'Mancano quick replies audit frontend v8.5');
assert(html.includes('Cash flow'), 'Mancano quick replies cash flow frontend v8.5');
assert(html.includes('Anomalie interventi'), 'Mancano quick replies anomalie frontend v8.5');



assert(server.includes('8.8.0-rural-vet-ai-ui-compact'), 'Versione server non aggiornata a v8.8');
assert(server.includes('ruralVetAiCockpitQuery'), 'Manca cockpit operativo Rural Vet AI v8.6');
assert(server.includes('dailyClosureQuery'), 'Manca chiusura giornata Rural Vet AI v8.6');
assert(server.includes('monthProjectionQuery'), 'Manca proiezione mese Rural Vet AI v8.6');
assert(server.includes('uploadPreflightQuery'), 'Manca preflight caricamento Rural Vet AI v8.6');
assert(server.includes('operationalCards'), 'Mancano card operative consolidate v8.6');
assert(html.includes('greetingInsights'), 'Manca funzione greetingInsights v8.6');
assert(html.includes('rv-vet-ai-v86-style'), 'Manca restyling grafico v8.6');
assert(html.includes('rvAiChartHeader'), 'Manca header grafico v8.6');
assert(html.includes('Cockpit Rural Vet AI'), 'Mancano quick replies cockpit frontend v8.6');
assert(html.includes('Proiezione mese'), 'Manca proiezione mese frontend v8.6');
assert(html.includes('Chiusura giornata'), 'Manca chiusura giornata frontend v8.6');
assert(server.includes('kmRowsFromContext'), 'Manca fallback KM da tratte/interventi v8.7');
assert(server.includes('kmEfficiencyQuery'), 'Manca efficienza KM Rural Vet AI v8.7');
assert(server.includes('performanceVeterinariQuery'), 'Manca performance veterinari Rural Vet AI v8.7');
assert(server.includes('weeklyDigestQuery'), 'Manca report settimanale/mensile Rural Vet AI v8.7');
assert(server.includes('ruralVetAiSelfTestQuery'), 'Manca diagnostica Rural Vet AI v8.7');
assert(html.includes('rv-vet-ai-v87-style'), 'Manca restyling grafico v8.7');
assert(html.includes('rvAiScoreMeter'), 'Manca score meter grafico v8.7');
assert(html.includes('rvAiChartStats'), 'Manca riepilogo statistiche grafico v8.7');
assert(html.includes('Efficienza KM'), 'Manca quick reply Efficienza KM v8.7');
assert(html.includes('Performance veterinari'), 'Manca quick reply Performance veterinari v8.7');
assert(html.includes('Diagnostica Rural Vet AI'), 'Manca diagnostica frontend v8.7');
assert(html.includes('rv-vet-ai-v88-style'), 'Manca restyling v8.8 compatto/leggibile');
assert(html.includes('mainRuralVetAiQuickReplies'), 'Manca set ridotto di quick replies iniziali v8.8');
assert(html.includes("return ['Cockpit Rural Vet AI','Inserisci intervento','Grafico ricavi'];"), 'Le quick replies iniziali non sono state ridotte a tre');
assert(html.includes('return [];') && html.includes('welcome volutamente compatto'), 'La welcome iniziale mostra ancora card pesanti');
assert(html.includes('#0b2845') && html.includes('#0f5d73'), 'Manca palette petrolio/blu v8.8');

console.log('OK: smoke test Rural Vet AI v8.8 compatta/leggibile + funzioni v8.7 superato.');
