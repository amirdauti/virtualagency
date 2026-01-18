import React from 'react';
import { FileTabs } from './FileTabs';
import { CodeEditor } from './CodeEditor';
import { useFileExplorerStore } from '../../stores/fileExplorerStore';

export const EditorView: React.FC = () => {
  const error = useFileExplorerStore((state) => state.error);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#111827',
      overflow: 'hidden',
    }}>
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
