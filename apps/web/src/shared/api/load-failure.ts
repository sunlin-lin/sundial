/**
 * 載入失敗要走哪一種畫面（§7.2 的「載入失敗」再分兩種，因為使用者的下一步不同）。
 *
 * - **無權限**（後端 `901`）：重試幾次都一樣，該做的是去找有權限的人。因此不給重試鈕，
 *   並顯示**後端回來的那句話**——不在前端另備一份文案（§3.6、語系檔檔頭）。
 * - **其他**：連不上、`100` / `400`、回應不是 envelope。細節一律不對使用者顯示，只給重試。
 *
 * **這裡認的是型別化錯誤，不是 HTTP status**（§3.6）：頁面一旦看得到 status 就會開始自己判斷
 * `401`，而把 `901` 當 `900` 處理會讓使用者進入「登入 → 點到沒權限的功能 → 被踢回登入頁」的
 * 無限迴圈，他重登幾次就遇到幾次。統一 client 已經把這兩件事分成兩種錯誤類別了。
 *
 * ## 為什麼在 `shared/`
 *
 * §1.5：第二個頁面出現時才移入共用區。這一份原本在 `pages/regulatory/sync/` 裡；
 * `regulatory/datasets` 有三段各自會失敗的載入（總覽、版本清單、版本內容），分流方式與這裡逐字
 * 相同，於是有了第二個使用者。
 *
 * 分流方式必須是同一種：同一個 `901` 在 A 頁不給重試鈕、在 B 頁給一顆按下去必然再失敗一次的
 * 重試鈕時，使用者會以為是網路問題，然後一直按。
 */
import { PermissionDeniedError } from './api-error.ts'

export type LoadFailure = { readonly kind: 'permission-denied'; readonly message: string } | { readonly kind: 'system' }

export const toLoadFailure = (error: unknown): LoadFailure =>
  error instanceof PermissionDeniedError ? { kind: 'permission-denied', message: error.message } : { kind: 'system' }
