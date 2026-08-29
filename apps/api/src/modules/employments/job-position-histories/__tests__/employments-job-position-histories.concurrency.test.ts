/**
 * ★★★ 併發測試：職務歷史的鎖粒度是三張歷史表裡唯一的例外（實作計畫 `plans/
 * 05-employee-onboarding.md` §4.3 末段、§8 Stage 5）。字典：「同一任職可同時有多個有效職務，
 * 但同一職務期間不得重疊」——鎖的粒度是 `(employment_id, job_position_id)` 這個**組合**。
 *
 * 本檔有兩支測試，**第二支是全部三張歷史表併發測試裡最重要的一支**：
 *
 * 1. 同一任職、**同一職務**、重疊期間 → 恰好一個成功、一個失敗（驗證真的有序列化與重疊檢查）。
 * 2. ★ 同一任職、**不同職務**、重疊期間 → 兩個都要成功（驗證鎖沒有錯誤地鎖到「任職」——
 *    若把粒度寫成任職，且重疊檢查照抄部門歷史「只看 employment_id」的寫法，這一支會失敗；
 *    第 1 支測試單獨存在時看不出這個錯誤，因為鎖到任職一樣會讓第 1 支「看起來」通過）。
 *
 * 每支都直查資料庫確認實際列數，不只信 service 回應。
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createEmployment } from '../../main/employments-main.service.ts'
import type { EmploymentsMainContext } from '../../main/domain/employment-context.ts'
import { createDatabase, type Database } from '../../../../db/client.ts'
import {
  companies,
  companyUsers,
  employeeJobPositionHistories,
  employees,
  JobPositionStatus,
  jobPositions,
  users,
} from '../../../../db/schema/index.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { createJobPositionHistories } from '../employments-job-position-histories.service.ts'
import type { JobPositionHistoriesContext } from '../domain/job-position-history-context.ts'

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

/** 建立一家公司、一位操作者、一位員工、一筆任職與兩個職務（§7.3 的例外）。 */
const registerFixture = async (): Promise<{
  companyId: string
  operatorCompanyUserId: string
  employmentId: string
  jobPositionIdA: string
  jobPositionIdB: string
}> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const operatorCompanyUserId = crypto.randomUUID()
  const employeeId = crypto.randomUUID()
  const jobPositionIdA = crypto.randomUUID()
  const jobPositionIdB = crypto.randomUUID()
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `職務併發測試公司-${companyId.slice(0, 8)}`,
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
    username: `jph-concurrency-${userId}`,
    passwordHash: 'not-a-real-hash',
    mustChangePassword: false,
    passwordChangedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  await database.insert(companyUsers).values({
    id: operatorCompanyUserId,
    companyId,
    userId,
    employeeId: null,
    status: 'ACTIVE',
    activatedAt: now,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  await database.insert(employees).values({
    id: employeeId,
    companyId,
    employeeCode: `E${employeeId.slice(0, 8)}`,
    name: '職務併發測試員工',
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
  await database.insert(jobPositions).values([
    {
      id: jobPositionIdA,
      companyId,
      code: 'POSITION-A',
      name: '職務 A',
      description: null,
      isSystem: false,
      status: JobPositionStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedSeq: 0,
    },
    {
      id: jobPositionIdB,
      companyId,
      code: 'POSITION-B',
      name: '職務 B',
      description: null,
      isSystem: false,
      status: JobPositionStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedSeq: 0,
    },
  ])

  const employmentContext: EmploymentsMainContext = { db: database, clock, companyId, operatorCompanyUserId }
  const employmentResult = await createEmployment(employmentContext, {
    employeeId,
    employmentTypeCode: 1,
    employmentNatureCode: null,
    hireDate: '2024-01-01',
  })
  if (!employmentResult.ok) throw new Error('測試固定資料準備失敗：建立任職沒有成功')

  return {
    companyId,
    operatorCompanyUserId,
    employmentId: employmentResult.value.id,
    jobPositionIdA,
    jobPositionIdB,
  }
}

describe('employments/job-position-histories 併發：§4.3 期間重疊的鎖（鎖的粒度＝(employment_id, job_position_id)）', () => {
  test('同一任職、同一職務、重疊期間 → 恰好一個成功、一個失敗', async () => {
    const { companyId, operatorCompanyUserId, employmentId, jobPositionIdA } = await registerFixture()
    const context: JobPositionHistoriesContext = { db: database, clock, companyId, operatorCompanyUserId }

    // 兩個交易都指派**同一個**職務（jobPositionIdA），期間重疊（不同生效日、皆無結束日）。
    const [outcomeA, outcomeB] = await Promise.all([
      createJobPositionHistories(context, {
        employmentId,
        jobPositionIds: [jobPositionIdA],
        effectiveFrom: '2024-01-01',
        effectiveTo: null,
      }),
      createJobPositionHistories(context, {
        employmentId,
        jobPositionIds: [jobPositionIdA],
        effectiveFrom: '2024-06-01',
        effectiveTo: null,
      }),
    ])

    const results = [outcomeA, outcomeB]
    const succeeded = results.filter((result) => result.ok)
    const failed = results.filter((result) => !result.ok)

    expect(succeeded.length).toBe(1)
    expect(failed.length).toBe(1)

    const failure = failed[0]
    if (failure === undefined || failure.ok) throw new Error('預期恰好一筆失敗結果')
    expect(failure.errors.map((error) => error.code)).toContain(
      'employments.job-position-histories.errors.period-overlap',
    )

    // 直查資料庫：同一個職務只留下一筆。
    const rows = await database
      .select({ id: employeeJobPositionHistories.id })
      .from(employeeJobPositionHistories)
      .where(eq(employeeJobPositionHistories.employmentId, employmentId))
    expect(rows.length).toBe(1)
  })

  /**
   * ★★★ 全部三張歷史表併發測試裡最重要的一支：見本檔檔頭。
   *
   * 若鎖（或重疊檢查）的粒度錯誤地寫成「任職」而不是「(任職, 職務)」，這裡會有一個請求被誤判
   * 為與另一個職務的期間重疊而拒絕——但兩者是不同職務，字典明文允許同時存在。
   */
  test('★ 同一任職、不同職務、重疊期間 → 兩個都要成功', async () => {
    const { companyId, operatorCompanyUserId, employmentId, jobPositionIdA, jobPositionIdB } = await registerFixture()
    const context: JobPositionHistoriesContext = { db: database, clock, companyId, operatorCompanyUserId }

    // 兩個交易指派**不同**職務，期間完全相同（同一天生效、皆無結束日）——如果鎖或重疊檢查
    // 錯誤地只看 employmentId，這兩筆會被誤判為互相重疊。
    const [outcomeA, outcomeB] = await Promise.all([
      createJobPositionHistories(context, {
        employmentId,
        jobPositionIds: [jobPositionIdA],
        effectiveFrom: '2024-01-01',
        effectiveTo: null,
      }),
      createJobPositionHistories(context, {
        employmentId,
        jobPositionIds: [jobPositionIdB],
        effectiveFrom: '2024-01-01',
        effectiveTo: null,
      }),
    ])

    // ★ 兩個都必須成功——這是本檔存在的唯一理由。
    expect(outcomeA.ok).toBe(true)
    expect(outcomeB.ok).toBe(true)

    // 直查資料庫確認：同一任職現在有兩筆有效職務歷史，分屬兩個不同職務。
    const rows = await database
      .select({ jobPositionId: employeeJobPositionHistories.jobPositionId })
      .from(employeeJobPositionHistories)
      .where(eq(employeeJobPositionHistories.employmentId, employmentId))
    expect(rows.length).toBe(2)
    const jobPositionIds = new Set(rows.map((row) => row.jobPositionId))
    expect(jobPositionIds).toEqual(new Set([jobPositionIdA, jobPositionIdB]))
  })
})
