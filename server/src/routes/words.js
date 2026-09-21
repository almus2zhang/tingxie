const express = require('express');
const router = express.Router();
const db = require('../db');
const haRouter = require('./ha');
const { optionalAuth, authRequired } = require('../middleware/auth');

// --- Word Lists CRUD ---

// Get complete hierarchical tree of lists and folders
router.get('/lists/tree', optionalAuth, (req, res) => {
  try {
    const userId = req.user?.id || null;
    let query = `
      SELECT 
        l.*, 
        COUNT(lw.word_id) as word_count
      FROM lists l
      LEFT JOIN list_words lw ON l.id = lw.list_id
    `;
    const params = [];
    if (userId) {
      // Show public lists (is_public = 1 or user_id IS NULL) + user's private lists
      query += ' WHERE (l.is_public = 1 OR l.user_id IS NULL OR l.user_id = ?)';
      params.push(userId);
    } else {
      // Unauthenticated visitor only sees public lists
      query += ' WHERE (l.is_public = 1 OR l.user_id IS NULL)';
    }

    query += `
      GROUP BY l.id
      ORDER BY l.is_folder DESC, l.sort_order ASC, l.name ASC, l.id ASC
    `;

    const rawLists = db.prepare(query).all(...params);

    const listMap = new Map();
    rawLists.forEach(item => {
      listMap.set(item.id, {
        ...item,
        total_word_count: item.word_count || 0,
        children: []
      });
    });

    const roots = [];
    rawLists.forEach(item => {
      const node = listMap.get(item.id);
      if (item.parent_id && listMap.has(item.parent_id)) {
        listMap.get(item.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    });

    // Recursively sum total_word_count for folders
    function sumWordCount(node) {
      let sum = node.word_count || 0;
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          sum += sumWordCount(child);
        }
      }
      node.total_word_count = sum;
      return sum;
    }

    roots.forEach(r => sumWordCount(r));

    res.json(roots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all lists with word count (optional parentId filter)
router.get('/lists', optionalAuth, (req, res) => {
  try {
    const { parentId } = req.query;
    const userId = req.user?.id || null;
    let query = `
      SELECT 
        l.*, 
        COUNT(lw.word_id) as word_count
      FROM lists l
      LEFT JOIN list_words lw ON l.id = lw.list_id
    `;
    const params = [];
    const conditions = [];

    if (userId) {
      conditions.push('(l.is_public = 1 OR l.user_id IS NULL OR l.user_id = ?)');
      params.push(userId);
    } else {
      conditions.push('(l.is_public = 1 OR l.user_id IS NULL)');
    }

    if (parentId !== undefined) {
      if (parentId === 'null' || parentId === '' || parentId === '0') {
        conditions.push('l.parent_id IS NULL');
      } else {
        conditions.push('l.parent_id = ?');
        params.push(Number(parentId));
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += `
      GROUP BY l.id
      ORDER BY l.is_folder DESC, l.sort_order ASC, l.created_at DESC
    `;
    const lists = db.prepare(query).all(...params);
    res.json(lists);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new list or folder
router.post('/lists', authRequired, (req, res) => {
  try {
    const { name, description = '', parent_id = null, is_folder = 0, sort_order = 0, is_public } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '名称不能为空' });
    }

    const isAdmin = req.user.role === 'admin';

    // Normal users cannot directly create public lists
    if (!isAdmin && is_public === 1) {
      return res.status(403).json({ error: '普通用户无法直接创建公共词单/分类，请通过“提交修改申请”待管理员审核合入' });
    }

    // Admin can choose public (1) or private (0). Regular users always create private lists (0).
    const listIsPublic = isAdmin ? (is_public === 0 ? 0 : 1) : 0;
    const userId = listIsPublic === 1 ? null : req.user.id;

    const stmt = db.prepare(`
      INSERT INTO lists (name, description, parent_id, is_folder, sort_order, user_id, is_public) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      name.trim(),
      description.trim(),
      parent_id ? Number(parent_id) : null,
      is_folder ? 1 : 0,
      Number(sort_order || 0),
      userId,
      listIsPublic
    );
    const newList = db.prepare('SELECT * FROM lists WHERE id = ?').get(result.lastInsertRowid);
    res.json(newList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a list (rename, update description, parent_id, sort_order, is_public)
router.put('/lists/:id', authRequired, (req, res) => {
  try {
    const { id } = req.params;
    const { name, description = '', parent_id, is_folder, sort_order, is_public } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '名称不能为空' });
    }

    const current = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ error: '未找到指定条目' });
    }

    const isAdmin = req.user.role === 'admin';

    // Permission check: if public list, only admin can update. If user list, only owner can update.
    if ((current.is_public === 1 || current.user_id === null) && !isAdmin) {
      return res.status(403).json({ error: '普通用户不能直接修改公共词单，请提交修改申请给管理员审核' });
    }
    if (current.user_id !== null && current.user_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: '无权修改其他用户的词单' });
    }
    if (!isAdmin && is_public === 1 && current.is_public === 0) {
      return res.status(403).json({ error: '将私有词单发布为公共词单需提交审核申请待管理员合入' });
    }

    const updatedParentId = parent_id !== undefined ? (parent_id ? Number(parent_id) : null) : current.parent_id;
    const updatedIsFolder = is_folder !== undefined ? (is_folder ? 1 : 0) : current.is_folder;
    const updatedSortOrder = sort_order !== undefined ? Number(sort_order) : current.sort_order;

    let newIsPublic = current.is_public;
    let newUserId = current.user_id;
    if (isAdmin && is_public !== undefined) {
      newIsPublic = is_public === 1 ? 1 : 0;
      newUserId = newIsPublic === 1 ? null : (current.user_id || req.user.id);
    }

    const stmt = db.prepare(`
      UPDATE lists 
      SET name = ?, description = ?, parent_id = ?, is_folder = ?, sort_order = ?, is_public = ?, user_id = ?
      WHERE id = ?
    `);
    stmt.run(
      name.trim(), 
      description.trim(), 
      updatedParentId, 
      updatedIsFolder, 
      updatedSortOrder, 
      newIsPublic, 
      newUserId, 
      id
    );
    const updated = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Move a list or folder to a new parent
router.put('/lists/:id/move', authRequired, (req, res) => {
  try {
    const { id } = req.params;
    const { parent_id } = req.body;

    const current = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ error: '未找到指定条目' });
    }
    if ((current.is_public === 1 || current.user_id === null) && req.user.role !== 'admin') {
      return res.status(403).json({ error: '普通用户不能直接移动公共分类或词单' });
    }
    if (current.user_id !== null && current.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '无权移动其他用户的词单' });
    }

    // Prevent circular parenting
    if (parent_id && Number(parent_id) === Number(id)) {
      return res.status(400).json({ error: '不能将项目移动到自身内部' });
    }

    const stmt = db.prepare('UPDATE lists SET parent_id = ? WHERE id = ?');
    stmt.run(parent_id ? Number(parent_id) : null, id);
    const updated = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a list or folder
router.delete('/lists/:id', authRequired, (req, res) => {
  try {
    const { id } = req.params;
    const current = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ error: '未找到指定条目' });
    }
    if ((current.is_public === 1 || current.user_id === null) && req.user.role !== 'admin') {
      return res.status(403).json({ error: '普通用户不能直接删除公共分类或词单' });
    }
    if (current.user_id !== null && current.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '无权删除其他用户的词单' });
    }

    // Recursively delete sub-lists if this is a folder
    db.prepare(`
      WITH RECURSIVE sub_lists(id) AS (
        SELECT id FROM lists WHERE id = ?
        UNION ALL
        SELECT l.id FROM lists l JOIN sub_lists sl ON l.parent_id = sl.id
      )
      DELETE FROM list_words WHERE list_id IN (SELECT id FROM sub_lists)
    `).run(id);

    db.prepare(`
      WITH RECURSIVE sub_lists(id) AS (
        SELECT id FROM lists WHERE id = ?
        UNION ALL
        SELECT l.id FROM lists l JOIN sub_lists sl ON l.parent_id = sl.id
      )
      DELETE FROM lists WHERE id IN (SELECT id FROM sub_lists)
    `).run(id);

    res.json({ success: true, message: '已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get words in a specific list or folder
router.get('/lists/:id/words', optionalAuth, (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || null;
    const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
    if (!list) {
      return res.status(404).json({ error: '词单未找到' });
    }

    let wordsQuery = '';
    let params = [];
    if (list.is_folder === 1) {
      wordsQuery = `
        SELECT 
          w.*,
          lw.sort_order,
          COALESCE(uwm.mistake_count, 0) as mistake_count,
          (SELECT COUNT(*) FROM records r WHERE r.word_id = w.id AND r.mode = 'dictation' AND (r.user_id IS ? OR r.user_id = ?)) as dictation_count,
          (SELECT COUNT(*) FROM records r WHERE r.word_id = w.id AND r.mode = 'dictation' AND r.is_correct = 1 AND (r.user_id IS ? OR r.user_id = ?)) as dictation_correct_count
        FROM words w
        JOIN list_words lw ON w.id = lw.word_id
        LEFT JOIN user_word_mistakes uwm ON uwm.word_id = w.id AND uwm.user_id = ?
        WHERE lw.list_id IN (
          WITH RECURSIVE sub_lists(id) AS (
            SELECT id FROM lists WHERE id = ?
            UNION ALL
            SELECT l.id FROM lists l JOIN sub_lists sl ON l.parent_id = sl.id
          )
          SELECT id FROM sub_lists
        )
        GROUP BY w.id
        ORDER BY lw.sort_order ASC, lw.created_at ASC, w.id ASC
      `;
      params = [userId, userId, userId, userId, userId, id];
    } else {
      wordsQuery = `
        SELECT 
          w.*,
          lw.sort_order,
          COALESCE(uwm.mistake_count, 0) as mistake_count,
          (SELECT COUNT(*) FROM records r WHERE r.word_id = w.id AND r.mode = 'dictation' AND (r.user_id IS ? OR r.user_id = ?)) as dictation_count,
          (SELECT COUNT(*) FROM records r WHERE r.word_id = w.id AND r.mode = 'dictation' AND r.is_correct = 1 AND (r.user_id IS ? OR r.user_id = ?)) as dictation_correct_count
        FROM words w
        JOIN list_words lw ON w.id = lw.word_id
        LEFT JOIN user_word_mistakes uwm ON uwm.word_id = w.id AND uwm.user_id = ?
        WHERE lw.list_id = ?
        ORDER BY lw.sort_order ASC, lw.created_at ASC, w.id ASC
      `;
      params = [userId, userId, userId, userId, userId, id];
    }
    const words = db.prepare(wordsQuery).all(...params);

    // Also get immediate child lists/folders if this is a folder
    let children = [];
    if (list.is_folder === 1) {
      children = db.prepare(`
        SELECT 
          l.*, 
          (
            WITH RECURSIVE sub(id) AS (
              SELECT l.id
              UNION ALL
              SELECT c.id FROM lists c JOIN sub s ON c.parent_id = s.id
            )
            SELECT COUNT(DISTINCT lw.word_id) 
            FROM list_words lw 
            WHERE lw.list_id IN (SELECT id FROM sub)
          ) as total_word_count,
          COUNT(lw.word_id) as word_count
        FROM lists l
        LEFT JOIN list_words lw ON l.id = lw.list_id
        WHERE l.parent_id = ?
        GROUP BY l.id
        ORDER BY l.is_folder DESC, l.sort_order ASC, l.name ASC
      `).all(id);
    }

    res.json({
      list,
      words,
      children
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a word from a specific list
router.delete('/lists/:id/words/:wordId', authRequired, (req, res) => {
  try {
    const { id, wordId } = req.params;
    const targetList = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
    if (!targetList) {
      return res.status(404).json({ error: '词单未找到' });
    }

    const isAdmin = req.user.role === 'admin';
    if ((targetList.is_public === 1 || targetList.user_id === null) && !isAdmin) {
      return res.status(403).json({ error: '普通用户无法直接从公共词单中移除词条，请向管理员提交修改申请' });
    }
    if (targetList.user_id !== null && targetList.user_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: '无权操作其他用户的词单' });
    }

    db.prepare('DELETE FROM list_words WHERE list_id = ? AND word_id = ?').run(id, wordId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Master Word Library (候选总列表) ---

// Get overall word statistics (total count, unassigned count, mistake count)
router.get('/words/stats', optionalAuth, (req, res) => {
  try {
    const userId = req.user?.id || null;
    let baseWhere = userId 
      ? '(w.is_public = 1 OR w.user_id IS NULL OR w.user_id = ?)' 
      : '(w.is_public = 1 OR w.user_id IS NULL)';
    const params = userId ? [userId] : [];

    const totalCount = db.prepare(`SELECT COUNT(*) as c FROM words w WHERE ${baseWhere}`).get(...params)?.c || 0;
    const unassignedCount = db.prepare(`
      SELECT COUNT(*) as c FROM words w 
      WHERE ${baseWhere} AND NOT EXISTS (SELECT 1 FROM list_words lw WHERE lw.word_id = w.id)
    `).get(...params)?.c || 0;

    let mistakeCount = 0;
    if (userId) {
      mistakeCount = db.prepare(`
        SELECT COUNT(*) as c 
        FROM words w
        JOIN user_word_mistakes uwm ON w.id = uwm.word_id AND uwm.user_id = ?
        WHERE ${baseWhere} AND uwm.mistake_count > 0
      `).get(userId, ...params)?.c || 0;
    }

    res.json({
      total_count: totalCount,
      unassigned_count: unassignedCount,
      mistake_count: mistakeCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get words with search, pagination, mistake filtering and list membership
router.get('/words', optionalAuth, (req, res) => {
  try {
    const { search = '', listId, onlyMistakes, limit, offset = 0 } = req.query;
    const userId = req.user?.id || null;

    let query = `
      SELECT 
        w.*,
        COALESCE(uwm.mistake_count, 0) as mistake_count,
        (SELECT COUNT(*) FROM records r WHERE r.word_id = w.id AND r.mode = 'dictation' AND (r.user_id IS ? OR r.user_id = ?)) as dictation_count,
        (SELECT COUNT(*) FROM records r WHERE r.word_id = w.id AND r.mode = 'dictation' AND r.is_correct = 1 AND (r.user_id IS ? OR r.user_id = ?)) as dictation_correct_count,
        (SELECT MAX(score) FROM records r WHERE r.word_id = w.id AND r.mode = 'memory' AND (r.user_id IS ? OR r.user_id = ?)) as best_speech_score
      FROM words w
      LEFT JOIN user_word_mistakes uwm ON uwm.word_id = w.id AND uwm.user_id = ?
    `;
    const selectParams = [userId, userId, userId, userId, userId, userId, userId];
    const condParams = [];
    const conditions = [];

    // Scope words to public + user's private words
    if (userId) {
      conditions.push('(w.is_public = 1 OR w.user_id IS NULL OR w.user_id = ?)');
      condParams.push(userId);
    } else {
      conditions.push('(w.is_public = 1 OR w.user_id IS NULL)');
    }

    if (search.trim()) {
      conditions.push('(w.word LIKE ? OR w.translation LIKE ?)');
      condParams.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (listId && listId !== 'all') {
      if (listId === 'unassigned') {
        conditions.push('w.id NOT IN (SELECT word_id FROM list_words)');
      } else {
        const listInfo = db.prepare('SELECT id, is_folder FROM lists WHERE id = ?').get(listId);
        if (listInfo && listInfo.is_folder === 1) {
          conditions.push(`w.id IN (
            WITH RECURSIVE sub_lists(id) AS (
              SELECT id FROM lists WHERE id = ?
              UNION ALL
              SELECT l.id FROM lists l JOIN sub_lists sl ON l.parent_id = sl.id
            )
            SELECT word_id FROM list_words WHERE list_id IN (SELECT id FROM sub_lists)
          )`);
          condParams.push(listId);
        } else {
          conditions.push('w.id IN (SELECT word_id FROM list_words WHERE list_id = ?)');
          condParams.push(listId);
        }
      }
    }

    if (onlyMistakes === 'true' || onlyMistakes === '1') {
      conditions.push('COALESCE(uwm.mistake_count, 0) > 0');
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // When filtering by mistakes, order by mistake_count DESC first
    if (onlyMistakes === 'true' || onlyMistakes === '1') {
      query += ' ORDER BY COALESCE(uwm.mistake_count, 0) DESC, w.sort_order ASC, w.created_at ASC, w.id ASC';
    } else {
      query += ' ORDER BY w.sort_order ASC, w.created_at ASC, w.id ASC';
    }

    const allParams = [...selectParams, ...condParams];

    if (limit !== undefined && limit !== null && limit !== '' && Number(limit) > 0) {
      query += ' LIMIT ? OFFSET ?';
      allParams.push(Number(limit), Number(offset || 0));
    }

    const words = db.prepare(query).all(...allParams);

    // Total count with current filters
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM words w 
      LEFT JOIN user_word_mistakes uwm ON uwm.word_id = w.id AND uwm.user_id = ?
    `;
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    const countResult = db.prepare(countQuery).get(userId, ...condParams);

    // Total mistake count in the current list/scope
    let mistakeTotal = 0;
    if (userId) {
      let mistakeCountQuery = `
        SELECT COUNT(*) as mistakeTotal 
        FROM words w 
        JOIN user_word_mistakes uwm ON w.id = uwm.word_id AND uwm.user_id = ?
        WHERE uwm.mistake_count > 0
      `;
      const mistakeParams = [userId];

      mistakeCountQuery += ' AND (w.is_public = 1 OR w.user_id IS NULL OR w.user_id = ?)';
      mistakeParams.push(userId);

      if (listId && listId !== 'all') {
        if (listId === 'unassigned') {
          mistakeCountQuery += ' AND w.id NOT IN (SELECT word_id FROM list_words)';
        } else {
          const listInfo = db.prepare('SELECT id, is_folder FROM lists WHERE id = ?').get(listId);
          if (listInfo && listInfo.is_folder === 1) {
            mistakeCountQuery += ` AND w.id IN (
              WITH RECURSIVE sub_lists(id) AS (
                SELECT id FROM lists WHERE id = ?
                UNION ALL
                SELECT l.id FROM lists l JOIN sub_lists sl ON l.parent_id = sl.id
              )
              SELECT word_id FROM list_words WHERE list_id IN (SELECT id FROM sub_lists)
            )`;
            mistakeParams.push(listId);
          } else {
            mistakeCountQuery += ' AND w.id IN (SELECT word_id FROM list_words WHERE list_id = ?)';
            mistakeParams.push(listId);
          }
        }
      }
      const mistakeResult = db.prepare(mistakeCountQuery).get(...mistakeParams);
      mistakeTotal = mistakeResult?.mistakeTotal || 0;
    }

    res.json({
      words,
      total: countResult?.total || words.length,
      mistakeTotal
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Insert a single word between words (afterWordId or beforeWordId)
router.post('/words/insert', authRequired, (req, res) => {
  try {
    const { 
      word, 
      phonetic = '', 
      translation = '', 
      example = '', 
      example_cn = '', 
      afterWordId, 
      beforeWordId, 
      listId,
      is_public
    } = req.body;

    if (!word || !word.trim()) {
      return res.status(400).json({ error: '单词拼写不能为空' });
    }

    const cleanWord = word.trim();
    const isAdmin = req.user.role === 'admin';

    // Disallow normal users from directly creating public words
    if (!isAdmin && is_public === 1) {
      return res.status(403).json({ error: '普通用户无法直接创建公共词条，请通过“提交修改申请”待管理员审核合入' });
    }

    // If target list is public and user is not admin, they cannot insert directly into public list
    if (listId) {
      const targetList = db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
      if (targetList && (targetList.is_public === 1 || targetList.user_id === null) && !isAdmin) {
        return res.status(403).json({ error: '普通用户无法直接在公共词库中添加词条，请通过“提交修改申请”待管理员审核合入' });
      }
    }

    // Determine ownership of the new word:
    // Admin can create public (1) or private (0). Normal user always creates private word (0).
    const wordIsPublic = isAdmin ? (is_public === 0 ? 0 : 1) : 0;
    const wordUserId = wordIsPublic === 1 ? null : req.user.id;

    const insertTransaction = db.transaction(() => {
      // 1. Calculate target sort_order in master words table
      let targetMasterSort = 0;
      if (afterWordId) {
        const row = db.prepare('SELECT sort_order FROM words WHERE id = ?').get(afterWordId);
        targetMasterSort = row?.sort_order ?? 0;
        db.prepare('UPDATE words SET sort_order = sort_order + 1 WHERE sort_order > ?').run(targetMasterSort);
        targetMasterSort += 1;
      } else if (beforeWordId) {
        const row = db.prepare('SELECT sort_order FROM words WHERE id = ?').get(beforeWordId);
        targetMasterSort = row?.sort_order ?? 1;
        db.prepare('UPDATE words SET sort_order = sort_order + 1 WHERE sort_order >= ?').run(targetMasterSort);
      } else {
        const maxRow = db.prepare('SELECT MAX(sort_order) as m FROM words').get();
        targetMasterSort = (maxRow?.m || 0) + 1;
      }

      const insertWord = db.prepare(`
        INSERT INTO words (word, phonetic, translation, example, example_cn, sort_order, user_id, is_public)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const info = insertWord.run(
        cleanWord,
        (phonetic || '').trim(),
        (translation || '').trim(),
        (example || '').trim(),
        (example_cn || '').trim(),
        targetMasterSort,
        wordUserId,
        wordIsPublic
      );

      const newWordId = info.lastInsertRowid;
      const wordRow = db.prepare('SELECT * FROM words WHERE id = ?').get(newWordId);

      // 2. If listId is provided, also insert into list_words at target position
      if (listId) {
        let targetListSort = 0;
        if (afterWordId) {
          const row = db.prepare('SELECT sort_order FROM list_words WHERE list_id = ? AND word_id = ?').get(listId, afterWordId);
          targetListSort = row?.sort_order ?? 0;
          db.prepare('UPDATE list_words SET sort_order = sort_order + 1 WHERE list_id = ? AND sort_order > ?').run(listId, targetListSort);
          targetListSort += 1;
        } else if (beforeWordId) {
          const row = db.prepare('SELECT sort_order FROM list_words WHERE list_id = ? AND word_id = ?').get(listId, beforeWordId);
          targetListSort = row?.sort_order ?? 1;
          db.prepare('UPDATE list_words SET sort_order = sort_order + 1 WHERE list_id = ? AND sort_order >= ?').run(listId, targetListSort);
        } else {
          const maxRow = db.prepare('SELECT MAX(sort_order) as m FROM list_words WHERE list_id = ?').get(listId);
          targetListSort = (maxRow?.m || 0) + 1;
        }

        db.prepare(`
          INSERT OR REPLACE INTO list_words (list_id, word_id, sort_order)
          VALUES (?, ?, ?)
        `).run(listId, newWordId, targetListSort);
      }

      return wordRow;
    });

    const createdWord = insertTransaction();
    res.json({ success: true, word: createdWord });
  } catch (err) {
    console.error('Insert word error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Reorder word (move up or down)
router.post('/words/reorder', (req, res) => {
  try {
    const { wordId, direction, listId } = req.body; // direction: 'up' | 'down'
    if (!wordId || !['up', 'down'].includes(direction)) {
      return res.status(400).json({ error: '参数错误' });
    }

    const reorderTransaction = db.transaction(() => {
      if (listId) {
        const curr = db.prepare('SELECT sort_order FROM list_words WHERE list_id = ? AND word_id = ?').get(listId, wordId);
        if (!curr) return;
        const neighbor = direction === 'up'
          ? db.prepare('SELECT word_id, sort_order FROM list_words WHERE list_id = ? AND sort_order < ? ORDER BY sort_order DESC LIMIT 1').get(listId, curr.sort_order)
          : db.prepare('SELECT word_id, sort_order FROM list_words WHERE list_id = ? AND sort_order > ? ORDER BY sort_order ASC LIMIT 1').get(listId, curr.sort_order);

        if (neighbor) {
          db.prepare('UPDATE list_words SET sort_order = ? WHERE list_id = ? AND word_id = ?').run(neighbor.sort_order, listId, wordId);
          db.prepare('UPDATE list_words SET sort_order = ? WHERE list_id = ? AND word_id = ?').run(curr.sort_order, listId, neighbor.word_id);
        }
      } else {
        const curr = db.prepare('SELECT sort_order FROM words WHERE id = ?').get(wordId);
        if (!curr) return;
        const neighbor = direction === 'up'
          ? db.prepare('SELECT id, sort_order FROM words WHERE sort_order < ? ORDER BY sort_order DESC LIMIT 1').get(curr.sort_order)
          : db.prepare('SELECT id, sort_order FROM words WHERE sort_order > ? ORDER BY sort_order ASC LIMIT 1').get(curr.sort_order);

        if (neighbor) {
          db.prepare('UPDATE words SET sort_order = ? WHERE id = ?').run(neighbor.sort_order, wordId);
          db.prepare('UPDATE words SET sort_order = ? WHERE id = ?').run(curr.sort_order, neighbor.id);
        }
      }
    });

    reorderTransaction();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Batch import words and optionally add to a list
router.post('/words/batch', authRequired, (req, res) => {
  try {
    const { words, listId } = req.body;
    if (!Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: '没有提供需要导入的单词数据' });
    }

    const isAdmin = req.user.role === 'admin';
    if (listId) {
      const targetList = db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
      if (targetList && (targetList.is_public === 1 || targetList.user_id === null) && !isAdmin) {
        return res.status(403).json({ error: '普通用户无法直接向公共词单批量导入词汇，请先创建个人词单' });
      }
    }

    const wordUserId = isAdmin ? null : req.user.id;
    const wordIsPublic = isAdmin ? 1 : 0;

    const insertWord = db.prepare(`
      INSERT INTO words (word, phonetic, translation, example, example_cn, sort_order, user_id, is_public)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertListWord = db.prepare(`
      INSERT OR IGNORE INTO list_words (list_id, word_id, sort_order)
      VALUES (?, ?, ?)
    `);

    let maxSort = 0;
    if (listId) {
      const maxRow = db.prepare('SELECT MAX(sort_order) as m FROM list_words WHERE list_id = ?').get(listId);
      maxSort = maxRow?.m || 0;
    }
    const maxMasterRow = db.prepare('SELECT MAX(sort_order) as m FROM words').get();
    let masterSort = maxMasterRow?.m || 0;

    const importedIds = [];

    const transaction = db.transaction((items) => {
      let order = maxSort + 1;
      for (const item of items) {
        if (!item.word || !item.word.trim()) continue;
        const w = item.word.trim();
        const info = insertWord.run(
          w,
          (item.phonetic || '').trim(),
          (item.translation || '').trim(),
          (item.example || '').trim(),
          (item.example_cn || '').trim(),
          ++masterSort,
          wordUserId,
          wordIsPublic
        );

        const newWordId = info.lastInsertRowid;
        importedIds.push(newWordId);
        if (listId) {
          insertListWord.run(listId, newWordId, order++);
        }
      }
    });

    transaction(words);

    res.json({
      success: true,
      importedCount: importedIds.length,
      importedIds
    });
  } catch (err) {
    console.error('Batch import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper: Resolve or recursively create folder tree and leaf list from path string
// e.g. "初中/8年级上册/8上Unit1" -> folder "初中" -> folder "8年级上册" -> list "8上Unit1"
function resolveOrCreateListPath(pathStr, user = null) {
  if (!pathStr || !pathStr.trim()) return null;
  const segments = pathStr.split(/[\/\\>]|\s*->\s*/).map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;

  const isAdmin = user?.role === 'admin';
  const listUserId = isAdmin ? null : user?.id;
  const listIsPublic = isAdmin ? 1 : 0;

  let currentParentId = null;

  // Process all intermediate folder segments
  for (let i = 0; i < segments.length - 1; i++) {
    const segName = segments[i];
    let folder;
    if (currentParentId === null) {
      folder = db.prepare('SELECT id FROM lists WHERE name = ? AND parent_id IS NULL AND is_folder = 1').get(segName);
    } else {
      folder = db.prepare('SELECT id FROM lists WHERE name = ? AND parent_id = ? AND is_folder = 1').get(segName, currentParentId);
    }

    if (!folder) {
      const maxSortRow = currentParentId === null
        ? db.prepare('SELECT MAX(sort_order) as m FROM lists WHERE parent_id IS NULL').get()
        : db.prepare('SELECT MAX(sort_order) as m FROM lists WHERE parent_id = ?').get(currentParentId);
      const nextSort = (maxSortRow?.m || 0) + 1;
      const res = db.prepare('INSERT INTO lists (name, is_folder, parent_id, sort_order, description, user_id, is_public) VALUES (?, 1, ?, ?, ?, ?, ?)').run(
        segName, currentParentId, nextSort, `${segName}分类目录`, listUserId, listIsPublic
      );
      currentParentId = res.lastInsertRowid;
    } else {
      currentParentId = folder.id;
    }
  }

  // Process the leaf list (is_folder = 0)
  const leafName = segments[segments.length - 1];
  let list;
  if (currentParentId === null) {
    list = db.prepare('SELECT id FROM lists WHERE name = ? AND parent_id IS NULL AND is_folder = 0').get(leafName);
  } else {
    list = db.prepare('SELECT id FROM lists WHERE name = ? AND parent_id = ? AND is_folder = 0').get(leafName, currentParentId);
  }

  if (!list) {
    const maxSortRow = currentParentId === null
      ? db.prepare('SELECT MAX(sort_order) as m FROM lists WHERE parent_id IS NULL').get()
      : db.prepare('SELECT MAX(sort_order) as m FROM lists WHERE parent_id = ?').get(currentParentId);
    const nextSort = (maxSortRow?.m || 0) + 1;
    const res = db.prepare('INSERT INTO lists (name, is_folder, parent_id, sort_order, description, user_id, is_public) VALUES (?, 0, ?, ?, ?, ?, ?)').run(
      leafName, currentParentId, nextSort, '', listUserId, listIsPublic
    );
    return res.lastInsertRowid;
  }

  return list.id;
}

// Helper: Parse TXT into structured groups with path headers
function parseStructuredTxtHelper(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split('\n');
  const groups = [];
  let currentGroup = {
    listPath: '',
    words: []
  };

  const formatPhonetic = (p) => {
    if (!p) return '';
    const clean = p.replace(/^[\/\[\s]+|[\/\]\s]+$/g, '');
    return clean ? `/${clean}/` : '';
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex].trim();
    if (!line) continue;

    // Check header {初中/8年级上册/8上Unit1} or ｛...｝ or 【...】
    const headerMatch = line.match(/^[\{｛【]([^\}｝】]+)[\}｝】]$/);
    if (headerMatch) {
      const pathStr = headerMatch[1].trim();
      if (currentGroup.words.length > 0 || currentGroup.listPath) {
        groups.push(currentGroup);
      }
      currentGroup = {
        listPath: pathStr,
        words: []
      };
      continue;
    }

    if (/^\|?[\s\-:]+(\|[\s\-:]+)+\|?$/.test(line)) continue;

    let trimmed = line.replace(/^[\s\(\[\d\.\、\)\-\*\•]+(?=[a-zA-Z])/, '').trim();
    if (!trimmed) continue;

    let word = '';
    let phonetic = '';
    let translation = '';
    let example = '';
    let example_cn = '';

    if (trimmed.includes('|') || trimmed.includes('｜')) {
      let inner = trimmed.replace(/^(\||｜)/, '').replace(/(\||｜)$/, '');
      const cols = inner.split(/\||｜/).map(c => c.trim());
      if (cols.length >= 2) {
        word = cols[0];
        if (cols.length >= 5) {
          phonetic = formatPhonetic(cols[1]);
          translation = cols[2];
          example = cols[3];
          example_cn = cols[4];
        } else if (cols.length === 4) {
          if (/^[\/\[].*[\/\]]$/.test(cols[1]) || !/[\u4e00-\u9fa5]/.test(cols[1])) {
            phonetic = formatPhonetic(cols[1]);
            translation = cols[2];
            example = cols[3];
          } else {
            translation = cols[1];
            example = cols[2];
            example_cn = cols[3];
          }
        } else if (cols.length === 3) {
          if (/^[\/\[].*[\/\]]$/.test(cols[1]) || !/[\u4e00-\u9fa5]/.test(cols[1])) {
            phonetic = formatPhonetic(cols[1]);
            translation = cols[2];
          } else {
            translation = cols[1];
            example = cols[2];
          }
        } else {
          translation = cols[1];
        }
      }
    } else if (trimmed.includes('\t')) {
      const cols = trimmed.split('\t').map(c => c.trim());
      if (cols.length >= 2) {
        word = cols[0];
        if (cols.length >= 5) {
          phonetic = formatPhonetic(cols[1]);
          translation = cols[2];
          example = cols[3];
          example_cn = cols[4];
        } else if (cols.length === 4) {
          if (/^[\/\[].*[\/\]]$/.test(cols[1]) || !/[\u4e00-\u9fa5]/.test(cols[1])) {
            phonetic = formatPhonetic(cols[1]);
            translation = cols[2];
            example = cols[3];
          } else {
            translation = cols[1];
            example = cols[2];
            example_cn = cols[3];
          }
        } else if (cols.length === 3) {
          if (/^[\/\[].*[\/\]]$/.test(cols[1]) || !/[\u4e00-\u9fa5]/.test(cols[1])) {
            phonetic = formatPhonetic(cols[1]);
            translation = cols[2];
          } else {
            translation = cols[1];
            example = cols[2];
          }
        } else {
          translation = cols[1];
        }
      }
    }

    if (word) {
      currentGroup.words.push({
        word,
        phonetic,
        translation,
        example,
        example_cn,
        selected: true
      });
    }
  }

  if (currentGroup.words.length > 0 || currentGroup.listPath) {
    groups.push(currentGroup);
  }

  return groups;
}

// Batch import structured words with hierarchy list paths (e.g. from TXT)
router.post('/words/import-structured', authRequired, (req, res) => {
  try {
    let { groups, text, defaultListId } = req.body;
    if (!groups && text) {
      groups = parseStructuredTxtHelper(text);
    }
    if (!Array.isArray(groups) || groups.length === 0) {
      return res.status(400).json({ error: '没有提供有效的词单或单词数据' });
    }

    const isAdmin = req.user.role === 'admin';
    const wordUserId = isAdmin ? null : req.user.id;
    const wordIsPublic = isAdmin ? 1 : 0;

    const insertWord = db.prepare(`
      INSERT INTO words (word, phonetic, translation, example, example_cn, sort_order, user_id, is_public)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertListWord = db.prepare(`
      INSERT OR IGNORE INTO list_words (list_id, word_id, sort_order)
      VALUES (?, ?, ?)
    `);

    const maxMasterRow = db.prepare('SELECT MAX(sort_order) as m FROM words').get();
    let masterSort = maxMasterRow?.m || 0;

    let totalImported = 0;
    const resolvedLists = [];

    // Pre-check: if defaultListId is public and user is not admin, reject
    if (defaultListId && !isAdmin) {
      const targetList = db.prepare('SELECT * FROM lists WHERE id = ?').get(defaultListId);
      if (targetList && (targetList.is_public === 1 || targetList.user_id === null)) {
        return res.status(403).json({ error: '普通用户无法直接向公共词单批量导入词汇，请选择个人私有词单' });
      }
    }

    const importTransaction = db.transaction(() => {
      for (const group of groups) {
        let targetListId = null;
        if (group.listPath && group.listPath.trim()) {
          targetListId = resolveOrCreateListPath(group.listPath.trim(), req.user);
          if (targetListId && !resolvedLists.includes(targetListId)) {
            resolvedLists.push(targetListId);
          }
        } else if (group.listId) {
          targetListId = Number(group.listId);
        } else if (defaultListId) {
          targetListId = Number(defaultListId);
        }

        // Permission check for group target list
        if (targetListId && !isAdmin) {
          const checkList = db.prepare('SELECT * FROM lists WHERE id = ?').get(targetListId);
          if (checkList && (checkList.is_public === 1 || checkList.user_id === null)) {
            throw new Error(`普通用户无法直接向公共词单【${checkList.name}】导入词汇`);
          }
        }

        let listOrder = 0;
        if (targetListId) {
          const maxRow = db.prepare('SELECT MAX(sort_order) as m FROM list_words WHERE list_id = ?').get(targetListId);
          listOrder = (maxRow?.m || 0) + 1;
        }

        const wordsToImport = (group.words || []).filter(w => w.selected !== false);
        for (const item of wordsToImport) {
          if (!item.word || !item.word.trim()) continue;
          const w = item.word.trim();
          const info = insertWord.run(
            w,
            (item.phonetic || '').trim(),
            (item.translation || '').trim(),
            (item.example || '').trim(),
            (item.example_cn || '').trim(),
            ++masterSort,
            wordUserId,
            wordIsPublic
          );
          const newWordId = info.lastInsertRowid;
          totalImported++;

          if (targetListId) {
            insertListWord.run(targetListId, newWordId, listOrder++);
          }
        }
      }
    });

    importTransaction();

    res.json({
      success: true,
      importedCount: totalImported,
      groupCount: groups.length,
      resolvedListIds: resolvedLists
    });
  } catch (err) {
    console.error('Structured import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Batch assign existing words to a list
router.post('/words/batch-assign', authRequired, (req, res) => {
  try {
    const { wordIds, listId } = req.body;
    if (!listId) {
      return res.status(400).json({ error: '请选择目标词单' });
    }
    if (!Array.isArray(wordIds) || wordIds.length === 0) {
      return res.status(400).json({ error: '请选择要添加的单词' });
    }

    const targetList = db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
    if (!targetList) {
      return res.status(404).json({ error: '目标词单不存在' });
    }
    if ((targetList.is_public === 1 || targetList.user_id === null) && req.user.role !== 'admin') {
      return res.status(403).json({ error: '普通用户不能直接往公共词单加入词汇，可加入您自己的私人词单' });
    }
    if (targetList.user_id !== null && targetList.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '无权操作其他用户的词单' });
    }

    const maxRow = db.prepare('SELECT MAX(sort_order) as m FROM list_words WHERE list_id = ?').get(listId);
    let order = (maxRow?.m || 0) + 1;

    const insertListWord = db.prepare(`
      INSERT OR IGNORE INTO list_words (list_id, word_id, sort_order)
      VALUES (?, ?, ?)
    `);

    const transaction = db.transaction((ids) => {
      for (const id of ids) {
        insertListWord.run(listId, id, order++);
      }
    });

    transaction(wordIds);

    res.json({ success: true, count: wordIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a word
router.put('/words/:id', authRequired, (req, res) => {
  try {
    const { id } = req.params;
    const { word, phonetic, translation, example, example_cn, mistake_count, is_public } = req.body;
    if (!word || !word.trim()) {
      return res.status(400).json({ error: '单词拼写不能为空' });
    }

    const existing = db.prepare('SELECT * FROM words WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: '单词未找到' });
    }

    const isAdmin = req.user.role === 'admin';

    // If public word, only admin can directly update
    if ((existing.is_public === 1 || existing.user_id === null) && !isAdmin) {
      return res.status(403).json({ error: '公共词库的词条不能直接修改，请提交修改申请待管理员审核合入' });
    }
    // If other user's private word, disallow
    if (existing.user_id !== null && existing.user_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: '无权修改其他用户的词条' });
    }
    // If regular user attempts to change private word into public directly
    if (!isAdmin && is_public === 1 && existing.is_public === 0) {
      return res.status(403).json({ error: '将私有词条发布为公共词条需提交审核申请待管理员合入' });
    }

    if (mistake_count !== undefined) {
      const mc = Math.max(0, parseInt(mistake_count, 10) || 0);
      db.prepare(`
        INSERT INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, word_id) DO UPDATE SET
          mistake_count = excluded.mistake_count,
          updated_at = CURRENT_TIMESTAMP
      `).run(req.user.id, id, mc);
    }

    // Determine target is_public and user_id (admin can switch is_public)
    let newIsPublic = existing.is_public;
    let newUserId = existing.user_id;
    if (isAdmin && is_public !== undefined) {
      newIsPublic = is_public === 1 ? 1 : 0;
      newUserId = newIsPublic === 1 ? null : (existing.user_id || req.user.id);
    }

    const stmt = db.prepare(`
      UPDATE words SET
        word = ?,
        phonetic = ?,
        translation = ?,
        example = ?,
        example_cn = ?,
        is_public = ?,
        user_id = ?
      WHERE id = ?
    `);
    stmt.run(
      word.trim(),
      (phonetic || '').trim(),
      (translation || '').trim(),
      (example || '').trim(),
      (example_cn || '').trim(),
      newIsPublic,
      newUserId,
      id
    );

    const updated = db.prepare(`
      SELECT w.*, COALESCE(uwm.mistake_count, 0) as mistake_count
      FROM words w
      LEFT JOIN user_word_mistakes uwm ON uwm.word_id = w.id AND uwm.user_id = ?
      WHERE w.id = ?
    `).get(req.user.id, id);

    res.json({ success: true, word: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit a private word to become a public word (Normal user -> Audit; Admin -> Directly public)
router.post('/words/:id/submit-public', authRequired, (req, res) => {
  try {
    const { id } = req.params;
    const { reason = '' } = req.body;
    const existing = db.prepare('SELECT * FROM words WHERE id = ?').get(id);

    if (!existing) {
      return res.status(404).json({ error: '未找到指定单词' });
    }

    const isAdmin = req.user.role === 'admin';

    // Already public
    if (existing.is_public === 1 || existing.user_id === null) {
      return res.status(400).json({ error: '该单词已在公共词库中，无需重复申请' });
    }

    // Must be the owner or admin
    if (existing.user_id !== null && existing.user_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: '无权操作其他用户的私有词条' });
    }

    // Admin can publish directly
    if (isAdmin) {
      db.prepare('UPDATE words SET is_public = 1, user_id = NULL WHERE id = ?').run(id);
      return res.json({
        success: true,
        directlyPublished: true,
        message: `已成功将单词【${existing.word}】发布至公共词库！`
      });
    }

    // Normal user: check 10 pending requests limit
    const pendingRow = db.prepare("SELECT COUNT(*) as count FROM change_requests WHERE user_id = ? AND status = 'pending'").get(req.user.id);
    const pendingCount = pendingRow?.count || 0;
    if (pendingCount >= 10) {
      return res.status(400).json({ 
        error: '您当前已有 10 条待审核条目，已达上限，暂无法继续操作。请等待管理员审核后再提交新申请。',
        pendingCount,
        maxPending: 10
      });
    }

    // Check duplicate pending request
    const duplicate = db.prepare(`
      SELECT id FROM change_requests 
      WHERE user_id = ? AND target_id = ? AND (type = 'word_publish' OR type = 'publish_word') AND status = 'pending'
    `).get(req.user.id, id);

    if (duplicate) {
      return res.status(400).json({ error: `单词【${existing.word}】已提交过加入公共词库申请，正在审核中，请勿重复提交` });
    }

    // Insert change request
    const payload = {
      word_id: existing.id,
      word: existing.word,
      phonetic: existing.phonetic || '',
      translation: existing.translation || '',
      example: existing.example || '',
      example_cn: existing.example_cn || '',
      user_reason: reason.trim(),
    };

    const info = db.prepare(`
      INSERT INTO change_requests (user_id, user_email, user_name, type, target_id, target_name, payload, status)
      VALUES (?, ?, ?, 'word_publish', ?, ?, ?, 'pending')
    `).run(
      req.user.id,
      req.user.email,
      req.user.username,
      existing.id,
      existing.word,
      JSON.stringify(payload)
    );

    res.json({
      success: true,
      pending: true,
      requestId: info.lastInsertRowid,
      message: `已提交将【${existing.word}】加入公共词库的申请，待管理员审核通过后将正式合入！`
    });
  } catch (err) {
    console.error('Submit word public error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Batch submit private words to become public words
router.post('/words/batch-submit-public', authRequired, (req, res) => {
  try {
    const { wordIds, reason = '' } = req.body;
    if (!Array.isArray(wordIds) || wordIds.length === 0) {
      return res.status(400).json({ error: '请选择要公开的单词' });
    }

    const isAdmin = req.user.role === 'admin';

    // Admin direct batch publish
    if (isAdmin) {
      const stmt = db.prepare('UPDATE words SET is_public = 1, user_id = NULL WHERE id = ?');
      const trans = db.transaction((ids) => {
        for (const id of ids) stmt.run(id);
      });
      trans(wordIds);
      return res.json({
        success: true,
        directlyPublished: true,
        count: wordIds.length,
        message: `已成功将选中的 ${wordIds.length} 个单词发布至全员公共词库！`
      });
    }

    // Normal user: fetch user's own private words
    const placeholders = wordIds.map(() => '?').join(',');
    const privateWords = db.prepare(`
      SELECT * FROM words 
      WHERE id IN (${placeholders}) AND user_id = ? AND is_public = 0
    `).all(...wordIds, req.user.id);

    if (privateWords.length === 0) {
      return res.status(400).json({ error: '选中的单词中没有您独有的私有词条或已是公共词条' });
    }

    // Check pending count and limit
    const pendingRow = db.prepare("SELECT COUNT(*) as count FROM change_requests WHERE user_id = ? AND status = 'pending'").get(req.user.id);
    const pendingCount = pendingRow?.count || 0;
    const maxPending = 10;
    const availableQuota = Math.max(0, maxPending - pendingCount);

    if (availableQuota <= 0) {
      return res.status(400).json({ 
        error: '您当前已有 10 条待审核条目，已达上限，暂无法继续操作。请等待管理员审核后再提交新申请。',
        pendingCount,
        maxPending
      });
    }

    // Exclude words that already have a pending request
    const pendingRequests = db.prepare(`
      SELECT target_id FROM change_requests 
      WHERE user_id = ? AND (type = 'word_publish' OR type = 'publish_word') AND status = 'pending'
    `).all(req.user.id);
    const pendingWordIds = new Set(pendingRequests.map(r => r.target_id));

    const eligibleWords = privateWords.filter(w => !pendingWordIds.has(w.id));
    if (eligibleWords.length === 0) {
      return res.status(400).json({ error: '选中的私有单词均已在待审核队列中，请勿重复提交' });
    }

    // Take up to available quota
    const wordsToSubmit = eligibleWords.slice(0, availableQuota);
    const insertStmt = db.prepare(`
      INSERT INTO change_requests (user_id, user_email, user_name, type, target_id, target_name, payload, status)
      VALUES (?, ?, ?, 'word_publish', ?, ?, ?, 'pending')
    `);

    const submitTrans = db.transaction((wordsList) => {
      for (const w of wordsList) {
        const payload = {
          word_id: w.id,
          word: w.word,
          phonetic: w.phonetic || '',
          translation: w.translation || '',
          example: w.example || '',
          example_cn: w.example_cn || '',
          user_reason: reason.trim(),
        };
        insertStmt.run(
          req.user.id,
          req.user.email,
          req.user.username,
          w.id,
          w.word,
          JSON.stringify(payload)
        );
      }
    });

    submitTrans(wordsToSubmit);

    const submittedCount = wordsToSubmit.length;
    const skippedCount = eligibleWords.length - wordsToSubmit.length;

    let msg = `已成功提交 ${submittedCount} 个独有单词的公共词库申请，请等待管理员审核！`;
    if (skippedCount > 0) {
      msg += `（受每人最多 10 条待审核限制，其余 ${skippedCount} 个单词未能提交，请等待处理后再试）`;
    }

    res.json({
      success: true,
      pending: true,
      submittedCount,
      skippedCount,
      message: msg
    });
  } catch (err) {
    console.error('Batch submit word public error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/words/current
// Get the current active/playing word from session
router.get('/words/current', optionalAuth, (req, res) => {
  try {
    const curWord = haRouter.getCurrentWord?.();
    if (!curWord) {
      return res.status(404).json({ error: '当前没有活动的播放单词' });
    }
    const userId = req.user?.id || null;
    let mistakeCount = curWord.mistake_count || 0;
    if (userId) {
      const row = db.prepare('SELECT mistake_count FROM user_word_mistakes WHERE user_id = ? AND word_id = ?').get(userId, curWord.id);
      mistakeCount = row?.mistake_count || 0;
    }
    res.json({
      success: true,
      word: { ...curWord, mistake_count: mistakeCount },
      is_mistake: mistakeCount > 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST or GET /api/words/current/mistake (or /words/current/mark-mistake)
// Mark current playing word as mistake
router.all(['/words/current/mistake', '/words/current/mark-mistake'], optionalAuth, (req, res) => {
  try {
    const curWord = haRouter.getCurrentWord?.();
    if (!curWord) {
      return res.status(404).json({ error: '当前没有活动的播放单词' });
    }

    // Default to current user or admin
    let targetUserId = req.user?.id;
    if (!targetUserId) {
      const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").get();
      targetUserId = adminUser?.id || null;
    }

    const count = req.body?.count !== undefined ? req.body.count : req.query?.count;
    const delta = req.body?.delta !== undefined ? req.body.delta : (req.query?.delta || 1);

    let newCount;
    let curCount = 0;
    if (targetUserId) {
      const rec = db.prepare('SELECT mistake_count FROM user_word_mistakes WHERE user_id = ? AND word_id = ?').get(targetUserId, curWord.id);
      curCount = rec?.mistake_count || 0;
    }

    if (count !== undefined) {
      newCount = Math.max(0, parseInt(count, 10) || 0);
    } else {
      newCount = Math.max(1, curCount + parseInt(delta, 10));
    }

    if (targetUserId) {
      db.prepare(`
        INSERT INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, word_id) DO UPDATE SET
          mistake_count = excluded.mistake_count,
          updated_at = CURRENT_TIMESTAMP
      `).run(targetUserId, curWord.id, newCount);

      try {
        const recent = db.prepare(`
          SELECT id FROM records 
          WHERE word_id = ? AND user_id = ? AND mode = 'dictation' AND created_at >= datetime('now', '-15 minutes')
          ORDER BY id DESC LIMIT 1
        `).get(curWord.id, targetUserId);

        if (recent) {
          db.prepare("UPDATE records SET is_correct = 0, user_input = 'ha_mistake', score = 0 WHERE id = ?").run(recent.id);
        } else {
          db.prepare("INSERT INTO records (word_id, mode, is_correct, user_input, score, user_id) VALUES (?, 'dictation', 0, 'ha_mistake', 0, ?)").run(curWord.id, targetUserId);
        }
      } catch (e) {}
    }

    curWord.mistake_count = newCount;
    const updated = db.prepare(`
      SELECT w.*, COALESCE(uwm.mistake_count, 0) as mistake_count
      FROM words w
      LEFT JOIN user_word_mistakes uwm ON uwm.word_id = w.id AND uwm.user_id = ?
      WHERE w.id = ?
    `).get(targetUserId, curWord.id);

    res.json({
      success: true,
      word: updated || curWord,
      is_mistake: newCount > 0,
      message: `已将【${curWord.word}】标记为易错词 (累计 ${newCount} 次)`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST or GET /api/words/current/reset-mistake (or /words/current/unmark-mistake)
router.all(['/words/current/reset-mistake', '/words/current/unmark-mistake'], optionalAuth, (req, res) => {
  try {
    const curWord = haRouter.getCurrentWord?.();
    if (!curWord) {
      return res.status(404).json({ error: '当前没有活动的播放单词' });
    }

    let targetUserId = req.user?.id;
    if (!targetUserId) {
      const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").get();
      targetUserId = adminUser?.id || null;
    }

    if (targetUserId) {
      db.prepare(`
        INSERT INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
        VALUES (?, ?, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, word_id) DO UPDATE SET
          mistake_count = 0,
          updated_at = CURRENT_TIMESTAMP
      `).run(targetUserId, curWord.id);

      try {
        const recent = db.prepare(`
          SELECT id FROM records 
          WHERE word_id = ? AND user_id = ? AND mode = 'dictation' AND created_at >= datetime('now', '-15 minutes')
          ORDER BY id DESC LIMIT 1
        `).get(curWord.id, targetUserId);

        if (recent) {
          db.prepare("UPDATE records SET is_correct = 1, user_input = 'ha_playback', score = 100 WHERE id = ?").run(recent.id);
        }
      } catch (e) {}
    }

    curWord.mistake_count = 0;
    const updated = db.prepare(`
      SELECT w.*, 0 as mistake_count
      FROM words w
      WHERE w.id = ?
    `).get(curWord.id);

    res.json({
      success: true,
      word: updated || curWord,
      is_mistake: false,
      message: `已取消【${curWord.word}】的易错标记`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set or adjust mistake count for a word (设置错误次数, 支持指定次数或加减)
router.post('/words/:id/mistake', authRequired, (req, res) => {
  try {
    const { id } = req.params;
    const { count, delta } = req.body;
    const userId = req.user.id;

    const wordRow = db.prepare('SELECT id, word FROM words WHERE id = ?').get(id);
    if (!wordRow) return res.status(404).json({ error: '未找到指定单词' });

    let newCount;
    const currentRec = db.prepare('SELECT mistake_count FROM user_word_mistakes WHERE user_id = ? AND word_id = ?').get(userId, id);
    const currentCount = currentRec?.mistake_count || 0;

    if (count !== undefined) {
      newCount = Math.max(0, parseInt(count, 10) || 0);
    } else if (delta !== undefined) {
      newCount = Math.max(0, currentCount + (parseInt(delta, 10) || 0));
    } else {
      newCount = currentCount + 1;
    }

    db.prepare(`
      INSERT INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, word_id) DO UPDATE SET
        mistake_count = excluded.mistake_count,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, id, newCount);

    const updated = db.prepare(`
      SELECT w.*, COALESCE(uwm.mistake_count, 0) as mistake_count
      FROM words w
      LEFT JOIN user_word_mistakes uwm ON uwm.word_id = w.id AND uwm.user_id = ?
      WHERE w.id = ?
    `).get(userId, id);

    res.json({ success: true, word: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset / remove mistake count for a word (去除错误次数 / 归零)
router.post('/words/:id/reset-mistake', authRequired, (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const wordRow = db.prepare('SELECT id, word FROM words WHERE id = ?').get(id);
    if (!wordRow) return res.status(404).json({ error: '未找到指定单词' });

    db.prepare(`
      INSERT INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
      VALUES (?, ?, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, word_id) DO UPDATE SET
        mistake_count = 0,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, id);

    const updated = db.prepare(`
      SELECT w.*, 0 as mistake_count
      FROM words w
      WHERE w.id = ?
    `).get(id);

    res.json({ success: true, word: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Batch adjust or reset mistake counts for multiple words (批量设置或去除错误次数)
router.post('/words/batch-mistake', authRequired, (req, res) => {
  try {
    const { wordIds, action, value = 0 } = req.body;
    if (!Array.isArray(wordIds) || wordIds.length === 0) {
      return res.status(400).json({ error: '请选择单词' });
    }
    const userId = req.user.id;

    if (action === 'reset' || action === 'clear') {
      const stmt = db.prepare(`
        INSERT INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
        VALUES (?, ?, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, word_id) DO UPDATE SET
          mistake_count = 0,
          updated_at = CURRENT_TIMESTAMP
      `);
      const trans = db.transaction((ids) => {
        for (const id of ids) stmt.run(userId, id);
      });
      trans(wordIds);
    } else if (action === 'increment') {
      const stmt = db.prepare(`
        INSERT INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, word_id) DO UPDATE SET
          mistake_count = mistake_count + 1,
          updated_at = CURRENT_TIMESTAMP
      `);
      const trans = db.transaction((ids) => {
        for (const id of ids) stmt.run(userId, id);
      });
      trans(wordIds);
    } else if (action === 'set') {
      const val = Math.max(0, parseInt(value, 10) || 0);
      const stmt = db.prepare(`
        INSERT INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, word_id) DO UPDATE SET
          mistake_count = excluded.mistake_count,
          updated_at = CURRENT_TIMESTAMP
      `);
      const trans = db.transaction((ids) => {
        for (const id of ids) stmt.run(userId, id, val);
      });
      trans(wordIds);
    }

    res.json({ success: true, count: wordIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a word from the master library
router.delete('/words/:id', authRequired, (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM words WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: '单词未找到' });
    }

    // If public word, only admin can delete
    if ((existing.is_public === 1 || existing.user_id === null) && req.user.role !== 'admin') {
      return res.status(403).json({ error: '公共词库的词条不能直接删除，请向管理员提交删除申请' });
    }
    // If other user's word
    if (existing.user_id !== null && existing.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '无权删除其他用户的词条' });
    }

    db.prepare('DELETE FROM list_words WHERE word_id = ?').run(id);
    db.prepare('DELETE FROM records WHERE word_id = ?').run(id);
    db.prepare('DELETE FROM user_word_mistakes WHERE word_id = ?').run(id);
    db.prepare('DELETE FROM words WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Batch delete words (from specific list or entire master library)
router.post('/words/batch-delete', authRequired, (req, res) => {
  try {
    const { wordIds, listId } = req.body;
    if (!Array.isArray(wordIds) || wordIds.length === 0) {
      return res.status(400).json({ error: '请选择要删除的单词' });
    }

    if (listId && listId !== 'unassigned' && listId !== 'all') {
      const targetList = db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
      if (targetList && (targetList.is_public === 1 || targetList.user_id === null) && req.user.role !== 'admin') {
        return res.status(403).json({ error: '普通用户无法直接修改公共词单中的词汇' });
      }
      if (targetList && targetList.user_id !== null && targetList.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: '无权操作其他用户的词单' });
      }

      // Remove from specific list
      const stmt = db.prepare('DELETE FROM list_words WHERE list_id = ? AND word_id = ?');
      const trans = db.transaction((ids) => {
        for (const id of ids) stmt.run(listId, id);
      });
      trans(wordIds);
    } else {
      // Delete from whole library
      if (req.user.role !== 'admin') {
        // Normal user can only delete their own private words
        const delListWords = db.prepare('DELETE FROM list_words WHERE word_id IN (SELECT id FROM words WHERE id = ? AND user_id = ?)');
        const delRecords = db.prepare('DELETE FROM records WHERE word_id IN (SELECT id FROM words WHERE id = ? AND user_id = ?)');
        const delUserMistakes = db.prepare('DELETE FROM user_word_mistakes WHERE word_id IN (SELECT id FROM words WHERE id = ? AND user_id = ?)');
        const delWords = db.prepare('DELETE FROM words WHERE id = ? AND user_id = ?');
        const trans = db.transaction((ids) => {
          for (const id of ids) {
            delListWords.run(id, req.user.id);
            delRecords.run(id, req.user.id);
            delUserMistakes.run(id, req.user.id);
            delWords.run(id, req.user.id);
          }
        });
        trans(wordIds);
      } else {
        const delListWords = db.prepare('DELETE FROM list_words WHERE word_id = ?');
        const delRecords = db.prepare('DELETE FROM records WHERE word_id = ?');
        const delUserMistakes = db.prepare('DELETE FROM user_word_mistakes WHERE word_id = ?');
        const delWords = db.prepare('DELETE FROM words WHERE id = ?');
        const trans = db.transaction((ids) => {
          for (const id of ids) {
            delListWords.run(id);
            delRecords.run(id);
            delUserMistakes.run(id);
            delWords.run(id);
          }
        });
        trans(wordIds);
      }
    }

    res.json({ success: true, count: wordIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Study Records & Feedback ---

// Record a test result (dictation or speech recording)
router.post('/records', optionalAuth, (req, res) => {
  try {
    const { word_id, mode, is_correct = 1, user_input = '', score = 0 } = req.body;
    if (!word_id || !mode) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const userId = req.user?.id || null;

    const stmt = db.prepare(`
      INSERT INTO records (word_id, mode, is_correct, user_input, score, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(word_id, mode, is_correct ? 1 : 0, user_input, score, userId);

    // If dictation and wrong, auto increment word's mistake_count for current user
    if (mode === 'dictation' && !is_correct && userId) {
      db.prepare(`
        INSERT INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, word_id) DO UPDATE SET
          mistake_count = mistake_count + 1,
          updated_at = CURRENT_TIMESTAMP
      `).run(userId, word_id);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get overall stats
router.get('/records/stats', optionalAuth, (req, res) => {
  try {
    const userId = req.user?.id || null;
    let baseWhere = userId 
      ? '(is_public = 1 OR user_id IS NULL OR user_id = ?)' 
      : '(is_public = 1 OR user_id IS NULL)';
    const params = userId ? [userId] : [];

    const totalWords = db.prepare(`SELECT COUNT(*) as count FROM words WHERE ${baseWhere}`).get(...params).count;
    const totalLists = db.prepare(`SELECT COUNT(*) as count FROM lists WHERE ${baseWhere}`).get(...params).count;
    
    let recordWhere = userId ? 'WHERE mode = \'dictation\' AND (user_id IS NULL OR user_id = ?)' : 'WHERE mode = \'dictation\'';
    const dictationStats = db.prepare(`
      SELECT 
        COUNT(*) as total_attempts,
        SUM(is_correct) as correct_attempts
      FROM records 
      ${recordWhere}
    `).get(...(userId ? [userId] : []));

    let memoryWhere = userId ? 'WHERE mode = \'memory\' AND score > 0 AND (user_id IS NULL OR user_id = ?)' : 'WHERE mode = \'memory\' AND score > 0';
    const memoryStats = db.prepare(`
      SELECT 
        COUNT(*) as total_spoken,
        AVG(score) as avg_score
      FROM records 
      ${memoryWhere}
    `).get(...(userId ? [userId] : []));

    res.json({
      totalWords,
      totalLists,
      dictation: {
        total: dictationStats.total_attempts || 0,
        correct: dictationStats.correct_attempts || 0,
        accuracy: dictationStats.total_attempts ? Math.round((dictationStats.correct_attempts / dictationStats.total_attempts) * 100) : 0
      },
      speech: {
        totalPracticed: memoryStats.total_spoken || 0,
        avgScore: Math.round(memoryStats.avg_score || 0)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
