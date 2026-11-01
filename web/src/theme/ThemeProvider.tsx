import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { readStored, writeStored } from '../lib/storage';
import { cssVariables, isNiche, type Mode, type Niche } from './tokens';

export type ModePreference = 'system' | Mode;

interface ThemeContextValue {
  niche: Niche;
  setNiche: (niche: Niche) => void;
  preference: ModePreference;
  setPreference: (preference: ModePreference) => void;
  mode: Mode;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const NICHE_KEY = 'ui.niche';
const MODE_KEY = 'ui.mode';

function systemMode(): Mode {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function initialNiche(): Niche {
  const stored = readStored('local', NICHE_KEY);
  return isNiche(stored) ? stored : 'general';
}

function initialPreference(): ModePreference {
  const stored = readStored('local', MODE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

export function ThemeProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: { niche?: Niche; preference?: ModePreference };
}) {
  const [niche, setNicheState] = useState<Niche>(initial?.niche ?? initialNiche);
  const [preference, setPreferenceState] = useState<ModePreference>(initial?.preference ?? initialPreference);
  const [system, setSystem] = useState<Mode>(systemMode);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const mode: Mode = preference === 'system' ? system : preference;

  // Layout effect: the variables must be in place before the browser paints, or the page flashes the wrong niche.
  useLayoutEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(cssVariables(niche, mode)))
      root.style.setProperty(name, value);
    root.dataset.niche = niche;
    root.dataset.mode = mode;
    root.style.colorScheme = mode;
  }, [niche, mode]);

  const setNiche = useCallback((next: Niche) => {
    setNicheState(next);
    writeStored('local', NICHE_KEY, next);
  }, []);
  const setPreference = useCallback((next: ModePreference) => {
    setPreferenceState(next);
    writeStored('local', MODE_KEY, next);
  }, []);

  const value = useMemo(
    () => ({ niche, setNiche, preference, setPreference, mode }),
    [niche, setNiche, preference, setPreference, mode],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
