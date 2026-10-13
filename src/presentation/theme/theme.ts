import { MD3LightTheme, type MD3Theme } from 'react-native-paper';

/** « Ligdi » = l'argent en mooré. Vert prospérité + or. */
export const palette = {
  green: '#0F7B5F',
  greenDark: '#0A5A45',
  gold: '#F2A900',
  red: '#C62828',
  orange: '#EF6C00',
  surface: '#F6F8F7',
  orangeMoney: '#FF7900',
  moov: '#0057A8',
  wave: '#1DC8F2',
  bank: '#5E35B1',
  cash: '#2E7D32',
} as const;

export const theme: MD3Theme = {
  ...MD3LightTheme,
  roundness: 3,
  colors: {
    ...MD3LightTheme.colors,
    primary: palette.green,
    onPrimary: '#FFFFFF',
    primaryContainer: '#C8EBDD',
    onPrimaryContainer: '#002117',
    secondary: palette.gold,
    secondaryContainer: '#FFE8B0',
    onSecondaryContainer: '#2A1F00',
    background: palette.surface,
    error: palette.red,
  },
};

export const providerColor = (provider: string): string => {
  switch (provider) {
    case 'ORANGE':
      return palette.orangeMoney;
    case 'MOOV':
      return palette.moov;
    case 'UBA_WAVE':
    case 'WAVE':
      return palette.wave;
    case 'CASH':
      return palette.cash;
    default:
      return palette.bank;
  }
};

export const providerIcon = (provider: string): string => {
  switch (provider) {
    case 'CASH':
      return 'wallet';
    case 'BANK':
    case 'ECOBANK':
      return 'bank';
    default:
      return 'cellphone-nfc';
  }
};
