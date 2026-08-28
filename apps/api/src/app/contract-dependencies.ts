/**
 * 只為了「取得契約」而組裝 app 時所用的相依（§1.7）。
 *
 * §1.7 有一條硬要求：`bun run gen:api` **必須能在後端服務未啟動、資料庫未連線的情況下執行**。
 * 理由寫在規範裡，值得原樣重述一次：前端開發者與 CI 只是要一份型別；若必須先起後端與 MariaDB
 * 才能產生，這個指令就會在新人的第一天失敗，結果是「跑不起來，先沿用舊型別」——
 * 契約單一來源等於沒有。
 *
 * `buildApp(dependencies)` 本身已經是純組裝（不連 DB、不 `listen`，理由見 `app.ts` 檔頭），
 * 但它的簽章仍然要求一整包外部資源。本檔提供那一包，且**每一項都是「拿得到、但一旦被呼叫就當場炸掉」**。
 *
 * **為什麼是「炸掉」而不是「回一個合理的假值」**：這包相依只會被兩種呼叫端用到——契約產生腳本
 * 與端點清單快照測試，兩者都只讀路由宣告，不送任何請求。回假值的話，哪天有人不小心讓這條路徑
 * 真的處理了一個請求（例如在測試裡對這個 app 呼叫 `handle()`），他會拿到一個看起來正常的結果，
 * 而那個結果與正式環境毫無關係；當場拋例外則讓「用錯了」在第一時間就是一行明確的錯誤訊息。
 *
 * **資料庫是唯一的例外，它是真的連線池物件**：`Database` 是 drizzle 的型別，做不出「會爆的假物件」
 * 而不動用 §2.2 禁止的 `as` 硬轉。改為以一組指向不存在主機的設定呼叫 `createDatabase()`
 * ——`mysql2` 的連線池是惰性的（建立時不連線，第一次查詢才連），因此本檔仍然一次 TCP 都不會發出，
 * 而型別是貨真價實的。順帶的好處是：真的有人在這個 app 上跑查詢時，錯誤會是一句
 * 「連不到 contract-generation.invalid」，比 `undefined is not a function` 好認得多。
 */
import { createDatabase } from '../db/client.ts'
import { fixedClock } from '../shared/clock.ts'
import type { AppDependencies } from './app-dependencies.ts'

/**
 * 指向不存在主機的資料庫設定。
 *
 * `.invalid` 是 RFC 2606 保留給「保證不會被解析」的頂層網域：即使有人在某個環境設了萬用 DNS，
 * 這個名字也不會意外連到任何真實主機。**不從環境變數讀**是刻意的——讀了就代表這支指令需要
 * `.env`，而那正是 §1.7 要拆掉的前置條件。
 */
const UNREACHABLE_DATABASE = {
  host: 'contract-generation.invalid',
  port: 1,
  user: 'contract-generation',
  password: '',
  database: 'contract-generation',
} as const

/**
 * 這條路徑不該被執行。
 *
 * 回傳型別是 `never`，因此它可以擺在任何函式型別的位置上（參數數量不符也沒關係——
 * TypeScript 允許以較少參數的函式滿足較多參數的簽章），不需要為每一個 port 各寫一份假實作。
 */
const notReachable = (): never => {
  throw new Error('契約產生用的 app 只用來讀取路由宣告，不得實際處理請求。走到這裡代表有人把它當成可執行的服務在用。')
}

/**
 * 契約產出專用的相依。
 *
 * 時鐘用 {@link fixedClock} 而不是 `systemClock`：這包東西的用途是產生**應該逐次相同**的產物
 *（`openapi.json` 與端點清單快照）。留一個會讀系統時間的元件在裡面，等於留一條「產物有可能
 * 隨執行時間改變」的路——那種不穩定一旦發生，症狀會是「快照在 CI 上偶爾變紅」，
 * 而沒有人會想到成因是一個根本不該被呼叫的時鐘。
 */
export const contractOnlyDependencies = (): AppDependencies => ({
  clock: fixedClock(new Date(0)),
  database: createDatabase(UNREACHABLE_DATABASE),
  cipher: { encrypt: notReachable, decrypt: notReachable, blindIndex: notReachable },
  session: { accessTokenSecret: '', accessTokenTtlSeconds: 0, refreshTokenTtlDays: 0 },
  accessControl: {
    verifyAccessToken: notReachable,
    renewSession: notReachable,
    loadPermissionCodes: notReachable,
  },
  refreshControl: { verifyRefreshTicket: notReachable, revokeAllChainsOnReuse: notReachable },
})
