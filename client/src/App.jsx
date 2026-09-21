import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import WordLibrary from './components/WordLibrary';
import DictationView from './components/DictationView';
import MemoryView from './components/MemoryView';
import CalendarView from './components/CalendarView';
import ImportModal from './components/ImportModal';
import SettingsModal from './components/SettingsModal';
import AuthModal from './components/AuthModal';
import AuditModal from './components/AuditModal';
import SubmitAuditModal from './components/SubmitAuditModal';
import AdminStatsModal from './components/AdminStatsModal';
import { useAuth } from './context/AuthContext';
import { api } from './api/client';

export default function App() {
  const { user } = useAuth();
  const [currentTab, setCurrentTab] = useState('library'); // 'library' | 'calendar' | 'dictation' | 'memory'
  const [lastMainTab, setLastMainTab] = useState('library'); // 'library' | 'calendar'
  const [lists, setLists] = useState([]);
  const [currentListId, setCurrentListId] = useState('');
  const [activeStudyWords, setActiveStudyWords] = useState([]);
  const [activeStudyTitle, setActiveStudyTitle] = useState('');

  // Modals
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importTab, setImportTab] = useState('photo');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdminStatsOpen, setIsAdminStatsOpen] = useState(false);

  // Overall statistics
  const [stats, setStats] = useState(null);

  // Load lists and stats
  const refreshListsAndStats = async () => {
    try {
      const listsData = await api.getLists();
      setLists(listsData);
      if (listsData.length > 0 && !currentListId) {
        // default to first list or empty (all)
      }
      const statsData = await api.getStats();
      setStats(statsData);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  };

  useEffect(() => {
    refreshListsAndStats();
  }, [user]);

  // Launch Dictation mode with specific words
  const handleStartDictation = async (wordsToDictate, title = '') => {
    if (wordsToDictate && wordsToDictate.length > 0) {
      setActiveStudyWords(wordsToDictate);
      setActiveStudyTitle(title || '单词听写');
      setCurrentTab('dictation');
    } else if (currentListId) {
      const data = await api.getListWords(currentListId);
      setActiveStudyWords(data.words || []);
      setActiveStudyTitle(data.list?.name || '单词听写');
      setCurrentTab('dictation');
    } else {
      const data = await api.getWords({ limit: 50 });
      setActiveStudyWords(data.words || []);
      setActiveStudyTitle('候选词库听写');
      setCurrentTab('dictation');
    }
  };

  // Launch Memory mode with specific words
  const handleStartMemory = async (wordsToMemorize, title = '') => {
    if (wordsToMemorize && wordsToMemorize.length > 0) {
      setActiveStudyWords(wordsToMemorize);
      setActiveStudyTitle(title || '单词记忆');
      setCurrentTab('memory');
    } else if (currentListId) {
      const data = await api.getListWords(currentListId);
      setActiveStudyWords(data.words || []);
      setActiveStudyTitle(data.list?.name || '单词记忆');
      setCurrentTab('memory');
    } else {
      const data = await api.getWords({ limit: 50 });
      setActiveStudyWords(data.words || []);
      setActiveStudyTitle('候选词库记忆');
      setCurrentTab('memory');
    }
  };

  // Fast switch list from within Dictation or Memory view
  const handleSwitchStudyList = async (targetListId, targetTitle) => {
    try {
      let words = [];
      let finalTitle = targetTitle || '';
      if (targetListId === 'unassigned') {
        const data = await api.getWords({ listId: 'unassigned' });
        words = data.words || [];
        finalTitle = finalTitle || '未归类单词';
      } else if (targetListId === 'all') {
        const data = await api.getWords({ listId: 'all' });
        words = data.words || [];
        finalTitle = finalTitle || '全库所有单词';
      } else {
        const data = await api.getListWords(targetListId);
        words = data.words || [];
        finalTitle = finalTitle || data.list?.name || '词单';
      }
      setActiveStudyWords(words);
      setActiveStudyTitle(finalTitle);
      setCurrentListId(targetListId);
      return { words, title: finalTitle };
    } catch (err) {
      console.error('Failed to switch study list:', err);
      throw err;
    }
  };

  // Open import modal
  const handleOpenImport = (tabType = 'photo') => {
    if (!user) {
      openAuthModal('login');
      return;
    }
    setImportTab(tabType);
    setIsImportOpen(true);
  };

  // Handle mode change from navbar
  const handleChangeTab = (tab) => {
    if (tab === 'dictation') {
      handleStartDictation();
    } else if (tab === 'memory') {
      handleStartMemory();
    } else if (tab === 'calendar') {
      setLastMainTab('calendar');
      setCurrentTab('calendar');
    } else {
      setLastMainTab('library');
      setCurrentTab('library');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Top Navigation */}
      <Navbar
        currentTab={currentTab}
        onChangeTab={handleChangeTab}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenAdminStats={() => setIsAdminStatsOpen(true)}
        stats={stats}
      />

      {/* Main Content Area */}
      <main className="flex-1 pb-16 md:pb-0">
        {currentTab === 'library' && (
          <WordLibrary
            lists={lists}
            currentListId={currentListId}
            onSelectList={(id) => setCurrentListId(id)}
            onRefreshLists={refreshListsAndStats}
            onStartDictation={handleStartDictation}
            onStartMemory={handleStartMemory}
            onOpenImport={handleOpenImport}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        )}

        {currentTab === 'calendar' && (
          <CalendarView
            onStartDictation={handleStartDictation}
            onStartMemory={handleStartMemory}
            onRefreshStats={refreshListsAndStats}
          />
        )}

        {currentTab === 'dictation' && (
          <DictationView
            words={activeStudyWords}
            listTitle={activeStudyTitle}
            currentListId={currentListId}
            onBack={() => {
              setCurrentTab(lastMainTab);
              refreshListsAndStats();
            }}
            onSwitchList={handleSwitchStudyList}
            onFinish={(mistakes) => {
              if (mistakes && mistakes.length > 0) {
                setActiveStudyWords(mistakes);
                setActiveStudyTitle('错题针对重练');
              }
            }}
          />
        )}

        {currentTab === 'memory' && (
          <MemoryView
            words={activeStudyWords}
            listTitle={activeStudyTitle}
            currentListId={currentListId}
            onBack={() => {
              setCurrentTab(lastMainTab);
              refreshListsAndStats();
            }}
            onSwitchList={handleSwitchStudyList}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-slate-400 border-t border-slate-200 mt-auto pb-20 md:pb-4 px-4">
        单词听写兼记忆网站 · 准确发音 (美/英真人发音) · 硅基流动 AI 智能拍照识别 · 录音打分
      </footer>

      {/* Modals */}
      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        lists={lists}
        currentListId={currentListId}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onImportSuccess={() => {
          refreshListsAndStats();
        }}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={() => {
          refreshListsAndStats();
        }}
      />

      {/* Authentication & Audit Modals */}
      <AuthModal />
      <AuditModal />
      <SubmitAuditModal />
      <AdminStatsModal
        isOpen={isAdminStatsOpen}
        onClose={() => setIsAdminStatsOpen(false)}
      />
    </div>
  );
}
