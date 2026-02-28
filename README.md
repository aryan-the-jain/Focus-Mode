# Focus Timer (Website Blocker)

A simple, effective local website blocker and focus timer for macOS. It helps you stay focused by temporarily blocking distracting websites at the system level using the `/etc/hosts` file.

## Features

- **System-Level Blocking**: Modifies `/etc/hosts` to ensure robust blocking across all browsers.
- **Customizable Blocklist**: Add or remove any domains you want to block (default includes YouTube, Reddit, etc.).
- **Focus Timer**: Set a timer for your focus session. Websites are automatically unblocked when the timer expires.
- **Override Password**: Prevent yourself from easily disabling the block by requiring a password during an active focus session.

## Prerequisites

- Node.js installed on your system.
- Administrator (root) privileges (required to modify `/etc/hosts`).

## Installation

1. Clone or download the repository.
2. Navigate to the project directory:
   ```bash
   cd "focus timer"
   ```
3. Install the dependencies:
   ```bash
   npm install
   ```

## Usage

Since the application modifies a system file (`/etc/hosts`), you must run the server with `sudo`:

```bash
sudo npm start
# or
sudo node server.js
```

Once the server is running, open your browser and navigate to:
`http://localhost:3000`

### Disclaimer / Important Notes
- **Root Access**: The app requires `sudo` privileges to modify your `/etc/hosts` file and flush the DNS cache.
- **DNS Cache**: The application automatically flushes the macOS DNS cache when toggling the block to ensure the changes take effect immediately.

## Tech Stack
- Frontend: HTML, CSS, JavaScript (Vanilla)
- Backend: Node.js, Express
