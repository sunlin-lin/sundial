/**
 * 端點清單快照（§1.7「必須有」）。
 *
 * ## 這支測試在擋什麼
 *
 * OpenAPI 是產生物、不進版控（§1.7），所以**對外契約的變更不會出現在 PR diff 裡**：
 * 改一行 schema 就悄悄改了 API，reviewer 什麼也看不到。這是拿掉版本前綴（§1.6）之後
 * 最需要補的洞，而這份快照就是替代把關機制——不是加分項。
 *
 * 快照變紅時**不要反射性地更新它**。先回答：這是不是破壞性變更？要不要走兩步走（§1.6）？
 * 前端有沒有對應的改動？確認過了再更新，那一段紅綠對照就是 PR 上的變更說明。
 *
 * ## 更新方式
 *
 * ```
 * bun test apps/api/src/app/__tests__/endpoint-inventory.test.ts --update-snapshots
 * ```
 *
 * ## 這支測試不連資料庫
 *
 * 它用的是 `contractOnlyDependencies()`（見該檔檔頭）：只讀路由宣告，不送請求、不連 DB。
 * 這與 `bun run gen:api` 走的是同一條路——若哪天契約產生需要先起 MariaDB，這支測試會先變紅。
 */
import { describe, expect, test } from 'bun:test'
import { contractOnlyDependencies } from '../contract-dependencies.ts'
import { collectEndpointContracts, serializeEndpointContracts } from '../endpoint-inventory.ts'
import { toCommandCode } from '../../shared/path-code.ts'

const contracts = collectEndpointContracts(contractOnlyDependencies())

describe('端點清單快照', () => {
  test('已註冊的端點與快照一致（`path | cmd | 認證群組 | request body 必填欄位`）', () => {
    expect(serializeEndpointContracts(contracts)).toMatchSnapshot()
  })

  /**
   * 快照上 `path` 與 `cmd` 兩欄並列，是為了讓「路徑改了但 `cmd` 沒改」在 diff 上是一行
   * 紅綠不對稱，reviewer 一眼看得到。這條斷言則是同一件事的機器版本：不必等到有人去看 diff。
   *
   * 兩者不重複——diff 那一層擋的是「改了但沒有人注意到」，這一層擋的是「改錯了」。
   */
  test('每支端點宣告的 `cmd` 都等於由路徑機械推導出來的值（§1.3）', () => {
    const mismatched = contracts.filter((contract) => contract.cmd !== toCommandCode(contract.path))
    expect(mismatched).toEqual([])
  })

  /**
   * 通用規範 §7.2：掃描型檢查必須先確認自己真的掃到東西。
   *
   * `collectEndpointContracts` 內部已經擋掉「一支都沒讀到」，這裡再擋一次「只讀到零星幾支」
   * ——組裝點少 `.use()` 一整個模組時，前一道防線不會響（它還是讀到了東西），
   * 而快照會安靜地少掉一整段，看起來就像是有人刻意刪的。
   */
  test('讀到的端點數量沒有整段消失', () => {
    expect(contracts.length).toBeGreaterThanOrEqual(20)
  })
})
