/**
 * 資料存取：新增一筆打卡事件。唯一鍵違反轉成 `AttendanceRecordInsertOutcome`（計畫 §4.5：
 * 鎖與配對查詢之外的最後一道保險，理由與 `employments/job-title-histories` 的同名切片同構）。
 *
 * **座標在這裡才轉成字串**：`latitude`／`longitude` 欄位是 `decimal(9,7)`／`decimal(10,7)`，
 * 業務層與 API 邊界一律用 `number`（計畫 §4.2），寫入資料庫前用 `toFixed(7)` 轉回定點字串——
 * 這一步與 §4.7 讀出時的 `Number(...)` 是相反方向的轉型，理由相同：座標不參與加總或門檻比較，
 * 轉型本身不是那條規則要防的「先轉數字再計算」。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import {
  attendanceRecords,
  type AttendanceSourceTypeCodeValue,
  type AttendanceTypeCodeValue,
} from '../../../../db/schema/index.ts'
import {
  isDuplicateAttendanceRecord,
  type AttendanceRecordInsertOutcome,
} from '../domain/attendance-record-duplicate.ts'

export type NewAttendanceRecord = {
  readonly id: string
  readonly employeeId: string
  readonly employmentId: string
  readonly workDate: string
  readonly attendanceTypeCode: AttendanceTypeCodeValue
  readonly sourceTypeCode: AttendanceSourceTypeCodeValue
  readonly clockedAt: string
  readonly latitude: number | null
  readonly longitude: number | null
  readonly accuracyMeters: number | null
  readonly now: string
}

const toDecimalString = (value: number | null, fractionDigits: number): string | null =>
  value === null ? null : value.toFixed(fractionDigits)

export const insertAttendanceRecord = async (
  runner: QueryRunner,
  companyId: string,
  record: NewAttendanceRecord,
): Promise<AttendanceRecordInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insert(attendanceRecords, (scopedCompanyId) => ({
      id: record.id,
      companyId: scopedCompanyId,
      employeeId: record.employeeId,
      employmentId: record.employmentId,
      employeeScheduleId: null,
      workDate: record.workDate,
      attendanceTypeCode: record.attendanceTypeCode,
      sourceTypeCode: record.sourceTypeCode,
      sourceId: null,
      clockedAt: record.clockedAt,
      latitude: toDecimalString(record.latitude, 7),
      longitude: toDecimalString(record.longitude, 7),
      accuracyMeters: record.accuracyMeters,
      // 反查地址由背景服務非同步補上，Stage 3 不含反查服務（見 `db/schema/attendance-records.ts`
      // 檔頭第 2 點與該表欄位註解），打卡當下恆寫入 NULL。
      address: null,
      addressResolvedAt: null,
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
      revokedSeq: 0,
      createdAt: record.now,
      updatedAt: record.now,
    }))
    return 'inserted'
  } catch (error) {
    if (isDuplicateAttendanceRecord(error)) return 'duplicate'
    throw error
  }
}
