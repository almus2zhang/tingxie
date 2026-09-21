const express = require('express');
const axios = require('axios');
const router = express.Router();

// Memory cache for audio buffers to speed up repeated playback
const audioCache = new Map();
const MAX_CACHE_SIZE = 1000;

router.get('/', async (req, res) => {
  const { word, type = '2' } = req.query; // type 1 = UK, 2 = US

  if (!word || typeof word !== 'string') {
    return res.status(400).json({ error: 'Missing word parameter' });
  }

  const cleanText = word.trim();
  const cacheKey = `${cleanText.toLowerCase()}_${type}`;

  if (audioCache.has(cacheKey)) {
    const cached = audioCache.get(cacheKey);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': cached.length,
      'Cache-Control': 'public, max-age=86400',
    });
    return res.send(cached);
  }

  let buffer = null;

  // Normalize speech text: remove '...', brackets, slashes that break TTS
  const speechText = cleanText
    .replace(/\.{2,}/g, ' ')
    .replace(/[()[\]/\\~_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 1. High-Quality Human Voice via Youdao Dictionary (Supports single words, compound words, and idioms)
  if (speechText.length > 0) {
    try {
      const youdaoUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(speechText.toLowerCase())}&type=${type}`;
      const response = await axios.get(youdaoUrl, {
        responseType: 'arraybuffer',
        timeout: 4000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      });
      if (response.data && response.data.length > 500) {
        buffer = Buffer.from(response.data);
      }
    } catch (err) {
      console.warn('Youdao audio failed for word:', speechText, err.message);
    }
  }

  // 2. High-Quality Natural Human Voice via Baidu English TTS (Fast & reliable domestic CDN fallback)
  if (!buffer && speechText.length > 0) {
    try {
      const bUrl = `https://fanyi.baidu.com/gettts?lan=en&text=${encodeURIComponent(speechText)}&spd=3&source=web`;
      const bResponse = await axios.get(bUrl, {
        responseType: 'arraybuffer',
        timeout: 4000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      });
      if (bResponse.data && bResponse.data.length > 500) {
        buffer = Buffer.from(bResponse.data);
      }
    } catch (bErr) {
      console.warn('Baidu TTS failed for text:', speechText, bErr.message);
    }
  }

  // 3. Fallback to Google TTS (for sentences where available)
  if (!buffer && speechText.length > 0) {
    try {
      const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${type === '1' ? 'en-GB' : 'en'}&client=tw-ob&q=${encodeURIComponent(speechText)}`;
      const gResponse = await axios.get(gUrl, {
        responseType: 'arraybuffer',
        timeout: 3000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': 'https://translate.google.com/'
        },
      });
      if (gResponse.data && gResponse.data.length > 500) {
        buffer = Buffer.from(gResponse.data);
      }
    } catch (gErr) {
      // ignore
    }
  }

  if (buffer && buffer.length > 0) {
    if (audioCache.size >= MAX_CACHE_SIZE) {
      const firstKey = audioCache.keys().next().value;
      audioCache.delete(firstKey);
    }
    audioCache.set(cacheKey, buffer);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=86400',
    });
    return res.send(buffer);
  }

  return res.status(502).json({ error: 'Failed to fetch pronunciation audio' });
});

module.exports = router;
