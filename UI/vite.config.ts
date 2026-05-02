import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  server: {
    proxy: {
      // 1. 匹配请求路径：所有以 '/api' 开头的请求
      '/api': {
        // 2. 代理目标：请求将被转发到的后端服务器地址
        target: 'http://localhost:4310/api',
        // 3. 修改来源：建议设置为 true，避免后端接口校验 Host 头失败
        changeOrigin: true,
        // 4. 路径重写：将请求中的 '/api' 前缀移除
        // 例如: 本地请求 '/api/user' -> 代理到 'http://localhost:3000/user'
        rewrite: (path) => path.replace(/^\/api/, ''),
      }
    }
  },
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../dist/workspace-client"),
    emptyOutDir: true
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
