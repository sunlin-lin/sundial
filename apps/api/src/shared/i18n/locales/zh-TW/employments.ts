/**
 * 語系檔：zh-TW × `modules/employments/`（§1.3、§1.8.2）。
 *
 * 形狀與 key 的推導規則見同目錄的 `sessions.ts` 檔頭：次目錄 → 類別 → 訊息名。本大目錄有兩個
 * 次目錄，因此 key 分別長成 `employments.main.errors.*` 與
 * `employments.department-histories.errors.*`。
 *
 * ⚠️ **本檔只有「字」**（§3.2 的含糊化規則見 `modules/employments/main/employments-main.errors.ts`
 * 與 `modules/employments/department-histories/employments-department-histories.errors.ts`，
 * 各自的 `*-not-found` 同時服務「不存在」與「跨公司存取」兩種情境，理由寫在該兩檔，不在這裡）。
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
} as const
