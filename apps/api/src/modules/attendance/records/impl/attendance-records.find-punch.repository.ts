/**
 * 資料存取：打卡配對與重複檢查（計畫 §4.5）。
 *
 * **兩支查詢都必須排在 `attendance-records.find-employment-for-update.repository.ts` 的
 * `FOR UPDATE` 之後**——鎖到手之後這裡讀到的才是最新已提交資料，不是鎖定前的舊快照，理由見
 * 該檔與 `db/schema/attendance-records.ts` 檔頭。
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { attendanceRecords, AttendanceTypeCode, type AttendanceTypeCodeValue } from '../../../../db/schema/index.ts'

/** 這筆任職在指定工作日、指定類型，是否已經有一張有效卡（`revoked_seq = 0`）。 */
export const findValidPunchOnDate = async (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
  workDate: string,
  attendanceTypeCode: AttendanceTypeCodeValue,
): Promise<{ readonly id: string } | null> => {
  const rows = await new TenantDatabase(runner, companyId)
    .select(
      { id: attendanceRecords.id },
      attendanceRecords,
      eq(attendanceRecords.employmentId, employmentId),
      eq(attendanceRecords.workDate, workDate),
      eq(attendanceRecords.attendanceTypeCode, attendanceTypeCode),
      eq(attendanceRecords.revokedSeq, 0),
    )
    .limit(1)

  const row = rows[0]
  return row === undefined ? null : { id: row.id }
}

/**
 * 找出這筆任職「還沒有配到有效下班卡」的最新一張有效上班卡的 `work_date`（字典「打卡欄位定案」
 * 節：下班卡的 `work_date` 取自它要配對的那張有效上班卡）。找不到（從未打過上班卡，或每一張
 * 都已經配到下班卡）回 `null`。
 *
 * **自我 LEFT JOIN，不是 `TenantDatabase.selectFrom`**：`company-users/roles/impl/
 * company-users-roles.list-page.repository.ts` 已有先例——自我 join 的別名表無法套用
 * `TenantDatabase` 的公司範圍封裝（它認的是具名的表物件，不是動態別名），因此改為裸 `runner`，
 * 並在每一張表各自帶上 `company_id` 條件（含別名表 `pairedClockOut.companyId` 直接比對錨點
 * 那一列的 `companyId`，而不是比對字面參數，避免兩段條件各自寫、其中一段被漏寫的風險）。
 *
 * 找「還沒配到下班卡的最新上班卡」用 LEFT JOIN＋`isNull` 表達，而不是應用層迴圈比對：
 * 候選集合隨任職年資線性成長（每一天一張有效上班卡），交給資料庫一次查完、只取一列，
 * 往返次數固定為一次，不隨資料筆數增加（§4.5）。
 */
export const findPairingClockInWorkDate = async (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<string | null> => {
  const pairedClockOut = alias(attendanceRecords, 'paired_clock_out')

  const rows = await runner
    .select({ workDate: attendanceRecords.workDate })
    .from(attendanceRecords)
    .leftJoin(
      pairedClockOut,
      and(
        eq(pairedClockOut.companyId, attendanceRecords.companyId),
        eq(pairedClockOut.employmentId, attendanceRecords.employmentId),
        eq(pairedClockOut.workDate, attendanceRecords.workDate),
        eq(pairedClockOut.attendanceTypeCode, AttendanceTypeCode.ClockOut),
        eq(pairedClockOut.revokedSeq, 0),
      ),
    )
    .where(
      and(
        eq(attendanceRecords.companyId, companyId),
        eq(attendanceRecords.employmentId, employmentId),
        eq(attendanceRecords.attendanceTypeCode, AttendanceTypeCode.ClockIn),
        eq(attendanceRecords.revokedSeq, 0),
        // 找不到配對的下班卡：LEFT JOIN 落空，別名表的欄位全部是 NULL。
        isNull(pairedClockOut.id),
      ),
    )
    .orderBy(desc(attendanceRecords.workDate))
    .limit(1)

  const row = rows[0]
  return row === undefined ? null : row.workDate
}
