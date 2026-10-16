# Focus Mode

A focus timer and system-wide website blocker for macOS. Start a session and distracting sites stop resolving in every browser until the timer runs out.

It works by editing `/etc/hosts`, so it doesn't depend on a browser extension that can simply be switched off. An optional Chrome extension adds time-based limits on top.

## Features

**Focus**
- **Focus sessions** of any length from 5 minutes to 3 hours, picked on a slider. Add 15 minutes mid-session if you're on a roll.
- **Two lock-in modes**, each with its own blocklist. For example, a site you need for one kind of work can stay open in that mode and be blocked in the other.
- **Real friction for quitting early.** Choose what it takes to end a session early: typing a sentence by hand, a password (ideally set by someone else), or no way out at all.
- **Blocking that holds.** During a session you can't remove sites or loosen settings. If `/etc/hosts` is edited by hand, the block is put back within seconds.
- **Open-ended blocking** when you want sites off without a timer.

**Limits** (with the Chrome extension)
- **One shared entertainment budget.** Pick any sites and they share a daily time budget, a maximum sitting length and a break after each sitting, within the hours you set. Time only counts while a site is the tab in front of you or is playing sound, so pausing or switching tabs stops the clock.
- **Per-site daily timers** for sites you want to keep short.
- **Night lock.** Block a list of sites every night between times you choose.
- **Loop breaker.** Bouncing between a set of sites again and again (inboxes, feeds) blocks them for a while, with a one-click way to start a focus session instead.
- **Weekly pass.** Once a week, on a day you pick, one tap lifts the entertainment limits until the daily reset.
- **Limits that are hard to game.** Changes that give you more time wait until the next daily reset; changes that give you less apply right away. Metered sites stay blocked while the extension is disconnected, so turning it off doesn't buy extra time.

**Tracking**
- **A daily log** of focus time, plus counters for lectures and meetings, with a target, a streak and a 14-day chart. Days start at 4am, so late nights count toward the day before.
- **CSV export** of the whole log.

**Everything else**
- **One entry per site.** Adding a domain also blocks its `www.`, `m.` and the related addresses it needs to load.
- **Survives restarts.** Settings, history and any running session are saved to disk, and a session ends correctly even if its end time passed while the Mac was off.
- A chime and optional desktop notification when time's up. Minimal monochrome UI that follows your system's light or dark mode.

## Install

Focus Mode runs as a background service. It starts when your Mac boots and restarts itself if it's killed.

```bash
npm install
npm run service:install
```

You'll be asked for your Mac password once. The app is copied to `/usr/local/lib/focus-mode` and opens at **http://localhost:7878**.

To update after pulling changes, run `npm run service:install` again. Your data is kept.

To uninstall, which also unblocks everything:

```bash
npm run service:uninstall            # keeps your history and settings
npm run service:uninstall -- --purge # deletes everything
```

### Chrome extension

1. Run `npm run service:install` first. It copies the extension to `/usr/local/lib/focus-mode/extension`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked**, press ⌘⇧G, paste `/usr/local/lib/focus-mode/extension`, and choose it.

After updating Focus Mode, click the reload icon on the extension's card.

## Run manually

```bash
npm install
sudo npm start
```

Then open http://localhost:7878. To clear every block, run `sudo node server.js --unblock`.

## Try it without touching /etc/hosts

```bash
npm run dev
```

This writes to `data/hosts.dev` instead of `/etc/hosts`, so it doesn't need sudo.

## Tips

- **Turn off "secure DNS" in your browser.** Browsers that use DNS-over-HTTPS skip `/etc/hosts`. In Chrome it's under Settings → Privacy and security → Security; in Firefox, Settings → Privacy & Security.
- **Reload tabs that were already open.** A tab already connected to a site can keep working for a minute or two after a block starts.
- **Change the port** by setting `PORT=xxxx` before `npm run service:install`. The default is 7878.

## Security

The server runs as root, so it only listens on `127.0.0.1`, rejects requests from other websites, and only accepts domain names that pass strict validation. The override password is stored as a salted scrypt hash, never in the source code.

## Tech

Node.js and Express on the backend; plain HTML, CSS and JavaScript on the frontend, with no build step.
