// Reports to the Focus Mode app what you're doing in Chrome:
// - whether you're on YouTube or other entertainment (one shared daily budget and sittings)
// - whether a timed site like LinkedIn is in front of you (counted against its daily timer)
// - when you bounce between Gmail, Outlook and LinkedIn (the loop breaker)
// and sends tabs to the blocked page whenever the app says a site is off limits.

const SERVER = 'http://localhost:7878';
const TAB_STALE_MS = 25 * 1000;
const MIN_INTERVAL_MS = 5 * 1000;
const IDLE_SECONDS = 60;

const tabs = new Map(); // YouTube tabId -> { playing, visible, at }
let status = null;
let lastSent = 0;
let lastKey = null;
let inflight = null;
let expiryTimer = null;

const hostOf = (url) => {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return '';
    }
};
const onDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);
const isYouTube = (url) => onDomain(hostOf(url), 'youtube.com');

const blockedUrl = (url, reason) => `${chrome.runtime.getURL('blocked.html')}?r=${encodeURIComponent(reason)}&u=${encodeURIComponent(url || '')}`;

// Which loop-breaker app (gmail, outlook, linkedin) a URL belongs to, if any.
const loopApp = (url) => {
    if (!status || !status.loop) return null;
    const host = hostOf(url);
    const match = Object.entries(status.loop.apps).find(([, domains]) => domains.some((d) => onDomain(host, d)));
    return match ? match[0] : null;
};

// Why this URL should be blocked right now, or null.
const blockReason = (url) => {
    if (!status || !url || url.startsWith('chrome')) return null;
    const host = hostOf(url);
    if (onDomain(host, 'youtube.com') && !status.allowed) return 'youtube';
    if (status.loop && status.loop.active && loopApp(url)) return 'loop';
    for (const [id, t] of Object.entries(status.timers || {})) {
        if (!t.allowed && onDomain(host, t.domain)) return `timer:${id}`;
    }
    const fun = status.entertainment;
    if (fun && fun.reason && fun.sites.some((d) => onDomain(host, d))) return 'fun';
    return null;
};

const watchingYouTube = () => {
    const cutoff = Date.now() - TAB_STALE_MS;
    let watching = false;
    for (const [id, t] of tabs) {
        if (t.at < cutoff) tabs.delete(id);
        else if (t.playing || t.visible) watching = true;
    }
    return watching;
};

// The tab you're looking at, if Chrome is focused and you're at the computer.
const frontTab = async () => {
    const win = await chrome.windows.getLastFocused().catch(() => null);
    if (!win || !win.focused) return null;
    const idle = await chrome.idle.queryState(IDLE_SECONDS);
    if (idle !== 'active') return null;
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    return tab || null;
};

const activeTimers = (host) => Object.fromEntries(
    Object.entries((status && status.timers) || {}).map(([id, t]) => [id, Boolean(host) && onDomain(host, t.domain)]),
);

const isEntertainment = (host) => Boolean(host) && Boolean(status && status.entertainment)
    && status.entertainment.metered.some((d) => onDomain(host, d));

// Entertainment counts when it's the tab you're looking at, or it's playing sound.
const onEntertainment = async (frontHost) => {
    if (isEntertainment(frontHost)) return true;
    const audible = await chrome.tabs.query({ audible: true });
    return audible.some((t) => isEntertainment(hostOf(t.url)));
};

const heartbeat = async (force = false) => {
    const tab = await frontTab();
    const host = tab ? hostOf(tab.url) : '';
    const watching = watchingYouTube() || await onEntertainment(host);
    const active = activeTimers(host);
    const key = JSON.stringify([watching, active]);
    if (!force && key === lastKey && Date.now() - lastSent < MIN_INTERVAL_MS) return status;
    if (inflight) return inflight;

    lastSent = Date.now();
    lastKey = key;
    inflight = post('/api/youtube/heartbeat', { watching, active }).then((s) => {
        inflight = null;
        setStatus(s);
        return status;
    });
    return inflight;
};

const post = (path, body) => fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
}).then((r) => (r.ok ? r.json() : null)).catch(() => null);

const setStatus = (s) => {
    status = s ? { ...s, receivedAt: Date.now() } : null;
    chrome.storage.session.set({ status });
    afterStatus();
};

const afterStatus = async () => {
    updateBadge();
    scheduleExpiryCheck();
    const all = await chrome.tabs.query({});
    for (const tab of all) {
        const reason = blockReason(tab.url);
        if (reason) chrome.tabs.update(tab.id, { url: blockedUrl(tab.url, reason) });
        else if (isYouTube(tab.url)) chrome.tabs.sendMessage(tab.id, { type: 'status', status }).catch(() => {});
    }
};

// Check back right when YouTube time should run out, instead of waiting for the next ping.
const scheduleExpiryCheck = () => {
    clearTimeout(expiryTimer);
    if (status && status.reason === 'open' && lastKey && JSON.parse(lastKey)[0]) {
        expiryTimer = setTimeout(() => heartbeat(true), status.remainingMs + 1000);
    }
};

// Badge shows minutes left for whichever limited site is in front of you.
const updateBadge = async () => {
    let text = '';
    let color = '#1a1a1a';
    if (!status) {
        text = '!';
        color = '#6b6b6b';
    } else {
        const tab = await frontTab().catch(() => null);
        const host = tab ? hostOf(tab.url) : '';
        const timer = Object.values(status.timers || {}).find((t) => host && onDomain(host, t.domain) && t.enabled);
        let ms = null;
        if (timer) ms = timer.remainingMs;
        else if (status.reason === 'open' && (isEntertainment(host) || onDomain(host, 'youtube.com'))) ms = status.remainingMs;
        if (ms !== null) {
            const mins = Math.ceil(ms / 60000);
            text = String(mins);
            if (mins <= 5) color = '#000000';
        }
    }
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
};

// Loop breaker ---------------------------------------------------------------

// Each switch to a different loop app counts as a hop. Enough hops inside the
// window means you're cycling through inboxes instead of starting work.
const noteVisit = async (url) => {
    const app = loopApp(url);
    if (!app || !status.loop.enabled || status.loop.active) return;
    const { loopState = { last: null, hops: [] } } = await chrome.storage.session.get('loopState');
    if (app === loopState.last) return;
    const now = Date.now();
    const windowMs = status.loop.windowMinutes * 60000;
    loopState.hops = loopState.hops.filter((h) => now - h.at < windowMs);
    if (loopState.last) loopState.hops.push({ app, at: now });
    loopState.last = app;

    if (loopState.hops.length >= status.loop.hops) {
        const apps = loopState.hops.map((h) => h.app);
        await chrome.storage.session.set({ loopState: { last: null, hops: [] } });
        setStatus(await post('/api/ext/loop', { apps }));
        return;
    }
    await chrome.storage.session.set({ loopState });
};

const onFrontChange = async () => {
    const tab = await frontTab();
    if (tab) noteVisit(tab.url);
    heartbeat(false);
};

// Wiring ---------------------------------------------------------------------

const injectIntoOpenTabs = async () => {
    const ytTabs = await chrome.tabs.query({ url: ['*://*.youtube.com/*'] });
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
    if (msg.type === 'startSession') {
        post('/api/ext/session', { minutes: msg.minutes, profile: msg.profile }).then((s) => sendResponse(Boolean(s)));
        return true;
    }
    return false;
});

// Catch navigation to a blocked site before the page (or a DNS error) loads.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.audible !== undefined) heartbeat(false); // started or stopped playing sound
    if (!info.url) return;
    const reason = blockReason(info.url);
    if (reason) {
        chrome.tabs.update(tabId, { url: blockedUrl(info.url, reason) });
        return;
    }
    if (tab.active) onFrontChange();
    if (isYouTube(info.url)) heartbeat(true);
});

chrome.tabs.onActivated.addListener(onFrontChange);
chrome.windows.onFocusChanged.addListener(onFrontChange);
chrome.idle.onStateChanged.addListener(() => heartbeat(true));

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabs.delete(tabId)) heartbeat(false);
});

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: SERVER }));

// Service workers get restarted; pick up where we left off.
chrome.storage.session.get('status').then((v) => {
    if (v.status && !status) status = v.status;
    chrome.alarms.get('heartbeat').then((a) => { if (!a) setup(); });
});
