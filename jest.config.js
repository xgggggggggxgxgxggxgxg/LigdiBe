module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['@testing-library/react-native/extend-expect'],
  testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
  // Le premier rendu d'un écran compile React Native Paper à froid : ~10 s sur un runner CI 2 cœurs avec couverture.
  testTimeout: 30000,
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-paper|react-native-vector-icons|react-native-safe-area-context|react-native-screens|@notifee|@op-engineering|zustand)/)',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/index.ts'],
  coverageThreshold: {
    './src/data/parser/': { branches: 100, functions: 100, lines: 100, statements: 100 },
    './src/domain/': { branches: 90, functions: 95, lines: 95, statements: 95 },
  },
};
