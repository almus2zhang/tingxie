const db = require('./db');

function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Check and return valid active date. If expired (i.e. past the day it was pinned), auto-clear and return null.
function getValidActiveDate(userId = null) {
  try {
    const userCond = userId ? '(user_id IS ? OR user_id = ?)' : 'user_id IS NULL';
    const params = userId ? [userId, userId] : [];

    const row = db.prepare(`SELECT value, updated_at FROM app_settings WHERE key = 'active_date' AND ${userCond}`).get(...params);
    if (!row || !row.value) return null;

    const today = getLocalDateString();
    const setOnRow = db.prepare(`SELECT value FROM app_settings WHERE key = 'active_date_set_on' AND ${userCond}`).get(...params);

    let setOnDate = setOnRow?.value;
    if (!setOnDate && row.updated_at) {
      setOnDate = row.updated_at.slice(0, 10);
    }

    // Auto-expire condition:
    // If today is past the date when it was pinned (today > setOnDate),
    // or if no setOnDate recorded and today is past the pinned date (today > row.value),
    // then the pin has expired!
    const isExpired = setOnDate ? (today > setOnDate) : (today > row.value);

    if (isExpired) {
      db.prepare(`DELETE FROM app_settings WHERE key IN ('active_date', 'active_date_set_on') AND ${userCond}`).run(...params);
      return null;
    }

    return row.value;
  } catch (err) {
    console.error('getValidActiveDate error:', err);
    return null;
  }
}

module.exports = {
  getLocalDateString,
  getValidActiveDate
};
