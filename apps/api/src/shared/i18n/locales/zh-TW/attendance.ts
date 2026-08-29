/**
 * 語系檔：zh-TW × `modules/attendance/`（§1.3、§1.8.2）。
 *
 * 形狀與 key 的推導規則見同目錄的 `sessions.ts` 檔頭：次目錄 → 類別 → 訊息名，
 * 對應 `modules/attendance/settings/`，因此這一批 key 都長成 `attendance.settings.errors.*`。
 */

export const ATTENDANCE = {
  settings: {
    errors: {
      'concurrently-initialized': '這間公司的出勤設定剛好被同時建立，請重新查詢目前設定後再修改一次',
    },
  },
} as const
