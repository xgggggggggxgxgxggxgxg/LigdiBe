module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Les props `left` / `right` de React Native Paper attendent des fonctions de rendu.
    'react/no-unstable-nested-components': ['warn', { allowAsProps: true }],
  },
  overrides: [
    {
      files: ['jest.setup.js', '__tests__/**'],
      env: { jest: true },
    },
  ],
};
