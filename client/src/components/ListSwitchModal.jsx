import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, X, Folder, FolderOpen, BookOpen, Layers, 
  ChevronRight, ChevronDown, Check, RefreshCw
} from 'lucide-react';
import { api } from '../api/client';

export default function ListSwitchModal({ 
  isOpen, 
  onClose, 
  currentListId, 
  currentTitle, 
  onSelect 
}) {
  const [treeData, setTreeData] = useState([]);
  const [wordStats, setWordStats] = useState({ total_count: 0, unassigned_count: 0 });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolderIds, setExpandedFolderIds] = useState(new Set([22, 28, 35])); // Default expand main categories

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tree, stats] = await Promise.all([
        api.getListsTree().catch(() => []),
        api.getWordStats().catch(() => ({ total_count: 0, unassigned_count: 0 }))
      ]);
      setTreeData(tree || []);
      setWordStats(stats || { total_count: 0, unassigned_count: 0 });
    } catch (err) {
      console.error('Failed to load list switch data:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleFolder = (folderId, e) => {
    e.stopPropagation();
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

  // Flatten tree for search mode with breadcrumb path
  const flattenedLeafLists = useMemo(() => {
    function flatten(nodes, path = '') {
      let res = [];
      for (const node of nodes) {
        const curPath = path ? `${path} > ${node.name}` : node.name;
        if (node.is_folder === 1) {
          if (node.children && node.children.length > 0) {
            res = res.concat(flatten(node.children, curPath));
          }
        } else {
          res.push({
            id: node.id,
            name: node.name,
            path: path || '顶级词单',
            word_count: node.word_count || 0
          });
        }
      }
      return res;
    }
    return flatten(treeData);
  }, [treeData]);

  // Filtered lists in search mode
  const filteredSearchLists = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return flattenedLeafLists.filter(l => 
      l.name.toLowerCase().includes(q) || 
      l.path.toLowerCase().includes(q)
    );
  }, [flattenedLeafLists, searchQuery]);

  if (!isOpen) return null;

  const handleChoose = (listId, listName) => {
    onSelect?.(listId, listName);
    onClose();
  };

  // Recursive Tree Node Renderer
  const renderTreeNode = (node, depth = 0) => {
    const isFolder = node.is_folder === 1;
    const isExpanded = expandedFolderIds.has(node.id);
    const isSelected = String(currentListId) === String(node.id);

    if (isFolder) {
      return (
        <div key={`folder-${node.id}`} className="space-y-0.5">
          <div
            onClick={(e) => toggleFolder(node.id, e)}
            className="flex items-center justify-between px-2.5 py-2 rounded-xl text-slate-700 hover:bg-slate-100/80 cursor-pointer text-xs font-bold transition-colors select-none group"
            style={{ paddingLeft: `${Math.max(10, depth * 18 + 10)}px` }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-slate-400 group-hover:text-slate-600 transition-transform duration-150">
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </span>
              {isExpanded ? (
                <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
              ) : (
                <Folder className="w-4 h-4 text-amber-500/80 shrink-0" />
              )}
              <span className="truncate">{node.name}</span>
            </div>
            {node.total_word_count !== undefined && (
              <span className="text-[10px] text-slate-400 font-medium px-1.5 py-0.5 rounded-full bg-slate-100 shrink-0">
                {node.total_word_count} 词
              </span>
            )}
          </div>

          {isExpanded && node.children && node.children.length > 0 && (
            <div className="space-y-0.5">
              {node.children.map(child => renderTreeNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // Leaf list item
    return (
      <div
        key={`list-${node.id}`}
        onClick={() => handleChoose(node.id, node.name)}
        className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer text-xs transition-all select-none ${
          isSelected 
            ? 'bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold shadow-2xs' 
            : 'hover:bg-slate-100/80 text-slate-800 font-medium border border-transparent'
        }`}
        style={{ paddingLeft: `${Math.max(12, depth * 18 + 16)}px` }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <BookOpen className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`} />
          <span className="truncate">{node.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isSelected && (
            <span className="text-[10px] px-1.5 py-0.2 bg-indigo-600 text-white rounded-md font-bold flex items-center gap-0.5">
              <Check className="w-2.5 h-2.5" /> 当前
            </span>
          )}
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-mono">
            {node.word_count || 0} 词
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">快速切换词单</h3>
              <p className="text-[11px] text-slate-400">
                当前：<span className="font-semibold text-indigo-600">{currentTitle || '未命名'}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search bar */}
        <div className="p-3 border-b border-slate-100 bg-slate-50/30 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="搜索分类或词单名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[220px]">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-indigo-500" />
              <span>正在加载词单列表...</span>
            </div>
          ) : searchQuery.trim() ? (
            /* Search Results */
            filteredSearchLists.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                没有找到匹配的词单
              </div>
            ) : (
              <div className="space-y-1">
                {filteredSearchLists.map(list => {
                  const isSelected = String(currentListId) === String(list.id);
                  return (
                    <div
                      key={list.id}
                      onClick={() => handleChoose(list.id, list.name)}
                      className={`p-2.5 rounded-xl cursor-pointer text-xs transition-all flex items-center justify-between ${
                        isSelected 
                          ? 'bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold' 
                          : 'hover:bg-slate-50 border border-transparent text-slate-800'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <BookOpen className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`} />
                          <span className="font-bold truncate">{list.name}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5 truncate">{list.path}</p>
                      </div>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0 font-mono">
                        {list.word_count} 词
                      </span>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* Tree View */
            <div className="space-y-3">
              {/* Quick Presets Section */}
              <div className="space-y-1 pb-2 border-b border-slate-100">
                <div className="text-[11px] font-bold text-slate-400 px-2 uppercase tracking-wider">
                  词库全局专区
                </div>
                
                {/* Unassigned Words */}
                <div
                  onClick={() => handleChoose('unassigned', '未归类单词')}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer text-xs transition-all ${
                    currentListId === 'unassigned'
                      ? 'bg-amber-50 border border-amber-200 text-amber-900 font-bold'
                      : 'hover:bg-slate-50 border border-transparent text-slate-800 font-medium'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">📦</span>
                    <span>未归类单词</span>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100/70 text-amber-800 font-semibold font-mono">
                    {wordStats.unassigned_count} 词
                  </span>
                </div>

                {/* All Words */}
                <div
                  onClick={() => handleChoose('all', '全库所有单词')}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer text-xs transition-all ${
                    currentListId === 'all'
                      ? 'bg-indigo-50 border border-indigo-200 text-indigo-800 font-bold'
                      : 'hover:bg-slate-50 border border-transparent text-slate-800 font-medium'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">📋</span>
                    <span>全库所有单词 (平铺)</span>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100/70 text-indigo-700 font-semibold font-mono">
                    {wordStats.total_count} 词
                  </span>
                </div>
              </div>

              {/* Tree Categories */}
              <div className="space-y-0.5">
                <div className="text-[11px] font-bold text-slate-400 px-2 uppercase tracking-wider mb-1">
                  分类与词单
                </div>
                {treeData.map(node => renderTreeNode(node, 0))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
