const params = new URLSearchParams(location.search);
const returnUrl = params.get('u') || 'https://www.youtube.com/';
const $ = (id) => document.getElementById(id);

const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const mins = (ms) => {
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}m`;
    return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
};

const render = (s) => {
    if (!s) {
        $('title').textContent = 'Focus Mode isn’t running';
        $('sub').textContent = 'Start it, then reload this page.';
        $('meter').hidden = true;
        return;
    }

    const copy = {
        focus: ['You’re in a focus session', s.focusEndsAt ? `It ends at ${clock(s.focusEndsAt)}. Back to work.` : 'Back to work.'],
        block: ['Blocking is on', 'Turn it off in Focus to use your allowance.'],
        cooldown: ['Time for a break', s.cooldownUntil ? `That was a full sitting. YouTube opens again at ${clock(s.cooldownUntil)}.` : 'YouTube opens again soon.'],
        daily: [`That’s ${mins(s.dailyMs)} for today`, `Your time resets at ${clock(s.resetsAt)}.`],
        extension: ['Connecting…', 'One moment.'],
    }[s.reason] || ['Opening YouTube…', ''];

    $('title').textContent = copy[0];
    $('sub').textContent = copy[1];
    document.title = copy[0];

    $('meter').hidden = !s.dailyMs;
    $('bar-fill').style.width = `${Math.min(100, (s.dailyUsedMs / s.dailyMs) * 100)}%`;
    $('meter-label').textContent = `${mins(s.dailyUsedMs)} of ${mins(s.dailyMs)} watched today`;
};

const check = async () => {
    let s = null;
    try {
        s = await chrome.runtime.sendMessage({ type: 'check' });
    } catch { /* extension reloading */ }
    render(s);
    if (s && s.allowed) {
        // Give the hosts file change and DNS flush a moment to land.
        setTimeout(() => location.replace(returnUrl), 1200);
        return;
    }
    const wait = s && s.reason === 'cooldown' && s.cooldownUntil ? Math.min(5000, Math.max(1000, s.cooldownUntil - Date.now())) : 5000;
    setTimeout(check, s && s.reason === 'extension' ? 1500 : wait);
};

check();
