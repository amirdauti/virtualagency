import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Loader2,
  Search,
  X,
  FolderClosed,
  FolderOpen,
  FileText,
  FileCode,
  FileJson,
  Image,
  FileType,
  Settings,
  Package,
  Database,
  Terminal,
  FileCode2,
  Braces,
} from 'lucide-react';
import { FileNode, useFileExplorerStore } from '../../stores/fileExplorerStore';
import { getFileIconInfo, getFolderColor } from '../../lib/fileIcons';

// Get specific icon component based on file extension
function getFileIcon(filename: string): { Icon: React.ElementType; color: string } {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const iconInfo = getFileIconInfo(filename);

  // Map extensions to specific icons
  const iconMap: Record<string, React.ElementType> = {
    ts: FileCode,
    tsx: FileCode,
    js: FileCode,
    jsx: FileCode,
    json: FileJson,
    md: FileText,
    txt: FileText,
    png: Image,
    jpg: Image,
    jpeg: Image,
    gif: Image,
    svg: Image,
    webp: Image,
    ico: Image,
    yml: Settings,
    yaml: Settings,
    toml: Settings,
    env: Settings,
    gitignore: Settings,
    sql: Database,
    db: Database,
    sh: Terminal,
    bash: Terminal,
    zsh: Terminal,
    rs: FileCode2,
    go: FileCode2,
    py: FileCode2,
    rb: FileCode2,
    java: FileCode2,
    css: Braces,
    scss: Braces,
    less: Braces,
    html: FileCode,
    htm: FileCode,
  };

  // Special filenames
  if (filename === 'package.json' || filename === 'package-lock.json') {
    return { Icon: Package, color: '#cb3837' };
  }
  if (filename === 'Cargo.toml' || filename === 'Cargo.lock') {
    return { Icon: Package, color: '#dea584' };
  }
  if (filename.includes('config') || filename.startsWith('.')) {
    return { Icon: Settings, color: iconInfo.color };
  }

  return {
    Icon: iconMap[ext] || FileType,
    color: iconInfo.color,
  };
}

interface FileTreeNodeProps {
  node: FileNode;
  level: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  searchQuery: string;
}

const FileTreeNode: React.FC<FileTreeNodeProps> = ({
  node,
  level,
  selectedPath,
  onSelect,
  expandedPaths,
  onToggleExpand,
  searchQuery,
}) => {
  const { openFile } = useFileExplorerStore();
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;

  // Filter logic for search
  const matchesSearch = useMemo(() => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    if (node.name.toLowerCase().includes(query)) return true;
    if (node.children) {
      return node.children.some(child =>
        child.name.toLowerCase().includes(query) ||
        (child.is_directory && child.children?.some(c => c.name.toLowerCase().includes(query)))
      );
    }
    return false;
  }, [node, searchQuery]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(node.path);

    if (node.is_directory) {
      onToggleExpand(node.path);
    } else {
      openFile(node.path, node.name);
    }
  }, [node, onSelect, onToggleExpand, openFile]);

  // Get icon
  const { Icon: FileIcon, color: iconColor } = useMemo(() => {
    if (node.is_directory) {
      return { Icon: isExpanded ? FolderOpen : FolderClosed, color: getFolderColor(node.name) };
    }
    return getFileIcon(node.name);
  }, [node.is_directory, node.name, isExpanded]);

  // Sort children: directories first, then files, both alphabetically
  const sortedChildren = useMemo(() => {
    if (!node.children) return [];
    return [...node.children].sort((a, b) => {
      if (a.is_directory && !b.is_directory) return -1;
      if (!a.is_directory && b.is_directory) return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [node.children]);

  // Highlight matching text
  const highlightMatch = useCallback((text: string) => {
    if (!searchQuery) return text;
    const index = text.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (index === -1) return text;
    return (
      <>
        {text.slice(0, index)}
        <span className="bg-yellow-500/30 text-yellow-200">{text.slice(index, index + searchQuery.length)}</span>
        {text.slice(index + searchQuery.length)}
      </>
    );
  }, [searchQuery]);

  if (!matchesSearch) return null;

  const indent = level * 12;

  return (
    <>
      <div
        className={`
          group flex items-center h-[24px] cursor-pointer pr-2
          transition-colors duration-[50ms]
          ${isSelected
            ? 'bg-[#37373d] text-white'
            : 'text-[#cccccc] hover:bg-[#2a2d2e]'
          }
        `}
        style={{ paddingLeft: `${indent + 4}px` }}
        onClick={handleClick}
        role="treeitem"
        aria-expanded={node.is_directory ? isExpanded : undefined}
        aria-selected={isSelected}
      >
        {/* Indent guide lines */}
        {level > 0 && (
          <div
            className="absolute left-0 top-0 bottom-0 pointer-events-none"
            style={{ width: `${indent}px` }}
          >
            {Array.from({ length: level }).map((_, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 w-px bg-[#404040] opacity-50"
                style={{ left: `${(i + 1) * 12 + 6}px` }}
              />
            ))}
          </div>
        )}

        {/* Expand/collapse arrow */}
        <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
          {node.is_directory ? (
            isExpanded ? (
              <ChevronDown className="w-4 h-4 text-[#c5c5c5]" />
            ) : (
              <ChevronRight className="w-4 h-4 text-[#c5c5c5]" />
            )
          ) : (
            <span className="w-4" />
          )}
        </span>

        {/* File/Folder icon */}
        <FileIcon
          className="w-4 h-4 flex-shrink-0 mr-[6px]"
          style={{ color: iconColor }}
        />

        {/* File/Folder name */}
        <span className="truncate text-[13px] leading-[24px]" title={node.path}>
          {highlightMatch(node.name)}
        </span>
      </div>

      {/* Children */}
      {node.is_directory && isExpanded && sortedChildren.length > 0 && (
        <div role="group">
          {sortedChildren.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </>
  );
};

export const FileTree: React.FC = () => {
  const { fileTree, isLoading, error, loadFileTree } = useFileExplorerStore();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-expand root on load
  useEffect(() => {
    if (fileTree && !expandedPaths.has(fileTree.path)) {
      setExpandedPaths(new Set([fileTree.path]));
    }
  }, [fileTree]);

  // Focus search input when shown
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearch]);

  // Auto-expand folders when searching
  useEffect(() => {
    if (searchQuery && fileTree) {
      const pathsToExpand = new Set<string>();

      const findMatches = (node: FileNode, parentPaths: string[]) => {
        const matches = node.name.toLowerCase().includes(searchQuery.toLowerCase());
        if (matches) {
          parentPaths.forEach(p => pathsToExpand.add(p));
        }
        if (node.children) {
          node.children.forEach(child => {
            findMatches(child, [...parentPaths, node.path]);
          });
        }
      };

      findMatches(fileTree, []);
      if (pathsToExpand.size > 0) {
        setExpandedPaths(prev => new Set([...prev, ...pathsToExpand]));
      }
    }
  }, [searchQuery, fileTree]);

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadFileTree();
    setIsRefreshing(false);
  }, [loadFileTree]);

  const handleCollapseAll = useCallback(() => {
    if (fileTree) {
      setExpandedPaths(new Set([fileTree.path]));
    }
  }, [fileTree]);


  if (isLoading && !isRefreshing) {
    return (
      <div className="h-full flex flex-col bg-[#1e1e1e]">
        <div className="flex items-center justify-center h-full">
          <div className="flex items-center gap-2 text-[#969696]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[13px]">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col bg-[#1e1e1e]">
        <div className="flex items-center justify-center h-full px-4">
          <div className="text-center">
            <p className="text-red-400 text-[13px] mb-2">Failed to load files</p>
            <p className="text-[#969696] text-[11px] mb-3">{error}</p>
            <button
              onClick={handleRefresh}
              className="px-3 py-1.5 text-[11px] bg-[#0e639c] text-white rounded hover:bg-[#1177bb] transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!fileTree) {
    return (
      <div className="h-full flex flex-col bg-[#1e1e1e]">
        <div className="flex items-center justify-center h-full">
          <p className="text-[#969696] text-[13px]">No files to display</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#1e1e1e]">
      {/* Header */}
      <div className="flex items-center justify-between px-2 h-[35px] text-[11px] font-medium uppercase tracking-wide border-b border-[#3c3c3c] flex-shrink-0 bg-[#252526]">
        <span className="text-[#bbbbbb] pl-2">Explorer</span>
        <div className="flex items-center">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`p-1.5 rounded transition-colors ${showSearch ? 'bg-[#37373d] text-white' : 'text-[#c5c5c5] hover:bg-[#37373d]'}`}
            title="Search Files (Cmd+F)"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded text-[#c5c5c5] hover:bg-[#37373d] transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleCollapseAll}
            className="p-1.5 rounded text-[#c5c5c5] hover:bg-[#37373d] transition-colors"
            title="Collapse All"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M9 9H4v1h5V9z" />
              <path fillRule="evenodd" clipRule="evenodd" d="M5 3l1-1h7l1 1v7l-1 1h-2v2l-1 1H3l-1-1V6l1-1h2V3zm1 2h4l1 1v4h2V3H6v2zm4 1H3v7h7V6z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search box */}
      {showSearch && (
        <div className="px-2 py-2 border-b border-[#3c3c3c] bg-[#252526]">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#969696]" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files..."
              className="w-full h-[26px] pl-9 pr-8 text-[13px] bg-[#3c3c3c] border border-[#3c3c3c] focus:border-[#007fd4] rounded text-white placeholder-[#969696] outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#969696] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Folder header */}
      <div
        className="flex items-center h-[22px] px-2 text-[11px] font-semibold text-[#bbbbbb] bg-[#252526] cursor-pointer hover:bg-[#2a2d2e] border-b border-[#3c3c3c]"
        onClick={() => handleToggleExpand(fileTree.path)}
      >
        {expandedPaths.has(fileTree.path) ? (
          <ChevronDown className="w-4 h-4 mr-1" />
        ) : (
          <ChevronRight className="w-4 h-4 mr-1" />
        )}
        <span className="uppercase tracking-wide truncate">{fileTree.name}</span>
      </div>

      {/* Tree */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden relative"
        role="tree"
        aria-label="File Explorer"
      >
        {expandedPaths.has(fileTree.path) && fileTree.children && (
          [...fileTree.children]
            .sort((a, b) => {
              if (a.is_directory && !b.is_directory) return -1;
              if (!a.is_directory && b.is_directory) return 1;
              return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            })
            .map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                level={0}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                expandedPaths={expandedPaths}
                onToggleExpand={handleToggleExpand}
                searchQuery={searchQuery}
              />
            ))
        )}
      </div>
    </div>
  );
};
