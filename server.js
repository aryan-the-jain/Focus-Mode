const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PORT = Number(process.env.PORT) || 7878;
const HOST = process.env.HOST || '127.0.0.1';
const SYSTEM_HOSTS = '/etc/hosts';
const HOSTS_FILE = process.env.FOCUS_HOSTS_FILE || SYSTEM_HOSTS;
const USING_SYSTEM_HOSTS = path.resolve(HOSTS_FILE) === SYSTEM_HOSTS;
const DATA_DIR = process.env.FOCUS_DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const MARKER_START = '# --- WEBSITE BLOCK START ---';
const MARKER_END = '# --- WEBSITE BLOCK END ---';

const EARLY_END_PHRASE = 'I choose to end this session early';
const MAX_SESSION_MINUTES = 12 * 60;
const ENFORCE_EVERY_MS = 15 * 1000;

// Lock-in modes. Each blocklist site can be switched off per mode, e.g.
// coursework sites stay open in Scholar but are blocked in Side Quest.
const PROFILES = [
    { id: 'scholar', name: 'Scholar', blurb: 'Uni study' },
    { id: 'sidequest', name: 'Side Quest', blurb: 'Extra study' },
];
const PROFILE_IDS = PROFILES.map((p) => p.id);

// Night lock: entertainment that's blocked every night, whatever the mode.
const DEFAULT_NIGHT_SITES = [
    'netflix.com', 'primevideo.com', 'chess.com', 'github.com',
    'twitch.tv', 'reddit.com', 'x.com', 'instagram.com', 'tiktok.com', 'disneyplus.com',
];

const DEFAULT_SITES = ['youtube.com', 'reddit.com', 'whatsapp.com', 'gmail.com', 'outlook.com', 'linkedin.com'];

// Extra hostnames a site depends on. /etc/hosts has no wildcards, so these
// have to be listed explicitly for a block to actually stick.
const RELATED_DOMAINS = {
    'youtube.com': ['music.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'ytimg.com', 'i.ytimg.com', 's.ytimg.com', 'googlevideo.com'],
    'reddit.com': ['old.reddit.com', 'new.reddit.com', 'redd.it', 'i.redd.it', 'v.redd.it', 'redditmedia.com', 'redditstatic.com'],
    'whatsapp.com': ['web.whatsapp.com'],
    'gmail.com': ['mail.google.com', 'inbox.google.com'],
    'outlook.com': ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'],
    'x.com': ['mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'abs.twimg.com', 'pbs.twimg.com'],
    'twitter.com': ['mobile.twitter.com', 'x.com', 'www.x.com', 'mobile.x.com', 'abs.twimg.com', 'pbs.twimg.com'],
    'facebook.com': ['web.facebook.com', 'fb.com', 'www.fb.com', 'messenger.com', 'www.messenger.com'],
    'instagram.com': ['l.instagram.com'],
    'tiktok.com': ['vm.tiktok.com'],
    'netflix.com': ['assets.nflxext.com'],
    'twitch.tv': ['clips.twitch.tv'],
    'discord.com': ['discord.gg', 'discordapp.com', 'www.discordapp.com'],
    'primevideo.com': ['app.primevideo.com'],
    'github.com': ['gist.github.com'],
    'chess.com': ['lichess.org', 'www.lichess.org'],
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// YouTube allowance: a daily budget within set hours, watched at most one sitting at a time.
// The Chrome extension reports when you're actually watching; only that time
// counts. After a full sitting YouTube locks for a break.
const defaultAllowance = () => ({
    enabled: true,
    sites: ['youtube.com'],
    dailyMinutes: 120,
    sittingMinutes: 40,
    breakMinutes: 30,
    openFrom: '08:00', // YouTube is blocked outside these hours
    openUntil: '23:00',
    usage: {}, // { 'YYYY-MM-DD': ms watched }
    sitting: { usedMs: 0, lastWatchedAt: 0 },
    cooldownUntil: 0,
    pending: null, // { enabled, dailyMinutes, sittingMinutes, breakMinutes, effectiveDay }
});

const defaultState = () => ({
    mode: 'idle', // 'idle' | 'session' | 'block'
    session: null, // { startedAt, endsAt, plannedMinutes, intention }
    blockStartedAt: null,
    sites: [...DEFAULT_SITES],
    siteProfiles: {}, // domain -> profile ids it's blocked in (absent = all)
    blockProfile: null,
    settings: {
        earlyEnd: 'phrase',
        passwordHash: null,
        passwordSalt: null,
        dailyTargetMinutes: 480, // study time only
        lectureMinutes: 60,
        meetingMinutes: 60,
    },
    history: [], // { startedAt, endedAt, plannedMinutes, intention, profile, completed }
    days: {}, // 'YYYY-MM-DD' (4am-based) -> { lectures, meetings }
    // Entertainment list: blocked every night, and during YouTube breaks (except breakExempt).
    night: { enabled: true, from: '22:30', until: '06:00', sites: [...DEFAULT_NIGHT_SITES], breakExempt: ['github.com'] },
    // Daily timers for sites metered by the extension (time the tab is in front of you).
    timers: { linkedin: { label: 'LinkedIn', domain: 'linkedin.com', dailyMinutes: 10, enabled: true, pending: null } },
    timerUsage: {}, // 'YYYY-MM-DD' -> { timerId: ms }
    // Weekly pass: once a week, on this day, entertainment is uncapped until the 4am reset.
    pass: { day: 5, activeUntil: 0, usedWeek: null }, // day: 0 = Sunday ... 5 = Friday
    // Loop breaker: bouncing between inbox-type sites blocks them for a while.
    loop: {
        enabled: true,
        hops: 6, // switches between these apps...
        windowMinutes: 10, // ...within this many minutes
        blockMinutes: 30,
        until: 0,
        apps: {
            gmail: ['mail.google.com', 'gmail.com'],
            outlook: ['outlook.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com'],
            linkedin: ['linkedin.com'],
        },
        blockSites: ['gmail.com', 'outlook.com', 'linkedin.com'],
    },
    allowance: defaultAllowance(),
});

let state = defaultState();

const loadState = () => {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        const defaults = defaultState();
        state = {
            ...defaults,
            ...saved,
            settings: { ...defaults.settings, ...saved.settings },
            allowance: { ...defaults.allowance, ...saved.allowance },
            night: { ...defaults.night, ...saved.night },
            timers: { ...defaults.timers, ...saved.timers },
            loop: { ...defaults.loop, ...saved.loop, apps: defaults.loop.apps, blockSites: defaults.loop.blockSites },
            pass: { ...defaults.pass, ...saved.pass },
        };
        // Older versions tracked usage per meal slot.
        const a = state.allowance;
        delete a.slots;
        Object.keys(a.usage).forEach((day) => {
            if (typeof a.usage[day] === 'object') a.usage[day] = Object.values(a.usage[day]).reduce((x, y) => x + y, 0);
        });
        if (a.pending && a.pending.slots) a.pending = null;
        return true;
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('Could not read state file, starting fresh:', error.message);
        return false;
    }
};

const saveState = () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
};

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

// Turn user input ("https://www.YouTube.com/watch?v=1") into a bare domain ("youtube.com").
const normalizeDomain = (input) => {
    if (typeof input !== 'string') return null;
    let raw = input.trim().toLowerCase();
    if (!raw) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) raw = `http://${raw}`;

    let hostname;
    try {
        hostname = new URL(raw).hostname;
    } catch {
        return null;
    }
    hostname = hostname.replace(/^(www|m)\./, '').replace(/\.$/, '');
    return DOMAIN_RE.test(hostname) ? hostname : null;
};

const expandSite = (domain) => {
    const hosts = new Set([domain]);
    if (domain.split('.').length === 2) {
        hosts.add(`www.${domain}`);
        hosts.add(`m.${domain}`);
    }
    (RELATED_DOMAINS[domain] || []).forEach((d) => hosts.add(d));
    return [...hosts];
};

const siteProfiles = (domain) => state.siteProfiles[domain] || PROFILE_IDS;
const blockedIn = (domain, profile) => siteProfiles(domain).includes(profile);
const activeProfile = () => {
    if (state.mode === 'session') return state.session.profile || PROFILE_IDS[0];
    if (state.mode === 'block') return state.blockProfile || PROFILE_IDS[0];
    return null;
};
const parseProfile = (id) => (PROFILE_IDS.includes(id) ? id : PROFILE_IDS[0]);

// Sites that should be blocked right now: the blocklist during focus/blocking,
// plus YouTube whenever the allowance doesn't permit it.
const blockedSites = () => {
    const sites = new Set();
    const profile = activeProfile();
    if (state.mode !== 'idle') state.sites.filter((d) => blockedIn(d, profile)).forEach((d) => sites.add(d));
    if (!youtubeAccess().allowed) state.allowance.sites.forEach((d) => sites.add(d));
    entertainmentBlocked().forEach((d) => sites.add(d));
    Object.keys(state.timers).forEach((id) => {
        if (!timerAllowed(id)) sites.add(state.timers[id].domain);
    });
    if (loopActive()) state.loop.blockSites.forEach((d) => sites.add(d));
    return [...sites];
};

const allBlockedHosts = () => [...new Set(blockedSites().flatMap(expandSite))];

// ---------------------------------------------------------------------------
// Hosts file
// ---------------------------------------------------------------------------

const flushDNS = () => {
    if (!USING_SYSTEM_HOSTS) return;
    try {
        execSync('dscacheutil -flushcache');
        execSync('killall -HUP mDNSResponder');
    } catch (error) {
        console.error('Failed to flush DNS cache:', error.message);
    }
};

const readHosts = () => {
    try {
        return fs.readFileSync(HOSTS_FILE, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return '';
        throw error;
    }
};

const stripBlockSection = (content) => {
    const start = content.indexOf(MARKER_START);
    if (start === -1) return content;
    const end = content.indexOf(MARKER_END, start);
    if (end === -1) return content;
    return content.slice(0, start) + content.slice(end + MARKER_END.length).replace(/^\n/, '');
};

const buildBlockSection = () => {
    const lines = allBlockedHosts().flatMap((host) => [`0.0.0.0 ${host}`, `:: ${host}`]);
    return `${MARKER_START}\n${lines.join('\n')}\n${MARKER_END}\n`;
};

// Make the hosts file match the current mode. Only writes when something changed.
const syncHosts = () => {
    const current = readHosts();
    let desired = stripBlockSection(current);
    if (desired && !desired.endsWith('\n')) desired += '\n';
    if (blockedSites().length > 0) desired += buildBlockSection();

    if (desired === current) return false;
    fs.writeFileSync(HOSTS_FILE, desired, 'utf8');
    flushDNS();
    return true;
};

const backupHostsOnce = () => {
    const backup = path.join(DATA_DIR, 'hosts.backup');
    if (fs.existsSync(backup)) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(backup, stripBlockSection(readHosts()));
};

// ---------------------------------------------------------------------------
// Allowance
// ---------------------------------------------------------------------------

// The YouTube day runs 4am to 4am, so late nights count toward the day before.
const DAY_START_HOUR = 4;

const dayKey = (ts = Date.now()) => {
    const d = new Date(ts);
    d.setHours(d.getHours() - DAY_START_HOUR);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Timestamp for HH:MM on the same calendar day as ts.
const atTime = (hhmm, ts = Date.now()) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(ts);
    d.setHours(h, m, 0, 0);
    return d.getTime();
};

// When YouTube's open hours start and end around `now`.
const openWindow = (now = Date.now()) => {
    const { openFrom, openUntil } = state.allowance;
    const start = atTime(openFrom, now);
    const end = atTime(openUntil, now);
    const isOpen = now >= start && now < end;
    let opensAt = start;
    if (now >= end) opensAt = atTime(openFrom, now + 24 * 60 * 60 * 1000);
    return { isOpen, opensAt, closesAt: end };
};

// Next 4am, when today's budget resets.
const nextDayStart = (ts = Date.now()) => {
    const d = new Date(ts);
    d.setHours(DAY_START_HOUR, 0, 0, 0);
    if (d.getTime() <= ts) d.setDate(d.getDate() + 1);
    return d.getTime();
};

const HEARTBEAT_TIMEOUT_MS = 75 * 1000; // extension pings at least every 30s
const ACCRUE_GRACE_MS = 30 * 1000; // count at most this long past the last ping

// Live data from the Chrome extension. Not persisted: it reconnects on its own.
const monitor = { lastSeenAt: 0, watching: false, watchingSince: null };

const extensionConnected = (now = Date.now()) => now - monitor.lastSeenAt < HEARTBEAT_TIMEOUT_MS;

const liveWatchMs = (now = Date.now()) => {
    if (!monitor.watching || !monitor.watchingSince) return 0;
    return Math.max(0, Math.min(now, monitor.lastSeenAt + ACCRUE_GRACE_MS) - monitor.watchingSince);
};

const dailyUsedMs = (now = Date.now()) => {
    const a = state.allowance;
    return Math.min((a.usage[dayKey(now)] || 0) + liveWatchMs(now), a.dailyMinutes * 60000);
};

// A sitting resets once you've stayed away for a full break.
const sittingUsedMs = (now = Date.now()) => {
    const { sitting, breakMinutes, sittingMinutes } = state.allowance;
    if (!monitor.watching && now - sitting.lastWatchedAt >= breakMinutes * 60000) return 0;
    return Math.min(sitting.usedMs + liveWatchMs(now), sittingMinutes * 60000);
};

// Move watched time since the last check into today's usage and the sitting.
const accrue = (now = Date.now()) => {
    if (!monitor.watching || !monitor.watchingSince) return;
    const a = state.allowance;
    const end = Math.min(now, monitor.lastSeenAt + ACCRUE_GRACE_MS);
    const add = Math.max(0, end - monitor.watchingSince);
    const day = dayKey(monitor.watchingSince);
    a.usage[day] = Math.min((a.usage[day] || 0) + add, a.dailyMinutes * 60000);
    a.sitting.usedMs += add;
    a.sitting.lastWatchedAt = end;

    if (a.sitting.usedMs >= a.sittingMinutes * 60000) {
        a.cooldownUntil = end + a.breakMinutes * 60000;
        a.sitting = { usedMs: 0, lastWatchedAt: end };
        monitor.watching = false;
        monitor.watchingSince = null;
    } else if (end < now) {
        monitor.watching = false;
        monitor.watchingSince = null;
    } else {
        monitor.watchingSince = now;
    }
};

// Whether YouTube should be reachable right now, and why not.
// ---------------------------------------------------------------------------
// Weekly pass
// ---------------------------------------------------------------------------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The 4am-based calendar day, and its ISO week, so one pass per week.
const passDate = (ts) => new Date(ts - DAY_START_HOUR * 60 * 60 * 1000);
const weekKey = (ts) => {
    const d = passDate(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    const n = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    return `${d.getFullYear()}-W${n}`;
};
const passActive = (now = Date.now()) => now < state.pass.activeUntil;
const passUsedThisWeek = (now = Date.now()) => state.pass.usedWeek === weekKey(now);
const passAvailable = (now = Date.now()) => !passActive(now) && !passUsedThisWeek(now)
    && passDate(now).getDay() === state.pass.day && state.mode !== 'session';

const passStatus = (now = Date.now()) => {
    const next = new Date(nextDayStart(now));
    while (next.getDay() !== state.pass.day) next.setDate(next.getDate() + 1);
    return {
        day: state.pass.day,
        dayName: DAYS[state.pass.day],
        active: passActive(now),
        activeUntil: passActive(now) ? state.pass.activeUntil : null,
        available: passAvailable(now),
        usedThisWeek: passUsedThisWeek(now),
        nextDate: next.getTime(),
    };
};

const youtubeAccess = (now = Date.now()) => {
    const a = state.allowance;
    if (!a.enabled) return { allowed: true, reason: 'unlimited' };
    if (state.mode === 'session') return { allowed: false, reason: 'focus' };
    if (state.mode === 'block') return { allowed: false, reason: 'block' };
    if (passActive(now)) return { allowed: true, reason: 'pass' };
    if (!openWindow(now).isOpen) return { allowed: false, reason: 'hours' };
    if (dailyUsedMs(now) >= a.dailyMinutes * 60000) return { allowed: false, reason: 'daily' };
    if (now < a.cooldownUntil || sittingUsedMs(now) >= a.sittingMinutes * 60000) return { allowed: false, reason: 'cooldown' };
    if (!extensionConnected(now)) return { allowed: false, reason: 'extension' };
    return { allowed: true, reason: 'open' };
};

const youtubeStatus = (now = Date.now()) => {
    const a = state.allowance;
    const access = youtubeAccess(now);
    const dailyMs = a.dailyMinutes * 60000;
    const sittingMs = a.sittingMinutes * 60000;
    const daily = dailyUsedMs(now);
    const sitting = sittingUsedMs(now);
    const hours = openWindow(now);
    let cooldownUntil = null;
    if (access.reason === 'cooldown') cooldownUntil = now < a.cooldownUntil ? a.cooldownUntil : now + a.breakMinutes * 60000;
    return {
        ...access,
        remainingMs: Math.max(0, Math.min(dailyMs - daily, sittingMs - sitting, hours.closesAt - now)),
        dailyUsedMs: daily,
        dailyMs,
        sittingUsedMs: sitting,
        sittingMs,
        breakMs: a.breakMinutes * 60000,
        cooldownUntil,
        resetsAt: nextDayStart(now),
        opensAt: hours.isOpen ? null : hours.opensAt,
        closesAt: hours.closesAt,
        openFrom: a.openFrom,
        openUntil: a.openUntil,
        watching: monitor.watching && access.allowed,
        focusEndsAt: state.mode === 'session' ? state.session.endsAt : null,
        now,
    };
};

const pruneUsage = () => {
    const cutoff = dayKey(Date.now() - 60 * 24 * 60 * 60 * 1000);
    Object.keys(state.allowance.usage).forEach((k) => {
        if (k < cutoff) delete state.allowance.usage[k];
    });
};

const LIMITS = { dailyMinutes: [1, 720], sittingMinutes: [1, 240], breakMinutes: [0, 240] };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const validateLimits = (body, current) => {
    const out = {};
    for (const [key, [min, max]] of Object.entries(LIMITS)) {
        const v = body[key] === undefined ? current[key] : Math.round(Number(body[key]));
        if (!Number.isFinite(v) || v < min || v > max) return null;
        out[key] = v;
    }
    for (const key of ['openFrom', 'openUntil']) {
        const v = body[key] === undefined ? current[key] : body[key];
        if (!TIME_RE.test(v)) return null;
        out[key] = v;
    }
    if (out.openFrom >= out.openUntil) return null;
    return out;
};


// A change that only ever gives you less YouTube can apply immediately.
const isTightening = (oldA, next) => {
    if (!oldA.enabled) return true;
    if (!next.enabled) return false;
    return next.dailyMinutes <= oldA.dailyMinutes
        && next.sittingMinutes <= oldA.sittingMinutes
        && next.breakMinutes >= oldA.breakMinutes
        && next.openFrom >= oldA.openFrom
        && next.openUntil <= oldA.openUntil;
};

const applyAllowanceConfig = (next) => {
    accrue();
    const a = state.allowance;
    a.enabled = next.enabled;
    a.dailyMinutes = next.dailyMinutes;
    a.sittingMinutes = next.sittingMinutes;
    a.breakMinutes = next.breakMinutes;
    a.openFrom = next.openFrom;
    a.openUntil = next.openUntil;
    a.pending = null;
};

// ---------------------------------------------------------------------------
// Daily timers (LinkedIn) and the loop breaker
// ---------------------------------------------------------------------------

const timerMonitor = {}; // timerId -> { active, since }

const timerLiveMs = (id, now = Date.now()) => {
    const m = timerMonitor[id];
    if (!m || !m.active || !m.since) return 0;
    return Math.max(0, Math.min(now, monitor.lastSeenAt + ACCRUE_GRACE_MS) - m.since);
};

const timerUsedMs = (id, now = Date.now()) => {
    const t = state.timers[id];
    const stored = (state.timerUsage[dayKey(now)] || {})[id] || 0;
    return Math.min(stored + timerLiveMs(id, now), t.dailyMinutes * 60000);
};

const timerAllowed = (id, now = Date.now()) => {
    const t = state.timers[id];
    if (!t.enabled) return true;
    return extensionConnected(now) && timerUsedMs(id, now) < t.dailyMinutes * 60000;
};

const accrueTimers = (now = Date.now()) => {
    const end = Math.min(now, monitor.lastSeenAt + ACCRUE_GRACE_MS);
    Object.entries(timerMonitor).forEach(([id, m]) => {
        if (!m.active || !m.since || !state.timers[id]) return;
        const day = dayKey(m.since);
        state.timerUsage[day] = state.timerUsage[day] || {};
        const cap = state.timers[id].dailyMinutes * 60000;
        state.timerUsage[day][id] = Math.min((state.timerUsage[day][id] || 0) + Math.max(0, end - m.since), cap);
        if (end < now) timerMonitor[id] = { active: false, since: null };
        else m.since = now;
    });
};

const timerStatus = (now = Date.now()) => Object.fromEntries(Object.entries(state.timers).map(([id, t]) => {
    const usedMs = timerUsedMs(id, now);
    const dailyMs = t.dailyMinutes * 60000;
    return [id, {
        label: t.label,
        domain: t.domain,
        enabled: t.enabled,
        allowed: timerAllowed(id, now),
        usedMs,
        dailyMs,
        remainingMs: Math.max(0, dailyMs - usedMs),
        active: Boolean(timerMonitor[id] && timerMonitor[id].active),
        pending: t.pending,
    }];
}));

const loopActive = (now = Date.now()) => state.loop.enabled && now < state.loop.until;

const loopStatus = (now = Date.now()) => {
    const { enabled, hops, windowMinutes, blockMinutes, until, apps } = state.loop;
    return { enabled, hops, windowMinutes, blockMinutes, active: loopActive(now), until: loopActive(now) ? until : null, apps };
};

// Everything the extension needs to meter and enforce.
const extensionStatus = (now = Date.now()) => ({
    ...youtubeStatus(now),
    pass: passStatus(now),
    timers: timerStatus(now),
    loop: loopStatus(now),
    entertainment: {
        reason: nightActive(now) ? 'night' : entertainmentBlocked(now).length ? youtubeAccess(now).reason : null,
        sites: entertainmentBlocked(now),
        metered: state.allowance.enabled ? meteredEntertainment() : [],
        nightUntil: state.night.until,
    },
});

// ---------------------------------------------------------------------------
// Night lock
// ---------------------------------------------------------------------------

const minutesOfDay = (ts) => {
    const d = new Date(ts);
    return d.getHours() * 60 + d.getMinutes();
};
const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};

// The window can cross midnight (22:30 -> 06:00).
const nightActive = (now = Date.now()) => {
    const { enabled, from, until } = state.night;
    if (!enabled) return false;
    const t = minutesOfDay(now);
    const a = toMinutes(from);
    const b = toMinutes(until);
    return a <= b ? t >= a && t < b : t >= a || t < b;
};

// The YouTube allowance is really an entertainment allowance: time on any
// entertainment site (except exempt ones like GitHub) comes out of the same daily
// budget and sittings, and they're all blocked together when it says no.
const youtubeBreak = (now = Date.now()) => youtubeAccess(now).reason === 'cooldown';

const meteredEntertainment = () => state.night.sites.filter((d) => !state.night.breakExempt.includes(d));

const entertainmentBlocked = (now = Date.now()) => {
    if (passActive(now) && state.mode === 'idle') return [];
    if (nightActive(now)) return state.night.sites;
    if (state.allowance.enabled && !youtubeAccess(now).allowed) return meteredEntertainment();
    return [];
};

// ---------------------------------------------------------------------------
// Daily log
// ---------------------------------------------------------------------------

// Study time, lectures and meetings per day (days start at 4am, like the YouTube
// budget). The target is study time only; lectures and meetings are tracked beside it.
const dailyLog = (count = 30, now = Date.now()) => {
    const focus = {};
    state.history.forEach((h) => {
        const k = dayKey(h.startedAt);
        focus[k] = (focus[k] || 0) + Math.max(0, h.endedAt - h.startedAt);
    });
    if (state.mode === 'session') {
        const k = dayKey(state.session.startedAt);
        focus[k] = (focus[k] || 0) + Math.max(0, Math.min(now, state.session.endsAt) - state.session.startedAt);
    }
    const lectureMs = state.settings.lectureMinutes * 60000;
    const meetingMs = state.settings.meetingMinutes * 60000;
    const targetMs = state.settings.dailyTargetMinutes * 60000;
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
        const ts = now - i * 24 * 60 * 60 * 1000;
        const day = dayKey(ts);
        const { lectures = 0, meetings = 0 } = state.days[day] || {};
        const focusMs = focus[day] || 0;
        out.push({
            day,
            ts,
            focusMs,
            lectures,
            lectureMs: lectures * lectureMs,
            meetings,
            meetingMs: meetings * meetingMs,
            totalMs: focusMs + lectures * lectureMs + meetings * meetingMs,
            met: focusMs >= targetMs,
        });
    }
    return out;
};

const targetStreak = (log) => {
    let streak = 0;
    for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].met) streak++;
        else if (i !== log.length - 1) break; // today not done yet doesn't break it
    }
    return streak;
};

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const finishSession = (completed) => {
    const { session } = state;
    if (!session) return;
    state.history.push({
        startedAt: session.startedAt,
        endedAt: completed ? session.endsAt : Date.now(),
        plannedMinutes: session.plannedMinutes,
        intention: session.intention,
        profile: session.profile,
        completed,
    });
    state.mode = 'idle';
    state.session = null;
    saveState();
    syncHosts();
    console.log(completed ? 'Session complete. Sites unblocked.' : 'Session ended early.');
};

let lastEnforced = 0;
let lastYoutubeAllowed = null;
let lastLimitsKey = null;
const tick = () => {
    if (state.mode === 'session' && Date.now() >= state.session.endsAt) {
        finishSession(true);
        return;
    }
    const a = state.allowance;
    // Block or unblock YouTube the moment access changes (sitting or daily
    // limit reached, break over, extension disconnects).
    const access = youtubeAccess();
    // Same for LinkedIn's timer and the loop breaker.
    const limitsKey = JSON.stringify([Object.keys(state.timers).map((id) => timerAllowed(id)), loopActive()]);
    if (limitsKey !== lastLimitsKey) {
        lastLimitsKey = limitsKey;
        accrueTimers();
        saveState();
        syncHosts();
    }
    Object.entries(state.timers).forEach(([id, t]) => {
        if (t.pending && dayKey() >= t.pending.effectiveDay) {
            accrueTimers();
            state.timers[id] = { ...t, dailyMinutes: t.pending.dailyMinutes, enabled: t.pending.enabled, pending: null };
            saveState();
            syncHosts();
        }
    });
    if (access.allowed !== lastYoutubeAllowed) {
        lastYoutubeAllowed = access.allowed;
        accrue();
        saveState();
        syncHosts();
        console.log(`YouTube ${access.allowed ? 'unblocked' : `blocked (${access.reason})`}.`);
    }
    if (a.pending && dayKey() >= a.pending.effectiveDay) {
        applyAllowanceConfig(a.pending);
        saveState();
        syncHosts();
        console.log('Applied scheduled allowance changes.');
    }
    // Re-apply the block if someone edited /etc/hosts by hand mid-session.
    if (Date.now() - lastEnforced >= ENFORCE_EVERY_MS) {
        lastEnforced = Date.now();
        try {
            if (syncHosts()) console.log('Hosts file was out of sync and has been restored.');
        } catch (error) {
            console.error('Failed to sync hosts file:', error.message);
        }
    }
};

const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 32).toString('hex');

const checkPassword = (password) => {
    const { passwordHash, passwordSalt } = state.settings;
    if (!passwordHash || typeof password !== 'string') return false;
    const a = Buffer.from(hashPassword(password, passwordSalt), 'hex');
    const b = Buffer.from(passwordHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const normalizePhrase = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');

// Only answer requests addressed to this machine, from our own page. This stops
// other websites (and DNS rebinding) from driving a root process.
const allowedHosts = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
app.use((req, res, next) => {
    const host = req.headers.host;
    if (!allowedHosts.has(host)) return res.status(403).send('Forbidden');
    const origin = req.headers.origin;
    const fromExtension = origin && origin.startsWith('chrome-extension://')
        && (req.path.startsWith('/api/youtube/') || req.path.startsWith('/api/ext/'));
    if (req.method !== 'GET' && origin && origin !== `http://${host}` && !fromExtension) {
        return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
    }
    next();
});

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const publicState = () => {
    const since = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const log = dailyLog(30);
    return {
        mode: state.mode,
        session: state.session,
        blockStartedAt: state.blockStartedAt,
        sites: state.sites.map((domain) => ({ domain, hosts: expandSite(domain), profiles: siteProfiles(domain) })),
        profiles: PROFILES,
        activeProfile: activeProfile(),
        settings: {
            earlyEnd: state.settings.earlyEnd,
            hasPassword: Boolean(state.settings.passwordHash),
            phrase: EARLY_END_PHRASE,
        },
        history: state.history.filter((h) => h.endedAt >= since),
        today: dayKey(),
        days: log,
        streak: targetStreak(log),
        target: {
            dailyMinutes: state.settings.dailyTargetMinutes,
            lectureMinutes: state.settings.lectureMinutes,
            meetingMinutes: state.settings.meetingMinutes,
        },
        timers: timerStatus(),
        pass: passStatus(),
        loop: loopStatus(),
        night: {
            enabled: state.night.enabled,
            from: state.night.from,
            until: state.night.until,
            active: nightActive(),
            breakActive: youtubeBreak(),
            sites: state.night.sites.map((domain) => ({
                domain,
                hosts: expandSite(domain),
                duringBreaks: !state.night.breakExempt.includes(domain),
            })),
        },
        allowance: publicAllowance(),
        now: Date.now(),
    };
};

const publicAllowance = () => {
    const a = state.allowance;
    return {
        enabled: a.enabled,
        sites: a.sites,
        dailyMinutes: a.dailyMinutes,
        sittingMinutes: a.sittingMinutes,
        breakMinutes: a.breakMinutes,
        openFrom: a.openFrom,
        openUntil: a.openUntil,
        pending: a.pending,
        status: youtubeStatus(),
        extension: { connected: extensionConnected(), path: path.join(__dirname, 'extension') },
    };
};

const fail = (res, status, error) => res.status(status).json({ error });

const withHosts = (res, fn) => {
    try {
        fn();
        saveState();
        syncHosts();
        res.json(publicState());
    } catch (error) {
        console.error(error);
        fail(res, 500, `Could not update the hosts file: ${error.message}`);
    }
};

app.get('/api/state', (req, res) => res.json(publicState()));

const startSession = (req, res) => {
    if (state.mode === 'session') return fail(res, 409, 'A focus session is already running.');
    const minutes = Math.round(Number(req.body.minutes));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_SESSION_MINUTES) {
        return fail(res, 400, `Duration must be between 1 and ${MAX_SESSION_MINUTES} minutes.`);
    }
    if (state.sites.length === 0) return fail(res, 400, 'Add at least one site to block first.');

    const intention = typeof req.body.intention === 'string' ? req.body.intention.trim().slice(0, 120) : '';
    const now = Date.now();
    withHosts(res, () => {
        accrue();
        state.mode = 'session';
        state.blockStartedAt = null;
        state.session = { startedAt: now, endsAt: now + minutes * 60 * 1000, plannedMinutes: minutes, intention, profile: parseProfile(req.body.profile) };
    });
};

app.post('/api/session/start', startSession);

app.post('/api/session/extend', (req, res) => {
    if (state.mode !== 'session') return fail(res, 409, 'No focus session is running.');
    const minutes = Math.round(Number(req.body.minutes) || 15);
    if (minutes < 1 || minutes > 120) return fail(res, 400, 'You can extend by 1 to 120 minutes at a time.');
    state.session.endsAt += minutes * 60 * 1000;
    state.session.plannedMinutes += minutes;
    saveState();
    res.json(publicState());
});

app.post('/api/session/stop', (req, res) => {
    if (state.mode !== 'session') return fail(res, 409, 'No focus session is running.');
    const { earlyEnd } = state.settings;

    if (earlyEnd === 'locked') return fail(res, 403, 'Strict mode is on. This session can’t be ended early.');
    if (earlyEnd === 'password' && !checkPassword(req.body.password)) return fail(res, 401, 'Incorrect password.');
    if (earlyEnd === 'phrase' && normalizePhrase(req.body.phrase) !== normalizePhrase(EARLY_END_PHRASE)) {
        return fail(res, 401, 'That doesn’t match the phrase.');
    }

    try {
        finishSession(false);
        res.json(publicState());
    } catch (error) {
        fail(res, 500, `Could not update the hosts file: ${error.message}`);
    }
});

app.post('/api/block/start', (req, res) => {
    if (state.mode !== 'idle') return fail(res, 409, 'Blocking is already on.');
    if (state.sites.length === 0) return fail(res, 400, 'Add at least one site to block first.');
    withHosts(res, () => {
        accrue();
        state.mode = 'block';
        state.blockStartedAt = Date.now();
        state.blockProfile = parseProfile(req.body && req.body.profile);
    });
});

app.post('/api/block/stop', (req, res) => {
    if (state.mode !== 'block') return fail(res, 409, 'Open-ended blocking isn’t on.');
    withHosts(res, () => {
        state.mode = 'idle';
        state.blockStartedAt = null;
    });
});

app.post('/api/sites', (req, res) => {
    const domain = normalizeDomain(req.body.domain);
    if (!domain) return fail(res, 400, 'That doesn’t look like a valid website.');
    if (state.sites.includes(domain)) return fail(res, 409, `${domain} is already on your list.`);
    withHosts(res, () => {
        state.sites.push(domain);
    });
});

app.put('/api/sites/:domain', (req, res) => {
    const domain = String(req.params.domain).toLowerCase();
    if (!state.sites.includes(domain)) return fail(res, 404, 'That site isn’t on your list.');
    const profiles = req.body.profiles;
    if (!Array.isArray(profiles) || profiles.length === 0 || profiles.some((p) => !PROFILE_IDS.includes(p))) {
        return fail(res, 400, 'Pick at least one mode to block it in, or remove the site.');
    }
    const active = activeProfile();
    if (state.mode === 'session' && blockedIn(domain, active) && !profiles.includes(active)) {
        return fail(res, 423, 'You can’t unblock a site in the mode you’re focusing in.');
    }
    withHosts(res, () => {
        if (profiles.length === PROFILE_IDS.length) delete state.siteProfiles[domain];
        else state.siteProfiles[domain] = PROFILE_IDS.filter((p) => profiles.includes(p));
    });
});

app.delete('/api/sites/:domain', (req, res) => {
    const domain = String(req.params.domain).toLowerCase();
    if (!state.sites.includes(domain)) return fail(res, 404, 'That site isn’t on your list.');
    if (state.mode === 'session') return fail(res, 423, 'Sites can’t be removed during a focus session.');
    withHosts(res, () => {
        state.sites = state.sites.filter((d) => d !== domain);
        delete state.siteProfiles[domain];
    });
});

app.put('/api/settings', (req, res) => {
    if (state.mode === 'session') return fail(res, 423, 'Settings are locked during a focus session.');
    const { earlyEnd, password, currentPassword, dailyTargetMinutes, lectureMinutes, meetingMinutes } = req.body;
    const settings = state.settings;

    if (dailyTargetMinutes !== undefined) {
        const v = Math.round(Number(dailyTargetMinutes));
        if (!Number.isFinite(v) || v < 480 || v > 960) return fail(res, 400, 'Daily target must be between 8 and 16 hours.');
        settings.dailyTargetMinutes = v;
    }
    if (lectureMinutes !== undefined) {
        const v = Math.round(Number(lectureMinutes));
        if (!Number.isFinite(v) || v < 15 || v > 240) return fail(res, 400, 'Lecture length must be 15–240 minutes.');
        settings.lectureMinutes = v;
    }
    if (meetingMinutes !== undefined) {
        const v = Math.round(Number(meetingMinutes));
        if (!Number.isFinite(v) || v < 5 || v > 240) return fail(res, 400, 'Meeting length must be 5–240 minutes.');
        settings.meetingMinutes = v;
    }

    if (password !== undefined || (earlyEnd && earlyEnd !== settings.earlyEnd && settings.earlyEnd === 'password')) {
        if (settings.passwordHash && !checkPassword(currentPassword)) return fail(res, 401, 'Current password is incorrect.');
    }

    if (password !== undefined) {
        if (typeof password !== 'string' || password.length < 4) return fail(res, 400, 'Password must be at least 4 characters.');
        settings.passwordSalt = crypto.randomBytes(16).toString('hex');
        settings.passwordHash = hashPassword(password, settings.passwordSalt);
    }

    if (earlyEnd !== undefined) {
        if (!['phrase', 'password', 'locked'].includes(earlyEnd)) return fail(res, 400, 'Unknown option.');
        if (earlyEnd === 'password' && !settings.passwordHash) return fail(res, 400, 'Set a password first.');
        settings.earlyEnd = earlyEnd;
    }

    saveState();
    res.json(publicState());
});

// Chrome extension check-in: reports whether a YouTube video is playing or a
// YouTube tab is in front of you. Returns what the extension should enforce.
app.post('/api/youtube/heartbeat', (req, res) => {
    const now = Date.now();
    accrue(now);
    accrueTimers(now);
    monitor.lastSeenAt = now;
    const active = req.body.active || {};
    Object.keys(state.timers).forEach((id) => {
        const on = active[id] === true && timerAllowed(id, now);
        const m = timerMonitor[id] || { active: false, since: null };
        timerMonitor[id] = on ? { active: true, since: m.active ? m.since : now } : { active: false, since: null };
    });
    const access = youtubeAccess(now);
    const watching = req.body.watching === true && access.allowed && access.reason === 'open';
    if (watching && !monitor.watching) {
        const a = state.allowance;
        if (now - a.sitting.lastWatchedAt >= a.breakMinutes * 60000) a.sitting = { usedMs: 0, lastWatchedAt: now };
        monitor.watchingSince = now;
    }
    if (!watching) monitor.watchingSince = null;
    monitor.watching = watching;
    pruneUsage();
    saveState();
    if (access.allowed !== lastYoutubeAllowed) {
        lastYoutubeAllowed = access.allowed;
        syncHosts();
    }
    res.json(extensionStatus(now));
});

app.get('/api/youtube/status', (req, res) => res.json(extensionStatus()));

// The extension saw you bouncing between Gmail, Outlook and LinkedIn.
app.post('/api/ext/loop', (req, res) => {
    const now = Date.now();
    if (state.loop.enabled && state.mode === 'idle' && !loopActive(now)) {
        state.loop.until = now + state.loop.blockMinutes * 60000;
        console.log(`Loop detected (${(req.body.apps || []).join(' → ')}). Inbox sites blocked for ${state.loop.blockMinutes} min.`);
        saveState();
        syncHosts();
    }
    res.json(extensionStatus(now));
});

// Start a session straight from the extension's "get to work" page.
app.post('/api/ext/session', startSession);

app.put('/api/timers/:id', (req, res) => {
    const t = state.timers[req.params.id];
    if (!t) return fail(res, 404, 'Unknown timer.');
    if (state.mode === 'session') return fail(res, 423, 'Settings are locked during a focus session.');
    const dailyMinutes = req.body.dailyMinutes === undefined ? t.dailyMinutes : Math.round(Number(req.body.dailyMinutes));
    const enabled = req.body.enabled === undefined ? t.enabled : Boolean(req.body.enabled);
    if (!Number.isFinite(dailyMinutes) || dailyMinutes < 1 || dailyMinutes > 240) return fail(res, 400, 'Daily limit must be 1–240 minutes.');
    // More time waits for the next 4am reset, like the YouTube limits.
    const loosening = (t.enabled && !enabled) || dailyMinutes > t.dailyMinutes;
    withHosts(res, () => {
        accrueTimers();
        if (loosening) t.pending = { dailyMinutes, enabled, effectiveDay: dayKey(nextDayStart()) };
        else Object.assign(t, { dailyMinutes, enabled, pending: null });
    });
});

app.post('/api/pass/start', (req, res) => {
    const now = Date.now();
    if (passActive(now)) return fail(res, 409, 'Your pass is already on.');
    if (passUsedThisWeek(now)) return fail(res, 409, 'You’ve used this week’s pass.');
    if (passDate(now).getDay() !== state.pass.day) return fail(res, 403, `Your pass is for ${DAYS[state.pass.day]}s.`);
    if (state.mode === 'session') return fail(res, 423, 'Finish your focus session first.');
    withHosts(res, () => {
        accrue(now);
        state.pass.activeUntil = nextDayStart(now);
        state.pass.usedWeek = weekKey(now);
        console.log(`Weekly pass on until ${new Date(state.pass.activeUntil).toLocaleString()}.`);
    });
});

app.put('/api/pass', (req, res) => {
    if (passActive()) return fail(res, 423, 'Change your pass day after tonight.');
    const day = Math.round(Number(req.body.day));
    if (!Number.isInteger(day) || day < 0 || day > 6) return fail(res, 400, 'Pick a day of the week.');
    state.pass.day = day;
    saveState();
    res.json(publicState());
});

app.put('/api/loop', (req, res) => {
    if (loopActive()) return fail(res, 423, 'The loop breaker is on. Get some work done first.');
    const next = { ...state.loop };
    if (req.body.enabled !== undefined) next.enabled = Boolean(req.body.enabled);
    for (const [key, min, max] of [['hops', 3, 20], ['windowMinutes', 2, 60], ['blockMinutes', 5, 120]]) {
        if (req.body[key] === undefined) continue;
        const v = Math.round(Number(req.body[key]));
        if (!Number.isFinite(v) || v < min || v > max) return fail(res, 400, `${key} must be ${min}–${max}.`);
        next[key] = v;
    }
    state.loop = next;
    saveState();
    res.json(publicState());
});

app.put('/api/allowance', (req, res) => {
    if (state.mode === 'session') return fail(res, 423, 'Settings are locked during a focus session.');
    const a = state.allowance;
    const enabled = req.body.enabled === undefined ? a.enabled : Boolean(req.body.enabled);
    const limits = validateLimits(req.body, a);
    if (!limits) return fail(res, 400, 'Daily limit 1–720 min, sitting 1–240 min, break 0–240 min, and open hours must start before they end.');
    if (limits.sittingMinutes > limits.dailyMinutes) return fail(res, 400, 'A sitting can’t be longer than the daily limit.');

    const next = { enabled, ...limits };
    const immediate = isTightening(a, next);
    withHosts(res, () => {
        if (immediate) {
            applyAllowanceConfig(next);
        } else {
            a.pending = { ...next, effectiveDay: dayKey(nextDayStart()) };
        }
    });
});

// Lecture and meeting counts for today, or a past day (for backfilling).
app.put('/api/day', (req, res) => {
    const today = dayKey();
    const day = req.body.day === undefined ? today : String(req.body.day);
    const oldest = dayKey(Date.now() - 60 * 24 * 60 * 60 * 1000);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today || day < oldest) {
        return fail(res, 400, 'You can only edit today or the last 60 days.');
    }
    const next = { ...state.days[day] };
    for (const key of ['lectures', 'meetings']) {
        if (req.body[key] === undefined) continue;
        const count = Math.round(Number(req.body[key]));
        if (!Number.isFinite(count) || count < 0 || count > 12) return fail(res, 400, 'Counts must be between 0 and 12.');
        next[key] = count;
    }
    state.days[day] = next;
    saveState();
    res.json(publicState());
});

// Night lock can't be loosened while it's on.
const nightLocked = (res) => {
    if (!nightActive()) return false;
    fail(res, 423, `Night lock is on until ${state.night.until}.`);
    return true;
};

app.post('/api/night/sites', (req, res) => {
    const domain = normalizeDomain(req.body.domain);
    if (!domain) return fail(res, 400, 'That doesn’t look like a valid website.');
    if (state.night.sites.includes(domain)) return fail(res, 409, `${domain} is already on the night list.`);
    withHosts(res, () => state.night.sites.push(domain));
});

app.delete('/api/night/sites/:domain', (req, res) => {
    const domain = String(req.params.domain).toLowerCase();
    if (!state.night.sites.includes(domain)) return fail(res, 404, 'That site isn’t on the night list.');
    if (nightLocked(res)) return;
    withHosts(res, () => {
        state.night.sites = state.night.sites.filter((d) => d !== domain);
        state.night.breakExempt = state.night.breakExempt.filter((d) => d !== domain);
    });
});

// Whether a site on the entertainment list is also blocked during YouTube breaks.
app.put('/api/night/sites/:domain', (req, res) => {
    const domain = String(req.params.domain).toLowerCase();
    if (!state.night.sites.includes(domain)) return fail(res, 404, 'That site isn’t on the list.');
    const during = Boolean(req.body.duringBreaks);
    if (!during && state.allowance.enabled && !youtubeAccess().allowed) {
        return fail(res, 423, 'Entertainment is blocked right now. Change this when it’s open again.');
    }
    withHosts(res, () => {
        state.night.breakExempt = state.night.breakExempt.filter((d) => d !== domain);
        if (!during) state.night.breakExempt.push(domain);
    });
});

app.put('/api/night', (req, res) => {
    if (nightLocked(res)) return;
    const next = { ...state.night };
    if (req.body.enabled !== undefined) next.enabled = Boolean(req.body.enabled);
    for (const key of ['from', 'until']) {
        if (req.body[key] === undefined) continue;
        if (!TIME_RE.test(req.body[key])) return fail(res, 400, 'Times must be HH:MM.');
        next[key] = req.body[key];
    }
    if (next.from === next.until) return fail(res, 400, 'Start and end can’t be the same.');
    withHosts(res, () => { state.night = next; });
});

// Daily log as CSV, for keeping your own records.
app.get('/api/export.csv', (req, res) => {
    const first = state.history.length ? Math.min(...state.history.map((h) => h.startedAt)) : Date.now();
    const lectureDays = Object.keys(state.days).sort();
    const firstLecture = lectureDays.length ? new Date(`${lectureDays[0]}T12:00:00`).getTime() : Date.now();
    const span = Math.ceil((Date.now() - Math.min(first, firstLecture)) / 86400000) + 1;
    const rows = dailyLog(span).map((d) => [
        d.day,
        Math.round(d.focusMs / 60000),
        d.lectures,
        Math.round(d.lectureMs / 60000),
        d.meetings,
        Math.round(d.meetingMs / 60000),
        Math.round(d.totalMs / 60000),
        d.met ? 'yes' : 'no',
    ].join(','));
    res.type('text/csv').attachment('focus-log.csv')
        .send(['day,study_minutes,lectures,lecture_minutes,meetings,meeting_minutes,total_minutes,study_target_met', ...rows].join('\n'));
});

app.delete('/api/history', (req, res) => {
    state.history = [];
    saveState();
    res.json(publicState());
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

if (USING_SYSTEM_HOSTS && process.getuid && process.getuid() !== 0) {
    console.error('This app edits /etc/hosts, so it has to run as root:');
    console.error('  sudo npm start');
    console.error('To try the UI without touching /etc/hosts:  npm run dev');
    process.exit(1);
}

// `node server.js --unblock` removes the block section and exits (used by the uninstaller).
if (process.argv.includes('--unblock')) {
    const current = readHosts();
    const cleaned = stripBlockSection(current);
    if (cleaned !== current) {
        fs.writeFileSync(HOSTS_FILE, cleaned, 'utf8');
        flushDNS();
    }
    console.log('Block section removed from hosts file.');
    process.exit(0);
}

loadState();
if (state.mode === 'session' && !state.session) state.mode = 'idle';
saveState();
backupHostsOnce();
tick();
setInterval(tick, 1000);

app.listen(PORT, HOST, () => {
    console.log(`Focus Mode running at http://localhost:${PORT}`);
    if (!USING_SYSTEM_HOSTS) console.log(`(dev mode: writing to ${HOSTS_FILE} instead of /etc/hosts)`);
});
