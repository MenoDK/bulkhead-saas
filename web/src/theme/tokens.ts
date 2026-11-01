export const NICHES = ['general', 'restaurant', 'legal', 'civic', 'wellness'] as const;
export type Niche = (typeof NICHES)[number];
export type Mode = 'light' | 'dark';

/** Every colour the UI uses. Components never hard-code a colour: they read CSS variables made from these. */
export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  brand: string;
  onBrand: string;
  success: string;
  danger: string;
  warning: string;
}

export interface NicheTheme {
  label: string;
  tagline: string;
  /** What this vertical calls the generic building blocks of the platform. */
  vocabulary: { resource: string; resources: string; invoice: string; invoices: string; member: string };
  /** Radius is part of a niche's personality: soft for food and wellness, tight for legal. */
  radius: { sm: string; md: string; lg: string };
  fontStack: string;
  light: Palette;
  dark: Palette;
}

const system =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const serif = 'ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, serif';

export const THEMES: Record<Niche, NicheTheme> = {
  general: {
    label: 'General',
    tagline: 'A neutral workspace for any team.',
    vocabulary: {
      resource: 'Resource',
      resources: 'Resources',
      invoice: 'Invoice',
      invoices: 'Invoices',
      member: 'Member',
    },
    radius: { sm: '6px', md: '10px', lg: '16px' },
    fontStack: system,
    light: {
      bg: '#f6f7fb',
      surface: '#ffffff',
      surfaceAlt: '#eceef7',
      text: '#14172b',
      muted: '#4a5068',
      border: '#d5d9e8',
      brand: '#3b4cca',
      onBrand: '#ffffff',
      success: '#166534',
      danger: '#b42318',
      warning: '#8a5a00',
    },
    dark: {
      bg: '#0f1220',
      surface: '#181c30',
      surfaceAlt: '#20253d',
      text: '#eceefb',
      muted: '#aab0cc',
      border: '#2c3252',
      brand: '#8e9bff',
      onBrand: '#0f1220',
      success: '#6ee7a0',
      danger: '#ff8a80',
      warning: '#f5c451',
    },
  },
  restaurant: {
    label: 'Restaurant',
    tagline: 'Menus, tables and the till, in one warm place.',
    vocabulary: {
      resource: 'Menu item',
      resources: 'Menu',
      invoice: 'Tab',
      invoices: 'Tabs',
      member: 'Staff',
    },
    radius: { sm: '10px', md: '16px', lg: '24px' },
    fontStack: system,
    light: {
      bg: '#faf5ee',
      surface: '#fffdf9',
      surfaceAlt: '#f3e9db',
      text: '#2b1d14',
      muted: '#6b5547',
      border: '#e3d5c2',
      brand: '#b4472a',
      onBrand: '#ffffff',
      success: '#1d6b3a',
      danger: '#b42318',
      warning: '#8a5a00',
    },
    dark: {
      bg: '#1b1410',
      surface: '#261c16',
      surfaceAlt: '#33261d',
      text: '#f6ece1',
      muted: '#cdb9a6',
      border: '#43332a',
      brand: '#f0966f',
      onBrand: '#1b1410',
      success: '#78d89a',
      danger: '#ff8f84',
      warning: '#f5c451',
    },
  },
  legal: {
    label: 'Legal',
    tagline: 'Cases, deadlines and an audit trail you can defend.',
    vocabulary: {
      resource: 'Case',
      resources: 'Cases',
      invoice: 'Fee note',
      invoices: 'Fee notes',
      member: 'Counsel',
    },
    radius: { sm: '4px', md: '6px', lg: '10px' },
    fontStack: serif,
    light: {
      bg: '#f4f5f8',
      surface: '#ffffff',
      surfaceAlt: '#e8ebf2',
      text: '#0f1b33',
      muted: '#475069',
      border: '#d3d8e4',
      brand: '#14284b',
      onBrand: '#ffffff',
      success: '#166534',
      danger: '#b42318',
      warning: '#8a5a00',
    },
    dark: {
      bg: '#0a1224',
      surface: '#121d38',
      surfaceAlt: '#1a2848',
      text: '#eef1f8',
      muted: '#a9b3cc',
      border: '#273659',
      brand: '#f2b441',
      onBrand: '#0a1224',
      success: '#6ee7a0',
      danger: '#ff8a80',
      warning: '#f5c451',
    },
  },
  civic: {
    label: 'Civic office',
    tagline: 'Proposals, constituents and transparent records.',
    vocabulary: {
      resource: 'Proposal',
      resources: 'Proposals',
      invoice: 'Grant',
      invoices: 'Grants',
      member: 'Staff',
    },
    radius: { sm: '6px', md: '12px', lg: '18px' },
    fontStack: system,
    light: {
      bg: '#f6f3ea',
      surface: '#fffdf7',
      surfaceAlt: '#ece7d6',
      text: '#14261b',
      muted: '#4b5d51',
      border: '#d9d3bf',
      brand: '#1f5a3a',
      onBrand: '#ffffff',
      success: '#1d6b3a',
      danger: '#b42318',
      warning: '#8a5a00',
    },
    dark: {
      bg: '#0d1a13',
      surface: '#14261c',
      surfaceAlt: '#1c3426',
      text: '#eaf3ec',
      muted: '#a9bfb0',
      border: '#27412f',
      brand: '#7fcf9f',
      onBrand: '#0d1a13',
      success: '#7fe0a6',
      danger: '#ff8f84',
      warning: '#f5c451',
    },
  },
  wellness: {
    label: 'Wellness',
    tagline: 'Programs, clients and sessions, calmly organised.',
    vocabulary: {
      resource: 'Program',
      resources: 'Programs',
      invoice: 'Package',
      invoices: 'Packages',
      member: 'Coach',
    },
    radius: { sm: '8px', md: '14px', lg: '22px' },
    fontStack: system,
    light: {
      bg: '#f1f7f5',
      surface: '#ffffff',
      surfaceAlt: '#e1eeea',
      text: '#10272a',
      muted: '#46605f',
      border: '#cfe0db',
      brand: '#0f766e',
      onBrand: '#ffffff',
      success: '#166534',
      danger: '#b42318',
      warning: '#8a5a00',
    },
    dark: {
      bg: '#0b1819',
      surface: '#11262a',
      surfaceAlt: '#17333a',
      text: '#e6f4f2',
      muted: '#a3c2bf',
      border: '#244047',
      brand: '#5eead4',
      onBrand: '#0b1819',
      success: '#6ee7a0',
      danger: '#ff8a80',
      warning: '#f5c451',
    },
  },
};

export function isNiche(value: unknown): value is Niche {
  return typeof value === 'string' && (NICHES as readonly string[]).includes(value);
}

const kebab = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** CSS custom properties for one niche + mode, e.g. `{ '--brand': '#3b4cca', '--on-brand': '#fff', … }`. */
export function cssVariables(niche: Niche, mode: Mode): Record<string, string> {
  const theme = THEMES[niche];
  const vars: Record<string, string> = {
    '--radius-sm': theme.radius.sm,
    '--radius-md': theme.radius.md,
    '--radius-lg': theme.radius.lg,
    '--font': theme.fontStack,
  };
  for (const [key, value] of Object.entries(theme[mode])) vars[`--${kebab(key)}`] = value;
  return vars;
}
