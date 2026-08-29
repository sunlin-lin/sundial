/**
 * ★ 併發測試：同一員工同一秒送兩次上班打卡，必須恰好一筆成功、一筆回衝突（實作計畫
 * `plans/06-attendance.md` §4.5、§5 Stage 3）。
 *
 * 這是唯一能證明「鎖的粒度＝任職、`FOR UPDATE` 是交易第一句」真的有效的東西——純邏輯測試只能
 * 驗證配對／重複檢查的判斷本身算得對不對，驗不出鎖有沒有真的擋住第二個交易；`FOR UPDATE` 寫錯
 * 位置（鎖在交易外、鎖到手前先做了一般查詢、沒有等待）在純邏輯測試裡完全看不出來——兩個「並發」
 * 呼叫在同一個 process 內用假的 clock／假的 repository 跑，本來就不會真的競爭同一列。因此本測試
 * 對**真的 MariaDB** 開兩個連線（同一個 pool，`mysql2` 的 `waitForConnections: true` 保證併發
 * 呼叫各自拿到獨立連線），不 mock 任何一層。
 *
 * **不得 mock 掉 repository 或 `db.transaction`**（§7.3）：這幾條測試的全部價值就在於驗真的
 * 有鎖住。
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createDatabase, type Database } from '../../../../db/client.ts'
import {
  attendanceRecords,
  companies,
  companyUsers,
  employeeEmployments,
  employees,
  EmploymentStatus,
  EmploymentTypeCode,
  users,
} from '../../../../db/schema/index.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { createAttendanceRecord, revokeOtherAttendanceRecord } from '../attendance-records.service.ts'
import type { AttendanceRecordsContext } from '../domain/attendance-record-context.ts'
import { AttendanceRecordErrorCode } from '../attendance-records.errors.ts'

const readTestDatabaseConfig = () => ({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

/** 釘住「現在」（§6.2）。台北時間 2026-08-27 12:00:00。 */
const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))

let database: Database

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
})

/**
 * 建立一家公司、一位員工，且該員工的登入帳號（`company_users.employee_id`）就是這位員工自己
 * ——打卡的操作者必須是「自己」，不像 `employments/main` 的併發測試那樣操作者與目標員工是分開
 * 兩個角色。
 *
 * **任職直接寫入 `employee_employments`，不呼叫 `employments/main` 的 `createEmployment`**：
 * 那是另一個大目錄的業務動作，只能透過 `modules/employments/index.ts` 呼叫（§0.3），而它只
 * export `service`／`errors`，不 export 測試固定資料常用的內部型別；直接寫入資料列與
 * `company-users/roles` 稽核測試（`registerCompanyWithRoles`）、`sessions` 重用偵測測試
 * （`registerMember`）是同一種處置（§7.3 的例外：這幾張表目前沒有從零開始的正式流程可以呼叫）。
 */
const registerFixture = async (): Promise<{ companyId: string; operatorCompanyUserId: string }> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const operatorCompanyUserId = crypto.randomUUID()
  const employeeId = crypto.randomUUID()
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `打卡併發測試公司-${companyId.slice(0, 8)}`,
    shortName: null,
    registeredPostalCode: null,
    registeredCity: null,
    registeredDistrict: null,
    registeredAddress: null,
    actualPostalCode: null,
    actualCity: null,
    actualDistrict: null,
    actualAddress: null,
    invoicePostalCode: null,
    invoiceCity: null,
    invoiceDistrict: null,
    invoiceAddress: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedSeq: 0,
  })
  await database.insert(users).values({
    id: userId,
    username: `attendance-concurrency-${userId}`,
    passwordHash: 'not-a-real-hash',
    mustChangePassword: false,
    passwordChangedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  await database.insert(employees).values({
    id: employeeId,
    companyId,
    employeeCode: `E${employeeId.slice(0, 8)}`,
    name: '打卡併發測試員工',
    gender: 'MALE',
    identityNumberEncrypted: randomBytes(32),
    identityNumberHash: randomBytes(32),
    birthdayEncrypted: randomBytes(16),
    phoneEncrypted: randomBytes(16),
    emailEncrypted: null,
    addressEncrypted: randomBytes(32),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedSeq: 0,
  })
  // 操作者的登入帳號連結到這位員工——打卡時 employeeId／employmentId 由這條連結推出（計畫 §4.4）。
  await database.insert(companyUsers).values({
    id: operatorCompanyUserId,
    companyId,
    userId,
    employeeId,
    status: 'ACTIVE',
    activatedAt: now,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  await database.insert(employeeEmployments).values({
    id: crypto.randomUUID(),
    companyId,
    employeeId,
    employmentTypeCode: EmploymentTypeCode.FullTime,
    employmentNatureCode: null,
    hireDate: '2024-01-01',
    leaveDate: null,
    lastWorkingDate: null,
    leaveReasonCode: null,
    status: EmploymentStatus.Active,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedSeq: 0,
  })

  return { companyId, operatorCompanyUserId }
}

/**
 * 額外的公司成員（純協作者，不連結員工）——供撤銷者身分使用。`revoked_by` 與 `audit_logs.
 * actor_company_user_id` 都有複合外鍵指向 `(company_id, id)`，隨機造一個不存在的 uuid 會直接
 * 撞外鍵違反而不是得到一個乾淨的業務結果，因此撤銷者必須是真實寫入的 `company_users` 列。
 */
const registerCompanyUser = async (companyId: string): Promise<string> => {
  const userId = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  const now = clock.now()

  await database.insert(users).values({
    id: userId,
    username: `atd-reviewer-${userId}`,
    passwordHash: 'not-a-real-hash',
    mustChangePassword: false,
    passwordChangedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  await database.insert(companyUsers).values({
    id: companyUserId,
    companyId,
    userId,
    employeeId: null,
    status: 'ACTIVE',
    activatedAt: now,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  return companyUserId
}

describe('attendance/records 併發：§4.5 打卡的 FOR UPDATE 鎖（鎖的粒度＝任職）', () => {
  test('★ 同一員工同一秒送兩次上班打卡：恰好一筆成功、一筆回衝突', async () => {
    const { companyId, operatorCompanyUserId } = await registerFixture()
    const context: AttendanceRecordsContext = { db: database, clock, companyId, operatorCompanyUserId }

    const [outcomeA, outcomeB] = await Promise.all([
      createAttendanceRecord(context, {
        attendanceTypeCode: 1,
        latitude: null,
        longitude: null,
        accuracyMeters: null,
      }),
      createAttendanceRecord(context, {
        attendanceTypeCode: 1,
        latitude: null,
        longitude: null,
        accuracyMeters: null,
      }),
    ])

    const results = [outcomeA, outcomeB]
    const succeeded = results.filter((result) => result.ok)
    const failed = results.filter((result) => !result.ok)

    // ★ 恰好一個成功、一個失敗——不是兩個都成功（靜默重疊，鎖沒生效），也不是兩個都失敗
    // （鎖卡死或誤判）。
    expect(succeeded.length).toBe(1)
    expect(failed.length).toBe(1)

    const failure = failed[0]
    if (failure === undefined || failure.ok) throw new Error('預期恰好一筆失敗結果')
    expect(failure.errors.map((error) => error.code)).toContain(AttendanceRecordErrorCode.AlreadyPunched)

    // 直查資料庫確認實際列數，不只信 service 回應：這位員工今天名下確實只有一筆有效上班卡。
    const rows = await database
      .select({ id: attendanceRecords.id })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.companyId, companyId))
    expect(rows.length).toBe(1)
  })

  test('★ 兩位審核者同時對同一筆記錄呼叫 revoke-other：恰好一筆成功（條件式 UPDATE 的併發安全）', async () => {
    const { companyId, operatorCompanyUserId } = await registerFixture()
    const context: AttendanceRecordsContext = { db: database, clock, companyId, operatorCompanyUserId }

    const created = await createAttendanceRecord(context, {
      attendanceTypeCode: 1,
      latitude: null,
      longitude: null,
      accuracyMeters: null,
    })
    if (!created.ok) throw new Error('測試固定資料準備失敗：打卡沒有成功')

    // 兩位審核者各自是真實寫入的 `company_users` 列（見 `registerCompanyUser` 檔頭）——
    // 本測試要驗的是條件式 UPDATE 本身的併發安全，不是撤銷者的身分，因此不連結員工。
    const reviewerAId = await registerCompanyUser(companyId)
    const reviewerBId = await registerCompanyUser(companyId)

    const [outcomeA, outcomeB] = await Promise.all([
      revokeOtherAttendanceRecord(
        { db: database, clock, companyId, operatorCompanyUserId: reviewerAId },
        { recordId: created.value.id, reason: '審核者 A 撤銷' },
      ),
      revokeOtherAttendanceRecord(
        { db: database, clock, companyId, operatorCompanyUserId: reviewerBId },
        { recordId: created.value.id, reason: '審核者 B 撤銷' },
      ),
    ])

    const results = [outcomeA, outcomeB]
    const succeeded = results.filter((result) => result.ok)
    const failed = results.filter((result) => !result.ok)

    expect(succeeded.length).toBe(1)
    expect(failed.length).toBe(1)

    const failure = failed[0]
    if (failure === undefined || failure.ok) throw new Error('預期恰好一筆失敗結果')
    expect(failure.errors.map((error) => error.code)).toContain(AttendanceRecordErrorCode.AlreadyRevoked)

    // 直查資料庫：只有一筆稽核紀錄，不是兩筆（否則代表兩個撤銷都被當成成功處理過一次）。
    const rows = await database
      .select({ revokedBy: attendanceRecords.revokedBy })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.id, created.value.id))
    expect(rows.length).toBe(1)
    const revokedBy = rows[0]?.revokedBy ?? null
    expect(revokedBy === reviewerAId || revokedBy === reviewerBId).toBe(true)
  })
})
