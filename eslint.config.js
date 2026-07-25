// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Deno-only code (Supabase Edge Functions) — uses `npm:`/`Deno.*` globals
    // ESLint's Node-oriented resolver can't understand; not part of the RN app.
    ignores: ['dist/*', 'supabase/functions/**'],
  },
]);
