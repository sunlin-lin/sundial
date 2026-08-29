/**
 * 出勤設定的業務型別（service ↔ repository 之間傳遞的形狀）。
 *
 * 這一組型別**刻意不等於 Drizzle 的 row，也不等於端點的 `data`**（§1.8.0 的三種形狀）：
 * 三者共用同一個型別時，資料表加一個欄位就會自動出現在 API 上，而且沒有任何一行程式碼會改變。
 * 出勤設定沒有個資欄位，但這條規則不因此鬆動。
 *
 * 本目錄一律零 IO：這裡只有型別，沒有任何資料庫或 http 相依（§0.1、§3.1.1）。
 */

/** 六個開關的共用形狀。`AttendanceSettingsDetail`／`UpdateAttendanceSettingsInput`／稽核快照都是它的延伸。 */
export type AttendanceSettingsToggles = {
  /** 是否要求有效上班卡後才能打下班卡。 */
  readonly requireClockInBeforeClockOut: boolean
  /** 是否允許員工自行撤銷誤打紀錄。 */
  readonly allowEmployeeCancellation: boolean
  /** 是否允許申請補登。 */
  readonly allowCorrectionRequest: boolean
  /** 補登是否需審核。 */
  readonly correctionRequiresApproval: boolean
  /** 是否接受 GPS 資訊。 */
  readonly gpsEnabled: boolean
  /** GPS 是否強制；`gpsEnabled=false` 時這一欄的值不具業務意義，但欄位本身仍然必填。 */
  readonly gpsRequired: boolean
}

/**
 * 單一公司的出勤設定完整內容。`get`／`update` 共用同一個形狀。
 *
 * **沒有 `companyId`**：與 `DepartmentDetail`／`ShiftDetail` 同一個判準——公司範圍是呼叫的前提
 * 而不是回應的內容，回聲一個呼叫端自己就知道的值沒有意義，也避免有人誤以為這是可寫欄位。
 */
export type AttendanceSettingsDetail = AttendanceSettingsToggles & {
  readonly id: string
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * `update` 端點的輸入。**沒有 `id`**：這張表一間公司一筆，`id` 由 service 依「這間公司有沒有
 * 存過設定」決定沿用既有的還是重新產生，不需要、也不該由呼叫端指定（指定了就要處理「送進來的
 * id 跟公司目前那一筆對不上」這種情況，而這種情況沒有任何正常操作會產生）。
 */
export type UpdateAttendanceSettingsInput = AttendanceSettingsToggles

/**
 * 稽核快照（計畫 `06-attendance.md` §4.6 定案：整表 `Value` 級，比照「規則設定類」）。
 *
 * 與 {@link AttendanceSettingsToggles} 目前欄位逐字相同，仍然獨立宣告一個型別而不是直接複用：
 * 理由與 `EmploymentAuditSnapshot`／`LaborPensionSettingAuditSnapshot` 相同——稽核快照的定義域
 * 由 `audit-field-policy.ts` 的 `source` 指到這裡，若之後業務型別多了一個不需要稽核的欄位
 * （例如某種只供內部使用的旗標），兩者要能各自演化而不需要同時改動 `AUDIT_FIELD_POLICY`。
 */
export type AttendanceSettingsAuditSnapshot = AttendanceSettingsToggles
