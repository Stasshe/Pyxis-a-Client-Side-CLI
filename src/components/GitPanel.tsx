'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { GitBranch, GitCommit, RefreshCw, Plus, Check, X, GitMerge, Clock, User, Minus, RotateCcw } from 'lucide-react';
import { GitRepository, GitCommit as GitCommitType, GitStatus } from '@/types/git';
import { GitCommands } from '@/utils/cmd/git';

// メモ化されたファイルリスト項目コンポーネント
const FileListItem = React.memo(({ 
  file, 
  type, 
  onStage, 
  onUnstage, 
  onDiscard 
}: { 
  file: string;
  type: 'staged' | 'unstaged' | 'untracked';
  onStage?: (file: string) => void;
  onUnstage?: (file: string) => void;
  onDiscard?: (file: string) => void;
}) => {
  const colorClass = type === 'staged' ? 'text-green-600' : 
                    type === 'unstaged' ? 'text-orange-600' : 'text-blue-600';
  
  return (
    <div className="flex items-center justify-between text-xs py-1">
      <span className={`${colorClass} flex-1 truncate`}>{file}</span>
      <div className="flex gap-1">
        {type === 'staged' && onUnstage && (
          <button
            onClick={() => onUnstage(file)}
            className="p-1 hover:bg-muted rounded"
            title="アンステージング"
          >
            <Minus className="w-3 h-3" />
          </button>
        )}
        {(type === 'unstaged' || type === 'untracked') && onStage && (
          <button
            onClick={() => onStage(file)}
            className="p-1 hover:bg-muted rounded"
            title="ステージング"
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
        {(type === 'unstaged' || type === 'untracked') && onDiscard && (
          <button
            onClick={() => onDiscard(file)}
            className="p-1 hover:bg-muted rounded text-red-500"
            title={type === 'untracked' ? 'ファイルを削除' : '変更を破棄'}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
});
FileListItem.displayName = 'FileListItem';

// ファイルリストセクションのメモ化コンポーネント
const FileListSection = React.memo(({ 
  title, 
  files, 
  type, 
  onStage, 
  onUnstage, 
  onDiscard 
}: {
  title: string;
  files: string[];
  type: 'staged' | 'unstaged' | 'untracked';
  onStage?: (file: string) => void;
  onUnstage?: (file: string) => void;
  onDiscard?: (file: string) => void;
}) => {
  if (files.length === 0) return null;
  
  const colorClass = type === 'staged' ? 'text-green-600' : 
                    type === 'unstaged' ? 'text-orange-600' : 'text-blue-600';
  
  return (
    <div>
      <p className={`text-xs ${colorClass} mb-1`}>{title} ({files.length})</p>
      {files.map((file) => (
        <FileListItem
          key={`${type}-${file}`}
          file={file}
          type={type}
          onStage={onStage}
          onUnstage={onUnstage}
          onDiscard={onDiscard}
        />
      ))}
    </div>
  );
});
FileListSection.displayName = 'FileListSection';

interface GitPanelProps {
  currentProject?: string;
  onRefresh?: () => void;
  gitRefreshTrigger?: number;
  onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string) => Promise<void>;
  onGitStatusChange?: (changesCount: number) => void; // Git変更状態のコールバック
}

export default function GitPanel({ currentProject, onRefresh, gitRefreshTrigger, onFileOperation, onGitStatusChange }: GitPanelProps) {
  const [gitRepo, setGitRepo] = useState<GitRepository | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Git操作用のコマンドインスタンス（メモ化）
  const gitCommands = useMemo(() => {
    return currentProject ? new GitCommands(currentProject, onFileOperation) : null;
  }, [currentProject, onFileOperation]);

  // Git logをパースしてコミット配列に変換（メモ化）
  const parseGitLog = useCallback((logOutput: string): GitCommitType[] => {
    if (!logOutput.trim()) {
      return [];
    }

    const lines = logOutput.split('\n').filter(line => line.trim());
    const commits: GitCommitType[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split('|');
      
      // 正確に4つのパーツがあることを確認
      if (parts.length === 4) {
        const hash = parts[0]?.trim();
        const message = parts[1]?.trim();
        const author = parts[2]?.trim();
        const date = parts[3]?.trim();
        
        // 全てのフィールドが有効であることを確認
        if (hash && hash.length >= 7 && message && author && date) {
          try {
            const timestamp = new Date(date).getTime();
            if (!isNaN(timestamp)) {
              commits.push({
                hash,
                shortHash: hash.substring(0, 7),
                message: message.replace(/｜/g, '|'), // 安全な文字を元に戻す
                author: author.replace(/｜/g, '|'),
                date,
                timestamp,
                branch: 'main',
                isMerge: message.toLowerCase().includes('merge'),
                parentHashes: []
              });
            }
          } catch (dateError) {
            // Date parsing error, skip this commit
          }
        }
      }
    }
    
    return commits.sort((a, b) => b.timestamp - a.timestamp);
  }, []);

  // Git branchをパース（メモ化）
  const parseGitBranches = useCallback((branchOutput: string) => {
    return branchOutput.split('\n')
      .filter(line => line.trim())
      .map(line => ({
        name: line.replace(/^\*\s*/, '').trim(),
        isCurrent: line.startsWith('*'),
        isRemote: line.includes('remotes/'),
        lastCommit: undefined
      }));
  }, []);

  // Git statusをパース（メモ化）
  const parseGitStatus = useCallback((statusOutput: string): GitStatus => {
    console.log('[GitPanel] Parsing git status output:', statusOutput);
    const lines = statusOutput.split('\n');
    const status: GitStatus = {
      staged: [],
      unstaged: [],
      untracked: [],
      branch: 'main',
      ahead: 0,
      behind: 0
    };

    let inChangesToBeCommitted = false;
    let inChangesNotStaged = false;
    let inUntrackedFiles = false;

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.includes('On branch')) {
        status.branch = trimmed.replace('On branch ', '').trim();
        console.log('[GitPanel] Found branch:', status.branch);
      } else if (trimmed === 'Changes to be committed:') {
        inChangesToBeCommitted = true;
        inChangesNotStaged = false;
        inUntrackedFiles = false;
        console.log('[GitPanel] Entering staged files section');
      } else if (trimmed === 'Changes not staged for commit:') {
        inChangesToBeCommitted = false;
        inChangesNotStaged = true;
        inUntrackedFiles = false;
        console.log('[GitPanel] Entering unstaged files section');
      } else if (trimmed === 'Untracked files:') {
        inChangesToBeCommitted = false;
        inChangesNotStaged = false;
        inUntrackedFiles = true;
        console.log('[GitPanel] Entering untracked files section');
      } else if (trimmed.startsWith('modified:') || trimmed.startsWith('new file:') || trimmed.startsWith('deleted:')) {
        const fileName = trimmed.split(':')[1]?.trim();
        if (fileName) {
          if (inChangesToBeCommitted) {
            status.staged.push(fileName);
            console.log('[GitPanel] Found staged file:', fileName);
          } else if (inChangesNotStaged) {
            status.unstaged.push(fileName);
            console.log('[GitPanel] Found unstaged file:', fileName);
          }
        }
      } else if (inUntrackedFiles && trimmed && 
                 !trimmed.startsWith('(') && 
                 !trimmed.includes('git add') && 
                 !trimmed.includes('use "git add"') &&
                 !trimmed.includes('to include')) {
        // フォルダ（末尾に/があるもの）は除外
        if (!trimmed.endsWith('/')) {
          status.untracked.push(trimmed);
          console.log('[GitPanel] Found untracked file:', trimmed);
        }
      }
    }

    console.log('[GitPanel] Final parsed status:', {
      staged: status.staged,
      unstaged: status.unstaged,
      untracked: status.untracked,
      total: status.staged.length + status.unstaged.length + status.untracked.length
    });

    return status;
  }, []);

  // Git状態を取得（メモ化）
  const fetchGitStatus = useCallback(async () => {
    if (!gitCommands || !currentProject) return;

    try {
      setIsLoading(true);
      setError(null);
      
      console.log('[GitPanel] Fetching git status...');
      
      // ファイルシステムの同期を確実にする
      const fs = (gitCommands as any).fs;
      if (fs && (fs as any).sync) {
        try {
          await (fs as any).sync();
          console.log('[GitPanel] FileSystem synced before status check');
        } catch (syncError) {
          console.warn('[GitPanel] FileSystem sync failed:', syncError);
        }
      }
      
      // ファイルシステムの変更反映待機時間を短縮（ちらつき軽減）
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Git状態を並行して取得
      const [statusResult, logResult, branchResult] = await Promise.all([
        gitCommands.status(),
        gitCommands.getFormattedLog(20),
        gitCommands.branch()
      ]);

      console.log('[GitPanel] Git status result:', statusResult);

      // コミット履歴をパース
      const commits = parseGitLog(logResult);
      
      // ブランチ情報をパース
      const branches = parseGitBranches(branchResult);
      
      // ステータス情報をパース
      const status = parseGitStatus(statusResult);
      
      console.log('[GitPanel] Parsed status:', {
        staged: status.staged,
        unstaged: status.unstaged,
        untracked: status.untracked
      });

      setGitRepo({
        initialized: true,
        branches,
        commits,
        status,
        currentBranch: status.branch
      });

      // 変更ファイル数を計算してコールバックで通知
      if (onGitStatusChange) {
        const changesCount = status.staged.length + status.unstaged.length + status.untracked.length;
        console.log('[GitPanel] Notifying changes count:', changesCount);
        onGitStatusChange(changesCount);
      }
    } catch (error) {
      console.error('Failed to fetch git status:', error);
      setError(error instanceof Error ? error.message : 'Git操作でエラーが発生しました');
      setGitRepo(null);
      // エラー時は変更ファイル数を0にリセット
      if (onGitStatusChange) {
        onGitStatusChange(0);
      }
    } finally {
      setIsLoading(false);
    }
  }, [gitCommands, currentProject, onGitStatusChange, parseGitLog, parseGitBranches, parseGitStatus]);

  // ファイルをステージング（メモ化）
  const handleStageFile = useCallback(async (file: string) => {
    if (!gitCommands) return;
    
    try {
      console.log('[GitPanel] Staging file:', file);
      await gitCommands.add(file);
      
      // ステージング後短時間で状態を更新（ちらつき軽減）
      setTimeout(() => {
        console.log('[GitPanel] Refreshing status after staging');
        fetchGitStatus();
      }, 200);
    } catch (error) {
      console.error('Failed to stage file:', error);
    }
  }, [gitCommands, fetchGitStatus]);

  // ファイルをアンステージング（メモ化）
  const handleUnstageFile = useCallback(async (file: string) => {
    if (!gitCommands) return;
    
    try {
      await gitCommands.reset({ filepath: file });
      fetchGitStatus();
    } catch (error) {
      console.error('Failed to unstage file:', error);
    }
  }, [gitCommands, fetchGitStatus]);

  // 全ファイルをステージング（メモ化）
  const handleStageAll = useCallback(async () => {
    if (!gitCommands) return;
    
    try {
      console.log('[GitPanel] Staging all files');
      await gitCommands.add('.');
      
      // ステージング後短時間で状態を更新（ちらつき軽減）
      setTimeout(() => {
        console.log('[GitPanel] Refreshing status after staging all');
        fetchGitStatus();
      }, 300);
    } catch (error) {
      console.error('Failed to stage all files:', error);
    }
  }, [gitCommands, fetchGitStatus]);

  // 全ファイルをアンステージング（メモ化）
  const handleUnstageAll = useCallback(async () => {
    if (!gitCommands) return;
    
    try {
      await gitCommands.reset();
      fetchGitStatus();
    } catch (error) {
      console.error('Failed to unstage all files:', error);
    }
  }, [gitCommands, fetchGitStatus]);

  // ファイルの変更を破棄（メモ化）
  const handleDiscardChanges = useCallback(async (file: string) => {
    if (!gitCommands) return;
    
    try {
      const result = await gitCommands.discardChanges(file);
      
      // 少し待ってからGit状態を更新（ファイルシステムの同期を待つ）
      setTimeout(async () => {
        await fetchGitStatus();
        
        // 親コンポーネントにも更新を通知
        if (onRefresh) {
          onRefresh();
        }
      }, 200);
      
    } catch (error) {
      console.error('Failed to discard changes:', error);
    }
  }, [gitCommands, fetchGitStatus, onRefresh]);

  // コミット実行（メモ化）
  const handleCommit = useCallback(async () => {
    if (!gitCommands || !commitMessage.trim()) return;
    
    try {
      setIsCommitting(true);
      await gitCommands.commit(commitMessage.trim());
      setCommitMessage('');
      fetchGitStatus();
      onRefresh?.();
    } catch (error) {
      console.error('Failed to commit:', error);
    } finally {
      setIsCommitting(false);
    }
  }, [gitCommands, commitMessage, fetchGitStatus, onRefresh]);

  // 初期化とプロジェクト変更時の更新
  useEffect(() => {
    if (currentProject) {
      fetchGitStatus();
    }
  }, [currentProject, fetchGitStatus]);

  // Git更新トリガーが変更されたときの更新
  useEffect(() => {
    if (currentProject && gitRefreshTrigger !== undefined && gitRefreshTrigger > 0) {
      console.log('[GitPanel] Git refresh trigger fired:', gitRefreshTrigger);
      // ファイル同期完了を待つ時間を短縮（ちらつき軽減）
      const timer = setTimeout(() => {
        console.log('[GitPanel] Executing delayed git status fetch');
        fetchGitStatus();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [gitRefreshTrigger, currentProject, fetchGitStatus]);

  // 変更があるかどうかの計算（メモ化）
  const hasChanges = useMemo(() => {
    if (!gitRepo) return false;
    return gitRepo.status.staged.length > 0 || 
           gitRepo.status.unstaged.length > 0 || 
           gitRepo.status.untracked.length > 0;
  }, [gitRepo]);

  if (!currentProject) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">プロジェクトを選択してください</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
        <p className="text-sm">Git状態を読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-red-500">
        <X className="w-8 h-8 mx-auto mb-2" />
        <p className="text-sm mb-2">エラーが発生しました</p>
        <p className="text-xs text-muted-foreground">{error}</p>
        <button
          onClick={fetchGitStatus}
          className="mt-2 px-3 py-1 text-xs bg-muted hover:bg-muted/80 rounded"
        >
          再試行
        </button>
      </div>
    );
  }

  if (!gitRepo) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Git情報を取得できませんでした</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card">
      {/* ヘッダー */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            Git
          </h3>
          <button
            onClick={fetchGitStatus}
            className="p-1 hover:bg-muted rounded"
            title="更新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">{gitRepo.currentBranch}</span>
          {gitRepo.commits.length > 0 && (
            <span className="ml-2">• {gitRepo.commits.length} コミット</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 変更ファイル */}
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium">変更</h4>
            {hasChanges && (
              <div className="flex gap-1">
                <button
                  onClick={handleStageAll}
                  className="p-1 hover:bg-muted rounded text-xs"
                  title="全てステージング"
                >
                  <Plus className="w-3 h-3" />
                </button>
                <button
                  onClick={handleUnstageAll}
                  className="p-1 hover:bg-muted rounded text-xs"
                  title="全てアンステージング"
                >
                  <Minus className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {!hasChanges ? (
            <p className="text-xs text-muted-foreground">変更はありません</p>
          ) : (
            <div className="space-y-1">
              <FileListSection
                title="ステージ済み"
                files={gitRepo.status.staged}
                type="staged"
                onUnstage={handleUnstageFile}
              />
              <FileListSection
                title="変更済み"
                files={gitRepo.status.unstaged}
                type="unstaged"
                onStage={handleStageFile}
                onDiscard={handleDiscardChanges}
              />
              <FileListSection
                title="未追跡"
                files={gitRepo.status.untracked}
                type="untracked"
                onStage={handleStageFile}
                onDiscard={handleDiscardChanges}
              />
            </div>
          )}
        </div>

        {/* コミット */}
        {gitRepo.status.staged.length > 0 && (
          <div className="p-3 border-b border-border">
            <h4 className="text-sm font-medium mb-2">コミット</h4>
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="コミットメッセージを入力..."
              className="w-full h-16 text-xs border border-border rounded px-2 py-1 resize-none bg-background"
            />
            <button
              onClick={handleCommit}
              disabled={!commitMessage.trim() || isCommitting}
              className="w-full mt-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1 rounded text-xs font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isCommitting ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <GitCommit className="w-3 h-3" />
              )}
              {isCommitting ? 'コミット中...' : 'コミット'}
            </button>
          </div>
        )}

        {/* コミット履歴 */}
        <div className="p-3">
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            履歴 ({gitRepo.commits.length})
          </h4>
          
          {gitRepo.commits.length === 0 ? (
            <p className="text-xs text-muted-foreground">コミット履歴がありません</p>
          ) : (
            <div className="space-y-2">
              {gitRepo.commits.slice(0, 10).map((commit) => (
                <div key={commit.hash} className="border border-border rounded p-2 bg-muted/30">
                  <div className="flex items-start gap-2">
                    {commit.isMerge ? (
                      <GitMerge className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
                    ) : (
                      <GitCommit className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{commit.message}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <User className="w-3 h-3" />
                        <span>{commit.author}</span>
                        <span>•</span>
                        <span>{commit.shortHash}</span>
                        <span>•</span>
                        <span>{new Date(commit.timestamp).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
