import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { X, Send, AlertCircle, CheckCircle2, Loader2, Sparkles, FileText, Clock } from 'lucide-react';

export default function SubmitAuditModal() {
  const { submitAuditModalOpen, submitAuditData, closeSubmitAudit, isAdmin } = useAuth();
  const [userReason, setUserReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [auditStats, setAuditStats] = useState({ pendingCount: 0, maxPending: 10, canSubmit: true });

  useEffect(() => {
    if (submitAuditModalOpen && !isAdmin) {
      api.getMyAuditStats().then(data => {
        if (data) setAuditStats(data);
      }).catch(() => {});
    }
  }, [submitAuditModalOpen, isAdmin]);

  if (!submitAuditModalOpen || !submitAuditData) return null;

  const { type, targetId, targetName, payload, title } = submitAuditData;

  const isAtLimit = !isAdmin && (auditStats.pendingCount >= (auditStats.maxPending || 10));

  const getTypeName = (t) => {
    switch (t) {
      case 'word_update': return '修改公共词条';
      case 'word_insert': return '新增公共词条';
      case 'word_delete': return '删除公共词条';
      case 'word_publish':
      case 'publish_word': return '私有词条发布为公共词条';
      case 'list_create': return '创建公共词单';
      case 'list_update': return '修改公共词单';
      case 'list_delete': return '删除公共词单';
      default: return '公共数据变更申请';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isAtLimit) {
      setError('您当前已有 10 条待审核条目，已达上限，暂无法继续操作。请等待管理员审核后再提交。');
      return;
    }
    setError('');
    setSubmitting(true);

    try {
      const fullPayload = {
        ...payload,
        user_reason: userReason.trim(),
      };
      await api.submitChangeRequest(type, targetId, targetName, fullPayload);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setUserReason('');
        closeSubmitAudit();
      }, 1500);
    } catch (err) {
      setError(err.message || '提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transition-all transform animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-xl">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                {title || '提交修改审核'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                公共词库修改需经管理员审核后合入
              </p>
            </div>
          </div>
          <button
            onClick={closeSubmitAudit}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-start space-x-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-start space-x-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-600 dark:text-emerald-400 text-xs">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>审核申请提交成功，请等待管理员合入！</span>
            </div>
          )}

          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl space-y-2 border border-slate-100 dark:border-slate-700/60">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">操作类型:</span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">{getTypeName(type)}</span>
            </div>
            {targetName && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">目标词条/词单:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[200px]">{targetName}</span>
              </div>
            )}
            {payload?.word && (
              <div className="text-xs pt-1 border-t border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                <span className="text-slate-400">建议内容：</span>
                <span className="font-bold text-slate-800 dark:text-slate-100 mr-2">{payload.word}</span>
                {payload.phonetic && <span className="font-serif text-slate-500 mr-2">[{payload.phonetic}]</span>}
                {payload.translation && <span>{payload.translation}</span>}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
              申请理由 / 说明 (选填)
            </label>
            <textarea
              rows={3}
              value={userReason}
              onChange={(e) => setUserReason(e.target.value)}
              placeholder="例如：发音音标有误、释义不够准确、词单需要更正等..."
              className="w-full p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 dark:text-slate-100 resize-none transition-all placeholder:text-slate-400"
            />
          </div>

          {!isAdmin && (
            <div className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs ${
              isAtLimit 
                ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50' 
                : 'bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
            }`}>
              <div className="flex items-center gap-1.5 font-medium">
                <Clock className="w-3.5 h-3.5" />
                <span>待审核条目限制</span>
              </div>
              <div>
                <span className={`font-bold ${isAtLimit ? 'text-rose-600' : 'text-indigo-600'}`}>
                  {auditStats.pendingCount}
                </span>
                <span className="text-slate-400"> / {auditStats.maxPending || 10} 条</span>
                {isAtLimit && <span className="ml-1 text-[11px] font-bold text-rose-600">(已达上限)</span>}
              </div>
            </div>
          )}

          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={closeSubmitAudit}
              className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting || success || isAtLimit}
              className="flex-1 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all disabled:opacity-50 flex items-center justify-center space-x-1.5"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>{isAtLimit ? '待审核已满' : '提交审核'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
