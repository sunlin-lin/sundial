/**
 * 語系檔：zh-TW × `modules/job-positions/`（§1.3、§1.8.2；實作計畫 `plans/05-employee-onboarding.md`
 * Stage 5）。形狀與理由與 `job-titles.ts` 完全同構。
 */

export const JOB_POSITIONS = {
  main: {
    errors: {
      'code-duplicated': '職務代碼已被使用，請換一個',
      /** ⚠️ 不存在、跨公司自訂、系統預設，三種情況必須逐字相同（§3.2）。 */
      'not-found': '職務不存在或已被刪除',
      'state-changed': '職務資料狀態已變更，請重新載入後再試',
    },
  },
} as const
