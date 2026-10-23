import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base: './' にしておくと GitHub Pages のサブパス（/リポジトリ名/）でもそのまま動く
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
  },
});
