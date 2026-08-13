import fs from 'node:fs/promises';
import path from 'node:path';

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function historyEntries(state) {
    const payload = state?.history?.payload;
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.history)) return payload.history;
    if (Array.isArray(payload?.entries)) return payload.entries;
    return [];
}

function entryKey(entry, index) {
    return entry?.id || entry?.timestamp || `index:${index}`;
}

function textFromEntry(entry) {
    for (const value of [entry?.content, entry?.text, entry?.message, entry?.prose]) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

async function readJson(filename, { optional = false } = {}) {
    try {
        return JSON.parse(await fs.readFile(filename, 'utf8'));
    } catch (error) {
        if (optional && error.code === 'ENOENT') return null;
        throw new Error(`Failed to read benchmark artifact ${filename}: ${error.message}`);
    }
}

async function atomicWrite(filename, content) {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, filename);
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function benchmarkReportFilename(model) {
    if (typeof model !== 'string' || !model.trim()) {
        throw new Error('benchmarkReportFilename requires a non-empty model name.');
    }
    const safeModel = model.trim()
        .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
        .replaceAll(/^-+|-+$/g, '');
    if (!safeModel) throw new Error('Benchmark model name has no filename-safe characters.');
    return `airpgbench-${safeModel}.html`;
}

export function addedNarrativeEntries(before, after) {
    const previous = historyEntries(before);
    const previousKeys = new Set(previous.map(entryKey));
    return historyEntries(after)
        .filter((entry, index) => !previousKeys.has(entryKey(entry, index)))
        .map(entry => ({
            id: entry?.id || null,
            type: entry?.type || null,
            role: entry?.role || null,
            content: textFromEntry(entry)
        }))
        .filter(entry => entry.content);
}

function collectDirectResponseText(response, narrativeEntries) {
    const candidates = [
        response?.payload?.response,
        response?.payload?.narrative,
        response?.payload?.prose,
        response?.payload?.message
    ].filter(value => typeof value === 'string' && value.trim()).map(value => value.trim());
    const historyText = new Set(narrativeEntries.map(entry => entry.content));
    return [...new Set(candidates)].filter(value => !historyText.has(value));
}

function collectPlayerInputs(definition) {
    return (definition?.steps || [])
        .filter(step => ['chat', 'startChat'].includes(step.type) && typeof step.text === 'string')
        .map(step => step.text.trim())
        .filter(Boolean);
}

export function inspectPromptModels(prompts, requestedModel) {
    const livePrompts = Array.isArray(prompts) ? prompts : [];
    const mismatches = livePrompts.filter(prompt => prompt?.model !== requestedModel);
    return {
        requestedModel,
        promptCount: livePrompts.length,
        mismatches,
        valid: mismatches.length === 0
    };
}

export async function collectScenarioResult(root, {
    entry,
    attemptDir,
    requestedModel,
    error = null,
    durationMs = null
}) {
    const triage = attemptDir ? await readJson(path.join(attemptDir, 'triage.json'), { optional: true }) : null;
    const before = attemptDir ? await readJson(path.join(attemptDir, 'before.json'), { optional: true }) : null;
    const after = attemptDir ? await readJson(path.join(attemptDir, 'after.json'), { optional: true }) : null;
    const response = attemptDir ? await readJson(path.join(attemptDir, 'response.json'), { optional: true }) : null;
    const prompts = triage?.promptTimeline?.prompts || [];
    const modelInspection = inspectPromptModels(prompts, requestedModel);
    const narrative = addedNarrativeEntries(before, after);
    const failedAssertions = triage?.assertions?.failed || [];
    const executionMessage = error?.message || triage?.executionError?.message || null;
    const hasScenarioEvidence = Boolean(attemptDir && triage);
    let status = 'passed';
    if (executionMessage || failedAssertions.length || !modelInspection.valid) {
        status = hasScenarioEvidence ? 'failed' : 'infrastructure-error';
    }
    return {
        scenarioFile: entry.file,
        scenario: entry.definition.scenario,
        caseId: entry.caseId,
        case: entry.definition.case,
        family: entry.family,
        profile: entry.profile,
        description: entry.definition.description || '',
        status,
        durationMs,
        attemptDirectory: attemptDir ? path.relative(root, attemptDir) : null,
        error: executionMessage,
        assertions: {
            total: triage?.assertions?.total || 0,
            passed: triage?.assertions?.passed?.length || 0,
            failed: failedAssertions
        },
        prompts,
        modelInspection,
        playerInputs: collectPlayerInputs(entry.definition),
        narrative,
        directResponseText: collectDirectResponseText(response, narrative),
        humanReview: triage?.humanReview || entry.definition.humanReview || [],
        knownAuditedModelFailure: entry.knownAuditedModelFailure || null,
        changedLogs: triage?.changedLogs || []
    };
}

export function summarizeBenchmark({ expectedCases, selectedScenarioEntries, results, interrupted = false }) {
    const runnableSelected = new Set(selectedScenarioEntries.map(entry => entry.caseId));
    const executedCases = new Set(results.map(result => result.caseId));
    const selectedVariantCounts = new Map();
    for (const entry of selectedScenarioEntries) {
        selectedVariantCounts.set(entry.caseId, (selectedVariantCounts.get(entry.caseId) || 0) + 1);
    }
    const resultGroups = new Map();
    for (const result of results) {
        if (!resultGroups.has(result.caseId)) resultGroups.set(result.caseId, []);
        resultGroups.get(result.caseId).push(result);
    }
    const passingLogicalCases = [...runnableSelected].filter(caseId => {
        const caseResults = resultGroups.get(caseId) || [];
        return caseResults.length === selectedVariantCounts.get(caseId)
            && caseResults.every(result => result.status === 'passed');
    }).length;
    const statusCounts = {
        passed: results.filter(result => result.status === 'passed').length,
        failed: results.filter(result => result.status === 'failed').length,
        infrastructureError: results.filter(result => result.status === 'infrastructure-error').length,
        notRun: selectedScenarioEntries.length - results.length
    };
    const prompts = results.flatMap(result => result.prompts || []);
    return {
        interrupted,
        expectedLogicalCases: expectedCases.length,
        selectedLogicalCases: runnableSelected.size,
        executedLogicalCases: executedCases.size,
        passingLogicalCases,
        selectedScenarioVariants: selectedScenarioEntries.length,
        executedScenarioVariants: results.length,
        statusCounts,
        promptCount: prompts.length,
        retryCount: prompts.reduce((total, prompt) => total + (prompt.retries || 0), 0),
        promptSeconds: prompts.reduce((total, prompt) => total + (prompt.seconds || 0), 0)
    };
}

function percent(value, total) {
    return total ? Math.round((value / total) * 100) : 0;
}

function renderNarrative(result) {
    const inputs = result.playerInputs.map(text => `<div class="prose input"><strong>Player input</strong><pre>${escapeHtml(text)}</pre></div>`).join('');
    const history = result.narrative.map(entry => (
        `<div class="prose"><strong>${escapeHtml(entry.type || entry.role || 'history')}</strong><pre>${escapeHtml(entry.content)}</pre></div>`
    )).join('');
    const direct = result.directResponseText.map(text => `<div class="prose"><strong>Direct response</strong><pre>${escapeHtml(text)}</pre></div>`).join('');
    return inputs + history + direct || '<p class="muted">No user-facing prose was added.</p>';
}

function renderReviewItems(result) {
    if (!result.humanReview.length) return '<p class="muted">No human-review checklist for this case.</p>';
    return result.humanReview.map((item, index) => {
        const key = `${result.case}:${index}`;
        return `<div class="review" data-review-key="${escapeHtml(key)}"><p>${escapeHtml(item)}</p><label><input type="radio" name="${escapeHtml(key)}" value="approve"> Approve</label><label><input type="radio" name="${escapeHtml(key)}" value="issue"> Issue</label><label><input type="radio" name="${escapeHtml(key)}" value="unreviewed"> Unreviewed</label><textarea placeholder="Reviewer note"></textarea></div>`;
    }).join('');
}

function renderResultCard(result, run) {
    const artifactHref = result.attemptDirectory
        ? path.relative(run.outputDirectory, path.resolve(run.projectRoot, result.attemptDirectory)).replaceAll(path.sep, '/')
        : null;
    const failed = result.assertions.failed.map(item => `<li>${escapeHtml(item.message)}</li>`).join('');
    const promptRows = result.prompts.map(prompt => `<tr><td>${escapeHtml(prompt.label || prompt.id)}</td><td>${escapeHtml(prompt.model || '—')}</td><td>${escapeHtml(prompt.seconds ?? '—')}</td><td>${escapeHtml(prompt.retries || 0)}</td><td>${prompt.responseFailed ? 'yes' : 'no'}</td></tr>`).join('');
    const diagnosticErrorLogs = (result.changedLogs || [])
        .filter(entry => /^ERROR_/i.test(path.basename(entry?.name || '')));
    const diagnosticErrorLogItems = diagnosticErrorLogs
        .map(entry => `<li><code>${escapeHtml(entry.name)}</code>${Number.isFinite(entry.size) ? ` (${escapeHtml(entry.size)} bytes)` : ''}</li>`)
        .join('');
    return `<article class="case" data-family="${escapeHtml(result.family)}" data-status="${escapeHtml(result.status)}" data-review="unreviewed">
      <details${result.status === 'passed' ? '' : ' open'}><summary><span class="badge ${escapeHtml(result.status)}">${escapeHtml(result.status)}</span> <strong>${escapeHtml(result.case)}</strong> ${escapeHtml(result.description)}</summary>
      <div class="case-body">
        <p><b>Profile:</b> ${escapeHtml(result.profile)} · <b>Assertions:</b> ${result.assertions.passed}/${result.assertions.total} · <b>Duration:</b> ${result.durationMs ?? '—'}ms${artifactHref ? ` · <a href="${escapeHtml(artifactHref)}">artifacts</a>` : ''}</p>
        ${result.knownAuditedModelFailure ? `<p class="notice"><b>Historical audited model failure:</b> ${escapeHtml(result.knownAuditedModelFailure)}</p>` : ''}
        ${result.error ? `<p class="error"><b>Error:</b> ${escapeHtml(result.error)}</p>` : ''}
        ${result.modelInspection.mismatches.length ? `<p class="error"><b>Wrong model:</b> ${escapeHtml(result.modelInspection.mismatches.map(row => `${row.label || row.id}: ${row.model}`).join(', '))}</p>` : ''}
        ${failed ? `<h4>Failed assertions</h4><ul>${failed}</ul>` : ''}
        ${diagnosticErrorLogs.length ? `<details class="diagnostic"><summary><b>Diagnostic error logs (${diagnosticErrorLogs.length})</b> — retained for review; not a pass/fail signal</summary><ul>${diagnosticErrorLogItems}</ul></details>` : ''}
        <h4>Narrative evidence</h4>${renderNarrative(result)}
        <h4>Human review</h4>${renderReviewItems(result)}
        <details><summary>Prompt timeline (${result.prompts.length})</summary><table><thead><tr><th>Prompt</th><th>Model</th><th>Seconds</th><th>Retries</th><th>Failed</th></tr></thead><tbody>${promptRows || '<tr><td colspan="5">No prompts</td></tr>'}</tbody></table></details>
      </div></details>
    </article>`;
}

export function renderBenchmarkHtml(run) {
    const summary = run.summary;
    const families = [...new Set(run.results.map(result => result.family))];
    const familySections = families.map(family => {
        const rows = run.results.filter(result => result.family === family);
        const pass = rows.filter(result => result.status === 'passed').length;
        const p = percent(pass, rows.length);
        return `<section class="family"><h2>${escapeHtml(family)} <small>${pass}/${rows.length}</small></h2><progress max="100" value="${p}"></progress>${rows.map(result => renderResultCard(result, run)).join('')}</section>`;
    }).join('');
    const missing = run.coverage.missingCaseIds.map(caseId => `<li>${escapeHtml(caseId)}</li>`).join('');
    const notRun = run.notRunCaseIds.map(caseId => `<li>${escapeHtml(caseId)}</li>`).join('');
    const completion = percent(summary.executedScenarioVariants, summary.selectedScenarioVariants);
    const passRate = percent(summary.statusCounts.passed, summary.executedScenarioVariants);
    const storageKey = `model-benchmark-review:${run.runId}`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Model benchmark ${escapeHtml(run.runId)}</title><style>
      :root{color-scheme:light dark;--bg:#111827;--card:#1f2937;--ink:#f3f4f6;--muted:#9ca3af;--line:#374151;--good:#34d399;--bad:#fb7185;--warn:#fbbf24;--accent:#60a5fa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:32px}h1,h2,h3,h4{line-height:1.2}small,.muted{color:var(--muted)}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.metric,.case{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}.metric strong{display:block;font-size:1.5rem}.toolbar{position:sticky;top:0;z-index:2;background:#111827ee;padding:12px 0;display:flex;gap:10px;flex-wrap:wrap}.family{margin-top:34px}.family>progress{width:100%;height:14px}.case{margin:12px 0}.case summary{cursor:pointer}.case-body{padding:8px 8px 2px}.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.75rem;text-transform:uppercase;background:#4b5563}.badge.passed{background:#065f46}.badge.failed,.badge.infrastructure-error{background:#9f1239}.notice{border-left:4px solid var(--warn);padding:8px 12px}.diagnostic{border-left:4px solid var(--warn);padding:8px 12px;margin:12px 0}.diagnostic summary{color:#fde68a}.diagnostic code{overflow-wrap:anywhere}.error{color:#fecdd3}.prose{border-left:3px solid var(--accent);padding:4px 12px;margin:10px 0}.prose.input{border-color:var(--warn)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:6px 0}.review{border:1px solid var(--line);border-radius:8px;padding:10px;margin:8px 0}.review label{margin-right:14px}.review textarea{display:block;width:100%;min-height:58px;margin-top:8px;background:transparent;color:inherit;border:1px solid var(--line);border-radius:5px;padding:7px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid var(--line);padding:6px}button,select{font:inherit;border-radius:6px;border:1px solid var(--line);padding:7px 10px}a{color:#93c5fd}.hidden{display:none!important}
    </style></head><body><main><h1>Model benchmark</h1><p><b>Model:</b> ${escapeHtml(run.model)} · <b>Run:</b> ${escapeHtml(run.runId)} · <b>Started:</b> ${escapeHtml(run.startedAt)}${run.finishedAt ? ` · <b>Finished:</b> ${escapeHtml(run.finishedAt)}` : ''}</p>
    <div class="summary"><div class="metric"><small>Run progress</small><strong>${completion}%</strong><progress max="100" value="${completion}"></progress></div><div class="metric"><small>Mechanical pass</small><strong>${summary.statusCounts.passed}/${summary.executedScenarioVariants}</strong><progress max="100" value="${passRate}"></progress></div><div class="metric"><small>Logical coverage</small><strong>${run.coverage.runnableCaseIds.length}/${run.coverage.expectedCases.length}</strong></div><div class="metric"><small>Prompts / retries</small><strong>${summary.promptCount} / ${summary.retryCount}</strong><small>${Math.round(summary.promptSeconds)} prompt-seconds</small></div></div>
    <div class="toolbar"><select id="family"><option value="">All families</option>${families.map(f => `<option>${escapeHtml(f)}</option>`).join('')}</select><select id="status"><option value="">All mechanical states</option><option>passed</option><option>failed</option><option>infrastructure-error</option></select><select id="review-filter"><option value="">All review states</option><option>approve</option><option>issue</option><option>unreviewed</option></select><button id="export">Export review JSON</button></div>
    ${run.coverage.missingCaseIds.length ? `<section><h2>Not automated</h2><ul>${missing}</ul></section>` : ''}${run.notRunCaseIds.length ? `<section><h2>Not run</h2><ul>${notRun}</ul></section>` : ''}${familySections}
    </main><script>
      const storageKey=${JSON.stringify(storageKey)};const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');
      function updateCard(card){const states=[...card.querySelectorAll('.review input:checked')].map(x=>x.value);card.dataset.review=states.includes('issue')?'issue':states.length&&states.every(x=>x==='approve')?'approve':'unreviewed'}
      document.querySelectorAll('.review').forEach(row=>{const key=row.dataset.reviewKey;const state=saved[key]||{state:'unreviewed',note:''};const radio=row.querySelector('input[value="'+state.state+'"]')||row.querySelector('input[value="unreviewed"]');radio.checked=true;row.querySelector('textarea').value=state.note||'';row.addEventListener('input',()=>{saved[key]={state:row.querySelector('input:checked').value,note:row.querySelector('textarea').value};localStorage.setItem(storageKey,JSON.stringify(saved));updateCard(row.closest('.case'));filter()});updateCard(row.closest('.case'))});
      function filter(){const f=document.querySelector('#family').value,s=document.querySelector('#status').value,r=document.querySelector('#review-filter').value;document.querySelectorAll('.case').forEach(card=>card.classList.toggle('hidden',!!((f&&card.dataset.family!==f)||(s&&card.dataset.status!==s)||(r&&card.dataset.review!==r))))}document.querySelectorAll('.toolbar select').forEach(x=>x.addEventListener('change',filter));
      document.querySelector('#export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({runId:${JSON.stringify(run.runId)},model:${JSON.stringify(run.model)},reviews:saved},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=${JSON.stringify(`${run.runId}-human-review.json`)};a.click();URL.revokeObjectURL(a.href)});
    </script></body></html>`;
}

export async function writeBenchmarkReports(outputDirectory, run) {
    if (!isPlainObject(run)) throw new Error('writeBenchmarkReports requires a run object.');
    const reportFilename = benchmarkReportFilename(run.model);
    const materialized = { ...run, outputDirectory, reportFilename };
    await atomicWrite(path.join(outputDirectory, 'progress.json'), `${JSON.stringify(materialized, null, 2)}\n`);
    await atomicWrite(path.join(outputDirectory, reportFilename), renderBenchmarkHtml(materialized));
    if (run.finishedAt) {
        await atomicWrite(path.join(outputDirectory, 'results.json'), `${JSON.stringify(materialized, null, 2)}\n`);
    }
}
