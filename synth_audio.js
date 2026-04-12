/**
 * SynthAudio Library
 * Generates interactive sound using Web Audio API synthesis.
 */
class SynthAudio {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.limiter = null;
        this.isInitialized = false;

        // 1. Melody Banks (Old Synth)
        this.melodies = [
            [261.63, 329.63, 392.00, 523.25, 440.00, 349.23], // Major
            [261.63, 311.13, 392.00, 415.30, 466.16, 523.25], // Minor
            [261.63, 293.66, 329.63, 369.99, 415.30, 466.16]  // Whole Tone
        ];
        this.bankIndex = 0;
        this.noteIndex = 0;
        this.transposition = 1.0;

        // 2. Pentatonic Scale (New Piano)
        this.pentatonic = [
            261.63, 293.66, 329.63, 392.00, 440.00,
            523.25, 587.33, 659.25, 783.99, 880.00, 1046.50
        ];

        const autoInit = () => {
            if (!this.isInitialized) this.init();
            if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
            document.removeEventListener('pointerdown', autoInit);
            document.removeEventListener('keydown', autoInit);
        };
        document.addEventListener('pointerdown', autoInit);
        document.addEventListener('keydown', autoInit);
    }

    init() {
        if (this.isInitialized) return;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.5;
            this.limiter = this.ctx.createDynamicsCompressor();
            this.limiter.threshold.setValueAtTime(-4, this.ctx.currentTime);
            this.masterGain.connect(this.limiter);
            this.limiter.connect(this.ctx.destination);
            this.isInitialized = true;
            this.randomizeMelody();
        } catch (e) {
            console.error(e);
        }
    }

    randomizeMelody() {
        this.bankIndex = Math.floor(Math.random() * this.melodies.length);
        this.noteIndex = Math.floor(Math.random() * this.melodies[this.bankIndex].length);
        this.transposition = Math.pow(1.059463, Math.floor(Math.random() * 13) - 6);
    }

    /**
     * triggerNote (Legacy / Melody Bank)
     */
    triggerNote(pt, volume = 0.1, durationSec = 0.15) {
        if (!this.isInitialized) this.init();
        if (typeof Core !== 'undefined' && !Core.isAudioEnabled) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const now = this.ctx.currentTime;
        const freq = this.melodies[this.bankIndex][this.noteIndex] * this.transposition;
        this.noteIndex = (this.noteIndex + 1) % this.melodies[this.bankIndex].length;

        const panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(Math.max(-0.6, Math.min(0.6, pt.x)), now);
        panner.connect(this.masterGain);

        const vGain = this.ctx.createGain();
        vGain.gain.setValueAtTime(0, now);
        vGain.gain.linearRampToValueAtTime(volume * 1.5, now + 0.01);
        vGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
        vGain.connect(panner);

        this.createOsc(freq, 0.8, 'sine', vGain, now, durationSec);
        this.createOsc(freq, 0.3, 'triangle', vGain, now, durationSec);
    }

    /**
     * triggerPianoNote (New / Pentatonic Crystal Piano)
     */
    triggerPianoNote(pt, volume = 0.1, durationSec = 1.0) {
        if (!this.isInitialized) this.init();
        if (typeof Core !== 'undefined' && !Core.isAudioEnabled) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const now = this.ctx.currentTime;
        const noteIdx = Math.floor(((pt.x + 1) / 2) * this.pentatonic.length);
        const freq = this.pentatonic[Math.max(0, Math.min(this.pentatonic.length - 1, noteIdx))];

        const panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(Math.max(-0.7, Math.min(0.7, pt.x)), now);
        panner.connect(this.masterGain);

        const vGain = this.ctx.createGain();
        vGain.gain.setValueAtTime(0, now);
        vGain.gain.linearRampToValueAtTime(volume * 0.7, now + 0.005);
        vGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
        vGain.connect(panner);

        this.createOsc(freq, 1.0, 'triangle', vGain, now, durationSec);
        this.createOsc(freq * 2, 0.2, 'sine', vGain, now, durationSec);
        this.createOsc(freq * 3, 0.1, 'sine', vGain, now, durationSec);
    }

    createOsc(f, a, type, dest, now, d) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(f, now);
        g.gain.setValueAtTime(a, now);
        o.connect(g); g.connect(dest);
        o.start(now); o.stop(now + d + 0.1);
    }
}

window.synthAudio = new SynthAudio();
