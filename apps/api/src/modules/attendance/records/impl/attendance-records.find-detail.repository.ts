/**
 * 資料存取：依 id 查單筆打卡明細，含座標。**只以公司範圍限縮，不比對是不是呼叫者本人**
 * ——「是不是本人」「是否具備查看他人的權限」是 service 層的細粒度判斷（計畫 §4.2、§5.2），
 * 這裡回的是「這一列資料庫裡實際存的樣子」，回應要不要遮蔽座標由呼叫端決定。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { attendanceRecords } from '../../../../db/schema/index.ts'
import type { AttendanceRecordDetail } from '../domain/attendance-record-model.ts'

/**
 * 座標由 `decimal` 字串轉成 `number`。**這一行 `Number(...)` 不是 §4.7 禁止的那種**：座標不加總、
 * 不做門檻比較，這裡單純轉型後直接輸出，沒有計算——完整推論見 `domain/attendance-record-model.ts`
 * 的 `AttendanceRecordDetail.latitude` 檔頭與計畫 §4.2。
 */
const toCoordinate = (value: string | null): number | null => (value === null ? null : Number(value))

export const findAttendanceRecordDetail = async (
  runner: QueryRunner,
  companyId: string,
  recordId: string,
): Promise<AttendanceRecordDetail | null> => {
  const rows = await new TenantDatabase(runner, companyId)
    .select(
      {
        id: attendanceRecords.id,
        employeeId: attendanceRecords.employeeId,
        employmentId: attendanceRecords.employmentId,
        workDate: attendanceRecords.workDate,
        attendanceTypeCode: attendanceRecords.attendanceTypeCode,
        sourceTypeCode: attendanceRecords.sourceTypeCode,
        sourceId: attendanceRecords.sourceId,
        clockedAt: attendanceRecords.clockedAt,
        latitude: attendanceRecords.latitude,
        longitude: attendanceRecords.longitude,
        accuracyMeters: attendanceRecords.accuracyMeters,
        address: attendanceRecords.address,
        addressResolvedAt: attendanceRecords.addressResolvedAt,
        revokedAt: attendanceRecords.revokedAt,
        revokedBy: attendanceRecords.revokedBy,
        revokeReason: attendanceRecords.revokeReason,
        revokedSeq: attendanceRecords.revokedSeq,
        createdAt: attendanceRecords.createdAt,
        updatedAt: attendanceRecords.updatedAt,
      },
      attendanceRecords,
      eq(attendanceRecords.id, recordId),
    )
    .limit(1)

  const row = rows[0]
  if (row === undefined) return null

  return {
    id: row.id,
    employeeId: row.employeeId,
    employmentId: row.employmentId,
    workDate: row.workDate,
    attendanceTypeCode: row.attendanceTypeCode,
    sourceTypeCode: row.sourceTypeCode,
    sourceId: row.sourceId,
    clockedAt: row.clockedAt,
    latitude: toCoordinate(row.latitude),
    longitude: toCoordinate(row.longitude),
    accuracyMeters: row.accuracyMeters,
    address: row.address,
    addressResolvedAt: row.addressResolvedAt,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
    revokeReason: row.revokeReason,
    revokedSeq: row.revokedSeq,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
