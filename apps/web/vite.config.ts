import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

/**
 * 本機開發時後端的位址。
 *
 * 前後端**同源**是刻意的（後端規範 §5.4.3）：refresh 票走 `SameSite=Lax` 的 httpOnly cookie，
 * 同源之下瀏覽器一律會帶上它，也不需要 CSRF token。改成跨源部署的那一天，
 * cookie 送不出去、使用者會表現成「每次重整都要重登」，而畫面上不會有任何錯誤訊息。
 * 因此開發環境也走 proxy 而不是直接打 `http://localhost:<port>`——讓本機跟正式環境的
 * 同源前提是同一個，才不會有一整類問題只在正式環境出現。
 */
const API_ORIGIN = 'http://localhost:3000'

/**
 * 後端端點的路徑形狀：`/<大目錄>/<次目錄>/<動作>`，恰好三段、全部是 POST（後端規範 §1.1、§1.2）。
 *
 * 前端頁面網址是兩段（前端規範 §0.2），後面可能再接參數段——**參數段會讓頁面網址也變成三段**，
 * 因此只靠段數分不開兩者。下面的 `bypass` 再加一道「只代理 POST」：瀏覽器的頁面導覽一律是 GET，
 * 少了這道判斷，使用者重新整理一個三段式頁面網址時會拿到後端的 404 而不是自己的頁面，
 * 而那個症狀（「某些頁面重整就壞掉」）看起來完全不像是 proxy 設定造成的。
 */
const API_PATH_PATTERN = '^/[a-z][a-z0-9-]*/[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: {
      [API_PATH_PATTERN]: {
        target: API_ORIGIN,
        changeOrigin: false,
        bypass: (request) => (request.method === 'POST' ? undefined : request.url),
      },
    },
  },
})
