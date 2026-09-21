import React, { useState, useEffect } from 'react';
import { 
  Headphones, BookOpen, Layers, Settings, Sparkles, 
  CheckCircle2, AlertCircle, Volume2, Calendar as CalendarIcon,
  User, ShieldCheck, LogOut, Inbox, LogIn, Copy, Check, Key, BarChart3
} from 'lucide-react';
import { DEFAULT_SILICONFLOW_API_KEY, api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Navbar({ 
  currentTab, 
  onChangeTab, 
  onOpenSettings,
  onOpenAdminStats,
  stats 
}) {
  const { user, token, isAuthenticated, isAdmin, openAuthModal, openAuditModal, logout } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [userDropdown, setUserDropdown] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  const handleCopyToken = (e) => {
    e?.stopPropagation();
    const curToken = token || localStorage.getItem('tingxie_auth_token');
    if (!curToken) {
      alert('未找到有效 Token，请重新登录！');
      return;
    }
    navigator.clipboard.writeText(curToken).then(() => {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }).catch(() => {
      // Fallback
      prompt('请手动复制您的 API Token:', curToken);
    });
  };

  const hasApiKey = Boolean(localStorage.getItem('siliconflow_api_key') || DEFAULT_SILICONFLOW_API_KEY);
  const accent = localStorage.getItem('preferred_accent') || 'us';

  // Fetch pending audit count for admin
  useEffect(() => {
    if (!isAuthenticated) {
      setPendingCount(0);
      return;
    }
    const checkStats = async () => {
      try {
        if (isAdmin) {
          const s = await api.getAuditStats();
          setPendingCount(s.pendingCount || 0);
        }
      } catch (e) {
        // silent
      }
    };
    checkStats();
    const interval = setInterval(checkStats, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, isAdmin]);

  return (
    <>
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center justify-between">
          {/* Logo and Brand */}
          <div 
            onClick={() => onChangeTab('library')}
            className="flex items-center gap-2 cursor-pointer group select-none"
          >
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white flex items-center justify-center shadow-md shadow-indigo-200 group-hover:scale-105 transition-transform shrink-0">
              <Headphones className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <div className="font-black text-slate-900 text-sm sm:text-lg tracking-tight flex items-center gap-1 sm:gap-1.5">
                <span>单词听写兼记忆</span>
                <span className="text-[9px] sm:text-[10px] uppercase font-extrabold px-1 sm:px-1.5 py-0.2 bg-indigo-50 text-indigo-700 rounded-md">
                  TingXie
                </span>
              </div>
              <div className="text-[10px] sm:text-[11px] text-slate-400 font-medium -mt-0.5 hidden xs:block truncate">
                权威真人发音 · AI 拍照识别 · 录音打分
              </div>
            </div>
          </div>

          {/* Desktop Center Nav tabs */}
          <nav className="hidden md:flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => onChangeTab('library')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                currentTab === 'library'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>总库与词单</span>
            </button>

            <button
              type="button"
              onClick={() => onChangeTab('calendar')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                currentTab === 'calendar'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CalendarIcon className="w-3.5 h-3.5" />
              <span>日历计划</span>
            </button>

            <button
              type="button"
              onClick={() => onChangeTab('dictation')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                currentTab === 'dictation'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Headphones className="w-3.5 h-3.5" />
              <span>听写模式</span>
            </button>

            <button
              type="button"
              onClick={() => onChangeTab('memory')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                currentTab === 'memory'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>记忆模式</span>
            </button>
          </nav>

          {/* Right Tools, Auth, and Settings */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Audit center entry */}
            {isAuthenticated && (
              <button
                type="button"
                onClick={() => openAuditModal()}
                className="relative flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                title={isAdmin ? '公共词库变更审核' : '我的审核工单'}
              >
                <Inbox className="w-4 h-4 text-indigo-600" />
                <span className="hidden sm:inline">{isAdmin ? '审核中心' : '我的申请'}</span>
                {isAdmin && pendingCount > 0 && (
                  <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-rose-500 rounded-full animate-pulse">
                    {pendingCount}
                  </span>
                )}
              </button>
            )}

            {/* Quick API Key status badge */}
            <button
              type="button"
              onClick={onOpenSettings}
              className={`hidden lg:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-all ${
                hasApiKey
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
              title={hasApiKey ? '硅基流动 API 已就绪' : '点击配置硅基流动 API Key 以使用 AI 拍照识别'}
            >
              {hasApiKey ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
              )}
              <span className="font-semibold">{hasApiKey ? 'AI 就绪' : '配置 Key'}</span>
            </button>

            {/* Admin Stats Dashboard button */}
            {isAdmin && (
              <button
                type="button"
                onClick={onOpenAdminStats}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition-all border border-indigo-200 shadow-2xs cursor-pointer"
                title="管理看板：查看全站注册用户、私有词汇/词单与每日听写记忆流水"
              >
                <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
                <span>管理看板</span>
              </button>
            )}

            {/* Auth / User Section */}
            {isAuthenticated ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setUserDropdown(!userDropdown)}
                  className="flex items-center gap-1.5 py-1 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold ${isAdmin ? 'bg-amber-500' : 'bg-indigo-600'}`}>
                    {isAdmin ? <ShieldCheck className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                  </div>
                  <span className="text-xs font-bold text-slate-800 max-w-[80px] sm:max-w-[120px] truncate">
                    {user?.username || user?.email}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                    isAdmin ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {isAdmin ? '管理员' : '用户'}
                  </span>
                </button>

                {userDropdown && (
                  <div 
                    className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-xl py-1.5 z-50 animate-scale-up"
                    onClick={() => setUserDropdown(false)}
                  >
                    <div className="px-3 py-2 border-b border-slate-100">
                      <div className="text-xs font-bold text-slate-800 truncate">{user?.username || '用户'}</div>
                      <div className="text-[11px] text-slate-400 truncate">{user?.email}</div>
                    </div>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={onOpenAdminStats}
                        className="w-full text-left px-3 py-2 text-xs text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 flex items-center gap-2 transition-colors cursor-pointer font-bold"
                      >
                        <BarChart3 className="w-4 h-4 text-indigo-600" />
                        <span>数据与学习记录</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleCopyToken}
                      className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-between group transition-colors"
                      title="点击一键复制用于脚本或API调用的 Bearer Token"
                    >
                      <div className="flex items-center gap-2">
                        <Key className="w-4 h-4 text-indigo-500" />
                        <span>复制 API Token</span>
                      </div>
                      {copiedToken ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                          <Check className="w-3 h-3" /> 已复制
                        </span>
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => openAuditModal()}
                      className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <Inbox className="w-4 h-4 text-indigo-600" />
                      <span>{isAdmin ? '工单审核管理' : '查看申请进度'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={logout}
                      className="w-full text-left px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2 border-t border-slate-100 mt-1"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>退出登录</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="hidden sm:inline-block text-[11px] px-2 py-1 rounded bg-slate-100 text-slate-500 font-medium">
                  访客模式 (只读)
                </span>
                <button
                  type="button"
                  onClick={() => openAuthModal('login')}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-all"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>登录 / 注册</span>
                </button>
              </div>
            )}

            {/* Settings button */}
            <button
              type="button"
              onClick={onOpenSettings}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
              title="系统设置 (发音、API Key 等)"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 py-1.5 flex items-center justify-around shadow-lg">
        <button
          type="button"
          onClick={() => onChangeTab('library')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all ${
            currentTab === 'library'
              ? 'text-indigo-600 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
        >
          <Layers className={`w-5 h-5 ${currentTab === 'library' ? 'stroke-[2.5]' : ''}`} />
          <span className="text-[11px] mt-0.5">词库</span>
        </button>

        <button
          type="button"
          onClick={() => onChangeTab('calendar')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all ${
            currentTab === 'calendar'
              ? 'text-indigo-600 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
        >
          <CalendarIcon className={`w-5 h-5 ${currentTab === 'calendar' ? 'stroke-[2.5]' : ''}`} />
          <span className="text-[11px] mt-0.5">日历</span>
        </button>

        <button
          type="button"
          onClick={() => onChangeTab('dictation')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all ${
            currentTab === 'dictation'
              ? 'text-indigo-600 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
        >
          <Headphones className={`w-5 h-5 ${currentTab === 'dictation' ? 'stroke-[2.5]' : ''}`} />
          <span className="text-[11px] mt-0.5">听写</span>
        </button>

        <button
          type="button"
          onClick={() => onChangeTab('memory')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all ${
            currentTab === 'memory'
              ? 'text-indigo-600 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
        >
          <BookOpen className={`w-5 h-5 ${currentTab === 'memory' ? 'stroke-[2.5]' : ''}`} />
          <span className="text-[11px] mt-0.5">记忆</span>
        </button>
      </nav>
    </>
  );
}
