const express = require('express');
const router = express.Router();
const db = require('../db');
const { adminRequired } = require('../middleware/auth');

// All routes in this router require admin permissions
router.use(adminRequired);

/**
 * GET /api/admin/overview
 * System-wide statistics for admin dashboard:
 * - Registered users count
 * - Private words count, public words count
 * - Private lists count, public lists count
 * - Total dictations count, total memory reviews count
 * - Total pending audit requests count
 */
router.get('/overview', (req, res) => {
  try {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count || 0;
    const privateWordsCount = db.prepare('SELECT COUNT(*) as count FROM words WHERE is_public = 0 AND user_id IS NOT NULL').get()?.count || 0;
    const publicWordsCount = db.prepare('SELECT COUNT(*) as count FROM words WHERE is_public = 1 OR user_id IS NULL').get()?.count || 0;
    const privateListsCount = db.prepare('SELECT COUNT(*) as count FROM lists WHERE (is_public = 0 OR is_public IS NULL) AND user_id IS NOT NULL').get()?.count || 0;
    const publicListsCount = db.prepare('SELECT COUNT(*) as count FROM lists WHERE is_public = 1 OR user_id IS NULL').get()?.count || 0;
    const dictationCount = db.prepare("SELECT COUNT(*) as count FROM records WHERE mode = 'dictation'").get()?.count || 0;
    const memoryCount = db.prepare("SELECT COUNT(*) as count FROM records WHERE mode = 'memory'").get()?.count || 0;
    const pendingAuditCount = db.prepare("SELECT COUNT(*) as count FROM change_requests WHERE status = 'pending'").get()?.count || 0;

    res.json({
      userCount,
      privateWordsCount,
      publicWordsCount,
      privateListsCount,
      publicListsCount,
      dictationCount,
      memoryCount,
      pendingAuditCount
    });
  } catch (err) {
    console.error('Admin overview error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/users
 * Detailed list of registered users with statistics:
 * - id, username, email, role, created_at
 * - private_words_count
 * - private_lists_count
 * - dictation_count, memory_count
 * - last_active_at
 */
router.get('/users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT 
        u.id, 
        u.username, 
        u.email, 
        u.role, 
        u.created_at,
        (SELECT COUNT(*) FROM words w WHERE w.user_id = u.id AND w.is_public = 0) as private_words_count,
        (SELECT COUNT(*) FROM lists l WHERE l.user_id = u.id AND (l.is_public = 0 OR l.is_public IS NULL)) as private_lists_count,
        (SELECT COUNT(*) FROM records r WHERE r.user_id = u.id AND r.mode = 'dictation') as dictation_count,
        (SELECT COUNT(*) FROM records r WHERE r.user_id = u.id AND r.mode = 'memory') as memory_count,
        (SELECT MAX(created_at) FROM records r WHERE r.user_id = u.id) as last_active_at
      FROM users u
      ORDER BY u.id ASC
    `).all();

    res.json(users);
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/records/daily
 * Daily aggregated study stats:
 * - record_date (YYYY-MM-DD)
 * - dictation_count
 * - dictation_correct_count
 * - memory_count
 * - active_users_count
 * - active_users
 */
router.get('/records/daily', (req, res) => {
  try {
    const dailyStats = db.prepare(`
      SELECT 
        date(r.created_at, 'localtime') as record_date,
        COUNT(CASE WHEN r.mode = 'dictation' THEN 1 END) as dictation_count,
        COUNT(CASE WHEN r.mode = 'dictation' AND r.is_correct = 1 THEN 1 END) as dictation_correct_count,
        COUNT(CASE WHEN r.mode = 'memory' THEN 1 END) as memory_count,
        COUNT(r.id) as total_count,
        COUNT(DISTINCT r.user_id) as active_users_count,
        GROUP_CONCAT(DISTINCT COALESCE(u.username, u.email, '未登录')) as active_users
      FROM records r
      LEFT JOIN users u ON u.id = r.user_id
      GROUP BY record_date
      ORDER BY record_date DESC
      LIMIT 60
    `).all();

    res.json(dailyStats);
  } catch (err) {
    console.error('Admin daily records error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/records
 * Detailed log of dictation & memory records:
 * Query params:
 * - date (optional, YYYY-MM-DD)
 * - mode (optional, 'dictation' | 'memory' | 'ha')
 * - userId (optional)
 * - limit (default 100)
 * - offset (default 0)
 */
router.get('/records', (req, res) => {
  try {
    const { date, mode, userId, limit = 100, offset = 0 } = req.query;
    const conditions = [];
    const params = [];

    if (date) {
      conditions.push("date(r.created_at, 'localtime') = ?");
      params.push(date);
    }
    if (mode && mode !== 'all') {
      conditions.push("r.mode = ?");
      params.push(mode);
    }
    if (userId && userId !== 'all') {
      conditions.push("r.user_id = ?");
      params.push(userId);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM records r ${whereClause}`).get(...params);
    const total = countRow?.count || 0;

    const records = db.prepare(`
      SELECT 
        r.id,
        r.word_id,
        r.mode,
        r.is_correct,
        r.user_input,
        r.score,
        r.created_at,
        r.user_id,
        w.word,
        w.phonetic,
        w.translation,
        u.username,
        u.email
      FROM records r
      LEFT JOIN words w ON w.id = r.word_id
      LEFT JOIN users u ON u.id = r.user_id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, Number(limit), Number(offset));

    res.json({
      total,
      records
    });
  } catch (err) {
    console.error('Admin records detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
