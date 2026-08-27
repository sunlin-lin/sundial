/**
 * 語系檔：zh-TW × `modules/roles/`（§1.3、§1.8.2）。
 *
 * 形狀與 key 的推導規則見同目錄的 `sessions.ts` 檔頭：次目錄 → 類別 → 訊息名，
 * 對應 `modules/roles/main/`，因此這一批 key 都長成 `roles.main.errors.*`。
 *
 * ⚠️ **本檔只有「字」，而且有好幾則是刻意含糊的**（§3.2）：跨公司存取與「不存在」逐字相同、
 * 唯一性檢查不回聲與哪一筆重複。**理由寫在 `modules/roles/main/roles-main.errors.ts`，不在這裡。**
 * 改任何一則字之前，請先讀該錯誤碼在那一頁上的說明——規格在那裡，字在這裡。
 *
 * **插值以 `{{name}}` 表示**（i18next 預設語法）。哪一則吃哪些變數，由 `../../messages.ts` 的
 * `MESSAGE_PARAM_SPECS` 宣告；兩邊對不上時由 `scripts/check-message-params.ts` 擋下（`bun run check:i18n`）。
 */

export const ROLES = {
  main: {
    errors: {
      /** ⚠️ 不回聲是哪一筆既有角色與它重複（§3.2）。 */
      'code-duplicated': '角色代碼已被使用，請換一個',
      /** ⚠️ 跨公司存取與「這個 id 根本不存在」必須**逐字相同**（§3.2）。 */
      'not-found': '角色不存在或已被刪除',
      'permission-not-found': '選取的權限不存在',
      'permission-not-assignable': '選取的權限不可指派，請改選底下的實際權限',
      'system-role-protected': '系統預設角色不可修改或刪除',
      /**
       * 帶插值的一則（變數宣告見 `../../messages.ts` 的 `MESSAGE_PARAM_SPECS`）。
       *
       * ⚠️ 這裡回聲數字**不違反 §3.2**：`assignedUserCount` 是本公司自己的統計，不揭露任何成員身分，
       * 而且刪除角色的人本來就看得到自己公司的成員清單。說得出數字，使用者才知道下一步要移轉幾個人；
       * 只說「仍有成員使用」的話，他得自己回到成員頁一筆筆比對。
       */
      'in-use': '仍有 {{assignedUserCount}} 位公司成員使用此角色，請先將成員移轉至其他角色',
      'last-admin-role': '這是公司最後一個具管理能力的角色，不可刪除或停用',
      'state-changed': '角色狀態已變更，請重新載入後再試',
    },
  },
} as const
