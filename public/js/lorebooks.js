/**
 * Lorebooks Manager Frontend
 * Handles UI interactions for managing lorebooks
 */

(function() {
    'use strict';

    // State
    let lorebooks = [];
    let selectedLorebook = null;
    let disposed = false;
    let listRequest = 0;
    let detailRequest = 0;
    let detailTarget = null;
    const pageEvents = new AbortController();

    // DOM Elements
    const lorebooksList = document.getElementById('lorebooksList');
    const detailsEmpty = document.getElementById('detailsEmpty');
    const detailsContent = document.getElementById('detailsContent');
    const detailsName = document.getElementById('detailsName');
    const detailsEntryCount = document.getElementById('detailsEntryCount');
    const detailsTokens = document.getElementById('detailsTokens');
    const entriesList = document.getElementById('entriesList');
    const listView = new window.AIRPG_WIDGETS.CollectionView(lorebooksList);
    const entriesView = new window.AIRPG_WIDGETS.CollectionView(entriesList);
    const fromMarkup = markup => {
        const template = document.createElement('template');
        template.innerHTML = markup;
        return document.adoptNode(template.content.firstElementChild);
    };
    window.addEventListener('pagehide', event => {
        if (event.persisted || disposed) return;
        disposed = true;
        ++listRequest;
        ++detailRequest;
        pageEvents.abort();
        try { listView.destroy(); } finally { entriesView.destroy(); }
    }, { signal: pageEvents.signal });
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
    function showMessage(message, type = 'info', error = null) {
        if (disposed) return;
        statusMessage.className = `status-message status-${type}`;
        window.AIRPG_WIDGETS.StatusSurface.attach(statusMessage, { hideMode: 'display' }).update({
            text: String(message ?? ''), visible: true, autoHideMs: type !== 'error' ? 3000 : null
        });
        if (error) window.AIRPG_PAGE_FEEDBACK.showError(error);
    }

    function showApiFailure(data, message) {
        const error = new Error(data.error || message);
        if (data.stack) error.stack = data.stack;
        showMessage(error.message, 'error', error);
    }

    /**
     * Fetch all lorebooks from API
     */
    async function fetchLorebooks() {
        if (disposed) return;
        const request = ++listRequest;
        try {
            const response = await fetch('/api/lorebooks');
            const data = await response.json();
            if (disposed || request !== listRequest) return;

            if (data.success) {
                lorebooks = data.lorebooks || [];
                renderLorebooksList();
                updateStats();
            } else {
                showApiFailure(data, 'Failed to load lorebooks');
            }
        } catch (error) {
            if (disposed || request !== listRequest) return;
            showMessage('Failed to connect to server: ' + error.message, 'error', error);
        }
    }

    /**
     * Render the lorebooks list
     */
    function renderLorebooksList() {
        if (disposed) return;
        listView.clear();
        if (lorebooks.length === 0) {
            lorebooksList.innerHTML = `
                <div class="empty-state">
                    <p>No lorebooks found.<br>Upload a SillyTavern-compatible lorebook to get started.</p>
                </div>
            `;
            return;
        }

        listView.render({ items: lorebooks, keepVisibleWhenEmpty: true, renderItem: book => {
            const listeners = new AbortController();
            const element = fromMarkup(`
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
        `);
            element.querySelector('.lorebook-info').addEventListener('click', () => selectLorebook(book.filename), { signal: listeners.signal });
            element.querySelector('.lorebook-checkbox').addEventListener('change', async event => {
                event.stopPropagation();
                await toggleLorebook(book.filename, event.target.checked);
            }, { signal: listeners.signal });
            return { element, dispose: () => listeners.abort() };
        } });
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
        if (disposed) return;
        const request = ++detailRequest;
        detailTarget = filename;
        try {
            const response = await fetch(`/api/lorebooks/${encodeURIComponent(filename)}`);
            const data = await response.json();
            if (disposed || request !== detailRequest) return;

            if (data.success) {
                selectedLorebook = data.lorebook;
                renderDetails();
                renderLorebooksList(); // Update selection highlight
            } else {
                showApiFailure(data, 'Failed to load lorebook details');
            }
        } catch (error) {
            if (disposed || request !== detailRequest) return;
            showMessage('Failed to load lorebook: ' + error.message, 'error', error);
        }
    }

    /**
     * Render lorebook details
     */
    function renderDetails() {
        if (disposed) return;
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
        if (disposed) return;
        entriesView.clear();
        if (!selectedLorebook || !selectedLorebook.entries) {
            entriesList.innerHTML = '<p class="empty-state">No entries</p>';
            return;
        }

        const entries = selectedLorebook.entries.slice(0, 50); // Limit to first 50

        entriesView.render({ items: entries, keepVisibleWhenEmpty: true, renderItem: entry => fromMarkup(`
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
        `) });

        if (selectedLorebook.entries.length > 50) {
            entriesList.append(fromMarkup(`
                <div class="entries-more">
                    ...and ${selectedLorebook.entries.length - 50} more entries
                </div>
            `));
        }
    }

    /**
     * Toggle lorebook enabled state
     */
    async function toggleLorebook(filename, enable) {
        if (disposed) return;
        try {
            const action = enable ? 'enable' : 'disable';
            const response = await fetch(`/api/lorebooks/${encodeURIComponent(filename)}/${action}`, {
                method: 'POST'
            });
            const data = await response.json();
            if (disposed) return;

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
                showApiFailure(data, `Failed to ${enable ? 'enable' : 'disable'} lorebook`);
                await fetchLorebooks(); // Refresh to sync state
            }
        } catch (error) {
            if (disposed) return;
            showMessage('Failed to update lorebook: ' + error.message, 'error', error);
            await fetchLorebooks();
        }
    }

    /**
     * Delete current lorebook
     */
    async function deleteLorebook() {
        if (disposed) return;
        if (!selectedLorebook) return;
        const target = selectedLorebook;

        try {
            const response = await fetch(`/api/lorebooks/${encodeURIComponent(target.filename)}`, {
                method: 'DELETE'
            });
            const data = await response.json();
            if (disposed) return;

            if (data.success) {
                showMessage(`Lorebook deleted: ${target.name}`, 'success');
                if (selectedLorebook?.filename === target.filename) {
                    if (detailTarget === target.filename) { ++detailRequest; detailTarget = null; }
                    selectedLorebook = null;
                    renderDetails();
                }
                await fetchLorebooks();
            } else {
                showApiFailure(data, 'Failed to delete lorebook');
            }
        } catch (error) {
            if (disposed) return;
            showMessage('Failed to delete lorebook: ' + error.message, 'error', error);
        }

        closeModal(deleteModal);
    }

    /**
     * Upload a new lorebook
     */
    async function uploadLorebook() {
        if (disposed) return;
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
            if (disposed) return;

            if (data.success) {
                showMessage(`Lorebook uploaded: ${data.message}`, 'success');
                closeModal(uploadModal);
                lorebookFile.value = '';
                lorebookFilename.value = '';
                await fetchLorebooks();
            } else {
                showApiFailure(data, 'Failed to upload lorebook');
            }
        } catch (error) {
            if (disposed) return;
            showMessage('Failed to upload lorebook: ' + error.message, 'error', error);
        }
    }

    // Modal helpers
    function openModal(modal) {
        if (disposed) return;
        window.AIRPG_MODAL_STACK.setVisible(modal, true);
        modal.classList.add('is-open');
    }

    function closeModal(modal) {
        if (disposed) return;
        window.AIRPG_MODAL_STACK.setVisible(modal, false);
        modal.classList.remove('is-open');
    }

    // Utility functions
    const escapeHtml = window.DomUtils.escapeHtml;

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

    [uploadModal, deleteModal].forEach(modal => {
        window.AIRPG_MODAL_STACK.configure(modal, {
            onDismiss: () => closeModal(modal),
            escape: 'dismiss',
            trapFocus: false,
            dismissOnBackdrop: true
        });
    });

    // Initialize
    fetchLorebooks();
})();
