'use client';

import { useEffect, useRef, useState } from 'react';
import { debounced, flushDebounced, hasDebounced } from '@/lib/client/debounce';

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  /** Unique per field; used to flush this field's pending save on blur / unload. */
  saveKey: string;
  onSave: (v: string) => void;
  /** Render a single-line input instead of a textarea. */
  single?: boolean;
};

/** A text box that saves itself 700 ms after typing stops, on blur, and before the page unloads. */
export function AutoNote({ value, saveKey, onSave, onFocus, onBlur, single, ...rest }: Props) {
  const [v, setV] = useState(value);
  const focused = useRef(false);
  const save = useRef(onSave);
  save.current = onSave;

  // Take updates from other devices, but never while this box is being typed in.
  useEffect(() => {
    if (!focused.current && !hasDebounced(saveKey)) setV(value);
  }, [value, saveKey]);

  const common = {
    value: v,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const nv = e.target.value;
      setV(nv);
      debounced(saveKey, () => save.current(nv), 700);
    },
    onFocus: (e: React.FocusEvent<HTMLTextAreaElement & HTMLInputElement>) => {
      focused.current = true;
      onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent<HTMLTextAreaElement & HTMLInputElement>) => {
      focused.current = false;
      flushDebounced(saveKey);
      onBlur?.(e);
    },
  };
  if (single) return <input {...(rest as React.InputHTMLAttributes<HTMLInputElement>)} {...common} />;
  return <textarea {...rest} {...common} />;
}
