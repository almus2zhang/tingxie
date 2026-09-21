// Client API helper for interacting with backend

export const DEFAULT_SILICONFLOW_API_KEY = ''; // System key is managed server-side via .env

const getAuthUser = () => {
  const token = localStorage.getItem('tingxie_auth_token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload;
  } catch (e) {
    return null;
  }
};

export const getApiKey = () => {
  const user = getAuthUser();
  const isAdmin = user && user.role === 'admin';
  const customKey = (localStorage.getItem('siliconflow_api_key') || '').trim();

  if (isAdmin) {
    // Admin can use custom key or fallback to system built-in key
    return customKey || DEFAULT_SILICONFLOW_API_KEY;
  }

  // Regular user: ONLY return personal key, never default to built-in key
  if (customKey === DEFAULT_SILICONFLOW_API_KEY) {
    return '';
  }
  return customKey;
};

const getAuthToken = () => {
  return localStorage.getItem('tingxie_auth_token') || '';
};

const getHeaders = (customHeaders = {}) => {
  const headers = { ...customHeaders };
  const key = getApiKey();
  if (key) {
    headers['x-api-key'] = key;
  }
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

export const api = {
  // Auth API
  async sendEmailCode(email, type = 'register') {
    const res = await fetch('/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, type }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '发送验证码失败');
    return data;
  },

  async register(email, code, username, password) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '注册失败');
    return data;
  },

  async login(email, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '登录失败');
    return data;
  },

  async getMe() {
    const res = await fetch('/api/auth/me', {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch user');
    return res.json();
  },

  async getUserSettings() {
    const res = await fetch('/api/auth/settings', {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch user settings');
    return res.json();
  },

  async updateUserSettings(settings) {
    const res = await fetch('/api/auth/settings', {
      method: 'PUT',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(settings),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update user settings');
    return data;
  },

  // Audit API
  async submitChangeRequest(type, targetId, targetName, payload) {
    const res = await fetch('/api/audit/submit', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        type,
        target_id: targetId,
        target_name: targetName,
        payload,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '提交审核申请失败');
    return data;
  },

  async getAuditRequests(status = '') {
    const url = status ? `/api/audit/requests?status=${status}` : '/api/audit/requests';
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch audit requests');
    return res.json();
  },

  async getAuditStats() {
    const res = await fetch('/api/audit/stats', { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch audit stats');
    return res.json();
  },

  async reviewAuditRequest(requestId, action, comment = '') {
    const res = await fetch('/api/audit/review', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ requestId, action, comment }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '审批操作失败');
    return data;
  },

  async getMyAuditRequests() {
    const res = await fetch('/api/audit/my-requests', { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch my requests');
    return res.json();
  },

  async getMyAuditStats() {
    const res = await fetch('/api/audit/my-stats', { headers: getHeaders() });
    if (!res.ok) return { pendingCount: 0, totalCount: 0, maxPending: 10, canSubmit: true };
    return res.json();
  },

  // Admin Dashboard & Statistics
  async getAdminOverview() {
    const res = await fetch('/api/admin/overview', { headers: getHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '获取管理概览失败');
    }
    return res.json();
  },

  async getAdminUsers() {
    const res = await fetch('/api/admin/users', { headers: getHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '获取用户列表失败');
    }
    return res.json();
  },

  async getAdminDailyRecords() {
    const res = await fetch('/api/admin/records/daily', { headers: getHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '获取每日记录汇总失败');
    }
    return res.json();
  },

  async getAdminRecords(params = {}) {
    const searchParams = new URLSearchParams();
    if (params.date) searchParams.append('date', params.date);
    if (params.mode) searchParams.append('mode', params.mode);
    if (params.userId) searchParams.append('userId', params.userId);
    if (params.limit) searchParams.append('limit', params.limit);
    if (params.offset) searchParams.append('offset', params.offset);

    const res = await fetch(`/api/admin/records?${searchParams.toString()}`, { headers: getHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '获取详细记录流水失败');
    }
    return res.json();
  },

  // Lists & Tree
  async getLists(parentId) {
    const url = parentId !== undefined ? `/api/lists?parentId=${parentId}` : '/api/lists';
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch lists');
    return res.json();
  },

  async getListsTree() {
    const res = await fetch('/api/lists/tree', { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch lists tree');
    return res.json();
  },

  async createList(nameOrData, description = '') {
    const body = typeof nameOrData === 'object' 
      ? nameOrData 
      : { name: nameOrData, description };

    const res = await fetch('/api/lists', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create list');
    }
    return res.json();
  },

  async updateList(id, nameOrData, description = '') {
    const body = typeof nameOrData === 'object' 
      ? nameOrData 
      : { name: nameOrData, description };

    const res = await fetch(`/api/lists/${id}`, {
      method: 'PUT',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to update list');
    }
    return res.json();
  },

  async moveList(id, parentId) {
    const res = await fetch(`/api/lists/${id}/move`, {
      method: 'PUT',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ parent_id: parentId }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to move list');
    }
    return res.json();
  },

  async deleteList(id) {
    const res = await fetch(`/api/lists/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to delete list');
    return res.json();
  },

  async getListWords(id) {
    const res = await fetch(`/api/lists/${id}/words`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch list words');
    return res.json();
  },

  async removeWordFromList(listId, wordId) {
    const res = await fetch(`/api/lists/${listId}/words/${wordId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to remove word');
    return res.json();
  },

  // Words Master Library
  async getWordStats() {
    const res = await fetch('/api/words/stats', { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch word stats');
    return res.json();
  },

  async getWords(params = {}) {
    const searchParams = new URLSearchParams();
    if (params.search) searchParams.append('search', params.search);
    if (params.listId) searchParams.append('listId', params.listId);
    if (params.onlyMistakes) searchParams.append('onlyMistakes', String(params.onlyMistakes));
    if (params.limit) searchParams.append('limit', params.limit);
    if (params.offset) searchParams.append('offset', params.offset);

    const res = await fetch(`/api/words?${searchParams.toString()}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch words');
    return res.json();
  },

  async batchImportWords(words, listId = null) {
    const res = await fetch('/api/words/batch', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ words, listId }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to import words');
    }
    return res.json();
  },

  async importStructuredWords(data) {
    const res = await fetch('/api/words/import-structured', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to import structured words');
    }
    return res.json();
  },

  async insertWord(data) {
    const res = await fetch('/api/words/insert', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to insert word');
    }
    return res.json();
  },

  async reorderWord(wordId, direction, listId = null) {
    const res = await fetch('/api/words/reorder', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ wordId, direction, listId }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to reorder word');
    }
    return res.json();
  },

  async batchAssignToList(wordIds, listId) {
    const res = await fetch('/api/words/batch-assign', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ wordIds, listId }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to assign words to list');
    }
    return res.json();
  },

  async deleteWord(id) {
    const res = await fetch(`/api/words/${id}`, { 
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to delete word');
    return res.json();
  },

  async updateWord(id, wordData) {
    const res = await fetch(`/api/words/${id}`, {
      method: 'PUT',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(wordData),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to update word');
    }
    return res.json();
  },

  async submitWordToPublic(id, reason = '') {
    const res = await fetch(`/api/words/${id}/submit-public`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '提交公开申请失败');
    return data;
  },

  async batchSubmitWordsToPublic(wordIds, reason = '') {
    const res = await fetch('/api/words/batch-submit-public', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ wordIds, reason }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '批量提交公开申请失败');
    return data;
  },

  async batchDeleteWords(wordIds, listId = null) {
    const res = await fetch('/api/words/batch-delete', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ wordIds, listId }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to batch delete words');
    }
    return res.json();
  },

  async setWordMistake(id, { count, delta } = {}) {
    const res = await fetch(`/api/words/${id}/mistake`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ count, delta }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to update word mistake count');
    }
    return res.json();
  },

  async resetWordMistake(id) {
    const res = await fetch(`/api/words/${id}/reset-mistake`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to reset word mistake count');
    }
    return res.json();
  },

  async batchSetWordMistake(wordIds, action = 'increment', value = 0) {
    const res = await fetch('/api/words/batch-mistake', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ wordIds, action, value }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to batch update mistake counts');
    }
    return res.json();
  },

  // AI OCR & Vision
  async recognizeImage(imageFileOrBase64, model = 'Qwen/Qwen2-VL-72B-Instruct') {
    let body;
    let headers = getHeaders();

    if (imageFileOrBase64 instanceof File || imageFileOrBase64 instanceof Blob) {
      body = new FormData();
      body.append('image', imageFileOrBase64);
      body.append('model', model);
      // Let browser set multipart content-type boundary
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({
        imageBase64: imageFileOrBase64,
        model,
      });
    }

    const res = await fetch('/api/ai/recognize-image', {
      method: 'POST',
      headers,
      body,
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'AI 识别失败');
    }
    return res.json();
  },

  // AI Enrichment
  async enrichWords(words, model = null) {
    const activeModel = model || localStorage.getItem('siliconflow_model') || '';
    const res = await fetch('/api/ai/enrich-words', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ words, model: activeModel }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '补全失败');
    }
    return res.json();
  },

  // Study Records
  async recordResult({ word_id, mode, is_correct, user_input, score }) {
    const res = await fetch('/api/records', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ word_id, mode, is_correct, user_input, score }),
    });
    return res.json();
  },

  async getStats() {
    const res = await fetch('/api/records/stats', { headers: getHeaders() });
    if (!res.ok) return null;
    return res.json();
  },

  // Calendar Daily Plans
  async getCalendarSummary(month) {
    const query = month ? `?month=${month}` : '';
    const res = await fetch(`/api/calendar/summary${query}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch calendar summary');
    return res.json();
  },

  async getDailyPlan(date) {
    const query = date ? `?date=${date}` : '';
    const res = await fetch(`/api/calendar/daily${query}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch daily plan');
    return res.json();
  },

  async addWordsToDailyPlan(date, wordIds) {
    const res = await fetch('/api/calendar/daily', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date, wordIds }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to add words to daily plan');
    }
    return res.json();
  },

  async removeWordsFromDailyPlan(date, wordIds) {
    const res = await fetch('/api/calendar/daily', {
      method: 'DELETE',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date, wordIds }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to remove words from daily plan');
    }
    return res.json();
  },

  async clearDailyPlan(date) {
    const res = await fetch('/api/calendar/daily', {
      method: 'DELETE',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date, clearAll: true }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to clear daily plan');
    }
    return res.json();
  },

  async setDailyTitle(date, title, description = '') {
    const res = await fetch('/api/calendar/daily-title', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date, title, description }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to set daily title');
    }
    return res.json();
  },

  async reorderDailyWord(date, wordId, direction) {
    const res = await fetch('/api/calendar/daily-reorder', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date, wordId, direction }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to reorder daily word');
    }
    return res.json();
  },

  async reverseDailyPlan(date) {
    const res = await fetch('/api/calendar/daily-reverse', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to reverse daily plan');
    }
    return res.json();
  },

  async sortDailyPlanDefault(date) {
    const res = await fetch('/api/calendar/daily-sort-default', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to sort daily plan');
    }
    return res.json();
  },

  async getActiveDate() {
    const res = await fetch('/api/calendar/active-date', { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch active date');
    return res.json();
  },

  async setActiveDate(date) {
    const res = await fetch('/api/calendar/active-date', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to update active date');
    }
    return res.json();
  },

  async getDailyShuffle() {
    const res = await fetch('/api/calendar/shuffle', { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to get daily shuffle');
    return res.json();
  },

  async setDailyShuffle(isShuffle) {
    const res = await fetch('/api/calendar/shuffle', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ isShuffle }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to set daily shuffle');
    }
    return res.json();
  },

  async setDailyDateShuffle(date, isShuffle) {
    const res = await fetch('/api/calendar/daily-shuffle', {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date, isShuffle }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to set date shuffle');
    }
    return res.json();
  },

  // Home Assistant Status & Control
  async getHaStatus(date) {
    const query = date ? `?date=${date}` : '';
    const res = await fetch(`/api/ha/status${query}`);
    if (!res.ok) throw new Error('Failed to fetch HA status');
    return res.json();
  },

  async triggerHaAction(action, date) {
    const res = await fetch(`/api/ha/session/${action}${date ? `?date=${date}` : ''}`, { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to trigger HA action: ${action}`);
    return res.json();
  }
};
