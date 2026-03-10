import React, { createContext, useContext, useEffect, ReactNode } from 'react';

type ThemeName = 'dark' | 'gpp';

interface ThemeContextType {
  theme: ThemeName;
  themeClass: string;
  backgroundStyle?: React.CSSProperties;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  themeClass: '',
});

const GPP_GRADIENT = 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)';

export function ThemeProvider({ theme, children }: { theme: ThemeName; children: ReactNode }) {
  const themeClass = theme === 'gpp' ? 'gpp-theme' : '';
  const backgroundStyle = theme === 'gpp'
    ? { background: GPP_GRADIENT }
    : undefined;

  // Set body class for elements rendered outside the React tree (e.g., Google Maps .pac-container)
  useEffect(() => {
    if (theme === 'gpp') {
      document.body.classList.add('gpp-theme-active');
    } else {
      document.body.classList.remove('gpp-theme-active');
    }
    return () => document.body.classList.remove('gpp-theme-active');
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, themeClass, backgroundStyle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
