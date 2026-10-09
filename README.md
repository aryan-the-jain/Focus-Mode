# Focus Mode

A focus timer and system-wide website blocker for macOS. Start a session, and distracting sites stop resolving in every browser until the timer runs out.

It works by adding entries to `/etc/hosts`, so it doesn't depend on a browser extension that can be switched off.

## Features

- **Daily hours.** Study time, lectures and meetings are logged per day, with days starting at 4am. The Today card shows study hours against an 8-hour minimum target, with lecture and meeting counters tracked separately on top, plus a 14-day chart. Settings → Alerts → Export downloads the whole log as CSV.
- **LinkedIn timer.** 10 minutes a day, counted only while a LinkedIn tab is in front of you and you're at the computer. When it's used up, LinkedIn is blocked until 4am.
- **Loop breaker.** If you bounce between Gmail, Outlook and LinkedIn (6 switches between any of them, in any order, within 10 minutes), all three are blocked for 30 minutes. The page that replaces them has one-click buttons to start a Scholar or Side Quest session. Change the thresholds in Settings → Limits.
- **One entertainment budget.** YouTube and the entertainment list (Netflix, Prime Video, chess.com, Reddit, Twitch…) share the same 2 hours a day, 40-minute sittings, 30-minute breaks and 8:00–23:00 hours. Time counts when one of them is the tab in front of you or is playing sound. When the budget says no, they're all blocked together and open tabs are closed. Email stays open, and GitHub is exempt. Use the ☕ toggle per site in Settings → Sites to change what counts.
- **Night lock.** Netflix, Prime Video, chess.com, GitHub, Twitch, Reddit and similar sites are blocked every night from 22:30 to 06:00, whatever mode you're in. While it's on you can add sites but not remove them or turn it off. Edit the list in Settings → Sites.
- **Two lock-in modes.** **Scholar** is for uni study and **Side Quest** is for extra study. Each blocklist site can be switched on or off per mode, so coursework sites like Scientia stay open in Scholar but get blocked in Side Quest.
- **Focus sessions.** 25, 50, or 90 minutes, or any custom length up to 12 hours. Add 15 minutes mid-session if you're on a roll.
- **Real friction for quitting early.** Choose what it takes to end a session early: type a sentence by hand, enter a password (ideally set by a friend), or nothing at all, because it can't be done.
- **Blocking that holds.** During a session you can't remove sites from the list or change settings. If `/etc/hosts` is edited by hand, the block is put back within 15 seconds.
- **Survives restarts.** Your blocklist, settings, history, and any running session are saved to disk. If your Mac reboots mid-session, the session carries on, and it ends correctly even if the end time passed while the Mac was off.
- **One entry per site.** Add `youtube.com` and it also blocks `www.`, `m.`, and the related addresses the site needs to load (`youtu.be`, `ytimg.com`, `googlevideo.com`, …).
- **Daily YouTube allowance.** 2 hours a day, at most 40 minutes at a time, and a Chrome extension counts only the time you actually spend watching. [More below](#youtube-allowance).
- **Stats.** Minutes focused today, sessions completed, your daily streak, and a 7-day chart.
- **Open-ended blocking.** Block sites with no timer, and unblock whenever you like.
- A chime and an optional desktop notification when a session ends. Light and dark mode follow your system setting.

## YouTube allowance

- **2 hours a day, no more than 40 minutes at a time, only between 8:00 and 23:00.** After a full 40-minute sitting, YouTube locks for a 30-minute break. Outside those hours it's blocked however much time you have left.
- **Time only counts while you're watching**, meaning a YouTube video is playing with sound, or a YouTube tab is in front of you. If you pause, switch tabs or leave it in the background, the clock stops. There's nothing to click.
- **Pausing doesn't reset the sitting.** A sitting only starts over after you've been away for the full break, so short pauses don't earn a fresh sitting.
- **The budget resets at 4am**, so late nights count toward the day before.
- A small pill in the corner of YouTube shows how long you have left in this sitting, and the extension's toolbar badge shows the minutes. You get a warning at 5 minutes.
- When time runs out, every YouTube tab is replaced with a page that says when YouTube opens again, and YouTube is blocked at the system level.
- **YouTube only opens while the Chrome extension is connected.** If you turn the extension off or close Chrome, YouTube stays blocked, so switching it off doesn't give you extra time.
- During a focus session YouTube is always blocked.
- You can change the limits and the open hours in Settings. Changes that give you more time (a higher limit, a shorter break or longer hours) wait until the next 4am reset. Changes that give you less apply right away.

### Install the extension (Chrome)

1. Run `npm run service:install` first. It copies the extension to `/usr/local/lib/focus-mode/extension`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked**, press ⌘⇧G, paste `/usr/local/lib/focus-mode/extension`, and choose it.

After updating Focus Mode, click the reload icon on the extension's card in `chrome://extensions`.

## Install (recommended)

This runs Focus Mode as a background service. It starts when your Mac boots and restarts itself if it's killed.

```bash
npm install
npm run service:install
```

You'll be asked for your Mac password once. The app is copied to `/usr/local/lib/focus-mode` and opens at **http://localhost:7878**. Bookmark it.

After pulling changes, run `npm run service:install` again to update. Your data is kept.

To uninstall (this also unblocks everything):

```bash
npm run service:uninstall            # keeps your history and settings
npm run service:uninstall -- --purge # deletes everything
```

## Run manually

```bash
npm install
sudo npm start
```

Then open http://localhost:7878. Sites stay blocked when the server stops. They're unblocked once it's running again and the session has ended, or if you run `sudo node server.js --unblock`.

## Try the UI without touching /etc/hosts

```bash
npm run dev
```

This writes to `data/hosts.dev` instead of `/etc/hosts`, so it doesn't need sudo.

## Tips

- **Turn off "secure DNS" in your browser.** Browsers that use DNS-over-HTTPS skip `/etc/hosts`. In Chrome, go to Settings → Privacy and security → Security → *Use secure DNS* and turn it off. In Firefox, go to Settings → Privacy & Security → *DNS over HTTPS* and set it to Off.
- **Restart tabs that were already open.** A tab that was already connected to a site can keep working for a minute or two after the block starts. Close it, or restart the browser.
- **The port.** The default is 7878. To change it, set `PORT=xxxx` before `npm run service:install`.

## Security

The server runs as root, so it only listens on `127.0.0.1`. It rejects requests from other websites, and it only accepts domain names that pass strict validation. The override password is stored as a salted scrypt hash in `data/state.json`. It is never stored in the source code.

## Tech

Node.js and Express on the backend. Plain HTML, CSS, and JavaScript on the frontend, with no build step.
