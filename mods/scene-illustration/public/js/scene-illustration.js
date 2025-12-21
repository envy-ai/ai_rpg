/**
 * Scene Illustration Client-Side Module
 * 
 * Adds a "Generate Illustration" button to chat messages and a "Scenes Gallery" tab.
 */

(function() {
    'use strict';

    // Wait for AIRPGChat to be available
    function waitForChat(callback, maxAttempts = 50) {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (window.AIRPG_CHAT) {
                clearInterval(interval);
                callback(window.AIRPG_CHAT);
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                console.warn('Scene Illustration: AIRPGChat not available after', maxAttempts, 'attempts');
            }
        }, 100);
    }

    /**
     * Bind lightbox controller to all images within a container
     */
    function bindLightboxToImages(container) {
        if (!container || !window.lightboxController) {
            return;
        }
        const images = container.querySelectorAll('img');
        images.forEach(img => {
            if (img.dataset.lightboxBound === 'true') {
                return;
            }
            const src = img.src || img.dataset.lightboxImage;
            if (!src) {
                return;
            }
            // If the image doesn't already have dataset attributes for lightbox, set them
            if (!img.dataset.lightboxImage) {
                img.dataset.lightboxImage = src;
            }
            if (!img.dataset.lightboxAlt) {
                img.dataset.lightboxAlt = img.alt || 'Image';
            }
            
            img.style.cursor = 'zoom-in';
            window.lightboxController.bind(img);
            
            // Mark as bound to avoid double-binding if called multiple times
            img.dataset.lightboxBound = 'true';
        });
    }

    /**
     * Hook into AIRPGChat.setMessageContent to bind lightbox to images
     */
    function hookMessageRendering(chat) {
        if (typeof chat.setMessageContent !== 'function' || chat._sceneIllustrationRenderingHooked) {
            return;
        }

        const originalSetMessageContent = chat.setMessageContent.bind(chat);
        
        chat.setMessageContent = function(target, content, options) {
            // Call original method
            originalSetMessageContent(target, content, options);
            
            // Bind lightbox to any images in the rendered content
            bindLightboxToImages(target);
        };
        
        chat._sceneIllustrationRenderingHooked = true;
    }

    /**
     * Initialize the scene illustration mod
     */
    function init(chat) {
        console.log('🎨 Scene Illustration: Initializing...');

        // 1. Register the illustration button
        // 1. Inject button into existing messages
        injectButtonIntoExistingMessages(chat);
        
        // Bind lightbox to potential existing images (in case we loaded after history render)
        if (chat.chatLog) {
            bindLightboxToImages(chat.chatLog);
        }

        // 2. Hook into message creation to add button to new messages
        hookMessageActions(chat);
        
        // 3. Hook into message rendering to bind lightbox
        hookMessageRendering(chat);

        // 4. Hook into WebSocket messages
        hookWebSocket(chat);

        // 5. Inject Scenes Gallery Tab
        injectGalleryTab();

        console.log('🎨 Scene Illustration: Initialized');
    }

    /**
     * Hook into AIRPGChat.createMessageActions to inject our button
     */
    function hookMessageActions(chat) {
        if (typeof chat.createMessageActions !== 'function' || chat._sceneIllustrationHooked) {
            return;
        }

        const originalCreateMessageActions = chat.createMessageActions.bind(chat);
        
        chat.createMessageActions = function(entry) {
            // Call original to get the wrapper with standard buttons (edit, delete)
            const wrapper = originalCreateMessageActions(entry);
            
            // If wrapper is null (e.g. key system messages), return null
            if (!wrapper) {
                return null;
            }

            // Check if we should show our button
            if (entry && entry.role === 'assistant') {
                const modButton = createIllustrationButton(entry);
                wrapper.appendChild(modButton);
            }

            return wrapper;
        };
        
        chat._sceneIllustrationHooked = true;
    }

    /**
     * Create the illustration button element
     */
    function createIllustrationButton(entry) {
        const modButton = document.createElement('button');
        modButton.type = 'button';
        modButton.className = 'message-action message-action--mod message-action--scene-illustration';
        modButton.title = 'Generate scene illustration';
        modButton.setAttribute('aria-label', 'Generate scene illustration');
        modButton.textContent = '🎨';
        
        // Initialize queue state
        modButton.dataset.queueCount = '0';
        
        modButton.addEventListener('click', () => {
            handleGenerateIllustration(entry, modButton);
        });
        return modButton;
    }

    /**
     * Inject button into existing messages that are already in the DOM
     */
    function injectButtonIntoExistingMessages(chat) {
        if (!chat.chatLog) return;

        // Find all message elements with timestamps
        const messages = chat.chatLog.querySelectorAll('.message[data-timestamp]');
        
        messages.forEach(messageElement => {
            // We only care about assistant messages
            if (!messageElement.classList.contains('ai-message')) {
                return;
            }

            const actionsWrapper = messageElement.querySelector('.message-actions');
            if (!actionsWrapper) {
                return;
            }

            // Check if button already exists
            if (actionsWrapper.querySelector('.message-action--scene-illustration')) {
                return;
            }

            // Get timestamp/entry data
            const timestamp = messageElement.dataset.timestamp;
            // Reconstruct a minimal entry object for the click handler
            const entry = {
                timestamp: timestamp,
                role: 'assistant'
            };

            const modButton = createIllustrationButton(entry);
            actionsWrapper.appendChild(modButton);
        });
    }

    /**
     * Hook into WebSocket messages to handle completion events
     */
    function hookWebSocket(chat) {
        if (typeof chat.handleWebSocketMessage === 'function') {
            const originalHandleMessage = chat.handleWebSocketMessage.bind(chat);
            chat.handleWebSocketMessage = function(event) {
                // Call original handler
                originalHandleMessage(event);
                
                // Handle our custom events
                try {
                    if (!event || typeof event.data !== 'string') return;
                    const payload = JSON.parse(event.data);
                    
                    if (payload.type === 'scene_illustration_complete') {
                        handleIllustrationComplete(chat, payload);
                        refreshGallery(); // Refresh gallery when new image arrives
                    } else if (payload.type === 'scene_illustration_failed') {
                        handleIllustrationFailed(payload);
                    }
                } catch (e) {
                    // Ignore parsing errors
                }
            };
        }
    }

    /**
     * Inject the Scenes Gallery tab and panel
     */
    function injectGalleryTab() {
        const tabBar = document.querySelector('.tab-bar');
        const tabPanels = document.querySelector('.tab-panels');

        if (!tabBar || !tabPanels) {
            console.warn('Scene Illustration: Tab bar or panels not found');
            return;
        }

        if (document.getElementById('tab-scenes-gallery-tab')) {
            return; // Already injected
        }

        // Create Tab Button - use data-tab for integration with main tab system
        const tabButton = document.createElement('button');
        tabButton.className = 'tab-button';
        tabButton.id = 'tab-scenes-gallery-tab';
        tabButton.dataset.tab = 'scenes-gallery';
        tabButton.setAttribute('role', 'tab');
        tabButton.setAttribute('aria-selected', 'false');
        tabButton.setAttribute('aria-controls', 'tab-scenes-gallery');
        tabButton.textContent = 'Scenes Gallery';
        
        // Insert after Party tab (or last)
        tabBar.appendChild(tabButton);

        // Create Tab Panel - start hidden to match other inactive panels
        const tabPanel = document.createElement('section');
        tabPanel.className = 'tab-panel';
        tabPanel.id = 'tab-scenes-gallery';
        tabPanel.setAttribute('role', 'tabpanel');
        tabPanel.setAttribute('aria-labelledby', 'tab-scenes-gallery-tab');
        tabPanel.hidden = true; // Start hidden like other inactive panels
        tabPanel.innerHTML = `
            <div class="scenes-gallery-container" style="padding: 20px; height: 100%; overflow-y: auto;">
                <div class="gallery-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h3 style="margin: 0;">Scenes Gallery</h3>
                    <button id="refresh-gallery-btn" class="button" style="padding: 5px 10px;">Refresh</button>
                </div>
                <div id="scenes-gallery-grid" class="gallery-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 15px;">
                    <div class="loading-spinner">Loading...</div>
                </div>
            </div>
        `;
        
        tabPanels.appendChild(tabPanel);

        /**
         * Activate the Scenes Gallery tab programmatically
         */
        function activateGalleryTab() {
            // Deactivate all tabs and panels
            document.querySelectorAll('.tab-button').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            document.querySelectorAll('.tab-panel').forEach(p => {
                p.classList.remove('active');
                p.hidden = true;
            });

            // Activate gallery tab
            tabButton.classList.add('active');
            tabButton.setAttribute('aria-selected', 'true');
            tabPanel.classList.add('active');
            tabPanel.hidden = false;

            // Load content
            loadGalleryContent();
        }

        /**
         * Deactivate the Scenes Gallery tab
         */
        function deactivateGalleryTab() {
            tabButton.classList.remove('active');
            tabButton.setAttribute('aria-selected', 'false');
            tabPanel.classList.remove('active');
            tabPanel.hidden = true;
        }

        // Handle click on our tab button
        tabButton.addEventListener('click', () => {
            if (tabButton.classList.contains('active')) {
                return; // Already active
            }
            activateGalleryTab();
            // Update URL hash to match main system convention
            const newHash = '#tab-scenes-gallery';
            if (window.location.hash !== newHash) {
                window.location.hash = newHash;
            }
        });

        // Listen for hash changes to sync with main tab system
        function handleHashChange() {
            const rawHash = window.location.hash ? window.location.hash.replace('#', '') : '';
            if (!rawHash) {
                return;
            }
            
            // Check if hash matches our tab
            const isOurTab = rawHash === 'tab-scenes-gallery' || rawHash === 'scenes-gallery';
            
            if (isOurTab) {
                // Hash points to our tab - activate it
                activateGalleryTab();
            } else {
                // Hash points to another tab - deactivate ours
                deactivateGalleryTab();
            }
        }

        // Listen for hashchange events
        window.addEventListener('hashchange', handleHashChange);

        // Check initial hash state (handles page reload with our tab in hash)
        const initialHash = window.location.hash ? window.location.hash.replace('#', '') : '';
        if (initialHash === 'tab-scenes-gallery' || initialHash === 'scenes-gallery') {
            // Use requestAnimationFrame to ensure we activate after initial render,
            // then use another frame to ensure all other initialization has completed
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // Only activate if we're not already active (avoid unnecessary redraws)
                    if (!tabButton.classList.contains('active')) {
                        activateGalleryTab();
                    }
                });
            });
        }
        
        // Also handle the case where the hash IS ours but another tab got activated
        // (this can happen due to race conditions with the main tab system)
        setTimeout(() => {
            const currentHash = window.location.hash ? window.location.hash.replace('#', '') : '';
            const isOurHash = currentHash === 'tab-scenes-gallery' || currentHash === 'scenes-gallery';
            if (isOurHash && !tabButton.classList.contains('active')) {
                activateGalleryTab();
            }
        }, 100);

        // Bind Refresh Button
        const refreshBtn = tabPanel.querySelector('#refresh-gallery-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadGalleryContent);
        }
    }

    /**
     * Load and render gallery content
     */
    async function loadGalleryContent() {
        const grid = document.getElementById('scenes-gallery-grid');
        if (!grid) return;

        grid.innerHTML = '<div class="loading-spinner">Loading scenes...</div>';

        try {
            const response = await fetch('/api/mods/scene-illustration/jobs');
            const data = await response.json();

            if (data.success && Array.isArray(data.jobs)) {
                renderGalleryGrid(data.jobs);
            } else {
                grid.innerHTML = '<div class="error-message">Failed to load scenes.</div>';
            }
        } catch (error) {
            console.error('Scene Illustration: Failed to load gallery', error);
            grid.innerHTML = `<div class="error-message">Error: ${error.message}</div>`;
        }
    }

    /**
     * Render the gallery grid
     */
    function renderGalleryGrid(jobs) {
        const grid = document.getElementById('scenes-gallery-grid');
        if (!grid) return;

        grid.innerHTML = '';

        if (jobs.length === 0) {
            grid.innerHTML = '<div class="empty-message">No scenes generated yet.</div>';
            return;
        }

        jobs.forEach(job => {
            const card = document.createElement('div');
            card.className = 'gallery-card';
            Object.assign(card.style, {
                background: 'rgba(0, 0, 0, 0.2)',
                borderRadius: '8px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
            });

            let contentHtml = '';
            
            // Check for completed status (server uses 'completed', handle both forms)
            const isCompleted = job.status === 'completed' || job.status === 'complete';
            
            if (isCompleted && job.imageUrl) {
                contentHtml = `
                    <div class="gallery-image-wrapper" style="position: relative; padding-top: 75%;">
                        <img src="${job.imageUrl}" alt="Scene" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; cursor: zoom-in;" data-lightbox-image="${job.imageUrl}">
                    </div>
                `;
            } else if (isCompleted && !job.imageUrl) {
                // Completed but no image URL - show error state
                contentHtml = `
                    <div class="gallery-placeholder error" style="padding-top: 75%; position: relative; background: #332211; display: flex; align-items: center; justify-content: center;">
                        <span style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #ffaa6b;">Image Missing</span>
                    </div>
                `;
            } else if (job.status === 'failed') {
                contentHtml = `
                    <div class="gallery-placeholder error" style="padding-top: 75%; position: relative; background: #331111; display: flex; align-items: center; justify-content: center;">
                        <span style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #ff6b6b;">Failed</span>
                    </div>
                `;
            } else {
                contentHtml = `
                    <div class="gallery-placeholder processing" style="padding-top: 75%; position: relative; background: #112233; display: flex; align-items: center; justify-content: center;">
                        <span style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #4dabf7;">${job.status}...</span>
                    </div>
                `;
            }

            const date = new Date(job.timestamp).toLocaleString();

            card.innerHTML = `
                ${contentHtml}
                <div class="gallery-info" style="padding: 10px; position: relative;">
                    <div class="gallery-date" style="font-size: 0.8em; color: #888; margin-bottom: 5px;">${date}</div>
                    <div class="gallery-prompt" style="font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;" title="${job.prompt}">${job.prompt}</div>
                    <button class="gallery-delete-btn" data-job-id="${job.id}" title="Delete this image" style="
                        position: absolute;
                        top: 8px;
                        right: 8px;
                        width: 28px;
                        height: 28px;
                        border-radius: 50%;
                        background: rgba(239, 68, 68, 0.8);
                        border: none;
                        color: white;
                        font-size: 16px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        opacity: 0;
                        transition: opacity 0.2s ease;
                    ">🗑️</button>
                </div>
            `;

            // Show delete button on hover
            card.addEventListener('mouseenter', () => {
                const btn = card.querySelector('.gallery-delete-btn');
                if (btn) btn.style.opacity = '1';
            });
            card.addEventListener('mouseleave', () => {
                const btn = card.querySelector('.gallery-delete-btn');
                if (btn) btn.style.opacity = '0';
            });

            // Bind delete handler
            const deleteBtn = card.querySelector('.gallery-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const jobId = deleteBtn.dataset.jobId;
                    if (!jobId) return;
                    
                    if (!confirm('Are you sure you want to delete this scene illustration?')) {
                        return;
                    }
                    
                    try {
                        const response = await fetch(`/api/mods/scene-illustration/jobs/${jobId}`, {
                            method: 'DELETE'
                        });
                        const data = await response.json();
                        if (data.success) {
                            card.remove();
                            showNotification('Image deleted successfully', 'success');
                            
                            // Refresh chat to remove the image from chat messages
                            if (window.AIRPG_CHAT && typeof window.AIRPG_CHAT.loadExistingHistory === 'function') {
                                window.AIRPG_CHAT.loadExistingHistory();
                            }
                        } else {
                            showNotification(data.error || 'Failed to delete image', 'error');
                        }
                    } catch (error) {
                        console.error('Failed to delete image:', error);
                        showNotification('Failed to delete image', 'error');
                    }
                });
            }

            // Bind lightbox
            if (isCompleted && job.imageUrl) {
                bindLightboxToImages(card);
            }

            grid.appendChild(card);
        });
    }

    /**
     * Refresh gallery if active
     */
    function refreshGallery() {
        const tabPanel = document.getElementById('tab-scenes-gallery');
        if (tabPanel && tabPanel.classList.contains('active')) {
            loadGalleryContent();
        }
    }

    /**
     * Handle illustration completion event
     */
    function handleIllustrationComplete(chat, payload) {
        const { messageTimestamp, imageUrl } = payload;
        if (!messageTimestamp || !imageUrl) return;

        console.log('🎨 Scene Illustration: Received completion', payload);

        // Find the message element
        const messageDiv = document.querySelector(`.message[data-timestamp="${messageTimestamp}"]`);
        
        // Update queue counter if message found
        if (messageDiv) {
            const actionBtn = messageDiv.querySelector('.message-action--scene-illustration');
            if (actionBtn && actionBtn.dataset.queueCount) {
                let count = parseInt(actionBtn.dataset.queueCount || '0');
                count = Math.max(0, count - 1);
                updateButtonQueueState(actionBtn, count);
            }
        }

        if (!messageDiv) return;

        // Check if image is already there
        if (messageDiv.querySelector(`img[src="${imageUrl}"]`)) return;

        // Create image element
        const contentDiv = messageDiv.querySelector('.message-content');
        if (contentDiv) {
            const imgContainer = document.createElement('div');
            imgContainer.className = 'scene-illustration-container';
            
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = 'Scene Illustration';
            img.className = 'scene-illustration-image';
            img.loading = 'lazy';
            
            imgContainer.appendChild(img);
            contentDiv.appendChild(imgContainer);
            
            // Enable lightbox
            bindLightboxToImages(imgContainer);
            
            // Scroll to bottom if needed
            chat.scrollToBottom();
            
            showNotification('Scene illustration generated!', 'success');
        }
    }

    /**
     * Handle illustration failure event
     */
    function handleIllustrationFailed(payload) {
        console.warn('🎨 Scene Illustration: Generation failed', payload);
        showNotification('Illustration generation failed: ' + (payload.error || 'Unknown error'), 'error');
        
        // Decrement queue counter
        if (payload.messageTimestamp) {
            const messageDiv = document.querySelector(`.message[data-timestamp="${payload.messageTimestamp}"]`);
            if (messageDiv) {
                const actionBtn = messageDiv.querySelector('.message-action--scene-illustration');
                if (actionBtn && actionBtn.dataset.queueCount) {
                    let count = parseInt(actionBtn.dataset.queueCount || '0');
                    count = Math.max(0, count - 1);
                    updateButtonQueueState(actionBtn, count);
                }
            }
        }
    }

    /**
     * Map numbers to emojis
     */
    const NUMBER_EMOJIS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

    /**
     * Helper to update button appearance based on queue count
     */
    function updateButtonQueueState(button, count) {
        button.dataset.queueCount = count.toString();
        
        if (count <= 0) {
            // Queue finished or empty
            button.dataset.queueCount = '0';
            // Show success briefly
            button.textContent = '✅';
            button.title = 'All requests processed';
            
            // Revert to default after delay
            setTimeout(() => {
                // Only revert if still 0 (user hasn't clicked again)
                if (button.dataset.queueCount === '0') {
                    button.textContent = '🎨';
                    button.title = 'Generate scene illustration';
                    button.disabled = false;
                }
            }, 2000);
        } else {
            // Update counter
            button.textContent = NUMBER_EMOJIS[Math.min(count, 9)] || '9️⃣';
            button.title = `${count} illustration${count > 1 ? 's' : ''} queued...`;
        }
    }

    /**
     * Handle click on generate illustration button
     */
    async function handleGenerateIllustration(entry, button) {
        // limit to 9 concurrent requests for sanity
        let currentQueue = parseInt(button.dataset.queueCount || '0');
        if (currentQueue >= 9) {
            showNotification('Maximum queue size reached (9)', 'info');
            return;
        }

        // Increment queue
        currentQueue++;
        button.dataset.queueCount = currentQueue.toString();
        
        // Update button appearance immediately
        button.textContent = NUMBER_EMOJIS[Math.min(currentQueue, 9)] || '9️⃣';
        button.title = `${currentQueue} illustration${currentQueue > 1 ? 's' : ''} queued...`;

        try {
            const clientId = window.AIRPG_CLIENT_ID || null;
            
            // Fire request
            const response = await fetch('/api/mods/scene-illustration/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Client-ID': clientId || ''
                },
                body: JSON.stringify({
                    messageTimestamp: entry.timestamp,
                    clientId: clientId
                })
            });

            const result = await response.json();

            if (result.success) {
                showNotification('Scene illustration added to queue', 'success');
            } else {
                throw new Error(result.error || 'Unknown error');
            }
        } catch (error) {
            console.error('Scene Illustration: Generation failed:', error);
            showNotification('Illustration request failed: ' + error.message, 'error');
            
            // Decrement on immediate failure (didn't make it to server queue)
            let newQueue = parseInt(button.dataset.queueCount || '0');
            newQueue = Math.max(0, newQueue - 1);
            updateButtonQueueState(button, newQueue);
        }
    }

    /**
     * Show a notification to the user
     */
    function showNotification(message, type = 'info') {
        // Try to use existing notification system if available
        if (window.showToast && typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        // Fallback: create a simple notification
        const notification = document.createElement('div');
        notification.className = 'scene-illustration-notification scene-illustration-notification--' + type;
        notification.textContent = message;
        
        // Style the notification
        Object.assign(notification.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            padding: '12px 20px',
            borderRadius: '8px',
            color: '#fff',
            fontWeight: '500',
            zIndex: '10000',
            animation: 'fadeInUp 0.3s ease-out',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        });

        if (type === 'success') {
            notification.style.background = 'linear-gradient(135deg, #28a745, #20c997)';
        } else if (type === 'error') {
            notification.style.background = 'linear-gradient(135deg, #dc3545, #c82333)';
        } else {
            notification.style.background = 'linear-gradient(135deg, #007bff, #0056b3)';
        }

        document.body.appendChild(notification);

        // Remove after 4 seconds
        setTimeout(() => {
            notification.style.animation = 'fadeOutDown 0.3s ease-out forwards';
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 4000);
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            waitForChat(init);
        });
    } else {
        waitForChat(init);
    }
})();
