import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Play, 
  BookOpen, Plus, Trash2, Volume2, CheckCircle2, Award, 
  HelpCircle, Sparkles, Home, Copy, Check, ExternalLink, RefreshCw, X,
  CheckCheck, Pin, CalendarDays, Radio, CheckSquare, Square,
  ChevronsLeft, ChevronsRight, Shuffle, Pencil, Flame,
  ChevronUp, ChevronDown, ArrowUpDown
} from 'lucide-react';
import { api } from '../api/client';
import { playWordAudio } from '../utils/audio';
import { useAuth } from '../context/AuthContext';

// Helper for generating page numbers pagination array
function getPageNumbers(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, '...', total];
  }
  if (current >= total - 3) {
    return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, '...', current - 1, current, current + 1, '...', total];
}

// Helper to shuffle array (Fisher-Yates)
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Helper to format local YYYY-MM-DD
function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function CalendarView({ onStartDictation, onStartMemory, onRefreshStats }) {
  const { user, isAuthenticated, isAdmin, openAuthModal } = useAuth();
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateString());
  const [currentYearMonth, setCurrentYearMonth] = useState(() => getLocalDateString().slice(0, 7));
  const [summaryData, setSummaryData] = useState([]);
  const [dailyWords, setDailyWords] = useState([]);
  const [loadingWords, setLoadingWords] = useState(false);
  const [selectedWordIds, setSelectedWordIds] = useState(new Set());

  // Task title / name states for selected date
  const [dailyTitle, setDailyTitle] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  // Active Target Date state for today / HA tasks
  const [activeDateInfo, setActiveDateInfo] = useState({ activeDate: null, effectiveDate: '', today: '' });
  const [settingActiveDate, setSettingActiveDate] = useState(false);

  // Modal states
  const [showAddWordsModal, setShowAddWordsModal] = useState(false);
  const [showHaModal, setShowHaModal] = useState(false);

  // Add words picker states
  const [availableWords, setAvailableWords] = useState([]);
  const [lists, setLists] = useState([]);
  const [selectedSourceListId, setSelectedSourceListId] = useState('');
  const [searchPickerQuery, setSearchPickerQuery] = useState('');
  const [pickerSelectedIds, setPickerSelectedIds] = useState(new Set());
  const [pickerFilterMistakesOnly, setPickerFilterMistakesOnly] = useState(false);
  const [isAddingWords, setIsAddingWords] = useState(false);

  // Modal pagination state
  const [pickerPageSize, setPickerPageSize] = useState(() => {
    const saved = localStorage.getItem('calendar_picker_page_size');
    return saved !== null ? Number(saved) : 20;
  });
  const [pickerCurrentPage, setPickerCurrentPage] = useState(1);
  const pickerListRef = useRef(null);

  const handlePickerPageSizeChange = (size) => {
    setPickerPageSize(size);
    localStorage.setItem('calendar_picker_page_size', size);
    setPickerCurrentPage(1);
  };

  // Task-specific shuffle option state (independent per calendar task date)
  const [isShuffle, setIsShuffle] = useState(false);

  const handleToggleShuffle = async (val) => {
    setIsShuffle(val);
    try {
      await api.setDailyDateShuffle(selectedDate, val);
      // Synchronize in local month summaryData so calendar day cell reflects the mode immediately
      setSummaryData(prev => prev.map(item => 
        item.date === selectedDate ? { ...item, is_shuffle: val ? 1 : 0 } : item
      ));
    } catch (err) {
      console.error('Failed to sync shuffle setting for date:', err);
    }
  };

  const handleStartDailyDictation = () => {
    if (dailyWords.length === 0) return;
    const wordsToPlay = isShuffle ? shuffleArray(dailyWords) : dailyWords;
    const baseTitle = dailyTitle ? `${selectedDate} ${dailyTitle}` : `${selectedDate}`;
    const title = isShuffle ? `${baseTitle} (随机听写)` : `${baseTitle} (顺序听写)`;
    onStartDictation(wordsToPlay, title);
  };

  const handleStartDailyMemory = () => {
    if (dailyWords.length === 0) return;
    const wordsToPlay = isShuffle ? shuffleArray(dailyWords) : dailyWords;
    const baseTitle = dailyTitle ? `${selectedDate} ${dailyTitle}` : `${selectedDate}`;
    const title = isShuffle ? `${baseTitle} (随机记忆)` : `${baseTitle} (顺序记忆)`;
    onStartMemory(wordsToPlay, title);
  };

  // HA Live test state
  const [haStatus, setHaStatus] = useState(null);
  const [haLoading, setHaLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');

  // 0. Fetch Active Date Setting
  const fetchActiveDateInfo = async () => {
    try {
      const data = await api.getActiveDate();
      setActiveDateInfo(data);
    } catch (err) {
      console.error('Failed to fetch active date:', err);
    }
  };

  const handleSetActiveDate = async (targetDate) => {
    setSettingActiveDate(true);
    try {
      const res = await api.setActiveDate(targetDate);
      setActiveDateInfo({
        activeDate: res.activeDate,
        effectiveDate: res.effectiveDate,
        today: res.today
      });
      if (haStatus) {
        loadHaStatus();
      }
    } catch (err) {
      alert(err.message || '设置今日指定日期失败');
    } finally {
      setSettingActiveDate(false);
    }
  };

  // 1. Fetch Month Summary
  const fetchMonthSummary = async () => {
    try {
      const data = await api.getCalendarSummary(currentYearMonth);
      setSummaryData(data);
    } catch (err) {
      console.error('Failed to fetch summary:', err);
    }
  };

  // 2. Fetch Selected Date's Words
  const fetchDailyWords = async (date = selectedDate) => {
    setLoadingWords(true);
    try {
      const data = await api.getDailyPlan(date);
      setDailyWords(data.words || []);
      setDailyTitle(data.title || '');
      setTitleInput(data.title || '');
      setIsShuffle(Boolean(data.is_shuffle));
      setIsEditingTitle(false);
      setSelectedWordIds(new Set());
    } catch (err) {
      console.error('Failed to fetch daily words:', err);
    } finally {
      setLoadingWords(false);
    }
  };

  const handleSaveTitle = async () => {
    setIsSavingTitle(true);
    try {
      const res = await api.setDailyTitle(selectedDate, titleInput.trim());
      setDailyTitle(res.title || '');
      setTitleInput(res.title || '');
      setIsEditingTitle(false);
      // Refresh month summary so calendar grid shows updated title badge immediately
      fetchMonthSummary();
    } catch (err) {
      alert(err.message || '保存任务名称失败');
    } finally {
      setIsSavingTitle(false);
    }
  };

  const handleCancelEditTitle = () => {
    setTitleInput(dailyTitle || '');
    setIsEditingTitle(false);
  };

  useEffect(() => {
    fetchMonthSummary();
    fetchActiveDateInfo();
  }, [currentYearMonth, user]);

  useEffect(() => {
    fetchDailyWords(selectedDate);
  }, [selectedDate, user]);

  // Periodically check activeDate expiration (e.g. across midnight) and on window focus
  useEffect(() => {
    const handleFocus = () => {
      fetchActiveDateInfo();
      fetchDailyWords(selectedDate);
    };
    window.addEventListener('focus', handleFocus);
    const intervalTimer = setInterval(() => {
      fetchActiveDateInfo();
    }, 60000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(intervalTimer);
    };
  }, [selectedDate]);

  // Handle Month Navigation
  const handlePrevMonth = () => {
    const [year, month] = currentYearMonth.split('-').map(Number);
    const prevDate = new Date(year, month - 2, 1);
    setCurrentYearMonth(prevDate.toISOString().slice(0, 7));
  };

  const handleNextMonth = () => {
    const [year, month] = currentYearMonth.split('-').map(Number);
    const nextDate = new Date(year, month, 1);
    setCurrentYearMonth(nextDate.toISOString().slice(0, 7));
  };

  const handleGoToday = () => {
    const today = getLocalDateString();
    setSelectedDate(today);
    setCurrentYearMonth(today.slice(0, 7));
  };

  // Generate calendar grid
  const [currentYear, currentMonthNum] = currentYearMonth.split('-').map(Number);
  const firstDayOfMonth = new Date(currentYear, currentMonthNum - 1, 1).getDay(); // 0 is Sunday
  // Normalize Monday as first day of week: 0=Mon, ..., 6=Sun
  const startDayOffset = (firstDayOfMonth + 6) % 7;
  const daysInMonth = new Date(currentYear, currentMonthNum, 0).getDate();

  // Map summary for quick lookup
  const summaryMap = new Map();
  summaryData.forEach(item => {
    summaryMap.set(item.date, item);
  });

  // Set of word IDs currently in the selected date's daily plan
  const dailyWordIds = useMemo(() => new Set(dailyWords.map(w => w.id)), [dailyWords]);

  // Remove selected words from daily plan
  const handleRemoveSelected = async () => {
    if (selectedWordIds.size === 0) return;
    if (!window.confirm(`确定将选中的 ${selectedWordIds.size} 个单词从 ${selectedDate} 的听写计划中移除吗？`)) return;

    try {
      await api.removeWordsFromDailyPlan(selectedDate, Array.from(selectedWordIds));
      setSelectedWordIds(new Set());
      fetchDailyWords(selectedDate);
      fetchMonthSummary();
      onRefreshStats?.();
    } catch (err) {
      alert(err.message || '移除失败');
    }
  };

  // Remove single word from daily plan
  const handleRemoveSingleWord = async (word, e) => {
    e?.stopPropagation();
    if (!window.confirm(`确定将【${word.word}】从 ${selectedDate} 的听写计划中移除吗？`)) return;

    try {
      await api.removeWordsFromDailyPlan(selectedDate, [word.id]);
      setSelectedWordIds(prev => {
        const next = new Set(prev);
        next.delete(word.id);
        return next;
      });
      fetchDailyWords(selectedDate);
      fetchMonthSummary();
      onRefreshStats?.();
    } catch (err) {
      alert(err.message || '移除失败');
    }
  };

  // Quick toggle mistake status (mark mistake if 0, reset if >0)
  const handleQuickToggleMistake = async (word, e) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    const currentCount = word.mistake_count || 0;
    try {
      if (currentCount > 0) {
        await api.resetWordMistake(word.id);
        setDailyWords(prev => prev.map(w => w.id === word.id ? { ...w, mistake_count: 0 } : w));
        setAvailableWords(prev => prev.map(w => w.id === word.id ? { ...w, mistake_count: 0 } : w));
      } else {
        await api.setWordMistake(word.id, { count: 1 });
        setDailyWords(prev => prev.map(w => w.id === word.id ? { ...w, mistake_count: 1 } : w));
        setAvailableWords(prev => prev.map(w => w.id === word.id ? { ...w, mistake_count: 1 } : w));
      }
      onRefreshStats?.();
    } catch (err) {
      alert(err.message || '易错标记更新失败');
    }
  };

  // Reorder daily word (move up / down)
  const handleReorderWord = async (wordId, direction, e) => {
    e?.stopPropagation?.();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    try {
      await api.reorderDailyWord(selectedDate, wordId, direction);
      fetchDailyWords(selectedDate);
    } catch (err) {
      console.error(err);
    }
  };

  // Reverse entire daily plan order
  const handleReversePlan = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (dailyWords.length <= 1) return;
    try {
      await api.reverseDailyPlan(selectedDate);
      fetchDailyWords(selectedDate);
    } catch (err) {
      alert(err.message || '反转顺序失败');
    }
  };

  // Reset daily plan order to default library / list order
  const handleSortPlanDefault = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (dailyWords.length <= 1) return;
    try {
      await api.sortDailyPlanDefault(selectedDate);
      fetchDailyWords(selectedDate);
    } catch (err) {
      alert(err.message || '重排失败');
    }
  };

  // Clear entire daily plan for selected date
  const handleClearDailyPlan = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (dailyWords.length === 0) return;
    if (!window.confirm(`确定要清空 ${selectedDate} 的全部 ${dailyWords.length} 个单词听写计划吗？`)) return;

    try {
      await api.clearDailyPlan(selectedDate);
      setSelectedWordIds(new Set());
      fetchDailyWords(selectedDate);
      fetchMonthSummary();
      onRefreshStats?.();
    } catch (err) {
      alert(err.message || '清空失败');
    }
  };

  // Toggle select all daily words
  const isAllDailySelected = dailyWords.length > 0 && selectedWordIds.size === dailyWords.length;
  const handleToggleSelectAllDaily = () => {
    if (isAllDailySelected) {
      setSelectedWordIds(new Set());
    } else {
      setSelectedWordIds(new Set(dailyWords.map(w => w.id)));
    }
  };

  // Open Add Words Modal: pre-check words already in calendar checklist!
  const handleOpenAddWords = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    setShowAddWordsModal(true);
    setPickerSelectedIds(new Set(dailyWords.map(w => w.id)));
    setSearchPickerQuery('');
    setPickerFilterMistakesOnly(false);
    setPickerCurrentPage(1);
    try {
      const tree = await api.getListsTree();
      function flatten(nodes, depth = 0, pathPrefix = '') {
        let res = [];
        for (const n of nodes) {
          const fullPath = pathPrefix ? `${pathPrefix} > ${n.name}` : n.name;
          res.push({
            id: n.id,
            name: n.name,
            fullPath,
            is_folder: n.is_folder,
            word_count: n.is_folder === 1 ? (n.total_word_count || 0) : (n.word_count || 0),
            indentName: `${'　'.repeat(depth)}${n.is_folder === 1 ? '📁 ' : '📄 '}${n.name}`
          });
          if (n.children && n.children.length > 0) {
            res = res.concat(flatten(n.children, depth + 1, fullPath));
          }
        }
        return res;
      }
      const flattened = flatten(tree);
      setLists(flattened);
      loadPickerWords(selectedSourceListId);
    } catch (err) {
      console.error(err);
    }
  };

  const loadPickerWords = async (listId = '') => {
    try {
      if (listId === 'mistakes') {
        const data = await api.getWords({ onlyMistakes: true });
        setAvailableWords(data.words || []);
      } else if (listId) {
        const data = await api.getListWords(listId);
        setAvailableWords(data.words || []);
      } else {
        const data = await api.getWords();
        setAvailableWords(data.words || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddWordsSubmit = async () => {
    setIsAddingWords(true);
    try {
      const currentDailyIds = new Set(dailyWords.map(w => w.id));
      const toAddSet = new Set(Array.from(pickerSelectedIds).filter(id => !currentDailyIds.has(id)));

      // Sort toAdd according to availableWords order to guarantee correct sequence
      const inAvailable = availableWords.filter(w => toAddSet.has(w.id)).map(w => w.id);
      const inAvailableSet = new Set(inAvailable);
      const remaining = Array.from(toAddSet).filter(id => !inAvailableSet.has(id));
      const toAdd = [...inAvailable, ...remaining];

      const toRemove = Array.from(currentDailyIds).filter(id => !pickerSelectedIds.has(id));

      if (toAdd.length > 0) {
        await api.addWordsToDailyPlan(selectedDate, toAdd);
      }
      if (toRemove.length > 0) {
        await api.removeWordsFromDailyPlan(selectedDate, toRemove);
      }

      setShowAddWordsModal(false);
      fetchDailyWords(selectedDate);
      fetchMonthSummary();
      onRefreshStats?.();
    } catch (err) {
      alert(err.message || '保存计划失败');
    } finally {
      setIsAddingWords(false);
    }
  };

  // Home Assistant Live Test
  const loadHaStatus = async () => {
    setHaLoading(true);
    try {
      const data = await api.getHaStatus(selectedDate);
      setHaStatus(data);
    } catch (err) {
      console.error(err);
    } finally {
      setHaLoading(false);
    }
  };

  const triggerHaAction = async (action) => {
    setHaLoading(true);
    try {
      const data = await api.triggerHaAction(action, selectedDate);
      setHaStatus(data);
    } catch (err) {
      console.error(err);
    } finally {
      setHaLoading(false);
    }
  };

  const handleCopyCode = (key, text) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(''), 2000);
  };

  const serverPort = typeof window !== 'undefined' && window.location.port ? window.location.port : '1234';

  // Filter available words in picker
  const filteredPickerWords = availableWords.filter(w => {
    if (pickerFilterMistakesOnly && (!w.mistake_count || w.mistake_count <= 0)) return false;
    if (!searchPickerQuery.trim()) return true;
    const q = searchPickerQuery.toLowerCase().trim();
    return w.word.toLowerCase().includes(q) || (w.translation && w.translation.toLowerCase().includes(q));
  });

  // Count mistake words in the currently filtered list
  const mistakeWordsInFiltered = useMemo(() => {
    return filteredPickerWords.filter(w => (w.mistake_count || 0) > 0);
  }, [filteredPickerWords]);

  const isAllFilteredSelected = filteredPickerWords.length > 0 && filteredPickerWords.every(w => pickerSelectedIds.has(w.id));

  const toggleSelectAllFiltered = () => {
    const next = new Set(pickerSelectedIds);
    if (isAllFilteredSelected) {
      filteredPickerWords.forEach(w => next.delete(w.id));
    } else {
      filteredPickerWords.forEach(w => next.add(w.id));
    }
    setPickerSelectedIds(next);
  };

  // Quick select/unselect all mistake words in filtered list
  const isAllMistakesInFilteredSelected = mistakeWordsInFiltered.length > 0 && mistakeWordsInFiltered.every(w => pickerSelectedIds.has(w.id));
  const toggleSelectMistakesFiltered = () => {
    const next = new Set(pickerSelectedIds);
    if (isAllMistakesInFilteredSelected) {
      mistakeWordsInFiltered.forEach(w => next.delete(w.id));
    } else {
      mistakeWordsInFiltered.forEach(w => next.add(w.id));
    }
    setPickerSelectedIds(next);
  };

  const addedDiffCount = useMemo(() => {
    let count = 0;
    for (const id of pickerSelectedIds) {
      if (!dailyWordIds.has(id)) count++;
    }
    return count;
  }, [pickerSelectedIds, dailyWordIds]);

  const removedDiffCount = useMemo(() => {
    let count = 0;
    for (const id of dailyWordIds) {
      if (!pickerSelectedIds.has(id)) count++;
    }
    return count;
  }, [pickerSelectedIds, dailyWordIds]);

  // Reset page when filter or search changes
  useEffect(() => {
    setPickerCurrentPage(1);
  }, [selectedSourceListId, searchPickerQuery, pickerFilterMistakesOnly, pickerPageSize]);

  // Pagination calculations for picker modal
  const pickerTotalPages = pickerPageSize > 0 ? Math.max(1, Math.ceil(filteredPickerWords.length / pickerPageSize)) : 1;
  const validPickerCurrentPage = Math.min(Math.max(1, pickerCurrentPage), pickerTotalPages);
  const pickerStartIndex = pickerPageSize > 0 ? (validPickerCurrentPage - 1) * pickerPageSize : 0;
  const displayedPickerWords = useMemo(() => {
    if (pickerPageSize <= 0) return filteredPickerWords;
    return filteredPickerWords.slice(pickerStartIndex, pickerStartIndex + pickerPageSize);
  }, [filteredPickerWords, pickerStartIndex, pickerPageSize]);

  const isAllCurrentPageSelected = displayedPickerWords.length > 0 && displayedPickerWords.every(w => pickerSelectedIds.has(w.id));

  const toggleSelectCurrentPage = () => {
    const next = new Set(pickerSelectedIds);
    if (isAllCurrentPageSelected) {
      displayedPickerWords.forEach(w => next.delete(w.id));
    } else {
      displayedPickerWords.forEach(w => next.add(w.id));
    }
    setPickerSelectedIds(next);
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const isSelectedToday = selectedDate === todayStr;

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6 pb-4 sm:pb-6 border-b border-slate-200">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2 sm:gap-2.5">
            <CalendarIcon className="w-6 h-6 sm:w-7 sm:h-7 text-indigo-600 shrink-0" />
            <span>日历听写计划</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            为每日分配听写背诵任务，支持一键开测，并支持 Home Assistant & 小爱音箱语音联动。
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setShowHaModal(true);
              loadHaStatus();
            }}
            className="w-full sm:w-auto px-3.5 sm:px-4 py-2 bg-slate-900 hover:bg-black active:scale-98 text-white rounded-xl font-bold shadow-sm flex items-center justify-center gap-2 text-xs transition-all"
          >
            <Home className="w-4 h-4 text-amber-400" />
            <span>HA & 小爱音箱联动</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Left Calendar + Right Selected Day Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
        {/* Left: Monthly Calendar (7 Cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-slate-200 p-3 sm:p-6">
          {/* Month Controller */}
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="text-base sm:text-lg font-black text-slate-800">
                {currentYear} 年 {String(currentMonthNum).padStart(2, '0')} 月
              </span>
              <button
                type="button"
                onClick={handleGoToday}
                className="px-2 sm:px-2.5 py-0.5 sm:py-1 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
              >
                今日
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-1 sm:p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                title="上个月"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1 sm:p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                title="下个月"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Weekday Header */}
          <div className="grid grid-cols-7 gap-1 text-center font-bold text-[11px] sm:text-xs text-slate-400 mb-1.5 sm:mb-2">
            <div>一</div>
            <div>二</div>
            <div>三</div>
            <div>四</div>
            <div>五</div>
            <div className="text-amber-500">六</div>
            <div className="text-amber-500">日</div>
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {/* Empty slots before first day */}
            {Array.from({ length: startDayOffset }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[52px] sm:min-h-[82px] rounded-xl sm:rounded-2xl bg-slate-50/40" />
            ))}

            {/* Days in Month */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${currentYearMonth}-${String(day).padStart(2, '0')}`;
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const summary = summaryMap.get(dateStr);
              const wordCount = summary?.word_count || 0;
              const testedCount = summary?.tested_count || 0;
              const isAllTested = wordCount > 0 && testedCount >= wordCount;

              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => setSelectedDate(dateStr)}
                  className={`min-h-[52px] sm:min-h-[82px] p-1 sm:p-2 rounded-xl sm:rounded-2xl border transition-all text-left flex flex-col justify-between relative group ${
                    isSelected
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-100 scale-[1.02] z-10'
                      : isToday
                      ? 'bg-indigo-50/70 border-indigo-200 hover:border-indigo-400 text-slate-900'
                      : 'bg-white border-slate-100 hover:border-slate-300 text-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className={`text-xs sm:text-sm font-black ${
                      isSelected ? 'text-white' : isToday ? 'text-indigo-600' : 'text-slate-800'
                    }`}>
                      {day}
                    </span>
                    <div className="flex items-center gap-0.5 sm:gap-1">
                      {activeDateInfo.activeDate === dateStr && (
                        <span 
                          className={`text-[8px] sm:text-[9px] px-0.5 sm:px-1 py-0.2 rounded font-bold flex items-center gap-0.5 ${
                            isSelected ? 'bg-amber-400 text-amber-950' : 'bg-amber-500 text-white'
                          }`}
                          title="已钉为今日任务（当天过后自动失效）"
                        >
                          <Pin className="w-2 h-2 sm:w-2.5 sm:h-2.5" />
                          <span className="hidden xs:inline">钉</span>
                        </span>
                      )}
                      {isToday && (
                        <span className={`text-[8px] sm:text-[10px] px-0.5 sm:px-1 rounded-sm font-bold ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-indigo-600 text-white'
                        }`}>
                          今
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Task title badge if exists */}
                  {summary?.title && (
                    <div 
                      className={`text-[8px] sm:text-[10px] font-semibold px-1 py-0.5 rounded truncate max-w-full leading-tight mt-0.5 sm:mt-1 ${
                        isSelected 
                          ? 'bg-white/20 text-white' 
                          : 'bg-amber-100 text-amber-900 border border-amber-200'
                      }`}
                      title={summary.title}
                    >
                      {summary.title}
                    </div>
                  )}

                  {/* Word count tag */}
                  {wordCount > 0 ? (
                    <div className="mt-0.5 sm:mt-1">
                      <span className={`inline-flex items-center gap-0.5 text-[9px] sm:text-xs font-bold px-1 sm:px-1.5 py-0.2 sm:py-0.5 rounded-md sm:rounded-lg ${
                        isSelected 
                          ? 'bg-white/20 text-white'
                          : isAllTested
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : testedCount > 0
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      }`}>
                        {Boolean(summary?.is_shuffle) && (
                          <Shuffle className="w-2.5 h-2.5 opacity-75 shrink-0" title="此任务设定为随机出词" />
                        )}
                        {isAllTested && '✓'}{wordCount}<span className="hidden sm:inline"> 词</span>
                      </span>
                    </div>
                  ) : (
                    !summary?.title && <div className="h-3 sm:h-4" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Day's Word Details & Actions (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-slate-200 p-4 sm:p-6">
            {/* Header with date info & Active Date Switcher */}
            <div className="space-y-3 pb-4 border-b border-slate-100">
              <div className="flex items-start justify-between gap-2 sm:gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                    <h3 className="text-base sm:text-lg font-black text-slate-900">
                      {selectedDate}
                    </h3>
                    {isSelectedToday && (
                      <span className="text-[10px] sm:text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 font-bold rounded-full border border-indigo-200">
                        今日
                      </span>
                    )}
                    {activeDateInfo.activeDate === selectedDate && (
                      <span className="text-[10px] sm:text-xs px-2 py-0.5 bg-amber-50 text-amber-700 font-bold rounded-full border border-amber-300 flex items-center gap-1">
                        <Pin className="w-3 h-3 text-amber-600" />
                        <span>已钉为今日任务 (当天过后自动失效)</span>
                      </span>
                    )}
                  </div>

                  {/* Task Name / Title with inline edit */}
                  <div className="mt-1.5">
                    {isAuthenticated && isEditingTitle ? (
                      <div className="flex items-center gap-1.5 max-w-sm">
                        <input
                          type="text"
                          value={titleInput}
                          onChange={(e) => setTitleInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveTitle();
                            if (e.key === 'Escape') handleCancelEditTitle();
                          }}
                          placeholder="输入任务名称，如：八下Unit 1"
                          maxLength={50}
                          autoFocus
                          disabled={isSavingTitle}
                          className="px-2.5 py-1 text-xs bg-white border border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 rounded-lg outline-none font-medium w-48 sm:w-56 shadow-inner"
                        />
                        <button
                          type="button"
                          onClick={handleSaveTitle}
                          disabled={isSavingTitle}
                          className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1 disabled:opacity-50"
                          title="保存名称"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>保存</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEditTitle}
                          disabled={isSavingTitle}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                          title="取消"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>取消</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {dailyTitle ? (
                          <div 
                            onClick={() => {
                              if (!isAuthenticated) return;
                              setIsEditingTitle(true);
                            }}
                            className={`inline-flex items-center gap-1 text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-lg transition-colors group ${isAuthenticated ? 'cursor-pointer hover:bg-amber-100' : ''}`}
                            title={isAuthenticated ? "点击重命名任务" : undefined}
                          >
                            <span>任务: {dailyTitle}</span>
                            {isAuthenticated && <Pencil className="w-3 h-3 text-amber-600 opacity-60 group-hover:opacity-100 ml-0.5" />}
                          </div>
                        ) : isAuthenticated ? (
                          <button
                            type="button"
                            onClick={() => setIsEditingTitle(true)}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 px-2 py-0.5 rounded-lg border border-dashed border-slate-300 hover:border-indigo-300 transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>命名任务 (如: Unit 1)</span>
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-slate-500 mt-1">
                    该日已设定 <span className="font-bold text-indigo-600">{dailyWords.length}</span> 个听写单词
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleOpenAddWords}
                  className="px-2.5 sm:px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl font-bold text-xs flex items-center gap-1 transition-all active:scale-95 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>添加单词</span>
                </button>
              </div>

              {/* Set today's word date action bar */}
              {isAuthenticated && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs">
                  <div className="flex items-center gap-1.5 text-slate-600 min-w-0">
                    <Pin className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="truncate text-[11px] sm:text-xs">
                      {activeDateInfo.activeDate
                        ? <>今日任务已钉住: <strong className="text-amber-700">{activeDateInfo.activeDate}</strong> <span className="text-slate-400 font-normal">(当天有效，次日自动失效恢复)</span></>
                        : <>今日任务指向: <span className="text-slate-500 font-medium">默认系统当日 ({activeDateInfo.today})</span></>}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {activeDateInfo.activeDate === selectedDate ? (
                      <button
                        type="button"
                        disabled={settingActiveDate}
                        onClick={() => handleSetActiveDate(null)}
                        className="w-full sm:w-auto px-2.5 py-1 bg-white hover:bg-rose-50 hover:text-rose-600 text-slate-600 border border-slate-200 rounded-xl font-bold text-[11px] transition-all text-center cursor-pointer"
                        title="取消钉住，恢复自动跟随当前系统日期"
                      >
                        取消钉住 / 恢复自动
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={settingActiveDate}
                        onClick={() => handleSetActiveDate(selectedDate)}
                        className="w-full sm:w-auto px-2.5 py-1 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-xl font-bold text-[11px] shadow-xs transition-all flex items-center justify-center gap-1 text-center cursor-pointer"
                        title={`将 ${selectedDate} 的单词钉为今日任务，当天过后自动失效并恢复跟随系统日期`}
                      >
                        <Pin className="w-3 h-3" />
                        <span>钉为今日任务 (当天有效)</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Play Mode & Launch study buttons */}
            <div className="py-3 sm:py-4 space-y-2.5">
              {/* Mixed Random vs In-Order Selector */}
              <div className="flex items-center justify-between p-2 sm:p-2.5 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs">
                <div className="flex items-center gap-1.5 font-bold text-slate-700 min-w-0">
                  <Shuffle className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span className="truncate">该任务播放模式</span>
                </div>
                <div className="flex items-center bg-white border border-slate-200 rounded-xl p-0.5 shadow-xs text-xs shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleShuffle(false)}
                    className={`px-2.5 sm:px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1 text-[11px] sm:text-xs ${
                      !isShuffle
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <span>📋 顺序出词</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleShuffle(true)}
                    className={`px-2.5 sm:px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1 text-[11px] sm:text-xs ${
                      isShuffle
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <Shuffle className="w-3 h-3" />
                    <span>🔀 随机出词</span>
                  </button>
                </div>
              </div>

              {/* Study Action Buttons */}
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <button
                  type="button"
                  disabled={dailyWords.length === 0}
                  onClick={handleStartDailyDictation}
                  className="py-2.5 sm:py-3 px-2 sm:px-3 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white rounded-2xl font-bold text-xs shadow-md shadow-indigo-100 flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:pointer-events-none"
                >
                  {isShuffle ? (
                    <Shuffle className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  ) : (
                    <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-white shrink-0" />
                  )}
                  <span className="truncate">
                    {isShuffle ? '随机听写' : '顺序听写'} ({dailyWords.length})
                  </span>
                </button>
                <button
                  type="button"
                  disabled={dailyWords.length === 0}
                  onClick={handleStartDailyMemory}
                  className="py-2.5 sm:py-3 px-2 sm:px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-2xl font-bold text-xs shadow-md shadow-emerald-100 flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:pointer-events-none"
                >
                  {isShuffle ? (
                    <Shuffle className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  ) : (
                    <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  )}
                  <span className="truncate">
                    {isShuffle ? '随机记忆' : '卡片记忆'} ({dailyWords.length})
                  </span>
                </button>
              </div>
            </div>

            {/* Daily Words List */}
            <div>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-700">单词清单 ({dailyWords.length})</span>
                  {dailyWords.length > 0 && (
                    <button
                      type="button"
                      onClick={handleToggleSelectAllDaily}
                      className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold transition-colors cursor-pointer"
                    >
                      {isAllDailySelected ? '取消全选' : '全选'}
                    </button>
                  )}
                  {isAuthenticated && dailyWords.length > 1 && (
                    <div className="flex items-center gap-1 border-l border-slate-200 pl-2 ml-1">
                      <button
                        type="button"
                        onClick={handleReversePlan}
                        className="text-[11px] text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 px-1.5 py-0.5 rounded-md border border-slate-200 transition-colors flex items-center gap-0.5 cursor-pointer"
                        title="将当前日期的单词列表顺序颠倒反转"
                      >
                        <ArrowUpDown className="w-3 h-3" />
                        <span>反转顺序</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleSortPlanDefault}
                        className="text-[11px] text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 px-1.5 py-0.5 rounded-md border border-slate-200 transition-colors flex items-center gap-0.5 cursor-pointer"
                        title="按原词库/词单默认顺序重新排列"
                      >
                        <span>恢复正序</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {isAuthenticated && (selectedWordIds.size > 0 ? (
                    <button
                      type="button"
                      onClick={handleRemoveSelected}
                      className="text-xs text-rose-600 hover:text-rose-700 font-bold flex items-center gap-1 bg-rose-50 hover:bg-rose-100 px-2.5 py-1 rounded-xl transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>移出计划 ({selectedWordIds.size})</span>
                    </button>
                  ) : dailyWords.length > 0 ? (
                    <button
                      type="button"
                      onClick={handleClearDailyPlan}
                      className="text-[11px] text-slate-400 hover:text-rose-600 font-medium flex items-center gap-1 hover:bg-rose-50 px-2 py-1 rounded-lg transition-colors cursor-pointer"
                      title="清空该日全部听写单词计划"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>清空清单</span>
                    </button>
                  ) : null)}
                </div>
              </div>

              {loadingWords ? (
                <div className="py-12 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-500" />
                  <span>正在加载计划单词...</span>
                </div>
              ) : dailyWords.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-xs space-y-3">
                  <p>该日期尚未安排单词</p>
                  <button
                    type="button"
                    onClick={handleOpenAddWords}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold inline-flex items-center gap-1.5 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5 text-indigo-600" />
                    <span>立即为 {selectedDate} 规划单词</span>
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto pr-1">
                  {dailyWords.map((item, idx) => {
                    const isSelected = selectedWordIds.has(item.id);
                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          const next = new Set(selectedWordIds);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          setSelectedWordIds(next);
                        }}
                        className={`py-2.5 px-2 rounded-xl transition-all cursor-pointer flex items-center justify-between gap-2 text-xs select-none ${
                          isSelected ? 'bg-indigo-50/70 border border-indigo-200' : 'hover:bg-slate-50 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = new Set(selectedWordIds);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              setSelectedWordIds(next);
                            }}
                            className="text-slate-400 hover:text-indigo-600 shrink-0"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-indigo-600" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                          <span className="text-[10px] text-slate-400 font-mono w-4 shrink-0 text-right">{idx + 1}.</span>
                          <span className="font-bold text-slate-900 text-xs sm:text-sm truncate">{item.word}</span>
                          {item.phonetic && (
                            <span className="text-slate-400 font-mono text-[10px] sm:text-[11px] truncate hidden xs:inline">{item.phonetic}</span>
                          )}
                          {(item.mistake_count || 0) > 0 ? (
                            <button
                              type="button"
                              onClick={(e) => handleQuickToggleMistake(item, e)}
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-md shrink-0 transition-colors shadow-2xs group/btn cursor-pointer"
                              title="点击快捷去易错（错误次数清零）"
                            >
                              <Flame className="w-3 h-3 text-rose-500 fill-rose-400" />
                              <span>错 {item.mistake_count}次</span>
                              <span className="underline ml-0.5 text-rose-700 font-medium">去易错</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => handleQuickToggleMistake(item, e)}
                              className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 px-1.5 py-0.5 rounded-md shrink-0 transition-colors cursor-pointer"
                              title="点击快捷标为易错词"
                            >
                              <Flame className="w-3 h-3" />
                              <span>标易错</span>
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-slate-500 text-[11px] truncate max-w-[80px] sm:max-w-[150px]">
                            {item.translation}
                          </span>
                          {isAuthenticated && (
                            <>
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={(e) => handleReorderWord(item.id, 'up', e)}
                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-md transition-colors disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer"
                                title="上移一位"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === dailyWords.length - 1}
                                onClick={(e) => handleReorderWord(item.id, 'down', e)}
                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-md transition-colors disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer"
                                title="下移一位"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              playWordAudio(item.word);
                            }}
                            className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                            title="播放发音"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                          {isAuthenticated && (
                            <button
                              type="button"
                              onClick={(e) => handleRemoveSingleWord(item, e)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                              title="从该日计划中删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add Words to Date Modal */}
      {showAddWordsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-2 sm:p-4 animate-fade-in">
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[88vh]">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
                <Plus className="w-4 h-4 text-indigo-600" />
                <span>编辑 / 添加单词至 {selectedDate} 计划</span>
              </div>
              <button
                type="button"
                onClick={() => setShowAddWordsModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter and selector */}
            <div className="p-3 sm:p-4 border-b border-slate-100 space-y-2.5 sm:space-y-3 bg-white">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  value={selectedSourceListId}
                  onChange={(e) => {
                    setSelectedSourceListId(e.target.value);
                    loadPickerWords(e.target.value);
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold"
                >
                  <option value="">-- 全部总词库 --</option>
                  <option value="mistakes">🔥 错词库 / 易错词集</option>
                  {lists.map(l => (
                    <option key={l.id} value={l.id}>{l.indentName || l.name} ({l.word_count}词)</option>
                  ))}
                </select>

                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={searchPickerQuery}
                    onChange={(e) => setSearchPickerQuery(e.target.value)}
                    placeholder="搜索单词拼写或中文..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setPickerFilterMistakesOnly(prev => !prev)}
                    className={`shrink-0 px-2.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer border ${
                      pickerFilterMistakesOnly
                        ? 'bg-rose-500 text-white border-rose-600 shadow-xs'
                        : 'bg-slate-50 text-slate-600 hover:text-rose-600 hover:bg-rose-50 border-slate-300'
                    }`}
                    title={pickerFilterMistakesOnly ? '显示全部单词' : '仅看错词/易错词'}
                  >
                    <Flame className={`w-3.5 h-3.5 ${pickerFilterMistakesOnly ? 'fill-white text-white' : 'text-rose-500'}`} />
                    <span>仅错词</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span>已选中 <strong className="text-indigo-600">{pickerSelectedIds.size}</strong> 词</span>
                  {addedDiffCount > 0 && (
                    <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded-md font-bold text-[10px] border border-emerald-200">
                      +新增 {addedDiffCount}
                    </span>
                  )}
                  {removedDiffCount > 0 && (
                    <span className="text-rose-700 bg-rose-50 px-1.5 py-0.2 rounded-md font-bold text-[10px] border border-rose-200">
                      -移除 {removedDiffCount}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {mistakeWordsInFiltered.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleSelectMistakesFiltered}
                      className="text-xs text-rose-600 hover:text-rose-700 font-bold hover:underline flex items-center gap-0.5"
                      title={isAllMistakesInFilteredSelected ? '取消勾选当前错词' : '选中当前列表所有错词'}
                    >
                      <Flame className="w-3 h-3 fill-rose-500 text-rose-500" />
                      <span>{isAllMistakesInFilteredSelected ? '取消错词' : `全选错词(${mistakeWordsInFiltered.length})`}</span>
                    </button>
                  )}
                  {pickerTotalPages > 1 && (
                    <button
                      type="button"
                      onClick={toggleSelectCurrentPage}
                      className="text-xs text-indigo-600 font-bold hover:underline"
                    >
                      {isAllCurrentPageSelected ? '取消本页' : '全选本页'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={toggleSelectAllFiltered}
                    className="text-xs text-slate-600 hover:text-indigo-600 font-medium hover:underline"
                  >
                    {isAllFilteredSelected ? '取消全部' : `全选当前(${filteredPickerWords.length})`}
                  </button>
                </div>
              </div>
            </div>

            {/* Words check list */}
            <div ref={pickerListRef} className="p-3 sm:p-4 overflow-y-auto flex-1 divide-y divide-slate-100 max-h-[350px]">
              {displayedPickerWords.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-xs">未找到单词</div>
              ) : (
                displayedPickerWords.map((w, localIdx) => {
                  const isChecked = pickerSelectedIds.has(w.id);
                  const isAlreadyInPlan = dailyWordIds.has(w.id);
                  const wordNum = pickerStartIndex + localIdx + 1;
                  return (
                    <label
                      key={w.id}
                      className={`py-2 px-2 flex items-center justify-between gap-2 rounded-xl cursor-pointer select-none text-xs transition-colors ${
                        isChecked ? 'bg-indigo-50/70 border border-indigo-200' : 'hover:bg-slate-50 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            const next = new Set(pickerSelectedIds);
                            if (next.has(w.id)) next.delete(w.id);
                            else next.add(w.id);
                            setPickerSelectedIds(next);
                          }}
                          className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer shrink-0"
                        />
                        <span className="text-[10px] text-slate-400 font-mono w-4 shrink-0 text-right">{wordNum}.</span>
                        <span className="font-bold text-slate-900 truncate">{w.word}</span>
                        {w.phonetic && <span className="text-slate-400 font-mono text-[11px] truncate hidden xs:inline">{w.phonetic}</span>}
                        {(w.mistake_count || 0) > 0 ? (
                          <button
                            type="button"
                            onClick={(e) => handleQuickToggleMistake(w, e)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-md shrink-0 transition-colors shadow-2xs cursor-pointer"
                            title="点击快捷去易错（错误次数清零）"
                          >
                            <Flame className="w-3 h-3 text-rose-500 fill-rose-400" />
                            <span>错 {w.mistake_count}次</span>
                            <span className="underline ml-0.5 text-rose-700">去易错</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => handleQuickToggleMistake(w, e)}
                            className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 px-1.5 py-0.5 rounded-md shrink-0 transition-colors cursor-pointer"
                            title="点击快捷标为易错词"
                          >
                            <Flame className="w-3 h-3" />
                            <span>标易错</span>
                          </button>
                        )}
                        {isAlreadyInPlan && (
                          <span className="text-[10px] px-1.5 py-0.2 bg-emerald-50 text-emerald-700 font-bold rounded-md border border-emerald-200 shrink-0">
                            已在清单内
                          </span>
                        )}
                      </div>
                      <span className="text-slate-600 text-[11px] truncate max-w-[120px] sm:max-w-[200px]">{w.translation}</span>
                    </label>
                  );
                })
              )}
            </div>

            {/* Pagination Controls Bar */}
            {filteredPickerWords.length > 0 && (
              <div className="px-3 sm:px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
                {/* Page size buttons & Count */}
                <div className="flex items-center gap-2 text-slate-500 w-full sm:w-auto justify-between sm:justify-start">
                  <span>
                    共 <strong className="text-slate-800">{filteredPickerWords.length}</strong> 词
                    {pickerTotalPages > 1 && (
                      <span className="ml-1 text-slate-400 text-[11px]">
                        (第 {validPickerCurrentPage}/{pickerTotalPages} 页)
                      </span>
                    )}
                  </span>
                  <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white text-[11px]">
                    {[20, 50, 0].map(sz => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => handlePickerPageSizeChange(sz)}
                        className={`px-2 py-0.5 font-medium transition-colors ${
                          pickerPageSize === sz
                            ? 'bg-indigo-600 text-white font-bold'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {sz === 0 ? '全部' : `${sz}条/页`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Page flipping buttons */}
                {pickerTotalPages > 1 && (
                  <div className="flex items-center gap-1 w-full sm:w-auto justify-center sm:justify-end">
                    <button
                      type="button"
                      disabled={validPickerCurrentPage <= 1}
                      onClick={() => {
                        setPickerCurrentPage(p => Math.max(1, p - 1));
                        pickerListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="p-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      title="上一页"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>

                    <div className="flex items-center gap-1">
                      {getPageNumbers(validPickerCurrentPage, pickerTotalPages).map((p, pIdx) => {
                        if (p === '...') {
                          return <span key={`ellipsis-${pIdx}`} className="px-1 text-slate-400">...</span>;
                        }
                        const isCurr = p === validPickerCurrentPage;
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => {
                              setPickerCurrentPage(p);
                              pickerListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className={`min-w-[24px] h-6 px-1 rounded-md font-bold text-xs transition-colors ${
                              isCurr
                                ? 'bg-indigo-600 text-white shadow-xs'
                                : 'text-slate-700 hover:bg-slate-100 border border-slate-200'
                            }`}
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      disabled={validPickerCurrentPage >= pickerTotalPages}
                      onClick={() => {
                        setPickerCurrentPage(p => Math.min(pickerTotalPages, p + 1));
                        pickerListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="p-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      title="下一页"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="p-3 sm:p-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setShowAddWordsModal(false)}
                className="px-3.5 sm:px-4 py-2 text-xs text-slate-600 hover:bg-slate-200/60 rounded-xl"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isAddingWords}
                onClick={handleAddWordsSubmit}
                className="px-4 sm:px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white rounded-xl font-bold text-xs shadow-md shadow-indigo-100 disabled:opacity-40 transition-all"
              >
                {isAddingWords ? '正在保存...' : `保存计划 (${pickerSelectedIds.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Home Assistant & XiaoAi Speaker Configuration Modal */}
      {showHaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-2 sm:p-4 animate-fade-in">
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 bg-slate-900 text-white">
              <div className="flex items-center gap-2 font-bold text-xs sm:text-sm">
                <Home className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 shrink-0" />
                <span className="truncate">Home Assistant & 小爱音箱语音联动</span>
              </div>
              <button
                type="button"
                onClick={() => setShowHaModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 sm:p-6 overflow-y-auto space-y-4 sm:space-y-6 text-xs text-slate-700">
              {/* Status & Live Test */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 sm:p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-600" />
                    <span>在线实时测试 (当前选定: {selectedDate})</span>
                  </h4>
                  <button
                    type="button"
                    onClick={loadHaStatus}
                    className="text-indigo-600 hover:underline flex items-center gap-1 font-semibold"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${haLoading ? 'animate-spin' : ''}`} />
                    <span>刷新状态</span>
                  </button>
                </div>

                {haStatus && (
                  <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-mono text-slate-500 text-[11px] flex items-center gap-2 flex-wrap">
                        <span>进度: 第 <strong className="text-indigo-600 text-sm">{haStatus.humanIndex}</strong> / {haStatus.total} 词</span>
                        {haStatus.is_shuffle && (
                          <span className="px-1.5 py-0.2 bg-purple-50 text-purple-700 border border-purple-200 rounded text-[10px] font-bold flex items-center gap-1">
                            <Shuffle className="w-2.5 h-2.5" />
                            <span>混合随机模式</span>
                          </span>
                        )}
                        {haStatus.duration_explain > 0 && (
                          <span className="px-1.5 py-0.2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[10px] font-bold">
                            音频时长: {haStatus.duration_explain} 秒 (推荐延时: {haStatus.delay_explain_seconds}s)
                          </span>
                        )}
                      </div>
                      <div className="text-base font-black text-slate-900 mt-0.5">
                        {haStatus.word?.word || '(无单词)'}
                        {haStatus.word?.phonetic && <span className="ml-2 font-mono text-xs text-indigo-600 font-normal">{haStatus.word?.phonetic}</span>}
                      </div>
                      <div className="text-slate-600 text-xs mt-0.5">{haStatus.word?.translation}</div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      <button
                        type="button"
                        onClick={() => triggerHaAction('prev')}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold"
                        title="模拟 HA 调用 /prev"
                      >
                        上一个
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerHaAction('repeat')}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold"
                        title="模拟 HA 调用 /repeat"
                      >
                        重听
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerHaAction('next')}
                        className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold"
                        title="模拟 HA 调用 /next"
                      >
                        下一个
                      </button>
                    </div>
                  </div>
                )}

                {/* Quick Audio preview in browser */}
                {haStatus && (
                  <div className="flex items-center gap-2 pt-1 border-t border-slate-200/60 flex-wrap">
                    <span className="text-slate-500 font-medium">试听音效:</span>
                    <button
                      type="button"
                      onClick={() => {
                        const a = new Audio(`/api/ha/audio?t=${Date.now()}`);
                        a.play();
                      }}
                      className="px-2.5 py-1 bg-white hover:bg-indigo-50 border border-slate-200 text-indigo-600 rounded-lg font-bold text-[11px] flex items-center gap-1 transition-all"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>试听纯单词 ({haStatus.duration || 1}s)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const a = new Audio(`/api/ha/audio/explain?t=${Date.now()}`);
                        a.play();
                      }}
                      className="px-2.5 py-1 bg-white hover:bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-lg font-bold text-[11px] flex items-center gap-1 transition-all"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>试听【单词 + 解释】({haStatus.duration_explain || 2.5}s)</span>
                    </button>
                  </div>
                )}
              </div>

              {/* XiaoAi Audio Playback Explanation */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-900 text-sm">💡 为什么官方 Xiaomi Home 插件没有 media_player 实体？</h4>
                <p className="text-slate-600 leading-relaxed">
                  小米官方的 <strong>Xiaomi Home</strong> 插件只支持开关和传感器等 IoT 设备，<strong>不支持音频流媒体播放器架构</strong>。要让小爱音箱拥有 <code>media_player</code> 实体以播放局域网真人音频，推荐以下两种极简方式：
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
                  <div className="p-2.5 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-1">
                    <strong className="text-indigo-800">方案 A（最推荐）：Xiaomi Miot Auto</strong>
                    <p className="text-slate-600">
                      在 HACS 搜索安装 <code>Xiaomi Miot Auto</code>，账号登录后小爱音箱会自动生成 <code>media_player.xxx_speaker</code> 实体，原生支持音频播放与 TTS。
                    </p>
                  </div>
                  <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1">
                    <strong className="text-emerald-800">方案 B（免插件）：DLNA 集成</strong>
                    <p className="text-slate-600">
                      小爱音箱支持局域网 DLNA 投播。在 HA 的“设备与服务”添加官方自带的 <code>DLNA Digital Media Renderer</code>，即可免插件自动发现为 <code>media_player</code>。
                    </p>
                  </div>
                </div>
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] mt-2">
                  ⚠️ <strong>注意内网 IP</strong>：小爱音箱无法识别 <code>localhost</code>，请将下方配置中的 <code>&lt;SERVER_IP&gt;</code> 替换为您运行本服务的电脑局域网 IP（例如 <code>192.168.1.100</code>）。
                </div>
              </div>

              {/* HA Automation Recipes */}
              <div className="space-y-3">
                {/* Method 1: notification type */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900">方案一：指定 notification 通知音类型（最优雅：天然只播一次，免写 delay）</h4>
                      <p className="text-slate-500 text-[11px]">设置 media_content_type 为 notification，小爱会作为单次播报处理，播完自动停止绝不循环。</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyCode('yaml_notif', `action: media_player.play_media
target:
  device_id: d32bcddce437f435549751ce95f6cd26 # 替换为您的小爱音箱
data:
  # 播放【单词+解释】并自动切词
  media_content_id: "http://<SERVER_IP>:${serverPort}/api/ha/audio/explain.mp3?action=next"
  media_content_type: "notification"`)}
                      className="text-emerald-600 hover:text-emerald-800 font-bold flex items-center gap-1 shrink-0"
                    >
                      {copiedKey === 'yaml_notif' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey === 'yaml_notif' ? '已复制' : '复制代码'}</span>
                    </button>
                  </div>
                  <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl overflow-x-auto text-[11px] font-mono leading-relaxed">
{`action: media_player.play_media
target:
  device_id: d32bcddce437f435549751ce95f6cd26
data:
  media_content_id: "http://<SERVER_IP>:${serverPort}/api/ha/audio/explain.mp3?action=next"
  media_content_type: "notification" # 关键：声明为通知流，播完即止绝不循环`}
                  </pre>
                </div>

                {/* Method 2: Dynamic Delay from API */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900">方案二：通过 API 获取精准音频时长，动态精确延时停止（100% 精准）</h4>
                      <p className="text-slate-500 text-[11px]">
                        利用 <code>response_variable</code> 读取接口返回的实际秒数 <code>content.duration_explain</code>（已预留网络缓冲）。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyCode('yaml_dynamic_delay', `sequence:
  # 步骤 1：调用 rest_command 切词并获取词条信息与时长
  - action: rest_command.tingxie_next
    response_variable: tingxie_data

  # 步骤 2：小爱音箱播放音频
  - action: media_player.play_media
    target:
      device_id: d32bcddce437f435549751ce95f6cd26
    data:
      media_content_id: "http://<SERVER_IP>:${serverPort}/api/ha/audio/explain.mp3"
      media_content_type: music

  # 步骤 3：读取接口返回的秒数（注意 HA 的 rest_command 响应存储在 .content 键下）
  - delay:
      seconds: "{{ tingxie_data['content']['duration_explain'] | default(4) }}"

  # 步骤 4：播完后精准主动停止
  - action: media_player.media_stop
    target:
      device_id: d32bcddce437f435549751ce95f6cd26`)}
                      className="text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 shrink-0"
                    >
                      {copiedKey === 'yaml_dynamic_delay' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey === 'yaml_dynamic_delay' ? '已复制' : '复制动态延时自动化'}</span>
                    </button>
                  </div>
                  <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl overflow-x-auto text-[11px] font-mono leading-relaxed">
{`sequence:
  # 步骤 1：调用 API 获取当前词信息及动态延时秒数
  - action: rest_command.tingxie_next
    response_variable: tingxie_data

  # 步骤 2：小爱音箱播放音频
  - action: media_player.play_media
    target:
      device_id: d32bcddce437f435549751ce95f6cd26
    data:
      media_content_id: "http://<SERVER_IP>:${serverPort}/api/ha/audio/explain.mp3"
      media_content_type: music

  # 步骤 3：读取 API 提供的秒数动态延时（注意 HA rest_command 响应需取 content 下字段）
  - delay:
      seconds: "{{ tingxie_data['content']['duration_explain'] | default(4) }}"

  # 步骤 4：播完主动停止
  - action: media_player.media_stop
    target:
      device_id: d32bcddce437f435549751ce95f6cd26`}
                  </pre>
                </div>

                {/* Method 2 Prerequisite: rest_command in configuration.yaml */}
                <div className="space-y-1.5 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 text-[11px]">⚙️ 方案二的前置条件：在 HA 的 configuration.yaml 中配置 rest_command</span>
                    <button
                      type="button"
                      onClick={() => handleCopyCode('yaml_rest_cmd', `rest_command:
  tingxie_next:
    url: "http://<SERVER_IP>:${serverPort}/api/ha/next"
    method: GET
  tingxie_prev:
    url: "http://<SERVER_IP>:${serverPort}/api/ha/prev"
    method: GET
  tingxie_repeat:
    url: "http://<SERVER_IP>:${serverPort}/api/ha/repeat"
    method: GET`)}
                      className="text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 text-[11px]"
                    >
                      {copiedKey === 'yaml_rest_cmd' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'yaml_rest_cmd' ? '已复制' : '复制代码'}</span>
                    </button>
                  </div>
                  <pre className="p-2 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-[10px] font-mono leading-relaxed">
{`rest_command:
  tingxie_next:
    url: "http://<SERVER_IP>:${serverPort}/api/ha/next"
    method: GET`}
                  </pre>
                </div>
              </div>

              {/* Complete API Reference Section */}
              <div className="space-y-3 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-indigo-600" />
                      <span>系统全量开放 API 接口清单 (供 HA / 脚本 / 传感器调用)</span>
                    </h4>
                    <p className="text-slate-500 text-[11px] mt-0.5">
                      支持 GET 与 POST 请求，均能自动按“今日指定任务日期”执行。
                    </p>
                  </div>
                  <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                    Base URL: http://&lt;SERVER_IP&gt;:{serverPort}
                  </span>
                </div>

                <div className="space-y-2">
                  {/* 1. Audio stream APIs */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                    <div className="font-bold text-slate-800 text-xs flex items-center justify-between">
                      <span className="text-indigo-700">1. 音频流播放接口（供小爱/媒体播放器直接填入 media_content_id）</span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="bg-white p-2 rounded-lg border border-slate-200 flex items-center justify-between gap-2">
                        <div className="font-mono text-[11px] min-w-0">
                          <span className="font-bold text-emerald-600 mr-2">GET</span>
                          <span className="text-slate-900 font-bold">/api/ha/audio/explain.mp3</span>
                          <span className="text-slate-400 ml-2 text-[10px]">【推荐】播放“英文单词 + 停顿0.5s + 中文释义”</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyCode('api_explain', `http://<SERVER_IP>:${serverPort}/api/ha/audio/explain.mp3`)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold shrink-0"
                        >
                          {copiedKey === 'api_explain' ? '已复制' : '复制URL'}
                        </button>
                      </div>

                      <div className="bg-white p-2 rounded-lg border border-slate-200 flex items-center justify-between gap-2">
                        <div className="font-mono text-[11px] min-w-0">
                          <span className="font-bold text-emerald-600 mr-2">GET</span>
                          <span className="text-slate-900 font-bold">/api/ha/audio.mp3</span>
                          <span className="text-slate-400 ml-2 text-[10px]">纯英文标准发音（默写听写测验）</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyCode('api_audio', `http://<SERVER_IP>:${serverPort}/api/ha/audio.mp3`)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold shrink-0"
                        >
                          {copiedKey === 'api_audio' ? '已复制' : '复制URL'}
                        </button>
                      </div>

                      <div className="text-[10px] text-slate-500 bg-amber-50/70 border border-amber-200/70 p-2 rounded-lg leading-relaxed">
                        💡 <strong>音频 URL 支持的 Query 参数</strong>：
                        <br />• <code>?action=next</code>：在开始播放音频前自动将任务游标切到<strong>下一个词</strong>
                        <br />• <code>?action=prev</code>：在开始播放音频前切到<strong>上一个词</strong>
                        <br />• <code>?action=repeat</code>：播放<strong>当前词</strong>（不切词）
                        <br />• <code>?type=1</code>：英音，<code>?type=2</code>：美音（默认美音）
                      </div>
                    </div>
                  </div>

                  {/* 2. Control APIs */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                    <div className="font-bold text-slate-800 text-xs">
                      <span className="text-indigo-700">2. 状态查询与游标控制接口（支持 GET / POST）</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      <div className="bg-white p-2 rounded-lg border border-slate-200 flex items-center justify-between gap-1">
                        <div className="font-mono text-[11px] truncate">
                          <span className="text-blue-600 font-bold mr-1">GET/POST</span>
                          <span className="text-slate-900 font-bold">/api/ha/status</span>
                          <div className="text-[10px] text-slate-400">查询当前单词、释义、进度等 JSON</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyCode('api_status', `http://<SERVER_IP>:${serverPort}/api/ha/status`)}
                          className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold shrink-0"
                        >
                          {copiedKey === 'api_status' ? '已复制' : '复制'}
                        </button>
                      </div>

                      <div className="bg-white p-2 rounded-lg border border-slate-200 flex items-center justify-between gap-1">
                        <div className="font-mono text-[11px] truncate">
                          <span className="text-blue-600 font-bold mr-1">GET/POST</span>
                          <span className="text-slate-900 font-bold">/api/ha/next</span>
                          <div className="text-[10px] text-slate-400">切换到下一个单词并返回词条 JSON</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyCode('api_next', `http://<SERVER_IP>:${serverPort}/api/ha/next`)}
                          className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold shrink-0"
                        >
                          {copiedKey === 'api_next' ? '已复制' : '复制'}
                        </button>
                      </div>

                      <div className="bg-white p-2 rounded-lg border border-slate-200 flex items-center justify-between gap-1">
                        <div className="font-mono text-[11px] truncate">
                          <span className="text-blue-600 font-bold mr-1">GET/POST</span>
                          <span className="text-slate-900 font-bold">/api/ha/prev</span>
                          <div className="text-[10px] text-slate-400">后退到上一个单词并返回词条 JSON</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyCode('api_prev', `http://<SERVER_IP>:${serverPort}/api/ha/prev`)}
                          className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold shrink-0"
                        >
                          {copiedKey === 'api_prev' ? '已复制' : '复制'}
                        </button>
                      </div>

                      <div className="bg-white p-2 rounded-lg border border-slate-200 flex items-center justify-between gap-1">
                        <div className="font-mono text-[11px] truncate">
                          <span className="text-blue-600 font-bold mr-1">GET/POST</span>
                          <span className="text-slate-900 font-bold">/api/ha/repeat</span>
                          <div className="text-[10px] text-slate-400">重听/保持在当前词并返回词条 JSON</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyCode('api_repeat', `http://<SERVER_IP>:${serverPort}/api/ha/repeat`)}
                          className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold shrink-0"
                        >
                          {copiedKey === 'api_repeat' ? '已复制' : '复制'}
                        </button>
                      </div>

                      <div className="bg-white p-2 rounded-lg border border-slate-200 flex items-center justify-between gap-1 sm:col-span-2">
                        <div className="font-mono text-[11px] truncate">
                          <span className="text-blue-600 font-bold mr-1">GET/POST</span>
                          <span className="text-slate-900 font-bold">/api/ha/reset</span>
                          <span className="text-slate-400 ml-2 text-[10px]">重置游标到第 1 个单词</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyCode('api_reset', `http://<SERVER_IP>:${serverPort}/api/ha/reset`)}
                          className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold shrink-0"
                        >
                          {copiedKey === 'api_reset' ? '已复制' : '复制'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 3. Active date setting API */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                    <div className="font-bold text-slate-800 text-xs">
                      <span className="text-indigo-700">3. 计划日期指定接口（日历与自动化联动）</span>
                    </div>

                    <div className="space-y-1.5 font-mono text-[11px]">
                      <div className="bg-white p-2 rounded-lg border border-slate-200 flex items-center justify-between gap-2">
                        <div>
                          <span className="text-emerald-600 font-bold mr-2">GET</span>
                          <span className="text-slate-900 font-bold">/api/calendar/active-date</span>
                          <div className="text-[10px] text-slate-400">查看当前锁定的执行日期及生效状态</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyCode('api_get_active', `http://<SERVER_IP>:${serverPort}/api/calendar/active-date`)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold shrink-0"
                        >
                          {copiedKey === 'api_get_active' ? '已复制' : '复制URL'}
                        </button>
                      </div>

                      <div className="bg-white p-2 rounded-lg border border-slate-200 flex items-center justify-between gap-2">
                        <div>
                          <span className="text-blue-600 font-bold mr-2">POST</span>
                          <span className="text-slate-900 font-bold">/api/calendar/active-date</span>
                          <div className="text-[10px] text-slate-400">设置指定日期（Body: <code>{`{"date":"YYYY-MM-DD"}`}</code>，传 <code>null</code> 恢复自动）</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyCode('api_post_active', `http://<SERVER_IP>:${serverPort}/api/calendar/active-date`)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold shrink-0"
                        >
                          {copiedKey === 'api_post_active' ? '已复制' : '复制URL'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex items-center justify-end bg-slate-50">
              <button
                type="button"
                onClick={() => setShowHaModal(false)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold text-xs"
              >
                关闭指南
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
