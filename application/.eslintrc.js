module.exports = {
  env: {
    node: true,
  },
  globals: {
    window: true,
    Vue: true,
  },
  extends: ['eslint:recommended', 'plugin:prettier/recommended'],
  parser: 'babel-eslint',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
    'prettier/prettier': [
      'warn',
      {
        trailingComma: 'all',
        endOfLine: 'auto',
        tabWidth: 2,
        singleQuote: true,
        semi: true,
      },
    ],
  },
};
