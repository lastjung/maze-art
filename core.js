/**
 * Core Engine for Math Visualizations
 * Handles Global Systems: UIManager, Idle Management, Recording Mode, and Case Loading
 */

const Core = {
    currentCase: null,
    isIdle: false,
    idleTimer: null,
    IDLE_TIMEOUT: 60 * 1000,
    isRecordingMode: false,
    isRunning: true,
    currentCaseMode: 'display',

    init() {
        this.setupUI();
        this.setupIdleSystem();
        this.setupGlobalEvents();
        
        window.addEventListener('resize', () => {
            if (this.currentCase && this.currentCase.resize) {
                this.currentCase.resize();
            }
            this.updateControls(); // Refresh UI layout (sidebar vs dock)
        });
    },

    // --- Universal UI System ---
    setupUI() {
        // 1. Create Settings Panel
        if (!document.getElementById('settings-panel')) {
            const panel = document.createElement('div');
            panel.id = 'settings-panel';
            document.body.appendChild(panel);
        }

        // 2. Create Floating Dock
        if (!document.getElementById('floating-dock-container')) {
            const dock = document.createElement('div');
            dock.id = 'floating-dock-container';
            dock.innerHTML = `
                <button class="icon-btn" id="btn-settings" title="Settings">⚙️</button>
                <button class="icon-btn" id="btn-bgm" title="Sound On/Off">🔇</button>
                <button class="icon-btn" id="btn-hide-ui" title="Enter Full Screen">⤢</button>
                <div class="dock-divider"></div>
                <button class="icon-btn" id="btn-reset" title="Reset">↺</button>
                <button class="play-btn" id="btn-play" title="Play/Pause">
                    <span>❚❚</span> <span>Hold</span>
                </button>
            `;
            document.body.appendChild(dock);

            // Bind Dock Events
            document.getElementById('btn-settings').onclick = () => this.toggleSettings();
            document.getElementById('btn-bgm').onclick = () => this.toggleAudio();
            document.getElementById('btn-hide-ui').onclick = () => this.toggleCinematicMode();
            document.getElementById('btn-reset').onclick = () => this.resetCase();
            document.getElementById('btn-play').onclick = () => this.togglePlay();
        }
        this.syncAudioButton();

        // 3. UI Toggle Button (for bringing UI back)
        if (!document.getElementById('ui-toggle-btn')) {
             const btn = document.createElement('button');
             btn.id = 'ui-toggle-btn';
             btn.textContent = 'Exit Full Screen';
             btn.title = 'Exit Full Screen';
             btn.onclick = () => this.toggleCinematicMode();
             document.body.appendChild(btn);
        }
        this.updateCinematicButton();
        
        // Auto-initialize audio on first interaction
        const initAudio = () => {
             // Start audio only when the app is running to avoid pause-click race.
             if (!this.isRunning) return;
             if (this.currentCase && this.currentCase.musicTrack && window.audioManager && window.audioManager.audio.paused && !window.audioManager.isMuted) {
                 window.audioManager.play(this.currentCase.musicTrack);
                 document.removeEventListener('click', initAudio);
                 document.removeEventListener('keydown', initAudio);
             }
        };
        document.addEventListener('click', initAudio);
        document.addEventListener('keydown', initAudio);
    },

    toggleAudio() {
        if (this.currentCase && typeof this.currentCase.toggleCaseAudio === 'function') {
            this.currentCase.toggleCaseAudio();
            this.syncAudioButton();
            this.updateControls();
            return;
        }

        if (window.audioManager) {
            const isMuted = window.audioManager.toggleMute();
            this.syncAudioButton();
            this.updateControls();
            if (!isMuted && this.isRunning && this.currentCase && this.currentCase.musicTrack) {
                window.audioManager.play(this.currentCase.musicTrack);
            }
        }
    },

    syncAudioButton() {
        const btn = document.getElementById('btn-bgm');
        if (!btn) return;
        let isMuted = true;
        if (this.currentCase && typeof this.currentCase.isCaseAudioMuted === 'function') {
            isMuted = this.currentCase.isCaseAudioMuted();
        } else if (window.audioManager) {
            isMuted = window.audioManager.isMuted;
        }
        btn.innerHTML = isMuted ? '🔇' : '🎵';
        btn.style.opacity = isMuted ? '0.5' : '1';
    },

    updateControls() {
        // Find active container
        const isDesktop = window.innerWidth > 1024;
        const panel = isDesktop ? document.querySelector('.controls.active') : document.getElementById('settings-panel');
        if (!panel) return;
        
        panel.innerHTML = ''; // Clear existing content

        // Add Global Controls for Desktop Sidebar
        if (isDesktop) {
            const globalGroup = document.createElement('div');
            globalGroup.className = 'setting-item';
            globalGroup.style.marginBottom = '16px';
            globalGroup.style.paddingBottom = '16px';
            globalGroup.style.borderBottom = '1px solid #eee';
            
            globalGroup.innerHTML = `
                <div class="setting-header" style="margin-bottom:12px;">
                    <label>${this.currentCaseMode === 'interactive' ? 'Interactive Controls' : 'Master Controls'}</label>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                    <button class="btn-primary" id="sidebar-reset" style="padding:10px 0; font-size:0.8rem;">
                        ${this.currentCaseMode === 'interactive' ? '↺ Reset Maze' : '↺ Reset'}
                    </button>
                    <button class="btn-primary" id="sidebar-play" style="padding:10px 0; font-size:0.8rem;">
                        ${(() => { const s = this.getPlayLabel(); return s.icon + ' ' + s.text; })()}
                    </button>
                </div>
                <button class="btn-secondary" id="sidebar-bgm" style="width:100%; margin-top:8px; font-size:0.8rem;">
                    ${(this.currentCase && typeof this.currentCase.caseAudioLabel === 'function') ? this.currentCase.caseAudioLabel() : 'BGM'}: ${(this.currentCase && typeof this.currentCase.isCaseAudioMuted === 'function') ? (this.currentCase.isCaseAudioMuted() ? 'OFF' : 'ON') : (window.audioManager && !window.audioManager.isMuted ? 'ON' : 'OFF')}
                </button>
            `;
            panel.appendChild(globalGroup);

            panel.querySelector('#sidebar-reset').onclick = () => this.resetCase();
            panel.querySelector('#sidebar-play').onclick = () => this.togglePlay();
            panel.querySelector('#sidebar-bgm').onclick = () => {
                this.toggleAudio();
                this.updateControls(); // Refresh button text
            };
        }

        if (this.currentCase && this.currentCase.uiConfig) {
            const controls = this.currentCase.uiConfig;
            
            controls.forEach(ctrl => {
                const row = document.createElement('div');
                row.className = 'setting-item';

                if (ctrl.type === 'slider') {
                    row.innerHTML = `
                        <div class="setting-header">
                            <label>${ctrl.label}</label>
                            <span class="setting-value" id="val-${ctrl.id}">${ctrl.value}</span>
                        </div>
                        <input type="range" id="${ctrl.id}" 
                               min="${ctrl.min}" max="${ctrl.max}" step="${ctrl.step}" value="${ctrl.value}">
                    `;
                    panel.appendChild(row);

                    const input = row.querySelector('input');
                    const valDisplay = row.querySelector(`#val-${ctrl.id}`);
                    
                    input.oninput = (e) => {
                        const v = parseFloat(e.target.value);
                        valDisplay.textContent = v;
                        if (ctrl.onChange) ctrl.onChange(v, valDisplay);
                    };
                } else if (ctrl.type === 'button') {
                     row.style.textAlign = 'center';
                     row.innerHTML = `<button class="btn-primary" id="${ctrl.id}" style="width:100%; margin-top:4px;">${ctrl.value || ctrl.label}</button>`;
                     panel.appendChild(row);
                     
                     const btn = row.querySelector(`#${ctrl.id}`);
                     btn.onclick = () => {
                         if (ctrl.onClick) ctrl.onClick();
                     };
                } else if (ctrl.type === 'select') {
                    row.innerHTML = `
                        <div class="setting-header">
                            <label>${ctrl.label}</label>
                        </div>
                        <select id="${ctrl.id}" class="setting-select">
                            ${ctrl.options.map(opt => `<option value="${opt.value}" ${opt.value === ctrl.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
                        </select>
                    `;
                    panel.appendChild(row);
                    
                    const select = row.querySelector('select');
                    select.onchange = (e) => {
                        if (ctrl.onChange) ctrl.onChange(e.target.value);
                    };
                } else if (ctrl.type === 'info') {
                    row.classList.add('setting-item-info');
                    row.innerHTML = `
                        <div class="setting-info-label">${ctrl.label || 'Info'}</div>
                        <div class="setting-info-value">${ctrl.value || ''}</div>
                    `;
                    panel.appendChild(row);
                }
            });
        }
    },

    setCaseMode(mode = 'display') {
        this.currentCaseMode = mode === 'interactive' ? 'interactive' : 'display';
        const displayPanel = document.getElementById('display-controls');
        const interactivePanel = document.getElementById('interactive-controls');
        if (displayPanel) displayPanel.classList.toggle('active', this.currentCaseMode === 'display');
        if (interactivePanel) interactivePanel.classList.toggle('active', this.currentCaseMode === 'interactive');
        document.body.setAttribute('data-case-mode', this.currentCaseMode);
    },

    toggleSettings() {
        const panel = document.getElementById('settings-panel');
        panel.classList.toggle('visible');
    },

    toggleCinematicMode() {
        document.body.classList.toggle('hide-ui');
        this.updateCinematicButton();
        // Ensure dock is hidden/shown (handled by CSS, but resizing might be needed)
        if (this.currentCase && this.currentCase.resize) this.currentCase.resize();
    },

    updateCinematicButton() {
        const isHidden = document.body.classList.contains('hide-ui');
        const dockBtn = document.getElementById('btn-hide-ui');
        const exitBtn = document.getElementById('ui-toggle-btn');
        if (dockBtn) {
            dockBtn.textContent = isHidden ? '⤡' : '⤢';
            dockBtn.title = isHidden ? 'Exit Full Screen' : 'Enter Full Screen';
        }
        if (exitBtn) {
            exitBtn.style.display = isHidden ? 'block' : 'none';
        }
    },

    // --- Single source of truth for play button state ---
    getPlayLabel() {
        const c = this.currentCase;
        if (this.currentCaseMode === 'interactive' && c) {
            if (c.searchInProgress && !c.searchPaused) return { icon: '❚❚', text: 'Hold', running: true };
            if (c.searchPaused) return { icon: '▶', text: 'Resume', running: false };
            return { icon: '▶', text: 'Go', running: false };
        }
        return this.isRunning
            ? { icon: '❚❚', text: 'Pause', running: true }
            : { icon: '▶', text: 'Resume', running: false };
    },

    syncPlayButton() {
        const state = this.getPlayLabel();
        this.isRunning = state.running;
        const btn = document.getElementById('btn-play');
        if (btn) {
            btn.innerHTML = `<span>${state.icon}</span> <span>${state.text}</span>`;
            btn.classList.toggle('paused', !state.running);
        }
    },

    resetCase() {
        if (this.currentCase && this.currentCase.reset) {
            this.currentCase.reset();
            // Auto-play on reset unless case forbids it
            if (!this.isRunning && this.currentCase.autoPlayOnReset !== false) {
                 this.togglePlay();
            } else {
                 this.syncPlayButton();
            }
            if (window.audioManager) {
                window.audioManager.syncWithPlaybackState(this.isRunning);
            }
            this.updateControls();
        }
    },

    togglePlay() {
        this.isRunning = !this.isRunning;

        if (this.isRunning) {
            if (this.currentCase && this.currentCase.start) this.currentCase.start();
        } else {
            if (this.currentCase && this.currentCase.stop) this.currentCase.stop();
        }

        this.syncPlayButton();

        if (window.audioManager) {
            if (this.isRunning) {
                if (!window.audioManager.currentTrack && this.currentCase && this.currentCase.musicTrack && !window.audioManager.isMuted) {
                    window.audioManager.play(this.currentCase.musicTrack);
                } else {
                    window.audioManager.syncWithPlaybackState(true);
                }
            } else {
                window.audioManager.syncWithPlaybackState(false);
            }
        }
        this.updateControls();
    },

    // --- Idle & Global ---

    setupIdleSystem() {
        const stopAnimation = () => {
            this.isIdle = true;
            this.isRunning = false; // Sync global state
            if (this.currentCase && this.currentCase.stop) {
                this.currentCase.stop();
            }
            document.getElementById('sleep-overlay').style.display = 'flex';
            this.syncPlayButton(); // Update UI button status
        };

        const resetIdleTimer = () => {
            if (this.isIdle) {
                this.isIdle = false;
                document.getElementById('sleep-overlay').style.display = 'none';
                // Removed: Automatic start() call. Now requires manual user action to resume.
                this.syncPlayButton(); // Update UI to reflect it's currently stopped
            }
            clearTimeout(this.idleTimer);
            this.idleTimer = setTimeout(stopAnimation, this.IDLE_TIMEOUT);
        };

        ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
            window.addEventListener(evt, resetIdleTimer, true);
        });

        this.idleTimer = setTimeout(stopAnimation, this.IDLE_TIMEOUT);
    },

    setupGlobalEvents() {
         // ESC to exit cinematic mode or toggle recording
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (document.body.classList.contains('hide-ui')) {
                    this.toggleCinematicMode();
                } else {
                   // Optional: Toggle Recording Mode logic if we want to keep it
                   // this.toggleRecording(); 
                }
            }
        });
    },
    
    // Kept for backward compatibility or future use
    toggleRecording() {
        this.isRecordingMode = !this.isRecordingMode;
        document.body.classList.toggle('recording-mode');
        if (this.currentCase && this.currentCase.resize) {
            this.currentCase.resize();
        }
    },

    resetIdleTimer() {
        window.dispatchEvent(new Event('mousedown')); 
    },

    loadCase(caseInstance, options = {}) {
        if (this.currentCase && this.currentCase.destroy) {
            this.currentCase.destroy();
        }

        this.setCaseMode(options.mode || 'display');

        this.currentCase = caseInstance;
        this.currentCase.init();
        
        // Generate UI for this case
        this.updateControls();
        
        // Switch Music if defined
        if (this.currentCase.musicTrack && window.audioManager) {
             window.audioManager.play(this.currentCase.musicTrack);
        }
        this.syncAudioButton();
        
        // Reset Play State (case can opt-in to paused start)
        this.isRunning = this.currentCase.startPausedOnLoad === true ? false : true;

        if (this.isRunning && this.currentCase.start) {
            this.currentCase.start();
        } else if (this.currentCase.stop) {
            this.currentCase.stop();
        }

        this.syncPlayButton();
        this.updateControls();

        if (window.audioManager) {
            window.audioManager.syncWithPlaybackState(this.isRunning);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => Core.init());
