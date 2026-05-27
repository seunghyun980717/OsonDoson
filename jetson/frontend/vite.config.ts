import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true, // LAN 노출 (Jetson 등 외부 기기 접속 허용함)
    // - 모든 인터페이스 (0.0.0.0)에 바인딩 -> npm run dev시 Network 주소가 같이 출력됨
    port: 5173,
    strictPort: true, // 포트 점유 시 fallback 금지 (충돌 즉시 인지. 충돌 났을 때 조용히 넘기지 않게 함)
  },
});
