'use client';

import { useEffect, useRef, useState } from 'react';

export function GenerativeText({ text, paused = false }: { text: string; paused?: boolean }) {
  const previous = useRef(text);
  const [copy, setCopy] = useState({ text, length: text.length, phase: 'hold' });
  useEffect(() => {
    if (previous.current === text) return;
    previous.current = text;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCopy({ text, length: text.length, phase: 'hold' });
      return;
    }
    setCopy(current => ({ ...current, phase: 'out' }));
    const timer = setTimeout(() => setCopy({ text, length: 0, phase: 'type' }), 220);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    if (copy.phase !== 'type') return;
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCopy(current => ({ ...current, length: current.text.length, phase: 'hold' }));
      return;
    }
    const timer = setTimeout(() => setCopy(current => ({ ...current, length: current.length + 1,
      phase: current.length + 1 >= current.text.length ? 'hold' : 'type' })), 55);
    return () => clearTimeout(timer);
  }, [copy, paused]);
  return <span className="generative-text" aria-hidden="true" data-phase={copy.phase}>
    {copy.text.slice(0, copy.length)}<i className="auth-caret" />
  </span>;
}
