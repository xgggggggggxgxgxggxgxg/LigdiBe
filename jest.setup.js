/* Mocks globaux des modules natifs pour Jest. */
jest.mock('@notifee/react-native', () => require('@notifee/react-native/jest-mock'));

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => {
    throw new Error('op-sqlite indisponible sous Jest : utiliser createNodeSqliteDatabase');
  }),
}));

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY'},
  getGenericPassword: jest.fn(async () => false),
  setGenericPassword: jest.fn(async () => true),
}));

jest.mock('react-native-get-random-values', () => ({}));

jest.mock('react-native-fs', () => ({
  DownloadDirectoryPath: '/storage/emulated/0/Download',
  ExternalDirectoryPath: '/storage/emulated/0/Android/data/com.ligdibe/files',
  DocumentDirectoryPath: '/data/user/0/com.ligdibe/files',
  writeFile: jest.fn(async () => undefined),
}));

jest.mock('react-native-safe-area-context', () => {
  const mock = require('react-native-safe-area-context/jest/mock');
  return mock.default ?? mock;
});
