(() => {
    const $ = (id) => document.getElementById(id);

    const SUGGESTED_SITES = ['x.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'netflix.com', 'twitch.tv', 'news.ycombinator.com', 'discord.com'];
    const RING_CIRCUMFERENCE = 2 * Math.PI * 118;
    const POLL_MS = 5000;

    const el = {
        pill: $('status-pill'),
        pillLabel: $('status-label'),
        timerCard: $('timer-card'),
        ring: $('ring-progress'),
        ringTime: $('ring-time'),
        ringSub: $('ring-sub'),
        intentionDisplay: $('intention-display'),
        idleControls: $('idle-controls'),
        sessionControls: $('session-controls'),
        blockControls: $('block-controls'),
        presets: $('presets'),
        customRow: $('custom-row'),
        customMinutes: $('custom-minutes'),
        intention: $('intention'),
        startBtn: $('start-btn'),
        blockStartBtn: $('block-start-btn'),
        extendBtn: $('extend-btn'),
        stopBtn: $('stop-btn'),
        blockStopBtn: $('block-stop-btn'),
        statToday: $('stat-today'),
        statSessions: $('stat-sessions'),
        statStreak: $('stat-streak'),
        week: $('week'),
        siteCount: $('site-count'),
        addForm: $('add-form'),
        domainInput: $('domain-input'),
        suggestions: $('suggestions'),
        listLockNote: $('list-lock-note'),
        siteList: $('site-list'),
        stopModal: $('stop-modal'),
        stopForm: $('stop-form'),
        stopRemaining: $('stop-remaining'),
        stopPhraseBlock: $('stop-phrase-block'),
        stopPhrase: $('stop-phrase'),
        stopPhraseInput: $('stop-phrase-input'),
        stopPasswordBlock: $('stop-password-block'),
        stopPasswordInput: $('stop-password-input'),
        stopLockedBlock: $('stop-locked-block'),
        stopError: $('stop-error'),
        stopConfirm: $('stop-confirm'),
        settingsBtn: $('settings-btn'),
        settingsModal: $('settings-modal'),
        settingsForm: $('settings-form'),
        settingsLockNote: $('settings-lock-note'),
        earlyEnd: $('early-end'),
        earlyEndHint: $('early-end-hint'),
        earlyEndSetting: $('early-end-setting'),
        passwordSetting: $('password-setting'),
        currentPassword: $('current-password'),
        newPassword: $('new-password'),
        prefSound: $('pref-sound'),
        prefNotify: $('pref-notify'),
        settingsError: $('settings-error'),
        settingsSave: $('settings-save'),
        clearHistory: $('clear-history'),
        toasts: $('toasts'),
    };

    // ------------------------------------------------------------------
    // Local preferences
    // ------------------------------------------------------------------

    const prefs = (() => {
        const defaults = { minutes: 50, custom: false, sound: true, notify: false };
        try {
            return { ...defaults, ...JSON.parse(localStorage.getItem('focus.prefs') || '{}') };
        } catch {
            return defaults;
        }
    })();

    const savePrefs = () => {
        try { localStorage.setItem('focus.prefs', JSON.stringify(prefs)); } catch { /* private mode */ }
    };

    // ------------------------------------------------------------------
    // Server state
    // ------------------------------------------------------------------

    let state = null;
    let clockOffset = 0; // server time - local time
    let lastSession = null;

    const now = () => Date.now() + clockOffset;

    const api = async (method, url, body) => {
        const res = await fetch(url, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        return data;
    };

    const applyState = (next) => {
        clockOffset = next.now - Date.now();

        // Detect a session that just ran to completion.
        if (lastSession && next.mode !== 'session' && next.history.some((h) => h.startedAt === lastSession.startedAt && h.completed)) {
            celebrate(lastSession);
        }
        lastSession = next.mode === 'session' ? next.session : null;

        state = next;
        render();
    };

    const refresh = async () => {
        try {
            applyState(await api('GET', '/api/state'));
        } catch {
            el.pillLabel.textContent = 'Offline';
            el.pill.classList.remove('on');
        }
    };

    const act = async (method, url, body, successMsg) => {
        try {
            applyState(await api(method, url, body));
            if (successMsg) toast(successMsg);
            return true;
        } catch (err) {
            toast(err.message, 'error');
            return false;
        }
    };

    // ------------------------------------------------------------------
    // Formatting
    // ------------------------------------------------------------------

    const pad = (n) => String(n).padStart(2, '0');

    const formatCountdown = (ms) => {
        const total = Math.max(0, Math.ceil(ms / 1000));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    };

    const formatMinutes = (mins) => {
        mins = Math.round(mins);
        if (mins < 60) return `${mins}m`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m ? `${h}h ${m}m` : `${h}h`;
    };

    const formatClock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    const dayKey = (ts) => {
        const d = new Date(ts);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };

    const selectedMinutes = () => {
        if (prefs.custom) {
            const v = parseInt(el.customMinutes.value, 10);
            return Number.isFinite(v) && v > 0 ? Math.min(v, 720) : null;
        }
        return prefs.minutes;
    };

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    const setRing = (fraction) => {
        el.ring.style.strokeDasharray = RING_CIRCUMFERENCE;
        el.ring.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, fraction)));
    };

    const renderTimer = () => {
        if (!state) return;
        const { mode, session } = state;
        el.timerCard.dataset.mode = mode;

        const on = mode !== 'idle';
        el.pill.classList.toggle('on', on);
        el.pillLabel.textContent = mode === 'session' ? 'Focusing' : mode === 'block' ? 'Blocking' : 'Idle';

        el.idleControls.hidden = mode !== 'idle';
        el.sessionControls.hidden = mode !== 'session';
        el.blockControls.hidden = mode !== 'block';
        if (mode !== 'session' && el.stopModal.open) el.stopModal.close();

        if (mode === 'session') {
            const remaining = session.endsAt - now();
            const total = session.endsAt - session.startedAt;
            el.ringTime.textContent = formatCountdown(remaining);
            el.ringSub.textContent = `Ends at ${formatClock(session.endsAt)}`;
            setRing(remaining / total);
            el.intentionDisplay.hidden = !session.intention;
            el.intentionDisplay.textContent = session.intention;
            document.title = `${formatCountdown(remaining)} · Focus`;
        } else if (mode === 'block') {
            el.ringTime.textContent = 'Blocking';
            el.ringSub.textContent = `Since ${formatClock(state.blockStartedAt)} · no timer`;
            setRing(1);
            el.intentionDisplay.hidden = true;
            document.title = 'Blocking · Focus';
        } else {
            const mins = selectedMinutes();
            el.ringTime.textContent = mins ? formatCountdown(mins * 60000) : '--:--';
            el.ringSub.textContent = mins ? `Until ${formatClock(now() + mins * 60000)}` : 'Pick a duration';
            setRing(0);
            el.intentionDisplay.hidden = true;
            el.startBtn.disabled = !mins;
            document.title = 'Focus';
        }
    };

    const renderPresets = () => {
        el.presets.querySelectorAll('button').forEach((b) => {
            const isCustom = b.dataset.min === 'custom';
            const checked = prefs.custom ? isCustom : Number(b.dataset.min) === prefs.minutes;
            b.setAttribute('aria-checked', String(checked));
        });
        el.customRow.hidden = !prefs.custom;
    };

    const renderStats = () => {
        const history = state.history;
        const todayKey = dayKey(now());
        const minutesByDay = {};
        const completedByDay = {};

        history.forEach((h) => {
            const k = dayKey(h.startedAt);
            minutesByDay[k] = (minutesByDay[k] || 0) + (h.endedAt - h.startedAt) / 60000;
            if (h.completed) completedByDay[k] = (completedByDay[k] || 0) + 1;
        });

        // Count the running session toward today.
        let liveMinutes = 0;
        if (state.mode === 'session') liveMinutes = Math.max(0, now() - state.session.startedAt) / 60000;

        el.statToday.textContent = formatMinutes((minutesByDay[todayKey] || 0) + liveMinutes);
        el.statSessions.textContent = completedByDay[todayKey] || 0;

        // Streak: consecutive days with a completed session, ending today (or yesterday).
        let streak = 0;
        const cursor = new Date(now());
        if (!completedByDay[todayKey]) cursor.setDate(cursor.getDate() - 1);
        while (completedByDay[dayKey(cursor)]) {
            streak++;
            cursor.setDate(cursor.getDate() - 1);
        }
        el.statStreak.textContent = streak;

        // Last 7 days.
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now());
            d.setDate(d.getDate() - i);
            const k = dayKey(d);
            days.push({ d, k, mins: (minutesByDay[k] || 0) + (k === todayKey ? liveMinutes : 0) });
        }
        const max = Math.max(60, ...days.map((x) => x.mins));
        el.week.innerHTML = '';
        days.forEach(({ d, k, mins }) => {
            const day = document.createElement('div');
            day.className = `day${k === todayKey ? ' today' : ''}`;
            day.title = `${d.toLocaleDateString([], { weekday: 'long' })}: ${formatMinutes(mins)}`;
            day.innerHTML = `
                <div class="day-bar-wrap"><div class="day-bar${mins >= 1 ? ' has' : ''}" style="height:${Math.max(6, (mins / max) * 100)}%"></div></div>
                <div class="day-label">${d.toLocaleDateString([], { weekday: 'narrow' })}</div>`;
            el.week.appendChild(day);
        });
    };

    const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

    const renderSites = () => {
        const { sites, mode } = state;
        const locked = mode === 'session';
        el.siteCount.textContent = `${sites.length} ${sites.length === 1 ? 'site' : 'sites'}`;
        el.listLockNote.hidden = !locked;

        const have = new Set(sites.map((s) => s.domain));
        el.suggestions.innerHTML = '';
        SUGGESTED_SITES.filter((d) => !have.has(d)).slice(0, 5).forEach((domain) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip';
            chip.innerHTML = '<svg><use href="#i-plus"/></svg>';
            chip.append(domain);
            chip.addEventListener('click', () => addSite(domain));
            el.suggestions.appendChild(chip);
        });

        el.siteList.innerHTML = '';
        if (sites.length === 0) {
            el.siteList.innerHTML = '<li class="empty">Nothing on your blocklist yet.</li>';
            return;
        }

        sites.forEach(({ domain, hosts }) => {
            const li = document.createElement('li');
            li.className = 'site';

            const avatar = document.createElement('span');
            avatar.className = 'site-avatar';
            avatar.style.setProperty('--h', hue(domain));
            avatar.textContent = domain[0];

            const info = document.createElement('div');
            info.className = 'site-info';
            const name = document.createElement('div');
            name.className = 'site-name';
            name.textContent = domain;
            const meta = document.createElement('div');
            meta.className = 'site-meta';
            const extra = hosts.length - 1;
            meta.textContent = extra > 0 ? `+ ${extra} related ${extra === 1 ? 'address' : 'addresses'}` : 'Exact address';
            meta.title = hosts.join('\n');
            info.append(name, meta);

            const remove = document.createElement('button');
            remove.className = 'site-remove';
            remove.setAttribute('aria-label', `Remove ${domain}`);
            remove.title = 'Remove';
            remove.innerHTML = '<svg><use href="#i-x"/></svg>';
            remove.disabled = locked;
            remove.addEventListener('click', () => act('DELETE', `/api/sites/${encodeURIComponent(domain)}`, null, `Removed ${domain}`));

            li.append(avatar, info, remove);
            el.siteList.appendChild(li);
        });
    };

    const render = () => {
        if (!state) return;
        renderPresets();
        renderTimer();
        renderStats();
        renderSites();
    };

    // ------------------------------------------------------------------
    // Session end feedback
    // ------------------------------------------------------------------

    const chime = () => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                const t = ctx.currentTime + i * 0.18;
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
                osc.connect(gain).connect(ctx.destination);
                osc.start(t);
                osc.stop(t + 1.3);
            });
        } catch { /* audio unavailable */ }
    };

    const celebrate = (session) => {
        const msg = `Session complete: ${formatMinutes(session.plannedMinutes)} of focus.`;
        toast(msg);
        if (prefs.sound) chime();
        if (prefs.notify && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('Focus session complete', { body: session.intention ? `${session.intention} · ${formatMinutes(session.plannedMinutes)}` : msg });
        }
    };

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    const addSite = async (domain) => {
        const ok = await act('POST', '/api/sites', { domain });
        if (ok) {
            const added = state.sites[state.sites.length - 1]?.domain || domain;
            toast(`Added ${added}`);
        }
        return ok;
    };

    el.presets.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.min === 'custom') {
            prefs.custom = true;
            renderPresets();
            el.customMinutes.focus();
        } else {
            prefs.custom = false;
            prefs.minutes = Number(btn.dataset.min);
        }
        savePrefs();
        render();
    });

    el.customMinutes.value = prefs.customMinutes || '';
    el.customMinutes.addEventListener('input', () => {
        prefs.customMinutes = el.customMinutes.value;
        savePrefs();
        renderTimer();
    });

    const start = () => {
        const minutes = selectedMinutes();
        if (!minutes) return toast('Pick a duration first', 'error');
        act('POST', '/api/session/start', { minutes, intention: el.intention.value }, `Focusing for ${formatMinutes(minutes)}`)
            .then((ok) => { if (ok) el.intention.value = ''; });
    };

    el.startBtn.addEventListener('click', start);
    el.customMinutes.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
    el.intention.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

    el.blockStartBtn.addEventListener('click', () => act('POST', '/api/block/start', null, 'Sites blocked'));
    el.blockStopBtn.addEventListener('click', () => act('POST', '/api/block/stop', null, 'Sites unblocked'));
    el.extendBtn.addEventListener('click', () => act('POST', '/api/session/extend', { minutes: 15 }, 'Added 15 minutes'));

    el.addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const value = el.domainInput.value.trim();
        if (!value) return;
        if (await addSite(value)) el.domainInput.value = '';
    });

    // End early ---------------------------------------------------------

    el.stopBtn.addEventListener('click', () => {
        const policy = state.settings.earlyEnd;
        el.stopPhraseBlock.hidden = policy !== 'phrase';
        el.stopPasswordBlock.hidden = policy !== 'password';
        el.stopLockedBlock.hidden = policy !== 'locked';
        el.stopConfirm.hidden = policy === 'locked';
        el.stopPhrase.textContent = state.settings.phrase;
        el.stopPhraseInput.value = '';
        el.stopPasswordInput.value = '';
        el.stopError.hidden = true;
        el.stopRemaining.textContent = `${formatCountdown(state.session.endsAt - now())} left. You’re doing great.`;
        el.stopModal.showModal();
        (policy === 'phrase' ? el.stopPhraseInput : policy === 'password' ? el.stopPasswordInput : null)?.focus();
    });

    el.stopPhraseInput.addEventListener('paste', (e) => e.preventDefault());

    el.stopForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (e.submitter?.hasAttribute('data-close')) return el.stopModal.close();
        try {
            applyState(await api('POST', '/api/session/stop', {
                phrase: el.stopPhraseInput.value,
                password: el.stopPasswordInput.value,
            }));
            el.stopModal.close();
            toast('Session ended');
        } catch (err) {
            el.stopError.textContent = err.message;
            el.stopError.hidden = false;
        }
    });

    // Settings ----------------------------------------------------------

    let draftEarlyEnd = 'phrase';

    const renderSettings = () => {
        const s = state.settings;
        const locked = state.mode === 'session';
        el.settingsLockNote.hidden = !locked;
        el.earlyEndSetting.disabled = locked;
        el.passwordSetting.disabled = locked;
        el.settingsSave.disabled = locked;

        el.earlyEnd.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === draftEarlyEnd));
        el.earlyEndHint.textContent = {
            phrase: 'You’ll have to type a sentence by hand. Enough friction to make you think twice.',
            password: 'You’ll need the override password to stop early.',
            locked: 'No way out until the timer ends. Use with care.',
        }[draftEarlyEnd];

        const needsCurrent = s.hasPassword && (el.newPassword.value || (s.earlyEnd === 'password' && draftEarlyEnd !== 'password'));
        el.currentPassword.hidden = !needsCurrent;
        el.newPassword.placeholder = s.hasPassword ? 'New password (leave blank to keep)' : 'Set a password (4+ characters)';
    };

    el.settingsBtn.addEventListener('click', () => {
        if (!state) return;
        draftEarlyEnd = state.settings.earlyEnd;
        el.currentPassword.value = '';
        el.newPassword.value = '';
        el.prefSound.checked = prefs.sound;
        el.prefNotify.checked = prefs.notify && 'Notification' in window && Notification.permission === 'granted';
        el.settingsError.hidden = true;
        renderSettings();
        el.settingsModal.showModal();
    });

    el.earlyEnd.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        draftEarlyEnd = btn.dataset.value;
        renderSettings();
        if (draftEarlyEnd === 'password' && !state.settings.hasPassword) el.newPassword.focus();
    });

    el.newPassword.addEventListener('input', renderSettings);

    el.prefSound.addEventListener('change', () => {
        prefs.sound = el.prefSound.checked;
        savePrefs();
        if (prefs.sound) chime();
    });

    el.prefNotify.addEventListener('change', async () => {
        if (el.prefNotify.checked && 'Notification' in window && Notification.permission !== 'granted') {
            const result = await Notification.requestPermission();
            if (result !== 'granted') {
                el.prefNotify.checked = false;
                toast('Notifications are blocked in your browser settings', 'error');
            }
        }
        prefs.notify = el.prefNotify.checked;
        savePrefs();
    });

    el.settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (e.submitter?.hasAttribute('data-close')) return el.settingsModal.close();

        const body = {};
        if (el.newPassword.value) body.password = el.newPassword.value;
        if (draftEarlyEnd !== state.settings.earlyEnd) body.earlyEnd = draftEarlyEnd;
        if (!el.currentPassword.hidden) body.currentPassword = el.currentPassword.value;

        if (!body.password && !body.earlyEnd) return el.settingsModal.close();

        try {
            // Set the password before switching to password mode.
            if (body.password && body.earlyEnd === 'password') {
                applyState(await api('PUT', '/api/settings', { password: body.password, currentPassword: body.currentPassword }));
                applyState(await api('PUT', '/api/settings', { earlyEnd: 'password', currentPassword: body.password }));
            } else {
                applyState(await api('PUT', '/api/settings', body));
            }
            el.settingsModal.close();
            toast('Settings saved');
        } catch (err) {
            el.settingsError.textContent = err.message;
            el.settingsError.hidden = false;
        }
    });

    el.clearHistory.addEventListener('click', async () => {
        if (!confirm('Clear all focus history? This can’t be undone.')) return;
        await act('DELETE', '/api/history', null, 'History cleared');
    });

    document.querySelectorAll('dialog').forEach((dialog) => {
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
        });
    });

    // ------------------------------------------------------------------
    // Toasts
    // ------------------------------------------------------------------

    function toast(message, type = 'info') {
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.textContent = message;
        el.toasts.appendChild(t);
        setTimeout(() => {
            t.classList.add('out');
            setTimeout(() => t.remove(), 200);
        }, type === 'error' ? 4000 : 2600);
    }

    // ------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------

    renderPresets();
    refresh();
    setInterval(refresh, POLL_MS);
    setInterval(() => {
        if (!state) return;
        renderTimer();
        // The server ends the session; fetch promptly once the clock runs out.
        if (state.mode === 'session' && now() >= state.session.endsAt + 500) refresh();
    }, 1000);
    setInterval(() => state && renderStats(), 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
