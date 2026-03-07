const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const HOSTS_FILE = '/etc/hosts';
const MARKER_START = '# --- WEBSITE BLOCK START ---';
const MARKER_END = '# --- WEBSITE BLOCK END ---';

// Data storage
let blockedDomains = [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'ytimg.com',
    's.ytimg.com',
    'googlevideo.com',
    'youtu.be',
    'reddit.com',
    'www.reddit.com'
];
let isBlockingEnabled = false;

// Timer State
let timerEndTime = null; // Milliseconds timestamp when block should end
let timerInterval = null;
const OVERRIDE_PASSWORD = '918273';

// Ensure we are running as root to modify /etc/hosts
if (process.getuid && process.getuid() !== 0) {
    console.error("FATAL ERROR: This application must be run as root to modify /etc/hosts!");
    console.error("Please run: sudo node server.js");
    process.exit(1);
}

// Function to flush DNS cache on macOS
const flushDNS = () => {
    try {
        console.log("Flushing DNS cache...");
        execSync('dscacheutil -flushcache');
        execSync('killall -HUP mDNSResponder');
        console.log("DNS cache flushed successfully.");
    } catch (error) {
        console.error("Failed to flush DNS cache:", error.message);
    }
};

// Function to read current hosts file
const readHosts = () => {
    try {
        return fs.readFileSync(HOSTS_FILE, 'utf8');
    } catch (error) {
        console.error("Failed to read hosts file:", error.message);
        return "";
    }
};

// Function to write to hosts file
const updateHostsSystem = (enableBlock) => {
    try {
        let hostsContent = readHosts();

        // Remove existing block section if it exists
        const startIndex = hostsContent.indexOf(MARKER_START);
        if (startIndex !== -1) {
            const endIndex = hostsContent.indexOf(MARKER_END, startIndex);
            if (endIndex !== -1) {
                // Keep everything before START and after END
                hostsContent = hostsContent.substring(0, startIndex) +
                    hostsContent.substring(endIndex + MARKER_END.length);
            }
        }

        // Ensure ends with newline
        if (!hostsContent.endsWith('\n')) {
            hostsContent += '\n';
        }

        // Add new block section if needed
        if (enableBlock && blockedDomains.length > 0) {
            hostsContent += `${MARKER_START}\n`;

            // For robust blocking: route to 0.0.0.0 and IPv6 ::
            blockedDomains.forEach(domain => {
                hostsContent += `0.0.0.0 ${domain}\n`;
                hostsContent += `:: ${domain}\n`;
            });

            hostsContent += `${MARKER_END}\n`;
        }

        fs.writeFileSync(HOSTS_FILE, hostsContent, 'utf8');
        flushDNS(); // Always flush DNS after modifying

        isBlockingEnabled = enableBlock;
        return true;
    } catch (error) {
        console.error("Failed to update hosts file.", error.message);
        return false;
    }
};

// --- API Endpoints ---

// Get current status
app.get('/api/status', (req, res) => {
    // Check actual state of file to ensure it's accurate
    const content = readHosts();
    isBlockingEnabled = content.includes(MARKER_START);

    // Auto-disable timer if hosts manually edited
    if (!isBlockingEnabled && timerEndTime) {
        timerEndTime = null;
        if (timerInterval) clearInterval(timerInterval);
    }

    res.json({
        enabled: isBlockingEnabled,
        domains: blockedDomains,
        timerEndTime: timerEndTime
    });
});

// Toggle block on/off
app.post('/api/toggle', (req, res) => {
    const { enabled, durationMinutes, password } = req.body;

    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    // If disabling and the timer is active, require correct password
    if (!enabled && isBlockingEnabled && timerEndTime && Date.now() < timerEndTime) {
        if (password !== OVERRIDE_PASSWORD) {
            return res.status(401).json({ error: 'Incorrect override password. Focus mode active.' });
        }
    }

    const success = updateHostsSystem(enabled);
    if (!success) {
        return res.status(500).json({ error: 'Failed to update hosts file.' });
    }

    // Clear any existing timer
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    timerEndTime = null;

    if (enabled && durationMinutes && durationMinutes > 0) {
        // Set new timer
        timerEndTime = Date.now() + (durationMinutes * 60 * 1000);

        timerInterval = setInterval(() => {
            if (Date.now() >= timerEndTime) {
                console.log("Timer expired. Unblocking automatically.");
                updateHostsSystem(false);
                timerEndTime = null;
                clearInterval(timerInterval);
                timerInterval = null;
            }
        }, 1000);
    }

    res.json({ success: true, enabled: isBlockingEnabled, timerEndTime });
});

// Helper: extract a clean domain from user input (URL or domain string)
function extractDomain(input) {
    let cleaned = input.trim().toLowerCase();

    // Strip protocol (http://, https://, ftp://, etc.)
    cleaned = cleaned.replace(/^[a-z]+:\/\//, '');

    // Strip path, query string, hash, and port
    cleaned = cleaned.split('/')[0].split('?')[0].split('#')[0];

    // Strip port number (e.g., :8080)
    cleaned = cleaned.replace(/:\d+$/, '');

    // Strip leading/trailing dots
    cleaned = cleaned.replace(/^\.+|\.+$/g, '');

    return cleaned;
}

// Add a domain to block
app.post('/api/domains', (req, res) => {
    let { domain } = req.body;

    if (!domain || typeof domain !== 'string') {
        return res.status(400).json({ error: 'domain must be a valid string' });
    }

    domain = extractDomain(domain);

    if (!domain || !domain.includes('.')) {
        return res.status(400).json({ error: 'invalid domain format' });
    }

    // Build list of variants to add (base, www., m.)
    const variants = [domain];

    // Get the base domain (without www. or m. prefix) so we can generate all variants
    let baseDomain = domain;
    if (baseDomain.startsWith('www.')) {
        baseDomain = baseDomain.substring(4);
    } else if (baseDomain.startsWith('m.')) {
        baseDomain = baseDomain.substring(2);
    }

    // Ensure the bare domain and common subdomains are all included
    if (!variants.includes(baseDomain)) variants.push(baseDomain);
    const wwwDomain = `www.${baseDomain}`;
    if (!variants.includes(wwwDomain)) variants.push(wwwDomain);
    const mDomain = `m.${baseDomain}`;
    if (!variants.includes(mDomain)) variants.push(mDomain);

    let added = false;
    variants.forEach(v => {
        if (!blockedDomains.includes(v)) {
            blockedDomains.push(v);
            added = true;
        }
    });

    // If blocking is currently ON, update the file immediately
    if (added && isBlockingEnabled) {
        updateHostsSystem(true);
    }

    res.json({ success: true, domains: blockedDomains });
});

// Remove a domain from block list
app.delete('/api/domains/:domain', (req, res) => {
    const domainToRemove = req.params.domain.toLowerCase();

    const initialLength = blockedDomains.length;
    blockedDomains = blockedDomains.filter(d => d !== domainToRemove);

    if (blockedDomains.length !== initialLength) {
        if (isBlockingEnabled) {
            updateHostsSystem(true);
        }
        res.json({ success: true, domains: blockedDomains });
    } else {
        res.status(404).json({ error: 'Domain not found in list' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==============================================`);
    console.log(`🚀 Focus Mode Blocker running on port ${PORT}`);
    console.log(`👉 Open http://localhost:${PORT} in your browser`);
    console.log(`==============================================\n`);

    const content = readHosts();
    isBlockingEnabled = content.includes(MARKER_START);
});
