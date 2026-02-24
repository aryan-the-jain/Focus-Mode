document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const toggleInput = document.getElementById('block-toggle');
    const statusText = document.getElementById('status-text');

    // Timer Elements
    const timerSetupContainer = document.getElementById('timer-setup-container');
    const durationInput = document.getElementById('duration-input');
    const activeTimerContainer = document.getElementById('active-timer-container');
    const countdownTime = document.getElementById('countdown-time');

    // Modal Elements
    const passwordModal = document.getElementById('password-modal');
    const overridePasswordInput = document.getElementById('override-password');
    const cancelOverrideBtn = document.getElementById('cancel-override');
    const submitOverrideBtn = document.getElementById('submit-override');
    const modalError = document.getElementById('modal-error');

    // Domain Elements
    const domainsUl = document.getElementById('domains-ul');
    const addDomainForm = document.getElementById('add-domain-form');
    const domainInput = document.getElementById('domain-input');
    const domainCount = document.getElementById('domain-count');
    const toastContainer = document.getElementById('toast-container');

    // State
    let isBlockingEnabled = false;
    let blockedDomains = [];
    let timerEndTime = null;
    let countdownInterval = null;

    // Initialize
    fetchStatus();

    // Toggle logic
    toggleInput.addEventListener('change', async (e) => {
        // Prevent default toggle visual change until we process logic
        e.preventDefault();
        const newValue = e.target.checked;

        if (newValue === true) {
            // Turning ON
            const minutes = parseInt(durationInput.value);
            const durationMinutes = (isNaN(minutes) || minutes <= 0) ? null : minutes;

            toggleService(true, durationMinutes, null);
        } else {
            // Turning OFF
            if (timerEndTime && timerEndTime > Date.now()) {
                // Deny uncheck and show modal
                toggleInput.checked = true; // keep it checked visually
                showPasswordModal();
            } else {
                toggleService(false, null, null);
            }
        }
    });

    // Modal Actions
    cancelOverrideBtn.addEventListener('click', () => {
        hidePasswordModal();
    });

    submitOverrideBtn.addEventListener('click', () => {
        const pass = overridePasswordInput.value;
        if (!pass) return;
        toggleService(false, null, pass);
    });

    overridePasswordInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            submitOverrideBtn.click();
        }
    });

    addDomainForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const domain = domainInput.value.trim();
        if (!domain) return;

        try {
            const response = await fetch('/api/domains', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain })
            });
            const data = await response.json();

            if (response.ok) {
                blockedDomains = data.domains;
                domainInput.value = ''; // Clear input
                renderDomains();
                showToast(`Added ${domain}`, 'success');
            } else {
                showToast(data.error || 'Failed to add domain', 'error');
            }
        } catch (err) {
            showToast('Network error while adding domain', 'error');
        }
    });

    // API calls to Backend
    async function toggleService(enabled, durationMinutes, password) {
        try {
            const payload = { enabled };
            if (durationMinutes) payload.durationMinutes = durationMinutes;
            if (password) payload.password = password;

            const response = await fetch('/api/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();

            if (response.ok) {
                isBlockingEnabled = data.enabled;
                timerEndTime = data.timerEndTime;
                toggleInput.checked = isBlockingEnabled;

                if (password) {
                    hidePasswordModal();
                    showToast('Timer Overridden! Block disabled.', 'success');
                } else {
                    showToast(`Focus mode is now ${isBlockingEnabled ? 'ON' : 'OFF'}`, 'success');
                }
                updateUIState();
            } else {
                // Revert toggle
                toggleInput.checked = isBlockingEnabled;

                if (password) {
                    modalError.textContent = data.error;
                    modalError.classList.remove('hidden');
                } else {
                    showToast(data.error || 'Failed to update status', 'error');
                }
            }
        } catch (err) {
            toggleInput.checked = isBlockingEnabled;
            showToast('Network error while toggling status', 'error');
            if (password) {
                modalError.textContent = 'Network error.';
                modalError.classList.remove('hidden');
            }
        }
    }

    async function fetchStatus() {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();

            if (response.ok) {
                isBlockingEnabled = data.enabled;
                blockedDomains = data.domains;
                timerEndTime = data.timerEndTime;

                // Initialize UI
                toggleInput.checked = isBlockingEnabled;
                updateUIState();
                renderDomains();
            } else {
                showToast('Failed to load initial status', 'error');
                domainsUl.innerHTML = '<div class="empty-state">Failed to load data</div>';
            }
        } catch (err) {
            console.error('Error fetching status:', err);
            showToast('Cannot connect to server', 'error');
            domainsUl.innerHTML = '<div class="empty-state">Server connection failed</div>';
        }
    }

    async function removeDomain(domain) {
        try {
            const response = await fetch(`/api/domains/${encodeURIComponent(domain)}`, {
                method: 'DELETE'
            });
            const data = await response.json();

            if (response.ok) {
                blockedDomains = data.domains;
                renderDomains();
                showToast(`Removed ${domain}`, 'success');
            } else {
                showToast(data.error || 'Failed to remove domain', 'error');
            }
        } catch (err) {
            showToast('Network error while removing domain', 'error');
        }
    }

    // Modal Display Logic
    function showPasswordModal() {
        overridePasswordInput.value = '';
        modalError.classList.add('hidden');
        passwordModal.classList.remove('hidden');
        setTimeout(() => overridePasswordInput.focus(), 100);
    }

    function hidePasswordModal() {
        passwordModal.classList.add('hidden');
    }

    // Timer and UI Tracking
    function startCountdown() {
        if (countdownInterval) clearInterval(countdownInterval);

        const updateTick = () => {
            const now = Date.now();
            if (!timerEndTime || now >= timerEndTime) {
                clearInterval(countdownInterval);
                // Auto refresh state from server since timer ended
                setTimeout(() => fetchStatus(), 1000);
                return;
            }

            const diff = timerEndTime - now;
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const mins = Math.floor((diff / 1000 / 60) % 60);
            const secs = Math.floor((diff / 1000) % 60);

            countdownTime.textContent =
                `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        };

        updateTick();
        countdownInterval = setInterval(updateTick, 1000);
    }

    function updateUIState() {
        if (isBlockingEnabled) {
            statusText.textContent = 'Blocking is Active';
            statusText.classList.add('active');
            timerSetupContainer.classList.add('hidden');

            if (timerEndTime && timerEndTime > Date.now()) {
                activeTimerContainer.classList.remove('hidden');
                startCountdown();
            } else {
                activeTimerContainer.classList.add('hidden');
            }
        } else {
            statusText.textContent = 'Currently Unblocked';
            statusText.classList.remove('active');

            timerSetupContainer.classList.remove('hidden');
            activeTimerContainer.classList.add('hidden');
            if (countdownInterval) clearInterval(countdownInterval);
        }
    }

    function renderDomains() {
        domainCount.textContent = blockedDomains.length;

        if (blockedDomains.length === 0) {
            domainsUl.innerHTML = '<div class="empty-state">No websites blocked yet.<br>Add one above!</div>';
            return;
        }

        domainsUl.innerHTML = '';
        blockedDomains.forEach(domain => {
            const li = document.createElement('li');
            li.className = 'domain-item';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'domain-name';
            nameSpan.textContent = domain;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.title = 'Remove domain';
            removeBtn.innerHTML = '<svg class="icon"><use href="#icon-trash"></use></svg>';
            removeBtn.onclick = () => removeDomain(domain);

            li.appendChild(nameSpan);
            li.appendChild(removeBtn);
            domainsUl.appendChild(li);
        });
    }

    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        toastContainer.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
});
