/**
 * 語系檔：zh-TW × `modules/departments/`（§1.3、§1.8.2）。
 *
 * 形狀與 key 的推導規則見同目錄的 `sessions.ts` 檔頭：次目錄 → 類別 → 訊息名，
 * 對應 `modules/departments/main/`，因此這一批 key 都長成 `departments.main.errors.*`。
 *
 * ⚠️ **本檔只有「字」**（§3.2 的含糊化規則見 `modules/departments/main/departments-main.errors.ts`，
 * 其中 `not-found` 與 `parent-not-found` 兩則各自同時服務「不存在」與「跨公司存取」兩種情境，
 * 理由寫在該檔，不在這裡）。
 */

export const DEPARTMENTS = {
  main: {
    errors: {
      /** ⚠️ 不回聲是哪一筆既有部門佔用了這個代碼（§3.2）。 */
      'code-duplicated': '部門代碼已被使用，請換一個',
      /** ⚠️ 跨公司存取與「不存在」必須逐字相同（§3.2）。 */
      'not-found': '部門不存在或已被刪除',
      /** ⚠️ 上層不存在、上層跨公司、上層已被軟刪除，三種情況必須逐字相同（§3.2）。 */
      'parent-not-found': '上層部門不存在，或不屬於本公司',
      'parent-cycle': '上層部門不能是自己，也不能是自己的下層部門',
      'has-children': '此部門仍有下層部門，請先將下層部門移轉到其他上層後再刪除',
      'state-changed': '部門資料狀態已變更，請重新載入後再試',
    },
  },
} as const
