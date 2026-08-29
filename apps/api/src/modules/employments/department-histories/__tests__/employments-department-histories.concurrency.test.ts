/**
 * ★ 併發測試：兩個交易同時對同一筆任職建立重疊的部門歸屬，必須恰好一個成功、一個失敗
 * （實作計畫 `plans/05-employee-onboarding.md` §4.3）。
 *
 * **鎖的粒度＝任職，不是員工**——這是三張表裡唯一的例外（計畫 §4.3 末段），本測試要證明的
 * 正是這一點：鎖住的是 `employee_employments`，不是 `employees`。理由與
 * `employments/main/__tests__/employments-main.concurrency.test.ts` 檔頭相同，不重述。
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
  DepartmentStatus,
  departments,
  employeeDepartmentHistories,
  employees,
  users,
} from '../../../../db/schema/index.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { createDepartmentHistory } from '../employments-department-histories.service.ts'
import type { DepartmentHistoriesContext } from '../domain/department-history-context.ts'

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
 * 建立一家公司、一位操作者、一位員工、一筆任職與兩個部門。
 *
 * §7.3 的例外理由與 `employments-main.concurrency.test.ts` 的 `registerCompanyWithEmployee` 相同
 * ——`companies`／`users`／`company_users`／`employees` 直接寫入；任職與部門則各自透過真正的
 * `createEmployment`／直接寫入 `departments`（`departments/main/create` 一樣要求已登入，
 * 本測試不需要驗證部門模組的業務規則，直接寫入即可）。
 */
const registerFixture = async (): Promise<{
  companyId: string
  operatorCompanyUserId: string
  employmentId: string
  departmentIdA: string
  departmentIdB: string
}> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const operatorCompanyUserId = crypto.randomUUID()
  const employeeId = crypto.randomUUID()
  const departmentIdA = crypto.randomUUID()
  const departmentIdB = crypto.randomUUID()
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `併發測試公司-${companyId.slice(0, 8)}`,
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
    username: `dept-history-concurrency-${userId}`,
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
    name: '併發測試員工',
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
  await database.insert(departments).values([
    {
      id: departmentIdA,
      companyId,
      parentId: null,
      code: 'DEPT-A',
      name: '部門 A',
      description: null,
      status: DepartmentStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedSeq: 0,
    },
    {
      id: departmentIdB,
      companyId,
      parentId: null,
      code: 'DEPT-B',
      name: '部門 B',
      description: null,
      status: DepartmentStatus.Active,
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

  return { companyId, operatorCompanyUserId, employmentId: employmentResult.value.id, departmentIdA, departmentIdB }
}

describe('employments/department-histories 併發：§4.3 期間重疊的 FOR UPDATE 鎖（鎖的粒度＝任職）', () => {
  test('★ 兩個交易同時替同一筆任職建立重疊的部門歸屬：恰好一個成功、一個失敗', async () => {
    const { companyId, operatorCompanyUserId, employmentId, departmentIdA, departmentIdB } = await registerFixture()
    const context: DepartmentHistoriesContext = { db: database, clock, companyId, operatorCompanyUserId }

    // 兩筆生效日不同（避開 uq_employee_department_histories_employment_from），皆無結束日，
    // 因此兩段區間必然重疊——理由與任職併發測試相同，只是鎖的對象換成 employee_employments。
    const [outcomeA, outcomeB] = await Promise.all([
      createDepartmentHistory(context, {
        employmentId,
        departmentId: departmentIdA,
        effectiveFrom: '2024-01-01',
        effectiveTo: null,
      }),
      createDepartmentHistory(context, {
        employmentId,
        departmentId: departmentIdB,
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
      'employments.department-histories.errors.period-overlap',
    )

    const rows = await database
      .select({ id: employeeDepartmentHistories.id })
      .from(employeeDepartmentHistories)
      .where(eq(employeeDepartmentHistories.employmentId, employmentId))
    expect(rows.length).toBe(1)
  })
})
