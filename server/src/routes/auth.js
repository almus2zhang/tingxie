const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signUserToken, authRequired } = require('../middleware/auth');
const { sendVerificationCodeEmail } = require('../services/mailer');

// Helper to generate 6-digit random code
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * POST /api/auth/send-code
 * Body: { email, type: 'register' }
 */
router.post('/send-code', async (req, res) => {
  try {
    const { email, type = 'register' } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // If type is register, check if email is already registered
    if (type === 'register') {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
      if (existing) {
        return res.status(400).json({ error: '该邮箱已被注册，请直接登录' });
      }
    }

    // Rate limiting: check if last code sent within 60 seconds
    const recent = db.prepare(`
      SELECT created_at FROM email_verifications 
      WHERE email = ? AND type = ? AND created_at > datetime('now', '-60 seconds')
      ORDER BY id DESC LIMIT 1
    `).get(cleanEmail, type);

    if (recent) {
      return res.status(429).json({ error: '验证码发送太频繁，请稍候再试' });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(`
      INSERT INTO email_verifications (email, code, type, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(cleanEmail, code, type, expiresAt);

    // Send email via QQ SMTP
    await sendVerificationCodeEmail(cleanEmail, code, type);

    res.json({ success: true, message: '验证码已发送至您的邮箱，请注意查收' });
  } catch (err) {
    console.error('Send verification code error:', err);
    res.status(500).json({ error: `发送验证码失败: ${err.message}` });
  }
});

/**
 * POST /api/auth/register
 * Body: { email, code, username, password }
 */
router.post('/register', async (req, res) => {
  try {
    const { email, code, username, password } = req.body;

    if (!email || !code || !password) {
      return res.status(400).json({ error: '请完整填写邮箱、验证码与密码' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanCode = code.toString().trim();
    const cleanName = (username || cleanEmail.split('@')[0]).trim();

    if (password.length < 6) {
      return res.status(400).json({ error: '密码长度至少需为 6 位' });
    }

    // Check if already registered
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      return res.status(400).json({ error: '该邮箱已被注册，请直接登录' });
    }

    // Verify code
    const record = db.prepare(`
      SELECT id FROM email_verifications 
      WHERE email = ? AND code = ? AND type = 'register' AND is_used = 0 
        AND expires_at >= datetime('now')
      ORDER BY id DESC LIMIT 1
    `).get(cleanEmail, cleanCode);

    if (!record) {
      return res.status(400).json({ error: '验证码不正确或已过期，请重新获取' });
    }

    // Mark verification as used
    db.prepare('UPDATE email_verifications SET is_used = 1 WHERE id = ?').run(record.id);

    // If first user, make admin, otherwise regular user
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const role = userCount.count === 0 ? 'admin' : 'user';

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const info = db.prepare(`
      INSERT INTO users (email, username, password_hash, role)
      VALUES (?, ?, ?, ?)
    `).run(cleanEmail, cleanName, passwordHash, role);

    const newUser = {
      id: info.lastInsertRowid,
      email: cleanEmail,
      username: cleanName,
      role,
    };

    const token = signUserToken(newUser);

    res.json({
      success: true,
      message: role === 'admin' ? '注册成功！您是系统首个用户，已自动获得管理员权限' : '注册成功！',
      user: newUser,
      token,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: '请输入邮箱与密码' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (!user) {
      return res.status(400).json({ error: '邮箱或密码不正确' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: '邮箱或密码不正确' });
    }

    const userInfo = {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };

    const token = signUserToken(userInfo);

    res.json({
      success: true,
      user: userInfo,
      token,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auth/me
 * Returns current authenticated user info
 */
router.get('/me', authRequired, (req, res) => {
  res.json({
    success: true,
    user: req.user,
  });
});

/**
 * GET /api/auth/settings
 * Returns user-specific settings from app_settings
 */
router.get('/settings', authRequired, (req, res) => {
  try {
    const userId = req.user.id;
    const rows = db.prepare('SELECT key, value FROM app_settings WHERE user_id = ?').all(userId);
    const settings = {};
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    res.json({
      success: true,
      isAdmin: req.user.role === 'admin',
      settings,
    });
  } catch (err) {
    console.error('Get user settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/auth/settings
 * Updates user-specific settings in app_settings
 */
router.put('/settings', authRequired, (req, res) => {
  try {
    const userId = req.user.id;
    const settings = req.body || {};

    const upsert = db.prepare(`
      INSERT INTO app_settings (key, value, user_id, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key, user_id) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `);

    db.transaction(() => {
      for (const [k, v] of Object.entries(settings)) {
        if (typeof k === 'string' && k.length <= 64) {
          upsert.run(k, v === null || v === undefined ? '' : String(v), userId);
        }
      }
    })();

    res.json({ success: true, message: '设置保存成功' });
  } catch (err) {
    console.error('Update user settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
