'use strict';

const $ = id => document.getElementById(id);

const SVG_FOLDER = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
  <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
</svg>`;

let allEntries = [];
let currentFilter = 'all';

function classify(entry) {
    if (entry.error)                        return 'err';
    if (entry.synced < entry.expected)      return 'warn';
    if (entry.expected === 0)               return 'empty';
    return 'ok';
}

function badgeHtml(entry) {
    const cls = classify(entry);
    if (cls === 'err')   return `<span class="badge err">✗ ${entry.error}</span>`;
    if (cls === 'warn')  return `<span class="badge warn">⚠ count mismatch</span>`;
    if (cls === 'empty') return `<span class="badge empty">— empty</span>`;
    return `<span class="badge ok">✓ OK</span>`;
}

function renderTable(entries) {
    const tbody = $('results-body');
    const noData = $('no-data');
    tbody.innerHTML = '';

    const filtered = entries.filter(e => {
        if (currentFilter === 'all')  return true;
        if (currentFilter === 'ok')   return classify(e) === 'ok' || classify(e) === 'empty';
        if (currentFilter === 'warn') return classify(e) === 'warn';
        if (currentFilter === 'err')  return classify(e) === 'err';
        return true;
    });

    $('filter-label').textContent = `${filtered.length} collection${filtered.length !== 1 ? 's' : ''}`;

    if (filtered.length === 0) {
        show(noData);
        $('no-data').textContent = currentFilter === 'all'
            ? 'No sync data yet. Run a sync first.'
            : 'No collections in this category.';
        return;
    }
    hide(noData);

    filtered.forEach(entry => {
        const indent = 8 + entry.depth * 20;
        const tr = document.createElement('tr');
        tr.dataset.status = classify(entry);
        tr.innerHTML = `
            <td>
                <div class="col-name" style="padding-left:${indent}px">
                    ${SVG_FOLDER}
                    <span title="${entry.title}">${entry.title}</span>
                </div>
            </td>
            <td class="num">${entry.expected}</td>
            <td class="num">${entry.synced}</td>
            <td>${badgeHtml(entry)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

document.addEventListener('DOMContentLoaded', async () => {
    const data = await chrome.storage.local.get([
        'lastSyncTime', 'lastSyncCols', 'lastSyncExpected',
        'lastSyncActual', 'lastSyncErrors', 'syncLog'
    ]);

    if (!data.lastSyncTime) {
        $('sync-time').textContent = 'No sync data found.';
        show($('no-data'));
        return;
    }

    // ── Header ──
    $('sync-time').textContent = `Synced on ${new Date(data.lastSyncTime).toLocaleString()}`;

    // ── Summary cards ──
    $('val-cols').textContent   = data.lastSyncCols ?? '—';
    $('val-books').textContent  = `${data.lastSyncActual ?? 0} / ${data.lastSyncExpected ?? 0}`;
    $('val-errors').textContent = data.lastSyncErrors ?? 0;

    const booksMismatch = (data.lastSyncActual ?? 0) < (data.lastSyncExpected ?? 0);
    if (booksMismatch) $('card-books').classList.add('warning');
    else               $('card-books').classList.add('success');

    if ((data.lastSyncErrors ?? 0) > 0) $('card-errors').classList.add('error');
    else                                 $('card-errors').classList.add('success');

    // ── Table ──
    allEntries = (data.syncLog || []).sort((a, b) => {
        // Errors first, then warnings, then by depth, then alphabetically
        const order = { err: 0, warn: 1, ok: 2, empty: 3 };
        const da = order[classify(a)] ?? 2;
        const db = order[classify(b)] ?? 2;
        if (da !== db) return da - db;
        if (a.depth !== b.depth) return a.depth - b.depth;
        return a.title.localeCompare(b.title);
    });

    renderTable(allEntries);

    // ── Filter tabs ──
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderTable(allEntries);
        });
    });
});
