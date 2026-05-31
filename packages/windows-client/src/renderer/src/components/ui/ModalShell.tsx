import { X } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

interface ModalShellProps {
  title: ReactNode;
  icon?: ReactNode;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
  onClose: () => void;
}

export function ModalShell({
  title,
  icon,
  ariaLabel,
  className,
  children,
  onClose,
}: ModalShellProps): ReactElement {
  const panelClassName = className ? `modal-panel ${className}` : 'modal-panel';

  return (
    <div className="modal-backdrop" role="presentation">
      <section className={panelClassName} role="dialog" aria-modal="true" aria-label={ariaLabel}>
        <div className="panel-heading with-action">
          <div>
            {icon}
            <h3>{title}</h3>
          </div>
          <button type="button" className="modal-close-button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
