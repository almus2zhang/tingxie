const express = require('express');
const router = express.Router();
const db = require('../db');
const { getLocalDateString, getValidActiveDate } = require('../dateHelper');
const haRouter = require('./ha');
const { optionalAuth, authRequired } = require('../middleware/auth');

// GET /api/calendar/summary?month=YYYY-MM
// Returns summary statistics for each day of the month (including task title)
router.get('/summary', optionalAuth, (req, res) => {
  try {
    const { month } = req.query;
    const userId = req.user?.id || null;
    // month format: YYYY-MM
    const currentMonth = month || getLocalDateString().slice(0, 7);

    // If unauthenticated, check if there are public/unowned plans or return empty
    const userCond = userId ? 'user_id = ?' : 'user_id IS NULL';
    const dpUserCond = userId ? 'dp.user_id = ?' : 'dp.user_id IS NULL';
    const dpmUserCond = userId ? 'dpm.user_id = ?' : 'dpm.user_id IS NULL';
    const rUserCond = userId ? 'r.user_id = ?' : 'r.user_id IS NULL';

    const params = userId 
      ? [userId, `${currentMonth}-%`, userId, `${currentMonth}-%`, userId, userId, userId]
      : [`${currentMonth}-%`, `${currentMonth}-%`];

    const rows = db.prepare(`
      SELECT 
        dates.plan_date as date,
        COUNT(dp.word_id) as word_count,
        MAX(dpm.title) as title,
        MAX(COALESCE(dpm.is_shuffle, 0)) as is_shuffle,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM records r 
          WHERE r.word_id = dp.word_id 
            AND DATE(r.created_at) = dp.plan_date
            AND ${rUserCond}
        ) THEN 1 ELSE 0 END) as tested_count
      FROM (
        SELECT plan_date FROM daily_plans WHERE plan_date LIKE ? AND ${userCond}
        UNION
        SELECT plan_date FROM daily_plan_meta WHERE plan_date LIKE ? AND ${userCond}
      ) dates
      LEFT JOIN daily_plans dp ON dates.plan_date = dp.plan_date AND ${dpUserCond}
      LEFT JOIN daily_plan_meta dpm ON dates.plan_date = dpm.plan_date AND ${dpmUserCond}
      GROUP BY dates.plan_date
      ORDER BY dates.plan_date ASC
    `).all(...params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/daily?date=YYYY-MM-DD
// Returns words scheduled for a specific date, task title, and per-date shuffle preference
router.get('/daily', optionalAuth, (req, res) => {
  try {
    const { date } = req.query;
    const userId = req.user?.id || null;
    const planDate = date || getValidActiveDate(userId) || getLocalDateString();

    const userCond = userId ? 'dp.user_id = ?' : 'dp.user_id IS NULL';
    const rUserCond = userId ? `r.user_id = ${userId}` : 'r.user_id IS NULL';
    const params = [userId, planDate, ...(userId ? [userId] : [])];

    const words = db.prepare(`
      SELECT 
        w.*,
        dp.sort_order,
        dp.created_at as scheduled_at,
        COALESCE(uwm.mistake_count, 0) as mistake_count,
        (SELECT COUNT(*) FROM records r WHERE r.word_id = w.id AND DATE(r.created_at) = dp.plan_date AND r.mode = 'dictation' AND ${rUserCond}) as today_dictation_count,
        (SELECT COUNT(*) FROM records r WHERE r.word_id = w.id AND DATE(r.created_at) = dp.plan_date AND r.mode = 'dictation' AND r.is_correct = 1 AND ${rUserCond}) as today_dictation_correct
      FROM words w
      JOIN daily_plans dp ON w.id = dp.word_id
      LEFT JOIN user_word_mistakes uwm ON uwm.word_id = w.id AND uwm.user_id = ?
      WHERE dp.plan_date = ? AND ${userCond}
      ORDER BY dp.sort_order ASC, dp.created_at ASC
    `).all(...params);

    const metaCond = userId ? 'user_id = ?' : 'user_id IS NULL';
    const metaParams = [planDate, ...(userId ? [userId] : [])];
    const meta = db.prepare(`SELECT title, description, is_shuffle FROM daily_plan_meta WHERE plan_date = ? AND ${metaCond} ORDER BY id DESC LIMIT 1`).get(...metaParams);

    res.json({
      date: planDate,
      title: meta?.title || '',
      description: meta?.description || '',
      is_shuffle: meta?.is_shuffle === 1,
      total: words.length,
      words
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/daily-title
// Set or rename the calendar task name for a date
router.post('/daily-title', authRequired, (req, res) => {
  try {
    const { date, title = '', description = '' } = req.body;
    if (!date) {
      return res.status(400).json({ error: '请指定日期 (YYYY-MM-DD)' });
    }
    const cleanTitle = (title || '').trim();
    const cleanDesc = (description || '').trim();
    const userId = req.user.id;

    const existing = db.prepare('SELECT id FROM daily_plan_meta WHERE plan_date = ? AND user_id = ?').get(date, userId);
    if (existing) {
      db.prepare(`
        UPDATE daily_plan_meta SET
          title = ?,
          description = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(cleanTitle, cleanDesc, existing.id);
    } else {
      db.prepare(`
        INSERT INTO daily_plan_meta (plan_date, title, description, user_id, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(date, cleanTitle, cleanDesc, userId);
    }

    res.json({ success: true, date, title: cleanTitle, description: cleanDesc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/daily-shuffle
// Set shuffle/random preference for a specific date's plan
router.post('/daily-shuffle', authRequired, (req, res) => {
  try {
    const { date, is_shuffle, isShuffle } = req.body;
    if (!date) {
      return res.status(400).json({ error: '请指定日期 (YYYY-MM-DD)' });
    }
    const shuffleVal = (is_shuffle === true || isShuffle === true || is_shuffle === 1 || isShuffle === 1) ? 1 : 0;
    const userId = req.user.id;

    const existing = db.prepare('SELECT id FROM daily_plan_meta WHERE plan_date = ? AND user_id = ?').get(date, userId);
    if (existing) {
      db.prepare('UPDATE daily_plan_meta SET is_shuffle = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(shuffleVal, existing.id);
    } else {
      db.prepare(`
        INSERT INTO daily_plan_meta (plan_date, is_shuffle, user_id, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `).run(date, shuffleVal, userId);
    }

    res.json({ success: true, date, is_shuffle: shuffleVal === 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/daily
// Add words to a specific date's plan
router.post('/daily', authRequired, (req, res) => {
  try {
    const { date, wordIds } = req.body;
    if (!date) {
      return res.status(400).json({ error: '请指定日期 (YYYY-MM-DD)' });
    }
    if (!Array.isArray(wordIds) || wordIds.length === 0) {
      return res.status(400).json({ error: '请选择要添加到该日期的单词' });
    }

    const userId = req.user.id;

    const maxRow = db.prepare('SELECT MAX(sort_order) as m FROM daily_plans WHERE plan_date = ? AND user_id = ?').get(date, userId);
    let order = (maxRow?.m || 0) + 1;

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO daily_plans (plan_date, word_id, sort_order, user_id)
      VALUES (?, ?, ?, ?)
    `);

    const trans = db.transaction((ids) => {
      for (const id of ids) {
        stmt.run(date, id, order++, userId);
      }
    });

    trans(wordIds);
    haRouter.invalidateSession?.(date);

    const countRow = db.prepare('SELECT COUNT(*) as count FROM daily_plans WHERE plan_date = ? AND user_id = ?').get(date, userId);
    res.json({ success: true, date, addedCount: wordIds.length, totalForDay: countRow.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/calendar/daily
// Remove words from a specific date's plan (supports single/multiple wordIds or clearAll)
router.delete('/daily', authRequired, (req, res) => {
  try {
    const date = req.body?.date || req.query?.date;
    const clearAll = req.body?.clearAll || req.query?.clearAll === 'true' || req.query?.clearAll === '1';
    let rawIds = req.body?.wordIds || req.query?.wordIds || req.body?.wordId || req.query?.wordId;

    if (!date) {
      return res.status(400).json({ error: '请指定日期 (YYYY-MM-DD)' });
    }

    const userId = req.user.id;

    if (clearAll) {
      db.prepare('DELETE FROM daily_plans WHERE plan_date = ? AND user_id = ?').run(date, userId);
      haRouter.invalidateSession?.(date);
      return res.json({ success: true, date, removedCount: 'all', totalForDay: 0 });
    }

    let wordIds = [];
    if (Array.isArray(rawIds)) {
      wordIds = rawIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
    } else if (typeof rawIds === 'string') {
      wordIds = rawIds.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    } else if (typeof rawIds === 'number') {
      wordIds = [rawIds];
    }

    if (wordIds.length === 0) {
      return res.status(400).json({ error: '请选择要从该日期移除的单词' });
    }

    const stmt = db.prepare('DELETE FROM daily_plans WHERE plan_date = ? AND word_id = ? AND user_id = ?');
    const trans = db.transaction((ids) => {
      for (const id of ids) {
        stmt.run(date, id, userId);
      }
    });

    trans(wordIds);
    haRouter.invalidateSession?.(date);

    const countRow = db.prepare('SELECT COUNT(*) as count FROM daily_plans WHERE plan_date = ? AND user_id = ?').get(date, userId);
    res.json({ success: true, date, removedCount: wordIds.length, totalForDay: countRow.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/daily-reorder
// Move a word up or down in a specific date's plan
router.post('/daily-reorder', authRequired, (req, res) => {
  try {
    const { date, wordId, direction } = req.body;
    if (!date || !wordId || !direction) {
      return res.status(400).json({ error: 'Missing required parameters (date, wordId, direction)' });
    }

    const userId = req.user.id;

    const curr = db.prepare('SELECT id, word_id, sort_order FROM daily_plans WHERE plan_date = ? AND word_id = ? AND user_id = ?').get(date, wordId, userId);
    if (!curr) {
      return res.status(404).json({ error: 'Word not found in this date plan' });
    }

    const neighbor = direction === 'up'
      ? db.prepare('SELECT id, word_id, sort_order FROM daily_plans WHERE plan_date = ? AND sort_order < ? AND user_id = ? ORDER BY sort_order DESC LIMIT 1').get(date, curr.sort_order, userId)
      : db.prepare('SELECT id, word_id, sort_order FROM daily_plans WHERE plan_date = ? AND sort_order > ? AND user_id = ? ORDER BY sort_order ASC LIMIT 1').get(date, curr.sort_order, userId);

    if (neighbor) {
      const updateStmt = db.prepare('UPDATE daily_plans SET sort_order = ? WHERE id = ?');
      const trans = db.transaction(() => {
        updateStmt.run(neighbor.sort_order, curr.id);
        updateStmt.run(curr.sort_order, neighbor.id);
      });
      trans();
      haRouter.invalidateSession?.(date);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/daily-reverse
// Invert / reverse the sort order of all words in a specific date's plan
router.post('/daily-reverse', authRequired, (req, res) => {
  try {
    const { date } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'Missing date parameter' });
    }

    const userId = req.user.id;

    const rows = db.prepare(`
      SELECT id, word_id, sort_order 
      FROM daily_plans 
      WHERE plan_date = ? AND user_id = ?
      ORDER BY sort_order ASC, created_at ASC
    `).all(date, userId);

    if (rows.length > 1) {
      const updateStmt = db.prepare('UPDATE daily_plans SET sort_order = ? WHERE id = ?');
      const trans = db.transaction(() => {
        const total = rows.length;
        rows.forEach((row, idx) => {
          updateStmt.run(total - idx, row.id);
        });
      });
      trans();
      haRouter.invalidateSession?.(date);
    }

    res.json({ success: true, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/daily-sort-default
// Reset sort order of words in a specific date's plan according to their library sort_order
router.post('/daily-sort-default', authRequired, (req, res) => {
  try {
    const { date } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'Missing date parameter' });
    }

    const userId = req.user.id;

    // Try to sort by list_words.sort_order if available, otherwise by words.sort_order / words.id
    const rows = db.prepare(`
      SELECT dp.id, dp.word_id,
        COALESCE(
          (SELECT lw.sort_order FROM list_words lw WHERE lw.word_id = dp.word_id LIMIT 1),
          w.sort_order,
          w.id
        ) as canonical_sort
      FROM daily_plans dp
      JOIN words w ON dp.word_id = w.id
      WHERE dp.plan_date = ? AND dp.user_id = ?
      ORDER BY canonical_sort ASC, w.id ASC
    `).all(date, userId);

    if (rows.length > 0) {
      const updateStmt = db.prepare('UPDATE daily_plans SET sort_order = ? WHERE id = ?');
      const trans = db.transaction(() => {
        rows.forEach((row, idx) => {
          updateStmt.run(idx + 1, row.id);
        });
      });
      trans();
      haRouter.invalidateSession?.(date);
    }

    res.json({ success: true, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/active-date
// Get current active date setting for HA & today's plan (auto-expires once the day has passed)
router.get('/active-date', optionalAuth, (req, res) => {
  try {
    const userId = req.user?.id || null;
    const validActiveDate = getValidActiveDate(userId);
    const userCond = userId ? '(user_id IS ? OR user_id = ?)' : 'user_id IS NULL';
    const params = userId ? [userId, userId] : [];

    const shuffleRow = db.prepare(`SELECT value FROM app_settings WHERE key = 'daily_shuffle' AND ${userCond}`).get(...params);
    const setOnRow = validActiveDate ? db.prepare(`SELECT value FROM app_settings WHERE key = 'active_date_set_on' AND ${userCond}`).get(...params) : null;
    const today = getLocalDateString();
    res.json({
      activeDate: validActiveDate || null,
      effectiveDate: validActiveDate || today,
      setOnDate: setOnRow?.value || null,
      isShuffle: shuffleRow?.value === '1',
      today
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/shuffle
router.get('/shuffle', optionalAuth, (req, res) => {
  try {
    const userId = req.user?.id || null;
    const userCond = userId ? '(user_id IS ? OR user_id = ?)' : 'user_id IS NULL';
    const params = userId ? [userId, userId] : [];

    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'daily_shuffle' AND ${userCond}`).get(...params);
    res.json({ isShuffle: row?.value === '1' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/shuffle
router.post('/shuffle', authRequired, (req, res) => {
  try {
    const { isShuffle } = req.body;
    const val = isShuffle ? '1' : '0';
    const userId = req.user.id;

    db.prepare(`
      INSERT INTO app_settings (key, value, user_id, updated_at) 
      VALUES ('daily_shuffle', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key, user_id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(val, userId);
    res.json({ success: true, isShuffle: Boolean(isShuffle) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/active-date
// Set or clear active date setting (pinned calendar date; auto expires after the day has passed)
router.post('/active-date', authRequired, (req, res) => {
  try {
    const { date } = req.body;
    const today = getLocalDateString();
    const userId = req.user.id;

    // If date is empty or null, reset to auto (today)
    if (!date) {
      db.prepare("DELETE FROM app_settings WHERE key IN ('active_date', 'active_date_set_on') AND user_id = ?").run(userId);
      return res.json({
        success: true,
        activeDate: null,
        effectiveDate: today,
        today,
        message: '已恢复跟随系统今日日期'
      });
    }

    db.prepare(`
      INSERT INTO app_settings (key, value, user_id, updated_at) 
      VALUES ('active_date', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key, user_id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(date, userId);

    db.prepare(`
      INSERT INTO app_settings (key, value, user_id, updated_at) 
      VALUES ('active_date_set_on', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key, user_id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(today, userId);

    res.json({
      success: true,
      activeDate: date,
      effectiveDate: date,
      today,
      setOnDate: today,
      message: `今日任务已钉住使用 ${date} 的单词（仅当天有效，当天过后自动失效恢复）`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

