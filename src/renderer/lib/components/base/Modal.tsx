import React, { useState } from 'react';
import { X } from 'lucide-react';
import IconButton from './IconButton';

interface ModalProps {
  open: boolean;
  /** Called when the user dismisses (backdrop click or close button). */
  onClose: () => void;
  /** When false (or while `locked`), backdrop/close dismissal is disabled. */
  dismissible?: boolean;
  /** Busy phase — hides the close button and blocks backdrop dismissal. */
  locked?: boolean;
  /** Tailwind width class for the panel (defaults to w-[480px]). */
  widthClass?: string;
  children: React.ReactNode;
}

/**
 * Shared modal shell — overlay, backdrop dismissal (mouse-down/up on the
 * overlay itself, so a drag that ends outside doesn't dismiss), rounded panel.
 */
export default function Modal({
  open,
  onClose,
  dismissible = true,
  locked = false,
  widthClass = 'w-[480px]',
  children,
}: ModalProps) {
  const [mouseDownTarget, setMouseDownTarget] = useState<EventTarget | null>(null);
  if (!open) return null;

  const canDismiss = dismissible && !locked;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 bg-overlay/75"
      onMouseDown={e => setMouseDownTarget(e.target)}
      onMouseUp={e => {
        if (canDismiss && mouseDownTarget === e.target && e.target === e.currentTarget) {
          onClose();
        }
        setMouseDownTarget(null);
      }}
    >
      <div
        className={`${widthClass} flex flex-col max-h-[min(92vh,820px)] rounded-xl overflow-hidden shadow-2xl bg-card border border-line-strong`}
      >
        {children}
      </div>
    </div>
  );
}

interface ModalHeaderProps {
  children: React.ReactNode;
  /** When provided, renders a close button on the right. */
  onClose?: () => void;
  /** Hide the close button even when onClose is set (busy phases). */
  locked?: boolean;
}

export function ModalHeader({ children, onClose, locked = false }: ModalHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line/6 flex-shrink-0">
      {children}
      {onClose && !locked && <IconButton icon={X} label="Close" onClick={onClose} />}
    </div>
  );
}

export function ModalBody({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`flex-1 overflow-y-auto ${className}`}>{children}</div>;
}

export function ModalFooter({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-end gap-3 px-5 py-4 border-t border-line/6 flex-shrink-0 ${className}`}
    >
      {children}
    </div>
  );
}
