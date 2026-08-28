/**
 * 語系檔：zh-TW × `modules/shifts/`（§1.3、§1.8.2）。
 *
 * 形狀與 key 的推導規則見同目錄的 `sessions.ts` 檔頭：次目錄 → 類別 → 訊息名，
 * 對應 `modules/shifts/main/`，因此這一批 key 都長成 `shifts.main.errors.*`。
 *
 * ⚠️ **本檔只有「字」**（§3.2 的含糊化規則見 `modules/shifts/main/shifts-main.errors.ts`，
 * 其中 `not-found` 一則同時服務「不存在」與「跨公司存取」兩種情境，理由寫在該檔，不在這裡）。
 */

export const SHIFTS = {
  main: {
    errors: {
      /** ⚠️ 不回聲是哪一筆既有班別佔用了這個代碼（§3.2）。 */
      'code-duplicated': '班別代碼已被使用，請換一個',
      /** ⚠️ 跨公司存取與「不存在」必須逐字相同（§3.2）；`copy` 的來源不存在也回這一句。 */
      'not-found': '班別不存在或已被刪除',
      'state-changed': '班別資料狀態已變更，請重新載入後再試',
      'work-periods-empty': '至少需要一段工作時段',
      'work-period-invalid-range': '工作時段的結束時刻必須晚於開始時刻（跨日時段請確認日偏移已設為 1）',
      'work-periods-overlap': '工作時段彼此重疊，請調整時間',
      'work-period-sequence-duplicated': '工作時段的順序編號重複，請確認每一段的順序編號各不相同',
      'break-invalid-range': '休息時段的結束時刻必須晚於開始時刻（跨日休息請確認日偏移已設為 1）',
      'break-outside-work-period': '休息時段必須完整落在某一段工作時段內',
      'break-sequence-duplicated': '休息時段的順序編號重複，請確認每一段的順序編號各不相同',
      'breaks-overlap': '休息時段彼此重疊，請調整時間（重疊的時間會在計算應工作分鐘時被扣兩次）',
      'required-work-minutes-not-positive':
        '算出來的應工作分鐘不是正數，請檢查工作時段與休息時段的設定（常見成因是休息時段重疊）',
    },
  },
} as const
