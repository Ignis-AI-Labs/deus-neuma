module.exports = {
    root: true,
    extends: [
        'eslint:recommended',
    ],
    plugins: [
        'jsdoc',
    ],
    env: {
        es6: true,
    },
    parserOptions: {
        ecmaVersion: 'latest',
    },
    overrides: [
        {
            // Server-side files
            files: ['backend/**/*.{js,mjs}', 'core/**/*.{js,mjs}', './*.js'],
            env: {
                node: true,
            },
            parserOptions: {
                sourceType: 'module',
            },
            globals: {
                globalThis: 'readonly',
            },
        },
        {
            files: ['*.cjs'],
            parserOptions: {
                sourceType: 'commonjs',
            },
            env: {
                node: true,
            },
        },
        {
            // Browser-side files
            files: ['frontend/**/*.js'],
            env: {
                browser: true,
            },
            parserOptions: {
                sourceType: 'module',
            },
            globals: {
                globalThis: 'readonly',
            },
        },
    ],
    ignorePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.git/**',
        'backups/**',
        'data/**',
        'cache/**',
        '**/*.min.js',
    ],
    rules: {
        'jsdoc/no-undefined-types': ['warn', { disableReporting: true, markVariablesAsUsed: true }],
        'no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true }],
        'no-control-regex': 'off',
        'no-constant-condition': ['error', { checkLoops: false }],
        'require-yield': 'off',
        'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
        'no-cond-assign': 'error',
        'no-unneeded-ternary': 'error',
        'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true }],

        // These rules should eventually be enabled.
        'no-async-promise-executor': 'off',
        'no-inner-declarations': 'off',
    },
};
