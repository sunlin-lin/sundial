/**
 * `bun test` 的 preload（設定於根層 bunfig.toml）。
 *
 * 唯一職責：在任何測試檔被載入之前，確認這次執行連的是測試資料庫。
 * 上游是 bun test runner，下游沒有任何模組依賴本檔——它只做守衛，不匯出東西。
 */

// §7.4：測試禁止連線正式或共用開發資料庫。這道檢查放在 preload 而不是各測試檔內，
// 是因為「忘了加守衛的那一支測試」正是會連上正式庫的那一支——放在 preload，
// 就沒有「忘了加」這個選項。
const configuredDatabase = process.env['DB_NAME']
const expectedTestDatabase = process.env['TEST_DB_NAME']

if (expectedTestDatabase === undefined || expectedTestDatabase === '') {
  throw new Error('TEST_DB_NAME 未設定：無法判斷這次測試連的是不是測試資料庫，中止測試。')
}

if (configuredDatabase !== expectedTestDatabase) {
  throw new Error(
    `測試只能連線測試資料庫。期望 DB_NAME=${expectedTestDatabase}，實際為 ${String(configuredDatabase)}。`,
  )
}
