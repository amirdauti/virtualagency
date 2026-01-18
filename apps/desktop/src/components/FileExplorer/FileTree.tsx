import React, { useState } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import { FileNode, useFileExplorerStore } from '../../stores/fileExplorerStore';

interface FileTreeNodeProps {
  node: FileNode;
  level: number;
}

const FileTreeNode: React.FC<FileTreeNodeProps> = ({ node, level }) => {
  const [isExpanded, setIsExpanded] = useState(level === 0);
  const { openFile } = useFileExplorerStore();

  const handleClick = () => {
    if (node.is_directory) {
      setIsExpanded(!isExpanded);
    } else {
      openFile(node.path, node.name);
    }
  };

  const paddingLeft = level * 12 + 8;

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-1 hover:bg-gray-700 cursor-pointer text-sm"
        style={{ paddingLeft: `${paddingLeft}px` }}
        onClick={handleClick}
      >
        {node.is_directory && (
          <span className="w-4 h-4 flex items-center justify-center">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-gray-400" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-400" />
            )}
          </span>
        )}
        {!node.is_directory && <span className="w-4" />}

        <span className="w-4 h-4 flex items-center justify-center">
          {node.is_directory ? (
            isExpanded ? (
              <FolderOpen className="w-4 h-4 text-blue-400" />
            ) : (
              <Folder className="w-4 h-4 text-blue-400" />
            )
          ) : (
            <File className="w-4 h-4 text-gray-400" />
          )}
        </span>

        <span className="text-gray-200 truncate">{node.name}</span>
      </div>

      {node.is_directory && isExpanded && node.children && (
        <div>
          {node.children.map((child, index) => (
            <FileTreeNode key={`${child.path}-${index}`} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const FileTree: React.FC = () => {
  const { fileTree, isLoading, error } = useFileExplorerStore();

  if (isLoading) {
    return <div className="p-4 text-gray-400">Loading files...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-400">Error: {error}</div>;
  }

  if (!fileTree) {
    return <div className="p-4 text-gray-400">No files loaded</div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-800 text-white">
      <FileTreeNode node={fileTree} level={0} />
    </div>
  );
};
