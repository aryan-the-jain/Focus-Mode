// Runs on YouTube. Tells the extension whether a video is playing with sound
// or the tab is in front of you, and shows a small countdown pill.
(() => {
    if (window.__focusMeter) return;
    window.__focusMeter = true;

    let status = null;
    let lastKey = '';

    const isPlaying = () => [...document.querySelectorAll('video')].some(
        (v) => !v.paused && !v.ended && !v.muted && v.volume > 0 && v.readyState > 2,
    );
    const isVisible = () => document.visibilityState === 'visible' && document.hasFocus();
    const watching = () => isPlaying() || isVisible();

    const send = (msg) => {
        try {
            return chrome.runtime.sendMessage(msg).catch(() => null);
        } catch {
            return Promise.resolve(null); // extension was reloaded
        }
    };

    const report = (force = false) => {
        const state = { playing: isPlaying(), visible: isVisible() };
        const key = `${state.playing}|${state.visible}`;
        if (!force && key === lastKey) return;
        lastKey = key;
        send({ type: 'state', ...state }).then((s) => { if (s) setStatus(s); });
    };

    ['play', 'playing', 'pause', 'ended', 'volumechange', 'emptied'].forEach((e) => document.addEventListener(e, () => report(), true));
    document.addEventListener('visibilitychange', () => report());
    window.addEventListener('focus', () => report());
    window.addEventListener('blur', () => report());
    setInterval(() => report(true), 10000);

    try {
        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.type === 'status') setStatus(msg.status);
        });
    } catch { /* extension was reloaded */ }

    // Countdown pill ------------------------------------------------------

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
        <style>
            .pill { display:none; align-items:center; gap:8px; padding:7px 12px; border-radius:999px;
                font:500 13px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif; font-variant-numeric:tabular-nums;
                color:#f2f2f2; background:rgba(10,10,10,.85); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
                box-shadow:0 4px 16px rgba(0,0,0,.25); transition:background .2s; }
            .pill.show { display:inline-flex; }
            .dot { width:7px; height:7px; border-radius:50%; background:#f2f2f2; }
            .pill.paused .dot { background:#5a5a5a; }
            .pill.low { background:#f2f2f2; color:#0a0a0a; }
            .pill.low .dot { background:#0a0a0a; }
        </style>
        <div class="pill"><span class="dot"></span><span class="text"></span></div>`;
    const pill = root.querySelector('.pill');
    const text = root.querySelector('.text');
    (document.body || document.documentElement).appendChild(host);

    const fmt = (ms) => {
        const t = Math.max(0, Math.ceil(ms / 1000));
        const h = Math.floor(t / 3600);
        const m = Math.floor((t % 3600) / 60);
        const s = String(t % 60).padStart(2, '0');
        return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
    };

    let remainingMs = 0;
    let lastTick = Date.now();

    const setStatus = (s) => {
        status = s;
        if (s && s.reason === 'open') {
            remainingMs = s.remainingMs;
            lastTick = Date.now();
        }
        render();
    };

    const render = () => {
        const show = status && status.reason === 'open';
        const low = show && remainingMs <= 5 * 60000;
        const fullscreen = Boolean(document.fullscreenElement);
        pill.classList.toggle('show', Boolean(show) && (!fullscreen || remainingMs <= 2 * 60000));
        if (!show) return;
        const counting = watching();
        pill.classList.toggle('paused', !counting);
        pill.classList.toggle('low', low);
        text.textContent = `YouTube · ${fmt(remainingMs)} left${counting ? '' : ' · paused'}`;
    };

    setInterval(() => {
        const now = Date.now();
        const open = status && status.reason === 'open';
        if (open && watching()) remainingMs -= now - lastTick;
        lastTick = now;
        if (open && remainingMs <= 0) report(true);
        render();
    }, 1000);

    document.addEventListener('fullscreenchange', render);
    report(true);
})();
