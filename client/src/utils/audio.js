// High-quality Audio & Speech playback utility

let currentAudio = null;
let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      audioContext = new AudioCtx();
    }
  }
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

export function getSpeechRate() {
  const saved = localStorage.getItem('speech_rate');
  const parsed = parseFloat(saved);
  return !isNaN(parsed) && parsed > 0 ? parsed : 1.0;
}

export function setSpeechRate(rate) {
  const r = typeof rate === 'number' && !isNaN(rate) && rate > 0 ? rate : 1.0;
  localStorage.setItem('speech_rate', String(r));
}

function resolveRate(speed) {
  if (typeof speed === 'number' && !isNaN(speed) && speed > 0) {
    return speed;
  }
  return getSpeechRate();
}

/**
 * Play authentic human voice pronunciation for a word
 * @param {string} word 
 * @param {'us' | 'uk'} accent 
 * @param {number} [speed] - optional speed override (e.g. 0.75, 1.0, 1.25)
 * @returns {Promise<boolean>}
 */
export function playWordAudio(word, accent = 'us', speed = null) {
  if (!word || typeof word !== 'string' || !word.trim()) return Promise.resolve(false);
  const cleanWord = word.trim().toLowerCase();
  const type = (accent === 'uk' || accent === '1') ? '1' : '2';
  const rate = resolveRate(speed);

  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch (e) {
      // ignore
    }
  }

  return new Promise((resolve) => {
    const audioUrl = `/api/audio?word=${encodeURIComponent(cleanWord)}&type=${type}`;
    const audio = new Audio(audioUrl);
    currentAudio = audio;

    try {
      audio.playbackRate = rate;
      audio.defaultPlaybackRate = rate;
    } catch (err) {
      console.warn('Failed to set playback rate:', err);
    }

    audio.onended = () => {
      resolve(true);
    };

    audio.onerror = () => {
      console.warn('Network audio failed, falling back to Web Speech API:', cleanWord);
      speakWithWebSpeech(cleanWord, accent, rate).then(resolve);
    };

    audio.play().catch((err) => {
      if (err.name === 'AbortError') return;
      console.warn('Audio play prevented or failed:', err);
      speakWithWebSpeech(cleanWord, accent, rate).then(resolve);
    });
  });
}

/**
 * Play example sentence (tries high-quality audio stream first, fallback to Web Speech API)
 * @param {string} sentence 
 * @param {'us' | 'uk'} accent 
 * @param {number} [speed] 
 * @returns {Promise<boolean>}
 */
export function playSentenceAudio(sentence, accent = 'us', speed = null) {
  if (!sentence || typeof sentence !== 'string' || !sentence.trim()) return Promise.resolve(false);
  const cleanText = sentence.trim();
  const type = (accent === 'uk' || accent === '1') ? '1' : '2';
  const rate = resolveRate(speed);

  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch (e) {}
  }

  return new Promise((resolve) => {
    const audioUrl = `/api/audio?word=${encodeURIComponent(cleanText)}&type=${type}`;
    const audio = new Audio(audioUrl);
    currentAudio = audio;

    try {
      audio.playbackRate = rate;
      audio.defaultPlaybackRate = rate;
    } catch (err) {}

    audio.onended = () => resolve(true);

    audio.onerror = () => {
      console.warn('Sentence audio network failed, falling back to Web Speech API:', cleanText);
      speakWithWebSpeech(cleanText, accent, rate).then(resolve);
    };

    audio.play().catch((err) => {
      if (err.name === 'AbortError') return;
      console.warn('Sentence audio play error, falling back:', err);
      speakWithWebSpeech(cleanText, accent, rate).then(resolve);
    });
  });
}

/**
 * Fallback Web Speech synthesis for words or sentences
 */
export function speakWithWebSpeech(text, accent = 'us', speed = null) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve(false);
      return;
    }

    const rate = resolveRate(speed);

    try {
      window.speechSynthesis.cancel();
    } catch (e) {}

    setTimeout(() => {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = accent === 'uk' ? 'en-GB' : 'en-US';
        utterance.rate = Math.max(0.5, Math.min(2.0, rate));

        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
          const voice = voices.find(v => accent === 'uk' ? v.lang.includes('GB') : (v.lang.includes('US') || v.lang.includes('en')));
          if (voice) utterance.voice = voice;
        }

        utterance.onend = () => resolve(true);
        utterance.onerror = (e) => {
          console.warn('SpeechSynthesis error:', e);
          resolve(false);
        };

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('Speech error:', err);
        resolve(false);
      }
    }, 40);
  });
}

/**
 * Pleasant sound effects generated via Web Audio API (Zero latency & 100% reliable)
 */
export function playFeedbackSound(isCorrect) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    if (isCorrect) {
      const freqs = [587.33, 880, 1174.66]; // D5, A5, D6
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.05);

        gain.gain.setValueAtTime(0.12, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6 + idx * 0.05);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.05);
        osc.stop(now + 0.65 + idx * 0.05);
      });
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(130, now + 0.25);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch (e) {
    console.warn('Audio context sound effect error:', e);
  }
}
