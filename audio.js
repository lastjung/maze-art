/**
 * AudioManager
 * Handles background music playback and fading.
 * Supports individual track loading for each case.
 */
class AudioManager {
    constructor() {
        this.audio = new Audio();
        this.audio.loop = true;
        this.audio.volume = 0; // Start muted for fade-in
        this.targetVolume = 0.5;
        this.fadeInterval = null;
        this.isMuted = true;
        this.currentTrack = null;
    }

    play(trackUrl) {
        if (!trackUrl) return;
        // Keep track selected, but do not autoplay while muted.
        if (this.isMuted) {
            if (this.currentTrack !== trackUrl) {
                this.currentTrack = trackUrl;
                this.audio.src = trackUrl;
                this.audio.load();
            }
            return;
        }

        if (this.currentTrack === trackUrl) {
            if (this.audio.paused) this.fadeIn();
            return;
        }

        this.currentTrack = trackUrl;
        
        // Fade out old track
        this.fadeOut(() => {
            this.audio.src = trackUrl;
            this.audio.load(); // Reload
            
            this.audio.play().then(() => {
                this.fadeIn();
            }).catch(e => {
                console.warn("Audio play failed (user interaction needed):", e);
            });
        });
    }

    stop() {
        this.fadeOut(() => {
            this.audio.pause();
            this.currentTrack = null;
        });
    }

    pause() {
        this.fadeOut(() => {
            this.audio.pause();
        });
    }

    resume() {
        if (this.isMuted || !this.currentTrack) return;
        this.audio.play().then(() => {
            this.fadeIn();
        }).catch(() => {});
    }

    syncWithPlaybackState(isRunning) {
        if (isRunning) this.resume();
        else this.pause();
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.isMuted) {
            if (!this.audio.paused) {
                this.audio.pause();
            }
            this.audio.volume = 0;
        } else {
            if (this.currentTrack && this.audio.paused) {
                this.audio.play().then(() => {
                    this.fadeIn();
                }).catch(() => {});
            } else {
                this.audio.volume = this.targetVolume;
            }
        }
        return this.isMuted;
    }

    fadeIn() {
        if (this.isMuted) return;
        if (this.fadeInterval) clearInterval(this.fadeInterval);
        
        this.audio.volume = 0;
        this.audio.play().catch(e => console.log("Autoplay blocked"));
        
        let vol = 0;
        this.fadeInterval = setInterval(() => {
            vol += 0.05; // Faster increment
            if (vol >= this.targetVolume) {
                vol = this.targetVolume;
                clearInterval(this.fadeInterval);
            }
            this.audio.volume = vol;
        }, 50); // Faster tick (was 100)
    }

    fadeOut(callback) {
        if (this.fadeInterval) clearInterval(this.fadeInterval);
        if (this.audio.paused) {
            if (callback) callback();
            return;
        }

        let vol = this.audio.volume;
        this.fadeInterval = setInterval(() => {
            vol -= 0.1; // Faster decrement (was 0.05)
            if (vol <= 0) {
                vol = 0;
                this.audio.pause();
                clearInterval(this.fadeInterval);
                if (callback) callback();
            } else {
                this.audio.volume = vol;
            }
        }, 30); // Faster tick (was 50)
    }
}

// Global instance
window.audioManager = new AudioManager();
