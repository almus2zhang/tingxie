import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  FolderPlus, Plus, Search, CheckSquare, Square, Volume2, 
  Trash2, Headphones, Sparkles, BookOpen, Layers, Check, 
  MoreVertical, Filter, ArrowRight, Folder, RefreshCw, Pencil, X, Save,
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ChevronUp, ChevronDown, PlusCircle, Flame, Minus, RotateCcw, AlertCircle,
  FolderOpen, Move, CornerDownRight, Globe
} from 'lucide-react';
import { api } from '../api/client';
import { playWordAudio } from '../utils/audio';
import { useAuth } from '../context/AuthContext';

// Helper for generating page number pagination array (e.g. [1, 2, 3, '...', 10])
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

export default function WordLibrary({ 
  lists, 
  currentListId, 
  onSelectList, 
  onRefreshLists,
  onStartDictation, 
  onStartMemory, 
  onOpenImport,
  onOpenSettings
}) {
  const { user, isAuthenticated, isAdmin, openAuthModal, openSubmitAudit } = useAuth();
  const isPublicItem = (item) => !item?.user_id || item?.is_public === 1;
  const canDirectlyModify = (item) => isAdmin || (isAuthenticated && item && item.user_id === user?.id);

  const [words, setWords] = useState([]);
  const [loadingWords, setLoadingWords] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWordIds, setSelectedWordIds] = useState(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState(null);

  // Pagination state: 20, 50, 100, or 0 (all)
  const [pageSize, setPageSize] = useState(() => {
    const saved = localStorage.getItem('wordlib_page_size');
    return saved !== null ? Number(saved) : 50;
  });
  const [currentPage, setCurrentPage] = useState(1);
  const listContainerRef = useRef(null);

  // Insert word between entries state
  const [insertModalData, setInsertModalData] = useState(null); // { afterWord, beforeWord }
  const [insertForm, setInsertForm] = useState({
    word: '',
    phonetic: '',
    translation: '',
    example: '',
    example_cn: '',
  });
  const [insertQuickText, setInsertQuickText] = useState('');
  const [isInsertingWord, setIsInsertingWord] = useState(false);
  const [isEnrichingInsert, setIsEnrichingInsert] = useState(false);
  
  // Word editing state
  const [editingWord, setEditingWord] = useState(null);
  const [editForm, setEditForm] = useState({
    word: '',
    phonetic: '',
    translation: '',
    example: '',
    example_cn: '',
    mistake_count: 0,
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Filter only error-prone / mistake words state
  const [filterMistakesOnly, setFilterMistakesOnly] = useState(false);

  // Batch assign to calendar date state
  const [showBatchCalendarModal, setShowBatchCalendarModal] = useState(false);
  const [calendarTargetDate, setCalendarTargetDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isAssigningToCalendar, setIsAssigningToCalendar] = useState(false);

  // New list creation state
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');
  const [newListIsPublic, setNewListIsPublic] = useState(isAdmin ? 1 : 0);

  // List edit / rename / settings state
  const [editingList, setEditingList] = useState(null);
  const [listEditName, setListEditName] = useState('');
  const [listEditDesc, setListEditDesc] = useState('');
  const [listEditIsPublic, setListEditIsPublic] = useState(1);
  const [isSavingList, setIsSavingList] = useState(false);

  // Target list for batch adding
  const [batchTargetListId, setBatchTargetListId] = useState('');
  const [showBatchAssignModal, setShowBatchAssignModal] = useState(false);

  // Accent preference
  const accent = localStorage.getItem('preferred_accent') || 'us';

  // Tree state for hierarchical categories
  const [treeData, setTreeData] = useState([]);
  const [expandedFolderIds, setExpandedFolderIds] = useState(new Set([22, 23]));
  const [showAllWordsInFolder, setShowAllWordsInFolder] = useState(false);
  const [currentListInfo, setCurrentListInfo] = useState(null);
  const [currentListChildren, setCurrentListChildren] = useState([]);
  const [newListParentId, setNewListParentId] = useState('');
  const [isCategoryOpenMobile, setIsCategoryOpenMobile] = useState(false); // Mobile collapse toggle (default collapsed on narrow screens)

  // Overall Word Statistics (total, unassigned, mistake)
  const [wordStats, setWordStats] = useState({ total_count: 0, unassigned_count: 0, mistake_count: 0 });

  // Create Category Modal state
  const [showCreateCategoryModal, setShowCreateCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryParentId, setNewCategoryParentId] = useState('');
  const [newCategoryIsPublic, setNewCategoryIsPublic] = useState(isAdmin ? 1 : 0);

  // Move List Modal state
  const [movingList, setMovingList] = useState(null);
  const [moveTargetParentId, setMoveTargetParentId] = useState('');

  // Word Picker Modal state (for adding words from library into current list)
  const [showWordPickerModal, setShowWordPickerModal] = useState(false);
  const [pickerSourceId, setPickerSourceId] = useState('unassigned');
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerWords, setPickerWords] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSelectedIds, setPickerSelectedIds] = useState(new Set());
  const [pickerSubmitting, setPickerSubmitting] = useState(false);

  // Fetch word statistics
  const fetchWordStats = async () => {
    try {
      const stats = await api.getWordStats();
      setWordStats(stats);
    } catch (e) {
      console.error('Failed to load word stats:', e);
    }
  };

  // Fetch complete tree from backend
  const fetchTree = async () => {
    try {
      const tree = await api.getListsTree();
      setTreeData(tree);
      // Auto-expand any folders that contain lists or words
      setExpandedFolderIds(prev => {
        const next = new Set(prev);
        function autoExpand(nodes) {
          for (const n of nodes) {
            if (n.is_folder === 1 && (n.children?.length > 0 || n.total_word_count > 0)) {
              next.add(n.id);
            }
            if (n.children && n.children.length > 0) {
              autoExpand(n.children);
            }
          }
        }
        autoExpand(tree);
        return next;
      });
    } catch (e) {
      console.error('Failed to load tree:', e);
    }
  };

  useEffect(() => {
    fetchTree();
    fetchWordStats();
    fetchWords();
  }, [lists]);

  // Fetch words based on selected list, unassigned, all, or root
  const fetchWords = async () => {
    setLoadingWords(true);
    try {
      if (currentListId === 'unassigned') {
        const data = await api.getWords({ listId: 'unassigned', search: searchQuery });
        setWords(data.words || []);
        setCurrentListInfo({
          id: 'unassigned',
          name: '未归类单词',
          description: '暂未分配至任何词单的游离候选词汇，可批量勾选移入目标词单',
          is_folder: 0,
        });
        setCurrentListChildren([]);
      } else if (currentListId === 'all') {
        const data = await api.getWords({ listId: 'all', search: searchQuery });
        setWords(data.words || []);
        setCurrentListInfo({
          id: 'all',
          name: '全库所有单词',
          description: '总词库收录的全部词汇平铺视图',
          is_folder: 0,
        });
        setCurrentListChildren([]);
      } else if (currentListId) {
        const data = await api.getListWords(currentListId);
        setWords(data.words || []);
        setCurrentListInfo(data.list || null);
        setCurrentListChildren(data.children || []);
      } else {
        const data = await api.getWords({ search: searchQuery });
        setWords(data.words || []);
        setCurrentListInfo(null);
        setCurrentListChildren([]);
      }
    } catch (err) {
      console.error('Failed to load words:', err);
    } finally {
      setLoadingWords(false);
    }
  };

  useEffect(() => {
    fetchWords();
    fetchWordStats();
    setSelectedWordIds(new Set());
    setLastClickedIndex(null);
    setShowAllWordsInFolder(false);
  }, [currentListId, searchQuery]);

  // Helper to find ancestor path in tree for breadcrumbs
  const breadcrumbPath = useMemo(() => {
    if (!currentListId) return [];
    if (currentListId === 'unassigned') {
      return [{ id: 'unassigned', name: '未归类单词', is_folder: 0 }];
    }
    if (currentListId === 'all') {
      return [{ id: 'all', name: '全库所有单词', is_folder: 0 }];
    }
    if (!treeData.length) return [];
    function findPath(nodes, targetId) {
      for (const node of nodes) {
        if (node.id === Number(targetId)) {
          return [node];
        }
        if (node.children && node.children.length > 0) {
          const subPath = findPath(node.children, targetId);
          if (subPath.length > 0) {
            return [node, ...subPath];
          }
        }
      }
      return [];
    }
    return findPath(treeData, currentListId);
  }, [treeData, currentListId]);

  // Helper to get flattened folder options for dropdowns
  const allFolderOptions = useMemo(() => {
    function flattenFolders(nodes, depth = 0) {
      let options = [];
      for (const node of nodes) {
        if (node.is_folder === 1) {
          options.push({
            id: node.id,
            name: `${'　'.repeat(depth)}${depth > 0 ? '└ ' : '📁 '}${node.name}`,
            rawName: node.name,
            depth
          });
          if (node.children && node.children.length > 0) {
            options = options.concat(flattenFolders(node.children, depth + 1));
          }
        }
      }
      return options;
    }
    return flattenFolders(treeData);
  }, [treeData]);

  // Helper to get all leaf lists with breadcrumb path for batch assign
  const leafListOptions = useMemo(() => {
    function getLeaves(nodes, prefix = '') {
      let res = [];
      for (const n of nodes) {
        const currentPath = prefix ? `${prefix} / ${n.name}` : n.name;
        if (n.is_folder === 1) {
          if (n.children && n.children.length > 0) {
            res = res.concat(getLeaves(n.children, currentPath));
          }
        } else {
          res.push({
            id: n.id,
            name: n.name,
            pathName: prefix ? `${prefix} > ${n.name}` : n.name,
            word_count: n.word_count || 0
          });
        }
      }
      return res;
    }
    return getLeaves(treeData);
  }, [treeData]);

  // Helper to format source options for the word picker modal
  const pickerSourceOptions = useMemo(() => {
    function flatten(nodes, depth = 0) {
      let res = [];
      for (const n of nodes) {
        res.push({
          id: String(n.id),
          name: n.name,
          is_folder: n.is_folder,
          word_count: n.is_folder === 1 ? (n.total_word_count || 0) : (n.word_count || 0),
          indentName: `${'　'.repeat(depth)}${n.is_folder === 1 ? '📁 ' : '📄 '}${n.name}`
        });
        if (n.children && n.children.length > 0) {
          res = res.concat(flatten(n.children, depth + 1));
        }
      }
      return res;
    }
    return flatten(treeData);
  }, [treeData]);

  // Load words for picker source
  const loadPickerWords = async (sourceId) => {
    setPickerLoading(true);
    try {
      let data;
      if (sourceId === 'unassigned') {
        data = await api.getWords({ listId: 'unassigned' });
        setPickerWords(data.words || []);
      } else if (sourceId === 'all' || !sourceId) {
        data = await api.getWords({ listId: 'all' });
        setPickerWords(data.words || []);
      } else {
        data = await api.getListWords(sourceId);
        setPickerWords(data.words || []);
      }
    } catch (e) {
      console.error('Failed to load picker words:', e);
    } finally {
      setPickerLoading(false);
    }
  };

  // Set of word IDs already in current list
  const currentListWordIdSet = useMemo(() => new Set(words.map(w => w.id)), [words]);

  // Filtered words for word picker
  const filteredPickerWords = useMemo(() => {
    if (!pickerSearch.trim()) return pickerWords;
    const q = pickerSearch.trim().toLowerCase();
    return pickerWords.filter(w => 
      (w.word && w.word.toLowerCase().includes(q)) || 
      (w.translation && w.translation.toLowerCase().includes(q))
    );
  }, [pickerWords, pickerSearch]);

  // Open word picker modal from leaf list
  const handleOpenWordPicker = () => {
    const defaultSource = (wordStats.unassigned_count > 0) ? 'unassigned' : 'all';
    setPickerSourceId(defaultSource);
    setPickerSearch('');
    setPickerSelectedIds(new Set());
    setShowWordPickerModal(true);
    loadPickerWords(defaultSource);
  };

  // Confirm adding selected words into current list
  const handleConfirmAddWordsToList = async () => {
    if (pickerSelectedIds.size === 0 || !currentListInfo?.id) return;
    setPickerSubmitting(true);
    try {
      await api.batchAssignToList(Array.from(pickerSelectedIds), currentListInfo.id);
      setShowWordPickerModal(false);
      setPickerSelectedIds(new Set());
      await fetchWords();
      await fetchWordStats();
      await fetchTree();
      onRefreshLists?.();
    } catch (err) {
      alert(err.message || '添加失败');
    } finally {
      setPickerSubmitting(false);
    }
  };

  // Toggle folder expand/collapse
  const toggleExpandFolder = (folderId, e) => {
    if (e) e.stopPropagation();
    setExpandedFolderIds(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  // Reset page when list, search, mistake filter or pageSize changes
  useEffect(() => {
    setCurrentPage(1);
  }, [currentListId, searchQuery, filterMistakesOnly, pageSize]);

  // Mistake count statistics for current scope
  const totalMistakeWordsCount = useMemo(() => {
    return words.filter(w => (w.mistake_count || 0) > 0).length;
  }, [words]);

  // Filtered words for client-side search and mistake filtering
  const filteredWords = useMemo(() => {
    let list = words;
    if (filterMistakesOnly) {
      list = list.filter(w => (w.mistake_count || 0) > 0);
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(w => w.word.toLowerCase().includes(q) || (w.translation && w.translation.toLowerCase().includes(q)));
  }, [words, searchQuery, filterMistakesOnly]);

  // Adjust mistake count for a word
  const handleAdjustMistake = async (wordId, delta, e) => {
    if (e) e.stopPropagation();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    try {
      const res = await api.setWordMistake(wordId, { delta });
      setWords(prev => prev.map(w => w.id === wordId ? { ...w, mistake_count: res.word.mistake_count } : w));
    } catch (err) {
      console.error('Failed to adjust mistake count:', err);
    }
  };

  // Reset / remove mistake count for a word (去除错误次数 / 归零)
  const handleResetMistake = async (wordId, e) => {
    if (e) e.stopPropagation();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    try {
      await api.resetWordMistake(wordId);
      setWords(prev => prev.map(w => w.id === wordId ? { ...w, mistake_count: 0 } : w));
    } catch (err) {
      console.error('Failed to reset mistake count:', err);
    }
  };

  // Batch clear/remove mistake counts for selected words
  const handleBatchResetMistakes = async () => {
    if (selectedWordIds.size === 0) return;
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!window.confirm(`确定将选中的 ${selectedWordIds.size} 个单词的错误次数清零去除吗？`)) return;
    try {
      await api.batchSetWordMistake(Array.from(selectedWordIds), 'reset');
      setWords(prev => prev.map(w => selectedWordIds.has(w.id) ? { ...w, mistake_count: 0 } : w));
    } catch (err) {
      alert(err.message || '批量去除错误次数失败');
    }
  };

  // Batch mark selected words as mistake (+1)
  const handleBatchIncrementMistakes = async () => {
    if (selectedWordIds.size === 0) return;
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    try {
      await api.batchSetWordMistake(Array.from(selectedWordIds), 'increment');
      setWords(prev => prev.map(w => selectedWordIds.has(w.id) ? { ...w, mistake_count: (w.mistake_count || 0) + 1 } : w));
    } catch (err) {
      alert(err.message || '批量标记易错失败');
    }
  };

  // Pagination calculations
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(filteredWords.length / pageSize)) : 1;
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = pageSize > 0 ? (validCurrentPage - 1) * pageSize : 0;
  const displayedWords = useMemo(() => {
    if (pageSize <= 0) return filteredWords;
    return filteredWords.slice(startIndex, startIndex + pageSize);
  }, [filteredWords, startIndex, pageSize]);

  // Selection states & helpers
  const isAllCurrentPageSelected = displayedWords.length > 0 && displayedWords.every(w => selectedWordIds.has(w.id));
  const isAllTotalSelected = filteredWords.length > 0 && selectedWordIds.size === filteredWords.length;

  const toggleSelectCurrentPage = () => {
    const next = new Set(selectedWordIds);
    if (isAllCurrentPageSelected) {
      displayedWords.forEach(w => next.delete(w.id));
    } else {
      displayedWords.forEach(w => next.add(w.id));
    }
    setSelectedWordIds(next);
    setLastClickedIndex(null);
  };

  const toggleSelectAllTotal = () => {
    if (isAllTotalSelected) {
      setSelectedWordIds(new Set());
    } else {
      setSelectedWordIds(new Set(filteredWords.map(w => w.id)));
    }
    setLastClickedIndex(null);
  };

  // Handle create list (unit or regular list)
  const handleCreateList = async (e) => {
    e.preventDefault();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!newListName.trim()) return;

    const parentId = newListParentId 
      ? Number(newListParentId) 
      : (currentListInfo?.is_folder === 1 ? currentListInfo.id : (currentListInfo?.parent_id || null));

    if (!isAdmin && newListIsPublic === 1) {
      openSubmitAudit({
        type: 'list_create',
        targetName: newListName.trim(),
        payload: {
          name: newListName.trim(),
          description: newListDesc.trim(),
          is_folder: 0,
          parent_id: parentId,
          is_public: 1
        },
        title: '建议新建公共词单'
      });
      setNewListName('');
      setNewListDesc('');
      setNewListParentId('');
      setIsCreatingList(false);
      return;
    }

    try {
      const created = await api.createList({
        name: newListName.trim(),
        description: newListDesc.trim(),
        is_folder: 0,
        parent_id: parentId,
        is_public: newListIsPublic
      });
      setNewListName('');
      setNewListDesc('');
      setNewListParentId('');
      setIsCreatingList(false);
      onRefreshLists?.();
      fetchTree();
      onSelectList(created.id);
    } catch (err) {
      alert(err.message);
    }
  };

  // Handle create category / folder (e.g. 学段, 册次)
  const handleCreateCategory = async (e) => {
    e.preventDefault();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!newCategoryName.trim()) return;

    if (!isAdmin && newCategoryIsPublic === 1) {
      openSubmitAudit({
        type: 'list_create',
        targetName: newCategoryName.trim(),
        payload: {
          name: newCategoryName.trim(),
          is_folder: 1,
          parent_id: newCategoryParentId ? Number(newCategoryParentId) : null,
          is_public: 1
        },
        title: '建议新建公共分类'
      });
      setNewCategoryName('');
      setNewCategoryParentId('');
      setShowCreateCategoryModal(false);
      return;
    }

    try {
      const created = await api.createList({
        name: newCategoryName.trim(),
        is_folder: 1,
        parent_id: newCategoryParentId ? Number(newCategoryParentId) : null,
        is_public: newCategoryIsPublic
      });
      setNewCategoryName('');
      setNewCategoryParentId('');
      setShowCreateCategoryModal(false);
      onRefreshLists?.();
      fetchTree();
      onSelectList(created.id);
    } catch (err) {
      alert(err.message || '创建分类失败');
    }
  };

  // Handle move list or folder to a target parent folder
  const handleMoveListConfirm = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!movingList) return;
    try {
      await api.moveList(movingList.id, moveTargetParentId ? Number(moveTargetParentId) : null);
      setMovingList(null);
      setMoveTargetParentId('');
      onRefreshLists?.();
      fetchTree();
    } catch (err) {
      alert(err.message || '移动失败');
    }
  };

  // Open list settings / rename modal
  const handleOpenListSettings = (list, e) => {
    if (e) e.stopPropagation();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    setEditingList(list);
    setListEditName(list.name || '');
    setListEditDesc(list.description || '');
    setListEditIsPublic(isPublicItem(list) ? 1 : 0);
  };

  // Save list rename / description / public status
  const handleSaveListSettings = async (e) => {
    if (e) e.preventDefault();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!editingList || !listEditName.trim()) return;

    if (!isAdmin && (isPublicItem(editingList) || listEditIsPublic === 1)) {
      openSubmitAudit({
        type: 'list_update',
        targetId: editingList.id,
        targetName: editingList.name,
        payload: {
          name: listEditName.trim(),
          description: listEditDesc.trim(),
          is_public: 1
        },
        title: isPublicItem(editingList) ? '建议修改公共词单' : '申请将私有词单发布为公共词单'
      });
      setEditingList(null);
      return;
    }

    setIsSavingList(true);
    try {
      await api.updateList(editingList.id, {
        name: listEditName.trim(),
        description: listEditDesc.trim(),
        is_public: listEditIsPublic
      });
      setEditingList(null);
      onRefreshLists?.();
      fetchTree();
    } catch (err) {
      alert(err.message || '修改失败');
    } finally {
      setIsSavingList(false);
    }
  };

  // Helper to find any node in treeData by id
  const findNodeInTree = (nodes, targetId) => {
    for (const node of nodes) {
      if (node.id === Number(targetId)) return node;
      if (node.children && node.children.length > 0) {
        const found = findNodeInTree(node.children, targetId);
        if (found) return found;
      }
    }
    return null;
  };

  // Handle delete list or folder
  const handleDeleteList = async (target, e) => {
    if (e) e.stopPropagation();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!target) return;

    let listObj = typeof target === 'object' ? target : null;
    if (!listObj) {
      const targetId = Number(target);
      listObj = findNodeInTree(treeData, targetId) || 
                lists.find(l => l.id === targetId) || 
                (currentListInfo?.id === targetId ? currentListInfo : null) || 
                { id: targetId, name: `词单 #${targetId}`, is_folder: 0 };
    }

    if (!isAdmin && isPublicItem(listObj)) {
      openSubmitAudit({
        type: 'list_delete',
        targetId: listObj.id,
        targetName: listObj.name,
        payload: listObj,
        title: '申请删除公共词单'
      });
      return;
    }

    const isFolder = listObj.is_folder === 1;
    const msg = isFolder 
      ? `确定要删除分类【${listObj.name}】及其所有子项目吗？（词汇仍保留在总词库中）` 
      : `确定要删除词单【${listObj.name}】吗？（词汇仍保留在总词库中）`;
    if (!window.confirm(msg)) return;
    try {
      await api.deleteList(listObj.id);
      if (currentListId === listObj.id) {
        onSelectList('');
      }
      onRefreshLists?.();
      fetchTree();
    } catch (err) {
      alert(err.message || '删除失败');
    }
  };

  // Open Insert Modal
  const handleOpenInsert = (afterWord = null, beforeWord = null) => {
    setInsertModalData({ afterWord, beforeWord });
    setInsertForm({
      word: '',
      phonetic: '',
      translation: '',
      example: '',
      example_cn: '',
    });
    setInsertQuickText('');
  };

  // Quick parse for insert modal
  const handleQuickParseInsert = (text) => {
    setInsertQuickText(text);
    if (!text.trim()) return;

    let trimmed = text.trim();
    trimmed = trimmed.replace(/^[\s\(\[\d\.\、\)\-\*\•]+(?=[a-zA-Z])/, '').trim();

    let word = '';
    let phonetic = '';
    let translation = '';
    let example = '';

    const phoneticMatch = trimmed.match(/^([a-zA-Z\s\-'\.]+?)\s*(?:[\/\[\\\(]([^\/\]\\\)]+)[\/\]\\\)])\s*(.*)$/);
    if (phoneticMatch) {
      word = phoneticMatch[1].trim();
      phonetic = '/' + phoneticMatch[2].trim().replace(/^\/+|\/+$/g, '') + '/';
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

    const exSplit = translation.match(/^(.*?)(?:\s*(?:\||例句[：:]|e\.g\.)\s*)([a-zA-Z].*)$/i);
    if (exSplit) {
      translation = exSplit[1].trim();
      example = exSplit[2].trim();
    }

    setInsertForm(prev => ({
      ...prev,
      word: word || prev.word,
      phonetic: phonetic || prev.phonetic,
      translation: translation || prev.translation,
      example: example || prev.example,
    }));
  };

  // AI Enrich for insert modal
  const handleEnrichInsert = async () => {
    if (!insertForm.word.trim()) return;
    setIsEnrichingInsert(true);
    try {
      const res = await api.enrichWords([{ word: insertForm.word.trim(), translation: insertForm.translation }]);
      if (res.words && res.words[0]) {
        const w = res.words[0];
        setInsertForm(prev => ({
          ...prev,
          phonetic: prev.phonetic || w.phonetic || '',
          translation: prev.translation || w.translation || '',
          example: w.example || prev.example || '',
          example_cn: w.example_cn || prev.example_cn || '',
        }));
      }
    } catch (err) {
      alert(err.message || 'AI 补全失败');
    } finally {
      setIsEnrichingInsert(false);
    }
  };

  // Save insert word
  const handleSaveInsert = async (e) => {
    e?.preventDefault();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!insertForm.word.trim()) return;

    if (!isAdmin && isPublicItem(currentListInfo)) {
      openSubmitAudit({
        type: 'word_insert',
        targetId: currentListInfo?.id || null,
        targetName: currentListInfo?.name || '公共词库',
        payload: {
          word: insertForm.word.trim(),
          phonetic: insertForm.phonetic.trim(),
          translation: insertForm.translation.trim(),
          example: insertForm.example.trim(),
          example_cn: insertForm.example_cn.trim(),
          list_id: currentListInfo?.id || null,
        },
        title: '建议新增公共词条'
      });
      setInsertModalData(null);
      return;
    }

    setIsInsertingWord(true);
    try {
      await api.insertWord({
        word: insertForm.word.trim(),
        phonetic: insertForm.phonetic.trim(),
        translation: insertForm.translation.trim(),
        example: insertForm.example.trim(),
        example_cn: insertForm.example_cn.trim(),
        afterWordId: insertModalData?.afterWord?.id || null,
        beforeWordId: insertModalData?.beforeWord?.id || null,
        listId: currentListId ? Number(currentListId) : null,
      });
      setInsertModalData(null);
      fetchWords();
      onRefreshLists?.();
    } catch (err) {
      alert(err.message || '插入词条失败');
    } finally {
      setIsInsertingWord(false);
    }
  };

  // Reorder word (Move Up / Down)
  const handleReorder = async (wordId, direction, e) => {
    e?.stopPropagation();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    const targetWord = words.find(w => w.id === wordId);
    if (!isAdmin && isPublicItem(targetWord)) {
      alert('公共词单词条顺序由管理员维护。');
      return;
    }
    try {
      await api.reorderWord(wordId, direction, currentListId ? Number(currentListId) : null);
      fetchWords();
    } catch (err) {
      console.error(err);
    }
  };

  // Range Selection: Support normal click toggle or Shift+Click for A-to-B continuous selection
  const handleWordClick = (id, localIndex, e) => {
    const globalIndex = startIndex + localIndex;
    if (e?.shiftKey && lastClickedIndex !== null) {
      const start = Math.min(lastClickedIndex, globalIndex);
      const end = Math.max(lastClickedIndex, globalIndex);
      const next = new Set(selectedWordIds);
      for (let i = start; i <= end; i++) {
        if (filteredWords[i]) {
          next.add(filteredWords[i].id);
        }
      }
      setSelectedWordIds(next);
    } else {
      const next = new Set(selectedWordIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      setSelectedWordIds(next);
      setLastClickedIndex(globalIndex);
    }
  };

  // Batch action: Assign to list
  const handleBatchAssign = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!batchTargetListId || selectedWordIds.size === 0) return;
    try {
      const sortedIds = filteredWords.filter(w => selectedWordIds.has(w.id)).map(w => w.id);
      const inFilteredSet = new Set(sortedIds);
      const remaining = Array.from(selectedWordIds).filter(id => !inFilteredSet.has(id));
      const finalIds = [...sortedIds, ...remaining];

      await api.batchAssignToList(finalIds, Number(batchTargetListId));
      setShowBatchAssignModal(false);
      onRefreshLists?.();
      alert(`已成功将 ${selectedWordIds.size} 个单词添加至目标词单！`);
    } catch (err) {
      alert(err.message);
    }
  };

  // Batch action: Assign to calendar date
  const handleBatchAssignToCalendar = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!calendarTargetDate || selectedWordIds.size === 0) return;
    setIsAssigningToCalendar(true);
    try {
      const sortedIds = filteredWords.filter(w => selectedWordIds.has(w.id)).map(w => w.id);
      const inFilteredSet = new Set(sortedIds);
      const remaining = Array.from(selectedWordIds).filter(id => !inFilteredSet.has(id));
      const finalIds = [...sortedIds, ...remaining];

      await api.addWordsToDailyPlan(calendarTargetDate, finalIds);
      setShowBatchCalendarModal(false);
      alert(`已成功将 ${selectedWordIds.size} 个单词加入 ${calendarTargetDate} 的听写日程！`);
    } catch (err) {
      alert(err.message || '加入日程失败');
    } finally {
      setIsAssigningToCalendar(false);
    }
  };

  // Batch action: Delete selected words
  const handleBatchDelete = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    const count = selectedWordIds.size;
    if (count === 0) return;

    if (!isAdmin && isPublicItem(currentListInfo)) {
      alert('公共词库词条不可批量删除。如需提出修改建议，请点击单个词条的修改/删除按钮提交管理员审核。');
      return;
    }

    const isRegularList = Boolean(currentListId && currentListId !== 'unassigned' && currentListId !== 'all');
    let confirmMsg = '';
    if (isRegularList) {
      confirmMsg = `确定要将选中的 ${count} 个单词从当前词单移除吗？（词汇仍保留在总词库中）`;
    } else if (currentListId === 'unassigned') {
      confirmMsg = `确定要彻底删除选中的 ${count} 个未归类单词吗？（此操作将从词库中永久删除且无法撤销）`;
    } else {
      confirmMsg = `确定要从总词库中彻底删除选中的 ${count} 个单词吗？（此操作将永久删除且无法撤销）`;
    }

    if (!window.confirm(confirmMsg)) return;

    try {
      await api.batchDeleteWords(Array.from(selectedWordIds), isRegularList ? currentListId : null);
      setSelectedWordIds(new Set());
      setLastClickedIndex(null);
      fetchWords();
      fetchWordStats();
      fetchTree();
      onRefreshLists?.();
    } catch (err) {
      alert(err.message || '批量删除失败');
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (item, e) => {
    e?.stopPropagation();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    setEditingWord(item);
    setEditForm({
      word: item.word || '',
      phonetic: item.phonetic || '',
      translation: item.translation || '',
      example: item.example || '',
      example_cn: item.example_cn || '',
      mistake_count: item.mistake_count || 0,
    });
  };

  // Save Word Edits
  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!editingWord || !editForm.word.trim()) return;

    if (!isAdmin && isPublicItem(editingWord)) {
      openSubmitAudit({
        type: 'word_update',
        targetId: editingWord.id,
        targetName: editingWord.word,
        payload: {
          ...editForm,
          id: editingWord.id,
        },
        title: '建议修改公共词条'
      });
      setEditingWord(null);
      return;
    }

    setIsSavingEdit(true);
    try {
      await api.updateWord(editingWord.id, editForm);
      setEditingWord(null);
      fetchWords();
      onRefreshLists?.();
    } catch (err) {
      alert(err.message || '修改失败');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Publish a private word to become a public word
  const handlePublishWord = async (item, e) => {
    e?.stopPropagation?.();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }

    if (isAdmin) {
      if (!window.confirm(`确定直接将独有私词【${item.word}】发布至全员公共词库吗？`)) return;
      try {
        const res = await api.submitWordToPublic(item.id);
        alert(res.message || `已成功将【${item.word}】发布至公共词库！`);
        fetchWords();
        fetchWordStats();
        onRefreshLists?.();
      } catch (err) {
        alert(err.message);
      }
      return;
    }

    // Normal user: open audit submit modal
    openSubmitAudit({
      type: 'word_publish',
      targetId: item.id,
      targetName: item.word,
      payload: {
        word_id: item.id,
        word: item.word,
        phonetic: item.phonetic || '',
        translation: item.translation || '',
        example: item.example || '',
        example_cn: item.example_cn || '',
      },
      title: '申请将独有私词加入公共词库'
    });
  };

  // Batch publish selected private words
  const handleBatchPublishPrivateWords = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }

    const privateSelectedWords = words.filter(w => selectedWordIds.has(w.id) && !isPublicItem(w));
    if (privateSelectedWords.length === 0) {
      alert('所选单词中没有独有的私有词条（均为公共词条）');
      return;
    }

    const privateIds = privateSelectedWords.map(w => w.id);

    if (isAdmin) {
      if (!window.confirm(`确定直接将选中的 ${privateIds.length} 个独有私词发布至全员公共词库吗？`)) return;
      try {
        const res = await api.batchSubmitWordsToPublic(privateIds);
        alert(res.message || '已成功发布至全员公共词库！');
        fetchWords();
        fetchWordStats();
        onRefreshLists?.();
        setSelectedWordIds(new Set());
      } catch (err) {
        alert(err.message);
      }
      return;
    }

    if (!window.confirm(`确定要将选中的 ${privateIds.length} 个独有私词申请加入公共词库吗？\n（将提交管理员审核，每人待审核条目最多 10 条）`)) return;

    try {
      const res = await api.batchSubmitWordsToPublic(privateIds);
      alert(res.message || '申请已提交，请等待管理员审核！');
      fetchWords();
      setSelectedWordIds(new Set());
    } catch (err) {
      alert(err.message);
    }
  };

  // Delete word from current view
  const handleDeleteWord = async (wordId, e) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }

    const targetWord = words.find(w => w.id === wordId);
    const isTargetPublic = isPublicItem(targetWord);
    const isCurrentListPublic = isPublicItem(currentListInfo);
    const isRegularList = Boolean(currentListId && currentListId !== 'unassigned' && currentListId !== 'all');

    if (!isAdmin && (isTargetPublic || isCurrentListPublic)) {
      openSubmitAudit({
        type: 'word_delete',
        targetId: wordId,
        targetName: targetWord?.word || '',
        payload: {
          ...(targetWord || {}),
          list_id: isRegularList ? currentListId : null,
          list_name: currentListInfo?.name || null,
        },
        title: isRegularList && !isTargetPublic ? '申请从公共词单移除词条' : '申请删除公共词条'
      });
      return;
    }

    if (isRegularList) {
      if (!window.confirm('确定从当前词单移除此单词吗？（单词仍保留在总词库中）')) return;
      try {
        await api.removeWordFromList(currentListId, wordId);
        fetchWords();
        fetchWordStats();
        fetchTree();
        onRefreshLists?.();
      } catch (err) {
        alert(err.message);
      }
    } else {
      const msg = currentListId === 'unassigned'
        ? '确定要彻底删除该未归类单词吗？（此操作将从词库中永久删除且无法撤销）'
        : '确定要从总词库中彻底删除此单词吗？（此操作将永久删除且无法撤销）';
      if (!window.confirm(msg)) return;
      try {
        await api.deleteWord(wordId);
        fetchWords();
        fetchWordStats();
        fetchTree();
        onRefreshLists?.();
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const selectedWordsList = words.filter(w => selectedWordIds.has(w.id));
  const currentListObj = lists.find(l => l.id === currentListId);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      {/* Top Action Header */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6 pb-4 sm:pb-6 border-b border-slate-200">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2 sm:gap-2.5">
            <Layers className="w-6 h-6 sm:w-7 sm:h-7 text-indigo-600 shrink-0" />
            <span>词库与词单管理</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            自由勾选单词组建任务，或点击词单直接开启顺序听写与卡片记忆。
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 w-full sm:w-auto">
          <button
            onClick={() => onOpenImport('text')}
            className="flex-1 sm:flex-initial px-3 sm:px-4 py-2 bg-white border border-slate-300 hover:border-indigo-400 hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-xs sm:text-sm shadow-xs flex items-center justify-center gap-1.5 transition-all"
          >
            <span>📝 文本导入</span>
          </button>
          <button
            onClick={() => onOpenImport('photo')}
            className="flex-1 sm:flex-initial px-3 sm:px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white font-semibold rounded-xl text-xs sm:text-sm shadow-md shadow-indigo-200 flex items-center justify-center gap-1.5 transition-all"
          >
            <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
            <span className="truncate">📷 AI 拍照导入</span>
          </button>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Left Column: Hierarchical Category Tree (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white rounded-2xl p-3.5 sm:p-4 shadow-sm border border-slate-200">
            {/* Header with Title, Mobile Toggle, and Action Buttons */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div 
                onClick={() => setIsCategoryOpenMobile(prev => !prev)}
                className="flex items-center gap-1.5 cursor-pointer lg:cursor-default select-none py-0.5"
                title="窄屏下点击展开或折叠目录"
              >
                <Folder className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="font-bold text-slate-800 text-sm">分层词库目录</span>
                {/* Mobile collapse indicator icon */}
                <span className="lg:hidden text-slate-400 p-0.5">
                  {isCategoryOpenMobile ? (
                    <ChevronUp className="w-4 h-4 text-indigo-600" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setNewCategoryParentId(currentListInfo?.is_folder === 1 ? String(currentListInfo.id) : '');
                    setShowCreateCategoryModal(true);
                  }}
                  className="text-[11px] px-2 py-1 bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 font-semibold rounded-lg transition-colors flex items-center gap-0.5 cursor-pointer"
                  title="新建学段或册次目录（如：初中、8年级上册等）"
                >
                  <FolderPlus className="w-3 h-3" />
                  <span>+ 分类</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewListParentId(currentListInfo?.is_folder === 1 ? String(currentListInfo.id) : (currentListInfo?.parent_id ? String(currentListInfo.parent_id) : ''));
                    setIsCreatingList(true);
                  }}
                  className="text-[11px] px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg transition-colors flex items-center gap-0.5 cursor-pointer"
                  title="在选中的目录下新建单词单（如：Unit 1）"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ 词单</span>
                </button>
              </div>
            </div>

            {/* Tree Body: Always visible on lg screens; collapsable on mobile/narrow screens */}
            <div className={`pt-3 ${isCategoryOpenMobile ? 'block' : 'hidden lg:block'}`}>
              {/* Create list inline form */}
              {isCreatingList && (
                <form onSubmit={handleCreateList} className="p-3 bg-slate-50 border border-slate-200 rounded-xl mb-3 space-y-2 animate-fade-in text-xs">
                <div className="flex items-center justify-between font-bold text-slate-700">
                  <span>新建单词单 / 单元</span>
                  <button type="button" onClick={() => setIsCreatingList(false)} className="text-slate-400 hover:text-slate-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 font-medium block mb-0.5">归属目录 / 册次：</label>
                  <select
                    value={newListParentId}
                    onChange={(e) => setNewListParentId(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-xs focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">根目录 (顶级未分类)</option>
                    {allFolderOptions.map(opt => (
                      <option key={opt.id} value={opt.id}>{opt.name}</option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  placeholder="词单名称，如：Unit 1、第1章核心词"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
                <input
                  type="text"
                  placeholder="简要备注 (可选)"
                  value={newListDesc}
                  onChange={(e) => setNewListDesc(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
                <div className="flex items-center gap-3 pt-0.5 text-[11px]">
                  <span className="text-slate-500 font-medium">属性：</span>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="inline_list_public"
                      checked={newListIsPublic === 0}
                      onChange={() => setNewListIsPublic(0)}
                      className="text-indigo-600"
                    />
                    <span className="font-semibold text-blue-700">🔵 私有</span>
                  </label>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="inline_list_public"
                      checked={newListIsPublic === 1}
                      onChange={() => setNewListIsPublic(1)}
                      className="text-indigo-600"
                    />
                    <span className="font-semibold text-emerald-700">🟢 公用 {!isAdmin && '(需审核)'}</span>
                  </label>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsCreatingList(false)}
                    className="px-2.5 py-1 text-slate-500 hover:text-slate-700"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={!newListName.trim()}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg disabled:opacity-50 shadow-2xs cursor-pointer"
                  >
                    {!isAdmin && newListIsPublic === 1 ? '提交申请' : '创建词单'}
                  </button>
                </div>
              </form>
            )}

            {/* Total Library Row */}
            <div
              onClick={() => {
                onSelectList('');
                setShowAllWordsInFolder(false);
              }}
              className={`p-2.5 rounded-xl cursor-pointer flex items-center justify-between transition-all mb-2.5 ${
                !currentListId
                  ? 'bg-indigo-600 text-white font-bold shadow-sm'
                  : 'hover:bg-slate-50 text-slate-700 font-medium'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">📚</span>
                <div>
                  <div className="text-xs sm:text-sm font-bold leading-tight">总词库中心 (全部)</div>
                  <div className={`text-[10px] ${!currentListId ? 'text-indigo-100' : 'text-slate-400'}`}>
                    包含所有学段与年级词汇
                  </div>
                </div>
              </div>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                !currentListId ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                全库
              </span>
            </div>

            {/* Tree Navigation Container */}
            <div className="space-y-1 max-h-[65vh] overflow-y-auto pr-1">
              {treeData.map(node => {
                const isFolder = node.is_folder === 1;
                const isExpanded = expandedFolderIds.has(node.id);
                const isSelected = currentListId === node.id;
                const hasChildren = node.children && node.children.length > 0;

                return (
                  <div key={node.id} className="select-none text-xs">
                    <div
                      onClick={() => {
                        onSelectList(node.id);
                        setShowAllWordsInFolder(false);
                      }}
                      className={`group flex items-center justify-between py-1.5 px-2 rounded-xl cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-indigo-50 border border-indigo-200 text-indigo-950 font-bold shadow-2xs'
                          : 'hover:bg-slate-100/70 text-slate-700 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0 truncate">
                        {isFolder ? (
                          <button
                            type="button"
                            onClick={(e) => toggleExpandFolder(node.id, e)}
                            className="p-0.5 text-slate-400 hover:text-indigo-600 rounded hover:bg-slate-200/60 shrink-0"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                            )}
                          </button>
                        ) : (
                          <span className="w-3.5 h-3.5 flex items-center justify-center text-slate-300 shrink-0 text-xs">
                            •
                          </span>
                        )}

                        <span className="shrink-0 text-sm">
                          {isFolder ? (isExpanded ? '📂' : '📁') : '📄'}
                        </span>

                        <span className="truncate font-medium">
                          {node.name}
                        </span>
                        {isPublicItem(node) ? (
                          <span className="text-[9px] px-1 py-0.2 rounded font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">公</span>
                        ) : (
                          <span className="text-[9px] px-1 py-0.2 rounded font-semibold bg-blue-50 text-blue-700 border border-blue-200 shrink-0">私</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0 ml-1">
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                          isSelected ? 'bg-indigo-200 text-indigo-900 font-bold' : 'bg-slate-100 text-slate-400'
                        }`}>
                          {isFolder ? (node.total_word_count || 0) : (node.word_count || 0)}
                        </span>

                        {/* Quick action buttons on hover */}
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                          {isFolder ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setNewListParentId(String(node.id));
                                setIsCreatingList(true);
                              }}
                              className="p-1 text-slate-400 hover:text-indigo-600 rounded hover:bg-slate-200"
                              title="在此目录下新建词单"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMovingList(node);
                                setMoveTargetParentId(node.parent_id ? String(node.parent_id) : '');
                              }}
                              className="p-1 text-slate-400 hover:text-indigo-600 rounded hover:bg-slate-200"
                              title="移动到分类"
                            >
                              <Move className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleOpenListSettings(node, e)}
                            className="p-1 text-slate-400 hover:text-indigo-600 rounded hover:bg-slate-200"
                            title="重命名/修改备注"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteList(node, e)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-200"
                            title="删除"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Level 2 children */}
                    {isFolder && isExpanded && hasChildren && (
                      <div className="border-l-2 border-slate-200/80 ml-3.5 pl-2.5 space-y-1 my-1">
                        {node.children.map(subNode => {
                          const isSubFolder = subNode.is_folder === 1;
                          const isSubExpanded = expandedFolderIds.has(subNode.id);
                          const isSubSelected = currentListId === subNode.id;
                          const hasSubChildren = subNode.children && subNode.children.length > 0;

                          return (
                            <div key={subNode.id}>
                              <div
                                onClick={() => {
                                  onSelectList(subNode.id);
                                  setShowAllWordsInFolder(false);
                                }}
                                className={`group flex items-center justify-between py-1 px-1.5 rounded-lg cursor-pointer transition-all ${
                                  isSubSelected
                                    ? 'bg-indigo-50 border border-indigo-200 text-indigo-950 font-bold'
                                    : 'hover:bg-slate-100/70 text-slate-700'
                                }`}
                              >
                                <div className="flex items-center gap-1.5 min-w-0 truncate">
                                  {isSubFolder ? (
                                    <button
                                      type="button"
                                      onClick={(e) => toggleExpandFolder(subNode.id, e)}
                                      className="p-0.5 text-slate-400 hover:text-indigo-600 rounded shrink-0"
                                    >
                                      {isSubExpanded ? (
                                        <ChevronDown className="w-3 h-3 text-slate-600" />
                                      ) : (
                                        <ChevronRight className="w-3 h-3 text-slate-400" />
                                      )}
                                    </button>
                                  ) : (
                                    <span className="w-3 h-3 flex items-center justify-center text-slate-300 shrink-0 text-xs">•</span>
                                  )}

                                  <span className="shrink-0 text-xs">
                                    {isSubFolder ? (isSubExpanded ? '📂' : '📁') : '📄'}
                                  </span>

                                  <span className="truncate font-medium text-xs">
                                    {subNode.name}
                                  </span>
                                  {isPublicItem(subNode) ? (
                                    <span className="text-[9px] px-1 py-0.2 rounded font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">公</span>
                                  ) : (
                                    <span className="text-[9px] px-1 py-0.2 rounded font-semibold bg-blue-50 text-blue-700 border border-blue-200 shrink-0">私</span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  <span className="text-[10px] px-1 py-0.2 rounded-full font-mono text-slate-400 bg-slate-100">
                                    {isSubFolder ? (subNode.total_word_count || 0) : (subNode.word_count || 0)}
                                  </span>

                                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                                    {isSubFolder ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setNewListParentId(String(subNode.id));
                                          setIsCreatingList(true);
                                        }}
                                        className="p-1 text-slate-400 hover:text-indigo-600 rounded hover:bg-slate-200"
                                        title="在此册次下新建单元"
                                      >
                                        <Plus className="w-3 h-3" />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setMovingList(subNode);
                                          setMoveTargetParentId(subNode.parent_id ? String(subNode.parent_id) : '');
                                        }}
                                        className="p-1 text-slate-400 hover:text-indigo-600 rounded hover:bg-slate-200"
                                        title="移动到分类"
                                      >
                                        <Move className="w-3 h-3" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={(e) => handleOpenListSettings(subNode, e)}
                                      className="p-1 text-slate-400 hover:text-indigo-600 rounded hover:bg-slate-200"
                                      title="重命名/备注"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => handleDeleteList(subNode, e)}
                                      className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-200"
                                      title="删除"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {/* Level 3 units */}
                              {isSubFolder && isSubExpanded && hasSubChildren && (
                                <div className="border-l-2 border-indigo-100 ml-3 pl-2 space-y-0.5 my-1">
                                  {subNode.children.map(unit => {
                                    const isUnitSelected = currentListId === unit.id;
                                    return (
                                      <div
                                        key={unit.id}
                                        onClick={() => {
                                          onSelectList(unit.id);
                                          setShowAllWordsInFolder(false);
                                        }}
                                        className={`group flex items-center justify-between py-1 px-1.5 rounded-lg cursor-pointer transition-all ${
                                          isUnitSelected
                                            ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                                            : 'hover:bg-slate-100 text-slate-700'
                                        }`}
                                      >
                                        <div className="flex items-center gap-1 min-w-0 truncate">
                                          <span className="text-[11px] shrink-0">📄</span>
                                          <span className="truncate text-xs">{unit.name}</span>
                                          {isPublicItem(unit) ? (
                                            <span className={`text-[9px] px-1 py-0.2 rounded font-semibold ${isUnitSelected ? 'bg-emerald-400/30 text-white' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'} shrink-0`}>公</span>
                                          ) : (
                                            <span className={`text-[9px] px-1 py-0.2 rounded font-semibold ${isUnitSelected ? 'bg-blue-400/30 text-white' : 'bg-blue-50 text-blue-700 border border-blue-200'} shrink-0`}>私</span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                          <span className={`text-[10px] px-1 py-0.2 rounded-full font-mono ${
                                            isUnitSelected ? 'bg-indigo-500 text-white' : 'text-slate-400 bg-slate-100'
                                          }`}>
                                            {unit.word_count || 0}
                                          </span>
                                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setMovingList(unit);
                                                setMoveTargetParentId(unit.parent_id ? String(unit.parent_id) : '');
                                              }}
                                              className="p-0.5 text-slate-400 hover:text-indigo-600 rounded"
                                              title="移动到分类"
                                            >
                                              <Move className="w-3 h-3" />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => handleOpenListSettings(unit, e)}
                                              className="p-0.5 text-slate-400 hover:text-indigo-600 rounded"
                                              title="重命名/备注"
                                            >
                                              <Pencil className="w-3 h-3" />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => handleDeleteList(unit, e)}
                                              className="p-0.5 text-slate-400 hover:text-rose-600 rounded"
                                              title="删除"
                                            >
                                              <Trash2 className="w-3 h-3" />
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Divider & Special Sections: Unassigned words & All words */}
              <div className="border-t border-slate-200/80 my-2 pt-2 space-y-1">
                <div className="text-[10px] font-bold text-slate-400 px-2 py-0.5 uppercase tracking-wider">
                  词库专区
                </div>

                {/* Unassigned words item */}
                <div
                  onClick={() => {
                    onSelectList('unassigned');
                    setShowAllWordsInFolder(true);
                  }}
                  className={`group flex items-center justify-between py-1.5 px-2 rounded-xl cursor-pointer transition-all ${
                    currentListId === 'unassigned'
                      ? 'bg-indigo-600 text-white font-bold shadow-xs'
                      : 'hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm shrink-0">📦</span>
                    <span className="truncate text-xs">未归类单词</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                    currentListId === 'unassigned' ? 'bg-indigo-500 text-white' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {wordStats.unassigned_count || 0}
                  </span>
                </div>

                {/* All words flat view item */}
                <div
                  onClick={() => {
                    onSelectList('all');
                    setShowAllWordsInFolder(true);
                  }}
                  className={`group flex items-center justify-between py-1.5 px-2 rounded-xl cursor-pointer transition-all ${
                    currentListId === 'all'
                      ? 'bg-indigo-600 text-white font-bold shadow-xs'
                      : 'hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm shrink-0">📋</span>
                    <span className="truncate text-xs">全部单词 (平铺)</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                    currentListId === 'all' ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {wordStats.total_count || 0}
                  </span>
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>

        {/* Right Column: Master Word Library & Candidate Word Selection (8 cols) */}
        <div className="lg:col-span-8">
          {/* If viewing folder or root AND not expanding all words: show Folder Overview Dashboard */}
          {(!currentListId || currentListInfo?.is_folder === 1) && !showAllWordsInFolder ? (
            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-slate-200 space-y-5">
              {/* Integrated Breadcrumbs Bar */}
              <div className="flex items-center gap-1.5 text-xs text-slate-500 pb-3 border-b border-slate-100 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => {
                    onSelectList('');
                    setShowAllWordsInFolder(false);
                  }}
                  className={`flex items-center gap-1 font-semibold hover:text-indigo-600 transition-colors shrink-0 cursor-pointer ${
                    !currentListId ? 'text-indigo-600 font-bold' : 'text-slate-600'
                  }`}
                >
                  <span>📚 词库中心</span>
                </button>
                {breadcrumbPath.map((item, idx) => {
                  const isLast = idx === breadcrumbPath.length - 1;
                  return (
                    <React.Fragment key={item.id}>
                      <span className="text-slate-300 shrink-0">/</span>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectList(item.id);
                          setShowAllWordsInFolder(false);
                        }}
                        className={`hover:text-indigo-600 transition-colors truncate max-w-[160px] shrink-0 flex items-center gap-1 cursor-pointer ${
                          isLast ? 'text-indigo-600 font-bold' : 'text-slate-600 font-medium'
                        }`}
                      >
                        <span>{item.is_folder === 1 ? '📁' : '📄'}</span>
                        <span className="truncate">{item.name}</span>
                      </button>
                    </React.Fragment>
                  );
                })}
                {(currentListInfo?.is_folder === 1 || !currentListId) && showAllWordsInFolder && (
                  <>
                    <span className="text-slate-300 shrink-0">/</span>
                    <span className="text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-md shrink-0">
                      全量单词明细
                    </span>
                  </>
                )}
              </div>

              {/* Category Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-2xl">{currentListInfo ? '📁' : '📚'}</span>
                    <h3 className="text-lg sm:text-xl font-extrabold text-slate-900">
                      {currentListInfo ? currentListInfo.name : '学段词库中心'}
                    </h3>
                    <span className="text-xs px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 font-bold rounded-full">
                      {currentListInfo ? '分类目录' : '学段总览'}
                    </span>
                    {currentListInfo && (
                      <div className="flex items-center gap-1 ml-1">
                        <button
                          type="button"
                          onClick={() => handleOpenListSettings(currentListInfo)}
                          className="px-2 py-0.5 bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                          title="修改分类名称或备注"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>改名设置</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteList(currentListInfo, e)}
                          className="px-2 py-0.5 bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                          title="删除此分类"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>删除分类</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-2 flex-wrap">
                    <span>
                      包含 <strong className="text-slate-800 font-semibold">{currentListChildren.length || (currentListInfo ? 0 : treeData.length)}</strong> 个{currentListInfo?.parent_id ? '单元词单' : '年级/分类'}
                    </span>
                    <span>·</span>
                    <span>
                      累计汇聚 <strong className="text-indigo-600 font-bold">{words.length}</strong> 个单词
                    </span>
                    {currentListInfo?.description && (
                      <>
                        <span>·</span>
                        <span className="text-slate-400">{currentListInfo.description}</span>
                      </>
                    )}
                  </p>
                </div>

                {/* Header Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {words.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => onStartDictation(words, `${currentListInfo?.name || '全库'}汇聚词汇`)}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                        title="对该分类汇总的所有单词进行顺序听写"
                      >
                        <Headphones className="w-3.5 h-3.5" />
                        <span>听写全分类 ({words.length}词)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onStartMemory(words, `${currentListInfo?.name || '全库'}汇聚词汇`)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                        title="对该分类汇总的所有单词进行卡片记忆"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>记忆全分类</span>
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setNewListParentId(currentListInfo?.id ? String(currentListInfo.id) : '');
                      setIsCreatingList(true);
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-600 rounded-xl text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ 新建词单</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setNewCategoryParentId(currentListInfo?.id ? String(currentListInfo.id) : '');
                      setShowCreateCategoryModal(true);
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-600 rounded-xl text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    <span>+ 新建子分类</span>
                  </button>
                </div>
              </div>

              {/* Sub-Items Cards Grid */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-slate-500 tracking-wide uppercase flex items-center gap-1.5">
                    <span>📂 下属分类与单元目录</span>
                    <span className="text-[11px] font-normal text-slate-400">
                      (点击卡片即可进入对应分类或单元)
                    </span>
                  </h4>

                  {words.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllWordsInFolder(true)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      <span>📄 展开查看所有单词明细 ({words.length}词) →</span>
                    </button>
                  )}
                </div>

                {(currentListInfo ? currentListChildren : treeData).length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <p className="text-slate-400 text-xs">当前目录下暂无子分类或词单</p>
                    <div className="flex items-center justify-center gap-3 mt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setNewListParentId(currentListInfo?.id ? String(currentListInfo.id) : '');
                          setIsCreatingList(true);
                        }}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                      >
                        + 立即新建单元词单
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                    {(currentListInfo ? currentListChildren : treeData).map(item => {
                      const isItemFolder = item.is_folder === 1;
                      const count = isItemFolder ? (item.total_word_count || 0) : (item.word_count || 0);

                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            onSelectList(item.id);
                            setShowAllWordsInFolder(false);
                          }}
                          className="group p-4 bg-slate-50 hover:bg-indigo-50/50 border border-slate-200 hover:border-indigo-300 rounded-2xl transition-all cursor-pointer shadow-2xs hover:shadow-md flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xl shrink-0">{isItemFolder ? '📁' : '📄'}</span>
                                <h5 className="font-bold text-slate-800 group-hover:text-indigo-600 text-sm truncate transition-colors">
                                  {item.name}
                                </h5>
                              </div>
                              <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold shrink-0 font-mono ${
                                count > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'
                              }`}>
                                {count} 词
                              </span>
                            </div>
                            {item.description ? (
                              <p className="text-xs text-slate-500 line-clamp-2 mb-3">{item.description}</p>
                            ) : (
                              <p className="text-xs text-slate-400 mb-3 italic">
                                {isItemFolder ? '分类/学段目录' : '单元单词词单'}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center justify-between pt-3 border-t border-slate-200/60 mt-2 text-xs">
                            <span className="text-indigo-600 font-bold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
                              <span>{isItemFolder ? '进入分类' : '进入单元'}</span>
                              <span>→</span>
                            </span>

                            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMovingList(item);
                                  setMoveTargetParentId(item.parent_id ? String(item.parent_id) : '');
                                }}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                                title="移动位置"
                              >
                                <Move className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleOpenListSettings(item, e)}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                                title="改名 / 备注"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* If at root: also render cards for Unassigned and All Words */}
                    {!currentListId && (
                      <>
                        {/* Unassigned Words Card */}
                        <div
                          onClick={() => {
                            onSelectList('unassigned');
                            setShowAllWordsInFolder(true);
                          }}
                          className="group p-4 bg-amber-50/60 hover:bg-amber-100/60 border border-amber-200/80 hover:border-amber-300 rounded-2xl transition-all cursor-pointer shadow-2xs hover:shadow-md flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xl shrink-0">📦</span>
                                <h5 className="font-bold text-amber-950 group-hover:text-amber-800 text-sm truncate transition-colors">
                                  未归类单词
                                </h5>
                              </div>
                              <span className="text-[11px] px-2 py-0.5 rounded-full font-bold shrink-0 font-mono bg-amber-200/80 text-amber-900">
                                {wordStats.unassigned_count || 0} 词
                              </span>
                            </div>
                            <p className="text-xs text-amber-800/80 line-clamp-2 mb-3">
                              暂未归入任何具体词单的候选词汇，可批量勾选移入目标词单或直接学习
                            </p>
                          </div>

                          <div className="flex items-center justify-between pt-3 border-t border-amber-200/60 mt-2 text-xs">
                            <span className="text-amber-800 font-bold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
                              <span>进入整理</span>
                              <span>→</span>
                            </span>
                            <span className="text-[10px] text-amber-600 font-medium">独立专区</span>
                          </div>
                        </div>

                        {/* All Words Card */}
                        <div
                          onClick={() => {
                            onSelectList('all');
                            setShowAllWordsInFolder(true);
                          }}
                          className="group p-4 bg-indigo-50/60 hover:bg-indigo-100/60 border border-indigo-200/80 hover:border-indigo-300 rounded-2xl transition-all cursor-pointer shadow-2xs hover:shadow-md flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xl shrink-0">📋</span>
                                <h5 className="font-bold text-indigo-950 group-hover:text-indigo-800 text-sm truncate transition-colors">
                                  全库所有单词 (平铺)
                                </h5>
                              </div>
                              <span className="text-[11px] px-2 py-0.5 rounded-full font-bold shrink-0 font-mono bg-indigo-200/80 text-indigo-900">
                                {wordStats.total_count || 0} 词
                              </span>
                            </div>
                            <p className="text-xs text-indigo-800/80 line-clamp-2 mb-3">
                              总览当前系统收录的全部词汇明细，支持全局检索与批量处理
                            </p>
                          </div>

                          <div className="flex items-center justify-between pt-3 border-t border-indigo-200/60 mt-2 text-xs">
                            <span className="text-indigo-700 font-bold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
                              <span>平铺查看</span>
                              <span>→</span>
                            </span>
                            <span className="text-[10px] text-indigo-500 font-medium">全量一览</span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Words List Card View */
            <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-200">
              {/* Integrated Breadcrumbs Bar */}
              <div className="flex items-center gap-1.5 text-xs text-slate-500 pb-3 mb-4 border-b border-slate-100 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => {
                    onSelectList('');
                    setShowAllWordsInFolder(false);
                  }}
                  className={`flex items-center gap-1 font-semibold hover:text-indigo-600 transition-colors shrink-0 cursor-pointer ${
                    !currentListId ? 'text-indigo-600 font-bold' : 'text-slate-600'
                  }`}
                >
                  <span>📚 词库中心</span>
                </button>
                {breadcrumbPath.map((item, idx) => {
                  const isLast = idx === breadcrumbPath.length - 1;
                  return (
                    <React.Fragment key={item.id}>
                      <span className="text-slate-300 shrink-0">/</span>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectList(item.id);
                          setShowAllWordsInFolder(false);
                        }}
                        className={`hover:text-indigo-600 transition-colors truncate max-w-[160px] shrink-0 flex items-center gap-1 cursor-pointer ${
                          isLast ? 'text-indigo-600 font-bold' : 'text-slate-600 font-medium'
                        }`}
                      >
                        <span>{item.is_folder === 1 ? '📁' : '📄'}</span>
                        <span className="truncate">{item.name}</span>
                      </button>
                    </React.Fragment>
                  );
                })}
                {(currentListInfo?.is_folder === 1 || !currentListId) && showAllWordsInFolder && (
                  <>
                    <span className="text-slate-300 shrink-0">/</span>
                    <span className="text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-md shrink-0">
                      全量单词明细
                    </span>
                  </>
                )}
              </div>

              {/* Active Folder Full Words Expansion Notice */}
              {(currentListInfo?.is_folder === 1 || !currentListId) && (
                <div className="mb-4 p-3 bg-indigo-50/80 border border-indigo-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-base">📄</span>
                    <span className="text-indigo-900 font-medium truncate">
                      当前已展开浏览【<strong>{currentListInfo ? currentListInfo.name : '候选总词库'}</strong>】下汇聚的全部 <strong>{words.length}</strong> 个单词明细
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAllWordsInFolder(false)}
                    className="px-3 py-1.5 bg-white hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg border border-indigo-200 shrink-0 transition-colors shadow-2xs cursor-pointer"
                  >
                    📁 返回分类目录
                  </button>
                </div>
              )}

              {/* Header with Search, Page Size and Selection info */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2 flex-wrap">
                      <span>{currentListInfo ? `词单：${currentListInfo.name}` : '候选总词库'}</span>
                      {currentListInfo && currentListInfo.id !== 'all' && currentListInfo.id !== 'unassigned' && (
                        isPublicItem(currentListInfo) ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md">
                            🟢 公用
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-md">
                            🔵 私有
                          </span>
                        )
                      )}
                      <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-bold">
                        共 {filteredWords.length} 词
                        {pageSize > 0 && totalPages > 1 && ` · 第 ${validCurrentPage}/${totalPages} 页`}
                      </span>
                    </h3>
                  {(currentListInfo || currentListObj) && (
                    <div className="flex items-center gap-1">
                      {currentListInfo?.is_folder === 0 && currentListInfo?.id !== 'unassigned' && currentListInfo?.id !== 'all' && (
                        <button
                          type="button"
                          onClick={handleOpenWordPicker}
                          className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                          title="从未归类单词或其他分类/词单挑选词汇加入此词单"
                        >
                          <Plus className="w-3.5 h-3.5 text-indigo-600" />
                          <span>从词库添加</span>
                        </button>
                      )}
                      {currentListInfo?.id !== 'unassigned' && currentListInfo?.id !== 'all' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenListSettings(currentListInfo || currentListObj)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                            title="改名或修改备注"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>改名设置</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteList(currentListInfo || currentListObj, e)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                            title="删除此词单"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>删除词单</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {(currentListInfo?.description || currentListObj?.description) && (
                  <p className="text-xs text-slate-400 mt-1">{currentListInfo?.description || currentListObj?.description}</p>
                )}
              </div>

              {/* Controls: Mistakes Filter, Page size selector and Search input */}
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                {/* Mistakes Filter Toggle Tab */}
                <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-bold shrink-0">
                  <button
                    type="button"
                    onClick={() => setFilterMistakesOnly(false)}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      !filterMistakesOnly 
                        ? 'bg-white text-indigo-700 shadow-2xs' 
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    全部词 ({words.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMistakesOnly(true)}
                    className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
                      filterMistakesOnly 
                        ? 'bg-rose-600 text-white shadow-2xs' 
                        : totalMistakeWordsCount > 0
                        ? 'text-rose-600 hover:bg-rose-50'
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                    title="只显示有错误记录的单词，方便收集与强化复习"
                  >
                    <Flame className="w-3 h-3" />
                    <span>易错词 ({totalMistakeWordsCount})</span>
                  </button>
                </div>

                {/* Page Size Selector */}
                <div className="flex items-center gap-1 shrink-0">
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setPageSize(val);
                      localStorage.setItem('wordlib_page_size', String(val));
                      setCurrentPage(1);
                    }}
                    className="px-2 sm:px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 cursor-pointer transition-colors shadow-2xs"
                    title="设置每页显示单词数量"
                  >
                    <option value={20}>20 词/页</option>
                    <option value={50}>50 词/页</option>
                    <option value={100}>100 词/页</option>
                    <option value={0}>全部展开</option>
                  </select>
                </div>

                {/* Search input */}
                <div className="relative flex-1 sm:w-48">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="搜索单词或中文..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* Selection Toolbar */}
            <div className="flex items-center justify-between flex-wrap gap-2 p-2.5 sm:p-3 bg-slate-50/80 rounded-xl mb-4 text-xs">
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={toggleSelectCurrentPage}
                  className="flex items-center gap-1.5 font-bold text-slate-700 hover:text-indigo-600 transition-colors"
                >
                  {isAllCurrentPageSelected ? (
                    <CheckSquare className="w-4 h-4 text-indigo-600" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400" />
                  )}
                  <span>
                    {pageSize > 0 && filteredWords.length > displayedWords.length
                      ? (isAllCurrentPageSelected ? '取消本页全选' : `全选本页 (${displayedWords.length}词)`)
                      : (isAllCurrentPageSelected ? '全选' : '全选 / 反选')}
                  </span>
                </button>

                {pageSize > 0 && filteredWords.length > displayedWords.length && (
                  <button
                    type="button"
                    onClick={toggleSelectAllTotal}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold hover:underline"
                  >
                    {isAllTotalSelected ? '清空所有选择' : `全选全部 ${filteredWords.length} 词`}
                  </button>
                )}

                {selectedWordIds.size > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                      已选 {selectedWordIds.size} 词
                    </span>
                    <span className="text-[11px] text-slate-400 hidden sm:inline">
                      (Shift 键支持连选)
                    </span>
                  </div>
                )}
              </div>

              {/* Batch launch actions */}
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                {selectedWordIds.size > 0 ? (
                  <>
                    {isAuthenticated && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowBatchAssignModal(true)}
                          className="px-2 sm:px-2.5 py-1.5 bg-white border border-slate-300 hover:border-indigo-400 text-slate-700 font-semibold rounded-lg shadow-xs transition-all flex items-center gap-1 text-[11px] sm:text-xs"
                        >
                          <FolderPlus className="w-3.5 h-3.5 text-indigo-600" />
                          <span>加入词单</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowBatchCalendarModal(true)}
                          className="px-2 sm:px-2.5 py-1.5 bg-white border border-slate-300 hover:border-indigo-400 text-slate-700 font-semibold rounded-lg shadow-xs transition-all flex items-center gap-1 text-[11px] sm:text-xs"
                        >
                          <CalendarIcon className="w-3.5 h-3.5 text-indigo-600" />
                          <span>加入日程</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleBatchIncrementMistakes}
                          className="px-2 sm:px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold rounded-lg shadow-xs transition-all flex items-center gap-1 text-[11px] sm:text-xs"
                          title="将选中的单词错误次数+1（标为易错词）"
                        >
                          <Flame className="w-3.5 h-3.5 text-rose-600" />
                          <span>标易错 (+1)</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleBatchResetMistakes}
                          className="px-2 sm:px-2.5 py-1.5 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 font-semibold rounded-lg shadow-xs transition-all flex items-center gap-1 text-[11px] sm:text-xs"
                          title="将选中的单词错误次数清零去除"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                          <span>去除错误</span>
                        </button>
                        {words.some(w => selectedWordIds.has(w.id) && !isPublicItem(w)) && (
                          <button
                            type="button"
                            onClick={handleBatchPublishPrivateWords}
                            className="px-2 sm:px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-semibold rounded-lg shadow-xs transition-all flex items-center gap-1 text-[11px] sm:text-xs cursor-pointer"
                            title={isAdmin ? "直接将选中的独有私词发布为全员公共词条" : "将选中的独有私词申请加入公共词库 (需管理员审核)"}
                          >
                            <Globe className="w-3.5 h-3.5 text-amber-600" />
                            <span>公开私词</span>
                          </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onStartDictation(selectedWordsList, '选中词汇听写')}
                      className="px-2.5 sm:px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-xs transition-all flex items-center gap-1 text-[11px] sm:text-xs"
                    >
                      <Headphones className="w-3.5 h-3.5" />
                      <span>听写选中词</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartMemory(selectedWordsList, '选中词汇记忆')}
                      className="px-2.5 sm:px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-xs transition-all flex items-center gap-1 text-[11px] sm:text-xs"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>记忆选中词</span>
                    </button>
                    {isAuthenticated && (
                      <button
                        type="button"
                        onClick={handleBatchDelete}
                        className="px-2 sm:px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold rounded-lg shadow-xs transition-all flex items-center gap-1 text-[11px] sm:text-xs cursor-pointer"
                        title={
                          currentListId && currentListId !== 'unassigned' && currentListId !== 'all'
                            ? '从当前词单移除选中的单词（保留在总库）'
                            : '彻底删除选中的单词（从数据库永久清除）'
                        }
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                        <span>
                          {currentListId && currentListId !== 'unassigned' && currentListId !== 'all'
                            ? `移出词单 (${selectedWordIds.size})`
                            : `彻底删除 (${selectedWordIds.size})`}
                        </span>
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-slate-400 text-[11px] sm:text-xs">勾选单词可快速开启听写、记忆或批量安排</span>
                )}
              </div>
            </div>

            {/* Words List */}
            {loadingWords ? (
              <div className="py-12 text-center text-slate-400 text-sm">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                <span>正在加载词库...</span>
              </div>
            ) : filteredWords.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">
                <p>{filterMistakesOnly ? '太棒了，当前没有任何易错词！' : '暂无符合条件的单词'}</p>
                {filterMistakesOnly ? (
                  <button
                    type="button"
                    onClick={() => setFilterMistakesOnly(false)}
                    className="mt-3 text-xs text-indigo-600 font-bold hover:underline"
                  >
                    查看全部词汇 →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!isAuthenticated) {
                        openAuthModal('login');
                        return;
                      }
                      onOpenImport('photo');
                    }}
                    className="mt-3 text-xs text-indigo-600 font-bold hover:underline"
                  >
                    立即拍照或导入单词 →
                  </button>
                )}
              </div>
            ) : (
              <div ref={listContainerRef} className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto pr-1">
                {/* Top insertion line (before first item) */}
                {isAuthenticated && startIndex === 0 && (
                  <div className="relative group/insert-top py-1 mb-1 z-10">
                    <div className="flex items-center justify-center opacity-0 group-hover/insert-top:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => handleOpenInsert(null, displayedWords[0] || null)}
                        className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-600 hover:text-white font-bold text-[11px] rounded-full shadow-2xs flex items-center gap-1 transition-all"
                        title="在列表最上方插入首条单词"
                      >
                        <Plus className="w-3 h-3" />
                        <span>在列表最上方插入词条</span>
                      </button>
                    </div>
                  </div>
                )}

                {displayedWords.map((item, localIdx) => {
                  const isSelected = selectedWordIds.has(item.id);
                  const nextItem = displayedWords[localIdx + 1] || null;
                  return (
                    <React.Fragment key={item.id}>
                      <div
                        onClick={(e) => handleWordClick(item.id, localIdx, e)}
                        className={`group py-2.5 sm:py-3 px-2 sm:px-3 rounded-xl transition-all cursor-pointer flex items-start justify-between gap-2 sm:gap-3 select-none ${
                          isSelected ? 'bg-indigo-50/70 border border-indigo-200' : 'hover:bg-slate-50 border border-transparent'
                        }`}
                      >
                        {/* Checkbox and word details */}
                        <div className="flex items-start gap-2 sm:gap-3 min-w-0">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleWordClick(item.id, localIdx, e); }}
                            className="mt-1 text-slate-400 hover:text-indigo-600 shrink-0"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-indigo-600" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                              <span className="text-sm sm:text-base font-bold text-slate-900">{item.word}</span>
                              {item.phonetic && (
                                <span className="text-xs font-mono text-indigo-600 font-medium truncate">
                                  {item.phonetic}
                                </span>
                              )}
                              {!isPublicItem(item) && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-amber-50 text-amber-700 border border-amber-200 shrink-0" title="该单词为您独有的私有词条，其他用户不可见">
                                  独有私词
                                </span>
                              )}
                              {/* Human voice button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  playWordAudio(item.word, accent);
                                }}
                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors shrink-0"
                                title="听权威真人发音"
                              >
                                <Volume2 className="w-3.5 h-3.5" />
                              </button>

                              {/* Mistake count badge and quick control: 标易错 / 去易错 */}
                              {(item.mistake_count || 0) > 0 ? (
                                <div 
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 bg-rose-50 border border-rose-200 text-rose-700 rounded-full px-2 py-0.5 text-[11px] font-bold shadow-2xs transition-colors shrink-0"
                                  title={`易错词：累计记录 ${item.mistake_count} 次错误`}
                                >
                                  <Flame className="w-3.5 h-3.5 text-rose-500 fill-rose-400 shrink-0" />
                                  <span>易错 ({item.mistake_count})</span>
                                  {isAuthenticated && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={(e) => handleAdjustMistake(item.id, 1, e)}
                                        className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-rose-200 text-rose-700 transition-colors ml-0.5"
                                        title="错误次数 +1"
                                      >
                                        <Plus className="w-2.5 h-2.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => handleResetMistake(item.id, e)}
                                        className="ml-0.5 px-2 py-0.2 text-[10px] bg-white hover:bg-rose-600 hover:text-white border border-rose-300 rounded-full transition-colors font-bold text-rose-600 active:scale-95 shadow-2xs"
                                        title="点击快捷去易错（归零并移出易错词）"
                                      >
                                        去易错
                                      </button>
                                    </>
                                  )}
                                </div>
                              ) : (
                                isAuthenticated && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleAdjustMistake(item.id, 1, e)}
                                    className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-rose-700 bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-300 rounded-full px-2 py-0.5 transition-all font-semibold active:scale-95 shrink-0"
                                    title="点击快捷标为易错词 (+1)"
                                  >
                                    <Flame className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-500" />
                                    <span>标易错</span>
                                  </button>
                                )
                              )}
                            </div>

                            <div className="text-xs text-slate-700 font-medium mt-0.5 break-words">
                              {item.translation || '暂无释义'}
                            </div>

                            {item.example && (
                              <div className="text-[11px] text-slate-400 italic mt-0.5 truncate max-w-xs sm:max-w-lg">
                                "{item.example}"
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right stats, insert, reorder, edit & delete actions */}
                        <div className="flex items-center gap-0.5 sm:gap-1.5 shrink-0">
                          {item.best_speech_score > 0 && (
                            <span className="text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.2 sm:py-0.5 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200 mr-1">
                              发音 {item.best_speech_score}分
                            </span>
                          )}

                          {isAuthenticated && (
                            <>
                              {/* Insert Below Button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenInsert(item, nextItem);
                                }}
                                className="p-1 sm:p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title={nextItem ? `在【${item.word}】与【${nextItem.word}】之间插入` : `在【${item.word}】下方插入`}
                              >
                                <PlusCircle className="w-3.5 h-3.5 text-indigo-500" />
                              </button>

                              {/* Move Up/Down (only for admin or private list) */}
                              {(isAdmin || canDirectlyModify(item)) && (
                                <>
                                  <button
                                    type="button"
                                    disabled={startIndex + localIdx === 0}
                                    onClick={(e) => handleReorder(item.id, 'up', e)}
                                    className="p-1 sm:p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-200/50 rounded-lg transition-colors disabled:opacity-20 disabled:hover:bg-transparent"
                                    title="上移一位"
                                  >
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={startIndex + localIdx === filteredWords.length - 1}
                                    onClick={(e) => handleReorder(item.id, 'down', e)}
                                    className="p-1 sm:p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-200/50 rounded-lg transition-colors disabled:opacity-20 disabled:hover:bg-transparent"
                                    title="下移一位"
                                  >
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}

                              {/* Publish to Public Vocabulary Button (only for private words) */}
                              {!isPublicItem(item) && (
                                <button
                                  type="button"
                                  onClick={(e) => handlePublishWord(item, e)}
                                  className="p-1 sm:p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                                  title={isAdmin ? "直接将此独有私词发布为全员公共词条" : "申请将此独有私词加入公共词库 (需管理员审核)"}
                                >
                                  <Globe className="w-3.5 h-3.5 text-amber-600" />
                                </button>
                              )}

                              {/* Edit Button */}
                              <button
                                type="button"
                                onClick={(e) => handleOpenEdit(item, e)}
                                className="p-1 sm:p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-200/50 rounded-lg transition-colors"
                                title={isAdmin || canDirectlyModify(item) ? "修改该单词词条 (释义/例句/拼写)" : "提出修改公共词条建议 (需管理员审核)"}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>

                              {/* Delete Button */}
                              <button
                                type="button"
                                onClick={(e) => handleDeleteWord(item.id, e)}
                                className="p-1 sm:p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-200/50 rounded-lg transition-colors cursor-pointer"
                                title={
                                  isAdmin || (canDirectlyModify(item) && !isPublicItem(currentListInfo))
                                    ? (currentListId && currentListId !== 'unassigned' && currentListId !== 'all'
                                        ? '从当前词单移除（保留在总库）'
                                        : '从词库彻底删除该词')
                                    : (currentListId && currentListId !== 'unassigned' && currentListId !== 'all'
                                        ? '申请从公共词单移除 (需管理员审核)'
                                        : '申请删除公共词条 (需管理员审核)')
                                }
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Insertion Divider between cards */}
                      {isAuthenticated && nextItem && (
                        <div className="relative group/insert py-0.5 -my-0.5 z-10">
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/insert:opacity-100 transition-opacity pointer-events-none">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenInsert(item, nextItem);
                              }}
                              className="pointer-events-auto px-2.5 py-0.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-[10px] rounded-full shadow-md flex items-center gap-1 transition-all cursor-pointer"
                              title={`在【${item.word}】与【${nextItem.word}】之间插入`}
                            >
                              <Plus className="w-3 h-3" />
                              <span>在此插入词条</span>
                            </button>
                          </div>
                          <div className="border-b border-transparent group-hover/insert:border-indigo-300 transition-colors"></div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            )}

            {/* Pagination Controls */}
            {pageSize > 0 && totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 mt-3 border-t border-slate-100 text-xs text-slate-600 select-none">
                <div className="flex items-center gap-2 text-slate-500 text-xs">
                  <span>
                    第 <strong className="text-slate-800 font-bold">{startIndex + 1}</strong> - <strong className="text-slate-800 font-bold">{Math.min(startIndex + pageSize, filteredWords.length)}</strong> 词
                  </span>
                  <span>/</span>
                  <span>共 <strong className="text-indigo-600 font-bold">{filteredWords.length}</strong> 词</span>
                </div>

                <div className="flex items-center gap-1">
                  {/* First page */}
                  <button
                    type="button"
                    disabled={validCurrentPage <= 1}
                    onClick={() => {
                      setCurrentPage(1);
                      listContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    title="第一页"
                  >
                    <ChevronsLeft className="w-3.5 h-3.5" />
                  </button>

                  {/* Previous page */}
                  <button
                    type="button"
                    disabled={validCurrentPage <= 1}
                    onClick={() => {
                      setCurrentPage(p => Math.max(1, p - 1));
                      listContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent font-medium transition-colors flex items-center gap-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>上一页</span>
                  </button>

                  {/* Page numbers */}
                  <div className="hidden sm:flex items-center gap-1 mx-1">
                    {getPageNumbers(validCurrentPage, totalPages).map((p, pIdx) => {
                      if (p === '...') {
                        return <span key={`ellipsis-${pIdx}`} className="px-1 text-slate-400">...</span>;
                      }
                      const isCurr = p === validCurrentPage;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => {
                            setCurrentPage(p);
                            listContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className={`min-w-[28px] h-7 px-1.5 rounded-lg font-bold text-xs transition-colors ${
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

                  {/* Mobile page number badge */}
                  <div className="sm:hidden px-2 font-bold text-indigo-600 bg-indigo-50 py-1 rounded-md">
                    {validCurrentPage} / {totalPages}
                  </div>

                  {/* Next page */}
                  <button
                    type="button"
                    disabled={validCurrentPage >= totalPages}
                    onClick={() => {
                      setCurrentPage(p => Math.min(totalPages, p + 1));
                      listContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent font-medium transition-colors flex items-center gap-1"
                  >
                    <span>下一页</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>

                  {/* Last page */}
                  <button
                    type="button"
                    disabled={validCurrentPage >= totalPages}
                    onClick={() => {
                      setCurrentPage(totalPages);
                      listContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    title="最后一页"
                  >
                    <ChevronsRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Batch assign to list Modal */}
      {showBatchAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-sm p-4 sm:p-5 space-y-4">
            <h4 className="font-bold text-slate-800 text-sm">将选中的 {selectedWordIds.size} 个单词加入词单</h4>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">选择目标词单</label>
              <select
                value={batchTargetListId}
                onChange={(e) => setBatchTargetListId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">-- 请选择目标词单 --</option>
                {leafListOptions.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.pathName} ({l.word_count} 词)
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowBatchAssignModal(false)}
                className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleBatchAssign}
                disabled={!batchTargetListId}
                className="px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm transition-all disabled:opacity-50"
              >
                确定加入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch assign to Calendar Modal */}
      {showBatchCalendarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-sm p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
              <CalendarIcon className="w-4 h-4 text-indigo-600" />
              <span>将选中的 {selectedWordIds.size} 个单词加入日程</span>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">选择听写日期</label>
              <input
                type="date"
                required
                value={calendarTargetDate}
                onChange={(e) => setCalendarTargetDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[11px] text-slate-400 mt-1.5">
                所选单词将排入该日的日历听写计划中，可在“日历计划”视图或通过小爱音箱直接调用。
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowBatchCalendarModal(false)}
                className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleBatchAssignToCalendar}
                disabled={!calendarTargetDate || isAssigningToCalendar}
                className="px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white rounded-lg font-medium shadow-sm transition-all disabled:opacity-50"
              >
                {isAssigningToCalendar ? '正在加入...' : '确认加入日程'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Word Modal */}
      {editingWord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-scale-up max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-2 font-bold text-slate-800 text-sm sm:text-base min-w-0">
                <Pencil className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="truncate">修改单词条目 - <span className="text-indigo-600">{editingWord.word}</span></span>
              </div>
              <button
                type="button"
                onClick={() => setEditingWord(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50 transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-4 sm:p-6 space-y-3 sm:space-y-4 text-xs overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">英文拼写 *</label>
                  <input
                    type="text"
                    required
                    value={editForm.word}
                    onChange={(e) => setEditForm(prev => ({ ...prev, word: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-bold text-slate-900 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">国际音标</label>
                  <input
                    type="text"
                    value={editForm.phonetic}
                    onChange={(e) => setEditForm(prev => ({ ...prev, phonetic: e.target.value }))}
                    placeholder="/音标/"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-mono text-slate-700 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">词性与中文释义 *</label>
                <textarea
                  rows={2}
                  required
                  value={editForm.translation}
                  onChange={(e) => setEditForm(prev => ({ ...prev, translation: e.target.value }))}
                  placeholder="如：v. 放弃，遗弃；n. 放任"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 text-slate-800 text-xs leading-relaxed"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">双语例句 (英文)</label>
                <textarea
                  rows={2}
                  value={editForm.example}
                  onChange={(e) => setEditForm(prev => ({ ...prev, example: e.target.value }))}
                  placeholder="包含该单词的英文例句"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 text-slate-800 text-xs font-serif italic"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">例句中文翻译</label>
                <input
                  type="text"
                  value={editForm.example_cn}
                  onChange={(e) => setEditForm(prev => ({ ...prev, example_cn: e.target.value }))}
                  placeholder="例句的中文对照翻译"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 text-slate-700 text-xs"
                />
              </div>

              {/* Mistake Count Setting */}
              <div className="p-3 bg-rose-50/70 border border-rose-200/80 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-rose-900 flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-rose-600" />
                    <span>易错设置 (错误次数)</span>
                  </label>
                  {(editForm.mistake_count || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => setEditForm(prev => ({ ...prev, mistake_count: 0 }))}
                      className="text-[11px] text-rose-600 hover:text-rose-800 font-bold hover:underline"
                    >
                      清零去除错误
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-white border border-rose-300 rounded-lg overflow-hidden shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setEditForm(prev => ({ ...prev, mistake_count: Math.max(0, (Number(prev.mistake_count) || 0) - 1) }))}
                      className="px-2.5 py-1 text-rose-700 hover:bg-rose-100 font-bold text-sm"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={editForm.mistake_count || 0}
                      onChange={(e) => setEditForm(prev => ({ ...prev, mistake_count: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                      className="w-16 text-center font-bold text-rose-900 text-xs py-1 border-x border-rose-200 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setEditForm(prev => ({ ...prev, mistake_count: (Number(prev.mistake_count) || 0) + 1 }))}
                      className="px-2.5 py-1 text-rose-700 hover:bg-rose-100 font-bold text-sm"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {(editForm.mistake_count || 0) > 0 ? `设为易错词 (累计错 ${editForm.mistake_count} 次)` : '当前无错误记录 (非易错词)'}
                  </span>
                </div>
              </div>

              {/* Private word publish notice & shortcut */}
              {editingWord && !isPublicItem(editingWord) && (
                <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-amber-900 flex items-center gap-1">
                      <Globe className="w-3.5 h-3.5 text-amber-600" />
                      <span>独有私词提示</span>
                    </span>
                    <span className="text-[11px] text-amber-700 block mt-0.5">该词目前仅自己可见。如需全员共享，可直接申请加入公共词库。</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const target = { ...editingWord, ...editForm };
                      setEditingWord(null);
                      handlePublishWord(target);
                    }}
                    className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-[11px] shrink-0 ml-2 shadow-2xs transition-colors cursor-pointer"
                  >
                    {isAdmin ? '直接公开' : '申请公开'}
                  </button>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingWord(null)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors text-xs"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit || !editForm.word.trim()}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white rounded-xl font-bold shadow-md shadow-indigo-200 flex items-center gap-1.5 transition-all disabled:opacity-50 text-xs"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSavingEdit ? '正在保存...' : '保存修改'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit/Settings List Modal */}
      {editingList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-scale-up">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-2 font-bold text-slate-800 text-base">
                <Folder className="w-4 h-4 text-indigo-600" />
                <span>词单设置与改名</span>
              </div>
              <button
                type="button"
                onClick={() => setEditingList(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveListSettings} className="p-5 space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700">词单名称 *</label>
                <input
                  type="text"
                  required
                  value={listEditName}
                  onChange={(e) => setListEditName(e.target.value)}
                  placeholder="如：初三核心词汇、雅思精选"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-bold text-slate-900 text-sm"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700">词单备注 / 描述 (可选)</label>
                <textarea
                  rows={3}
                  value={listEditDesc}
                  onChange={(e) => setListEditDesc(e.target.value)}
                  placeholder="关于该词单的学习要求、范围或年级等"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 text-slate-800 text-xs leading-relaxed"
                />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-700 block">词单属性</label>
                  <span className="text-[11px] text-slate-400">
                    {!isAdmin && (isPublicItem(editingList) || listEditIsPublic === 1)
                      ? '💡 修改公用词单将提交管理员审核'
                      : '💡 私有词单直接保存生效'}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="list_edit_public"
                      checked={listEditIsPublic === 0}
                      onChange={() => setListEditIsPublic(0)}
                      className="text-indigo-600"
                    />
                    <span className="font-semibold text-blue-700">🔵 私有 (仅自己)</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="list_edit_public"
                      checked={listEditIsPublic === 1}
                      onChange={() => setListEditIsPublic(1)}
                      className="text-indigo-600"
                    />
                    <span className="font-semibold text-emerald-700">🟢 公用 (全员共享 {!isAdmin && '需审核'})</span>
                  </label>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    const target = editingList;
                    setEditingList(null);
                    handleDeleteList(target, e);
                  }}
                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl font-bold transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{editingList?.is_folder === 1 ? '删除分类' : '删除词单'}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingList(null)}
                    className="px-3.5 py-1.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingList || !listEditName.trim()}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white rounded-xl font-bold shadow-md shadow-indigo-100 flex items-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>
                      {isSavingList 
                        ? '正在保存...' 
                        : (!isAdmin && (isPublicItem(editingList) || listEditIsPublic === 1) ? '提交审核' : '保存修改')}
                    </span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Insert Word In-Between Modal */}
      {insertModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-scale-up">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-2 font-bold text-slate-800 text-sm sm:text-base min-w-0">
                <PlusCircle className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="truncate">
                  {insertModalData.afterWord && insertModalData.beforeWord ? (
                    <>在【<span className="text-indigo-600">{insertModalData.afterWord.word}</span>】与【<span className="text-indigo-600">{insertModalData.beforeWord.word}</span>】间插入</>
                  ) : insertModalData.afterWord ? (
                    <>在【<span className="text-indigo-600">{insertModalData.afterWord.word}</span>】下方插入</>
                  ) : insertModalData.beforeWord ? (
                    <>在【<span className="text-indigo-600">{insertModalData.beforeWord.word}</span>】上方插入</>
                  ) : (
                    <>插入新词条</>
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setInsertModalData(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50 transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveInsert} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
              {/* Fast Paste / Auto-parse Bar */}
              <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-indigo-900 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    快捷智能粘贴解析
                  </span>
                  <span className="text-[10px] text-indigo-500">粘贴后自动拆分单词、音标、释义</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={insertQuickText}
                    onChange={(e) => handleQuickParseInsert(e.target.value)}
                    placeholder="如：camp /kæmp/ n. 度假营；营地 v. 露营"
                    className="flex-1 px-3 py-1.5 bg-white border border-indigo-200 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleEnrichInsert}
                    disabled={isEnrichingInsert || !insertForm.word.trim()}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shrink-0 flex items-center gap-1 transition-all disabled:opacity-40"
                    title="调用大模型自动补全英美音标与高频例句"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>{isEnrichingInsert ? 'AI 补全中...' : 'AI 补全'}</span>
                  </button>
                </div>
              </div>

              {/* Detailed Form */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">英文单词 *</label>
                  <input
                    type="text"
                    required
                    value={insertForm.word}
                    onChange={(e) => setInsertForm(prev => ({ ...prev, word: e.target.value }))}
                    placeholder="例如：abandon"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-bold text-slate-900"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">音标</label>
                  <input
                    type="text"
                    value={insertForm.phonetic}
                    onChange={(e) => setInsertForm(prev => ({ ...prev, phonetic: e.target.value }))}
                    placeholder="例如：/əˈbændən/"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-mono text-slate-800"
                  />
                </div>
              </div>

              <div className="space-y-1 text-xs">
                <label className="font-semibold text-slate-700">中文释义 / 词性 *</label>
                <input
                  type="text"
                  required
                  value={insertForm.translation}
                  onChange={(e) => setInsertForm(prev => ({ ...prev, translation: e.target.value }))}
                  placeholder="例如：v. 放弃，遗弃；n. 放任"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 text-slate-800"
                />
              </div>

              <div className="space-y-1 text-xs">
                <label className="font-semibold text-slate-700">英文例句 (可选)</label>
                <textarea
                  rows={2}
                  value={insertForm.example}
                  onChange={(e) => setInsertForm(prev => ({ ...prev, example: e.target.value }))}
                  placeholder="例如：He decided to abandon the plan due to lack of funds."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 text-slate-800 leading-relaxed"
                />
              </div>

              <div className="space-y-1 text-xs">
                <label className="font-semibold text-slate-700">例句中文翻译 (可选)</label>
                <input
                  type="text"
                  value={insertForm.example_cn}
                  onChange={(e) => setInsertForm(prev => ({ ...prev, example_cn: e.target.value }))}
                  placeholder="例如：由于缺乏资金，他决定放弃这项计划。"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 text-slate-700"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setInsertModalData(null)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors text-xs"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isInsertingWord || !insertForm.word.trim()}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white rounded-xl font-bold shadow-md shadow-indigo-200 flex items-center gap-1.5 transition-all disabled:opacity-50 text-xs"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>{isInsertingWord ? '正在插入...' : '确认插入此位置'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Category Modal */}
      {showCreateCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-scale-up">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-2 font-bold text-slate-800 text-sm sm:text-base">
                <FolderPlus className="w-4 h-4 text-indigo-600" />
                <span>新建词库分类 / 学段 / 年级</span>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateCategoryModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCategory} className="p-5 space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">分类名称 *</label>
                <input
                  type="text"
                  required
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="例如：初中、7年级上册、高中、考纲高频等"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-bold text-slate-900"
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">归属上级分类 (可选)</label>
                <select
                  value={newCategoryParentId}
                  onChange={(e) => setNewCategoryParentId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 text-slate-800"
                >
                  <option value="">根目录 (顶级学段)</option>
                  {allFolderOptions.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400">选择上级后将成为该分类的子目录（例如在“初中”下创建“7年级上册”）。</p>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                <label className="font-semibold text-slate-700 block">分类属性</label>
                <div className="flex items-center gap-4">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="cat_public"
                      checked={newCategoryIsPublic === 0}
                      onChange={() => setNewCategoryIsPublic(0)}
                      className="text-indigo-600"
                    />
                    <span className="font-semibold text-blue-700">🔵 私有 (仅自己可见)</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="cat_public"
                      checked={newCategoryIsPublic === 1}
                      onChange={() => setNewCategoryIsPublic(1)}
                      className="text-indigo-600"
                    />
                    <span className="font-semibold text-emerald-700">🟢 公用 (全员共享 {!isAdmin && '需审核'})</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateCategoryModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!newCategoryName.trim()}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md shadow-indigo-200 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {!isAdmin && newCategoryIsPublic === 1 ? '提交新建申请' : '确认创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Move List / Category Modal */}
      {movingList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-scale-up">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-2 font-bold text-slate-800 text-sm sm:text-base">
                <Move className="w-4 h-4 text-indigo-600" />
                <span>移动【{movingList.name}】至分类</span>
              </div>
              <button
                type="button"
                onClick={() => setMovingList(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">目标上级目录 / 分类：</label>
                <select
                  value={moveTargetParentId}
                  onChange={(e) => setMoveTargetParentId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium text-slate-800"
                >
                  <option value="">根目录 (顶级分类 / 无上级)</option>
                  {allFolderOptions
                    .filter(opt => opt.id !== movingList.id)
                    .map(opt => (
                      <option key={opt.id} value={opt.id}>{opt.name}</option>
                    ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  选择目标分类后，该条目及其所有单词将归入所选分类下。
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setMovingList(null)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleMoveListConfirm}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md shadow-indigo-200 transition-all cursor-pointer"
                >
                  确认移动
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Word Picker Modal: pick words from unassigned / all / other lists and add to current list */}
      {showWordPickerModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <PlusCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">从词库挑选并添加到词单</h3>
                  <p className="text-xs text-slate-500">
                    当前目标词单：<span className="font-bold text-indigo-600">{currentListInfo?.name}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowWordPickerModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Source selector & search bar */}
            <div className="p-4 border-b border-slate-100 bg-slate-50/30 space-y-3 shrink-0">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    词汇来源分类 / 词单：
                  </label>
                  <select
                    value={pickerSourceId}
                    onChange={(e) => {
                      setPickerSourceId(e.target.value);
                      loadPickerWords(e.target.value);
                    }}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="unassigned">📦 未归类单词 ({wordStats.unassigned_count} 词)</option>
                    <option value="all">📋 全库所有单词 ({wordStats.total_count} 词)</option>
                    <optgroup label="── 树形学段分类与词单 ──">
                      {pickerSourceOptions
                        .filter(opt => opt.id !== String(currentListInfo?.id))
                        .map(opt => (
                          <option key={opt.id} value={opt.id} disabled={opt.is_folder === 1 && opt.word_count === 0}>
                            {opt.indentName} ({opt.word_count}词)
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </div>

                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    搜索过滤：
                  </label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="按英文或中文释义搜索..."
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Selection actions toolbar */}
              <div className="flex items-center justify-between pt-1 text-xs">
                <div className="flex items-center gap-3 text-slate-500">
                  <span>
                    来源共 <strong className="text-slate-800">{pickerWords.length}</strong> 词
                    {pickerSearch && ` (匹配 ${filteredPickerWords.length} 词)`}
                  </span>
                  <span>
                    已选 <strong className="text-indigo-600">{pickerSelectedIds.size}</strong> 词
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const newSet = new Set(pickerSelectedIds);
                      filteredPickerWords.forEach(w => {
                        if (!currentListWordIdSet.has(w.id)) {
                          newSet.add(w.id);
                        }
                      });
                      setPickerSelectedIds(newSet);
                    }}
                    className="px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded-md font-semibold cursor-pointer"
                  >
                    全选可用词
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickerSelectedIds(new Set())}
                    className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded-md font-medium cursor-pointer"
                  >
                    清空选择
                  </button>
                </div>
              </div>
            </div>

            {/* Words list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1 divide-y divide-slate-100 min-h-[260px] max-h-[420px]">
              {pickerLoading ? (
                <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-indigo-500" />
                  <span>正在加载单词列表...</span>
                </div>
              ) : filteredPickerWords.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  {pickerSearch ? '没有找到匹配的单词' : '该分类/词单下暂无单词'}
                </div>
              ) : (
                filteredPickerWords.map(word => {
                  const alreadyIn = currentListWordIdSet.has(word.id);
                  const isChecked = pickerSelectedIds.has(word.id);

                  return (
                    <div
                      key={word.id}
                      onClick={() => {
                        if (alreadyIn) return;
                        setPickerSelectedIds(prev => {
                          const next = new Set(prev);
                          if (next.has(word.id)) next.delete(word.id);
                          else next.add(word.id);
                          return next;
                        });
                      }}
                      className={`pt-2 pb-2 px-2.5 rounded-xl flex items-center justify-between gap-3 transition-colors ${
                        alreadyIn 
                          ? 'opacity-55 bg-slate-50/60 cursor-not-allowed' 
                          : isChecked 
                            ? 'bg-indigo-50/70 border border-indigo-200 cursor-pointer' 
                            : 'hover:bg-slate-50 cursor-pointer border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="text-slate-400 shrink-0">
                          {alreadyIn ? (
                            <Check className="w-4 h-4 text-emerald-600" />
                          ) : isChecked ? (
                            <CheckSquare className="w-4 h-4 text-indigo-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-slate-800">{word.word}</span>
                            {word.phonetic && (
                              <span className="text-[11px] text-slate-400 font-serif">/{word.phonetic}/</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 truncate max-w-sm sm:max-w-md">{word.translation}</p>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-1.5">
                        {alreadyIn && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium border border-emerald-200/60">
                            已在当前词单
                          </span>
                        )}
                        {word.mistake_count > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 font-bold border border-amber-200/50">
                            错 {word.mistake_count} 次
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
              <span className="text-xs text-slate-500 font-medium">
                已选中 <strong className="text-indigo-600 font-bold">{pickerSelectedIds.size}</strong> 个单词
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowWordPickerModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={pickerSelectedIds.size === 0 || pickerSubmitting}
                  onClick={handleConfirmAddWordsToList}
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl shadow-md shadow-indigo-200 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  {pickerSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>正在添加...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>确认添加到词单 ({pickerSelectedIds.size})</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
