import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  target: 'es2022',
  dts: {
    entry: {
      index: 'src/index.ts',
    },
  },
  sourcemap: true,
  clean: true,
  splitting: false,
  define: {
    __VERSION__: JSON.stringify(version),
  },
});
