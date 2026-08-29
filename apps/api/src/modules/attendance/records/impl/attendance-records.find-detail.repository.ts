/**
 * 資料存取：依 id 查單筆打卡明細，含座標。**只以公司範圍限縮，不比對是不是呼叫者本人**
 * ——「是不是本人」「是否具備查看他人的權限」是 service 層的細粒度判斷（計畫 §4.2、§5.2），
 * 這裡回的是「這一列資料庫裡實際存的樣子」，回應要不要遮蔽座標由呼叫端決定。
 *
 * **`revokedByName` 比照 `company-users/roles` 的 `assignedByName`／`revokedByName` 既有作法**
 * （`company-users-roles.list-page.repository.ts`）：`LEFT JOIN` 一次 `company_users` 再一次
 * `users`，取登入帳號名稱——`revoked_by` 是複合外鍵 `(company_id, revoked_by) → company_users`
 * （`db/schema/attendance-records.ts`），不是 `employees`，因此姓名來源與角色指派那一支一致，
 * 不是員工主檔。**這裡改用裸 `runner` 手動 JOIN，不再用 `TenantDatabase.select`**：後者只接受
 * 單一資料表，一旦要 JOIN 就得換寫法；公司範圍改成直接寫進 `WHERE`（`attendance_records` 是
 * 錨點表，`INNER JOIN` 落空時整列本來就該消失，不像 `list-by-date.repository.ts` 的
 * `LEFT JOIN` 那樣需要把公司條件挪進 `ON`）。**只有一列（`limit(1)`），不是迴圈查詢，不觸發
 * `check:n-plus-one`。**
 */
import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import type { QueryRunner } from '../../../../db/client.ts'
import { attendanceRecords, companyUsers, users } from '../../../../db/schema/index.ts'
import type { AttendanceRecordDetail } from '../domain/attendance-record-model.ts'

// 同一張表在角色指派那一支也是這樣命名別名（`assigned_by_member`／`assigned_by_account`）；
// 這裡只有一種撤銷者，沿用「member／account」這組字尾即可，不需要再分兩組。
const revokedByMember = alias(companyUsers, 'revoked_by_member')
const revokedByAccount = alias(users, 'revoked_by_account')

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
  const rows = await runner
    .select({
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
      revokedByName: revokedByAccount.username,
      revokeReason: attendanceRecords.revokeReason,
      revokedSeq: attendanceRecords.revokedSeq,
      createdAt: attendanceRecords.createdAt,
      updatedAt: attendanceRecords.updatedAt,
    })
    .from(attendanceRecords)
    // 撤銷者可以是 NULL（尚未撤銷），因此是 LEFT JOIN；公司條件放進 ON——落空的列（未撤銷）
    // 不該因為這個條件被整列濾掉，理由與 `list-by-date.repository.ts` 的 LEFT JOIN 同構。
    .leftJoin(
      revokedByMember,
      and(eq(revokedByMember.id, attendanceRecords.revokedBy), eq(revokedByMember.companyId, companyId)),
    )
    // `users` 是全域表，沒有 `company_id`，因此這一段沒有公司條件——走得到這裡的帳號
    // 一定是本公司成員的帳號，已經由上一段的 `company_users` 擋住。
    .leftJoin(revokedByAccount, eq(revokedByAccount.id, revokedByMember.userId))
    .where(and(eq(attendanceRecords.companyId, companyId), eq(attendanceRecords.id, recordId)))
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
    revokedByName: row.revokedByName,
    revokeReason: row.revokeReason,
    revokedSeq: row.revokedSeq,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
