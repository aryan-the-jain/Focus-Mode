# Focus Mode

A focus timer and system-wide website blocker for macOS. Start a session, and distracting sites stop resolving in every browser until the timer runs out.

It works by adding entries to `/etc/hosts`, so it doesn't depend on a browser extension that can be switched off.

## Features

- **Focus sessions.** 25, 50, or 90 minutes, or any custom length up to 12 hours. Add 15 minutes mid-session if you're on a roll.
- **Real friction for quitting early.** Choose what it takes to end a session early: type a sentence by hand, enter a password (ideally set by a friend), or nothing at all, because it can't be done.
- **Blocking that holds.** During a session you can't remove sites from the list or change settings. If `/etc/hosts` is edited by hand, the block is put back within 15 seconds.
- **Survives restarts.** Your blocklist, settings, history, and any running session are saved to disk. If your Mac reboots mid-session, the session carries on, and it ends correctly even if the end time passed while the Mac was off.
- **One entry per site.** Add `youtube.com` and it also blocks `www.`, `m.`, and the related addresses the site needs to load (`youtu.be`, `ytimg.com`, `googlevideo.com`, …).
- **Stats.** Minutes focused today, sessions completed, your daily streak, and a 7-day chart.
- **Open-ended blocking.** Block sites with no timer, and unblock whenever you like.
- A chime and an optional desktop notification when a session ends. Light and dark mode follow your system setting.

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
