/**
 * Configuración de ESLint.
 *
 * El repo tenía el script `npm run lint` pero ni ESLint instalado ni archivo de
 * configuración: el comando fallaba siempre. Esto lo deja funcionando.
 *
 * El criterio es deliberadamente conservador. Un linter que grita por cosas de
 * estilo en un proyecto ya escrito no se usa: se ignora, y entonces deja de
 * avisar de lo que sí importa. Aquí solo quedan como ERROR las reglas que
 * detectan bugs de verdad — hooks mal usados, promesas sin await, condiciones
 * que siempre son ciertas — y lo demás queda en warning o apagado.
 */

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'print-agent/**',
      'scripts/**',
      'supabase/**',
      // Generado por `supabase gen types`. CLAUDE.md prohíbe editarlo a mano,
      // así que linterlo solo produce errores que nadie puede arreglar.
      'src/data/database.types.ts',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    // Las reglas con información de tipos van acotadas a TypeScript. Aplicadas
    // a todo el proyecto revientan al analizar este mismo archivo, que es .js y
    // no está en ningún tsconfig.
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Un hook con dependencias mal declaradas es la fuente número uno de
      // "a veces no se actualiza la pantalla". Es error, no sugerencia.
      'react-hooks/exhaustive-deps': 'error',

      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Una promesa sin await en un POS significa un cobro que parece hecho y
      // no llegó a la base. Esto sí es un bug.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      // Ruido en un proyecto ya escrito: útil de ver, no para bloquear el build.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
)
