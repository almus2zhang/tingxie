const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const router = express.Router();
const db = require('../db');

const { getLocalDateString, getValidActiveDate } = require('../dateHelper');

// Helper: Determine effective target date
// Priority: 1. explicit query/body param -> 2. user-configured active_date in app_settings (if not expired) -> 3. local today
function getEffectiveTargetDate(req) {
  if (req?.query?.date) return req.query.date;
  if (req?.body?.date) return req.body.date;

  try {
    const adminUser = db.prepare('SELECT id FROM users WHERE role = ? ORDER BY id ASC LIMIT 1').get('admin');
    const validDate = getValidActiveDate(adminUser?.id || null);
    if (validDate) {
      return validDate;
    }
  } catch (e) {
    // ignore
  }

  return getLocalDateString();
}

// Helper: Get admin user id
function getAdminUserId() {
  try {
    const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").get()
      || db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get();
    return adminUser?.id || null;
  } catch (e) {
    return null;
  }
}

// In-memory deduplication map for HA playback recording (3 minutes cooldown per word within session)
const recentHaPlaybacks = new Map(); // word_id -> timestamp
const HA_PLAYBACK_DEDUPE_MS = 180000;

function recordHaPlayback(word, source = 'ha_stream') {
  if (!word || !word.id) return null;
  const now = Date.now();

  const lastTime = recentHaPlaybacks.get(word.id);
  if (lastTime && (now - lastTime < HA_PLAYBACK_DEDUPE_MS)) {
    return null;
  }

  const adminId = getAdminUserId();
  try {
    const res = db.prepare(`
      INSERT INTO records (word_id, mode, is_correct, user_input, score, user_id)
      VALUES (?, 'dictation', 1, 'ha_playback', 100, ?)
    `).run(word.id, adminId);

    recentHaPlaybacks.set(word.id, now);
    // Cleanup old entries (> 10 mins)
    for (const [wId, t] of recentHaPlaybacks.entries()) {
      if (now - t > 600000) {
        recentHaPlaybacks.delete(wId);
      }
    }
    return res.lastInsertRowid;
  } catch (err) {
    console.error('Failed to record HA dictation playback:', err);
    return null;
  }
}

// In-memory session state for Home Assistant playback
const haSession = {
  date: null,
  words: null,
  isShuffle: false,
  currentIndex: 0,
  lastAction: 'init',
  updatedAt: new Date().toISOString(),
};

function invalidateHaSession(date = null) {
  if (!date || haSession.date === date) {
    haSession.words = null;
    haSession.date = null;
    haSession.currentIndex = 0;
    recentHaPlaybacks.clear();
  }
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Synchronize in-memory haSession with the latest SQLite database records
function syncHaSession(date, rawWords, shouldShuffle, action = null) {
  const dateChanged = date !== haSession.date;
  const shuffleChanged = haSession.isShuffle !== shouldShuffle;
  const needsFullReset = dateChanged || shuffleChanged || !haSession.words || action === 'reset';

  if (needsFullReset) {
    haSession.date = date;
    haSession.isShuffle = shouldShuffle;
    haSession.words = shouldShuffle ? shuffleArray(rawWords) : [...rawWords];
    haSession.currentIndex = 0;
    return;
  }

  // Same date and shuffle mode: dynamically reflect any added/removed/updated words in the database
  if (!shouldShuffle) {
    // Sequential mode: always match latest rawWords practical order
    haSession.words = [...rawWords];
  } else {
    // Shuffle mode:
    // 1. Remove words that are no longer in rawWords
    const rawIdsSet = new Set(rawWords.map(w => w.id));
    const keptWords = (haSession.words || []).filter(w => rawIdsSet.has(w.id));

    // 2. Add words that were newly added to rawWords
    const keptIdsSet = new Set(keptWords.map(w => w.id));
    const newWords = rawWords.filter(w => !keptIdsSet.has(w.id));

    if (newWords.length > 0) {
      haSession.words = [...keptWords, ...shuffleArray(newWords)];
    } else {
      haSession.words = keptWords;
    }

    if (haSession.words.length === 0 && rawWords.length > 0) {
      haSession.words = shuffleArray(rawWords);
    }
  }

  // Refresh properties (mistake_count, translation, example, etc.) from latest rawWords
  const rawMap = new Map(rawWords.map(w => [w.id, w]));
  haSession.words = haSession.words.map(w => rawMap.get(w.id) || w);

  // Safely clamp currentIndex
  if (haSession.currentIndex >= haSession.words.length) {
    haSession.currentIndex = Math.max(0, haSession.words.length - 1);
  }
}

// Helper: Get words for a given date from daily_plans or fallback to default words
function getWordsForSession(targetDate) {
  const dateStr = targetDate || getEffectiveTargetDate();
  const adminUser = db.prepare('SELECT id FROM users WHERE role = ? ORDER BY id ASC LIMIT 1').get('admin');
  const adminId = adminUser?.id || null;
  
  // 1. Prioritize daily_plans for this specific date (当日日历计划, 优先管理员日历或第一位用户的日历)
  let words = db.prepare(`
    SELECT w.*, dp.sort_order, COALESCE(uwm.mistake_count, 0) as mistake_count
    FROM words w
    JOIN daily_plans dp ON w.id = dp.word_id
    LEFT JOIN user_word_mistakes uwm ON uwm.word_id = w.id AND uwm.user_id = ?
    WHERE dp.plan_date = ? AND (dp.user_id IS ? OR dp.user_id = ?)
    ORDER BY dp.sort_order ASC, dp.created_at ASC
  `).all(adminId, dateStr, adminId, adminId);

  // If no words found for admin, try any daily_plans on that date
  if (words.length === 0) {
    words = db.prepare(`
      SELECT w.*, dp.sort_order, COALESCE(uwm.mistake_count, 0) as mistake_count
      FROM words w
      JOIN daily_plans dp ON w.id = dp.word_id
      LEFT JOIN user_word_mistakes uwm ON uwm.word_id = w.id AND uwm.user_id = ?
      WHERE dp.plan_date = ?
      ORDER BY dp.sort_order ASC, dp.created_at ASC
    `).all(adminId, dateStr);
  }

  const isFromDailyPlan = words.length > 0;

  // 2. If no words planned for today in daily_plans, fallback to the first list or all words
  if (words.length === 0) {
    words = db.prepare(`
      SELECT w.*, lw.sort_order, COALESCE(uwm.mistake_count, 0) as mistake_count
      FROM words w
      JOIN list_words lw ON w.id = lw.word_id
      LEFT JOIN user_word_mistakes uwm ON uwm.word_id = w.id AND uwm.user_id = ?
      WHERE lw.list_id = (SELECT id FROM lists ORDER BY created_at ASC LIMIT 1)
      ORDER BY lw.sort_order ASC
      LIMIT 50
    `).all(adminId);
  }

  // 3. Absolute fallback to master table
  if (words.length === 0) {
    words = db.prepare(`
      SELECT w.*, COALESCE(uwm.mistake_count, 0) as mistake_count
      FROM words w
      LEFT JOIN user_word_mistakes uwm ON uwm.word_id = w.id AND uwm.user_id = ?
      ORDER BY w.created_at ASC, w.id ASC
      LIMIT 50
    `).all(adminId);
  }

  return { date: dateStr, words, isFromDailyPlan };
}

// Helper: Fetch MP3 audio buffer for English word (Youdao human voice first, Google TTS fallback)
const haAudioCache = new Map();
async function fetchWordAudioBuffer(wordText, type = '2') {
  const clean = (wordText || '').trim().toLowerCase();
  const cacheKey = `en_${clean}_${type}`;
  if (haAudioCache.has(cacheKey)) {
    return haAudioCache.get(cacheKey);
  }

  let buffer = null;
  // Try Youdao
  try {
    const u = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(clean)}&type=${type}`;
    const resp = await axios.get(u, {
      responseType: 'arraybuffer',
      timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    buffer = Buffer.from(resp.data);
  } catch (e) {
    // ignore
  }

  // Fallback Google
  if (!buffer) {
    try {
      const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${type === '1' ? 'en-GB' : 'en'}&client=tw-ob&q=${encodeURIComponent(clean)}`;
      const gResp = await axios.get(gUrl, {
        responseType: 'arraybuffer',
        timeout: 6000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      buffer = Buffer.from(gResp.data);
    } catch (e) {
      // ignore
    }
  }

  if (buffer) {
    if (haAudioCache.size >= 500) {
      haAudioCache.delete(haAudioCache.keys().next().value);
    }
    haAudioCache.set(cacheKey, buffer);
  }

  return buffer;
}

// Helper: Split multi-definition translation into distinct phrases
function splitTranslationDefinitions(rawTranslation) {
  if (!rawTranslation) return [];
  let cleaned = rawTranslation
    // 1. remove phonetics /.../
    .replace(/\/.*?\/|\\[.*?]/g, ' ')
    // 2. remove brackets & parentheses
    .replace(/\[.*?\]|\(.*?\)|（.*?）/g, ' ')
    // 3. remove symbols like '&'
    .replace(/&/g, ' ')
    // 4. convert all part of speech tags everywhere (e.g. 'v.', 'n.', 'adj.') into delimiter '；'
    .replace(/\b(n|v|adj|adv|prep|conj|pron|art|num|int|vt|vi)\s*\./gi, '；')
    // 5. convert 2 or more consecutive spaces into delimiter '；' (e.g. '乱扔  垃圾')
    .replace(/\s{2,}/g, '；');

  // 6. Split by all delimiters: semicolon, comma, full stop, newline, etc.
  const parts = cleaned
    .split(/[;；,，、。\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !/^[.&/\s]+$/.test(s));

  return parts.length > 0 ? parts : [rawTranslation.trim()];
}

// Helper: Fetch MP3 audio buffer for Chinese translation/explanation
async function fetchChineseAudioBuffer(chineseText) {
  const clean = (chineseText || '').trim();
  if (!clean) return null;
  const cacheKey = `zh_${clean}`;
  if (haAudioCache.has(cacheKey)) {
    return haAudioCache.get(cacheKey);
  }

  let buffer = null;
  // Try Google TTS for natural Chinese phrase reading
  try {
    const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=zh-CN&client=tw-ob&q=${encodeURIComponent(clean)}`;
    const gResp = await axios.get(gUrl, {
      responseType: 'arraybuffer',
      timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    buffer = Buffer.from(gResp.data);
  } catch (e) {
    // ignore
  }

  // Fallback to Youdao single word/term
  if (!buffer) {
    try {
      const u = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(clean)}&le=zh`;
      const resp = await axios.get(u, {
        responseType: 'arraybuffer',
        timeout: 6000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      buffer = Buffer.from(resp.data);
    } catch (e) {
      // ignore
    }
  }

  if (buffer) {
    if (haAudioCache.size >= 500) {
      haAudioCache.delete(haAudioCache.keys().next().value);
    }
    haAudioCache.set(cacheKey, buffer);
  }

  return buffer;
}

// Helper: Concatenate audio buffers with distinct silence pauses using ffmpeg
// buffersWithPauses: Array of { buffer: Buffer, pauseAfterSec: number }
async function concatAudioBuffersFfmpeg(buffersWithPauses) {
  if (!buffersWithPauses || buffersWithPauses.length === 0) return null;
  if (buffersWithPauses.length === 1) return buffersWithPauses[0].buffer;

  const tmpDir = os.tmpdir();
  const tmpFiles = [];
  try {
    for (let i = 0; i < buffersWithPauses.length; i++) {
      const p = path.join(tmpDir, `tingxie_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${i}.mp3`);
      fs.writeFileSync(p, buffersWithPauses[i].buffer);
      tmpFiles.push({ path: p, pauseAfterSec: buffersWithPauses[i].pauseAfterSec || 0 });
    }

    const args = [];
    let filterComplex = '';
    let streamIdx = 0;
    const concatStreams = [];

    for (let i = 0; i < tmpFiles.length; i++) {
      args.push('-i', tmpFiles[i].path);
      filterComplex += `[${streamIdx}:a]aformat=sample_rates=44100:channel_layouts=mono[a${streamIdx}];`;
      concatStreams.push(`[a${streamIdx}]`);
      streamIdx++;

      if (tmpFiles[i].pauseAfterSec > 0 && i < tmpFiles.length - 1) {
        args.push('-f', 'lavfi', '-t', String(tmpFiles[i].pauseAfterSec), '-i', 'anullsrc=r=44100:cl=mono');
        filterComplex += `[${streamIdx}:a]aformat=sample_rates=44100:channel_layouts=mono[a${streamIdx}];`;
        concatStreams.push(`[a${streamIdx}]`);
        streamIdx++;
      }
    }

    filterComplex += concatStreams.join('') + `concat=n=${concatStreams.length}:v=0:a=1[out]`;
    args.push('-filter_complex', filterComplex, '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'pipe:1');

    const ff = spawn('ffmpeg', args);
    const chunks = [];
    ff.stdout.on('data', c => chunks.push(c));
    return await new Promise((resolve, reject) => {
      ff.on('close', code => {
        tmpFiles.forEach(f => { try { fs.unlinkSync(f.path); } catch(e){} });
        if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
        else reject(new Error('ffmpeg concat code ' + code));
      });
      ff.on('error', err => {
        tmpFiles.forEach(f => { try { fs.unlinkSync(f.path); } catch(e){} });
        reject(err);
      });
    });
  } catch (err) {
    tmpFiles.forEach(f => { try { fs.unlinkSync(f.path); } catch(e){} });
    console.warn('ffmpeg concat error, fallbacking to simple concat:', err.message);
    return Buffer.concat(buffersWithPauses.map(b => b.buffer));
  }
}

// Helper: Fetch combined Word + Explanation audio (with generous pause between multiple definitions)
async function fetchWordWithExplanationBuffer(wordObj, type = '2') {
  if (!wordObj) return null;
  const word = (wordObj.word || '').trim();
  const rawTranslation = (wordObj.translation || '').trim();
  const definitions = splitTranslationDefinitions(rawTranslation);
  const cacheKey = `combo_${word}_${definitions.join('_')}_${type}`;
  if (haAudioCache.has(cacheKey)) {
    return haAudioCache.get(cacheKey);
  }

  const enBuf = await fetchWordAudioBuffer(word, type);
  
  // Fetch Chinese audio for each definition
  const zhAudioBuffers = [];
  for (const def of definitions) {
    const zhBuf = await fetchChineseAudioBuffer(def);
    if (zhBuf) zhAudioBuffers.push(zhBuf);
  }

  const buffersWithPauses = [];
  if (enBuf) {
    // 0.7s pause between English word and first Chinese meaning
    buffersWithPauses.push({ buffer: enBuf, pauseAfterSec: 0.7 });
  }

  // Add each definition with an extended 1.0s pause between multiple definitions!
  for (let i = 0; i < zhAudioBuffers.length; i++) {
    const isLast = i === zhAudioBuffers.length - 1;
    // 1.0s distinct pause between different Chinese definitions for maximum clarity
    buffersWithPauses.push({ buffer: zhAudioBuffers[i], pauseAfterSec: isLast ? 0 : 1.0 });
  }

  let combined = null;
  if (buffersWithPauses.length > 0) {
    combined = await concatAudioBuffersFfmpeg(buffersWithPauses);
  }

  if (combined) {
    if (haAudioCache.size >= 500) {
      haAudioCache.delete(haAudioCache.keys().next().value);
    }
    haAudioCache.set(cacheKey, combined);
  }

  return combined;
}

// Helper: Get audio duration in seconds using ffmpeg
const haDurationCache = new Map();
function getAudioDurationSeconds(buffer) {
  return new Promise((resolve) => {
    if (!buffer || buffer.length === 0) return resolve(0);
    try {
      const ff = spawn('ffmpeg', ['-i', 'pipe:0', '-f', 'null', '-']);
      let stderr = '';
      ff.stderr.on('data', d => stderr += d);
      ff.on('error', () => resolve(0));
      ff.on('close', () => {
        const matches = [...stderr.matchAll(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/g)];
        if (matches.length > 0) {
          const last = matches[matches.length - 1];
          const sec = parseFloat(last[1]) * 3600 + parseFloat(last[2]) * 60 + parseFloat(last[3]);
          return resolve(Math.round(sec * 100) / 100);
        }
        resolve(0);
      });
      ff.stdio[0].write(buffer);
      ff.stdio[0].end();
    } catch (e) {
      resolve(0);
    }
  });
}

// Format session response object
async function formatSessionResponse(req, date, words, index, actionName = 'status', isFromDailyPlan = false) {
  const total = words.length;
  const safeIndex = total > 0 ? Math.max(0, Math.min(index, total - 1)) : 0;
  const curWord = total > 0 ? words[safeIndex] : null;

  const host = req.get('host') || 'localhost:1234';
  const protocol = req.protocol || 'http';
  const baseUrl = `${protocol}://${host}`;

  // Pre-calculate / cache durations for current word
  let duration = 0;
  let durationExplain = 0;
  if (curWord) {
    const enKey = `dur_en_${curWord.word}`;
    if (haDurationCache.has(enKey)) {
      duration = haDurationCache.get(enKey);
    } else {
      const enBuf = await fetchWordAudioBuffer(curWord.word);
      if (enBuf) {
        duration = await getAudioDurationSeconds(enBuf);
        haDurationCache.set(enKey, duration);
      }
    }

    const expKey = `dur_exp_${curWord.word}_${curWord.translation}`;
    if (haDurationCache.has(expKey)) {
      durationExplain = haDurationCache.get(expKey);
    } else {
      const expBuf = await fetchWordWithExplanationBuffer(curWord);
      if (expBuf) {
        durationExplain = await getAudioDurationSeconds(expBuf);
        haDurationCache.set(expKey, durationExplain);
      }
    }
  }

  // Recommended delay seconds: audio duration + 0.5s network buffer margin
  const delaySeconds = duration > 0 ? Math.ceil(duration + 0.5) : 3;
  const delayExplainSeconds = durationExplain > 0 ? Math.ceil(durationExplain + 0.5) : 4;

  let planTitle = '';
  try {
    const meta = db.prepare('SELECT title FROM daily_plan_meta WHERE plan_date = ?').get(date);
    if (meta && meta.title) planTitle = meta.title;
  } catch (e) {}

  const curMistakeCount = curWord?.mistake_count || 0;
  const isMistake = curMistakeCount > 0;

  let ttsText = curWord ? `${curWord.word}，${curWord.translation}` : '暂无单词';
  let message = '';
  if (actionName === 'mistake' || actionName === 'mark_mistake') {
    ttsText = curWord ? `已将 ${curWord.word} 标记为易错词，累计错误 ${curMistakeCount} 次` : '暂无单词';
    message = curWord ? `已将【${curWord.word}】标记为易错词 (累计 ${curMistakeCount} 次)` : '';
  } else if (actionName === 'unmark_mistake') {
    ttsText = curWord ? `已取消 ${curWord.word} 的易错标记` : '暂无单词';
    message = curWord ? `已取消【${curWord.word}】的易错标记` : '';
  } else if (actionName === 'toggle_mistake') {
    ttsText = curWord ? (isMistake ? `已标记 ${curWord.word} 为易错词` : `已取消 ${curWord.word} 的易错标记`) : '暂无单词';
    message = curWord ? (isMistake ? `已将【${curWord.word}】标记为易错词` : `已取消【${curWord.word}】的易错标记`) : '';
  }

  return {
    success: true,
    action: actionName,
    message,
    date,
    title: planTitle,
    isFromDailyPlan,
    source: isFromDailyPlan ? 'calendar_daily_plan' : 'fallback_library',
    is_shuffle: Boolean(haSession.isShuffle),
    order_mode: haSession.isShuffle ? 'random' : 'sequential',
    index: safeIndex,
    humanIndex: safeIndex + 1,
    total,
    isFirst: safeIndex === 0,
    isLast: safeIndex >= total - 1,
    word: curWord ? {
      id: curWord.id,
      word: curWord.word,
      phonetic: curWord.phonetic || '',
      translation: curWord.translation || '',
      example: curWord.example || '',
      example_cn: curWord.example_cn || '',
      mistake_count: curMistakeCount,
      is_mistake: isMistake,
    } : null,
    marked_mistake: isMistake,
    // Duration metrics for Home Assistant automation delay
    duration,
    duration_ms: Math.round(duration * 1000),
    delay_seconds: delaySeconds,
    duration_explain: durationExplain,
    duration_explain_ms: Math.round(durationExplain * 1000),
    delay_explain_seconds: delayExplainSeconds,
    audio_url: `${baseUrl}/api/ha/audio`,
    next_audio_url: `${baseUrl}/api/ha/audio?action=next`,
    prev_audio_url: `${baseUrl}/api/ha/audio?action=prev`,
    repeat_audio_url: `${baseUrl}/api/ha/audio?action=repeat`,
    mistake_audio_url: `${baseUrl}/api/ha/audio?action=mistake`,
    mark_mistake_url: `${baseUrl}/api/ha/mistake`,
    unmark_mistake_url: `${baseUrl}/api/ha/unmark-mistake`,
    toggle_mistake_url: `${baseUrl}/api/ha/toggle-mistake`,
    audio_explain_url: `${baseUrl}/api/ha/audio/explain`,
    next_audio_explain_url: `${baseUrl}/api/ha/audio/explain?action=next`,
    prev_audio_explain_url: `${baseUrl}/api/ha/audio/explain?action=prev`,
    repeat_audio_explain_url: `${baseUrl}/api/ha/audio/explain?action=repeat`,
    mistake_audio_explain_url: `${baseUrl}/api/ha/audio/explain?action=mistake`,
    tts_text: ttsText,
    updatedAt: new Date().toISOString(),
  };
}

// Controller logic for status / next / prev / repeat / mistake
async function handleSessionAction(req, res, action) {
  const targetDate = getEffectiveTargetDate(req);
  const { date, words: rawWords, isFromDailyPlan } = getWordsForSession(targetDate);

  let dateShuffle = false;
  try {
    const meta = db.prepare('SELECT is_shuffle FROM daily_plan_meta WHERE plan_date = ?').get(date);
    dateShuffle = meta?.is_shuffle === 1;
  } catch (e) {}

  const hasExplicitShuffleParam = req.query.shuffle !== undefined || req.query.random !== undefined || req.body?.shuffle !== undefined || req.body?.random !== undefined;
  const shouldShuffle = hasExplicitShuffleParam
    ? (req.query.shuffle === '1' || req.query.random === '1' || req.body?.shuffle === true || req.body?.random === true)
    : dateShuffle;

  // Dynamically sync session with latest database state
  syncHaSession(date, rawWords, shouldShuffle, action);

  const words = haSession.words && haSession.words.length > 0 ? haSession.words : rawWords;
  const total = words.length;

  if (action === 'next') {
    if (haSession.currentIndex < total - 1) {
      haSession.currentIndex += 1;
    } else {
      haSession.currentIndex = 0;
      if (shouldShuffle) {
        haSession.words = shuffleArray(rawWords);
      }
    }
  } else if (action === 'prev') {
    if (haSession.currentIndex > 0) {
      haSession.currentIndex -= 1;
    } else {
      haSession.currentIndex = Math.max(0, total - 1);
    }
  } else if (action === 'repeat' || action === 'current') {
    // Keep current index
  } else if (action === 'reset') {
    haSession.currentIndex = 0;
    recentHaPlaybacks.clear();
  } else if (action === 'mistake' || action === 'mark_mistake') {
    const curWord = words[haSession.currentIndex];
    if (curWord) {
      const delta = req.body?.delta !== undefined ? parseInt(req.body.delta, 10) : (req.query?.delta ? parseInt(req.query.delta, 10) : 1);
      const newCount = Math.max(1, (curWord.mistake_count || 0) + delta);
      const haUserId = getAdminUserId();
      if (haUserId) {
        db.prepare(`
          INSERT INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, word_id) DO UPDATE SET
            mistake_count = excluded.mistake_count,
            updated_at = CURRENT_TIMESTAMP
        `).run(haUserId, curWord.id, newCount);

        try {
          const recent = db.prepare(`
            SELECT id FROM records 
            WHERE word_id = ? AND user_id = ? AND mode = 'dictation' AND created_at >= datetime('now', '-15 minutes')
            ORDER BY id DESC LIMIT 1
          `).get(curWord.id, haUserId);

          if (recent) {
            db.prepare("UPDATE records SET is_correct = 0, user_input = 'ha_mistake', score = 0 WHERE id = ?").run(recent.id);
          } else {
            db.prepare("INSERT INTO records (word_id, mode, is_correct, user_input, score, user_id) VALUES (?, 'dictation', 0, 'ha_mistake', 0, ?)").run(curWord.id, haUserId);
          }
        } catch (e) {
          console.error('Error updating HA mistake record:', e);
        }
      }
      curWord.mistake_count = newCount;
    }
  } else if (action === 'unmark_mistake' || action === 'reset_mistake') {
    const curWord = words[haSession.currentIndex];
    if (curWord) {
      const haUserId = getAdminUserId();
      if (haUserId) {
        db.prepare(`
          INSERT INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
          VALUES (?, ?, 0, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, word_id) DO UPDATE SET
            mistake_count = 0,
            updated_at = CURRENT_TIMESTAMP
        `).run(haUserId, curWord.id);

        try {
          const recent = db.prepare(`
            SELECT id FROM records 
            WHERE word_id = ? AND user_id = ? AND mode = 'dictation' AND created_at >= datetime('now', '-15 minutes')
            ORDER BY id DESC LIMIT 1
          `).get(curWord.id, haUserId);

          if (recent) {
            db.prepare("UPDATE records SET is_correct = 1, user_input = 'ha_playback', score = 100 WHERE id = ?").run(recent.id);
          }
        } catch (e) {}
      }
      curWord.mistake_count = 0;
    }
  } else if (action === 'toggle_mistake') {
    const curWord = words[haSession.currentIndex];
    if (curWord) {
      const isMistake = (curWord.mistake_count || 0) > 0;
      const newCount = isMistake ? 0 : 1;
      const haUserId = getAdminUserId();
      if (haUserId) {
        db.prepare(`
          INSERT INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, word_id) DO UPDATE SET
            mistake_count = excluded.mistake_count,
            updated_at = CURRENT_TIMESTAMP
        `).run(haUserId, curWord.id, newCount);

        try {
          const recent = db.prepare(`
            SELECT id FROM records 
            WHERE word_id = ? AND user_id = ? AND mode = 'dictation' AND created_at >= datetime('now', '-15 minutes')
            ORDER BY id DESC LIMIT 1
          `).get(curWord.id, haUserId);

          if (newCount > 0) {
            if (recent) {
              db.prepare("UPDATE records SET is_correct = 0, user_input = 'ha_mistake', score = 0 WHERE id = ?").run(recent.id);
            } else {
              db.prepare("INSERT INTO records (word_id, mode, is_correct, user_input, score, user_id) VALUES (?, 'dictation', 0, 'ha_mistake', 0, ?)").run(curWord.id, haUserId);
            }
          } else {
            if (recent) {
              db.prepare("UPDATE records SET is_correct = 1, user_input = 'ha_playback', score = 100 WHERE id = ?").run(recent.id);
            }
          }
        } catch (e) {}
      }
      curWord.mistake_count = newCount;
    }
  }

  // Record playback for admin on movement or repeat action
  if (action === 'next' || action === 'prev' || action === 'repeat' || action === 'reset') {
    const targetWord = words[haSession.currentIndex];
    recordHaPlayback(targetWord, action);
  }

  haSession.lastAction = action;
  haSession.updatedAt = new Date().toISOString();

  const responseData = await formatSessionResponse(req, date, words, haSession.currentIndex, action, isFromDailyPlan);
  res.json(responseData);
}

// Routes: Support both GET and POST for maximum Home Assistant & device compatibility

// 1. Current status
router.get('/status', (req, res) => handleSessionAction(req, res, 'status'));
router.post('/status', (req, res) => handleSessionAction(req, res, 'status'));
router.get('/session/current', (req, res) => handleSessionAction(req, res, 'current'));
router.post('/session/current', (req, res) => handleSessionAction(req, res, 'current'));

// 2. Control actions
router.get('/next', (req, res) => handleSessionAction(req, res, 'next'));
router.post('/next', (req, res) => handleSessionAction(req, res, 'next'));

router.get('/prev', (req, res) => handleSessionAction(req, res, 'prev'));
router.post('/prev', (req, res) => handleSessionAction(req, res, 'prev'));

router.get(['/repeat', '/play', '/session/play'], (req, res) => handleSessionAction(req, res, 'repeat'));
router.post(['/repeat', '/play', '/session/play'], (req, res) => handleSessionAction(req, res, 'repeat'));

router.get('/reset', (req, res) => handleSessionAction(req, res, 'reset'));
router.post('/reset', (req, res) => handleSessionAction(req, res, 'reset'));

// 3. Mistake actions (Mark / Unmark / Toggle current word as mistake)
router.get(['/mistake', '/mark-mistake', '/session/mistake'], (req, res) => handleSessionAction(req, res, 'mistake'));
router.post(['/mistake', '/mark-mistake', '/session/mistake'], (req, res) => handleSessionAction(req, res, 'mistake'));

router.get(['/unmark-mistake', '/reset-mistake'], (req, res) => handleSessionAction(req, res, 'unmark_mistake'));
router.post(['/unmark-mistake', '/reset-mistake'], (req, res) => handleSessionAction(req, res, 'unmark_mistake'));

router.get('/toggle-mistake', (req, res) => handleSessionAction(req, res, 'toggle_mistake'));
router.post('/toggle-mistake', (req, res) => handleSessionAction(req, res, 'toggle_mistake'));

// 4. Word List for current session/day (Ideal for ESP32 and other smart hardware)
// GET /api/ha/words or /api/ha/session/words
router.get(['/words', '/session/words'], (req, res) => {
  try {
    const targetDate = getEffectiveTargetDate(req);
    const { date, words: rawWords, isFromDailyPlan } = getWordsForSession(targetDate);

    let dateShuffle = false;
    try {
      const meta = db.prepare('SELECT is_shuffle FROM daily_plan_meta WHERE plan_date = ?').get(date);
      dateShuffle = meta?.is_shuffle === 1;
    } catch (e) {}

    const hasExplicitShuffleParam = req.query.shuffle !== undefined || req.query.random !== undefined;
    const shouldShuffle = hasExplicitShuffleParam
      ? (req.query.shuffle === '1' || req.query.random === '1')
      : dateShuffle;

    syncHaSession(date, rawWords, shouldShuffle, null);

    const words = haSession.words && haSession.words.length > 0 ? haSession.words : rawWords;

    let planTitle = '';
    try {
      const meta = db.prepare('SELECT title FROM daily_plan_meta WHERE plan_date = ?').get(date);
      if (meta && meta.title) planTitle = meta.title;
    } catch (e) {}

    res.json({
      success: true,
      date,
      title: planTitle,
      total: words.length,
      isFromDailyPlan,
      is_shuffle: Boolean(haSession.isShuffle),
      currentIndex: haSession.currentIndex,
      currentWord: words[haSession.currentIndex] || null,
      words: words.map(w => ({
        id: w.id,
        word: w.word,
        phonetic: w.phonetic || '',
        translation: w.translation || '',
        example: w.example || '',
        example_cn: w.example_cn || '',
        mistake_count: w.mistake_count || 0,
        is_mistake: (w.mistake_count || 0) > 0,
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// In-memory action debounce to prevent XiaoAi from triggering multiple next actions during audio buffering/probing
let lastAudioActionTime = 0;
const AUDIO_ACTION_COOLDOWN_MS = 4000;

// Helper: Generic audio streaming handler
async function handleAudioStream(req, res, withExplanation = false) {
  try {
    const { action, type = '2' } = req.query;
    const targetDate = getEffectiveTargetDate(req);
    const { date, words: rawWords } = getWordsForSession(targetDate);

    let dateShuffle = false;
    try {
      const meta = db.prepare('SELECT is_shuffle FROM daily_plan_meta WHERE plan_date = ?').get(date);
      dateShuffle = meta?.is_shuffle === 1;
    } catch (e) {}

    const hasExplicitShuffleParam = req.query.shuffle !== undefined || req.query.random !== undefined;
    const shouldShuffle = hasExplicitShuffleParam
      ? (req.query.shuffle === '1' || req.query.random === '1')
      : dateShuffle;

    // Dynamically sync session with latest database state
    syncHaSession(date, rawWords, shouldShuffle, action);

    const words = haSession.words && haSession.words.length > 0 ? haSession.words : rawWords;
    const total = words.length;

    if (total === 0) {
      return res.status(404).send('No words found');
    }

    // Cooldown check: prevent rapid multi-GET probes from XiaoAi player from advancing multiple words
    const now = Date.now();
    if (action === 'next' || action === 'prev') {
      if (now - lastAudioActionTime > AUDIO_ACTION_COOLDOWN_MS) {
        if (action === 'next') {
          if (haSession.currentIndex < total - 1) {
            haSession.currentIndex += 1;
          } else {
            haSession.currentIndex = 0;
            if (shouldShuffle) {
              haSession.words = shuffleArray(rawWords);
            }
          }
        } else if (action === 'prev') {
          haSession.currentIndex = haSession.currentIndex > 0 ? haSession.currentIndex - 1 : total - 1;
        }
        lastAudioActionTime = now;
      }
    }

    const curWord = words[haSession.currentIndex] || words[0];

    // Check if HTTP Range request is resuming mid-file
    const range = req.headers.range;
    let isRangeResume = false;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      if (start > 0) {
        isRangeResume = true;
      }
    }

    // If requested action is mistake, increment mistake count for the word being played
    if (action === 'mistake' || action === 'mark_mistake') {
      if (curWord) {
        const newCount = Math.max(1, (curWord.mistake_count || 0) + 1);
        const haUserId = getAdminUserId();
        if (haUserId) {
          db.prepare(`
            INSERT INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, word_id) DO UPDATE SET
              mistake_count = excluded.mistake_count,
              updated_at = CURRENT_TIMESTAMP
          `).run(haUserId, curWord.id, newCount);
        }
        db.prepare('UPDATE words SET mistake_count = ? WHERE id = ?').run(newCount, curWord.id);
        try {
          const recent = db.prepare(`
            SELECT id FROM records 
            WHERE word_id = ? AND user_id = ? AND mode = 'dictation' AND created_at >= datetime('now', '-15 minutes')
            ORDER BY id DESC LIMIT 1
          `).get(curWord.id, haUserId);
          if (recent) {
            db.prepare("UPDATE records SET is_correct = 0, user_input = 'ha_mistake', score = 0 WHERE id = ?").run(recent.id);
          } else {
            db.prepare("INSERT INTO records (word_id, mode, is_correct, user_input, score, user_id) VALUES (?, 'dictation', 0, 'ha_mistake', 0, ?)").run(curWord.id, haUserId);
          }
        } catch (e) {}
        curWord.mistake_count = newCount;
      }
    } else if (!isRangeResume) {
      // Normal playback stream: record admin dictation
      recordHaPlayback(curWord, 'stream');
    }
    
    let buffer = null;
    if (withExplanation) {
      buffer = await fetchWordWithExplanationBuffer(curWord, type);
    } else {
      buffer = await fetchWordAudioBuffer(curWord.word, type);
    }

    if (!buffer) {
      return res.status(502).send('Failed to fetch audio for word: ' + curWord.word);
    }

    // Measure or retrieve cached duration
    const durKey = withExplanation ? `dur_exp_${curWord.word}_${curWord.translation}` : `dur_en_${curWord.word}`;
    let duration = haDurationCache.get(durKey) || 0;
    if (!duration) {
      duration = await getAudioDurationSeconds(buffer);
      haDurationCache.set(durKey, duration);
    }
    const delaySec = duration > 0 ? Math.ceil(duration + 0.5) : (withExplanation ? 4 : 3);

    // Support HTTP Range requests and explicitly signal Connection: close to tell XiaoAi the track is complete
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : buffer.length - 1;
      const chunksize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${buffer.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'audio/mpeg',
        'Connection': 'close',
        'X-Current-Word': curWord.word,
        'X-Duration-Seconds': String(duration),
        'X-Delay-Seconds': String(delaySec),
      });
      return res.end(buffer.slice(start, end + 1));
    }

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length,
      'Accept-Ranges': 'bytes',
      'Connection': 'close',
      'X-Current-Word': curWord.word,
      'X-Current-Translation': encodeURIComponent(curWord.translation || ''),
      'X-Current-Index': String(haSession.currentIndex + 1),
      'X-Total-Words': String(total),
      'X-Duration-Seconds': String(duration),
      'X-Delay-Seconds': String(delaySec),
    });

    return res.send(buffer);
  } catch (err) {
    console.error('HA Audio error:', err);
    res.status(500).send(err.message);
  }
}

// 6. Direct Audio Endpoints (Only English Word pronunciation)
// GET /api/ha/audio or /api/ha/audio.mp3
router.get(['/audio', '/audio.mp3'], (req, res) => handleAudioStream(req, res, false));

// 7. Audio with Explanation Endpoints (English Word + Pause + Chinese Translation/Meaning)
// GET /api/ha/audio/explain, /api/ha/audio-explain, /api/ha/audio-explain.mp3
router.get(['/audio/explain', '/audio/explain.mp3', '/audio-explain', '/audio-explain.mp3'], (req, res) => handleAudioStream(req, res, true));

router.invalidateSession = invalidateHaSession;
router.getHaSession = () => haSession;
router.getCurrentWord = () => (haSession.words && haSession.words.length > 0 ? haSession.words[haSession.currentIndex] : null);

module.exports = router;

