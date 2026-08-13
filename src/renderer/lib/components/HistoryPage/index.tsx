import React from 'react';
import ActivityFeed from '../ActivityFeed';
import Badge from '../base/Badge';
import type { CommitCard } from '../../types';

interface Props {
  commits: CommitCard[];
  isLoading: boolean;
  onRefresh?: () => void;
}

/**
 * Dedicated change-history page — every commit with full date/time, author,
 * and the changed mods/files (via ActivityCard). Shares the commit data loaded
 * by App, so refreshing here refreshes the Home preview too.
 */
export default function HistoryPage({ commits, isLoading, onRefresh }: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-line/6 flex-shrink-0">
        <h2 className="text-foreground font-semibold text-base">Change History</h2>
        <Badge tone="neutral">
          {commits.length} commit{commits.length !== 1 ? 's' : ''}
        </Badge>
      </div>
      <ActivityFeed
        commits={commits}
        isLoading={isLoading}
        hasToken={true}
        onRefresh={onRefresh}
        showHeader={false}
        fullDate
      />
    </div>
  );
}
