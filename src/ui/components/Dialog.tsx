import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/** Modaler Dialog auf Basis von <dialog> (Fokusfalle und Escape vom Browser). */
export function Dialog({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    if (!el.open) el.showModal();
    return () => {
      if (el.open) el.close();
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      class="dialog"
      aria-labelledby={titleId}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Klick auf den Hintergrund schließt
        if (e.target === ref.current) onClose();
      }}
    >
      <div class="dialog-body">
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
