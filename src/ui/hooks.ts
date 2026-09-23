import { createContext } from 'preact';
import { useContext, useEffect, useReducer, useRef, useState } from 'preact/hooks';
import type { AppState, Controller } from '../chat/controller';

export const ControllerContext = createContext<Controller | null>(null);

export function useController(): Controller {
  const c = useContext(ControllerContext);
  if (!c) throw new Error('Controller fehlt');
  return c;
}

/** Abonniert den App-Zustand und rendert bei Änderungen neu. */
export function useAppState(): AppState {
  const c = useController();
  const [, force] = useReducer((n: number, _: void) => n + 1, 0);
  const rendered = useRef(c.state);
  rendered.current = c.state;
  useEffect(() => {
    const unsubscribe = c.subscribe(() => force());
    // Änderungen zwischen Rendern und Abonnieren nicht verpassen
    if (c.state !== rendered.current) force();
    return unsubscribe;
  }, [c]);
  return c.state;
}

/** Aktuelle Zeit, aktualisiert im angegebenen Intervall. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Fokussiert das Element beim ersten Rendern (z. B. Überschrift eines neuen Screens). */
export function useAutoFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

/** Zeigt für kurze Zeit ein "Kopiert"-Feedback. */
export function useFlag(durationMs = 2000): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return [
    on,
    () => {
      setOn(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setOn(false), durationMs);
    },
  ];
}

export const isCoarsePointer = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
