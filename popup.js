'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let token = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
const $    = id => document.getElementById(id);
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');

function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)   return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(ts).toLocaleDateString();
}

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

// Fetches all pages for a collection in parallel
async function fetchAllRaindrops(colId, count) {
    const pages = Math.ceil(count / 50);
    const reqs  = Array.from({ length: pages }, (_, p) =>
        apiGet(`/raindrops/${colId}?perpage=50&page=${p}`)
    );
    const results = await Promise.all(reqs);
    return results.flatMap(r => r.items || []);
}

// ── Sync: Raindrop → Chrome Bookmarks ────────────────────────────────────────
async function doSync() {
    const destId = document.querySelector('input[name="dest"]:checked').value; // "1" or "2"

    setSyncing(true);

    try {
        // ── Phase 1: fetch all collections ──
        setStatus('neutral', 'Fetching collections…');
        const allCols = await fetchAllCollections();

        // Skip trash
        const cols = allCols.filter(c => c._id !== -99);

        // ── Phase 2: find/create root "Raindrop" folder ──
        const rootFolder = await getOrCreateRootFolder(destId);

        // Clear existing contents (fresh sync)
        const existing = await chrome.bookmarks.getChildren(rootFolder.id);
        await Promise.all(existing.map(b => chrome.bookmarks.removeTree(b.id)));

        // ── Phase 3: build folder tree (BFS, level by level) ──
        setStatus('neutral', 'Building folder structure…');

        const folderMap = {}; // raindropColId → chromeBookmarkId

        let queue = cols
            .filter(c => !c.parent || !c.parent.$id)
            .map(c => ({ col: c, parentId: rootFolder.id }));

        while (queue.length > 0) {
            const nextQueue = [];
            await Promise.all(queue.map(async ({ col, parentId }) => {
                const folder = await chrome.bookmarks.create({ parentId, title: col.title });
                folderMap[col._id] = folder.id;
                const children = cols.filter(c => c.parent && c.parent.$id === col._id);
                children.forEach(child => nextQueue.push({ col: child, parentId: folder.id }));
            }));
            queue = nextQueue;
        }

        // ── Phase 4: fetch raindrops and populate folders ──
        const colsWithDrops = cols.filter(c => c.count > 0 && folderMap[c._id]);
        let done = 0;

        await Promise.all(colsWithDrops.map(async col => {
            try {
                const drops = await fetchAllRaindrops(col._id, col.count);
                const parentId = folderMap[col._id];
                for (const drop of drops) {
                    if (drop.link) {
                        await chrome.bookmarks.create({
                            parentId,
                            title: drop.title || drop.domain || drop.link,
                            url: drop.link
                        });
                    }
                }
            } finally {
                done++;
                setStatus('neutral', `Syncing bookmarks… (${done} / ${colsWithDrops.length})`);
            }
        }));

        // ── Done ──
        const totalBookmarks = colsWithDrops.reduce((n, c) => n + c.count, 0);
        await chrome.storage.local.set({
            lastSyncTime:  Date.now(),
            lastSyncCols:  cols.length,
            lastSyncBooks: totalBookmarks
        });

        setStatus('success',
            `Synced ${cols.length} collections · ${totalBookmarks} bookmarks`
        );

    } catch (e) {
        setStatus('error', 'Sync failed — check your connection and token.');
        console.error(e);
    } finally {
        setSyncing(false);
    }
}

async function getOrCreateRootFolder(parentId) {
    const children = await chrome.bookmarks.getChildren(parentId);
    const found = children.find(b => !b.url && b.title === 'Raindrop');
    if (found) return found;
    return chrome.bookmarks.create({ parentId, title: 'Raindrop' });
}

// ── Status helpers ────────────────────────────────────────────────────────────
const ICON_INFO = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" style="color:#80868b">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
</svg>`;

const ICON_OK = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" style="color:#1e8e3e">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
</svg>`;

const ICON_ERR = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" style="color:#c5221f">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
</svg>`;

const ICON_SPIN = `<svg viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="2.5"
     width="18" height="18" class="spin">
    <circle cx="12" cy="12" r="10" stroke-opacity="0.2"/>
    <path d="M12 2a10 10 0 0 1 10 10"/>
</svg>`;

function setStatus(type, text) {
    const card = $('status-card');
    const icon = $('status-icon');
    const txt  = $('status-text');

    card.classList.remove('success', 'error');
    if (type === 'success') { card.classList.add('success'); icon.innerHTML = ICON_OK; }
    else if (type === 'error')   { card.classList.add('error');   icon.innerHTML = ICON_ERR; }
    else if (type === 'syncing') { icon.innerHTML = ICON_SPIN; }
    else                         { icon.innerHTML = ICON_INFO; }

    txt.textContent = text;
}

function setSyncing(active) {
    const btn = $('sync-btn');
    btn.disabled = active;
    if (active) {
        setStatus('syncing', 'Starting sync…');
    }
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

// ── Setup view ────────────────────────────────────────────────────────────────
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
        const res = await fetch('https://api.raindrop.io/rest/v1/user', {
            headers: { Authorization: `Bearer ${input}` }
        });
        if (!res.ok) throw new Error('Invalid token');

        await chrome.storage.local.set({ rdToken: input });
        token = input;
        showMainView();
        initMainView();
        restoreLastSyncStatus();
    } catch {
        const errEl = $('setup-error');
        errEl.textContent = 'Could not connect. Check your token and try again.';
        show(errEl);
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>Connect to Raindrop.io`;
    }
}

// ── Main view ─────────────────────────────────────────────────────────────────
async function restoreLastSyncStatus() {
    const s = await chrome.storage.local.get(['lastSyncTime', 'lastSyncCols', 'lastSyncBooks', 'rdDest']);

    // Restore destination setting
    if (s.rdDest) {
        const radio = document.querySelector(`input[name="dest"][value="${s.rdDest}"]`);
        if (radio) radio.checked = true;
    }

    if (s.lastSyncTime) {
        setStatus('success',
            `Last synced ${timeAgo(s.lastSyncTime)} · ${s.lastSyncCols} collections · ${s.lastSyncBooks} bookmarks`
        );
    } else {
        setStatus('neutral', 'Not synced yet. Click below to sync your Raindrop collections.');
    }
}

function initMainView() {
    // Sync button
    $('sync-btn').addEventListener('click', doSync);

    // Save destination on change
    document.querySelectorAll('input[name="dest"]').forEach(r => {
        r.addEventListener('change', () => {
            chrome.storage.local.set({ rdDest: r.value });
        });
    });

    // Settings accordion
    const toggle  = $('settings-toggle');
    const panel   = $('settings-panel');
    const chevron = $('settings-chevron');

    toggle.addEventListener('click', () => {
        panel.classList.toggle('open');
        chevron.classList.toggle('open');
        // Show masked token when opening
        if (panel.classList.contains('open')) {
            $('token-display').textContent = token.slice(0, 6) + '••••••••' + token.slice(-4);
        }
    });

    // Disconnect
    $('disconnect-btn').addEventListener('click', async () => {
        await chrome.storage.local.remove(['rdToken', 'lastSyncTime', 'lastSyncCols', 'lastSyncBooks', 'rdDest']);
        token = null;
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
    initMainView();
    restoreLastSyncStatus();
});
