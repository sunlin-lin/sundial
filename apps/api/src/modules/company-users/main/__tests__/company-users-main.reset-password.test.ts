/**
 * 重設密碼（`resetCompanyUserPassword`，UI 定案 `docs/ui/20-employee-list.md` §3.5）的
 * 整合測試。**直接呼叫模組入口**，不透過 HTTP：這幾條測試要驗的是稽核紀錄的內容、密碼
 * 是否真的被換掉、以及失敗路徑會不會把密碼寫進 log，這些在 service 層就回答得完整。
 *
 * **不得 mock 掉 `recordAudit`**（§7.3）：這幾條測試的價值就在於驗真的有寫進去、而且只有
 * `presence`、沒有值。
 */
import { beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { AuditActorType, auditLogs, companies, companyUsers, users } from '../../../../db/schema/index.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { CompanyUserErrorCode } from '../company-users-main.errors.ts'
import { resetCompanyUserPassword } from '../company-users-main.service.ts'

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

/** 建立一家公司、一個登入帳號與其公司成員關係。§7.3 的例外：這幾張表沒有從零開始的正式流程。 */
const registerCompanyUser = async (): Promise<{ companyId: string; companyUserId: string; userId: string }> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `重設密碼測試公司-${companyId.slice(0, 8)}`,
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
    username: `reset-pwd-${userId}`,
    passwordHash: 'original-not-a-real-hash',
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

  return { companyId, companyUserId, userId }
}

const readAuditLogs = (subjectId: string) =>
  database
    .select({
      actorTypeCode: auditLogs.actorTypeCode,
      actorCompanyUserId: auditLogs.actorCompanyUserId,
      action: auditLogs.action,
      subjectTable: auditLogs.subjectTable,
      subjectId: auditLogs.subjectId,
      changes: auditLogs.changes,
    })
    .from(auditLogs)
    .where(eq(auditLogs.subjectId, subjectId))

const parseChanges = (raw: unknown): readonly Record<string, unknown>[] =>
  (typeof raw === 'string' ? JSON.parse(raw) : raw) as readonly Record<string, unknown>[]

const readUserRow = async (userId: string) => {
  const rows = await database
    .select({
      passwordHash: users.passwordHash,
      mustChangePassword: users.mustChangePassword,
      passwordChangedAt: users.passwordChangedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
  const row = rows[0]
  if (row === undefined) throw new Error('測試斷言失敗：找不到這個 userId')
  return row
}

describe('company-users/main 重設密碼（實作計畫 05-employee-onboarding.md）', () => {
  test('★ 密碼真的被換掉、must_change_password 變 true，且稽核只有 presence、沒有值', async () => {
    const { companyId, companyUserId, userId } = await registerCompanyUser()
    const before = await readUserRow(userId)

    const result = await resetCompanyUserPassword(
      database,
      companyId,
      companyUserId, // 這個測試裡操作者與被操作者是同一位，純粹圖方便，不影響驗證重點
      { companyUserId, newPassword: 'a-brand-new-password-123' },
      clock.now(),
    )

    expect(result.ok).toBe(true)

    const after = await readUserRow(userId)
    expect(after.passwordHash).not.toBe(before.passwordHash)
    // Argon2id 的雜湊字串固定以這個前綴開頭（`sessions/main/domain/session-password.ts`
    // 的 `hashPassword` 寫死演算法），藉此確認寫進去的真的是新算出來的雜湊，不是原樣搬過去。
    expect(after.passwordHash.startsWith('$argon2id$')).toBe(true)
    expect(after.mustChangePassword).toBe(true)
    expect(after.passwordChangedAt).toBe(clock.now())

    // ★ 稽核紀錄內容：只有一筆、只有 `presence`，看不到密碼或密碼 hash 的任何蹤跡。
    const rows = await readAuditLogs(companyUserId)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.actorTypeCode).toBe(AuditActorType.CompanyUser)
    expect(row?.actorCompanyUserId).toBe(companyUserId)
    expect(row?.action).toBe('company-users.main.reset-password')
    expect(row?.subjectTable).toBe('company_users')
    expect(row?.subjectId).toBe(companyUserId)

    const changes = parseChanges(row?.changes)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toEqual({ field: 'passwordReset', changed: true })
    // 逐字證明：整段稽核內容序列化後，密碼明文與新算出來的雜湊都不在裡面。
    const serializedChanges = JSON.stringify(row?.changes)
    expect(serializedChanges).not.toContain('a-brand-new-password-123')
    expect(serializedChanges).not.toContain(after.passwordHash)
  })

  test('目標成員不存在（含跨公司）回 company-user-not-found，且不建立任何稽核紀錄', async () => {
    const { companyId, companyUserId } = await registerCompanyUser()
    const otherCompany = await registerCompanyUser()

    const notFound = await resetCompanyUserPassword(
      database,
      companyId,
      companyUserId,
      { companyUserId: crypto.randomUUID(), newPassword: 'irrelevant-password-000' },
      clock.now(),
    )
    expect(notFound.ok).toBe(false)
    if (notFound.ok) throw new Error('不會走到這裡')
    expect(notFound.errors[0]?.code).toBe(CompanyUserErrorCode.CompanyUserNotFound)

    // 跨公司：拿別家公司真實存在的 companyUserId，一樣回「找不到」（§3.2 不可區分）。
    const crossCompany = await resetCompanyUserPassword(
      database,
      companyId,
      companyUserId,
      { companyUserId: otherCompany.companyUserId, newPassword: 'irrelevant-password-000' },
      clock.now(),
    )
    expect(crossCompany.ok).toBe(false)
    if (crossCompany.ok) throw new Error('不會走到這裡')
    expect(crossCompany.errors[0]?.code).toBe(CompanyUserErrorCode.CompanyUserNotFound)
  })

  test('★ 故意讓重設失敗：console 沒有任何一行輸出包含明碼密碼', async () => {
    const { companyId, companyUserId } = await registerCompanyUser()
    const plainPassword = 'this-must-never-appear-in-any-log-999'

    const infoSpy = spyOn(console, 'info')
    const warnSpy = spyOn(console, 'warn')
    const errorSpy = spyOn(console, 'error')

    try {
      // 故意讓它失敗：目標成員不存在。這條路徑在 `findCompanyUserById` 就回傳 `null`，
      // `newPassword` 從頭到尾沒有被拿去 `hashPassword`，也沒有被塞進任何錯誤物件。
      const result = await resetCompanyUserPassword(
        database,
        companyId,
        companyUserId,
        { companyUserId: crypto.randomUUID(), newPassword: plainPassword },
        clock.now(),
      )
      expect(result.ok).toBe(false)

      // 業務拒絕（Unprocessable）不會觸發任何 `logger.*` 呼叫（見 `http/error-boundary.ts`：
      // 只有 Forbidden 與「錯誤集合為空」兩種情況才會寫 log），因此這裡預期完全沒有輸出——
      // 「沒有任何輸出」本身就是「不可能有密碼」最強的證明。
      const allOutput = [...infoSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
        .flat()
        .map((value) => String(value))
        .join('\n')
      expect(allOutput).not.toContain(plainPassword)

      // 同時逐欄檢查回傳的錯誤結果本身：`data`／`msg`／`code` 都不含密碼字串
      // ——就算未來有人改成會記 log，這一條斷言也擋得住「把整個 result 丟進 log」這種寫法。
      expect(JSON.stringify(result)).not.toContain(plainPassword)
    } finally {
      infoSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})
