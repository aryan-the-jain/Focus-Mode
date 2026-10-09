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
        durationBlocks: $('duration-blocks'),
        durationRange: $('duration-range'),
        durationTicks: $('duration-ticks'),
        durationValue: $('duration-value'),
        modes: $('modes'),
        ringMode: $('ring-mode'),
        modeLegend: $('mode-legend'),
        intention: $('intention'),
        startBtn: $('start-btn'),
        blockStartBtn: $('block-start-btn'),
        extendBtn: $('extend-btn'),
        stopBtn: $('stop-btn'),
        blockStopBtn: $('block-stop-btn'),
        todayCard: document.querySelector('.today-card'),
        todayDate: $('today-date'),
        todayHours: $('today-hours'),
        todayTarget: $('today-target'),
        barFocus: $('bar-focus'),
        lecCount: $('lec-count'),
        meetCount: $('meet-count'),
        todayExtra: $('today-extra'),
        chart: $('chart'),
        streak: $('streak'),
        sessionsToday: $('sessions-today'),
        settingsTabs: $('settings-tabs'),
        targetHours: $('target-hours'),
        lectureMinutes: $('lecture-minutes'),
        meetingMinutes: $('meeting-minutes'),
        nightEnabled: $('night-enabled'),
        nightFrom: $('night-from'),
        nightUntil: $('night-until'),
        nightAddForm: $('night-add-form'),
        nightDomain: $('night-domain'),
        nightList: $('night-list'),
        nightStatus: $('night-status'),
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
        ytCard: $('yt-card'),
        ytSummary: $('yt-summary'),
        ytNow: $('yt-now'),
        ytNowLabel: $('yt-now-label'),
        ytNowTime: $('yt-now-time'),
        ytNowText: $('yt-now-text'),
        ytConnect: $('yt-connect'),
        extPath: $('ext-path'),
        ytDailyLabel: $('yt-daily-label'),
        ytDailyBar: $('yt-daily-bar'),
        ytSittingLabel: $('yt-sitting-label'),
        ytSittingBar: $('yt-sitting-bar'),
        ytDaily: $('yt-daily'),
        ytSitting: $('yt-sitting'),
        ytBreak: $('yt-break'),
        ytFrom: $('yt-from'),
        passRow: $('pass-row'),
        passDay: $('pass-day'),
        timerRows: $('timer-rows'),
        loopNote: $('loop-note'),
        liEnabled: $('li-enabled'),
        liMinutes: $('li-minutes'),
        loopEnabled: $('loop-enabled'),
        loopHops: $('loop-hops'),
        loopWindow: $('loop-window'),
        loopBlock: $('loop-block'),
        ytUntil: $('yt-until'),
        ytNote: $('yt-note'),
        ytSetting: $('yt-setting'),
        ytEnabled: $('yt-enabled'),
        ytEdit: $('yt-edit'),
        ytPendingNote: $('yt-pending-note'),
    };

    // ------------------------------------------------------------------
    // Local preferences
    // ------------------------------------------------------------------

    const prefs = (() => {
        const defaults = { minutes: 60, sound: true, notify: false, profile: 'scholar' };
        try {
            const saved = JSON.parse(localStorage.getItem('focus.prefs') || '{}');
            // Carry over a custom duration from the old preset buttons.
            if (saved.custom && Number(saved.customMinutes) > 0) saved.minutes = Number(saved.customMinutes);
            delete saved.custom;
            delete saved.customMinutes;
            return { ...defaults, ...saved };
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
    let lastYoutube = null;
    let fetchedAt = Date.now();
    let warnedFor = null; // the sitting we've already sent the 5-minute warning for

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

        const prevYt = lastYoutube;
        const nextYt = next.allowance.status;
        if (prevYt && prevYt.reason === 'open' && (nextYt.reason === 'cooldown' || nextYt.reason === 'daily')) allowanceOver(nextYt);
        lastYoutube = nextYt;
        fetchedAt = Date.now();

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

    // Days run 4am to 4am, matching the server.
    const dayKey = (ts) => {
        const d = new Date(ts - 4 * 60 * 60 * 1000);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };

    // Duration slider snaps to these stops; the labelled ones get taller blocks.
    const DURATION_STOPS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120, 135, 150, 165, 180];
    const MAJOR_STOPS = { 15: '15m', 30: '30m', 60: '1h', 90: '1.5h', 120: '2h', 180: '3h' };

    const stopIndex = (minutes) => {
        let best = 0;
        DURATION_STOPS.forEach((m, i) => { if (Math.abs(m - minutes) < Math.abs(DURATION_STOPS[best] - minutes)) best = i; });
        return best;
    };

    const selectedMinutes = () => DURATION_STOPS[stopIndex(prefs.minutes)];

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
        const profileId = state.activeProfile || selectedProfile().id;
        const profile = state.profiles.find((p) => p.id === profileId);
        el.timerCard.dataset.profile = profileId;
        el.ringMode.innerHTML = `<svg><use href="#i-${profile.id}"/></svg>`;
        el.ringMode.append(profile.name);
        if (state.activeProfile) el.pill.dataset.profile = state.activeProfile;
        else delete el.pill.dataset.profile;

        const yt = state.allowance.status;
        const ytWatching = mode === 'idle' && yt.reason === 'open' && yt.watching;
        const nightOn = mode === 'idle' && !ytWatching && state.night.active;
        const loopOn = mode === 'idle' && state.loop.active;
        const passOn = mode === 'idle' && state.pass.active;
        el.pill.classList.toggle('on', mode !== 'idle' || ytWatching || nightOn || loopOn || passOn);
        el.pillLabel.textContent = mode === 'session' ? `${profile.name} lock-in`
            : mode === 'block' ? `Blocking · ${profile.name}`
                : passOn ? `${state.pass.dayName} pass · no limits`
                : loopOn ? `Loop break until ${formatClock(state.loop.until)}`
                    : ytWatching ? 'Entertainment on'
                        : nightOn ? `Night lock until ${state.night.until}` : 'Idle';

        el.loopNote.hidden = !loopOn;
        if (loopOn) {
            el.loopNote.innerHTML = '<svg><use href="#i-lock"/></svg><span></span>';
            el.loopNote.querySelector('span').textContent = `You kept switching between Gmail, Outlook and LinkedIn. They’re blocked until ${formatClock(state.loop.until)}. Pick a mode and start.`;
        }

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
            document.title = ytWatching ? `${formatCountdown(ytRemaining())} · Entertainment` : 'Focus';
        }
    };

    const selectedProfile = () => state.profiles.find((p) => p.id === prefs.profile) || state.profiles[0];

    const renderModes = () => {
        const signature = state.profiles.map((p) => p.id).join('|');
        if (el.modes.dataset.signature !== signature) {
            el.modes.dataset.signature = signature;
            el.modes.innerHTML = '';
            state.profiles.forEach((p) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'mode';
                btn.setAttribute('role', 'radio');
                btn.dataset.profile = p.id;
                btn.innerHTML = `<svg class="mode-icon"><use href="#i-${p.id}"/></svg><span class="mode-name"></span><span class="mode-blurb"></span>`;
                btn.querySelector('.mode-name').textContent = p.name;
                btn.addEventListener('click', () => {
                    prefs.profile = p.id;
                    savePrefs();
                    render();
                });
                el.modes.appendChild(btn);
            });

            el.modeLegend.innerHTML = '';
            state.profiles.forEach((p) => {
                const item = document.createElement('span');
                item.dataset.profile = p.id;
                item.innerHTML = `<svg><use href="#i-${p.id}"/></svg>`;
                item.append(p.name);
                el.modeLegend.appendChild(item);
            });
            el.modeLegend.append('Tap the icons on a site to pick which modes block it.');
        }
        const current = selectedProfile().id;
        [...el.modes.children].forEach((btn) => {
            const id = btn.dataset.profile;
            const p = state.profiles.find((x) => x.id === id);
            const count = state.sites.filter((site) => site.profiles.includes(id)).length;
            btn.setAttribute('aria-checked', String(id === current));
            btn.querySelector('.mode-blurb').textContent = `${p.blurb} · ${count} blocked`;
        });
    };

    const buildDuration = () => {
        el.durationRange.max = DURATION_STOPS.length - 1;
        DURATION_STOPS.forEach((m, i) => {
            const block = document.createElement('span');
            block.className = `dblock${MAJOR_STOPS[m] ? ' major' : ''}`;
            el.durationBlocks.appendChild(block);
            if (MAJOR_STOPS[m]) {
                const tick = document.createElement('span');
                tick.textContent = MAJOR_STOPS[m];
                tick.style.left = `${((i + 0.5) / DURATION_STOPS.length) * 100}%`;
                tick.dataset.index = i;
                el.durationTicks.appendChild(tick);
            }
        });
    };

    const renderPresets = () => {
        const idx = stopIndex(prefs.minutes);
        el.durationRange.value = idx;
        el.durationRange.setAttribute('aria-valuetext', formatMinutes(DURATION_STOPS[idx]));
        el.durationValue.textContent = formatMinutes(DURATION_STOPS[idx]);
        [...el.durationBlocks.children].forEach((b, i) => b.classList.toggle('on', i <= idx));
        [...el.durationTicks.children].forEach((t) => t.classList.toggle('on', Number(t.dataset.index) === idx));
    };

    const renderStats = () => {
        const days = state.days;
        const targetMs = state.target.dailyMinutes * 60000;
        // Count the running session up to this second.
        const live = state.mode === 'session' ? Math.max(0, Math.min(now(), state.session.endsAt) - state.now) : 0;
        const withLive = (d, i) => (i === days.length - 1 ? { ...d, focusMs: d.focusMs + live, totalMs: d.totalMs + live } : d);
        const log = days.map(withLive);
        const today = log[log.length - 1];

        el.todayDate.textContent = new Date(today.ts).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
        // Big number and bar are study time only; that's what the target measures.
        el.todayHours.textContent = formatMinutes(today.focusMs / 60000);
        el.todayTarget.textContent = `of ${formatMinutes(targetMs / 60000)} study${today.focusMs >= targetMs ? ' · done' : ''}`;
        el.barFocus.style.width = `${Math.min(100, (today.focusMs / targetMs) * 100)}%`;
        el.lecCount.textContent = today.lectures;
        el.meetCount.textContent = today.meetings;
        el.todayExtra.textContent = today.lectures || today.meetings
            ? `+ ${formatMinutes((today.lectureMs + today.meetingMs) / 60000)} in lectures and meetings · ${formatMinutes(today.totalMs / 60000)} total`
            : '';
        el.todayCard.querySelectorAll('.stepper button[data-step="-1"]').forEach((b) => {
            b.disabled = today[b.dataset.kind] <= 0;
        });

        // Last 14 days, stacked focus + lectures, with the target as a dashed line.
        const recent = log.slice(-14);
        const max = Math.max(targetMs * 1.25, ...recent.map((d) => d.totalMs));
        el.chart.innerHTML = '';
        const line = document.createElement('div');
        line.className = 'chart-target';
        line.style.bottom = `calc(18px + (100% - 18px) * ${targetMs / max})`;
        line.innerHTML = `<span>${formatMinutes(targetMs / 60000)}</span>`;
        el.chart.appendChild(line);
        recent.forEach((d, i) => {
            const day = document.createElement('div');
            day.className = `cday${i === recent.length - 1 ? ' today' : ''}${d.totalMs >= targetMs ? ' met' : ''}`;
            const date = new Date(d.ts);
            day.title = `${date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}: `
                + `${formatMinutes(d.focusMs / 60000)} study, ${d.lectures} lectures, ${d.meetings} meetings`;
            const bar = document.createElement('div');
            bar.className = 'cbar';
            bar.style.height = `${(d.totalMs / max) * 100}%`;
            if (d.totalMs > 0) {
                bar.innerHTML = `<div class="f" style="height:${(d.focusMs / d.totalMs) * 100}%"></div>`
                    + `<div class="l" style="height:${(d.lectureMs / d.totalMs) * 100}%"></div>`
                    + `<div class="m" style="height:${(d.meetingMs / d.totalMs) * 100}%"></div>`;
            }
            const label = document.createElement('span');
            label.className = 'cday-label';
            label.textContent = date.toLocaleDateString([], { weekday: 'narrow' });
            day.append(bar, label);
            el.chart.appendChild(day);
        });

        const todayKey = dayKey(now());
        const sessions = state.history.filter((h) => h.completed && dayKey(h.startedAt) === todayKey).length;
        el.streak.textContent = `${state.streak}-day streak at ${formatMinutes(targetMs / 60000)}+ study`;
        el.sessionsToday.textContent = `${sessions} ${sessions === 1 ? 'session' : 'sessions'} today`;
    };

    const renderNight = () => {
        const n = state.night;
        el.nightStatus.textContent = n.active ? `Night lock on until ${n.until}`
            : n.breakActive ? 'Blocked for your break'
                : n.enabled ? `Nightly ${n.from}–${n.until}` : 'Night lock off';
        el.nightList.innerHTML = '';
        n.sites.forEach(({ domain, duringBreaks }) => {
            const li = document.createElement('li');
            li.className = 'site';
            const name = document.createElement('div');
            name.className = 'site-info site-name';
            name.textContent = domain;
            const brk = document.createElement('button');
            brk.type = 'button';
            brk.className = `mode-toggle${duringBreaks ? ' on' : ''}`;
            brk.dataset.profile = 'break';
            brk.innerHTML = '<svg><use href="#i-break"/></svg>';
            brk.setAttribute('aria-pressed', String(duringBreaks));
            brk.title = duringBreaks ? 'Counts toward the 2-hour budget and blocked on breaks. Click to exempt.' : 'Exempt from the budget (like GitHub). Click to include.';
            brk.disabled = duringBreaks && n.breakActive;
            brk.addEventListener('click', () => act('PUT', `/api/night/sites/${encodeURIComponent(domain)}`, { duringBreaks: !duringBreaks },
                `${domain} ${duringBreaks ? 'exempted from' : 'added to'} the entertainment budget`));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'site-remove';
            remove.innerHTML = '<svg><use href="#i-x"/></svg>';
            remove.setAttribute('aria-label', `Remove ${domain} from night lock`);
            remove.disabled = n.active;
            remove.addEventListener('click', () => act('DELETE', `/api/night/sites/${encodeURIComponent(domain)}`, null, `Removed ${domain}`));
            li.append(name, brk, remove);
            el.nightList.appendChild(li);
        });
    };

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

        sites.forEach(({ domain, hosts, profiles }) => {
            const li = document.createElement('li');
            li.className = 'site';

            const avatar = document.createElement('span');
            avatar.className = 'site-avatar';
            avatar.textContent = domain[0];

            const info = document.createElement('div');
            info.className = 'site-info';
            const name = document.createElement('div');
            name.className = 'site-name';
            name.textContent = domain;
            const meta = document.createElement('div');
            meta.className = 'site-meta';
            const extra = hosts.length - 1;
            const addresses = extra > 0 ? `+ ${extra} related ${extra === 1 ? 'address' : 'addresses'}` : 'Exact address';
            const onlyIn = profiles.length < state.profiles.length
                ? `${state.profiles.filter((p) => profiles.includes(p.id)).map((p) => p.name).join(', ')} only · `
                : '';
            meta.textContent = onlyIn + addresses;
            meta.title = hosts.join('\n');
            info.append(name, meta);

            const modes = document.createElement('div');
            modes.className = 'site-modes';
            state.profiles.forEach((p) => {
                const on = profiles.includes(p.id);
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = `mode-toggle${on ? ' on' : ''}`;
                toggle.dataset.profile = p.id;
                toggle.innerHTML = `<svg><use href="#i-${p.id}"/></svg>`;
                const lockedActive = locked && on && p.id === state.activeProfile;
                const onlyOne = on && profiles.length === 1;
                toggle.disabled = lockedActive || onlyOne;
                toggle.title = lockedActive ? `Can’t unblock during a ${p.name} lock-in`
                    : onlyOne ? 'A site needs at least one mode. Remove it instead.'
                        : `${on ? 'Blocked' : 'Open'} in ${p.name}. Click to ${on ? 'allow' : 'block'}.`;
                toggle.setAttribute('aria-pressed', String(on));
                toggle.setAttribute('aria-label', `Block ${domain} in ${p.name}`);
                toggle.addEventListener('click', () => {
                    const next = on ? profiles.filter((x) => x !== p.id) : [...profiles, p.id];
                    act('PUT', `/api/sites/${encodeURIComponent(domain)}`, { profiles: next },
                        `${domain} ${on ? 'allowed' : 'blocked'} in ${p.name}`);
                });
                modes.appendChild(toggle);
            });

            const remove = document.createElement('button');
            remove.className = 'site-remove';
            remove.setAttribute('aria-label', `Remove ${domain}`);
            remove.title = 'Remove';
            remove.innerHTML = '<svg><use href="#i-x"/></svg>';
            remove.disabled = locked;
            remove.addEventListener('click', () => act('DELETE', `/api/sites/${encodeURIComponent(domain)}`, null, `Removed ${domain}`));

            li.append(avatar, info, modes, remove);
            el.siteList.appendChild(li);
        });
    };

    // Time left before YouTube locks, ticking down locally while watching.
    const ytElapsed = () => (state.allowance.status.watching ? Date.now() - fetchedAt : 0);
    const ytRemaining = () => Math.max(0, state.allowance.status.remainingMs - ytElapsed());

    // Weekly pass: a button on its day, otherwise a quiet note about the next one.
    let passConfirm = false;
    const renderPass = () => {
        const p = state.pass;
        const key = p.active ? 'active' : p.available ? `available:${passConfirm}` : `next:${p.usedThisWeek}:${p.nextDate}`;
        if (el.passRow.dataset.key === key) return;
        el.passRow.dataset.key = key;
        el.passRow.innerHTML = '';
        if (p.active) return;
        if (p.available) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `pass-btn${passConfirm ? ' confirm' : ''}`;
            btn.innerHTML = passConfirm
                ? '<span>Tap again to start</span><small>no undo · once a week</small>'
                : `<span>Use ${p.dayName} pass</span><small>uncapped until 4am</small>`;
            btn.addEventListener('click', async () => {
                if (!passConfirm) {
                    passConfirm = true;
                    renderPass();
                    setTimeout(() => { passConfirm = false; renderPass(); }, 5000);
                    return;
                }
                passConfirm = false;
                await act('POST', '/api/pass/start', null, `${p.dayName} pass on. Enjoy tonight.`);
            });
            el.passRow.appendChild(btn);
            return;
        }
        const next = new Date(p.nextDate).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
        const note = document.createElement('p');
        note.className = 'pass-note';
        note.textContent = p.usedThisWeek ? `${p.dayName} pass used this week. Next: ${next}.` : `${p.dayName} pass: uncapped entertainment on ${next}.`;
        el.passRow.appendChild(note);
    };

    // Daily timers (LinkedIn), shown under the YouTube meters.
    const renderTimers = () => {
        const timers = Object.entries(state.timers).filter(([, t]) => t.enabled);
        if (el.timerRows.childElementCount !== timers.length) {
            el.timerRows.innerHTML = timers.map(([id]) => `
                <div class="meter" data-timer="${id}">
                    <div class="meter-head"><span class="t-name"></span><span class="muted t-label"></span></div>
                    <div class="meter-bar"><div class="t-bar"></div></div>
                </div>`).join('');
        }
        timers.forEach(([id, t]) => {
            const row = el.timerRows.querySelector(`[data-timer="${id}"]`);
            const used = Math.min(t.dailyMs, t.usedMs + (t.active ? Date.now() - fetchedAt : 0));
            row.querySelector('.t-name').textContent = t.active ? `${t.label} · on now` : t.label;
            row.querySelector('.t-label').textContent = `${formatMinutes(used / 60000)} of ${formatMinutes(t.dailyMs / 60000)}`;
            const bar = row.querySelector('.t-bar');
            bar.style.width = `${(used / t.dailyMs) * 100}%`;
            bar.classList.toggle('full', used >= t.dailyMs);
        });
    };

    const renderAllowance = () => {
        const a = state.allowance;
        el.ytCard.hidden = !a.enabled;
        if (!a.enabled) return;

        const yt = a.status;
        const t = now();
        const open = yt.reason === 'open';
        const remaining = ytRemaining();
        const dailyUsed = Math.min(yt.dailyMs, yt.dailyUsedMs + ytElapsed());
        const sittingUsed = Math.min(yt.sittingMs, yt.sittingUsedMs + ytElapsed());

        el.ytSummary.textContent = `${formatMinutes((yt.dailyMs - dailyUsed) / 60000)} left · open ${yt.openFrom}–${yt.openUntil}`;

        // Now panel
        el.ytNow.classList.toggle('live', open);
        el.ytNow.classList.toggle('watching', open && yt.watching);
        let label = 'Blocked';
        let time = '';
        let text = '';
        switch (yt.reason) {
            case 'open':
                label = sittingUsed > 0 ? 'This sitting' : 'Ready';
                time = formatCountdown(remaining);
                text = yt.watching ? 'Watching now. Counting down.' : sittingUsed > 0 ? 'Not watching. Paused.' : `Up to ${formatMinutes(remaining / 60000)} in one go.`;
                if (yt.closesAt - t <= remaining + 1000) text += ` Closes at ${formatClock(yt.closesAt)}.`;
                break;
            case 'hours':
                label = 'Closed';
                text = `Entertainment is open ${yt.openFrom}–${yt.openUntil}. Back at ${formatClock(yt.opensAt)}.`;
                break;
            case 'cooldown':
                label = 'Taking a break';
                time = formatCountdown(yt.cooldownUntil - t);
                text = `YouTube, Netflix and the rest are back at ${formatClock(yt.cooldownUntil)}.`;
                break;
            case 'daily':
                label = 'Done for today';
                text = `You’ve watched ${formatMinutes(yt.dailyMs / 60000)}. Resets at ${formatClock(yt.resetsAt)}.`;
                break;
            case 'focus':
            case 'block':
                text = 'Entertainment stays blocked while you focus.';
                break;
            case 'extension':
                label = 'Not connected';
                text = 'Connect the extension below to start watching.';
                break;
            case 'pass':
                label = `${state.pass.dayName} pass`;
                time = 'No limits';
                text = `Everything’s open until ${formatClock(state.pass.activeUntil)}. Enjoy it.`;
                break;
        }
        el.ytNow.classList.toggle('pass', yt.reason === 'pass');
        el.ytNowLabel.textContent = label;
        el.ytNowTime.textContent = time;
        el.ytNowText.textContent = text;

        if (open && yt.watching && remaining <= 5 * 60000 && remaining > 0) {
            const key = `${dayKey(t)}:${Math.round((dailyUsed - sittingUsed) / 60000)}`;
            if (warnedFor !== key) {
                warnedFor = key;
                toast('5 minutes of entertainment left');
                notify('5 minutes of entertainment left', 'Time for a break soon.');
            }
        }

        // Meters
        const sittingShown = yt.reason === 'cooldown' ? yt.sittingMs : sittingUsed;
        el.ytDailyLabel.textContent = `${formatMinutes(dailyUsed / 60000)} of ${formatMinutes(yt.dailyMs / 60000)}`;
        el.ytSittingLabel.textContent = `${formatMinutes(sittingShown / 60000)} of ${formatMinutes(yt.sittingMs / 60000)}`;
        el.ytDailyBar.style.width = `${(dailyUsed / yt.dailyMs) * 100}%`;
        el.ytSittingBar.style.width = `${(sittingShown / yt.sittingMs) * 100}%`;
        el.ytDailyBar.classList.toggle('full', dailyUsed >= yt.dailyMs);
        el.ytSittingBar.classList.toggle('full', yt.reason === 'cooldown');

        // Extension setup
        el.ytConnect.hidden = a.extension.connected;
        el.extPath.textContent = a.extension.path;
        el.extPath.dataset.copy = a.extension.path;

        el.ytNote.textContent = a.pending ? 'Your new limits start after the 4am reset.' : '';
        renderPass();
        renderTimers();
    };

    const render = () => {
        if (!state) return;
        renderModes();
        renderPresets();
        renderTimer();
        renderAllowance();
        renderStats();
        renderNight();
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

    const notify = (title, body) => {
        if (prefs.notify && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
    };

    const allowanceOver = (yt) => {
        const msg = yt.reason === 'daily' ? 'That’s your entertainment for today.' : `Break time. Entertainment is back at ${formatClock(yt.cooldownUntil)}.`;
        toast(msg);
        if (prefs.sound) chime();
        notify('Entertainment time’s up', msg);
    };

    const celebrate = (session) => {
        const msg = `Session complete: ${formatMinutes(session.plannedMinutes)} of focus.`;
        toast(msg);
        if (prefs.sound) chime();
        notify('Focus session complete', session.intention ? `${session.intention} · ${formatMinutes(session.plannedMinutes)}` : msg);
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

    el.durationRange.addEventListener('input', () => {
        prefs.minutes = DURATION_STOPS[Number(el.durationRange.value)];
        savePrefs();
        renderPresets();
        renderTimer();
    });

    const start = () => {
        const minutes = selectedMinutes();
        if (!minutes) return toast('Pick a duration first', 'error');
        const profile = selectedProfile();
        act('POST', '/api/session/start', { minutes, intention: el.intention.value, profile: profile.id }, `${profile.name} lock-in: ${formatMinutes(minutes)}`)
            .then((ok) => { if (ok) el.intention.value = ''; });
    };

    el.startBtn.addEventListener('click', start);
    el.intention.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

    el.blockStartBtn.addEventListener('click', () => act('POST', '/api/block/start', { profile: selectedProfile().id }, `Sites blocked for ${selectedProfile().name}`));
    el.blockStopBtn.addEventListener('click', () => act('POST', '/api/block/stop', null, 'Sites unblocked'));
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.copy');
        if (!btn) return;
        try {
            await navigator.clipboard.writeText(btn.dataset.copy);
            toast('Copied');
        } catch {
            toast('Couldn’t copy. Select the text instead.', 'error');
        }
    });
    el.extendBtn.addEventListener('click', () => act('POST', '/api/session/extend', { minutes: 15 }, 'Added 15 minutes'));

    // These live inside the settings form, so they can't be forms themselves.
    const onAdd = (container, input, add) => {
        const go = async () => {
            const value = input.value.trim();
            if (value && await add(value)) input.value = '';
        };
        container.querySelector('button').addEventListener('click', go);
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            go();
        });
    };
    onAdd(el.addForm, el.domainInput, addSite);

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
        el.ytSetting.disabled = locked;

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

    const ytDraft = () => state.allowance.pending || state.allowance;

    const renderAllowanceEditor = () => {
        const draft = ytDraft();
        el.ytEnabled.checked = draft.enabled;
        el.ytDaily.value = draft.dailyMinutes;
        el.ytSitting.value = draft.sittingMinutes;
        el.ytBreak.value = draft.breakMinutes;
        el.ytFrom.value = draft.openFrom;
        el.ytUntil.value = draft.openUntil;
        el.ytEdit.hidden = !draft.enabled;
        const pending = state.allowance.pending;
        el.ytPendingNote.hidden = !pending;
        el.ytPendingNote.textContent = pending ? 'You have changes scheduled for tomorrow. To cancel them, set these back to today’s values and save.' : '';
    };

    const readAllowanceEditor = () => ({
        enabled: el.ytEnabled.checked,
        dailyMinutes: Number(el.ytDaily.value),
        sittingMinutes: Number(el.ytSitting.value),
        breakMinutes: Number(el.ytBreak.value),
        openFrom: el.ytFrom.value,
        openUntil: el.ytUntil.value,
    });

    const sameAllowance = (a, b) => ['enabled', 'dailyMinutes', 'sittingMinutes', 'breakMinutes', 'openFrom', 'openUntil'].every((k) => a[k] === b[k]);

    el.ytEnabled.addEventListener('change', () => { el.ytEdit.hidden = !el.ytEnabled.checked; });

    el.todayCard.addEventListener('click', (e) => {
        const btn = e.target.closest('.stepper button');
        if (!btn) return;
        const kind = btn.dataset.kind;
        const today = state.days[state.days.length - 1];
        act('PUT', '/api/day', { [kind]: Math.max(0, today[kind] + Number(btn.dataset.step)) });
    });

    onAdd(el.nightAddForm, el.nightDomain, (domain) => act('POST', '/api/night/sites', { domain }, 'Added to night lock'));

    const showTab = (name) => {
        el.settingsTabs.querySelectorAll('button').forEach((b) => {
            b.classList.toggle('active', b.dataset.tab === name);
            b.setAttribute('aria-selected', String(b.dataset.tab === name));
        });
        el.settingsModal.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    };
    el.settingsTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (btn) showTab(btn.dataset.tab);
    });

    el.settingsBtn.addEventListener('click', () => {
        if (!state) return;
        showTab('focus');
        el.targetHours.value = state.target.dailyMinutes / 60;
        el.lectureMinutes.value = state.target.lectureMinutes;
        el.meetingMinutes.value = state.target.meetingMinutes;
        const li = state.timers.linkedin;
        el.liEnabled.checked = li.pending ? li.pending.enabled : li.enabled;
        el.liMinutes.value = (li.pending ? li.pending.dailyMinutes : li.dailyMs / 60000);
        el.loopEnabled.checked = state.loop.enabled;
        el.loopHops.value = state.loop.hops;
        el.loopWindow.value = state.loop.windowMinutes;
        el.loopBlock.value = state.loop.blockMinutes;
        el.passDay.value = String(state.pass.day);
        el.passDay.disabled = state.pass.active;
        [el.loopEnabled, el.loopHops, el.loopWindow, el.loopBlock].forEach((x) => { x.disabled = state.loop.active; });
        el.nightEnabled.checked = state.night.enabled;
        el.nightFrom.value = state.night.from;
        el.nightUntil.value = state.night.until;
        const nightLocked = state.night.active;
        [el.nightEnabled, el.nightFrom, el.nightUntil].forEach((x) => { x.disabled = nightLocked; });
        renderAllowanceEditor();
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
        const targetMinutes = Math.round(Number(el.targetHours.value) * 60);
        if (targetMinutes !== state.target.dailyMinutes) body.dailyTargetMinutes = targetMinutes;
        const lectureMinutes = Math.round(Number(el.lectureMinutes.value));
        if (lectureMinutes !== state.target.lectureMinutes) body.lectureMinutes = lectureMinutes;
        const meetingMinutes = Math.round(Number(el.meetingMinutes.value));
        if (meetingMinutes !== state.target.meetingMinutes) body.meetingMinutes = meetingMinutes;
        const settingsChanged = Object.keys(body).length > 0;
        if (!el.currentPassword.hidden) body.currentPassword = el.currentPassword.value;

        const ytNext = readAllowanceEditor();
        const ytChanged = !sameAllowance(ytNext, ytDraft());
        const n = state.night;
        const nightNext = { enabled: el.nightEnabled.checked, from: el.nightFrom.value, until: el.nightUntil.value };
        const nightChanged = !n.active && (nightNext.enabled !== n.enabled || nightNext.from !== n.from || nightNext.until !== n.until);

        const li = state.timers.linkedin;
        const liShown = { enabled: li.pending ? li.pending.enabled : li.enabled, dailyMinutes: li.pending ? li.pending.dailyMinutes : li.dailyMs / 60000 };
        const liNext = { enabled: el.liEnabled.checked, dailyMinutes: Math.round(Number(el.liMinutes.value)) };
        const liChanged = liNext.enabled !== liShown.enabled || liNext.dailyMinutes !== liShown.dailyMinutes;
        const lp = state.loop;
        const loopNext = { enabled: el.loopEnabled.checked, hops: Number(el.loopHops.value), windowMinutes: Number(el.loopWindow.value), blockMinutes: Number(el.loopBlock.value) };
        const loopChanged = !lp.active && (loopNext.enabled !== lp.enabled || loopNext.hops !== lp.hops
            || loopNext.windowMinutes !== lp.windowMinutes || loopNext.blockMinutes !== lp.blockMinutes);

        const passChanged = !state.pass.active && Number(el.passDay.value) !== state.pass.day;

        if (!settingsChanged && !ytChanged && !nightChanged && !liChanged && !loopChanged && !passChanged) return el.settingsModal.close();

        try {
            if (ytChanged) applyState(await api('PUT', '/api/allowance', ytNext));
            if (nightChanged) applyState(await api('PUT', '/api/night', nightNext));
            if (liChanged) applyState(await api('PUT', '/api/timers/linkedin', liNext));
            if (loopChanged) applyState(await api('PUT', '/api/loop', loopNext));
            if (passChanged) applyState(await api('PUT', '/api/pass', { day: Number(el.passDay.value) }));
            if (settingsChanged) {
                // Set the password before switching to password mode.
                if (body.password && body.earlyEnd === 'password') {
                    const { earlyEnd, ...rest } = body;
                    applyState(await api('PUT', '/api/settings', rest));
                    applyState(await api('PUT', '/api/settings', { earlyEnd, currentPassword: body.password }));
                } else {
                    applyState(await api('PUT', '/api/settings', body));
                }
            }
            el.settingsModal.close();
            const later = (ytChanged && state.allowance.pending) || (liChanged && state.timers.linkedin.pending);
            toast(later ? 'Saved. Extra time starts after the 4am reset.' : 'Settings saved');
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

    buildDuration();
    renderPresets();
    refresh();
    setInterval(refresh, POLL_MS);
    setInterval(() => {
        if (!state) return;
        renderTimer();
        renderAllowance();
        const yt = state.allowance.status;
        if ((yt.reason === 'open' && ytRemaining() <= 0) || (yt.reason === 'cooldown' && now() >= yt.cooldownUntil)
            || (yt.reason === 'hours' && now() >= yt.opensAt)) refresh();
        // The server ends the session; fetch promptly once the clock runs out.
        if (state.mode === 'session' && now() >= state.session.endsAt + 500) refresh();
    }, 1000);
    setInterval(() => state && renderStats(), 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
