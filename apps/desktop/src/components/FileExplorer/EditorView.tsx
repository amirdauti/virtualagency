import React from 'react';
import { X } from 'lucide-react';
import { FileTabs } from './FileTabs';
import { CodeEditor } from './CodeEditor';
import { useFileExplorerStore } from '../../stores/fileExplorerStore';

export const EditorView: React.FC = () => {
  const error = useFileExplorerStore((state) => state.error);
  const openFiles = useFileExplorerStore((state) => state.openFiles);
  const closeFile = useFileExplorerStore((state) => state.closeFile);

  const handleCloseEditor = () => {
    // Check for unsaved changes
    const dirtyFiles = openFiles.filter(f => f.isDirty);
    if (dirtyFiles.length > 0) {
      const fileNames = dirtyFiles.map(f => f.name).join(', ');
      const confirmed = window.confirm(
        `You have unsaved changes in: ${fileNames}\n\nClose anyway?`
      );
      if (!confirmed) {
        return;
      }
    }
    // Close all files
    openFiles.forEach(f => closeFile(f.path));
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#111827',
      overflow: 'hidden',
    }}>
      {/* Editor header with close button */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: '#1e1e2e',
        borderBottom: '1px solid #313244',
        flexShrink: 0,
      }}>
        <span style={{ color: '#cdd6f4', fontSize: 13, fontWeight: 500 }}>
          Editor
        </span>
        <button
          onClick={handleCloseEditor}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            padding: 0,
            background: 'transparent',
            border: 'none',
            borderRadius: 4,
            color: '#a6adc8',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#45475a';
            e.currentTarget.style.color = '#cdd6f4';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = '#a6adc8';
          }}
          title="Close Editor"
        >
          <X size={18} />
        </button>
      </div>
      {error && (
        <div style={{
          background: '#7f1d1d',
          color: '#ffffff',
          padding: '8px 16px',
          fontSize: '14px',
          borderBottom: '1px solid #991b1b',
          flexShrink: 0,
        }}>
          Error: {error}
        </div>
      )}
      <FileTabs />
      <div style={{
        flex: 1,
        overflow: 'hidden',
        minHeight: 0,
      }}>
        <CodeEditor />
      </div>
    </div>
  );
};
