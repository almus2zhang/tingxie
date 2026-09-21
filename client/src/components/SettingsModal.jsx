import React, { useState, useEffect } from 'react';
import { X, Key, Sparkles, Volume2, Save, CheckCircle2, Gauge, RotateCcw, Copy, Check, AlertTriangle, ExternalLink, HelpCircle, CheckCircle } from 'lucide-react';
import { playWordAudio } from '../utils/audio';
import { DEFAULT_SILICONFLOW_API_KEY, api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function SettingsModal({ isOpen, onClose, onSave }) {
  const { user, token, isAuthenticated } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('Qwen/Qwen2-VL-72B-Instruct');
  const [accent, setAccent] = useState('us');
  const [speed, setSpeed] = useState(1.0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  const handleCopyToken = () => {
    const curToken = token || localStorage.getItem('tingxie_auth_token');
    if (!curToken) {
      alert('未找到有效 Token，请先登录！');
      return;
    }
    navigator.clipboard.writeText(curToken).then(() => {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }).catch(() => {
      prompt('请手动复制您的 API Token:', curToken);
    });
  };

  useEffect(() => {
    if (isOpen) {
      const localKey = localStorage.getItem('siliconflow_api_key') || '';
      if (isAdmin) {
        setApiKey(localKey || DEFAULT_SILICONFLOW_API_KEY);
      } else {
        // Regular user: do not use or show built-in key
        if (localKey === DEFAULT_SILICONFLOW_API_KEY) {
          localStorage.removeItem('siliconflow_api_key');
          setApiKey('');
        } else {
          setApiKey(localKey);
        }
      }

      setModel(localStorage.getItem('siliconflow_model') || 'Qwen/Qwen2-VL-72B-Instruct');
      setAccent(localStorage.getItem('preferred_accent') || 'us');
      const savedRate = parseFloat(localStorage.getItem('speech_rate'));
      setSpeed(!isNaN(savedRate) && savedRate > 0 ? savedRate : 1.0);
      setAutoPlay(localStorage.getItem('auto_play_audio') !== 'false');
      setSavedSuccess(false);

      // Also try to load cloud settings if logged in
      if (isAuthenticated) {
        api.getUserSettings().then(res => {
          if (res?.settings) {
            const cloudKey = res.settings.ai_key || '';
            const cloudModel = res.settings.ai_model || '';
            if (cloudKey) {
              if (isAdmin || cloudKey !== DEFAULT_SILICONFLOW_API_KEY) {
                setApiKey(cloudKey);
                localStorage.setItem('siliconflow_api_key', cloudKey);
              }
            }
            if (cloudModel) {
              setModel(cloudModel);
              localStorage.setItem('siliconflow_model', cloudModel);
            }
          }
        }).catch(err => console.warn('Could not fetch cloud settings:', err));
      }
    }
  }, [isOpen, isAdmin, isAuthenticated]);

  if (!isOpen) return null;

  const handleSave = () => {
    const finalKey = apiKey.trim();
    localStorage.setItem('siliconflow_api_key', finalKey);
    localStorage.setItem('siliconflow_model', model);
    localStorage.setItem('preferred_accent', accent);
    localStorage.setItem('speech_rate', String(speed));
    localStorage.setItem('auto_play_audio', autoPlay ? 'true' : 'false');

    if (isAuthenticated) {
      api.updateUserSettings({
        ai_key: finalKey,
        ai_model: model,
        preferred_accent: accent,
        speech_rate: String(speed),
        auto_play_audio: autoPlay ? 'true' : 'false'
      }).catch(err => console.warn('Failed to sync settings to cloud:', err));
    }

    setSavedSuccess(true);
    onSave?.({ apiKey: finalKey, model, accent, speed, autoPlay });

    setTimeout(() => {
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4 animate-fade-in">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-scale-up max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-base sm:text-lg">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <span>系统设置</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 text-sm text-slate-700 overflow-y-auto">
          {/* SiliconFlow API Key */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 font-semibold text-slate-800">
                <Key className="w-4 h-4 text-indigo-500" />
                <span>硅基流动 API 密钥</span>
                {isAdmin ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-bold">管理员</span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">用户需自备</span>
                )}
              </label>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setApiKey(DEFAULT_SILICONFLOW_API_KEY)}
                  className="text-[11px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer font-medium"
                  title="重置为系统内置密钥"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>恢复内置密钥</span>
                </button>
              )}
            </div>

            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isAdmin ? "sk-...（留空则默认使用系统内置密钥）" : "请输入您个人的 sk-... 密钥"}
              className={`w-full px-3.5 py-2.5 border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all font-mono text-xs ${
                !isAdmin && !apiKey ? 'border-amber-300 bg-amber-50/40' : 'border-slate-300 bg-slate-50'
              }`}
            />

            {isAdmin ? (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl flex items-start gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>当前为管理员权限：系统已内置专用密钥，无需额外部署即可使用 AI 功能；亦可在此填入个人专属密钥以覆盖。</span>
              </p>
            ) : (
              <div className={`text-xs p-2.5 rounded-xl border space-y-1 ${
                apiKey 
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200' 
                  : 'text-amber-800 bg-amber-50 border-amber-200'
              }`}>
                <div className="flex items-start gap-1.5 font-medium">
                  {apiKey ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span>已配置个人专属 API Key。使用 AI 拍照识别与自动补全将消耗您的个人账户额度。</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>普通用户需配置个人的 SiliconFlow API Key 方可使用 AI 功能（系统内置密钥仅供管理员专用）。</span>
                    </>
                  )}
                </div>
                {!apiKey && (
                  <div className="pl-5 text-[11px] text-slate-600 pt-0.5">
                    还没有密钥？可前往{' '}
                    <a
                      href="https://cloud.siliconflow.cn"
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-600 hover:text-indigo-800 underline font-semibold inline-flex items-center gap-0.5"
                    >
                      <span>硅基流动官网 (cloud.siliconflow.cn)</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    {' '}免费注册并新建 API 密钥。
                  </div>
                )}
              </div>
            )}

            {/* AI Scope Explanation Card */}
            <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-3 sm:p-3.5 space-y-2.5 text-xs text-slate-700">
              <div className="flex items-center gap-1.5 font-bold text-slate-800">
                <HelpCircle className="w-4 h-4 text-indigo-500 shrink-0" />
                <span>AI 密钥都用来做什么？（功能边界说明）</span>
              </div>

              <div className="space-y-2 text-[11px]">
                {/* Where AI is used */}
                <div className="bg-white rounded-xl p-2.5 border border-indigo-100 shadow-2xs space-y-1.5">
                  <div className="font-bold text-indigo-700 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span>仅以下 2 项导入功能需要调用 AI：</span>
                  </div>
                  <ul className="text-slate-600 space-y-1 pl-1">
                    <li className="flex items-start gap-1.5">
                      <span className="text-indigo-500 font-bold shrink-0">①</span>
                      <span><strong>AI 拍照识别导入</strong>：拍摄书本、试卷或单词表，调用视觉大模型自动提取单词、音标与释义。</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-indigo-500 font-bold shrink-0">②</span>
                      <span><strong>AI 批量补全词义</strong>：手动批量粘贴生词时，调用大模型自动补齐标准音标、中文释义和中英双语例句。</span>
                    </li>
                  </ul>
                </div>

                {/* Where AI is NOT used */}
                <div className="bg-emerald-50/70 rounded-xl p-2.5 border border-emerald-200 shadow-2xs space-y-1.5">
                  <div className="font-bold text-emerald-800 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>日常核心功能完全不用 AI（全部免 Key、免费使用）：</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-slate-700 pl-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                      <span><strong>真人语音朗读</strong>：权威词典真人原声</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                      <span><strong>听写与记忆练习</strong>：日常背诵与错题重练</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                      <span><strong>发音录音比对打分</strong>：本地声学算法评分</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                      <span><strong>日历任务与词库管理</strong>：复习计划与增删查改</span>
                    </div>
                    <div className="flex items-center gap-1.5 sm:col-span-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                      <span><strong>Home Assistant (HA) 联动</strong>：音箱播报与智能家居控制</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-emerald-700/90 pt-0.5 border-t border-emerald-200/60 mt-1">
                    💡 提示：即使您不配置 AI Key，以上所有听写、记忆、真人发音与录音打分功能均可长期免费畅用。
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* AI Model Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                <span>AI 大模型配置 (支持自定义输入)</span>
              </label>
              <span className="text-[11px] text-slate-400">视觉多模态 / 文本增强</span>
            </div>

            {/* Quick dropdown */}
            <select
              value={
                [
                  'Pro/moonshotai/Kimi-K2.6',
                  'Qwen/Qwen3.8-27B',
                  'Qwen/Qwen3.6-27B',
                  'Qwen/Qwen3.5-27B',
                  'deepseek-ai/DeepSeek-V4-Flash',
                  'Qwen/Qwen2-VL-72B-Instruct',
                  'Pro/Qwen/Qwen2-VL-7B-Instruct'
                ].includes(model)
                  ? model
                  : '__custom__'
              }
              onChange={(e) => {
                if (e.target.value !== '__custom__') {
                  setModel(e.target.value);
                }
              }}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-xs font-semibold text-slate-800"
            >
              <option value="Pro/moonshotai/Kimi-K2.6">Pro/moonshotai/Kimi-K2.6 (Kimi 高阶大模型)</option>
              <option value="Qwen/Qwen3.8-27B">Qwen/Qwen3.8-27B (通义千问 3.8)</option>
              <option value="Qwen/Qwen3.6-27B">Qwen/Qwen3.6-27B (通义千问 3.6)</option>
              <option value="Qwen/Qwen3.5-27B">Qwen/Qwen3.5-27B (通义千问 3.5)</option>
              <option value="deepseek-ai/DeepSeek-V4-Flash">deepseek-ai/DeepSeek-V4-Flash (深度求索闪电版)</option>
              <option value="Qwen/Qwen2-VL-72B-Instruct">Qwen/Qwen2-VL-72B-Instruct (多模态视觉高精推荐)</option>
              <option value="Pro/Qwen/Qwen2-VL-7B-Instruct">Pro/Qwen2-VL-7B-Instruct (极速轻量视觉)</option>
              <option value="__custom__">✍️ 自定义输入其他模型名称...</option>
            </select>

            {/* Direct custom text input */}
            <div className="relative">
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value.trim())}
                placeholder="在此直接输入或编辑模型标识，如 Pro/moonshotai/Kimi-K2.6"
                className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 text-xs font-mono text-slate-800"
              />
            </div>

            {/* Quick-select chips */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-[11px] text-slate-400 font-medium">快捷填入：</span>
              {[
                { name: 'Kimi-K2.6', full: 'Pro/moonshotai/Kimi-K2.6' },
                { name: 'Qwen3.8-27B', full: 'Qwen/Qwen3.8-27B' },
                { name: 'Qwen3.6-27B', full: 'Qwen/Qwen3.6-27B' },
                { name: 'Qwen3.5-27B', full: 'Qwen/Qwen3.5-27B' },
                { name: 'DeepSeek-V4-Flash', full: 'deepseek-ai/DeepSeek-V4-Flash' },
                { name: 'Qwen2-VL-72B', full: 'Qwen/Qwen2-VL-72B-Instruct' },
              ].map(chip => (
                <button
                  key={chip.full}
                  type="button"
                  onClick={() => setModel(chip.full)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-mono transition-all ${
                    model === chip.full
                      ? 'bg-indigo-600 text-white font-bold shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                  }`}
                >
                  {chip.name}
                </button>
              ))}
            </div>
          </div>

          {/* Accent Preference */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 font-semibold text-slate-800">
              <Volume2 className="w-4 h-4 text-emerald-500" />
              <span>默认发音口音</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAccent('us')}
                className={`py-2 px-4 rounded-xl border font-medium flex items-center justify-center gap-2 transition-all ${
                  accent === 'us'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                }`}
              >
                <span>🇺🇸 美式发音 (US)</span>
              </button>
              <button
                type="button"
                onClick={() => setAccent('uk')}
                className={`py-2 px-4 rounded-xl border font-medium flex items-center justify-center gap-2 transition-all ${
                  accent === 'uk'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                }`}
              >
                <span>🇬🇧 英式发音 (UK)</span>
              </button>
            </div>
          </div>

          {/* Speed Preference */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 font-semibold text-slate-800">
                <Gauge className="w-4 h-4 text-amber-500" />
                <span>发音语速 (当前: {speed}x)</span>
              </label>
              <button
                type="button"
                onClick={() => playWordAudio('pronunciation', accent, speed)}
                className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-semibold hover:underline"
                title="试听当前语速效果"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>试听当前语速</span>
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: '0.75x 慢速', val: 0.75 },
                { label: '0.9x 较慢', val: 0.9 },
                { label: '1.0x 正常', val: 1.0 },
                { label: '1.25x 较快', val: 1.25 },
              ].map(opt => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => {
                    setSpeed(opt.val);
                    playWordAudio('brilliant', accent, opt.val);
                  }}
                  className={`py-2 px-2 text-xs rounded-xl border font-semibold text-center transition-all ${
                    speed === opt.val
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-xs'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>


          {/* Auto-play toggle */}
          <div className="flex items-center justify-between pt-2">
            <div>
              <div className="font-semibold text-slate-800">切换单词时自动朗读</div>
              <div className="text-xs text-slate-500">听写/记忆切换到下一词时自动发音</div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoPlay}
                onChange={(e) => setAutoPlay(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          {/* User API Token Card (for external scripts / curl) */}
          {isAuthenticated && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-slate-800 text-xs">
                  <Key className="w-3.5 h-3.5 text-indigo-600" />
                  <span>我的 API 鉴权 Token (Bearer Token)</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyToken}
                  className="px-2.5 py-1 bg-white hover:bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-lg text-xs font-bold transition-all flex items-center gap-1 shadow-xs cursor-pointer"
                >
                  {copiedToken ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-600">已复制到剪贴板</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>一键复制 Token</span>
                    </>
                  )}
                </button>
              </div>
              <div className="font-mono text-[11px] bg-white text-slate-500 p-2 rounded-xl border border-slate-200 break-all select-all max-h-16 overflow-y-auto">
                {token || localStorage.getItem('tingxie_auth_token') || '暂无 Token'}
              </div>
              <p className="text-[11px] text-slate-400">
                可用于 Python、Postman 或 Shell 自动化脚本调用系统接口（请求头携带：<code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700">Authorization: Bearer &lt;Token&gt;</code>）。
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:bg-slate-200/60 rounded-xl font-medium transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white rounded-xl font-semibold shadow-md shadow-indigo-200 flex items-center gap-2 transition-all"
          >
            {savedSuccess ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                <span>已保存</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>保存设置</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
