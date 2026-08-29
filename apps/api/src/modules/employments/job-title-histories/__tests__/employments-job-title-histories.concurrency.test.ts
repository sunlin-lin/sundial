/**
 * ★ 併發測試：兩個交易同時對同一筆任職建立重疊的職稱歷史，必須恰好一個成功、一個失敗
 * （實作計畫 `plans/05-employee-onboarding.md` §4.3、§8 Stage 5）。
 *
 * 鎖的粒度＝任職，與 `employments/department-histories` 完全同構（字典：「同一任職同一時間只能
 * 有一筆有效職稱」），本測試形狀因此逐字比照
 * `employments/department-histories/__tests__/employments-department-histories.concurrency.test.ts`，
 * 只把「部門」換成「職稱」。
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
  employeeJobTitleHistories,
  employees,
  JobTitleStatus,
  jobTitles,
  users,
} from '../../../../db/schema/index.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { createJobTitleHistory } from '../employments-job-title-histories.service.ts'
import type { JobTitleHistoriesContext } from '../domain/job-title-history-context.ts'

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
 * 建立一家公司、一位操作者、一位員工、一筆任職與兩個職稱。
 *
 * §7.3 的例外理由與 `employments-department-histories.concurrency.test.ts` 的
 * `registerFixture` 相同——`companies`／`users`／`company_users`／`employees`／`job_titles`
 * 直接寫入；任職則透過真正的 `createEmployment`。
 */
const registerFixture = async (): Promise<{
  companyId: string
  operatorCompanyUserId: string
  employmentId: string
  jobTitleIdA: string
  jobTitleIdB: string
}> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const operatorCompanyUserId = crypto.randomUUID()
  const employeeId = crypto.randomUUID()
  const jobTitleIdA = crypto.randomUUID()
  const jobTitleIdB = crypto.randomUUID()
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `職稱併發測試公司-${companyId.slice(0, 8)}`,
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
    username: `jth-concurrency-${userId}`,
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
    name: '職稱併發測試員工',
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
  await database.insert(jobTitles).values([
    {
      id: jobTitleIdA,
      companyId,
      code: 'TITLE-A',
      name: '職稱 A',
      description: null,
      isSystem: false,
      status: JobTitleStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedSeq: 0,
    },
    {
      id: jobTitleIdB,
      companyId,
      code: 'TITLE-B',
      name: '職稱 B',
      description: null,
      isSystem: false,
      status: JobTitleStatus.Active,
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

  return { companyId, operatorCompanyUserId, employmentId: employmentResult.value.id, jobTitleIdA, jobTitleIdB }
}

describe('employments/job-title-histories 併發：§4.3 期間重疊的 FOR UPDATE 鎖（鎖的粒度＝任職）', () => {
  test('★ 兩個交易同時替同一筆任職建立重疊的職稱歸屬：恰好一個成功、一個失敗', async () => {
    const { companyId, operatorCompanyUserId, employmentId, jobTitleIdA, jobTitleIdB } = await registerFixture()
    const context: JobTitleHistoriesContext = { db: database, clock, companyId, operatorCompanyUserId }

    // 兩筆生效日不同（避開 uq_employee_job_title_histories_employment_from），皆無結束日，
    // 因此兩段區間必然重疊——理由與部門歷史併發測試相同，只是鎖的對象換成 employee_employments。
    const [outcomeA, outcomeB] = await Promise.all([
      createJobTitleHistory(context, {
        employmentId,
        jobTitleId: jobTitleIdA,
        effectiveFrom: '2024-01-01',
        effectiveTo: null,
      }),
      createJobTitleHistory(context, {
        employmentId,
        jobTitleId: jobTitleIdB,
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
    expect(failure.errors.map((error) => error.code)).toContain('employments.job-title-histories.errors.period-overlap')

    // 直查資料庫確認實際列數，不只信 service 回應。
    const rows = await database
      .select({ id: employeeJobTitleHistories.id })
      .from(employeeJobTitleHistories)
      .where(eq(employeeJobTitleHistories.employmentId, employmentId))
    expect(rows.length).toBe(1)
  })
})
