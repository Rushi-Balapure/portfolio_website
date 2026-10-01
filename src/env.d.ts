/// <reference types="astro/client" />

interface PortfolioTheme {
  apply: (preference: string, persist?: boolean) => void;
  read: () => string;
  media: MediaQueryList;
}

interface Window {
  __portfolioTheme?: PortfolioTheme;
}

