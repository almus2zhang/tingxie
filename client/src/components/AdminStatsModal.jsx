import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, RefreshCw, Users, Lock, Folder, Headphones, BookOpen, 
  Calendar as CalendarIcon, CheckCircle2, XCircle, Filter, 
  ChevronRight, ArrowRight, ShieldCheck, User as UserIcon, 
  BarChart3, Activity, Clock, Search, Layers, Globe
} from 'lucide-react';
import { api } from '../api/client';

export default function AdminStatsModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('daily'); // 'daily' | 'users'
  
  // Loading states
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingDaily, setLoadingDaily] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);

  // Data states
  const [overview, setOverview] = useState(null);
  const [usersList, setUsersList] = useState([]);
  const [dailyStats, setDailyStats] = useState([]);
  const [recordsData, setRecordsData] = useState({ total: 0, records: [] });

  // Filters for detailed records
  const [filterDate, setFilterDate] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'dictation' | 'memory'
  const [filterUserId, setFilterUserId] = useState('all');
  const [recordsPage, setRecordsPage] = useState(1);
  const pageSize = 30;

  // Search in users tab
  const [userSearch, setUserSearch] = useState('');

  // Fetch overview KPI
  const fetchOverview = useCallback(async () => {
    try {
      setLoadingOverview(true);
      const data = await api.getAdminOverview();
      setOverview(data);
    } catch (err) {
      console.error('Failed to fetch overview:', err);
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  // Fetch registered users
  const fetchUsers = useCallback(async () => {
    try {
      setLoadingUsers(true);
      const data = await api.getAdminUsers();
      setUsersList(data || []);
    } catch (err) {
      console.error('Failed to fetch admin users:', err);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  // Fetch daily aggregated records
  const fetchDailyStats = useCallback(async () => {
    try {
      setLoadingDaily(true);
      const data = await api.getAdminDailyRecords();
      setDailyStats(data || []);
    } catch (err) {
      console.error('Failed to fetch daily stats:', err);
    } finally {
      setLoadingDaily(false);
    }
  }, []);

  // Fetch detailed records
  const fetchRecords = useCallback(async (page = 1) => {
    try {
      setLoadingRecords(true);
      const params = {
        date: filterDate || undefined,
        mode: filterMode !== 'all' ? filterMode : undefined,
        userId: filterUserId !== 'all' ? filterUserId : undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize
      };
      const res = await api.getAdminRecords(params);
      setRecordsData(res || { total: 0, records: [] });
      setRecordsPage(page);
    } catch (err) {
      console.error('Failed to fetch detailed records:', err);
    } finally {
      setLoadingRecords(false);
    }
  }, [filterDate, filterMode, filterUserId]);

  // Initial load
  useEffect(() => {
    if (isOpen) {
      fetchOverview();
      fetchDailyStats();
      fetchUsers();
      fetchRecords(1);
    }
  }, [isOpen, fetchOverview, fetchDailyStats, fetchUsers, fetchRecords]);

  // When filters change, reload detailed records from page 1
  useEffect(() => {
    if (isOpen) {
      fetchRecords(1);
    }
  }, [filterDate, filterMode, filterUserId, fetchRecords, isOpen]);

  if (!isOpen) return null;

  // Drilldown to specific date
  const handleSelectDate = (date) => {
    setFilterDate(date === filterDate ? '' : date);
  };

  // Drilldown to specific user
  const handleSelectUserFromTable = (userId) => {
    setFilterUserId(String(userId));
    setActiveTab('daily');
  };

  const filteredUsers = usersList.filter(u => {
    if (!userSearch.trim()) return true;
    const q = userSearch.toLowerCase();
    return (u.username && u.username.toLowerCase().includes(q)) ||
           (u.email && u.email.toLowerCase().includes(q));
  });

  const totalPages = Math.ceil((recordsData.total || 0) / pageSize) || 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-xs">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2">
                <span>管理数据与学习统计看板</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-200">
                  管理员专属
                </span>
              </h3>
              <p className="text-xs text-slate-400 hidden xs:block">
                实时掌握全站用户、私有资产与每日听写/记忆学习流水
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                fetchOverview();
                fetchDailyStats();
                fetchUsers();
                fetchRecords(1);
              }}
              className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-200/50 transition-colors"
              title="刷新数据"
            >
              <RefreshCw className={`w-4 h-4 ${(loadingOverview || loadingDaily || loadingUsers || loadingRecords) ? 'animate-spin text-indigo-600' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Overview KPI Summary Cards */}
        <div className="px-4 sm:px-6 py-3 bg-white border-b border-slate-100 shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 text-xs">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-400 font-medium">注册用户数</div>
              <div className="text-lg font-black text-slate-800 mt-0.5">
                {overview ? overview.userCount : '-'}
              </div>
            </div>
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
              <Users className="w-4 h-4" />
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-400 font-medium">用户私有词条</div>
              <div className="text-lg font-black text-amber-700 mt-0.5">
                {overview ? overview.privateWordsCount : '-'}
                <span className="text-[10px] text-slate-400 font-normal ml-1">/ 公共 {overview?.publicWordsCount || 0}</span>
              </div>
            </div>
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center font-bold">
              <Lock className="w-4 h-4" />
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-400 font-medium">用户私有词单</div>
              <div className="text-lg font-black text-indigo-700 mt-0.5">
                {overview ? overview.privateListsCount : '-'}
                <span className="text-[10px] text-slate-400 font-normal ml-1">/ 公共 {overview?.publicListsCount || 0}</span>
              </div>
            </div>
            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
              <Folder className="w-4 h-4" />
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-400 font-medium">听写 / 记忆流水</div>
              <div className="text-lg font-black text-emerald-700 mt-0.5">
                {overview ? overview.dictationCount : '-'}
                <span className="text-[10px] text-slate-400 font-normal ml-1">/ 记忆 {overview?.memoryCount || 0}</span>
              </div>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold">
              <Activity className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="px-4 sm:px-6 pt-2.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('daily')}
              className={`pb-2.5 px-3 font-bold text-xs sm:text-sm border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'daily'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <CalendarIcon className="w-4 h-4" />
              <span>每日听写与记忆流水</span>
              {dailyStats.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700 font-normal">
                  {dailyStats.length} 天
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('users')}
              className={`pb-2.5 px-3 font-bold text-xs sm:text-sm border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'users'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>注册用户与私有数据</span>
              {usersList.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700 font-normal">
                  {usersList.length} 人
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Modal Body Container */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* TAB 1: 每日听写与记忆记录 */}
          {activeTab === 'daily' && (
            <div className="space-y-6">
              {/* Daily Summary Cards / Timeline */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs sm:text-sm text-slate-800 flex items-center gap-1.5">
                    <CalendarIcon className="w-4 h-4 text-indigo-600" />
                    <span>按日学习概览 (点击日期钻取查看明细流水)</span>
                  </h4>
                  {filterDate && (
                    <button
                      type="button"
                      onClick={() => setFilterDate('')}
                      className="text-xs text-indigo-600 hover:underline font-semibold"
                    >
                      清除日期筛选 (显示全部)
                    </button>
                  )}
                </div>

                {dailyStats.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    暂无学习打卡或听写记忆记录
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
                    {dailyStats.map((day) => {
                      const isSelected = filterDate === day.record_date;
                      const correctRate = day.dictation_count > 0 
                        ? Math.round((day.dictation_correct_count / day.dictation_count) * 100) 
                        : null;

                      return (
                        <div
                          key={day.record_date}
                          onClick={() => handleSelectDate(day.record_date)}
                          className={`p-3 rounded-xl border transition-all cursor-pointer shadow-2xs flex flex-col justify-between ${
                            isSelected 
                              ? 'bg-indigo-50/80 border-indigo-400 ring-2 ring-indigo-200' 
                              : 'bg-white hover:bg-slate-50 border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="font-bold text-slate-900 text-xs sm:text-sm font-mono flex items-center gap-1">
                              <span>📅 {day.record_date}</span>
                              {isSelected && <span className="text-[10px] text-indigo-600 font-semibold">(已选中)</span>}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-slate-100 text-slate-600">
                              共 {day.total_count} 条
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs py-1.5 border-t border-b border-slate-100">
                            <div>
                              <span className="text-[11px] text-slate-400 block">🎧 听写练习</span>
                              <span className="font-bold text-slate-800">
                                {day.dictation_count} 题
                                {correctRate !== null && (
                                  <span className={`ml-1 text-[10px] ${correctRate >= 80 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                    ({correctRate}%)
                                  </span>
                                )}
                              </span>
                            </div>
                            <div>
                              <span className="text-[11px] text-slate-400 block">📖 记忆朗读</span>
                              <span className="font-bold text-slate-800">
                                {day.memory_count} 词
                              </span>
                            </div>
                          </div>

                          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                            <span className="truncate max-w-[180px]" title={day.active_users}>
                              👥 活跃: {day.active_users || '未知'}
                            </span>
                            <span className="text-indigo-600 font-bold inline-flex items-center gap-0.5">
                              <span>明细</span>
                              <ChevronRight className="w-3 h-3" />
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Detailed Records Stream Table */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="font-bold text-xs sm:text-sm text-slate-800 flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-emerald-600" />
                    <span>记录流水明细</span>
                    <span className="text-slate-400 text-xs font-normal">
                      (共检索到 {recordsData.total} 条)
                    </span>
                  </h4>

                  {/* Filter Toolbar */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Mode selector */}
                    <select
                      value={filterMode}
                      onChange={(e) => setFilterMode(e.target.value)}
                      className="px-2.5 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-700 font-medium"
                    >
                      <option value="all">全部模式</option>
                      <option value="dictation">🎧 听写模式</option>
                      <option value="memory">📖 记忆模式</option>
                    </select>

                    {/* User selector */}
                    <select
                      value={filterUserId}
                      onChange={(e) => setFilterUserId(e.target.value)}
                      className="px-2.5 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-700 font-medium"
                    >
                      <option value="all">全部用户</option>
                      {usersList.map(u => (
                        <option key={u.id} value={u.id}>
                          {u.username} ({u.email})
                        </option>
                      ))}
                    </select>

                    {filterDate && (
                      <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-md font-mono font-medium">
                        日期: {filterDate}
                      </span>
                    )}
                  </div>
                </div>

                {/* Table */}
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                          <th className="py-2.5 px-3">时间</th>
                          <th className="py-2.5 px-3">用户</th>
                          <th className="py-2.5 px-3">模式</th>
                          <th className="py-2.5 px-3">单词 / 释义</th>
                          <th className="py-2.5 px-3">答题结果 / 输入 / 得分</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {loadingRecords ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-slate-400">
                              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-1.5 text-indigo-600" />
                              <span>正在检索流水记录...</span>
                            </td>
                          </tr>
                        ) : recordsData.records.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-slate-400">
                              未检索到符合条件的听写或记忆记录
                            </td>
                          </tr>
                        ) : (
                          recordsData.records.map(record => {
                            const isDict = record.mode === 'dictation';
                            const isCorrect = record.is_correct === 1;

                            return (
                              <tr key={record.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">
                                  {record.created_at}
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  {record.username || record.email ? (
                                    <div className="flex items-center gap-1">
                                      <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                                      <span className="font-bold text-slate-800">{record.username || record.email}</span>
                                    </div>
                                  ) : (
                                    <span className="text-slate-400 italic">游客模式</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  {isDict ? (
                                    record.user_input?.startsWith('ha') ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] bg-sky-50 text-sky-700 border border-sky-200">
                                        🔊 HA听写
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100">
                                        🎧 听写
                                      </span>
                                    )
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100">
                                      📖 记忆
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 min-w-[180px]">
                                  <span className="font-bold text-slate-900 mr-1.5">{record.word || `词ID #${record.word_id}`}</span>
                                  {record.phonetic && (
                                    <span className="font-serif text-slate-400 mr-1.5 font-normal">[{record.phonetic}]</span>
                                  )}
                                  <span className="text-slate-500">{record.translation}</span>
                                </td>
                                <td className="py-2.5 px-3">
                                  {isDict ? (
                                    <div className="flex items-center gap-1.5">
                                      {isCorrect ? (
                                        <span className="inline-flex items-center gap-0.5 font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                                          <CheckCircle2 className="w-3.5 h-3.5" /> {record.user_input?.startsWith('ha') ? 'HA播放完成' : '正确'}
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-0.5 font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded">
                                          <XCircle className="w-3.5 h-3.5" /> {record.user_input === 'ha_mistake' ? 'HA标记易错' : `错误: ${record.user_input || '(无输入)'}`}
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      {record.score > 0 ? (
                                        <span className="inline-flex items-center gap-1 font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                                          <span>发音打分</span>
                                          <span className="font-mono text-indigo-900">{record.score}分</span>
                                        </span>
                                      ) : (
                                        <span className="text-slate-400">记忆朗读完成</span>
                                      )}
                                      {record.user_input && record.user_input !== '[声学原音对比]' && (
                                        <span className="text-[11px] text-slate-400">({record.user_input})</span>
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination footer */}
                  {recordsData.total > pageSize && (
                    <div className="px-4 py-2.5 bg-slate-50/80 border-t border-slate-200 flex items-center justify-between text-xs">
                      <span className="text-slate-500">
                        第 {recordsPage} / {totalPages} 页 (共 {recordsData.total} 条)
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={recordsPage <= 1 || loadingRecords}
                          onClick={() => fetchRecords(recordsPage - 1)}
                          className="px-2.5 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-40 transition-colors"
                        >
                          上一页
                        </button>
                        <button
                          type="button"
                          disabled={recordsPage >= totalPages || loadingRecords}
                          onClick={() => fetchRecords(recordsPage + 1)}
                          className="px-2.5 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-40 transition-colors"
                        >
                          下一页
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 注册用户与私有数据 */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div>
                  <h4 className="font-bold text-xs sm:text-sm text-slate-800 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-indigo-600" />
                    <span>注册用户与私有数据统计</span>
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    查看每个用户的私有词条库、私有词单建立情况及学习活跃度
                  </p>
                </div>

                {/* User search */}
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="按用户名或邮箱搜索..."
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Users Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                        <th className="py-3 px-4">用户</th>
                        <th className="py-3 px-3">角色权限</th>
                        <th className="py-3 px-3">注册时间</th>
                        <th className="py-3 px-3 text-center">私有词条数</th>
                        <th className="py-3 px-3 text-center">私有词单数</th>
                        <th className="py-3 px-3 text-center">听写 / 记忆次数</th>
                        <th className="py-3 px-3">最近活动</th>
                        <th className="py-3 px-3 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loadingUsers ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-400">
                            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-1.5 text-indigo-600" />
                            <span>正在加载用户数据...</span>
                          </td>
                        </tr>
                      ) : filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-400">
                            未找到符合条件的用户
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map(u => {
                          const isAdm = u.role === 'admin';

                          return (
                            <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="py-3 px-4 whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-white text-xs ${
                                    isAdm ? 'bg-amber-500' : 'bg-indigo-600'
                                  }`}>
                                    {isAdm ? <ShieldCheck className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
                                  </div>
                                  <div>
                                    <div className="font-bold text-slate-900">{u.username}</div>
                                    <div className="text-[11px] text-slate-400 font-mono">{u.email}</div>
                                  </div>
                                </div>
                              </td>

                              <td className="py-3 px-3 whitespace-nowrap">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isAdm 
                                    ? 'bg-amber-100 text-amber-800 border border-amber-200' 
                                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                                }`}>
                                  {isAdm ? '系统管理员' : '普通用户'}
                                </span>
                              </td>

                              <td className="py-3 px-3 text-slate-500 font-mono whitespace-nowrap">
                                {u.created_at ? u.created_at.slice(0, 10) : '-'}
                              </td>

                              <td className="py-3 px-3 text-center whitespace-nowrap">
                                <span className={`inline-block px-2.5 py-0.5 rounded-full font-bold font-mono text-xs ${
                                  u.private_words_count > 0 
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                                    : 'bg-slate-50 text-slate-400'
                                }`}>
                                  {u.private_words_count || 0} 词
                                </span>
                              </td>

                              <td className="py-3 px-3 text-center whitespace-nowrap">
                                <span className={`inline-block px-2.5 py-0.5 rounded-full font-bold font-mono text-xs ${
                                  u.private_lists_count > 0 
                                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' 
                                    : 'bg-slate-50 text-slate-400'
                                }`}>
                                  {u.private_lists_count || 0} 组
                                </span>
                              </td>

                              <td className="py-3 px-3 text-center font-mono whitespace-nowrap">
                                <span className="font-bold text-slate-800">{u.dictation_count || 0}</span>
                                <span className="text-slate-400 mx-1">/</span>
                                <span className="text-slate-600">{u.memory_count || 0}</span>
                              </td>

                              <td className="py-3 px-3 font-mono text-slate-500 whitespace-nowrap">
                                {u.last_active_at ? u.last_active_at.slice(0, 16) : <span className="text-slate-300">暂无记录</span>}
                              </td>

                              <td className="py-3 px-3 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => handleSelectUserFromTable(u.id)}
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <span>查看学习记录</span>
                                  <ArrowRight className="w-3 h-3" />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div>
            数据实时统计自系统核心数据库 · 包含历史所有听写与记忆会话
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-bold transition-colors cursor-pointer"
          >
            关闭看板
          </button>
        </div>
      </div>
    </div>
  );
}
