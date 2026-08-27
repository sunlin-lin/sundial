/**
 * 基礎設施端點（§1.1 末條、§1.9.2）。
 *
 * 這些端點**不帶 envelope、不帶 `cmd`、不需認證，路徑也不受三段規則約束**。
 * 這是**排除適用範圍，不是開例外**：界線是「這支端點是不是給本系統前端呼叫的業務端點」
 * ——不是（給 load balancer、監控系統、部署腳本用的維運端點），就不在那些規範的管轄範圍內。
 * 例外會被援引（「既然 /health 可以，我這支也可以」），排除則有明確邊界。
 *
 * 集中在單一檔案，是為了讓「被排除的端點」一覽無遺——它們是被排除，不是被遺漏。
 */
import { Elysia } from 'elysia'

export const infrastructureEndpoints = new Elysia({ name: 'infrastructure-endpoints' })
  // 健康檢查。呼叫者是 load balancer 與部署腳本，不是 Web 前端，因此不套用 §1.2 的「一律 POST」。
  // 刻意不查資料庫：健康檢查要回答的是「這個行程還活著嗎」，把 DB 併進來會讓 DB 短暫抖動
  // 直接演變成整批服務被摘掉，故障範圍反而被放大。
  .get('/health', () => ({ status: 'ok' }))
