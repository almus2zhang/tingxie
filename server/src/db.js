const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'tingxie.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    phonetic TEXT DEFAULT '',
    phonetic_us TEXT DEFAULT '',
    phonetic_uk TEXT DEFAULT '',
    translation TEXT DEFAULT '',
    pos TEXT DEFAULT '',
    example TEXT DEFAULT '',
    example_cn TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    mistake_count INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_words_word ON words (word COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS list_words (
    list_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (list_id, word_id),
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    mode TEXT NOT NULL, -- 'dictation' | 'memory'
    is_correct INTEGER DEFAULT 1,
    user_input TEXT DEFAULT '',
    score INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS daily_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_date TEXT NOT NULL, -- 'YYYY-MM-DD'
    word_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(plan_date, word_id, user_id),
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_daily_plans_date ON daily_plans(plan_date);
  CREATE INDEX IF NOT EXISTS idx_daily_plans_user_date ON daily_plans(user_id, plan_date);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT NOT NULL,
    value TEXT,
    user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (key, user_id)
  );

  CREATE TABLE IF NOT EXISTS daily_plan_meta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_date TEXT NOT NULL,
    title TEXT DEFAULT '',
    description TEXT DEFAULT '',
    is_shuffle INTEGER DEFAULT 0,
    user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(plan_date, user_id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', -- 'admin' | 'user'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS email_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'register',
    expires_at DATETIME NOT NULL,
    is_used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_email_verif ON email_verifications(email, code);

  CREATE TABLE IF NOT EXISTS change_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_email TEXT NOT NULL,
    user_name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'create_word' | 'update_word' | 'delete_word' | 'create_list'
    target_id INTEGER,  -- 针对修改或删除的目标 word_id 或 list_id（新增时为 NULL）
    target_name TEXT,  -- 单词拼写或词单名称
    payload TEXT NOT NULL, -- JSON 格式包含具体变更内容
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
    admin_comment TEXT DEFAULT '',
    reviewed_by INTEGER,
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_word_mistakes (
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    mistake_count INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, word_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_uwm_user_mistake ON user_word_mistakes(user_id, mistake_count);
`);

// Migration: Migrate existing words.mistake_count > 0 to user_word_mistakes for the first admin
try {
  const uwmCount = db.prepare('SELECT COUNT(*) as count FROM user_word_mistakes').get()?.count || 0;
  if (uwmCount === 0) {
    const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").get();
    if (adminUser) {
      db.exec(`
        INSERT OR IGNORE INTO user_word_mistakes (user_id, word_id, mistake_count, updated_at)
        SELECT ${adminUser.id}, id, mistake_count, CURRENT_TIMESTAMP
        FROM words
        WHERE mistake_count > 0;
      `);
      console.log(`Migrated historical mistakes to admin user id ${adminUser.id}`);
    }
  }
} catch (mErr) {
  console.warn('Mistakes migration notice:', mErr.message);
}

// Migration: Ensure words table has user_id and is_public columns
const wordsTableCols = db.prepare('PRAGMA table_info(words)').all();
if (!wordsTableCols.some(c => c.name === 'user_id')) {
  db.exec('ALTER TABLE words ADD COLUMN user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE');
}
if (!wordsTableCols.some(c => c.name === 'is_public')) {
  db.exec('ALTER TABLE words ADD COLUMN is_public INTEGER DEFAULT 1');
}

// Migration: Ensure lists table has user_id and is_public columns
const listsTableCols = db.prepare('PRAGMA table_info(lists)').all();
if (!listsTableCols.some(c => c.name === 'user_id')) {
  db.exec('ALTER TABLE lists ADD COLUMN user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE');
}
if (!listsTableCols.some(c => c.name === 'is_public')) {
  db.exec('ALTER TABLE lists ADD COLUMN is_public INTEGER DEFAULT 1');
}

// Migration: Ensure daily_plans has user_id column and (plan_date, word_id, user_id) unique constraint
const dailyPlansCols = db.prepare('PRAGMA table_info(daily_plans)').all();
if (!dailyPlansCols.some(c => c.name === 'user_id')) {
  db.exec('ALTER TABLE daily_plans ADD COLUMN user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE');
}

// Check if daily_plans has the old UNIQUE(plan_date, word_id) without user_id
const dailyPlansIndexes = db.prepare('PRAGMA index_list(daily_plans)').all();
const hasOldDailyPlansUnique = dailyPlansIndexes.some(idx => {
  if (!idx.unique) return false;
  const cols = db.prepare(`PRAGMA index_info('${idx.name}')`).all();
  return cols.length === 2 && cols.some(c => c.name === 'plan_date') && cols.some(c => c.name === 'word_id');
});

if (hasOldDailyPlansUnique) {
  console.log('Migrating daily_plans to support per-user UNIQUE constraint...');
  const firstAdmin = db.prepare('SELECT id FROM users WHERE role = ? ORDER BY id ASC LIMIT 1').get('admin');
  const defaultUserId = firstAdmin?.id || 3;

  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    // If any user_id is null, assign to default admin
    db.prepare('UPDATE daily_plans SET user_id = ? WHERE user_id IS NULL').run(defaultUserId);

    db.exec(`
      CREATE TABLE daily_plans_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_date TEXT NOT NULL,
        word_id INTEGER NOT NULL,
        sort_order INTEGER DEFAULT 0,
        user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(plan_date, word_id, user_id),
        FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
      );

      INSERT INTO daily_plans_new (id, plan_date, word_id, sort_order, user_id, created_at)
        SELECT id, plan_date, word_id, sort_order, user_id, created_at FROM daily_plans;

      DROP TABLE daily_plans;
      ALTER TABLE daily_plans_new RENAME TO daily_plans;
      CREATE INDEX IF NOT EXISTS idx_daily_plans_date ON daily_plans(plan_date);
      CREATE INDEX IF NOT EXISTS idx_daily_plans_user_date ON daily_plans(user_id, plan_date);
    `);
  })();
  db.pragma('foreign_keys = ON');
}

// Migration: Ensure daily_plan_meta has user_id and UNIQUE(plan_date, user_id)
const metaCols = db.prepare('PRAGMA table_info(daily_plan_meta)').all();
const planDateIsPk = metaCols.some(c => c.name === 'plan_date' && c.pk === 1);
if (planDateIsPk) {
  console.log('Migrating daily_plan_meta to support per-user task titles and settings...');
  const firstAdmin = db.prepare('SELECT id FROM users WHERE role = ? ORDER BY id ASC LIMIT 1').get('admin');
  const defaultUserId = firstAdmin?.id || 3;

  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE daily_plan_meta_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_date TEXT NOT NULL,
        title TEXT DEFAULT '',
        description TEXT DEFAULT '',
        is_shuffle INTEGER DEFAULT 0,
        user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(plan_date, user_id)
      );
    `);

    const oldRows = db.prepare('SELECT plan_date, title, description, is_shuffle, user_id, updated_at FROM daily_plan_meta').all();
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO daily_plan_meta_new (plan_date, title, description, is_shuffle, user_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const r of oldRows) {
      insertStmt.run(r.plan_date, r.title || '', r.description || '', r.is_shuffle || 0, r.user_id || defaultUserId, r.updated_at);
    }

    db.exec(`
      DROP TABLE daily_plan_meta;
      ALTER TABLE daily_plan_meta_new RENAME TO daily_plan_meta;
      CREATE INDEX IF NOT EXISTS idx_daily_plan_meta_user_date ON daily_plan_meta(user_id, plan_date);
    `);
  })();
  db.pragma('foreign_keys = ON');
}

// Migration: Ensure app_settings supports user_id
const appSettingsCols = db.prepare('PRAGMA table_info(app_settings)').all();
if (!appSettingsCols.some(c => c.name === 'user_id')) {
  console.log('Migrating app_settings to support user_id...');
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE app_settings_new (
        key TEXT NOT NULL,
        value TEXT,
        user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (key, user_id)
      );

      INSERT INTO app_settings_new (key, value, user_id, updated_at)
        SELECT key, value, NULL, updated_at FROM app_settings;

      DROP TABLE app_settings;
      ALTER TABLE app_settings_new RENAME TO app_settings;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

// Migration: Ensure records has user_id column
const recordsCols = db.prepare('PRAGMA table_info(records)').all();
if (!recordsCols.some(c => c.name === 'user_id')) {
  db.exec('ALTER TABLE records ADD COLUMN user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE');
}

// Migration: Ensure any legacy 'ha' records are counted into dictation for admin
try {
  const adminRow = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").get();
  if (adminRow) {
    db.prepare("UPDATE records SET user_id = ? WHERE mode = 'ha' AND user_id IS NULL").run(adminRow.id);
  }
  db.prepare("UPDATE records SET mode = 'dictation', user_input = 'ha_mistake' WHERE mode = 'ha'").run();
} catch (e) {}

// Migration: Ensure words table has sort_order column
const wordsColumns = db.prepare('PRAGMA table_info(words)').all();
if (!wordsColumns.some(c => c.name === 'sort_order')) {
  db.exec('ALTER TABLE words ADD COLUMN sort_order INTEGER DEFAULT 0');
}

// Migration: Ensure words table has mistake_count column
if (!wordsColumns.some(c => c.name === 'mistake_count')) {
  db.exec('ALTER TABLE words ADD COLUMN mistake_count INTEGER DEFAULT 0');
  try {
    db.exec(`
      UPDATE words 
      SET mistake_count = (
        SELECT COUNT(*) FROM records 
        WHERE records.word_id = words.id AND records.mode = 'dictation' AND records.is_correct = 0
      )
      WHERE mistake_count = 0;
    `);
  } catch (e) {}
}
const zeroSort = db.prepare('SELECT COUNT(*) as c FROM words WHERE sort_order = 0').get();
if (zeroSort.c > 0) {
  db.exec(`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) as seq
      FROM words
    )
    UPDATE words
    SET sort_order = (SELECT seq FROM ranked WHERE ranked.id = words.id);
  `);
}

// Migration: Ensure words table allows duplicate words (remove UNIQUE constraint if present)
const indexList = db.prepare('PRAGMA index_list(words)').all();
const hasUniqueWordIndex = indexList.some(idx => Boolean(idx.unique) && idx.name.includes('autoindex'));
if (hasUniqueWordIndex) {
  db.pragma('foreign_keys = OFF');
  const migration = db.transaction(() => {
    db.exec(`
      CREATE TABLE words_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL,
        phonetic TEXT DEFAULT '',
        phonetic_us TEXT DEFAULT '',
        phonetic_uk TEXT DEFAULT '',
        translation TEXT DEFAULT '',
        pos TEXT DEFAULT '',
        example TEXT DEFAULT '',
        example_cn TEXT DEFAULT '',
        tags TEXT DEFAULT '',
        mistake_count INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO words_new (id, word, phonetic, phonetic_us, phonetic_uk, translation, pos, example, example_cn, tags, mistake_count, sort_order, created_at)
        SELECT id, word, phonetic, phonetic_us, phonetic_uk, translation, pos, example, example_cn, tags, mistake_count, sort_order, created_at FROM words;

      DROP TABLE words;
      ALTER TABLE words_new RENAME TO words;
      CREATE INDEX IF NOT EXISTS idx_words_word ON words (word COLLATE NOCASE);
    `);
  });
  migration();
  db.pragma('foreign_keys = ON');
}

// Migration: Ensure lists table has hierarchical columns (parent_id, is_folder, category_path, sort_order)
const listCols = db.prepare('PRAGMA table_info(lists)').all();
if (!listCols.some(c => c.name === 'parent_id')) {
  db.exec('ALTER TABLE lists ADD COLUMN parent_id INTEGER DEFAULT NULL REFERENCES lists(id) ON DELETE CASCADE');
}
if (!listCols.some(c => c.name === 'is_folder')) {
  db.exec('ALTER TABLE lists ADD COLUMN is_folder INTEGER DEFAULT 0');
}
if (!listCols.some(c => c.name === 'category_path')) {
  db.exec('ALTER TABLE lists ADD COLUMN category_path TEXT DEFAULT \'\'');
}
if (!listCols.some(c => c.name === 'sort_order')) {
  db.exec('ALTER TABLE lists ADD COLUMN sort_order INTEGER DEFAULT 0');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_lists_parent ON lists(parent_id);');

// Helper to find or create a category folder
function ensureCategoryFolder(name, parentId = null, sortOrder = 0) {
  let folder;
  if (parentId) {
    folder = db.prepare('SELECT * FROM lists WHERE name = ? AND parent_id = ? AND is_folder = 1').get(name, parentId);
  } else {
    folder = db.prepare('SELECT * FROM lists WHERE name = ? AND parent_id IS NULL AND is_folder = 1').get(name);
  }
  if (!folder) {
    const res = db.prepare('INSERT INTO lists (name, is_folder, parent_id, sort_order, description) VALUES (?, 1, ?, ?, ?)').run(
      name, parentId, sortOrder, `${name}分类目录`
    );
    folder = db.prepare('SELECT * FROM lists WHERE id = ?').get(res.lastInsertRowid);
  }
  return folder;
}

// Setup standard curriculum structure (小学, 初中, 高中)
try {
  const chuzhong = ensureCategoryFolder('初中', null, 1);
  const chuzhong8Up = ensureCategoryFolder('8年级上册', chuzhong.id, 1);
  ensureCategoryFolder('8年级下册', chuzhong.id, 2);
  ensureCategoryFolder('7年级上册', chuzhong.id, 3);
  ensureCategoryFolder('7年级下册', chuzhong.id, 4);
  ensureCategoryFolder('9年级全册', chuzhong.id, 5);

  const xiaoxue = ensureCategoryFolder('小学', null, 2);
  ensureCategoryFolder('三年级上册', xiaoxue.id, 1);
  ensureCategoryFolder('三年级下册', xiaoxue.id, 2);
  ensureCategoryFolder('四年级上册', xiaoxue.id, 3);
  ensureCategoryFolder('四年级下册', xiaoxue.id, 4);
  ensureCategoryFolder('五年级上册', xiaoxue.id, 5);
  ensureCategoryFolder('六年级上册', xiaoxue.id, 6);

  const gaozhong = ensureCategoryFolder('高中', null, 3);
  ensureCategoryFolder('必修一', gaozhong.id, 1);
  ensureCategoryFolder('必修二', gaozhong.id, 2);
  ensureCategoryFolder('必修三', gaozhong.id, 3);
  ensureCategoryFolder('选择性必修一', gaozhong.id, 4);

  // Auto-classify user existing lists starting with '8上' or '8年级上' into '8年级上册'
  db.prepare(`
    UPDATE lists 
    SET parent_id = ? 
    WHERE is_folder = 0 
      AND parent_id IS NULL 
      AND (name LIKE '8上%' OR name LIKE '8年级上%')
  `).run(chuzhong8Up.id);

  // Auto-classify user lists starting with '7上' into '7年级上册'
  const chuzhong7Up = db.prepare('SELECT id FROM lists WHERE name = ? AND parent_id = ?').get('7年级上册', chuzhong.id);
  if (chuzhong7Up) {
    db.prepare(`
      UPDATE lists 
      SET parent_id = ? 
      WHERE is_folder = 0 
        AND parent_id IS NULL 
        AND (name LIKE '7上%' OR name LIKE '7年级上%')
    `).run(chuzhong7Up.id);
  }
} catch (e) {
  console.warn('Hierarchy seed error:', e.message);
}

// Pre-seed some default lists and initial vocabulary if empty
const countLists = db.prepare('SELECT COUNT(*) as count FROM lists').get();
if (countLists.count === 0) {
  const insertList = db.prepare('INSERT INTO lists (name, description) VALUES (?, ?)');
  const defaultList = insertList.run('精选高频核心词汇', '适用于日常听写与发音练习的基础核心词');
  const defaultListId = defaultList.lastInsertRowid;

  const sampleWords = [
    {
      word: 'abandon',
      phonetic: '/əˈbændən/',
      translation: 'v. 放弃，遗弃；n. 放任',
      example: 'He decided to abandon the plan due to lack of funds.',
      example_cn: '由于缺乏资金，他决定放弃这项计划。'
    },
    {
      word: 'brilliant',
      phonetic: '/ˈbrɪljənt/',
      translation: 'adj. 杰出的；灿烂的；极其聪颖的',
      example: 'She came up with a brilliant idea during the brainstorming session.',
      example_cn: '在头脑风暴会议上，她想出了一个绝妙的主意。'
    },
    {
      word: 'challenge',
      phonetic: '/ˈtʃælɪndʒ/',
      translation: 'n. 挑战，艰巨任务；v. 向...挑战',
      example: 'Learning a new language is a rewarding challenge.',
      example_cn: '学习一门新语言是一项很有回报的挑战。'
    },
    {
      word: 'deliberate',
      phonetic: '/dɪˈlɪbərət/',
      translation: 'adj. 深思熟虑的；故意的；v. 仔细考虑',
      example: 'It was a deliberate attempt to mislead the audience.',
      example_cn: '那是蓄意误导观众的企图。'
    },
    {
      word: 'eloquent',
      phonetic: '/ˈeləkwənt/',
      translation: 'adj. 雄辩的，有说服力的，动人的',
      example: 'The speaker made an eloquent speech in favor of environmental protection.',
      example_cn: '演讲者发表了一篇支持环境保护的雄辩演讲。'
    },
    {
      word: 'fascinating',
      phonetic: '/ˈfæsɪneɪtɪŋ/',
      translation: 'adj. 迷人的，极有吸引力的',
      example: 'The documentary offers a fascinating glimpse into deep sea life.',
      example_cn: '这部纪录片让人得以一窥迷人的深海生物。'
    },
    {
      word: 'gratitude',
      phonetic: '/ˈɡrætɪtjuːd/',
      translation: 'n. 感激，谢意',
      example: 'I wish to express my heartfelt gratitude for your kind support.',
      example_cn: '我对您的热情支持表示由衷的感谢。'
    },
    {
      word: 'hesitate',
      phonetic: '/ˈhezɪteɪt/',
      translation: 'v. 犹豫，踌躇，迟疑',
      example: 'Do not hesitate to ask questions if anything is unclear.',
      example_cn: '如果有任何不清楚的地方，请毫不犹豫地提问。'
    },
    {
      word: 'innovation',
      phonetic: '/ˌɪnəˈveɪʃn/',
      translation: 'n. 创新，革新；新方法',
      example: 'Technological innovation drives economic growth and social progress.',
      example_cn: '技术创新驱动着经济增长与社会进步。'
    },
    {
      word: 'journey',
      phonetic: '/ˈdʒɜːni/',
      translation: 'n. 旅行，历程；v. 旅行',
      example: 'A journey of a thousand miles begins with a single step.',
      example_cn: '千里之行，始于足下。'
    }
  ];

  const insertWord = db.prepare(`
    INSERT OR IGNORE INTO words (word, phonetic, translation, example, example_cn)
    VALUES (@word, @phonetic, @translation, @example, @example_cn)
  `);

  const insertListWord = db.prepare(`
    INSERT OR IGNORE INTO list_words (list_id, word_id, sort_order)
    VALUES (?, ?, ?)
  `);

  const findWord = db.prepare('SELECT id FROM words WHERE word = ? COLLATE NOCASE');

  const insertMany = db.transaction((words) => {
    let order = 1;
    for (const w of words) {
      insertWord.run(w);
      const row = findWord.get(w.word);
      if (row) {
        insertListWord.run(defaultListId, row.id, order++);
      }
    }
  });

  insertMany(sampleWords);
}

module.exports = db;
