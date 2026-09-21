const express = require('express');
const router = express.Router();
const db = require('../db');
const { authRequired, adminRequired } = require('../middleware/auth');

/**
 * POST /api/audit/submit
 * User submits a proposal to create, update, or delete a public word/list
 * Body: { type: 'create_word' | 'update_word' | 'delete_word' | 'create_list', target_id, target_name, payload }
 */
router.post('/submit', authRequired, (req, res) => {
  try {
    const { type, target_id, target_name, payload } = req.body;

    if (!type || !payload) {
      return res.status(400).json({ error: '申请内容不能为空' });
    }

    // Normal users have a maximum limit of 10 pending audit requests
    if (req.user.role !== 'admin') {
      const pendingRow = db.prepare("SELECT COUNT(*) as count FROM change_requests WHERE user_id = ? AND status = 'pending'").get(req.user.id);
      const pendingCount = pendingRow?.count || 0;
      if (pendingCount >= 10) {
        return res.status(400).json({ 
          error: '您当前已有 10 条待审核条目，已达上限，暂无法继续操作。请等待管理员审核后再提交新申请。',
          pendingCount,
          maxPending: 10
        });
      }
    }

    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload);

    const info = db.prepare(`
      INSERT INTO change_requests (user_id, user_email, user_name, type, target_id, target_name, payload, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      req.user.id,
      req.user.email,
      req.user.username,
      type,
      target_id || null,
      target_name || '',
      payloadJson
    );

    res.json({
      success: true,
      requestId: info.lastInsertRowid,
      message: '您的修改申请已成功提交，待管理员审核后将自动合入公共词库！',
    });
  } catch (err) {
    console.error('Submit change request error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/audit/my-stats
 * Authenticated user gets their pending request count and limits
 */
router.get('/my-stats', authRequired, (req, res) => {
  try {
    const pendingRow = db.prepare("SELECT COUNT(*) as count FROM change_requests WHERE user_id = ? AND status = 'pending'").get(req.user.id);
    const totalRow = db.prepare("SELECT COUNT(*) as count FROM change_requests WHERE user_id = ?").get(req.user.id);
    const pendingCount = pendingRow?.count || 0;
    res.json({
      pendingCount,
      totalCount: totalRow?.count || 0,
      maxPending: 10,
      canSubmit: req.user.role === 'admin' || pendingCount < 10
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/audit/my-requests
 * Authenticated user views their own submitted change requests
 */
router.get('/my-requests', authRequired, (req, res) => {
  try {
    const requests = db.prepare(`
      SELECT * FROM change_requests 
      WHERE user_id = ? 
      ORDER BY created_at DESC
      LIMIT 100
    `).all(req.user.id);

    const parsed = requests.map(r => {
      try {
        return { ...r, payload: JSON.parse(r.payload) };
      } catch (e) {
        return r;
      }
    });

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/audit/requests
 * Admin views all requests with status filter (e.g. status=pending)
 */
router.get('/requests', adminRequired, (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM change_requests';
    const params = [];

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC LIMIT 200';

    const requests = db.prepare(query).all(...params);
    const parsed = requests.map(r => {
      try {
        return { ...r, payload: JSON.parse(r.payload) };
      } catch (e) {
        return r;
      }
    });

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/audit/stats
 * Admin gets count of pending requests
 */
router.get('/stats', adminRequired, (req, res) => {
  try {
    const pendingCount = db.prepare("SELECT COUNT(*) as count FROM change_requests WHERE status = 'pending'").get().count;
    res.json({ pendingCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/audit/review
 * Admin approves or rejects a change request
 * Body: { requestId, action: 'approve' | 'reject', comment }
 */
router.post('/review', adminRequired, (req, res) => {
  try {
    const { requestId, action, comment = '' } = req.body;
    if (!requestId || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: '参数不正确' });
    }

    const request = db.prepare('SELECT * FROM change_requests WHERE id = ?').get(requestId);
    if (!request) {
      return res.status(404).json({ error: '工单不存在' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: `该工单已经处理过 (当前状态: ${request.status})` });
    }

    let payload = {};
    try {
      payload = JSON.parse(request.payload);
    } catch (e) {
      return res.status(500).json({ error: '解析变更数据失败' });
    }

    if (action === 'reject') {
      db.prepare(`
        UPDATE change_requests 
        SET status = 'rejected', admin_comment = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(comment.trim(), req.user.id, requestId);

      return res.json({ success: true, message: '已驳回该申请' });
    }

    // Process approval: merge change into public database
    const executeApproval = db.transaction(() => {
      if (request.type === 'create_word' || request.type === 'word_insert') {
        const { word, phonetic, translation, example, example_cn, listId, list_id } = payload;
        const targetListId = listId || list_id;
        const maxSortRow = db.prepare('SELECT MAX(sort_order) as m FROM words WHERE is_public = 1').get();
        const nextSort = (maxSortRow?.m || 0) + 1;

        const insertWord = db.prepare(`
          INSERT INTO words (word, phonetic, translation, example, example_cn, sort_order, user_id, is_public)
          VALUES (?, ?, ?, ?, ?, ?, NULL, 1)
        `);
        const info = insertWord.run(
          word.trim(),
          (phonetic || '').trim(),
          (translation || '').trim(),
          (example || '').trim(),
          (example_cn || '').trim(),
          nextSort
        );
        const newWordId = info.lastInsertRowid;

        if (targetListId) {
          const maxListSort = db.prepare('SELECT MAX(sort_order) as m FROM list_words WHERE list_id = ?').get(targetListId)?.m || 0;
          db.prepare('INSERT OR IGNORE INTO list_words (list_id, word_id, sort_order) VALUES (?, ?, ?)').run(
            targetListId, newWordId, maxListSort + 1
          );
        }
      } else if (request.type === 'update_word' || request.type === 'word_update') {
        const { word, phonetic, translation, example, example_cn } = payload;
        db.prepare(`
          UPDATE words SET
            word = COALESCE(?, word),
            phonetic = COALESCE(?, phonetic),
            translation = COALESCE(?, translation),
            example = COALESCE(?, example),
            example_cn = COALESCE(?, example_cn),
            is_public = 1
          WHERE id = ?
        `).run(
          word ? word.trim() : null,
          phonetic !== undefined ? phonetic.trim() : null,
          translation !== undefined ? translation.trim() : null,
          example !== undefined ? example.trim() : null,
          example_cn !== undefined ? example_cn.trim() : null,
          request.target_id
        );
      } else if (request.type === 'word_publish' || request.type === 'publish_word') {
        const { word, phonetic, translation, example, example_cn, list_id, listId } = payload;
        const targetWordId = request.target_id || payload?.word_id;
        const targetListId = list_id || listId;

        const existing = targetWordId ? db.prepare('SELECT * FROM words WHERE id = ?').get(targetWordId) : null;
        if (existing) {
          db.prepare(`
            UPDATE words SET
              word = COALESCE(?, word),
              phonetic = COALESCE(?, phonetic),
              translation = COALESCE(?, translation),
              example = COALESCE(?, example),
              example_cn = COALESCE(?, example_cn),
              is_public = 1,
              user_id = NULL
            WHERE id = ?
          `).run(
            word ? word.trim() : null,
            phonetic !== undefined ? phonetic.trim() : null,
            translation !== undefined ? translation.trim() : null,
            example !== undefined ? example.trim() : null,
            example_cn !== undefined ? example_cn.trim() : null,
            targetWordId
          );
        } else {
          // If original private word was deleted before review, insert as new public word
          const maxSortRow = db.prepare('SELECT MAX(sort_order) as m FROM words WHERE is_public = 1').get();
          const nextSort = (maxSortRow?.m || 0) + 1;
          const ins = db.prepare(`
            INSERT INTO words (word, phonetic, translation, example, example_cn, sort_order, user_id, is_public)
            VALUES (?, ?, ?, ?, ?, ?, NULL, 1)
          `).run(
            word ? word.trim() : '',
            (phonetic || '').trim(),
            (translation || '').trim(),
            (example || '').trim(),
            (example_cn || '').trim(),
            nextSort
          );
        }

        if (targetListId && targetWordId) {
          const maxListSort = db.prepare('SELECT MAX(sort_order) as m FROM list_words WHERE list_id = ?').get(targetListId)?.m || 0;
          db.prepare('INSERT OR IGNORE INTO list_words (list_id, word_id, sort_order) VALUES (?, ?, ?)').run(
            targetListId, targetWordId, maxListSort + 1
          );
        }
      } else if (request.type === 'delete_word' || request.type === 'word_delete') {
        if (payload?.list_id) {
          db.prepare('DELETE FROM list_words WHERE list_id = ? AND word_id = ?').run(payload.list_id, request.target_id);
        } else {
          db.prepare('DELETE FROM list_words WHERE word_id = ?').run(request.target_id);
          db.prepare('DELETE FROM records WHERE word_id = ?').run(request.target_id);
          db.prepare('DELETE FROM user_word_mistakes WHERE word_id = ?').run(request.target_id);
          db.prepare('DELETE FROM words WHERE id = ?').run(request.target_id);
        }
      } else if (request.type === 'create_list' || request.type === 'list_create') {
        const { name, description, parent_id, is_folder } = payload;
        db.prepare(`
          INSERT INTO lists (name, description, parent_id, is_folder, user_id, is_public)
          VALUES (?, ?, ?, ?, NULL, 1)
        `).run(
          name.trim(),
          (description || '').trim(),
          parent_id || null,
          is_folder ? 1 : 0
        );
      } else if (request.type === 'delete_list' || request.type === 'list_delete') {
        db.prepare('DELETE FROM list_words WHERE list_id = ?').run(request.target_id);
        db.prepare('DELETE FROM lists WHERE id = ?').run(request.target_id);
      }

      // Mark request as approved
      db.prepare(`
        UPDATE change_requests 
        SET status = 'approved', admin_comment = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(comment.trim(), req.user.id, requestId);
    });

    executeApproval();

    res.json({ success: true, message: '审核通过，已成功合入公共词库！' });
  } catch (err) {
    console.error('Review change request error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
