import React, { useState, useEffect, useRef } from 'react';
import { 
  Volume2, ArrowRight, RotateCcw, CheckCircle2, XCircle, 
  Sparkles, HelpCircle, ArrowLeft, VolumeX, Award, Check, Gauge,
  Eye, EyeOff, ChevronLeft, ChevronRight, Shuffle, ChevronDown, BookOpen
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { playWordAudio, playSentenceAudio, playFeedbackSound, getSpeechRate, setSpeechRate } from '../utils/audio';
import { api } from '../api/client';
import ListSwitchModal from './ListSwitchModal';

// Helper to shuffle array (Fisher-Yates)
function shuffleArray(array) {
  if (!array || array.length <= 1) return [...(array || [])];
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // If array length > 1 and exact same sequence happened, swap first two
  if (arr.length > 1 && arr.every((item, idx) => item.id === array[idx]?.id)) {
    [arr[0], arr[1]] = [arr[1], arr[0]];
  }
  return arr;
}

export default function DictationView({ 
  words = [], 
  listTitle, 
  currentListId, 
  onBack, 
  onFinish,
  onSwitchList
}) {
  const [originalWords, setOriginalWords] = useState(words);
  const [activeWords, setActiveWords] = useState(words);
  const [playMode, setPlayMode] = useState('order'); // 'order' | 'shuffle'
  const [currentTitle, setCurrentTitle] = useState(listTitle);
  const [showListSwitcher, setShowListSwitcher] = useState(false);
  const [shuffleTip, setShuffleTip] = useState('');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [inputVal, setInputVal] = useState('');
  const [isRevealed, setIsRevealed] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [accent, setAccent] = useState(() => localStorage.getItem('preferred_accent') || 'us');
  const [speed, setSpeed] = useState(() => getSpeechRate());

  // Track the state of each word by index: { userInput, isRevealed, isPeeked, isCorrect, isSkipped }
  const [wordStates, setWordStates] = useState({});

  const inputRef = useRef(null);

  // Sync words when prop changes (or after list switch)
  useEffect(() => {
    setOriginalWords(words);
    if (playMode === 'shuffle') {
      setActiveWords(shuffleArray(words));
    } else {
      setActiveWords(words);
    }
    setCurrentIndex(0);
    setWordStates({});
    setInputVal('');
    setIsRevealed(false);
  }, [words]);

  // Sync listTitle prop
  useEffect(() => {
    if (listTitle) {
      setCurrentTitle(listTitle);
    }
  }, [listTitle]);

  // Switch to Sequential Order
  const handleSetOrderMode = () => {
    setPlayMode('order');
    setActiveWords(originalWords);
    setCurrentIndex(0);
    setWordStates({});
    setInputVal('');
    setIsRevealed(false);
  };

  // Switch to Random Shuffle (resuffles every single click!)
  const handleTriggerShuffle = () => {
    setPlayMode('shuffle');
    const shuffled = shuffleArray(originalWords);
    setActiveWords(shuffled);
    setCurrentIndex(0);
    setWordStates({});
    setInputVal('');
    setIsRevealed(false);
    setShuffleTip('已重新随机打乱！');
    setTimeout(() => setShuffleTip(''), 1500);
  };

  // Handle switching list
  const handleSelectNewList = async (newListId, newListName) => {
    setCurrentTitle(newListName);
    if (onSwitchList) {
      await onSwitchList(newListId, newListName);
    }
  };

  const currentWord = activeWords[currentIndex] || null;
  const isFinished = currentIndex >= activeWords.length;

  // When currentIndex changes, restore state for this word
  useEffect(() => {
    if (!isFinished && currentWord) {
      const savedState = wordStates[currentIndex];
      if (savedState) {
        setInputVal(savedState.userInput || '');
        setIsRevealed(Boolean(savedState.isRevealed));
      } else {
        setInputVal('');
        setIsRevealed(false);
      }
      setShowHint(false);

      // If this item has not been revealed yet, auto-play its pronunciation
      if (!savedState?.isRevealed) {
        triggerAudio(currentWord.word, accent, speed);
        setTimeout(() => {
          inputRef.current?.focus();
        }, 120);
      }
    }
  }, [currentIndex, isFinished, currentWord]);

  const triggerAudio = async (wordToPlay, curAccent = accent, curSpeed = speed) => {
    if (!wordToPlay) return;
    setIsPlayingAudio(true);
    try {
      await playWordAudio(wordToPlay, curAccent, curSpeed);
    } finally {
      setIsPlayingAudio(false);
    }
  };

  const handlePlaySentence = async (sentence) => {
    if (!sentence) return;
    await playSentenceAudio(sentence, accent, speed);
  };

  const cycleSpeed = () => {
    const speeds = [1.0, 0.75, 0.9, 1.25];
    const curIdx = speeds.indexOf(speed);
    const nextSpeed = curIdx === -1 ? 1.0 : speeds[(curIdx + 1) % speeds.length];
    setSpeed(nextSpeed);
    setSpeechRate(nextSpeed);
    if (currentWord) {
      triggerAudio(currentWord.word, accent, nextSpeed);
    }
  };

  // Check user input
  const handleCheck = () => {
    if (!currentWord || isRevealed) return;

    const trimmedInput = inputVal.trim();

    // If empty, do not make an incorrect judgment, directly advance to the next word
    if (!trimmedInput) {
      setWordStates(prev => ({
        ...prev,
        [currentIndex]: {
          ...(prev[currentIndex] || {}),
          userInput: '',
          isCorrect: false,
          isSkipped: true,
          isRevealed: false,
        }
      }));
      handleNext();
      return;
    }

    const isCorrect = trimmedInput.toLowerCase() === currentWord.word.toLowerCase();

    playFeedbackSound(isCorrect);
    if (isCorrect) {
      confetti({
        particleCount: 35,
        spread: 60,
        origin: { y: 0.7 }
      });
    }

    setWordStates(prev => ({
      ...prev,
      [currentIndex]: {
        ...(prev[currentIndex] || {}),
        userInput: trimmedInput,
        isCorrect,
        isRevealed: true,
        isSkipped: false,
        isPeeked: false,
      }
    }));
    setIsRevealed(true);

    // Record to database
    api.recordResult({
      word_id: currentWord.id,
      mode: 'dictation',
      is_correct: isCorrect ? 1 : 0,
      user_input: trimmedInput,
    }).catch(console.warn);
  };

  // Directly reveal word and meaning (点击显示词和意思)
  const handleRevealDirectly = () => {
    if (!currentWord) return;
    const trimmedInput = inputVal.trim();
    const hasInput = Boolean(trimmedInput);
    const isCorrect = hasInput ? trimmedInput.toLowerCase() === currentWord.word.toLowerCase() : false;

    setWordStates(prev => ({
      ...prev,
      [currentIndex]: {
        ...(prev[currentIndex] || {}),
        userInput: trimmedInput,
        isCorrect: hasInput ? isCorrect : false,
        isRevealed: true,
        isPeeked: true,
        isSkipped: false,
      }
    }));
    setIsRevealed(true);

    if (hasInput) {
      playFeedbackSound(isCorrect);
    }

    // Play pronunciation alongside revealing
    triggerAudio(currentWord.word, accent, speed);
  };

  // Re-hide word to allow re-trying
  const handleHideAgain = () => {
    setWordStates(prev => ({
      ...prev,
      [currentIndex]: {
        ...(prev[currentIndex] || {}),
        isRevealed: false,
      }
    }));
    setIsRevealed(false);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  };

  // Navigate to previous word (上一个)
  const handlePrev = () => {
    if (currentIndex > 0) {
      // Save current input if not yet checked
      if (!isRevealed) {
        setWordStates(prev => ({
          ...prev,
          [currentIndex]: {
            ...(prev[currentIndex] || {}),
            userInput: inputVal,
          }
        }));
      }
      setCurrentIndex(prev => prev - 1);
    }
  };

  // Navigate to next word (下一个)
  const handleNext = () => {
    // If on the last word
    if (currentIndex >= words.length - 1) {
      if (!isRevealed) {
        const trimmed = inputVal.trim();
        if (!trimmed) {
          setWordStates(prev => ({
            ...prev,
            [currentIndex]: {
              ...(prev[currentIndex] || {}),
              userInput: '',
              isSkipped: true,
              isRevealed: false,
            }
          }));
        } else {
          setWordStates(prev => ({
            ...prev,
            [currentIndex]: {
              ...(prev[currentIndex] || {}),
              userInput: trimmed,
            }
          }));
        }
      }
      setCurrentIndex(words.length);
      return;
    }

    // If moving to next while not revealed
    if (!isRevealed) {
      const trimmed = inputVal.trim();
      if (!trimmed) {
        setWordStates(prev => ({
          ...prev,
          [currentIndex]: {
            ...(prev[currentIndex] || {}),
            userInput: '',
            isSkipped: true,
            isRevealed: false,
          }
        }));
      } else {
        setWordStates(prev => ({
          ...prev,
          [currentIndex]: {
            ...(prev[currentIndex] || {}),
            userInput: trimmed,
          }
        }));
      }
    }

    setCurrentIndex(prev => prev + 1);
  };

  // Global Keyboard listener
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      const isInputActive = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

      if (e.key === 'Enter') {
        e.preventDefault();
        if (!isRevealed) {
          handleCheck();
        } else {
          handleNext();
        }
        return;
      }

      // If not focusing on input, allow ArrowLeft / ArrowRight navigation
      if (!isInputActive) {
        if (e.key === 'ArrowLeft') {
          handlePrev();
        } else if (e.key === 'ArrowRight') {
          handleNext();
        } else if (e.key === ' ') {
          e.preventDefault();
          if (currentWord) triggerAudio(currentWord.word);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [currentIndex, isRevealed, inputVal, currentWord, activeWords.length]);

  // Switch accent
  const toggleAccent = () => {
    const nextAccent = accent === 'us' ? 'uk' : 'us';
    setAccent(nextAccent);
    localStorage.setItem('preferred_accent', nextAccent);
    if (currentWord) {
      triggerAudio(currentWord.word, nextAccent);
    }
  };

  // Compiled results across all words
  const compiledResults = activeWords.map((w, idx) => {
    const st = wordStates[idx];
    if (!st) {
      return {
        word: w,
        userInput: '',
        isCorrect: false,
        isSkipped: true,
        isPeeked: false,
      };
    }
    return {
      word: w,
      userInput: st.userInput || '',
      isCorrect: Boolean(st.isCorrect),
      isSkipped: Boolean(st.isSkipped),
      isPeeked: Boolean(st.isPeeked),
    };
  });

  // Restart dictation
  const handleRestart = (onlyMistakes = false) => {
    if (onlyMistakes) {
      const wrongWords = compiledResults.filter(r => !r.isCorrect && !r.isSkipped).map(r => r.word);
      if (wrongWords.length > 0) {
        onFinish?.(wrongWords);
        return;
      }
    }
    setWordStates({});
    setCurrentIndex(0);
    setIsRevealed(false);
    setInputVal('');
    if (playMode === 'shuffle') {
      setActiveWords(shuffleArray(originalWords));
    }
  };

  if (!activeWords || activeWords.length === 0) {
    return (
      <div className="max-w-xl mx-auto text-center py-16 px-4 animate-fade-in">
        <div className="w-16 h-16 mx-auto bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mb-4">
          <HelpCircle className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-slate-800">
          词单「{currentTitle || listTitle || '当前词单'}」暂无单词
        </h3>
        <p className="text-slate-500 mt-2 text-sm">您可以点击下方按钮快速切换到其他词单，或返回词库添加单词。</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setShowListSwitcher(true)}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-sm inline-flex items-center gap-2 cursor-pointer transition-colors"
          >
            <BookOpen className="w-4 h-4" />
            <span>切换其他词单</span>
          </button>
          <button
            type="button"
            onClick={onBack}
            className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回词库</span>
          </button>
        </div>
        <ListSwitchModal
          isOpen={showListSwitcher}
          onClose={() => setShowListSwitcher(false)}
          currentListId={currentListId}
          currentTitle={currentTitle || listTitle}
          onSelect={handleSelectNewList}
        />
      </div>
    );
  }

  // Finished Summary Screen
  if (isFinished) {
    const answeredResults = compiledResults.filter(r => !r.isSkipped);
    const correctCount = answeredResults.filter(r => r.isCorrect).length;
    const skippedCount = compiledResults.filter(r => r.isSkipped).length;
    const peekedCount = compiledResults.filter(r => r.isPeeked && !r.isCorrect).length;
    const accuracy = answeredResults.length > 0 
      ? Math.round((correctCount / answeredResults.length) * 100) 
      : 0;
    const mistakes = answeredResults.filter(r => !r.isCorrect);

    return (
      <div className="max-w-2xl mx-auto py-4 sm:py-8 px-3 sm:px-4 animate-fade-in">
        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
          {/* Header Card */}
          <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-4 sm:px-8 py-6 sm:py-10 text-white text-center">
            <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto bg-white/20 backdrop-blur-xs rounded-2xl flex items-center justify-center mb-3">
              <Award className="w-7 h-7 sm:w-9 sm:h-9 text-amber-300" />
            </div>
            <h2 className="text-xl sm:text-2xl font-black">听写测试完成！</h2>
            <p className="text-indigo-100 text-xs sm:text-sm mt-1">{currentTitle || listTitle || '词单听写'}</p>

            <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-4 sm:mt-6 max-w-sm mx-auto">
              <div className="bg-white/10 backdrop-blur-xs rounded-xl p-2.5 sm:p-3">
                <div className="text-xl sm:text-2xl font-black">{activeWords.length}</div>
                <div className="text-[10px] sm:text-xs text-indigo-200 mt-0.5">
                  总词数 {skippedCount > 0 && `(跳${skippedCount})`}
                </div>
              </div>
              <div className="bg-white/10 backdrop-blur-xs rounded-xl p-2.5 sm:p-3">
                <div className="text-xl sm:text-2xl font-black text-emerald-300">{correctCount}</div>
                <div className="text-[10px] sm:text-xs text-indigo-200 mt-0.5">拼写正确</div>
              </div>
              <div className="bg-white/10 backdrop-blur-xs rounded-xl p-2.5 sm:p-3">
                <div className="text-xl sm:text-2xl font-black text-amber-300">{accuracy}%</div>
                <div className="text-[10px] sm:text-xs text-indigo-200 mt-0.5">正确率</div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="p-4 sm:p-6 bg-slate-50 border-b border-slate-200 flex items-center justify-center gap-2 sm:gap-4 flex-wrap">
            {mistakes.length > 0 && (
              <button
                type="button"
                onClick={() => handleRestart(true)}
                className="w-full sm:w-auto px-4 sm:px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-semibold shadow-md shadow-rose-200 flex items-center justify-center gap-2 transition-all text-xs sm:text-sm cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>针对重练错题 ({mistakes.length})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleRestart(false)}
              className="flex-1 sm:flex-initial px-4 sm:px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-md shadow-indigo-200 flex items-center justify-center gap-2 transition-all text-xs sm:text-sm cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>重新听写</span>
            </button>
            <button
              type="button"
              onClick={() => setShowListSwitcher(true)}
              className="flex-1 sm:flex-initial px-4 sm:px-5 py-2.5 bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-700 rounded-xl font-semibold transition-all text-xs sm:text-sm text-center flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <BookOpen className="w-4 h-4" />
              <span>切换其他词单</span>
            </button>
            <button
              type="button"
              onClick={onBack}
              className="flex-1 sm:flex-initial px-4 sm:px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-semibold transition-all text-xs sm:text-sm text-center cursor-pointer"
            >
              返回词库
            </button>
          </div>

          {/* Review List */}
          <div className="p-4 sm:p-6">
            <h4 className="font-bold text-slate-800 mb-3 text-xs sm:text-sm flex items-center justify-between">
              <span>本轮明细回顾</span>
              <span className="text-[11px] text-slate-400">点击喇叭可重复听发音</span>
            </h4>
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto pr-1">
              {compiledResults.map((r, idx) => (
                <div key={idx} className="py-2.5 sm:py-3.5 flex items-start justify-between gap-2 sm:gap-4">
                  <div className="flex items-start gap-2 sm:gap-3 min-w-0">
                    <button
                      onClick={() => triggerAudio(r.word.word)}
                      className="p-1.5 sm:p-2 mt-0.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors shrink-0"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm sm:text-base">{r.word.word}</span>
                        {r.word.phonetic && (
                          <span className="text-xs font-mono text-slate-500">{r.word.phonetic}</span>
                        )}
                        {r.isSkipped ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.2 rounded-full">
                            直接跳过
                          </span>
                        ) : r.isCorrect ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.2 rounded-full">
                            <Check className="w-3 h-3" /> 正确
                          </span>
                        ) : r.isPeeked ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 bg-amber-50 px-2 py-0.2 rounded-full">
                            <Eye className="w-3 h-3" /> 查看词义 {r.userInput && `(输入: ${r.userInput})`}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 bg-rose-50 px-2 py-0.2 rounded-full">
                            <XCircle className="w-3 h-3" /> 误作: {r.userInput || '(未填写)'}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">{r.word.translation}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const curState = wordStates[currentIndex] || {};

  // Dictation Active Screen
  return (
    <div className="max-w-2xl mx-auto py-4 sm:py-6 px-3 sm:px-4 animate-fade-in">
      {/* Top Header Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-6 gap-3">
        {/* Left: Exit & Mobile List Switcher */}
        <div className="flex items-center justify-between sm:justify-start gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 p-1.5 sm:p-2 rounded-xl hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>退出</span>
          </button>

          {/* Mobile inline List Switcher */}
          <div className="sm:hidden">
            <button
              type="button"
              onClick={() => setShowListSwitcher(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-all cursor-pointer shadow-2xs max-w-[170px]"
              title="点击快速切换词单"
            >
              <BookOpen className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span className="truncate">{currentTitle || listTitle || '选择词单'}</span>
              <ChevronDown className="w-3 h-3 text-indigo-400 shrink-0" />
            </button>
          </div>
        </div>

        {/* Center: Clickable List title & Step Navigation (Desktop) */}
        <div className="text-center min-w-0 flex flex-col items-center">
          <div className="hidden sm:block mb-1">
            <button
              type="button"
              onClick={() => setShowListSwitcher(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-all cursor-pointer shadow-2xs group max-w-xs"
              title="点击快速切换选择其他词单"
            >
              <BookOpen className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span className="truncate">{currentTitle || listTitle || '选择词单'}</span>
              <ChevronDown className="w-3 h-3 text-indigo-400 group-hover:text-indigo-600 shrink-0 transition-transform group-hover:translate-y-0.5" />
            </button>
          </div>
          <div className="flex items-center justify-center gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={currentIndex === 0}
              onClick={handlePrev}
              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title="上一个 (←)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs sm:text-sm font-bold text-slate-700 whitespace-nowrap">
              第 <span className="text-indigo-600 font-extrabold">{currentIndex + 1}</span> / {activeWords.length} 词
            </span>
            <button
              type="button"
              onClick={handleNext}
              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="下一个 (→)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right Settings: Order/Shuffle Mode & Speech Speed & Accent */}
        <div className="flex items-center justify-end gap-1.5 sm:gap-2 shrink-0">
          {/* Order / Shuffle Switcher */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-bold shrink-0 relative">
            <button
              type="button"
              onClick={handleSetOrderMode}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                playMode === 'order'
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="按词单原有顺序练习"
            >
              顺序
            </button>
            <button
              type="button"
              onClick={handleTriggerShuffle}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                playMode === 'shuffle'
                  ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="点击切换随机打乱，每点一次重新随机一次"
            >
              <Shuffle className="w-3.5 h-3.5 text-indigo-600" />
              <span>随机</span>
            </button>
            {shuffleTip && (
              <div className="absolute -bottom-7 right-0 bg-slate-800 text-white text-[10px] font-medium px-2 py-0.5 rounded-md shadow-md whitespace-nowrap animate-in fade-in zoom-in-95 pointer-events-none z-20">
                {shuffleTip}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={cycleSpeed}
            className="text-[11px] sm:text-xs font-bold px-2 sm:px-2.5 py-1 sm:py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
            title="点击切换发音语速 (1.0x / 0.75x / 0.9x / 1.25x)"
          >
            <Gauge className="w-3.5 h-3.5 text-amber-500 hidden xs:inline" />
            <span>{speed}x</span>
          </button>
          <button
            type="button"
            onClick={toggleAccent}
            className="text-[11px] sm:text-xs font-bold px-2 sm:px-3 py-1 sm:py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer"
            title="切换美式/英式发音"
          >
            {accent === 'us' ? '🇺🇸 美音' : '🇬🇧 英音'}
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-100 h-1.5 sm:h-2 rounded-full overflow-hidden mb-5 sm:mb-8 shadow-inner">
        <div 
          className="bg-indigo-600 h-full transition-all duration-300 ease-out"
          style={{ width: `${((currentIndex + 1) / activeWords.length) * 100}%` }}
        />
      </div>

      {/* Main Dictation Card */}
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xl border border-slate-200 p-4 sm:p-10 text-center transition-all">
        {/* Big Audio Play Button */}
        <div className="mb-6">
          <button
            type="button"
            onClick={() => triggerAudio(currentWord.word)}
            className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full mx-auto flex items-center justify-center shadow-lg transition-all transform active:scale-95 ${
              isPlayingAudio 
                ? 'bg-indigo-600 text-white shadow-indigo-300 scale-105 animate-pulse' 
                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-600 hover:scale-105'
            }`}
            title="点击播放真人发音 (或按空格键)"
          >
            <Volume2 className="w-10 h-10 sm:w-12 sm:h-12" />
          </button>
          <div className="text-xs text-slate-400 mt-2 font-medium">
            点击重听发音 (纯正真人原声)
          </div>
        </div>

        {/* Unrevealed: Spelling Input & Action buttons */}
        {!isRevealed ? (
          <div className="space-y-5 max-w-md mx-auto">
            <div>
              <input
                ref={inputRef}
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="在此拼写听到的单词..."
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                className="w-full text-center text-2xl font-bold tracking-wider py-3 px-4 bg-slate-50 border-2 border-slate-300 focus:border-indigo-600 focus:bg-white rounded-2xl shadow-inner focus:outline-hidden transition-all"
              />
            </div>

            {/* Hint & Direct Reveal button */}
            <div className="flex items-center justify-between text-xs text-slate-500 px-1 gap-2">
              <button
                type="button"
                onClick={() => setShowHint(!showHint)}
                className="hover:text-indigo-600 transition-colors flex items-center gap-1 font-medium text-slate-500"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>{showHint ? '隐藏提示' : '首字母/长度提示'}</span>
              </button>

              {/* 点击显示词和意思 */}
              <button
                type="button"
                onClick={handleRevealDirectly}
                className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl font-bold flex items-center gap-1.5 transition-all active:scale-95 shadow-xs"
                title="直接查看当前单词的拼写与中文释义"
              >
                <Eye className="w-4 h-4 text-amber-600" />
                <span>显示词和意思</span>
              </button>
            </div>

            {showHint && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-mono tracking-widest animate-fade-in text-center">
                首字母: <span className="font-bold text-sm">{currentWord.word[0].toUpperCase()}</span>，词长: {currentWord.word.length} 字母 (
                {currentWord.word.split('').map((char, i) => (i === 0 ? char : '_')).join(' ')}
                )
              </div>
            )}

            {/* Submit / Skip button */}
            <button
              type="button"
              onClick={handleCheck}
              className={`w-full py-3.5 active:scale-98 text-white rounded-2xl font-bold text-base shadow-lg transition-all flex items-center justify-center gap-2 ${
                inputVal.trim()
                  ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
                  : 'bg-slate-600 hover:bg-slate-700 shadow-slate-200'
              }`}
            >
              {inputVal.trim() ? (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  <span>提交核对 (Enter)</span>
                </>
              ) : (
                <>
                  <ArrowRight className="w-5 h-5" />
                  <span>直接跳过，下一个 (Enter)</span>
                </>
              )}
            </button>

            {/* Bottom Prev / Next navigation row */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-100 text-xs">
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={handlePrev}
                className="px-3.5 py-2 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-xl font-semibold flex items-center gap-1.5 transition-all disabled:opacity-30 disabled:pointer-events-none"
                title="返回上一个单词 (←)"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>上一个</span>
              </button>

              <button
                type="button"
                onClick={handleRevealDirectly}
                className="text-slate-400 hover:text-amber-600 font-medium flex items-center gap-1 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>不会写？点击看答案</span>
              </button>

              <button
                type="button"
                onClick={handleNext}
                className="px-3.5 py-2 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-xl font-semibold flex items-center gap-1.5 transition-all"
                title="跳到下一个单词 (→)"
              >
                <span>下一个</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          /* Revealed: Word, Phonetic, Meaning, Example, and Prev/Next navigation */
          <div className="space-y-6 max-w-lg mx-auto animate-fade-in">
            {/* Correctness / Peeked banner and Hide toggle */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {curState.isPeeked && !curState.userInput ? (
                  <div className="inline-flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full font-bold text-xs">
                    <Eye className="w-4 h-4 text-amber-600" />
                    <span>已显示单词与释义</span>
                  </div>
                ) : curState.isCorrect ? (
                  <div className="inline-flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3.5 py-1 rounded-full font-bold text-xs">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>拼写完全正确！</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 text-rose-600 bg-rose-50 px-3.5 py-1 rounded-full font-bold text-xs">
                    <XCircle className="w-4 h-4" />
                    <span>拼写有误，你的输入: <span className="line-through">{curState.userInput || '未作答'}</span></span>
                  </div>
                )}
              </div>

              {/* Hide again button */}
              <button
                type="button"
                onClick={handleHideAgain}
                className="text-xs text-slate-500 hover:text-indigo-600 flex items-center gap-1 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                title="重新隐藏以重新拼写练习"
              >
                <EyeOff className="w-3.5 h-3.5" />
                <span>重新隐藏</span>
              </button>
            </div>

            {/* Word Display Details */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-left space-y-3 shadow-inner">
              <div className="flex items-baseline justify-between border-b border-slate-200/70 pb-3">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <h3 className="text-3xl font-black text-slate-900 tracking-wide">
                    {currentWord.word}
                  </h3>
                  {currentWord.phonetic && (
                    <span className="font-mono text-sm text-indigo-600 font-medium">
                      {currentWord.phonetic}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => triggerAudio(currentWord.word)}
                  className="p-2 text-indigo-600 hover:bg-indigo-100 rounded-xl transition-colors"
                  title="再听一次发音"
                >
                  <Volume2 className="w-5 h-5" />
                </button>
              </div>

              {/* Chinese Translation */}
              <div className="text-slate-800 font-semibold text-base leading-relaxed">
                {currentWord.translation || '暂无释义'}
              </div>

              {/* Example sentence */}
              {currentWord.example && (
                <div className="pt-2 text-xs text-slate-600 space-y-1.5 border-t border-slate-200/50">
                  <div className="flex items-start gap-1.5">
                    <button
                      type="button"
                      onClick={() => handlePlaySentence(currentWord.example)}
                      className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-200/60 rounded-md shrink-0 transition-colors mt-0.5"
                      title="朗读例句原声"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                    <div className="italic text-slate-700 font-serif text-xs leading-relaxed">
                      "{currentWord.example}"
                    </div>
                  </div>
                  {currentWord.example_cn && (
                    <div className="text-slate-500 pl-6 text-xs">{currentWord.example_cn}</div>
                  )}
                </div>
              )}
            </div>

            {/* Navigation action buttons */}
            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={handlePrev}
                className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm flex items-center gap-1.5 transition-all disabled:opacity-30 disabled:pointer-events-none"
                title="返回上一个单词 (←)"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>上一个</span>
              </button>

              <button
                type="button"
                onClick={handleNext}
                className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white rounded-2xl font-bold text-base shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <span>{currentIndex >= activeWords.length - 1 ? '完成听写，查看报告' : '下一个单词并播放发音'}</span>
                <ArrowRight className="w-5 h-5" />
                <span className="text-xs text-indigo-200 font-normal">(按 Enter)</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <ListSwitchModal
        isOpen={showListSwitcher}
        onClose={() => setShowListSwitcher(false)}
        currentListId={currentListId}
        currentTitle={currentTitle || listTitle}
        onSelect={handleSelectNewList}
      />
    </div>
  );
}
