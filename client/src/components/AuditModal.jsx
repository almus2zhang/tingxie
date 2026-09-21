import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { X, Check, Ban, Clock, CheckCircle2, XCircle, AlertCircle, RefreshCw, MessageSquare, Loader2, Sparkles, Inbox } from 'lucide-react';

export default function AuditModal() {
  const { auditModalOpen, closeAuditModal, auditModalTab, setAuditModalTab, isAdmin } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectComment, setRejectComment] = useState('');
  const [error, setError] = useState('');

  const activeTab = auditModalTab || (isAdmin ? 'pending' : 'my');

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'my') {
        const data = await api.getMyAuditRequests();
        setRequests(data);
      } else if (activeTab === 'pending') {
        const data = await api.getAuditRequests('pending');
        setRequests(data);
      } else {
        const data = await api.getAuditRequests('');
        setRequests(data);
      }
    } catch (err) {
      setError(err.message || '获取工单数据失败');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (auditModalOpen) {
      fetchRequests();
    }
  }, [auditModalOpen, fetchRequests]);

  if (!auditModalOpen) return null;

  const handleReview = async (id, action, comment = '') => {
    try {
      setActionLoadingId(id);
      await api.reviewAuditRequest(id, action, comment);
      setRejectingId(null);
      setRejectComment('');
      fetchRequests();
    } catch (err) {
      alert(err.message || '操作失败');
    } finally {
      setActionLoadingId(null);
    }
  };

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
      default: return '数据变更申请';
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
            <Clock className="w-3 h-3 mr-1" />
            待审核
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            已合入
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60">
            <XCircle className="w-3 h-3 mr-1" />
            已驳回
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden transition-all transform animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
              <Inbox className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                {isAdmin ? '公共词库审核中心' : '我的变更申请记录'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isAdmin ? '审核普通用户提交的公共词条修改与新增建议' : '查看您提交给管理员审核的公共词库修改提案'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={fetchRequests}
              disabled={loading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="刷新"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={closeAuditModal}
              className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="px-6 pt-3 pb-2 flex space-x-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
          {isAdmin && (
            <>
              <button
                onClick={() => setAuditModalTab('pending')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  activeTab === 'pending'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                待审核
              </button>
              <button
                onClick={() => setAuditModalTab('all')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  activeTab === 'all'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                全部工单历史
              </button>
            </>
          )}
          <button
            onClick={() => setAuditModalTab('my')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'my'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>我的申请</span>
            {activeTab === 'my' && requests.length > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                requests.filter(r => r.status === 'pending').length >= 10
                  ? 'bg-rose-500 text-white'
                  : 'bg-white/20 text-white'
              }`}>
                待审 {requests.filter(r => r.status === 'pending').length}/10
              </span>
            )}
          </button>
        </div>

        {/* 10 items limit warning banner */}
        {activeTab === 'my' && requests.filter(r => r.status === 'pending').length >= 10 && (
          <div className="mx-6 mt-3 px-3.5 py-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>您当前已有 10 条待审核申请正在排队，已达上限。请等待管理员审核后再提交新申请。</span>
          </div>
        )}

        {/* Request List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading && requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mb-2" />
              <p className="text-xs">加载工单记录中...</p>
            </div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-2">
              <CheckCircle2 className="w-10 h-10 stroke-[1.5] text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-medium">暂无相关审核申请</p>
              <p className="text-xs text-slate-400">所有提案都已处理完毕或尚未提交</p>
            </div>
          ) : (
            requests.map((req) => {
              let payload = {};
              try {
                payload = typeof req.payload === 'string' ? JSON.parse(req.payload) : (req.payload || {});
              } catch (e) {
                payload = {};
              }

              const isActionLoading = actionLoadingId === req.id;
              const isRejecting = rejectingId === req.id;

              return (
                <div
                  key={req.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 shadow-sm hover:shadow transition-shadow space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                        {getTypeName(req.type)}
                      </span>
                      {getStatusBadge(req.status)}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {req.created_at}
                    </span>
                  </div>

                  {/* Details */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/80 rounded-lg text-xs space-y-1.5 border border-slate-100 dark:border-slate-700/50">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">申请人:</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {req.user_name || req.user_email} ({req.user_email})
                      </span>
                    </div>
                    {req.target_name && (
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">目标名称:</span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {req.target_name}
                        </span>
                      </div>
                    )}

                    {/* Word / Content payload summary */}
                    {payload?.word && (
                      <div className="pt-1 border-t border-slate-200/60 dark:border-slate-700 flex items-center space-x-2">
                        <span className="text-slate-400">词条内容:</span>
                        <span className="font-bold text-slate-900 dark:text-slate-100">{payload.word}</span>
                        {payload.phonetic && <span className="font-serif text-slate-500">[{payload.phonetic}]</span>}
                        {payload.translation && <span className="text-slate-600 dark:text-slate-300">{payload.translation}</span>}
                      </div>
                    )}

                    {payload?.name && (
                      <div className="pt-1 border-t border-slate-200/60 dark:border-slate-700 flex items-center space-x-2">
                        <span className="text-slate-400">词单名称:</span>
                        <span className="font-bold text-slate-900 dark:text-slate-100">{payload.name}</span>
                        {payload.description && <span className="text-slate-500">({payload.description})</span>}
                      </div>
                    )}

                    {payload?.user_reason && (
                      <div className="pt-1 text-amber-700 dark:text-amber-400 flex items-start space-x-1.5">
                        <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>申请说明: {payload.user_reason}</span>
                      </div>
                    )}

                    {req.admin_comment && (
                      <div className="pt-1 text-slate-500 dark:text-slate-400 border-t border-slate-200/60 dark:border-slate-700">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">管理员反馈: </span>
                        <span>{req.admin_comment}</span>
                      </div>
                    )}
                  </div>

                  {/* Admin actions if pending */}
                  {isAdmin && req.status === 'pending' && (
                    <div className="pt-1">
                      {isRejecting ? (
                        <div className="space-y-2 p-3 bg-rose-50 dark:bg-rose-950/30 rounded-xl border border-rose-200 dark:border-rose-900/40 animate-fade-in">
                          <label className="block text-xs font-semibold text-rose-700 dark:text-rose-300">
                            填写驳回原因 (可选):
                          </label>
                          <input
                            type="text"
                            value={rejectComment}
                            onChange={(e) => setRejectComment(e.target.value)}
                            placeholder="如：已有相同词条、释义有错等"
                            className="w-full px-3 py-1.5 text-xs rounded-lg border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                          />
                          <div className="flex justify-end space-x-2">
                            <button
                              type="button"
                              onClick={() => { setRejectingId(null); setRejectComment(''); }}
                              className="px-3 py-1 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg"
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              disabled={isActionLoading}
                              onClick={() => handleReview(req.id, 'reject', rejectComment)}
                              className="px-3 py-1 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg flex items-center space-x-1"
                            >
                              {isActionLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                              <span>确认驳回</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-end space-x-2">
                          <button
                            type="button"
                            disabled={isActionLoading}
                            onClick={() => setRejectingId(req.id)}
                            className="px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold transition-colors flex items-center space-x-1"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>驳回</span>
                          </button>
                          <button
                            type="button"
                            disabled={isActionLoading}
                            onClick={() => handleReview(req.id, 'approve')}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors flex items-center space-x-1"
                          >
                            {isActionLoading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            <span>同意并合入公共库</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
