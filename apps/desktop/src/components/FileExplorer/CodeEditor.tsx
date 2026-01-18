import React, { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { useFileExplorerStore } from '../../stores/fileExplorerStore';

export const CodeEditor: React.FC = () => {
  const { openFiles, activeFilePath, updateFileContent, saveFile } = useFileExplorerStore();
  const editorRef = useRef<any>(null);

  const activeFile = openFiles.find(f => f.path === activeFilePath);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (activeFilePath) {
          saveFile(activeFilePath);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFilePath, saveFile]);

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined && activeFilePath) {
      updateFileContent(activeFilePath, value);
    }
  };

  const getLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      json: 'json',
      html: 'html',
      css: 'css',
      scss: 'scss',
      md: 'markdown',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      php: 'php',
      rb: 'ruby',
      sh: 'shell',
      bash: 'shell',
      yml: 'yaml',
      yaml: 'yaml',
      toml: 'toml',
      xml: 'xml',
      sql: 'sql',
    };
    return languageMap[ext || ''] || 'plaintext';
  };

  if (!activeFile) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#111827',
        color: '#9ca3af',
      }}>
        <p>No file selected</p>
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      background: '#111827',
      overflow: 'hidden',
    }}>
      <Editor
        key={activeFile.path}
        height="100%"
        language={getLanguage(activeFile.name)}
        value={activeFile.content}
        onChange={handleEditorChange}
        onMount={handleEditorDidMount}
        theme="vs-dark"
        options={{
          minimap: { enabled: true },
          fontSize: 14,
          lineNumbers: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          wordWrap: 'off',
          tabSize: 2,
        }}
      />
    </div>
  );
};
