import React, { useState, useRef } from 'react';
import { 
  X, FileText, Camera, Upload, Sparkles, Check, 
  AlertCircle, Loader2, Plus, Trash2, ArrowRight,
  FolderTree, FileUp, Settings
} from 'lucide-react';
import { api, getApiKey, DEFAULT_SILICONFLOW_API_KEY } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function ImportModal({ isOpen, onClose, lists, currentListId, onImportSuccess, onOpenSettings }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [tab, setTab] = useState('text'); // 'text' | 'photo' | 'preview'
  const [targetListId, setTargetListId] = useState(currentListId || (lists[0]?.id || ''));

  // Text / TXT Import state
  const [rawText, setRawText] = useState('');
  const [isEnrichingText, setIsEnrichingText] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [txtFileName, setTxtFileName] = useState('');

  // Structured parsed groups: [{ listPath: string, words: [...] }]
  const [parsedGroups, setParsedGroups] = useState([]);

  // Photo Import state
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeModel, setActiveModel] = useState(() => localStorage.getItem('siliconflow_model') || 'Pro/moonshotai/Kimi-K2.6');

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const txtFileInputRef = useRef(null);

  if (!isOpen) return null;

  // Format phonetic with slashes
  const formatPhonetic = (p) => {
    if (!p) return '';
    const clean = p.replace(/^[\/\[\s]+|[\/\]\s]+$/g, '');
    return clean ? `/${clean}/` : '';
  };

  // Structured TXT & text parser supporting:
  // 1. Headers: {初中/8年级上册/8上Unit1} or ｛...｝ or 【...】
  // 2. Pipe columns: word | phonetic | translation | example | example_cn (with | or ｜)
  // 3. Tab columns: word \t phonetic \t translation \t example \t example_cn
  // 4. Fallback line formats
  const parseStructuredText = (text) => {
    const raw = text.trim();
    if (!raw) return [];

    // Check if entire input is JSON array
    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        const jsonList = JSON.parse(raw);
        if (Array.isArray(jsonList)) {
          const res = [];
          for (const item of jsonList) {
            const w = (item.word || item.phrase || item.text || item.en || '').trim();
            if (!w) continue;
            let ph = (item.phonetic || item.pronunciation || item.ipa || '').trim();
            if (ph && !ph.startsWith('/') && !ph.startsWith('[')) ph = `/${ph}/`;
            res.push({
              word: w,
              phonetic: ph,
              translation: (item.translation || item.meaning || item.definition || item.trans || item.cn || '').trim(),
              example: (item.example || item.sentence || item.en_example || '').trim(),
              example_cn: (item.example_cn || item.sentence_cn || item.cn_example || '').trim(),
              selected: true,
            });
          }
          if (res.length > 0) {
            return [{ listPath: '', words: res }];
          }
        }
      } catch (e) {
        // Not valid JSON, continue line parsing
      }
    }

    const lines = text.split('\n');
    const groups = [];
    let currentGroup = {
      listPath: '',
      words: []
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

      // Skip markdown table separators like |---|---|
      if (/^\|?[\s\-:]+(\|[\s\-:]+)+\|?$/.test(line)) continue;

      // Strip leading bullet/index like 1., 1、, etc.
      let trimmed = line.replace(/^[\s\(\[\d\.\、\)\-\*\•]+(?=[a-zA-Z])/, '').trim();
      if (!trimmed) continue;

      let word = '';
      let phonetic = '';
      let translation = '';
      let example = '';
      let example_cn = '';

      // Tab-separated
      if (trimmed.includes('\t')) {
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
      } else if (trimmed.includes('|') || trimmed.includes('｜')) {
        // Pipe-separated
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
      } else {
        // General text patterns
        const phoneticMatch = trimmed.match(/^([a-zA-Z\s\-'\.]+?)\s*(?:[\/\[\\\(]([^\/\]\\\)]+)[\/\]\\\)])\s*(.*)$/);
        if (phoneticMatch) {
          word = phoneticMatch[1].trim();
          phonetic = formatPhonetic(phoneticMatch[2]);
          translation = phoneticMatch[3].trim();
        } else {
          const posOrCnMatch = trimmed.match(/^([a-zA-Z\s\-'\.]+?)(?:[\t\s\-:：]+|(?=[a-z]{1,6}\.))((?:[a-z]{1,6}\.\s*|[\u4e00-\u9fa5]|[-:：]).*)$/i);
          if (posOrCnMatch) {
            word = posOrCnMatch[1].trim();
            translation = posOrCnMatch[2].trim().replace(/^[-:：\t\s]+/, '');
          } else {
            const parts = trimmed.split(/\s+/);
            word = parts[0].trim();
            translation = trimmed.slice(word.length).trim();
          }
        }
        translation = translation.replace(/^[-:：\t\s]+/, '');
        const exSplit = translation.match(/^(.*?)(?:\s*(?:例句[：:]|e\.g\.)\s*)([a-zA-Z].*)$/i);
        if (exSplit) {
          translation = exSplit[1].trim();
          const fullEx = exSplit[2].trim();
          const exCnSplit = fullEx.match(/^(.*?)(?:\s*[（\(]([\u4e00-\u9fa5].*?)[）\)]|\s*——\s*([\u4e00-\u9fa5].*))$/);
          if (exCnSplit) {
            example = exCnSplit[1].trim();
            example_cn = (exCnSplit[2] || exCnSplit[3] || '').trim();
          } else {
            example = fullEx;
          }
        }
      }

      if (word && /^[a-zA-Z\s\-'\.]+$/.test(word)) {
        currentGroup.words.push({
          word: word.trim(),
          phonetic,
          translation,
          example,
          example_cn,
          selected: true,
        });
      }
    }

    if (currentGroup.words.length > 0 || currentGroup.listPath) {
      groups.push(currentGroup);
    }

    return groups;
  };

  // Upload and read TXT file
  const handleTxtFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTxtFileName(file.name);
    setErrorMsg('');

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        setRawText(content);
        const groups = parseStructuredText(content);
        if (groups.length > 0 && groups.some(g => g.words.length > 0)) {
          setParsedGroups(groups);
          setTab('preview');
        } else {
          setErrorMsg('未能从该文本中解析出有效单词，请检查格式');
        }
      }
    };
    reader.onerror = () => {
      setErrorMsg('读取 TXT 文件失败');
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  // Handle image upload from file or camera
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
  };

  const processImageFile = (file) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('请上传图片格式文件 (JPG, PNG, WebP等)');
      return;
    }
    setErrorMsg('');
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result);
    };
    reader.readAsDataURL(file);
  };

  // Support paste from clipboard
  const handlePaste = (e) => {
    if (tab !== 'photo') return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          processImageFile(file);
          break;
        }
      }
    }
  };

  // Call SiliconFlow Vision AI
  const handleRecognizeImage = async () => {
    if (!imageFile && !imagePreview) {
      setErrorMsg('请先上传或拍摄一张单词表照片');
      return;
    }

    const effectiveKey = getApiKey();
    if (!isAdmin && (!effectiveKey || effectiveKey === DEFAULT_SILICONFLOW_API_KEY)) {
      setErrorMsg('普通用户需在系统设置中配置您个人的 SiliconFlow API Key 后方可使用 AI 拍照识别。');
      return;
    }

    setIsRecognizing(true);
    setErrorMsg('');

    try {
      const model = activeModel || localStorage.getItem('siliconflow_model') || 'Pro/moonshotai/Kimi-K2.6';
      const result = await api.recognizeImage(imageFile || imagePreview, model);
      if (result.words && result.words.length > 0) {
        const formatted = result.words.map(w => ({ ...w, selected: true }));
        setParsedGroups([{ listPath: '', words: formatted }]);
        setTab('preview');
      } else {
        setErrorMsg('AI 未能从图片中识别出清晰的英文单词，请尝试拍摄更清晰平整的照片。');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || '识别失败，请检查网络或 API Key 设置');
    } finally {
      setIsRecognizing(false);
    }
  };

  // Direct parse text and enter preview
  const handleDirectParseText = () => {
    const groups = parseStructuredText(rawText);
    const totalWords = groups.reduce((acc, g) => acc + g.words.length, 0);
    if (totalWords === 0) {
      setErrorMsg('未解析到有效单词，请检查输入格式或参考样例');
      return;
    }
    setErrorMsg('');
    setParsedGroups(groups);
    setTab('preview');
  };

  // AI enrichment for text
  const handleEnrichText = async () => {
    const groups = parseStructuredText(rawText);
    const totalWords = groups.reduce((acc, g) => acc + g.words.length, 0);
    if (totalWords === 0) {
      setErrorMsg('请在文本框输入至少一个英文单词');
      return;
    }

    const effectiveKey = getApiKey();
    if (!isAdmin && (!effectiveKey || effectiveKey === DEFAULT_SILICONFLOW_API_KEY)) {
      setErrorMsg('普通用户需在系统设置中配置您个人的 SiliconFlow API Key 后方可使用 AI 单词补全。');
      return;
    }

    setIsEnrichingText(true);
    setErrorMsg('');

    try {
      // Flatten words to query AI
      const allWords = groups.flatMap(g => g.words);
      const result = await api.enrichWords(allWords, activeModel);
      if (result.words && result.words.length > 0) {
        let aiIdx = 0;
        const enrichedGroups = groups.map(group => ({
          ...group,
          words: group.words.map(orig => {
            const aiItem = result.words[aiIdx++] || result.words.find(rw => rw.word?.toLowerCase() === orig.word.toLowerCase());
            return {
              word: orig.word,
              phonetic: orig.phonetic || aiItem?.phonetic || '',
              translation: orig.translation || aiItem?.translation || '',
              example: orig.example || aiItem?.example || '',
              example_cn: aiItem?.example_cn || orig.example_cn || '',
              selected: true,
            };
          })
        }));
        setParsedGroups(enrichedGroups);
      } else {
        setParsedGroups(groups);
      }
      setTab('preview');
    } catch (err) {
      console.warn('Enrich fallback to direct parse:', err);
      setParsedGroups(groups);
      setTab('preview');
    } finally {
      setIsEnrichingText(false);
    }
  };

  // Calculation helpers
  const totalWordsCount = parsedGroups.reduce((acc, g) => acc + (g.words?.length || 0), 0);
  const selectedWordsCount = parsedGroups.reduce((acc, g) => acc + (g.words?.filter(w => w.selected)?.length || 0), 0);
  const hasStructuredPaths = parsedGroups.some(g => g.listPath && g.listPath.trim());

  // Update field of a word in a specific group
  const updateGroupWordField = (gIdx, wIdx, field, value) => {
    setParsedGroups(prev => {
      const next = [...prev];
      const targetGroup = { ...next[gIdx] };
      const nextWords = [...targetGroup.words];
      nextWords[wIdx] = { ...nextWords[wIdx], [field]: value };
      targetGroup.words = nextWords;
      next[gIdx] = targetGroup;
      return next;
    });
  };

  // Toggle word selection
  const toggleGroupWordSelect = (gIdx, wIdx) => {
    setParsedGroups(prev => {
      const next = [...prev];
      const targetGroup = { ...next[gIdx] };
      const nextWords = [...targetGroup.words];
      nextWords[wIdx] = { ...nextWords[wIdx], selected: !nextWords[wIdx].selected };
      targetGroup.words = nextWords;
      next[gIdx] = targetGroup;
      return next;
    });
  };

  // Toggle group select all
  const toggleGroupSelectAll = (gIdx, checked) => {
    setParsedGroups(prev => {
      const next = [...prev];
      const targetGroup = { ...next[gIdx] };
      targetGroup.words = targetGroup.words.map(w => ({ ...w, selected: checked }));
      next[gIdx] = targetGroup;
      return next;
    });
  };

  // Global toggle select all
  const toggleGlobalSelectAll = (checked) => {
    setParsedGroups(prev => prev.map(g => ({
      ...g,
      words: g.words.map(w => ({ ...w, selected: checked }))
    })));
  };

  // Update group listPath
  const updateGroupPath = (gIdx, newPath) => {
    setParsedGroups(prev => {
      const next = [...prev];
      next[gIdx] = { ...next[gIdx], listPath: newPath };
      return next;
    });
  };

  // Remove word from group
  const removeWordFromGroup = (gIdx, wIdx) => {
    setParsedGroups(prev => {
      const next = [...prev];
      const targetGroup = { ...next[gIdx] };
      targetGroup.words = targetGroup.words.filter((_, i) => i !== wIdx);
      next[gIdx] = targetGroup;
      return next;
    });
  };

  // Add blank word to group
  const addWordToGroup = (gIdx) => {
    setParsedGroups(prev => {
      const next = [...prev];
      const targetGroup = { ...next[gIdx] };
      targetGroup.words = [
        ...targetGroup.words,
        { word: '', phonetic: '', translation: '', example: '', example_cn: '', selected: true }
      ];
      next[gIdx] = targetGroup;
      return next;
    });
  };

  // Remove entire group
  const removeGroup = (gIdx) => {
    setParsedGroups(prev => prev.filter((_, i) => i !== gIdx));
  };

  // Add a new empty group
  const addNewGroup = () => {
    setParsedGroups(prev => [
      ...prev,
      {
        listPath: '',
        words: [{ word: '', phonetic: '', translation: '', example: '', example_cn: '', selected: true }]
      }
    ]);
  };

  // Commit words to server
  const handleSaveWords = async () => {
    if (selectedWordsCount === 0) {
      setErrorMsg('请至少勾选一个要导入的有效单词');
      return;
    }

    setIsSaving(true);
    setErrorMsg('');

    try {
      if (hasStructuredPaths || parsedGroups.length > 1) {
        // Structured multi-list import
        const cleanGroups = parsedGroups.map(g => ({
          listPath: g.listPath?.trim() || '',
          words: (g.words || []).filter(w => w.selected && w.word?.trim())
        })).filter(g => g.words.length > 0);

        await api.importStructuredWords({
          groups: cleanGroups,
          defaultListId: targetListId ? Number(targetListId) : null
        });
      } else {
        // Single group flat import
        const singleWords = (parsedGroups[0]?.words || []).filter(w => w.selected && w.word?.trim());
        await api.batchImportWords(singleWords, targetListId ? Number(targetListId) : null);
      }

      onImportSuccess?.();
      onClose();
    } catch (err) {
      console.error('Save words error:', err);
      setErrorMsg(err.message || '保存入库失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto"
      onPaste={handlePaste}
    >
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh] animate-scale-up">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 bg-slate-50/90 shrink-0">
          <div className="flex items-center gap-2 font-bold text-slate-800 text-base sm:text-lg">
            <span>导入单词表</span>
            {txtFileName && (
              <span className="text-xs font-normal px-2 py-0.5 rounded-md bg-indigo-100/70 text-indigo-700">
                {txtFileName}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switchers */}
        <div className="flex border-b border-slate-200 bg-slate-50/50 px-3 sm:px-6 pt-2 overflow-x-auto shrink-0">
          <button
            type="button"
            onClick={() => setTab('text')}
            className={`pb-2.5 sm:pb-3 px-3 sm:px-4 text-xs sm:text-sm font-semibold flex items-center gap-1.5 sm:gap-2 border-b-2 transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              tab === 'text'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>📄 文本 / TXT 多词单导入</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('photo')}
            className={`pb-2.5 sm:pb-3 px-3 sm:px-4 text-xs sm:text-sm font-semibold flex items-center gap-1.5 sm:gap-2 border-b-2 transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              tab === 'photo'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>📷 AI 拍照识别</span>
          </button>
          {totalWordsCount > 0 && (
            <button
              type="button"
              onClick={() => setTab('preview')}
              className={`pb-2.5 sm:pb-3 px-3 sm:px-4 text-xs sm:text-sm font-semibold flex items-center gap-1.5 sm:gap-2 border-b-2 transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                tab === 'preview'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Check className="w-4 h-4" />
              <span>待确认 ({selectedWordsCount}/{totalWordsCount} 词{parsedGroups.length > 1 ? ` · ${parsedGroups.length} 词单` : ''})</span>
            </button>
          )}
        </div>

        {/* Target List & AI Model Selector Bar */}
        <div className="px-3 sm:px-6 py-2.5 bg-indigo-50/60 border-b border-indigo-100 flex flex-col md:flex-row md:items-center justify-between gap-2 sm:gap-3 text-xs shrink-0">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-slate-700 font-bold whitespace-nowrap">默认归属词单：</span>
            <select
              value={targetListId}
              onChange={(e) => setTargetListId(e.target.value)}
              className="w-full sm:w-auto px-2 sm:px-2.5 py-1 bg-white border border-indigo-200 rounded-lg text-slate-700 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
            >
              <option value="">仅加入候选总词库 (未归类)</option>
              {lists.map(l => (
                <option key={l.id} value={l.id}>
                  {l.is_folder ? `📁 分类: ${l.name}` : `📄 词单: ${l.name} (${l.word_count || 0} 词)`}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              (文本中指定了 <code className="font-mono text-indigo-700">{`{词单名}`}</code> 时优先按文本路径归类)
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-700 font-bold whitespace-nowrap flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>AI 模型：</span>
            </span>
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
                ].includes(activeModel)
                  ? activeModel
                  : '__custom__'
              }
              onChange={(e) => {
                if (e.target.value !== '__custom__') {
                  setActiveModel(e.target.value);
                  localStorage.setItem('siliconflow_model', e.target.value);
                }
              }}
              className="px-2 py-1 bg-white border border-indigo-200 rounded-lg text-slate-700 text-[11px] font-medium"
            >
              <option value="Pro/moonshotai/Kimi-K2.6">Kimi-K2.6</option>
              <option value="Qwen/Qwen3.8-27B">Qwen3.8-27B</option>
              <option value="Qwen/Qwen3.6-27B">Qwen3.6-27B</option>
              <option value="Qwen/Qwen3.5-27B">Qwen3.5-27B</option>
              <option value="deepseek-ai/DeepSeek-V4-Flash">DeepSeek-V4-Flash</option>
              <option value="Qwen/Qwen2-VL-72B-Instruct">Qwen2-VL-72B (视觉推荐)</option>
              <option value="Pro/Qwen/Qwen2-VL-7B-Instruct">Qwen2-VL-7B (轻量)</option>
              <option value="__custom__">自定义输入</option>
            </select>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {errorMsg && (
            <div className="flex items-center justify-between gap-2.5 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm animate-fade-in flex-wrap">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>{errorMsg}</span>
              </div>
              {onOpenSettings && errorMsg.includes('系统设置') && (
                <button
                  type="button"
                  onClick={() => onOpenSettings()}
                  className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0 shadow-xs flex items-center gap-1"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>前往系统设置配置密钥</span>
                </button>
              )}
            </div>
          )}

          {/* TAB 1: Text & TXT Import */}
          {tab === 'text' && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <label className="block text-sm font-semibold text-slate-800">
                    输入或上传 TXT 文本 (支持 <code className="text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded font-mono">{`{词单名}`}</code> 多词单与层级分类)
                  </label>
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <button
                      type="button"
                      onClick={() => txtFileInputRef.current?.click()}
                      className="px-2.5 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-bold flex items-center gap-1 cursor-pointer transition-colors"
                      title="从本地计算机选择 .txt 格式文件直接导入"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      <span>选择 TXT 文件</span>
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setRawText(`{初中/8年级上册/8上Unit1}\nancient | /ˈeɪnʃənt/ | adj. 古代的；古老的 | This is an ancient temple. | 这是一座古老的寺庙。\nmatch | /mætʃ/ | n. 比赛；火柴 | We won the football match. | 我们赢了足球赛。\n\n{初中/8年级上册/8上Unit2}\nactivity | /ækˈtɪvəti/ | n. 活动 | There are many outdoor activities. | 有很多户外活动。\ndecide | /dɪˈsaɪd/ | v. 决定 | I decided to stay at home. | 我决定留在家里。`)}
                      className="text-indigo-600 hover:text-indigo-800 font-semibold hover:underline cursor-pointer"
                      title="载入带 {学段/分类/词单名} 的多词单样例"
                    >
                      <span>填入多词单TXT样例</span>
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setRawText(`ancient | /ˈeɪnʃənt/ | adj. 古代的；古老的 | This is an ancient temple. | 这是一座古老的寺庙。\nmatch | /mætʃ/ | n. 比赛；火柴 | We won the football match. | 我们赢了足球赛。\napple | /ˈæpl/ | n. 苹果 | An apple a day keeps the doctor away. | 一天一苹果，医生远离我。`)}
                      className="text-indigo-600 hover:text-indigo-800 font-semibold hover:underline cursor-pointer"
                      title="填入标准竖线 | 样例"
                    >
                      <span>单词单样例</span>
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setRawText(`ancient\t/ˈeɪnʃənt/\tadj. 古代的；古老的\tThis is an ancient temple.\t这是一座古老的寺庙。\nmatch\t/mætʃ/\tn. 比赛；火柴\tWe won the football match.\t我们赢了足球赛。`)}
                      className="text-indigo-600 hover:text-indigo-800 font-semibold hover:underline cursor-pointer"
                      title="填入制表符 Tab (Excel 复制) 样例"
                    >
                      <span>Excel样例</span>
                    </button>
                  </div>
                </div>

                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={`【格式规则说明】\n{词单名或分类路径}\n单词/短语 | 音标 | 解释 | 例句 | 例句意思\n\n例如：\n{初中/8年级上册/8上Unit1}\nancient | /ˈeɪnʃənt/ | adj. 古代的；古老的 | This is an ancient temple. | 这是一座古老的寺庙。\nmatch | /mætʃ/ | n. 比赛；火柴 | We won the football match. | 我们赢了足球赛。\n\n{初中/8年级上册/8上Unit2}\nactivity | /ækˈtɪvəti/ | n. 活动 | There are many outdoor activities. | 有很多户外活动。\n\n💡 提示：支持包含多个词单，每个词单下的单词自动加入该词单直到遇到下一个 {新词单}。若词单目录不存在将自动创建！`}
                  rows={9}
                  className="w-full p-3.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:outline-hidden text-xs sm:text-sm font-mono leading-relaxed"
                />

                <input
                  ref={txtFileInputRef}
                  type="file"
                  accept=".txt,text/plain"
                  className="hidden"
                  onChange={handleTxtFileChange}
                />
              </div>

              {/* Format Hints Card */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs text-slate-600 space-y-2">
                <div className="font-bold text-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <FolderTree className="w-4 h-4 text-indigo-600" />
                    <span>TXT 导入规范与多词单支持特性：</span>
                  </div>
                  <span className="text-[11px] text-indigo-600 font-medium">全自动递归创建层级目录</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-600 pl-1">
                  <div className="space-y-1">
                    <span className="font-semibold text-indigo-700">① 多层级词单声明：</span>
                    <div className="font-mono text-slate-800 bg-white px-2 py-1 rounded border border-slate-200 text-[10px]">
                      {`{初中/8年级上册/8上Unit1}`} 或 {`{新概念英语第二册}`}
                    </div>
                    <p className="text-[10px] text-slate-500">斜杠 <code className="font-mono">/</code> 分隔层级，前面作为分类目录，末尾作为词单名。</p>
                  </div>
                  <div className="space-y-1">
                    <span className="font-semibold text-indigo-700">② 字段格式（支持全角/半角竖线或Tab）：</span>
                    <div className="font-mono text-slate-800 bg-white px-2 py-1 rounded border border-slate-200 text-[10px]">
                      单词/短语 | 音标 | 解释 | 例句 | 例句意思
                    </div>
                    <p className="text-[10px] text-slate-500">如没有例句可仅提供单词与释义，系统自适应缺省字段。</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                <div className="text-xs text-slate-500 order-2 sm:order-1">
                  已自带音标和例句翻译可直接点击“直接解析预览”；若需 AI 协助查词补例句可点击“AI 智能补全”。
                </div>
                <div className="flex items-center gap-2 sm:gap-3 order-1 sm:order-2">
                  <button
                    type="button"
                    onClick={handleDirectParseText}
                    className="flex-1 sm:flex-none px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-xs sm:text-sm transition-all cursor-pointer shadow-xs"
                  >
                    直接解析预览
                  </button>
                  <button
                    type="button"
                    onClick={handleEnrichText}
                    disabled={isEnrichingText}
                    className="flex-1 sm:flex-none px-4 sm:px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs sm:text-sm shadow-md shadow-indigo-200 flex items-center justify-center gap-1.5 sm:gap-2 transition-all disabled:opacity-60 cursor-pointer"
                  >
                    {isEnrichingText ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>AI 正在查询补全...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>AI 智能补全例句</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Photo & Vision AI */}
          {tab === 'photo' && (
            <div className="space-y-4">
              {!isAdmin && (!getApiKey() || getApiKey() === DEFAULT_SILICONFLOW_API_KEY) && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>普通用户需在系统设置中配置个人的 SiliconFlow API Key 方可使用拍照识别。</span>
                  </div>
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={() => onOpenSettings()}
                      className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs transition-colors shrink-0 cursor-pointer flex items-center gap-1"
                    >
                      <Settings className="w-3 h-3" />
                      <span>配置密钥</span>
                    </button>
                  )}
                </div>
              )}
              <div 
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
                  imagePreview 
                    ? 'border-indigo-300 bg-indigo-50/30' 
                    : 'border-slate-300 hover:border-indigo-400 bg-slate-50/50 hover:bg-slate-50'
                }`}
              >
                {imagePreview ? (
                  <div className="space-y-4">
                    <div className="relative inline-block max-h-64 rounded-xl overflow-hidden shadow-md border border-slate-200">
                      <img 
                        src={imagePreview} 
                        alt="单词表预览" 
                        className="max-h-64 object-contain mx-auto"
                      />
                      <button
                        onClick={() => { setImagePreview(null); setImageFile(null); }}
                        className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors cursor-pointer"
                        title="重新选择"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={handleRecognizeImage}
                        disabled={isRecognizing}
                        className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white rounded-xl font-semibold shadow-md shadow-indigo-200 flex items-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
                      >
                        {isRecognizing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>硅基流动 AI 正在提取单词...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            <span>调用 AI 识别并解析成列表</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 space-y-4">
                    <div className="w-16 h-16 mx-auto bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center shadow-inner">
                      <Camera className="w-8 h-8" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-800 text-base">拍照或上传单词表照片</h4>
                      <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                        支持书本课文后单词表、纸质手抄笔记、词汇试卷截图等。支持直接按 <kbd className="px-1.5 py-0.5 bg-slate-200 rounded font-mono text-xs">Ctrl + V</kbd> 粘贴剪贴板截图。
                      </p>
                    </div>

                    <div className="flex items-center justify-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2 bg-white border border-slate-300 hover:border-indigo-400 text-slate-700 font-semibold rounded-xl text-sm shadow-xs hover:bg-slate-50 flex items-center gap-2 transition-all cursor-pointer"
                      >
                        <Upload className="w-4 h-4 text-indigo-500" />
                        <span>选择图片文件</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm shadow-sm flex items-center gap-2 transition-all cursor-pointer"
                      >
                        <Camera className="w-4 h-4" />
                        <span>直接拍照</span>
                      </button>
                    </div>

                    <input 
                      ref={fileInputRef} 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={handleFileChange} 
                    />
                    <input 
                      ref={cameraInputRef} 
                      type="file" 
                      accept="image/*" 
                      capture="environment" 
                      className="hidden" 
                      onChange={handleFileChange} 
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Preview & Confirmation */}
          {tab === 'preview' && (
            <div className="space-y-4">
              {/* Preview top toolbar */}
              <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-100/80 p-3 rounded-xl gap-2 flex-wrap">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 font-bold text-slate-800 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={totalWordsCount > 0 && selectedWordsCount === totalWordsCount}
                      onChange={(e) => toggleGlobalSelectAll(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>全局全选 (已选 {selectedWordsCount} / 共 {totalWordsCount} 词)</span>
                  </label>
                  {parsedGroups.length > 1 && (
                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold text-[11px]">
                      共 {parsedGroups.length} 个词单
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={addNewGroup}
                    className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg font-medium flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 text-indigo-600" />
                    <span>添加词单分组</span>
                  </button>
                  <span className="text-[11px] text-slate-400 hidden sm:inline">表格单元格可直接点击修改</span>
                </div>
              </div>

              {/* Grouped lists */}
              <div className="space-y-4 max-h-[58vh] overflow-y-auto pr-1">
                {parsedGroups.map((group, gIdx) => {
                  const groupSelectedCount = group.words.filter(w => w.selected).length;
                  const isAllGroupSelected = group.words.length > 0 && groupSelectedCount === group.words.length;

                  return (
                    <div key={gIdx} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                      {/* Group Header */}
                      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
                          <FolderTree className="w-4 h-4 text-indigo-600 shrink-0" />
                          <span className="text-xs font-bold text-slate-700 whitespace-nowrap">目标词单路径:</span>
                          <input
                            type="text"
                            value={group.listPath}
                            onChange={(e) => updateGroupPath(gIdx, e.target.value)}
                            placeholder="例如: 初中/8年级上册/8上Unit1 (留空则归入上方默认词单)"
                            className="flex-1 px-2.5 py-1 bg-white border border-slate-200 hover:border-indigo-300 focus:border-indigo-500 rounded-lg text-xs font-semibold text-indigo-900 focus:outline-hidden"
                          />
                        </div>

                        <div className="flex items-center gap-3 text-xs">
                          <label className="flex items-center gap-1.5 text-slate-600 font-medium cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isAllGroupSelected}
                              onChange={(e) => toggleGroupSelectAll(gIdx, e.target.checked)}
                              className="rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            <span>全选 ({groupSelectedCount}/{group.words.length})</span>
                          </label>

                          <button
                            type="button"
                            onClick={() => addWordToGroup(gIdx)}
                            className="text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                            title="在此词单中追加一个单词"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>加词</span>
                          </button>

                          {parsedGroups.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeGroup(gIdx)}
                              className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-1 rounded cursor-pointer transition-colors"
                              title="删除此词单及下属单词"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Words Table for this group */}
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[620px] text-left text-xs border-collapse">
                          <thead className="bg-slate-50/70 text-slate-500 uppercase font-semibold border-b border-slate-200/80">
                            <tr>
                              <th className="p-2 w-10 text-center">选</th>
                              <th className="p-2 w-32">单词 / 短语</th>
                              <th className="p-2 w-28">音标</th>
                              <th className="p-2 w-44">词性与释义</th>
                              <th className="p-2">英文例句</th>
                              <th className="p-2 w-40">例句翻译</th>
                              <th className="p-2 w-10 text-center">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {group.words.map((item, wIdx) => (
                              <tr 
                                key={wIdx} 
                                className={item.selected ? 'hover:bg-indigo-50/20' : 'bg-slate-50/40 opacity-55'}
                              >
                                <td className="p-2 text-center">
                                  <input
                                    type="checkbox"
                                    checked={!!item.selected}
                                    onChange={() => toggleGroupWordSelect(gIdx, wIdx)}
                                    className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={item.word || ''}
                                    onChange={(e) => updateGroupWordField(gIdx, wIdx, 'word', e.target.value)}
                                    placeholder="英文单词/短语"
                                    className="w-full px-2 py-1 bg-transparent border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded font-bold text-slate-900"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={item.phonetic || ''}
                                    onChange={(e) => updateGroupWordField(gIdx, wIdx, 'phonetic', e.target.value)}
                                    placeholder="/音标/"
                                    className="w-full px-2 py-1 bg-transparent border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded font-mono text-slate-600"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={item.translation || ''}
                                    onChange={(e) => updateGroupWordField(gIdx, wIdx, 'translation', e.target.value)}
                                    placeholder="中文释义"
                                    className="w-full px-2 py-1 bg-transparent border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded text-slate-800 font-medium"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={item.example || ''}
                                    onChange={(e) => updateGroupWordField(gIdx, wIdx, 'example', e.target.value)}
                                    placeholder="英文例句"
                                    className="w-full px-2 py-1 bg-transparent border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded text-slate-600"
                                  />
                                </td>
                                <td className="p-1.5">
                                  <input
                                    type="text"
                                    value={item.example_cn || ''}
                                    onChange={(e) => updateGroupWordField(gIdx, wIdx, 'example_cn', e.target.value)}
                                    placeholder="例句翻译"
                                    className="w-full px-2 py-1 bg-transparent border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded text-slate-600"
                                  />
                                </td>
                                <td className="p-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => removeWordFromGroup(gIdx, wIdx)}
                                    className="p-1 text-slate-400 hover:text-rose-600 rounded-md transition-colors cursor-pointer"
                                    title="删除此行"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap shrink-0">
          <div className="text-xs text-slate-600 font-medium">
            {tab === 'preview' ? (
              <span>
                已选择 <strong className="text-indigo-600 font-bold">{selectedWordsCount}</strong> / {totalWordsCount} 词
                {parsedGroups.length > 1 && ` (分布于 ${parsedGroups.length} 个词单)`}
              </span>
            ) : ''}
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 sm:px-4 py-2 text-slate-600 hover:bg-slate-200/60 rounded-xl font-medium transition-colors text-xs sm:text-sm cursor-pointer"
            >
              取消
            </button>
            {tab === 'preview' ? (
              <button
                type="button"
                onClick={handleSaveWords}
                disabled={isSaving || selectedWordsCount === 0}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl font-bold shadow-md shadow-emerald-200 flex items-center gap-1.5 sm:gap-2 transition-all text-xs sm:text-sm disabled:opacity-50 cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>正在批量入库...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>确认入库并保存 ({selectedWordsCount})</span>
                  </>
                )}
              </button>
            ) : (
              totalWordsCount > 0 && (
                <button
                  type="button"
                  onClick={() => setTab('preview')}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-md shadow-indigo-200 flex items-center gap-2 transition-all text-sm cursor-pointer"
                >
                  <span>前往预览 ({totalWordsCount})</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
