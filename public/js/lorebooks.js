/**
 * Lorebooks Manager Frontend
 * Handles UI interactions for managing lorebooks
 */

(function() {
    'use strict';

    // State
    let lorebooks = [];
    let selectedLorebook = null;

    // DOM Elements
    const lorebooksList = document.getElementById('lorebooksList');
    const detailsEmpty = document.getElementById('detailsEmpty');
    const detailsContent = document.getElementById('detailsContent');
    const detailsName = document.getElementById('detailsName');
    const detailsEntryCount = document.getElementById('detailsEntryCount');
    const detailsTokens = document.getElementById('detailsTokens');
    const entriesList = document.getElementById('entriesList');
    const toggleBtn = document.getElementById('toggleBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const statusMessage = document.getElementById('statusMessage');

    // Stats elements
    const totalBooksEl = document.getElementById('totalBooks');
    const enabledBooksEl = document.getElementById('enabledBooks');
    const totalEntriesEl = document.getElementById('totalEntries');

    // Modal elements
    const uploadModal = document.getElementById('uploadModal');
    const deleteModal = document.getElementById('deleteModal');
    const lorebookFile = document.getElementById('lorebookFile');
    const lorebookFilename = document.getElementById('lorebookFilename');
    const deleteLorebookName = document.getElementById('deleteLorebookName');

    /**
     * Show status message
     */
    function showMessage(message, type = 'info') {
        statusMessage.textContent = message;
        statusMessage.className = `status-message status-${type}`;
        statusMessage.style.display = 'block';

        if (type !== 'error') {
            setTimeout(() => {
                statusMessage.style.display = 'none';
            }, 3000);
        }
    }

    /**
     * Fetch all lorebooks from API
     */
    async function fetchLorebooks() {
        try {
            const response = await fetch('/api/lorebooks');
            const data = await response.json();

            if (data.success) {
                lorebooks = data.lorebooks || [];
                renderLorebooksList();
                updateStats();
            } else {
                showMessage(data.error || 'Failed to load lorebooks', 'error');
            }
        } catch (error) {
            showMessage('Failed to connect to server: ' + error.message, 'error');
        }
    }

    /**
     * Render the lorebooks list
     */
    function renderLorebooksList() {
        if (lorebooks.length === 0) {
            lorebooksList.innerHTML = `
                <div class="empty-state">
                    <p>No lorebooks found.<br>Upload a SillyTavern-compatible lorebook to get started.</p>
                </div>
            `;
            return;
        }

        lorebooksList.innerHTML = lorebooks.map(book => `
            <div class="lorebook-item ${book.enabled ? 'enabled' : ''} ${selectedLorebook?.filename === book.filename ? 'selected' : ''}"
                 data-filename="${escapeHtml(book.filename)}">
                <div class="lorebook-toggle">
                    <input type="checkbox"
                           id="toggle-${escapeHtml(book.filename)}"
                           ${book.enabled ? 'checked' : ''}
                           class="lorebook-checkbox">
                    <label for="toggle-${escapeHtml(book.filename)}" class="toggle-label"></label>
                </div>
                <div class="lorebook-info" data-filename="${escapeHtml(book.filename)}">
                    <div class="lorebook-name">${escapeHtml(book.name)}</div>
                    <div class="lorebook-meta">
                        ${book.entryCount} entries &bull; ~${formatNumber(book.tokenEstimate)} tokens
                    </div>
                </div>
            </div>
        `).join('');

        // Attach event listeners
        lorebooksList.querySelectorAll('.lorebook-info').forEach(el => {
            el.addEventListener('click', () => selectLorebook(el.dataset.filename));
        });

        lorebooksList.querySelectorAll('.lorebook-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', async (e) => {
                e.stopPropagation();
                const item = checkbox.closest('.lorebook-item');
                const filename = item.dataset.filename;
                await toggleLorebook(filename, checkbox.checked);
            });
        });
    }

    /**
     * Update stats display
     */
    function updateStats() {
        const enabled = lorebooks.filter(b => b.enabled);
        const totalEntries = enabled.reduce((sum, b) => sum + b.entryCount, 0);

        totalBooksEl.textContent = lorebooks.length;
        enabledBooksEl.textContent = enabled.length;
        totalEntriesEl.textContent = totalEntries;
    }

    /**
     * Select a lorebook and show details
     */
    async function selectLorebook(filename) {
        try {
            const response = await fetch(`/api/lorebooks/${encodeURIComponent(filename)}`);
            const data = await response.json();

            if (data.success) {
                selectedLorebook = data.lorebook;
                renderDetails();
                renderLorebooksList(); // Update selection highlight
            } else {
                showMessage(data.error || 'Failed to load lorebook details', 'error');
            }
        } catch (error) {
            showMessage('Failed to load lorebook: ' + error.message, 'error');
        }
    }

    /**
     * Render lorebook details
     */
    function renderDetails() {
        if (!selectedLorebook) {
            detailsEmpty.style.display = 'block';
            detailsContent.style.display = 'none';
            return;
        }

        detailsEmpty.style.display = 'none';
        detailsContent.style.display = 'block';

        detailsName.textContent = selectedLorebook.name;
        detailsEntryCount.textContent = selectedLorebook.entryCount;
        detailsTokens.textContent = formatNumber(selectedLorebook.tokenEstimate);

        // Update toggle button
        toggleBtn.textContent = selectedLorebook.enabled ? 'Disable' : 'Enable';
        toggleBtn.className = selectedLorebook.enabled ? 'btn btn-secondary' : 'btn btn-primary';

        // Render entries
        renderEntries();
    }

    /**
     * Render entries list
     */
    function renderEntries() {
        if (!selectedLorebook || !selectedLorebook.entries) {
            entriesList.innerHTML = '<p class="empty-state">No entries</p>';
            return;
        }

        const entries = selectedLorebook.entries.slice(0, 50); // Limit to first 50

        entriesList.innerHTML = entries.map(entry => `
            <div class="entry-item ${entry.constant ? 'constant' : ''} ${!entry.enabled ? 'disabled' : ''}">
                <div class="entry-header">
                    <span class="entry-keys">${escapeHtml(formatKeys(entry.key))}</span>
                    <span class="entry-badges">
                        ${entry.constant ? '<span class="badge badge-constant">Always</span>' : ''}
                        ${!entry.enabled ? '<span class="badge badge-disabled">Disabled</span>' : ''}
                        <span class="badge badge-priority">P${entry.priority || 10}</span>
                    </span>
                </div>
                <div class="entry-content">${escapeHtml(truncate(entry.content, 200))}</div>
                ${entry.comment ? `<div class="entry-comment">${escapeHtml(truncate(entry.comment, 100))}</div>` : ''}
            </div>
        `).join('');

        if (selectedLorebook.entries.length > 50) {
            entriesList.innerHTML += `
                <div class="entries-more">
                    ...and ${selectedLorebook.entries.length - 50} more entries
                </div>
            `;
        }
    }

    /**
     * Toggle lorebook enabled state
     */
    async function toggleLorebook(filename, enable) {
        try {
            const action = enable ? 'enable' : 'disable';
            const response = await fetch(`/api/lorebooks/${encodeURIComponent(filename)}/${action}`, {
                method: 'POST'
            });
            const data = await response.json();

            if (data.success) {
                // Update local state
                const book = lorebooks.find(b => b.filename === filename);
                if (book) book.enabled = enable;

                if (selectedLorebook?.filename === filename) {
                    selectedLorebook.enabled = enable;
                    renderDetails();
                }

                updateStats();
                renderLorebooksList();
                showMessage(`Lorebook ${enable ? 'enabled' : 'disabled'}: ${filename}`, 'success');
            } else {
                showMessage(data.error || `Failed to ${enable ? 'enable' : 'disable'} lorebook`, 'error');
                await fetchLorebooks(); // Refresh to sync state
            }
        } catch (error) {
            showMessage('Failed to update lorebook: ' + error.message, 'error');
            await fetchLorebooks();
        }
    }

    /**
     * Delete current lorebook
     */
    async function deleteLorebook() {
        if (!selectedLorebook) return;

        try {
            const response = await fetch(`/api/lorebooks/${encodeURIComponent(selectedLorebook.filename)}`, {
                method: 'DELETE'
            });
            const data = await response.json();

            if (data.success) {
                showMessage(`Lorebook deleted: ${selectedLorebook.name}`, 'success');
                selectedLorebook = null;
                renderDetails();
                await fetchLorebooks();
            } else {
                showMessage(data.error || 'Failed to delete lorebook', 'error');
            }
        } catch (error) {
            showMessage('Failed to delete lorebook: ' + error.message, 'error');
        }

        closeModal(deleteModal);
    }

    /**
     * Upload a new lorebook
     */
    async function uploadLorebook() {
        const file = lorebookFile.files[0];
        if (!file) {
            showMessage('Please select a file to upload', 'error');
            return;
        }

        try {
            const content = await file.text();
            const filename = lorebookFilename.value.trim() || file.name;

            const response = await fetch('/api/lorebooks/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, content })
            });
            const data = await response.json();

            if (data.success) {
                showMessage(`Lorebook uploaded: ${data.message}`, 'success');
                closeModal(uploadModal);
                lorebookFile.value = '';
                lorebookFilename.value = '';
                await fetchLorebooks();
            } else {
                showMessage(data.error || 'Failed to upload lorebook', 'error');
            }
        } catch (error) {
            showMessage('Failed to upload lorebook: ' + error.message, 'error');
        }
    }

    // Modal helpers
    function openModal(modal) {
        modal.removeAttribute('hidden');
        modal.classList.add('is-open');
    }

    function closeModal(modal) {
        modal.setAttribute('hidden', '');
        modal.classList.remove('is-open');
    }

    // Utility functions
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatKeys(keys) {
        if (Array.isArray(keys)) {
            return keys.join(', ');
        }
        return String(keys || '');
    }

    function truncate(str, maxLength) {
        if (!str || str.length <= maxLength) return str || '';
        return str.substring(0, maxLength) + '...';
    }

    function formatNumber(num) {
        return new Intl.NumberFormat().format(num || 0);
    }

    // Event Listeners
    uploadBtn.addEventListener('click', () => openModal(uploadModal));

    toggleBtn.addEventListener('click', () => {
        if (selectedLorebook) {
            toggleLorebook(selectedLorebook.filename, !selectedLorebook.enabled);
        }
    });

    deleteBtn.addEventListener('click', () => {
        if (selectedLorebook) {
            deleteLorebookName.textContent = selectedLorebook.name;
            openModal(deleteModal);
        }
    });

    // Upload modal
    document.getElementById('closeUploadModal').addEventListener('click', () => closeModal(uploadModal));
    document.getElementById('cancelUpload').addEventListener('click', () => closeModal(uploadModal));
    document.getElementById('confirmUpload').addEventListener('click', uploadLorebook);

    // Delete modal
    document.getElementById('closeDeleteModal').addEventListener('click', () => closeModal(deleteModal));
    document.getElementById('cancelDelete').addEventListener('click', () => closeModal(deleteModal));
    document.getElementById('confirmDelete').addEventListener('click', deleteLorebook);

    // Close modals on backdrop click
    [uploadModal, deleteModal].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal);
        });
    });

    // Close modals on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            [uploadModal, deleteModal].forEach(modal => {
                if (!modal.hasAttribute('hidden')) closeModal(modal);
            });
        }
    });

    // Initialize
    fetchLorebooks();
})();
