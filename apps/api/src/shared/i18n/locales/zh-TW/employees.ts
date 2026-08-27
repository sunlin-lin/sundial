/**
 * 語系檔：zh-TW × `modules/employees/`（§1.3、§1.8.2）。
 *
 * 形狀與 key 的推導規則見同目錄的 `sessions.ts` 檔頭：次目錄 → 類別 → 訊息名，
 * 對應 `modules/employees/main/`，因此這一批 key 都長成 `employees.main.errors.*`。
 *
 * ⚠️ **本檔只有「字」，而且有好幾則是刻意含糊的**（§3.2），其中身分證字號那一則的限制
 * 比員工編號更嚴。**理由寫在 `modules/employees/main/employees-main.errors.ts`，不在這裡。**
 */

export const EMPLOYEES = {
  main: {
    errors: {
      /** ⚠️ 只說重複，不回聲是哪一位員工佔用了這個編號（§3.2）。 */
      'code-duplicated': '員工編號已被使用，請換一個',
      /** ⚠️ 敏感識別值：只能說無法建立，**禁止**回聲與哪一筆既有資料重複（§3.2 比員工編號更嚴）。 */
      'identity-number-duplicated': '此身分證字號已存在，無法建立',
      /** ⚠️ 跨公司存取與「不存在」必須逐字相同（§3.2）。 */
      'not-found': '員工不存在或已被刪除',
      'state-changed': '員工資料狀態已變更，請重新載入後再試',
    },
  },
} as const
