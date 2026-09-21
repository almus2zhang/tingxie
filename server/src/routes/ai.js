const express = require('express');
const axios = require('axios');
const multer = require('multer');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const router = express.Router();

const upload = multer({
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
  storage: multer.memoryStorage()
});

const DEFAULT_VISION_MODEL = 'Qwen/Qwen2-VL-72B-Instruct';
const DEFAULT_TEXT_MODEL = 'deepseek-ai/DeepSeek-V3';
const BUILTIN_API_KEY = process.env.SILICONFLOW_API_KEY || '';

/**
 * Resolve effective SiliconFlow API key based on user role and configuration:
 * - Admin: can use explicit custom key, saved key, or fallback to BUILTIN_API_KEY.
 * - Regular user: MUST provide their own personal key. Cannot use or inherit BUILTIN_API_KEY.
 */
function resolveAiKey(req) {
  const user = req.user;
  if (!user) {
    throw { status: 401, message: '请先登录后再使用 AI 功能' };
  }

  // 1. Explicit key in header or request body
  let candidateKey = (req.headers['x-api-key'] || req.body?.apiKey || '').trim();

  // 2. If not provided explicitly, check saved key in app_settings for this user
  if (!candidateKey) {
    const saved = db.prepare("SELECT value FROM app_settings WHERE key = 'ai_key' AND user_id = ?").get(user.id);
    if (saved && saved.value) {
      candidateKey = saved.value.trim();
    }
  }

  const isAdmin = user.role === 'admin';

  if (isAdmin) {
    // Admin can use custom key if provided, or fallback to system built-in key
    if (candidateKey) {
      return candidateKey;
    }
    const systemKey = BUILTIN_API_KEY;
    if (!systemKey) {
      throw { status: 400, message: '系统未配置内置 API Key，请在系统设置中填入您的 SiliconFlow 密钥' };
    }
    return systemKey;
  } else {
    // Regular user: MUST set their own key. Strictly forbidden to use BUILTIN_API_KEY
    if (!candidateKey || candidateKey === BUILTIN_API_KEY) {
      throw {
        status: 400,
        message: '普通用户需配置并使用您个人的硅基流动 (SiliconFlow) API Key，请在系统设置中配置后重试'
      };
    }
    return candidateKey;
  }
}

/**
 * Helper to call SiliconFlow Chat Completions
 */
async function callSiliconFlow(apiKey, messages, model = DEFAULT_VISION_MODEL, responseFormat = null) {
  const url = 'https://api.siliconflow.cn/v1/chat/completions';

  const body = {
    model,
    messages,
    temperature: 0.1,
    max_tokens: 4096,
  };

  if (responseFormat) {
    body.response_format = responseFormat;
  }

  const response = await axios.post(url, body, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  return response.data?.choices?.[0]?.message?.content || '';
}

/**
 * POST /api/ai/recognize-image
 * Accepts image file or base64, calls SiliconFlow Vision model, returns structured word list
 */
router.post('/recognize-image', authRequired, upload.single('image'), async (req, res) => {
  try {
    let apiKey;
    try {
      apiKey = resolveAiKey(req);
    } catch (keyErr) {
      return res.status(keyErr.status || 400).json({ error: keyErr.message || '无效的 API Key' });
    }

    let base64Image = '';
    let mimeType = 'image/jpeg';

    if (req.file) {
      mimeType = req.file.mimetype || 'image/jpeg';
      base64Image = req.file.buffer.toString('base64');
    } else if (req.body.imageBase64) {
      const parts = req.body.imageBase64.split(',');
      if (parts.length === 2) {
        const metaMatch = parts[0].match(/data:(.*?);base64/);
        if (metaMatch) mimeType = metaMatch[1];
        base64Image = parts[1];
      } else {
        base64Image = req.body.imageBase64;
      }
    } else {
      return res.status(400).json({ error: '请上传单词表图片' });
    }

    const customModel = req.body.model || DEFAULT_VISION_MODEL;

    const systemPrompt = `你是一位专业的英文教师和多模态图像识别助手。
你的任务是从用户上传的单词表/书本/笔记照片中，精确提取出所有的英文单词或短语，并结构化输出。
请仔细核对拼写，并提供对应的国际音标、准确中文释义以及地道实用的双语例句。

请务必只输出合法的 JSON 数组，严禁包含任何 Markdown 格式或额外修饰说明，格式如下：
[
  {
    "word": "单词",
    "phonetic": "/音标/",
    "translation": "词性与中文释义，例如：n. 苹果",
    "example": "包含该单词的英文例句",
    "example_cn": "例句的中文翻译"
  }
]`;

    const userMessages = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请识别这张图片中的所有单词列表，提取出每个单词、音标、中文释义和精炼例句，输出标准 JSON 数组：'
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`
            }
          }
        ]
      }
    ];

    const rawResult = await callSiliconFlow(apiKey, userMessages, customModel);

    // Clean potential markdown code blocks
    let cleaned = rawResult.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    let words = [];
    try {
      words = JSON.parse(cleaned);
      if (!Array.isArray(words)) {
        if (words.words && Array.isArray(words.words)) {
          words = words.words;
        } else {
          words = [words];
        }
      }
    } catch (parseErr) {
      console.warn('Direct JSON parse failed, trying regex match:', parseErr.message);
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        words = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('AI 返回的内容未能成功解析为单词列表：' + cleaned.slice(0, 200));
      }
    }

    // Sanitize and format
    const formattedWords = words
      .filter(item => item && item.word && typeof item.word === 'string')
      .map(item => ({
        word: item.word.trim(),
        phonetic: item.phonetic ? item.phonetic.trim() : '',
        translation: item.translation ? item.translation.trim() : '',
        example: item.example ? item.example.trim() : '',
        example_cn: item.example_cn ? item.example_cn.trim() : ''
      }));

    return res.json({
      success: true,
      count: formattedWords.length,
      words: formattedWords
    });

  } catch (err) {
    console.error('SiliconFlow vision recognition error:', err.response?.data || err.message);
    const errorMsg = err.response?.data?.message || err.response?.data?.error?.message || err.message;
    return res.status(500).json({
      error: `AI 识别失败: ${errorMsg}`
    });
  }
});

/**
 * POST /api/ai/enrich-words
 * Enrich raw words with phonetic, translation, and example sentences
 */
router.post('/enrich-words', authRequired, async (req, res) => {
  try {
    let finalApiKey;
    try {
      finalApiKey = resolveAiKey(req);
    } catch (keyErr) {
      return res.status(keyErr.status || 400).json({ error: keyErr.message || '无效的 API Key' });
    }

    const { words } = req.body;

    if (!Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: '请提供待丰富词条列表' });
    }

    const wordListStr = words.map((w, idx) => {
      const item = typeof w === 'string' ? { word: w } : w;
      return `${idx + 1}. ${item.word}${item.translation ? ' - ' + item.translation : ''}`;
    }).join('\n');

    const prompt = `请为以下英文单词补全或优化国际音标、常用中文释义以及一个典型实用的初/中级双语例句。
单词列表：
${wordListStr}

必须严格只返回 JSON 数组，格式如下：
[
  {
    "word": "单词",
    "phonetic": "/音标/",
    "translation": "词性与中文释义",
    "example": "典型英文例句",
    "example_cn": "例句中文翻译"
  }
]`;

    const targetModel = req.body.model || DEFAULT_TEXT_MODEL;

    const raw = await callSiliconFlow(
      finalApiKey,
      [{ role: 'user', content: prompt }],
      targetModel
    );

    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    let enriched = [];
    try {
      enriched = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) enriched = JSON.parse(match[0]);
    }

    return res.json({
      success: true,
      words: enriched
    });
  } catch (err) {
    console.error('Enrich words error:', err.message);
    return res.status(500).json({ error: '词汇补全失败: ' + err.message });
  }
});

module.exports = router;
