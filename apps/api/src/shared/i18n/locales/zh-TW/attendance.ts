/**
 * 語系檔：zh-TW × `modules/attendance/`（§1.3、§1.8.2）。
 *
 * 形狀與 key 的推導規則見同目錄的 `sessions.ts` 檔頭：次目錄 → 類別 → 訊息名，
 * 對應 `modules/attendance/settings/`／`modules/attendance/records/`，因此這一批 key 分別長成
 * `attendance.settings.errors.*`／`attendance.records.errors.*`。
 */

export const ATTENDANCE = {
  settings: {
    errors: {
      'concurrently-initialized': '這間公司的出勤設定剛好被同時建立，請重新查詢目前設定後再修改一次',
    },
  },
  records: {
    errors: {
      'operator-not-employee': '目前登入的帳號沒有連結有效的員工任職，無法打卡',
      'already-punched': '這個工作日已經有一筆同類型的有效打卡紀錄，請重新整理後再試',
      'no-clock-in-to-pair': '找不到可配對的有效上班卡，請先完成上班打卡',
      'gps-required': '公司出勤設定要求打卡時提供定位資訊，請開啟定位後再試',
      'not-found': '找不到這筆打卡紀錄',
      'already-revoked': '這筆打卡紀錄剛好已經被撤銷，請重新整理後再試',
      'clock-out-must-be-revoked-first': '這筆上班卡已經有對應的下班卡，請先撤銷下班卡再撤銷這筆上班卡',
      'period-locked': '這個工作日的薪資已結算，如需更正請改走補打卡流程',
      'cancellation-not-allowed': '公司目前不允許員工自行撤銷打卡紀錄，如需更正請改走補打卡流程或聯繫人事協助撤銷',
    },
  },
  'correction-requests': {
    errors: {
      'operator-not-employee': '目前登入的帳號沒有連結有效的員工任職，無法申請補打卡',
      'future-date-not-allowed': '不可選擇尚未發生的日期',
      'already-punched': '這個工作日已經有一筆同類型的有效打卡紀錄，不需要申請補登',
      'invalid-clock-order': '申請補登時間與同一工作日已有的打卡時間先後順序不符',
      'duplicate-pending-request': '這個工作日、這個類型已經有一筆待審核的補打卡申請',
      'period-locked': '這個工作日的薪資已結算，無法申請補打卡',
      'correction-request-not-allowed': '公司目前不允許申請補打卡，請聯繫人事協助處理',
      'not-found': '找不到這筆補打卡申請',
      'not-withdrawable': '這筆補打卡申請目前不是待審核狀態，無法撤回',
    },
  },
} as const
