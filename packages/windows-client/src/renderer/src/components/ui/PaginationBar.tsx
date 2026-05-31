import type { ReactElement, ReactNode } from 'react';

interface PaginationBarProps {
  summary: ReactNode;
  hasMore: boolean;
  loadingLabel?: string;
  nextLabel: string;
  onNext: () => void;
}

export function PaginationBar({
  summary,
  hasMore,
  loadingLabel = '没有更多',
  nextLabel,
  onNext,
}: PaginationBarProps): ReactElement {
  return (
    <div className="audit-pagination">
      <span>{summary}</span>
      <button type="button" className="secondary-button" onClick={onNext} disabled={!hasMore}>
        {hasMore ? nextLabel : loadingLabel}
      </button>
    </div>
  );
}
