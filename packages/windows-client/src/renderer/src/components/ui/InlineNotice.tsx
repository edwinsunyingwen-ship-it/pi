import type { ReactElement } from 'react';

interface InlineNoticeProps {
  tone: 'info' | 'success' | 'error';
  text: string;
}

export function InlineNotice({ tone, text }: InlineNoticeProps): ReactElement {
  return <div className={`inline-notice ${tone}`}>{text}</div>;
}
