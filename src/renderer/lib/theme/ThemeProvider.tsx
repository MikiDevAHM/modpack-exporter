import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ThemeName = 'dark' | 'light';

export const THEMES: ThemeName[] = ['dark', 'light'];

const STORAGE_KEY = 'orb.theme';
const DEFAULT_THEME: ThemeName = 'dark';

/** Applies the theme attribute to <html> — also used pre-render to avoid a flash. */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
}

/** Applies the persisted theme before React mounts (no flash on startup). */
export function initTheme(): void {
  applyTheme(readStoredTheme());
}

function readStoredTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage unavailable — fall back to default.
  }
  return DEFAULT_THEME;
}

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures — the theme still applies for this session.
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
