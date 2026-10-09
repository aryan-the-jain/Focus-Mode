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
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// YouTube allowance: a daily budget, watched at most one sitting at a time.
// The Chrome extension reports when you're actually watching; only that time
// counts. After a full sitting YouTube locks for a break.
const defaultAllowance = () => ({
    enabled: true,
    sites: ['youtube.com'],
    dailyMinutes: 120,
    sittingMinutes: 40,
    breakMinutes: 30,
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
    settings: { earlyEnd: 'phrase', passwordHash: null, passwordSalt: null },
    history: [], // { startedAt, endedAt, plannedMinutes, intention, completed }
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

// Sites that should be blocked right now: the blocklist during focus/blocking,
// plus YouTube whenever the allowance doesn't permit it.
const blockedSites = () => {
    const sites = new Set();
    if (state.mode !== 'idle') state.sites.forEach((d) => sites.add(d));
    if (!youtubeAccess().allowed) state.allowance.sites.forEach((d) => sites.add(d));
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
const youtubeAccess = (now = Date.now()) => {
    const a = state.allowance;
    if (!a.enabled) return { allowed: true, reason: 'unlimited' };
    if (state.mode === 'session') return { allowed: false, reason: 'focus' };
    if (state.mode === 'block') return { allowed: false, reason: 'block' };
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
    let cooldownUntil = null;
    if (access.reason === 'cooldown') cooldownUntil = now < a.cooldownUntil ? a.cooldownUntil : now + a.breakMinutes * 60000;
    return {
        ...access,
        remainingMs: Math.max(0, Math.min(dailyMs - daily, sittingMs - sitting)),
        dailyUsedMs: daily,
        dailyMs,
        sittingUsedMs: sitting,
        sittingMs,
        breakMs: a.breakMinutes * 60000,
        cooldownUntil,
        resetsAt: nextDayStart(now),
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

const validateLimits = (body, current) => {
    const out = {};
    for (const [key, [min, max]] of Object.entries(LIMITS)) {
        const v = body[key] === undefined ? current[key] : Math.round(Number(body[key]));
        if (!Number.isFinite(v) || v < min || v > max) return null;
        out[key] = v;
    }
    return out;
};

// A change that only ever gives you less YouTube can apply immediately.
const isTightening = (oldA, next) => {
    if (!oldA.enabled) return true;
    if (!next.enabled) return false;
    return next.dailyMinutes <= oldA.dailyMinutes
        && next.sittingMinutes <= oldA.sittingMinutes
        && next.breakMinutes >= oldA.breakMinutes;
};

const applyAllowanceConfig = (next) => {
    accrue();
    const a = state.allowance;
    a.enabled = next.enabled;
    a.dailyMinutes = next.dailyMinutes;
    a.sittingMinutes = next.sittingMinutes;
    a.breakMinutes = next.breakMinutes;
    a.pending = null;
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
const tick = () => {
    if (state.mode === 'session' && Date.now() >= state.session.endsAt) {
        finishSession(true);
        return;
    }
    const a = state.allowance;
    // Block or unblock YouTube the moment access changes (sitting or daily
    // limit reached, break over, extension disconnects).
    const access = youtubeAccess();
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
    const fromExtension = origin && origin.startsWith('chrome-extension://') && req.path.startsWith('/api/youtube/');
    if (req.method !== 'GET' && origin && origin !== `http://${host}` && !fromExtension) {
        return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
    }
    next();
});

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const publicState = () => {
    const since = Date.now() - 60 * 24 * 60 * 60 * 1000;
    return {
        mode: state.mode,
        session: state.session,
        blockStartedAt: state.blockStartedAt,
        sites: state.sites.map((domain) => ({ domain, hosts: expandSite(domain) })),
        settings: {
            earlyEnd: state.settings.earlyEnd,
            hasPassword: Boolean(state.settings.passwordHash),
            phrase: EARLY_END_PHRASE,
        },
        history: state.history.filter((h) => h.endedAt >= since),
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

app.post('/api/session/start', (req, res) => {
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
        state.session = { startedAt: now, endsAt: now + minutes * 60 * 1000, plannedMinutes: minutes, intention };
    });
});

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

app.delete('/api/sites/:domain', (req, res) => {
    const domain = String(req.params.domain).toLowerCase();
    if (!state.sites.includes(domain)) return fail(res, 404, 'That site isn’t on your list.');
    if (state.mode === 'session') return fail(res, 423, 'Sites can’t be removed during a focus session.');
    withHosts(res, () => {
        state.sites = state.sites.filter((d) => d !== domain);
    });
});

app.put('/api/settings', (req, res) => {
    if (state.mode === 'session') return fail(res, 423, 'Settings are locked during a focus session.');
    const { earlyEnd, password, currentPassword } = req.body;
    const settings = state.settings;

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
    monitor.lastSeenAt = now;
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
    res.json(youtubeStatus(now));
});

app.get('/api/youtube/status', (req, res) => res.json(youtubeStatus()));

app.put('/api/allowance', (req, res) => {
    if (state.mode === 'session') return fail(res, 423, 'Settings are locked during a focus session.');
    const a = state.allowance;
    const enabled = req.body.enabled === undefined ? a.enabled : Boolean(req.body.enabled);
    const limits = validateLimits(req.body, a);
    if (!limits) return fail(res, 400, 'Daily limit 1–720 min, sitting 1–240 min, break 0–240 min.');
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
