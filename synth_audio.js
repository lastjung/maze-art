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

        // Multiple Melody Banks for Variety
        this.melodies = [
            [261.63, 329.63, 392.00, 523.25, 440.00, 349.23], // Major
            [261.63, 311.13, 392.00, 415.30, 466.16, 523.25], // Minor/Phrygian
            [261.63, 293.66, 329.63, 369.99, 415.30, 466.16], // Whole Tone (Dreamy)
            [523.25, 493.88, 440.00, 392.00, 349.23, 329.63]  // Descending
        ];
        this.bankIndex = 0;
        this.noteIndex = 0;
        this.transposition = 1.0;

        // Auto-initialize on first user interaction to bypass autoplay restrictions
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
            this.masterGain.gain.value = 0.9; 

            this.lowPass = this.ctx.createBiquadFilter();
            this.lowPass.type = 'lowpass';
            this.lowPass.frequency.setValueAtTime(6000, this.ctx.currentTime); 

            this.limiter = this.ctx.createDynamicsCompressor();
            this.limiter.threshold.setValueAtTime(-4, this.ctx.currentTime);
            this.limiter.ratio.setValueAtTime(10, this.ctx.currentTime);
            
            this.masterGain.connect(this.lowPass);
            this.lowPass.connect(this.limiter);
            this.limiter.connect(this.ctx.destination);
            
            this.isInitialized = true;
            this.randomizeMelody();
            console.log("SynthAudio (Multi-Bank) initialized");
        } catch (e) {
            console.error("Web Audio API not supported", e);
        }
    }

    randomizeMelody() {
        // 1. Pick a new Melody Bank
        this.bankIndex = Math.floor(Math.random() * this.melodies.length);
        
        // 2. Pick a random start point within that bank
        this.noteIndex = Math.floor(Math.random() * this.melodies[this.bankIndex].length);
        
        // 3. AGGRESSIVE Transposition: +/- 12 semitones (Full Octave)
        const semitones = Math.floor(Math.random() * 25) - 12; 
        this.transposition = Math.pow(1.059463, semitones);
        
        console.log(`Melody Switched: Bank ${this.bankIndex}, Transpose: ${semitones}st`);
    }

    triggerNote(pt, rotX, rotY, volume = 0.1, durationSec = 0.15) {
        if (!this.isInitialized) this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const now = this.ctx.currentTime;
        const melody = this.melodies[this.bankIndex];
        
        // 1. Fixed Melody Selection
        const freq = melody[this.noteIndex] * this.transposition;
        this.noteIndex = (this.noteIndex + 1) % melody.length;

        // 2. Stereo Panning (Subtle)
        const cosY = Math.cos(rotY);
        const sinY = Math.sin(rotY);
        let tx = pt.x * cosY + pt.z * sinY;
        const panValue = Math.max(-0.4, Math.min(0.4, tx * 0.6)); 
        
        const panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(panValue, now);
        panner.connect(this.masterGain);

        // 3. Synthesis (Dynamic length tied to visual speed)
        // If speed is slow, duration is long (sustain). If speed is high, duration is short (pluck).
        const voiceGain = this.ctx.createGain();
        voiceGain.gain.setValueAtTime(0, now);
        // Dramatically increase volume multiplier to make the sound clear and loud
        const peakVolume = Math.min(1.0, volume * 2.5);
        voiceGain.gain.linearRampToValueAtTime(peakVolume, now + Math.min(0.015, durationSec * 0.1)); 
        voiceGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec); // Syncs to the exact next step
        voiceGain.connect(panner);

        // Layering sine (fundamental) and triangle (harmonics) for a fuller, louder sound
        this.createOscillator('sine', freq, 1.0, voiceGain, now, durationSec); 
        this.createOscillator('triangle', freq, 0.4, voiceGain, now, durationSec); 
    }

    createOscillator(type, freq, amp, destination, now, durationSec) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(amp, now);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + durationSec + 0.1); // Stop cleanly after decay
    }
}

window.synthAudio = new SynthAudio();

