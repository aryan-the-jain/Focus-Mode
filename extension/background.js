// Tracks whether you're watching YouTube and reports it to the Focus Mode app,
// which counts only that time against your daily and per-sitting limits. When the app
// says YouTube isn't allowed, every YouTube tab is sent to the blocked page.

const SERVER = 'http://localhost:7878';
const YT_PATTERNS = ['*://*.youtube.com/*'];
const TAB_STALE_MS = 25 * 1000;
const MIN_INTERVAL_MS = 5 * 1000;

const tabs = new Map(); // tabId -> { playing, visible, at }
let status = null;
let lastSent = 0;
let lastWatching = null;
let inflight = null;
let expiryTimer = null;

const isYouTube = (url) => {
    try {
        const host = new URL(url).hostname;
        return host === 'youtube.com' || host.endsWith('.youtube.com');
    } catch {
        return false;
    }
};

const blockedUrl = (url) => `${chrome.runtime.getURL('blocked.html')}?u=${encodeURIComponent(url || 'https://www.youtube.com/')}`;

const watchingNow = () => {
    const cutoff = Date.now() - TAB_STALE_MS;
    let watching = false;
    for (const [id, t] of tabs) {
        if (t.at < cutoff) tabs.delete(id);
        else if (t.playing || t.visible) watching = true;
    }
    return watching;
};

const heartbeat = async (force = false) => {
    const watching = watchingNow();
    if (!force && watching === lastWatching && Date.now() - lastSent < MIN_INTERVAL_MS) return status;
    if (inflight) return inflight;

    lastSent = Date.now();
    lastWatching = watching;
    inflight = fetch(`${SERVER}/api/youtube/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watching }),
    })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((s) => {
            inflight = null;
            status = s ? { ...s, receivedAt: Date.now() } : null;
            chrome.storage.session.set({ status });
            afterStatus();
            return status;
        });
    return inflight;
};

const afterStatus = async () => {
    updateBadge();
    scheduleExpiryCheck();
    const ytTabs = await chrome.tabs.query({ url: YT_PATTERNS });
    for (const tab of ytTabs) {
        if (status && !status.allowed) {
            chrome.tabs.update(tab.id, { url: blockedUrl(tab.url) });
        } else {
            chrome.tabs.sendMessage(tab.id, { type: 'status', status }).catch(() => {});
        }
    }
};

// Check back right when time should run out, instead of waiting for the next ping.
const scheduleExpiryCheck = () => {
    clearTimeout(expiryTimer);
    if (status && status.reason === 'open' && lastWatching) {
        expiryTimer = setTimeout(() => heartbeat(true), status.remainingMs + 1000);
    }
};

const updateBadge = () => {
    let text = '';
    let color = '#2f7a64';
    if (!status) {
        text = '!';
        color = '#8f8d88';
    } else if (status.reason === 'open') {
        const mins = Math.ceil(status.remainingMs / 60000);
        text = String(mins);
        if (mins <= 5) color = '#d98a1f';
    }
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
};

const injectIntoOpenTabs = async () => {
    const ytTabs = await chrome.tabs.query({ url: YT_PATTERNS });
    for (const tab of ytTabs) {
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
    }
};

const setup = () => {
    chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 });
    heartbeat(true);
};

chrome.runtime.onInstalled.addListener(() => {
    setup();
    injectIntoOpenTabs();
});
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'heartbeat') heartbeat(true);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'state' && sender.tab) {
        tabs.set(sender.tab.id, { playing: Boolean(msg.playing), visible: Boolean(msg.visible), at: Date.now() });
        heartbeat(false).then(sendResponse);
        return true;
    }
    if (msg.type === 'check') {
        heartbeat(true).then(sendResponse);
        return true;
    }
    return false;
});

// Catch navigation to YouTube before the page (or a DNS error) loads.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!info.url || !isYouTube(info.url)) return;
    if (status && !status.allowed) chrome.tabs.update(tabId, { url: blockedUrl(info.url) });
    else heartbeat(true);
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabs.delete(tabId)) heartbeat(false);
});

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: SERVER }));

// Service workers get restarted; pick up where we left off.
chrome.storage.session.get('status').then((v) => {
    if (v.status && !status) status = v.status;
    chrome.alarms.get('heartbeat').then((a) => { if (!a) setup(); });
});
