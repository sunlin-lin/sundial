/**
 * `TransactionRunner`（`db/client.ts`）的型別層測試。
 *
 * ## 這份測試在驗什麼
 *
 * `TransactionRunner` 存在的理由是「編譯器要能證明呼叫端手上的東西真的是一個交易」，而不是
 * 「連線池與交易物件擋不擋得住某個方法呼叫」——那件事本來就由 `QueryRunner` 負責，兩者不是
 * 同一條規則。因此這裡要證明的**不是**「連線池可以做交易物件能做的某些事」，而是**連線池不能
 * 被當成 `TransactionRunner` 傳出去**。
 *
 * ## 為什麼靠 `@ts-expect-error`，不是靠一句註解
 *
 * 一句「連線池不滿足 TransactionRunner」的註解只在寫下的當下為真。`TransactionRunner` 的定義
 * 如果哪天被改鬆（例如有人把 `rollback` 從交集裡拿掉，或改成可選屬性），連線池就會重新塞得
 * 進去，而**註解不會知道**——`bun run typecheck` 照樣綠燈，這條「必須是真交易」的保證就在沒有
 * 人察覺的情況下消失了。`@ts-expect-error` 的好處是雙向的：型別真的不相容時它讓紅燈消音，
 * 型別意外變得相容時（「預期的錯誤沒有發生」）它自己會讓 `tsc --build` 報錯——保證本身變成
 * 可以被型別檢查器複查的東西，不是只能靠人記得。
 *
 * `bun test` 不做型別檢查（transpile-only），這一行的把關實際發生在 `bun run typecheck`
 * （`tsc --build --force`，串在 `bun run ci` 裡）。這個測試檔仍然放一個會執行的 `test()`，
 * 是為了讓「這份型別斷言存在且被排進測試清單」這件事在 `bun test` 的結果裡看得見，
 * 而不是一個只有 tsc 知道、`bun test` 完全不提它的檔案。
 */
import { describe, expect, test } from 'bun:test'
import type { Database, TransactionRunner } from '../client.ts'

describe('TransactionRunner（db/client.ts）', () => {
  test('連線池不滿足 TransactionRunner——連線池沒有 rollback，只有真正的交易物件有', () => {
    // 刻意寫成一個永遠不會被呼叫的函式，只是為了讓下面那一行處在「型別位置」上：
    // 這裡要驗的是賦值本身能不能通過型別檢查，不是任何執行期行為。
    const assignPoolToTransactionRunner = (pool: Database): TransactionRunner =>
      // @ts-expect-error 連線池（Database）沒有 rollback，不滿足 TransactionRunner——
      // 這一行「預期出現型別錯誤」正是本測試要驗的事。哪天 TransactionRunner 被放寬到
      // 連線池也塞得進去，這一行會因為「預期的錯誤沒有發生」讓 `bun run typecheck` 變紅。
      pool

    // 執行期斷言只確認上面那個函式確實存在、這個檔案確實被跑到；真正的把關是編譯期那一行。
    expect(typeof assignPoolToTransactionRunner).toBe('function')
  })
})
