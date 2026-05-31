import type { ReactElement, ReactNode } from 'react';

interface PaginationBarProps {
  summary: ReactNode;
  page: number;
  totalPages: number;
  pageInput: string;
  onPageInputChange: (value: string) => void;
  onPageInputCommit: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

export function PaginationBar({
  summary,
  page,
  totalPages,
  pageInput,
  onPageInputChange,
  onPageInputCommit,
  onPrevious,
  onNext,
}: PaginationBarProps): ReactElement {
  const canGoPrevious = page > 1;
  const canGoNext = page < totalPages;

  return (
    <div className="audit-pagination">
      <span>{summary}</span>
      <div className="pagination-controls">
        <button type="button" className="quiet-button compact-button" onClick={onPrevious} disabled={!canGoPrevious}>
          上一页
        </button>
        <label className="pagination-jump">
          <span>第</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={pageInput}
            onChange={(event) => onPageInputChange(event.target.value)}
            onBlur={onPageInputCommit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onPageInputCommit();
              }
            }}
          />
          <span>/ {totalPages} 页</span>
        </label>
        <button type="button" className="secondary-button compact-button" onClick={onNext} disabled={!canGoNext}>
          下一页
        </button>
      </div>
    </div>
  );
}
