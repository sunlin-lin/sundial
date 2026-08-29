/**
 * 語系檔：zh-TW × `modules/job-titles/`（§1.3、§1.8.2；實作計畫 `plans/05-employee-onboarding.md`
 * Stage 5）。
 *
 * 形狀與 key 的推導規則見同目錄的 `sessions.ts` 檔頭，對應 `modules/job-titles/main/`，
 * 因此這一批 key 都長成 `job-titles.main.errors.*`。
 *
 * ⚠️ **本檔只有「字」**（§3.2 的含糊化規則見 `modules/job-titles/main/job-titles-main.errors.ts`：
 * `not-found` 同時服務「不存在」「跨公司自訂」「系統預設（不能被本公司修改／刪除）」三種情境，
 * 理由寫在該檔，不在這裡）。
 */

export const JOB_TITLES = {
  main: {
    errors: {
      /** ⚠️ 不回聲是哪一筆既有職稱佔用了這個代碼（§3.2）。 */
      'code-duplicated': '職稱代碼已被使用，請換一個',
      /** ⚠️ 不存在、跨公司自訂、系統預設，三種情況必須逐字相同（§3.2）。 */
      'not-found': '職稱不存在或已被刪除',
      'state-changed': '職稱資料狀態已變更，請重新載入後再試',
    },
  },
} as const
