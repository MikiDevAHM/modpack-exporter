import React, { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Modal from './base/Modal';
import Button from './base/Button';

interface Props {
  open: boolean;
  title: string;
  description: string;
  details?: string | null;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger' | 'warning';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/** Icon badge styling per variant (success/danger/warning). */
const ICON_CLASSES = {
  default: 'bg-success-strong/10 border-success-strong/30 text-success-strong',
  danger: 'bg-danger/10 border-danger/30 text-danger',
  warning: 'bg-warning-soft/10 border-warning-soft/30 text-warning-soft',
} as const;

/** Solid confirm button per variant. */
const CONFIRM_CLASSES = {
  default: 'bg-success-strong hover:opacity-90',
  danger: 'bg-danger-strong hover:opacity-90',
  warning: 'bg-warning-soft hover:opacity-90',
} as const;

export default function ConfirmDialog({
  open,
  title,
  description,
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: Props) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onCancel} dismissible={false} widthClass="w-[420px]">
      <div className="flex justify-center pt-6 pb-2">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center border ${ICON_CLASSES[variant]}`}
        >
          <AlertTriangle size={20} />
        </div>
      </div>

      <div className="px-6 text-center">
        <h3 className="text-foreground font-semibold text-[15px] mb-2">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        {details && (
          <div className="mt-3 p-3 rounded-lg text-xs text-left font-mono whitespace-pre-wrap max-h-[120px] overflow-y-auto leading-relaxed bg-subtle border border-line/6 text-muted-foreground">
            {details}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 px-6 py-4 mt-2">
        <Button variant="ghost" disabled={loading} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <button
          onClick={handleConfirm}
          disabled={loading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-on-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed ${CONFIRM_CLASSES[variant]}`}
        >
          {loading && <Loader2 size={13} className="animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
