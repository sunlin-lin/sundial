/**
 * `sessions` 大目錄對「路由組裝點」的唯一出口（§0.3）。
 *
 * 形狀與 `index.ts` **完全相同**（只允許 `export ... from`，不得有任何宣告、常數或函式本體），
 * 用途完全不同：被 re-export 的來源檔名後綴**只能是 `.routes.ts`**，
 * 而**只有路由組裝點可以 import 本檔**，`modules/**` 底下任何檔案都不行。
 *
 * 為什麼不與 `index.ts` 合併（後人一定會問「反正都要 export，合成一個不是更簡單嗎」）：
 * 合併之後，任何模組 import 別人的 service，都會把 HTTP 框架一起拖過大目錄邊界——
 * 這與「re-export repository 會把 db client 拖過去」**逐字同構**，同一個機制、同一種後果，
 * 而且一樣從 import 語句上完全看不出來。理由同構，處置就必須同構：拆成第二個出口。
 *
 * **本模組匯出三個 plugin 而不是一個**，因為四支端點分屬三個認證群組（§1.9.1）。
 * 哪一支落在哪一組、為什麼，寫在 `main/sessions-main.routes.ts` 的檔頭。
 */
export * from './main/sessions-main.routes.ts'
