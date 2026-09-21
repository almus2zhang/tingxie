// Pronunciation evaluation and scoring utility

/**
 * Compute Levenshtein distance between two strings
 */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Normalize word for speech comparison
 */
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Evaluate pronunciation accuracy score (0 - 100)
 * @param {string} targetWord 
 * @param {string} spokenText 
 * @param {number} confidence 
 * @returns {{ score: number, level: string, feedback: string, recognized: string }}
 */
export function evaluatePronunciation(targetWord, spokenText, confidence = 0.9) {
  const target = normalize(targetWord);
  const spoken = normalize(spokenText);

  if (!spoken) {
    return {
      score: 0,
      level: 'none',
      feedback: '未检测到清晰声音，请大声朗读。',
      recognized: ''
    };
  }

  // 1. Exact match
  if (target === spoken) {
    const score = Math.min(100, Math.max(90, Math.round(92 + (confidence || 0.85) * 8)));
    return {
      score,
      level: 'perfect',
      feedback: '发音极准！地道纯正，完全吻合！',
      recognized: spokenText
    };
  }

  // 2. Phrase check (if target or spoken has multiple words, e.g. "look up" or "take off")
  const targetTokens = (targetWord || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const spokenTokens = (spokenText || '').toLowerCase().trim().split(/\s+/).filter(Boolean);

  if (targetTokens.length > 1 || spokenTokens.length > 1) {
    let matchedCount = 0;
    for (const tt of targetTokens) {
      const normT = normalize(tt);
      if (spokenTokens.some(st => {
        const normS = normalize(st);
        return normS === normT || (normT.length >= 4 && levenshteinDistance(normT, normS) <= 1);
      })) {
        matchedCount++;
      }
    }
    const ratio = matchedCount / Math.max(targetTokens.length, spokenTokens.length);
    if (ratio >= 0.9) {
      return {
        score: Math.round(88 + ratio * 10),
        level: 'great',
        feedback: '短语发音非常准确！',
        recognized: spokenText
      };
    } else if (ratio >= 0.5) {
      return {
        score: Math.round(45 + ratio * 30),
        level: 'fair',
        feedback: `部分单词读错或遗漏（识别为 "${spokenText}"），请对照原音再试一次。`,
        recognized: spokenText
      };
    } else {
      return {
        score: Math.max(10, Math.round(ratio * 30)),
        level: 'poor',
        feedback: `短语读音不符（识别为 "${spokenText}"），与目标 "${targetWord}" 差异较大。`,
        recognized: spokenText
      };
    }
  }

  // 3. Single word comparison with strict distance checks
  const maxLen = Math.max(target.length, spoken.length);
  const dist = levenshteinDistance(target, spoken);
  const similarity = Math.max(0, 1 - dist / maxLen);

  // Very close: only 1 char difference on medium words (e.g. "apply" for "apple")
  if (dist === 1 && target.length >= 4) {
    const score = Math.round(80 + similarity * 12);
    return {
      score,
      level: 'great',
      feedback: `发音很棒！微小细节（识别为 "${spokenText}"），注意元音与尾音口型。`,
      recognized: spokenText
    };
  }

  // Moderately close: e.g. 2 chars difference on longer words (len >= 6)
  if (dist === 2 && target.length >= 6 && similarity >= 0.65) {
    const score = Math.round(62 + similarity * 15);
    return {
      score,
      level: 'good',
      feedback: `读音较接近（识别为 "${spokenText}"），个别音节不够饱满，多听两遍原音。`,
      recognized: spokenText
    };
  }

  // Fair attempt: similarity around 50%
  if (similarity >= 0.45 && dist <= 3) {
    const score = Math.round(35 + similarity * 25);
    return {
      score,
      level: 'fair',
      feedback: `发音偏差较大（识别为 "${spokenText}"），请跟随原音仔细模仿。`,
      recognized: spokenText
    };
  }

  // Poor / Completely wrong word (e.g. said "banana" for "apple", or said Chinese)
  const lowScore = Math.max(5, Math.min(25, Math.round(similarity * 30)));
  return {
    score: lowScore,
    level: 'poor',
    feedback: `单词读错！识别为 "${spokenText}"，与目标词 "${targetWord}" 完全不符，请重新朗读。`,
    recognized: spokenText
  };
}

/**
 * Estimate syllable count of an English word or phrase
 */
export function estimateSyllables(word) {
  if (!word) return 1;
  const clean = word.toLowerCase().trim().replace(/[^a-z\s]/g, '');
  const words = clean.split(/\s+/).filter(Boolean);
  
  let total = 0;
  for (const w of words) {
    if (w.length <= 3) {
      total += 1;
      continue;
    }
    const vowels = w.match(/[aeiouy]{1,2}/g);
    let count = vowels ? vowels.length : 1;
    if (w.endsWith('e') && !w.endsWith('le') && count > 1) {
      count -= 1;
    }
    if (w.endsWith('ed') && count > 1 && !w.endsWith('ted') && !w.endsWith('ded')) {
      count -= 1;
    }
    total += Math.max(1, count);
  }
  return Math.max(1, total);
}

// Radix-2 Fast Fourier Transform
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const wStepRe = Math.cos(angle);
    const wStepIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextWRe = wRe * wStepRe - wIm * wStepIm;
        wIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nextWRe;
      }
    }
  }
}

function hzToMel(hz) { return 2595 * Math.log10(1 + hz / 700); }
function melToHz(mel) { return 700 * (Math.pow(10, mel / 2595) - 1); }

function getMelFilterbank(numFilters = 20, fftSize = 512, sampleRate = 16000) {
  const minMel = hzToMel(100);
  const maxMel = hzToMel(Math.min(sampleRate / 2, 8000));
  const melPoints = [];
  for (let i = 0; i <= numFilters + 1; i++) {
    melPoints.push(minMel + (maxMel - minMel) * (i / (numFilters + 1)));
  }
  const hzPoints = melPoints.map(melToHz);
  const binPoints = hzPoints.map(hz => Math.floor((fftSize + 1) * hz / sampleRate));

  const filters = [];
  const halfFft = fftSize / 2;
  for (let m = 1; m <= numFilters; m++) {
    const f = new Float32Array(halfFft);
    const left = binPoints[m - 1];
    const center = binPoints[m];
    const right = binPoints[m + 1];
    for (let k = left; k < center && k < halfFft; k++) {
      f[k] = (k - left) / Math.max(1, center - left);
    }
    for (let k = center; k < right && k < halfFft; k++) {
      f[k] = (right - k) / Math.max(1, right - center);
    }
    filters.push(f);
  }
  return filters;
}

export function extractMFCC(pcm, sampleRate = 16000, numCoeffs = 12) {
  const fftSize = 512;
  const hopSize = Math.floor(sampleRate * 0.01); // 10ms
  const frameSize = Math.floor(sampleRate * 0.025); // 25ms
  const numFilters = 20;
  const filters = getMelFilterbank(numFilters, fftSize, sampleRate);

  // 1. Voice Activity Detection (VAD) & trim silence
  let maxAmp = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > maxAmp) maxAmp = a;
  }
  if (maxAmp < 0.02) return [];

  const threshold = Math.max(0.015, maxAmp * 0.08);
  let start = 0;
  let end = pcm.length - 1;
  while (start < pcm.length && Math.abs(pcm[start]) < threshold) start++;
  while (end > start && Math.abs(pcm[end]) < threshold) end--;
  const trimmed = pcm.slice(start, end + 1);
  if (trimmed.length < frameSize) return [];

  // 2. Pre-emphasis
  const pre = new Float32Array(trimmed.length);
  pre[0] = trimmed[0];
  for (let i = 1; i < trimmed.length; i++) {
    pre[i] = trimmed[i] - 0.97 * trimmed[i - 1];
  }

  // 3. Framing & Windowing
  const numFrames = Math.floor((pre.length - frameSize) / hopSize);
  if (numFrames <= 0) return [];

  const frames = [];
  const hamming = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    hamming[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  }

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hopSize;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < frameSize; i++) {
      re[i] = pre[offset + i] * hamming[i];
    }
    fft(re, im);

    // Power spectrum
    const power = new Float32Array(fftSize / 2);
    for (let i = 0; i < fftSize / 2; i++) {
      power[i] = (re[i] * re[i] + im[i] * im[i]) / fftSize;
    }

    // Filterbank energies
    const logEnergies = new Float32Array(numFilters);
    for (let m = 0; m < numFilters; m++) {
      let sum = 0;
      const filter = filters[m];
      for (let k = 0; k < fftSize / 2; k++) {
        sum += power[k] * filter[k];
      }
      logEnergies[m] = Math.log(Math.max(sum, 1e-6));
    }

    // DCT
    const mfcc = new Float32Array(numCoeffs);
    for (let c = 0; c < numCoeffs; c++) {
      let s = 0;
      for (let m = 0; m < numFilters; m++) {
        s += logEnergies[m] * Math.cos((Math.PI * c * (m + 0.5)) / numFilters);
      }
      mfcc[c] = s;
    }
    frames.push(mfcc);
  }

  // 4. Cepstral Mean Subtraction (CMS) to eliminate mic/channel differences
  if (frames.length > 0) {
    const mean = new Float32Array(numCoeffs);
    for (const f of frames) {
      for (let c = 0; c < numCoeffs; c++) mean[c] += f[c];
    }
    for (let c = 0; c < numCoeffs; c++) mean[c] /= frames.length;
    for (const f of frames) {
      for (let c = 0; c < numCoeffs; c++) f[c] -= mean[c];
    }
  }

  return frames;
}

function vectorDistance(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-6) return 1;
  const cosineSim = dot / denom;
  return Math.max(0, 1 - cosineSim);
}

export function computeDTWDistance(seqA, seqB) {
  const n = seqA.length;
  const m = seqB.length;
  if (n === 0 || m === 0) return 999;

  const dtw = Array.from({ length: n + 1 }, () => new Float32Array(m + 1).fill(Infinity));
  dtw[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = vectorDistance(seqA[i - 1], seqB[j - 1]);
      dtw[i][j] = cost + Math.min(dtw[i - 1][j], dtw[i][j - 1], dtw[i - 1][j - 1]);
    }
  }

  return dtw[n][m] / (n + m);
}

/**
 * Direct Audio-to-Audio Acoustic Comparison (真正的人声声学特征直接对比)
 * Compares user's recorded pronunciation against standard dictionary audio using MFCC + DTW
 * @param {Blob} userAudioBlob
 * @param {string} targetWord
 * @param {'us'|'uk'} accent
 * @returns {Promise<{ score: number|null, level: string, feedback: string, dtwDist?: number, isAcousticComparison?: boolean, isSilent?: boolean, isTooShort?: boolean }>}
 */
export async function compareSpeechWithReferenceAudio(userAudioBlob, targetWord, accent = 'us') {
  if (!userAudioBlob || userAudioBlob.size < 1000) {
    return {
      score: 0,
      level: 'none',
      feedback: '未采集到有效声音，请靠近麦克风大声朗读。',
      isSilent: true
    };
  }

  const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!AudioCtx) {
    return {
      score: null,
      level: 'none',
      feedback: '当前浏览器不支持音频解码分析。',
      error: true
    };
  }

  const audioCtx = new AudioCtx();

  // 1. Decode user audio
  let userPcm = null;
  let userSampleRate = 16000;
  try {
    const userArrayBuffer = await userAudioBlob.arrayBuffer();
    const userAudioBuffer = await audioCtx.decodeAudioData(userArrayBuffer);
    if (userAudioBuffer.duration < 0.3) {
      return {
        score: 0,
        level: 'none',
        feedback: '录音时间过短（不足半秒），请朗读完整单词后再点击结束。',
        isTooShort: true
      };
    }
    userPcm = userAudioBuffer.getChannelData(0);
    userSampleRate = userAudioBuffer.sampleRate;
  } catch (err) {
    console.warn('Failed to decode user audio:', err);
    return {
      score: 0,
      level: 'none',
      feedback: '音频解析遇到问题，请重新尝试。',
      error: true
    };
  }

  // 2. Fetch and decode standard reference audio
  let refPcm = null;
  let refSampleRate = 16000;
  try {
    const type = accent === 'uk' ? '1' : '2';
    const refRes = await fetch(`/api/audio?word=${encodeURIComponent(targetWord.trim().toLowerCase())}&type=${type}`);
    if (refRes.ok) {
      const refArrayBuffer = await refRes.arrayBuffer();
      const refAudioBuffer = await audioCtx.decodeAudioData(refArrayBuffer);
      refPcm = refAudioBuffer.getChannelData(0);
      refSampleRate = refAudioBuffer.sampleRate;
    }
  } catch (err) {
    console.warn('Failed to fetch reference audio for comparison:', err);
  }

  if (!refPcm || refPcm.length === 0) {
    return {
      score: null,
      level: 'none',
      feedback: '未获取到标准原音频进行比对，请听原声自评。',
      needsSelfRating: true
    };
  }

  // 3. Extract MFCC features from both user voice and standard voice
  const userMfcc = extractMFCC(userPcm, userSampleRate);
  const refMfcc = extractMFCC(refPcm, refSampleRate);

  if (userMfcc.length === 0 || refMfcc.length === 0) {
    return {
      score: 0,
      level: 'none',
      feedback: '未检测到有效人声音节，请靠近麦克风清晰朗读。',
      isSilent: true
    };
  }

  // 4. Dynamic Time Warping (DTW) alignment & distance
  const dtwDist = computeDTWDistance(userMfcc, refMfcc);

  // Calibrate score from DTW distance
  let score = 0;
  let level = 'poor';
  let feedback = '';

  if (dtwDist <= 0.085) {
    score = Math.min(98, Math.round(90 + (0.085 - dtwDist) * 100));
    level = 'perfect';
    feedback = '声学波形与标准原音高度契合！发音极其纯正地道！';
  } else if (dtwDist <= 0.12) {
    score = Math.min(89, Math.max(78, Math.round(78 + ((0.12 - dtwDist) / 0.035) * 11)));
    level = 'great';
    feedback = '跟读很棒！音节共振峰与原声吻合良好，重音清晰。';
  } else if (dtwDist <= 0.16) {
    score = Math.min(75, Math.max(60, Math.round(60 + ((0.16 - dtwDist) / 0.04) * 15)));
    level = 'good';
    feedback = '发音基本过关，个别元音口型与原声略有偏差，建议多听多模仿。';
  } else if (dtwDist <= 0.22) {
    score = Math.min(55, Math.max(35, Math.round(35 + ((0.22 - dtwDist) / 0.06) * 20)));
    level = 'fair';
    feedback = '声学频谱与原音差异较明显，请对照原音仔细跟读。';
  } else {
    score = Math.max(10, Math.min(25, Math.round(30 - (dtwDist - 0.22) * 50)));
    level = 'poor';
    feedback = '发音与标准原音严重不符（可能读错单词或杂音过多），请重新跟读！';
  }

  return {
    score,
    level,
    feedback,
    dtwDist: Math.round(dtwDist * 1000) / 1000,
    isAcousticComparison: true
  };
}


/**
 * Check current microphone permission status if supported by browser
 * @returns {Promise<'granted'|'prompt'|'denied'|'unknown'>}
 */
export async function checkMicrophonePermission() {
  if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) {
    return 'unknown';
  }
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state; // 'granted', 'prompt', 'denied'
  } catch {
    return 'unknown';
  }
}

/**
 * Request explicit microphone permission from user
 * Triggers standard browser permission dialog
 * @returns {Promise<{ ok: boolean, errorType?: string, message?: string }>}
 */
export async function requestMicrophoneAccess() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return {
      ok: false,
      errorType: 'unsupported',
      message: '当前浏览器不支持麦克风录音，请使用现代浏览器（如 Edge 或 Chrome）。'
    };
  }

  // Check insecure origin (non-localhost HTTP)
  if (typeof window !== 'undefined' && window.location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return {
      ok: false,
      errorType: 'insecure_origin',
      message: '当前正在通过局域网 IP 访问，浏览器安全策略限制了麦克风权限。请在电脑本机通过 http://localhost:1234 打开，或配置 HTTPS。'
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Release tracks after verification
    stream.getTracks().forEach(t => t.stop());
    return { ok: true };
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return {
        ok: false,
        errorType: 'not-allowed',
        message: '麦克风权限被禁止，请点击地址栏左侧 🔒 图标将麦克风设为“允许”。'
      };
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return {
        ok: false,
        errorType: 'no-device',
        message: '未检测到可用的麦克风硬件设备，请插入麦克风或检查系统音频输入设置。'
      };
    }
    return {
      ok: false,
      errorType: 'error',
      message: err.message || '麦克风权限获取失败'
    };
  }
}

/**
 * Speech & Audio Recording Engine
 * Combines MediaRecorder (universal local audio recording) + SpeechRecognition (AI transcription)
 */
export class PronunciationRecorder {
  constructor(options = {}) {
    this.accent = options.accent || 'us';
    this.recognition = null;
    this.mediaRecorder = null;
    this.audioStream = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.recordedAudioUrl = null;
    this.recordedBlob = null;
    this.recognizedTranscript = '';
    this.recognizedConfidence = 0.85;
    this.recognitionError = null;
    this.autoStopTimer = null;

    this.initRecognition();
  }

  initRecognition() {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('SpeechRecognition API is not supported in this browser.');
      return;
    }

    try {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.maxAlternatives = 3;
      this.recognition.lang = this.accent === 'uk' ? 'en-GB' : 'en-US';
    } catch (e) {
      console.warn('Failed to initialize SpeechRecognition:', e);
    }
  }

  setAccent(accent) {
    this.accent = accent;
    if (this.recognition) {
      this.recognition.lang = accent === 'uk' ? 'en-GB' : 'en-US';
    }
  }

  /**
   * Start recording audio and speech recognition simultaneously
   * @param {Function} onComplete ({ transcript, confidence, audioUrl, audioBlob, recognitionError }) => void
   * @param {Function} onError (err) => void
   */
  async start(onComplete, onError) {
    this.stop(); // Stop any existing recording session

    this.audioChunks = [];
    this.recordedAudioUrl = null;
    this.recordedBlob = null;
    this.recognizedTranscript = '';
    this.recognizedConfidence = 0.85;
    this.recognitionError = null;

    // 1. Request microphone access via getUserMedia
    let stream = null;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('当前浏览器不支持麦克风录音，请使用 Edge 或 Chrome 浏览器。');
      }

      // Check insecure HTTP origin
      if (window.location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        const msg = '当前使用局域网 IP 访问，浏览器限制了麦克风权限。请在电脑本机通过 http://localhost:1234 打开，或配置 HTTPS。';
        const err = new Error(msg);
        err.errorType = 'insecure_origin';
        throw err;
      }

      stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      this.audioStream = stream;
    } catch (err) {
      const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      const isNoDevice = err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError';
      const customErr = new Error(
        isDenied
          ? '浏览器麦克风权限被禁止，请点击地址栏左侧 🔒 锁头或设置图标允许使用麦克风。'
          : isNoDevice
          ? '未检测到麦克风设备，请检查是否已接入麦克风。'
          : err.message || '麦克风启动失败'
      );
      customErr.errorType = isDenied ? 'not-allowed' : isNoDevice ? 'no-device' : (err.errorType || 'error');
      onError?.(customErr);
      return;
    }

    this.isRecording = true;

    // 2. Start MediaRecorder to capture audio for playback & comparison
    try {
      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
          mimeType = 'audio/ogg';
        }
      }

      const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      this.mediaRecorder = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (this.audioChunks.length > 0) {
          const blobType = mimeType || 'audio/webm';
          const blob = new Blob(this.audioChunks, { type: blobType });
          this.recordedBlob = blob;
          this.recordedAudioUrl = URL.createObjectURL(blob);
        }

        // Cleanup stream tracks
        if (this.audioStream) {
          this.audioStream.getTracks().forEach(t => t.stop());
          this.audioStream = null;
        }

        onComplete?.({
          transcript: this.recognizedTranscript,
          confidence: this.recognizedConfidence,
          audioUrl: this.recordedAudioUrl,
          audioBlob: this.recordedBlob,
          recognitionError: this.recognitionError
        });
      };

      mediaRecorder.start(100); // chunk every 100ms
    } catch (e) {
      console.warn('MediaRecorder could not start:', e);
    }

    // 3. Start SpeechRecognition if available
    if (this.recognition) {
      this.recognition.onresult = (event) => {
        if (event.results && event.results[0]) {
          const topResult = event.results[0][0];
          this.recognizedTranscript = topResult.transcript || '';
          this.recognizedConfidence = topResult.confidence || 0.88;
        }
      };

      this.recognition.onerror = (event) => {
        console.warn('SpeechRecognition error:', event.error);
        this.recognitionError = event.error;
        // Do not abort MediaRecorder; user microphone recording is still active!
      };

      this.recognition.onend = () => {
        // NOTE: Do NOT automatically stop MediaRecorder here!
        // In Chrome, SpeechRecognition might fail immediately (~50ms network/service error) and trigger onend.
        // MediaRecorder must keep recording the user's voice until the user clicks stop or the timer expires.
      };

      try {
        this.recognition.start();
      } catch (e) {
        console.warn('SpeechRecognition start error:', e);
        this.recognitionError = e.message;
      }
    }

    // Auto-stop timeout after 5.5 seconds
    this.autoStopTimer = setTimeout(() => {
      if (this.isRecording) {
        this.stop();
      }
    }, 5500);
  }

  stop() {
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }

    if (!this.isRecording) return;
    this.isRecording = false;

    // Stop recognition
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }

    // Stop MediaRecorder
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        console.warn('Error stopping MediaRecorder:', e);
      }
    } else if (this.audioStream) {
      this.audioStream.getTracks().forEach(t => t.stop());
      this.audioStream = null;
    }
  }
}
