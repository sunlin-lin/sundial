/**
 * 路徑 → 代碼的機械轉換（§1.3、§5.2.2）。
 *
 * `cmd` 與權限碼的字面值相同，這是刻意的：兩者用途完全不同（`cmd` 進 envelope 供追蹤與 log，
 * 權限碼進角色設定與授權判斷），但都要指涉「哪一支端點」，於是共用同一個推導規則。
 * 共用之後才不會出現「log 上的 `cmd` 與角色設定裡的權限碼指的不是同一支端點」。
 *
 * 轉換規則沒有任何例外分支：去掉開頭的 `/`，把剩下的 `/` 換成 `.`，其餘一字不改
 * ——不轉單複數、不轉 camelCase。任何「聰明」的轉換都需要額外知識，
 * 而規則只要有一絲模稜兩可，掃描腳本就算不出期望值，§8 的第 13、38 兩條檢查就寫不出來。
 */

/** kebab-case：小寫英數，以單一連字號分隔，不得以連字號開頭或結尾。 */
const KEBAB_CASE_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const SEGMENT_COUNT = 3

/**
 * 把路由路徑轉成代碼。
 *
 * @param routePath 形如 `/<大目錄>/<次目錄>/<動作>` 的路徑，恰好三段、每段 kebab-case。
 * @returns 形如 `<大目錄>.<次目錄>.<動作>` 的代碼；路徑不符合三段形狀時回傳 `null`。
 *
 * 回傳 `null` 而不是拋例外，是因為執行期的呼叫端（身分驗證 middleware）拿到的是**外部輸入**：
 * 不存在的路徑也會走進來，那不是程式錯誤而是預期中的情況，必須當成「推導不出權限碼 → 拒絕」處理。
 */
export const pathToCode = (routePath: string): string | null => {
  const segments = routePath.replace(/^\//, '').split('/')
  if (segments.length !== SEGMENT_COUNT) return null
  if (!segments.every((segment) => KEBAB_CASE_SEGMENT.test(segment))) return null
  return segments.join('.')
}

/**
 * request／response envelope 的 `cmd`（§1.3）。與 {@link toPermissionCode} 是同一個函式，
 * 兩個名字是為了讓呼叫點自己說出用途——用途不同，但值必須永遠相同。
 */
export const toCommandCode = pathToCode

/** 授權判斷用的權限碼（§5.2.2）。禁止手寫權限碼，一律由本函式推導。 */
export const toPermissionCode = pathToCode
