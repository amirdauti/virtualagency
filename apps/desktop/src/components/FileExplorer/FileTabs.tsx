import React from 'react';
import { X } from 'lucide-react';
import { useFileExplorerStore } from '../../stores/fileExplorerStore';

export const FileTabs: React.FC = () => {
  const { openFiles, activeFilePath, setActiveFile, closeFile } = useFileExplorerStore();

  const handleCloseFile = (file: typeof openFiles[0]) => {
    if (file.isDirty) {
      const confirmed = window.confirm(
        `${file.name} has unsaved changes. Close without saving?`
      );
      if (!confirmed) return;
    }
    closeFile(file.path);
  };

  if (openFiles.length === 0) {
    return null;
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      background: '#1f2937',
      borderBottom: '1px solid #374151',
      overflowX: 'auto',
      height: '40px',
      flexShrink: 0,
    }}>
      {openFiles.map((file) => (
        <div
          key={file.path}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            borderRight: '1px solid #374151',
            cursor: 'pointer',
            transition: 'background-color 0.2s',
            background: activeFilePath === file.path ? '#111827' : '#1f2937',
            color: activeFilePath === file.path ? '#ffffff' : '#d1d5db',
          }}
          onClick={() => setActiveFile(file.path)}
          onMouseEnter={(e) => {
            if (activeFilePath !== file.path) {
              e.currentTarget.style.background = '#374151';
            }
          }}
          onMouseLeave={(e) => {
            if (activeFilePath !== file.path) {
              e.currentTarget.style.background = '#1f2937';
            }
          }}
        >
          <span style={{
            fontSize: '13px',
            whiteSpace: 'nowrap',
          }}>
            {file.name}
            {file.isDirty && <span style={{ marginLeft: '4px', color: '#60a5fa' }}>●</span>}
          </span>
          <button
            style={{
              padding: '2px',
              borderRadius: '3px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'inherit',
            }}
            onClick={(e) => {
              e.stopPropagation();
              handleCloseFile(file);
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#4b5563';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <X style={{ width: '14px', height: '14px' }} />
          </button>
        </div>
      ))}
    </div>
  );
};
