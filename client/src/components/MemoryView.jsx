import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, ArrowRight, Volume2, Eye, EyeOff, 
  RotateCcw, Sparkles, BookOpen, Check, ThumbsUp, HelpCircle, Gauge,
  Shuffle, ChevronDown, ChevronLeft, ChevronRight
} from 'lucide-react';
import { playWordAudio, playSentenceAudio, getSpeechRate, setSpeechRate } from '../utils/audio';
import PronunciationEvaluator from './PronunciationEvaluator';
import ListSwitchModal from './ListSwitchModal';

// Helper to shuffle array (Fisher-Yates)
function shuffleArray(array) {
  if (!array || array.length <= 1) return [...(array || [])];
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (arr.length > 1 && arr.every((item, idx) => item.id === array[idx]?.id)) {
    [arr[0], arr[1]] = [arr[1], arr[0]];
  }
  return arr;
}

export default function MemoryView({ 
  words = [], 
  listTitle, 
  currentListId, 
  onBack, 
  onSwitchList 
}) {
  const [originalWords, setOriginalWords] = useState(words);
  const [activeWords, setActiveWords] = useState(words);
  const [playMode, setPlayMode] = useState('order'); // 'order' | 'shuffle'
  const [currentTitle, setCurrentTitle] = useState(listTitle);
  const [showListSwitcher, setShowListSwitcher] = useState(false);
  const [shuffleTip, setShuffleTip] = useState('');

  const [currentIndex, setCurrentIndex] = useState(0);
  // displayMode: 'all' (show all), 'word-only' (hide meaning), 'meaning-only' (hide word)
  const [displayMode, setDisplayMode] = useState('all');
  const [isFlipped, setIsFlipped] = useState(false);
  const [accent, setAccent] = useState(() => localStorage.getItem('preferred_accent') || 'us');
  const [speed, setSpeed] = useState(() => getSpeechRate());
  const [isPlayingWord, setIsPlayingWord] = useState(false);
  const [isPlayingSentence, setIsPlayingSentence] = useState(false);

  // Sync words when prop changes (or after list switch)
  useEffect(() => {
    setOriginalWords(words);
    if (playMode === 'shuffle') {
      setActiveWords(shuffleArray(words));
    } else {
      setActiveWords(words);
    }
    setCurrentIndex(0);
    setIsFlipped(false);
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
    setIsFlipped(false);
  };

  // Switch to Random Shuffle (reshuffles every single click!)
  const handleTriggerShuffle = () => {
    setPlayMode('shuffle');
    const shuffled = shuffleArray(originalWords);
    setActiveWords(shuffled);
    setCurrentIndex(0);
    setIsFlipped(false);
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

  useEffect(() => {
    setIsFlipped(false);
    // Auto-play audio if enabled
    const autoPlay = localStorage.getItem('auto_play_audio') !== 'false';
    if (autoPlay && currentWord) {
      handlePlayWord(speed);
    }
  }, [currentIndex, currentWord]);

  const handlePlayWord = async (customSpeed) => {
    if (!currentWord) return;
    const curSpeed = typeof customSpeed === 'number' && !isNaN(customSpeed) && customSpeed > 0 ? customSpeed : speed;
    setIsPlayingWord(true);
    try {
      await playWordAudio(currentWord.word, accent, curSpeed);
    } finally {
      setIsPlayingWord(false);
    }
  };

  const handlePlaySentence = async (customSpeed) => {
    if (!currentWord?.example) return;
    const curSpeed = typeof customSpeed === 'number' && !isNaN(customSpeed) && customSpeed > 0 ? customSpeed : speed;
    setIsPlayingSentence(true);
    try {
      await playSentenceAudio(currentWord.example, accent, curSpeed);
    } finally {
      setIsPlayingSentence(false);
    }
  };

  const cycleSpeed = () => {
    const speeds = [1.0, 0.75, 0.9, 1.25];
    const curIdx = speeds.indexOf(speed);
    const nextSpeed = curIdx === -1 ? 1.0 : speeds[(curIdx + 1) % speeds.length];
    setSpeed(nextSpeed);
    setSpeechRate(nextSpeed);
    if (currentWord) {
      handlePlayWord(nextSpeed);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < activeWords.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsFlipped(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, activeWords.length]);

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

  // Determine visibility based on mode and flip state
  const shouldShowWord = displayMode === 'all' || displayMode === 'word-only' || isFlipped;
  const shouldShowMeaning = displayMode === 'all' || displayMode === 'meaning-only' || isFlipped;

  return (
    <div className="max-w-2xl mx-auto py-4 sm:py-6 px-3 sm:px-4 animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
        {/* Left: Exit & Mobile List Switcher */}
        <div className="flex items-center justify-between sm:justify-start gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 p-1.5 sm:p-2 rounded-xl hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回</span>
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
              disabled={currentIndex === activeWords.length - 1}
              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title="下一个 (→)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right Settings: Order/Shuffle Mode & Speed & Accent */}
        <div className="flex items-center justify-end gap-1.5 sm:gap-2 shrink-0">
          {/* Order / Shuffle Switcher */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-bold shrink-0 relative">
            <button
              type="button"
              onClick={handleSetOrderMode}
              className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
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
              className={`px-2 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                playMode === 'shuffle'
                  ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="点击切换随机打乱，每点一次重新随机一次"
            >
              <Shuffle className="w-3 h-3 text-indigo-600" />
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
            onClick={() => {
              const next = accent === 'us' ? 'uk' : 'us';
              setAccent(next);
              localStorage.setItem('preferred_accent', next);
            }}
            className="text-[11px] sm:text-xs font-bold px-2 sm:px-3 py-1 sm:py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            {accent === 'us' ? '🇺🇸 美音' : '🇬🇧 英音'}
          </button>
        </div>
      </div>

      {/* Visibility Mode Switcher */}
      <div className="bg-slate-100 p-1 rounded-xl sm:rounded-2xl flex items-center justify-center gap-1 mb-4 sm:mb-6 max-w-md mx-auto text-xs font-semibold text-slate-600">
        <button
          type="button"
          onClick={() => setDisplayMode('all')}
          className={`flex-1 py-1.5 px-2 rounded-lg sm:rounded-xl transition-all ${
            displayMode === 'all' ? 'bg-white text-indigo-600 shadow-xs' : 'hover:text-slate-900'
          }`}
        >
          全部显示
        </button>
        <button
          type="button"
          onClick={() => setDisplayMode('word-only')}
          className={`flex-1 py-1.5 px-2 rounded-lg sm:rounded-xl transition-all flex items-center justify-center gap-1 ${
            displayMode === 'word-only' ? 'bg-white text-indigo-600 shadow-xs' : 'hover:text-slate-900'
          }`}
        >
          <span>仅显单词</span>
          <span className="hidden sm:inline">(考释义)</span>
        </button>
        <button
          type="button"
          onClick={() => setDisplayMode('meaning-only')}
          className={`flex-1 py-1.5 px-2 rounded-lg sm:rounded-xl transition-all flex items-center justify-center gap-1 ${
            displayMode === 'meaning-only' ? 'bg-white text-indigo-600 shadow-xs' : 'hover:text-slate-900'
          }`}
        >
          <span>仅显释义</span>
          <span className="hidden sm:inline">(考拼写)</span>
        </button>
      </div>

      {/* Main Flashcard Card */}
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xl border border-slate-200 p-4 sm:p-10 transition-all">
        {/* Word and Phonetic Header */}
        <div className="text-center pb-4 sm:pb-6 border-b border-slate-100">
          {shouldShowWord ? (
            <div className="space-y-2 animate-fade-in">
              <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
                <h2 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-wide break-words">
                  {currentWord.word}
                </h2>
                <button
                  type="button"
                  onClick={() => handlePlayWord()}
                  className={`p-2.5 sm:p-3 rounded-2xl transition-all ${
                    isPlayingWord 
                      ? 'bg-indigo-600 text-white shadow-md animate-pulse' 
                      : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-600'
                  }`}
                  title="播放真人准确发音"
                >
                  <Volume2 className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              </div>

              {currentWord.phonetic && (
                <div className="text-sm sm:text-base font-mono text-indigo-600 font-medium tracking-wide">
                  {currentWord.phonetic}
                </div>
              )}
            </div>
          ) : (
            <div className="py-4 sm:py-6 animate-fade-in">
              <div className="text-slate-400 font-semibold text-base sm:text-lg flex items-center justify-center gap-2">
                <EyeOff className="w-5 h-5" />
                <span>英文单词已隐藏 (点击下方翻转查看)</span>
              </div>
            </div>
          )}
        </div>

        {/* Translation and Example Section */}
        <div className="py-4 sm:py-6 space-y-4">
          {shouldShowMeaning ? (
            <div className="space-y-4 animate-fade-in">
              {/* Chinese Definition */}
              <div className="text-center sm:text-left">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  中文释义
                </div>
                <div className="text-lg sm:text-2xl font-bold text-slate-800 break-words">
                  {currentWord.translation || '暂无详细释义'}
                </div>
              </div>

              {/* Example Sentence */}
              {currentWord.example && (
                <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-3.5 sm:p-5 mt-3 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-indigo-600">
                    <span className="flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>实用例句</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handlePlaySentence()}
                      className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 p-1 rounded-md transition-colors"
                      title="朗读例句"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>{isPlayingSentence ? '正在朗读...' : '朗读例句'}</span>
                    </button>
                  </div>
                  <div className="text-xs sm:text-sm font-serif italic text-slate-800 leading-relaxed">
                    "{currentWord.example}"
                  </div>
                  {currentWord.example_cn && (
                    <div className="text-[11px] sm:text-xs text-slate-600">
                      {currentWord.example_cn}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="py-4 sm:py-6 text-center animate-fade-in">
              <div className="text-slate-400 font-semibold text-base sm:text-lg flex items-center justify-center gap-2">
                <EyeOff className="w-5 h-5" />
                <span>中文释义已隐藏</span>
              </div>
            </div>
          )}

          {/* Flip / Reveal button when parts are hidden */}
          {displayMode !== 'all' && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setIsFlipped(!isFlipped)}
                className="px-4 sm:px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors inline-flex items-center gap-1.5"
              >
                {isFlipped ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{isFlipped ? '隐藏答案' : '翻转揭晓完整内容'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Pronunciation Recording & Scoring Component */}
        <PronunciationEvaluator 
          word={currentWord} 
          accent={accent}
        />
      </div>

      {/* Navigation Buttons Footer */}
      <div className="flex items-center justify-between mt-4 sm:mt-6 px-1 sm:px-2 gap-2">
        <button
          type="button"
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="px-3.5 sm:px-5 py-2 sm:py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-xs sm:text-sm shadow-xs flex items-center gap-1.5 sm:gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>上一个</span>
        </button>

        <span className="text-[11px] text-slate-400 font-medium hidden sm:inline">
          可通过键盘方向键翻页
        </span>

        <button
          type="button"
          onClick={handleNext}
          disabled={currentIndex === activeWords.length - 1}
          className="px-3.5 sm:px-5 py-2 sm:py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white font-semibold rounded-xl text-xs sm:text-sm shadow-md shadow-indigo-200 flex items-center gap-1.5 sm:gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <span>下一个</span>
          <ArrowRight className="w-4 h-4" />
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
