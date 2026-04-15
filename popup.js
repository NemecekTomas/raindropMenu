'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let token        = null;
let allCols      = [];        // all collection objects
let colMap       = {};        // id → collection
let expanded     = new Set(); // expanded collection ids
let dropsCache   = {};        // collectionId → items[]
let totalsCache  = {};        // collectionId → total count from API
let dropsLoading = new Set(); // currently fetching

// ── Shortcuts ─────────────────────────────────────────────────────────────────
const $    = id => document.getElementById(id);
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');

// ── SVG snippets ──────────────────────────────────────────────────────────────
const SVG_FOLDER = `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
  <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
</svg>`;

const SVG_LINK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
</svg>`;

const SVG_CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
     stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
  <polyline points="6 9 12 15 18 9"/>
</svg>`;

const SVG_SPIN = `<svg viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="2.5"
     width="13" height="13" class="spin">
  <circle cx="12" cy="12" r="10" stroke-opacity="0.2"/>
  <path d="M12 2a10 10 0 0 1 10 10"/>
</svg>`;

// ── API ───────────────────────────────────────────────────────────────────────
async function apiGet(path) {
    const res = await fetch(`https://api.raindrop.io/rest/v1${path}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
}

async function fetchAllCollections() {
    const [rootRes, childRes] = await Promise.all([
        apiGet('/collections'),
        apiGet('/collections/childrens')
    ]);
    return [...(rootRes.items || []), ...(childRes.items || [])];
}

async function fetchRaindrops(colId) {
    const data = await apiGet(`/raindrops/${colId}?perpage=50&page=0`);
    return data;
}

// ── Tree helpers ──────────────────────────────────────────────────────────────
function getChildren(parentId) {
    return allCols.filter(c => c.parent && c.parent.$id === parentId);
}

function getRoots() {
    // Root collections have no parent or parent.$id is falsy / 0
    return allCols.filter(c => !c.parent || !c.parent.$id);
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderTree() {
    const root = $('tree-root');
    root.innerHTML = '';
    const roots = getRoots();
    if (roots.length === 0) {
        root.innerHTML = '<div class="empty-state">No collections found.</div>';
        return;
    }
    roots.forEach(col => appendCollectionRow(col, 0, root));
}

function appendCollectionRow(col, depth, container) {
    const children   = getChildren(col._id);
    const isExpanded = expanded.has(col._id);
    const isLoading  = dropsLoading.has(col._id);
    const drops      = dropsCache[col._id];

    // ── Row ──
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.id = col._id;
    row.style.paddingLeft = (10 + depth * 16) + 'px';

    // Chevron toggle
    const chev = document.createElement('span');
    chev.className = 'tree-chevron' + (isExpanded ? ' open' : '');
    chev.innerHTML = SVG_CHEVRON;

    // Folder icon (tinted with collection colour if set)
    const icon = document.createElement('span');
    icon.className = 'tree-icon folder-icon';
    if (col.color) icon.style.color = col.color;
    icon.innerHTML = SVG_FOLDER;

    // Label
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = col.title;

    row.append(chev, icon, label);

    if (isLoading) {
        const spinner = document.createElement('span');
        spinner.className = 'tree-spinner';
        spinner.innerHTML = SVG_SPIN;
        row.appendChild(spinner);
    } else if (col.count > 0 || children.length > 0) {
        const badge = document.createElement('span');
        badge.className = 'tree-count';
        badge.textContent = col.count;
        row.appendChild(badge);
    }

    row.addEventListener('click', () => toggleCollection(col._id));
    container.appendChild(row);

    // ── Children (when expanded) ──
    if (!isExpanded) return;

    // Sub-collections first
    children.forEach(child => appendCollectionRow(child, depth + 1, container));

    // Then direct raindrops
    if (drops) {
        drops.forEach(drop => appendRaindropRow(drop, depth + 1, container));

        const total = totalsCache[col._id] || 0;
        if (total > drops.length) {
            const more = document.createElement('div');
            more.className = 'tree-more';
            more.style.paddingLeft = (10 + (depth + 1) * 16) + 'px';
            more.textContent = `+${total - drops.length} more — open in Raindrop.io`;
            container.appendChild(more);
        }
    } else if (col.count > 0 && !isLoading) {
        // drops not loaded yet but loading hasn't started — edge case guard
    }
}

function appendRaindropRow(drop, depth, container) {
    const row = document.createElement('div');
    row.className = 'tree-row raindrop-row';
    row.style.paddingLeft = (10 + depth * 16) + 'px';
    row.title = drop.link;

    const icon = document.createElement('span');
    icon.className = 'tree-icon link-icon';
    icon.innerHTML = SVG_LINK;

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = drop.title || drop.link;

    row.append(icon, label);

    row.addEventListener('click', () => {
        chrome.tabs.create({ url: drop.link });
        window.close();
    });

    container.appendChild(row);
}

// ── Toggle ────────────────────────────────────────────────────────────────────
async function toggleCollection(id) {
    if (expanded.has(id)) {
        expanded.delete(id);
        renderTree();
        return;
    }

    expanded.add(id);

    // Fetch drops if needed
    const col = colMap[id];
    if (col && col.count > 0 && !dropsCache[id] && !dropsLoading.has(id)) {
        dropsLoading.add(id);
        renderTree(); // show spinner
        try {
            const data = await fetchRaindrops(id);
            dropsCache[id]  = data.items || [];
            totalsCache[id] = data.count || 0;
        } catch (e) {
            dropsCache[id]  = [];
            totalsCache[id] = 0;
            console.error('Failed to load raindrops for', id, e);
        } finally {
            dropsLoading.delete(id);
        }
    }

    renderTree();
}

// ── Views ─────────────────────────────────────────────────────────────────────
function showSetupView() {
    show($('setup-view'));
    hide($('main-view'));
}

function showMainView() {
    hide($('setup-view'));
    show($('main-view'));
}

// ── Setup view logic ──────────────────────────────────────────────────────────
function initSetupView() {
    $('get-token-link').addEventListener('click', e => {
        e.preventDefault();
        chrome.tabs.create({ url: 'https://app.raindrop.io/settings/integrations' });
    });

    $('connect-btn').addEventListener('click', connectToken);

    $('token-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') connectToken();
    });
}

async function connectToken() {
    const input = $('token-input').value.trim();
    if (!input) return;

    const btn = $('connect-btn');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    hide($('setup-error'));

    try {
        // Verify token by fetching user info
        const res = await fetch('https://api.raindrop.io/rest/v1/user', {
            headers: { Authorization: `Bearer ${input}` }
        });
        if (!res.ok) throw new Error('Invalid token');

        await chrome.storage.local.set({ rdToken: input });
        token = input;
        showMainView();
        await loadAndRender();
        initMainView();
    } catch {
        const errEl = $('setup-error');
        errEl.textContent = 'Could not connect. Check your token and try again.';
        show(errEl);
        btn.disabled = false;
        btn.textContent = 'Connect to Raindrop.io';
        // Restore SVG in button
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>Connect to Raindrop.io`;
    }
}

// ── Main view logic ───────────────────────────────────────────────────────────
async function loadAndRender() {
    show($('tree-loading'));
    hide($('tree-root'));
    hide($('tree-error'));

    try {
        allCols = await fetchAllCollections();
        // Hide trash collection
        allCols = allCols.filter(c => c._id !== -99);
        colMap  = Object.fromEntries(allCols.map(c => [c._id, c]));

        hide($('tree-loading'));
        show($('tree-root'));
        renderTree();
    } catch (e) {
        hide($('tree-loading'));
        const errEl = $('tree-error');
        errEl.textContent = 'Failed to load collections. Check your connection and token.';
        show(errEl);
    }
}

function initMainView() {
    const toggle  = $('settings-toggle');
    const panel   = $('settings-panel');
    const chevron = $('settings-chevron');

    toggle.addEventListener('click', () => {
        const opening = !panel.classList.contains('open');
        panel.classList.toggle('open');
        chevron.classList.toggle('open');
        if (opening) {
            // Show masked token
            $('token-display').textContent =
                token.slice(0, 6) + '••••••••' + token.slice(-4);
        }
    });

    $('disconnect-btn').addEventListener('click', async () => {
        await chrome.storage.local.remove('rdToken');
        token     = null;
        allCols   = [];
        colMap    = {};
        dropsCache   = {};
        totalsCache  = {};
        expanded.clear();
        showSetupView();
        initSetupView();
    });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const stored = await chrome.storage.local.get('rdToken');
    token = stored.rdToken || null;

    if (!token) {
        showSetupView();
        initSetupView();
        return;
    }

    showMainView();
    await loadAndRender();
    initMainView();
});
