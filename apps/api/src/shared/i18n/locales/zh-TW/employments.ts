/**
 * 語系檔：zh-TW × `modules/employments/`（§1.3、§1.8.2）。
 *
 * 形狀與 key 的推導規則見同目錄的 `sessions.ts` 檔頭：次目錄 → 類別 → 訊息名。本大目錄有四個
 * 次目錄，因此 key 分別長成 `employments.main.errors.*`、
 * `employments.department-histories.errors.*`、`employments.job-title-histories.errors.*`
 * 與 `employments.job-position-histories.errors.*`（Stage 5 新增後兩個）。
 *
 * ⚠️ **本檔只有「字」**（§3.2 的含糊化規則見各自的 `*.errors.ts`，`*-not-found` 同時服務
 * 「不存在」與「跨公司存取」兩種情境，理由寫在各檔，不在這裡）。
 */

export const EMPLOYMENTS = {
  main: {
    errors: {
      /** ⚠️ 跨公司存取、已軟刪除，與「不存在」必須逐字相同（§3.2）。 */
      'employee-not-found': '員工不存在，或不屬於本公司',
      'period-overlap': '此期間與該員工既有的任職重疊，請確認到職日',
      'duplicate-hire-date': '同一天已經有一筆任職紀錄，請確認到職日',
      'not-found': '任職紀錄不存在或已被刪除',
      'already-left': '此任職已經辦理過離職，無法重複辦理',
      'last-working-date-after-leave-date': '最後工作日不可晚於離職日',
      'state-changed': '任職資料狀態已變更，請重新載入後再試',
    },
  },
  'department-histories': {
    errors: {
      'employment-not-found': '任職紀錄不存在或已被刪除',
      'department-not-found': '部門不存在，或不屬於本公司',
      'period-overlap': '此期間與該任職既有的部門歸屬重疊，請確認生效日',
      'duplicate-effective-from': '同一天已經有一筆部門歸屬紀錄，請確認生效日',
    },
  },
  /** Stage 5 新增（實作計畫 `plans/05-employee-onboarding.md`）：同一任職同一時間僅一筆有效職稱。 */
  'job-title-histories': {
    errors: {
      'employment-not-found': '任職紀錄不存在或已被刪除',
      /** ⚠️ 不存在、跨公司自訂、已軟刪除，三種情況必須逐字相同（§3.2）；系統預設職稱不受此限。 */
      'job-title-not-found': '職稱不存在，或不屬於本公司',
      'period-overlap': '此期間與該任職既有的職稱重疊，請確認生效日',
      'duplicate-effective-from': '同一天已經有一筆職稱紀錄，請確認生效日',
    },
  },
  /**
   * Stage 5 新增：同一任職可同時有多個有效職務，但同一職務期間不得重疊
   * （`period-overlap` 判斷同時看任職與職務兩者，見 `job-position-histories` 模組檔頭）。
   */
  'job-position-histories': {
    errors: {
      'employment-not-found': '任職紀錄不存在或已被刪除',
      'job-position-not-found': '職務不存在，或不屬於本公司',
      'period-overlap': '此期間與該任職既有的職務重疊，請確認生效日',
      'duplicate-effective-from': '同一天已經有一筆職務紀錄，請確認生效日',
    },
  },
} as const
