import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

interface Props {
  button: ReactNode;
  buttonClass: string;
  buttonLabel: string;
  items: MenuItem[];
  align?: 'left' | 'right';
}

/** Button that opens a small list of actions. Closes on outside click or Escape. */
export default function Menu({ button, buttonClass, buttonLabel, items, align = 'right' }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button type="button" aria-expanded={open} aria-label={buttonLabel} className={buttonClass} onClick={() => setOpen((o) => !o)}>
        {button}
      </button>
      {open && (
        <div className={`absolute z-20 mt-2 min-w-52 rounded-xl border border-line bg-white p-1.5 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {items.map((it) => (
            <button
              key={it.label} type="button"
              onClick={() => { setOpen(false); it.onSelect(); }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left font-medium hover:bg-wash ${it.danger ? 'text-rec' : ''}`}
            >
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}