const params = new URLSearchParams(location.search);
const reason = params.get('r') || 'youtube';
const returnUrl = params.get('u') || 'https://www.youtube.com/';
const $ = (id) => document.getElementById(id);

const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const mins = (ms) => {
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}m`;
    return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
};

const meter = (used, total, label) => {
    $('meter').hidden = !total;
    $('bar-fill').style.width = `${Math.min(100, (used / total) * 100)}%`;
    $('meter-label').textContent = label;
};

// Is the site we came from allowed again?
const allowedNow = (s) => {
    if (reason === 'loop') return !s.loop.active;
    if (reason === 'fun') return !s.entertainment.reason;
    if (reason.startsWith('timer:')) return s.timers[reason.slice(6)].allowed;
    return s.allowed;
};

const renderYouTube = (s) => {
    const copy = {
        focus: ['You’re in a focus session', s.focusEndsAt ? `It ends at ${clock(s.focusEndsAt)}. Back to work.` : 'Back to work.'],
        block: ['Blocking is on', 'Turn it off in Focus to use your allowance.'],
        hours: ['YouTube is closed', `It’s open ${s.openFrom}–${s.openUntil}. Opens again at ${clock(s.opensAt)}.`],
        cooldown: ['Time for a break', s.cooldownUntil ? `That was a full sitting. YouTube opens again at ${clock(s.cooldownUntil)}.` : 'YouTube opens again soon.'],
        daily: [`That’s ${mins(s.dailyMs)} for today`, `Your time resets at ${clock(s.resetsAt)}.`],
        extension: ['Connecting…', 'One moment.'],
    }[s.reason] || ['Opening YouTube…', ''];
    meter(s.dailyUsedMs, s.dailyMs, `${mins(s.dailyUsedMs)} of ${mins(s.dailyMs)} watched today`);
    return copy;
};

const render = (s) => {
    if (!s) {
        $('title').textContent = 'Focus Mode isn’t running';
        $('sub').textContent = 'Start it, then reload this page.';
        $('meter').hidden = true;
        return;
    }

    let copy;
    $('work').hidden = true;
    if (reason === 'loop') {
        copy = ['You’re going in circles', `Flipping between Gmail, Outlook and LinkedIn. They’re blocked until ${clock(s.loop.until || Date.now())}. Pick one thing and start.`];
        $('work').hidden = false;
        $('meter').hidden = true;
    } else if (reason === 'fun') {
        const r = s.entertainment.reason || s.reason;
        copy = {
            night: ['It’s late', `Entertainment is off until ${s.entertainment.nightUntil}. Wind down.`],
            cooldown: ['You’re on a break', `That was a full sitting of entertainment. It’s back at ${clock(s.cooldownUntil || Date.now())}. Email is still open.`],
            daily: [`That’s ${mins(s.dailyMs)} of entertainment today`, `It all resets at ${clock(s.resetsAt)}.`],
            hours: ['Entertainment is closed', `It’s open ${s.openFrom}–${s.openUntil}. Back at ${clock(s.opensAt)}.`],
            focus: ['You’re in a focus session', 'Back to work.'],
            block: ['Blocking is on', 'Turn it off in Focus first.'],
            extension: ['Connecting…', 'One moment.'],
        }[r] || ['Blocked', ''];
        $('meter').hidden = true;
    } else if (reason.startsWith('timer:')) {
        const t = s.timers[reason.slice(6)];
        copy = t.usedMs >= t.dailyMs
            ? [`That’s ${mins(t.dailyMs)} of ${t.label} today`, `It opens again at ${clock(s.resetsAt)}.`]
            : [`${t.label} is blocked`, 'Connecting to Focus…'];
        meter(t.usedMs, t.dailyMs, `${mins(t.usedMs)} of ${mins(t.dailyMs)} used today`);
    } else {
        copy = renderYouTube(s);
    }

    $('title').textContent = copy[0];
    $('sub').textContent = copy[1];
    document.title = copy[0];
};

document.querySelectorAll('[data-profile]').forEach((btn) => {
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        const ok = await chrome.runtime.sendMessage({ type: 'startSession', profile: btn.dataset.profile, minutes: Number(btn.dataset.minutes) });
        if (ok) location.replace('http://localhost:7878');
        else {
            btn.disabled = false;
            $('sub').textContent = 'Couldn’t start a session. Is Focus Mode running?';
        }
    });
});

const check = async () => {
    let s = null;
    try {
        s = await chrome.runtime.sendMessage({ type: 'check' });
    } catch { /* extension reloading */ }
    render(s);
    if (s && allowedNow(s) && returnUrl) {
        // Give the hosts file change and DNS flush a moment to land.
        setTimeout(() => location.replace(returnUrl), 1200);
        return;
    }
    let wait = 5000;
    if (s && reason === 'youtube' && s.reason === 'cooldown' && s.cooldownUntil) wait = Math.min(5000, Math.max(1000, s.cooldownUntil - Date.now()));
    if (s && reason === 'youtube' && s.reason === 'extension') wait = 1500;
    setTimeout(check, wait);
};

check();
