/**
 * ★ 併發測試：兩個交易同時對同一位員工建立重疊的扣繳設定，必須恰好一個成功、一個失敗
 * （實作計畫 `plans/05-employee-onboarding.md` §4.3）。鎖的粒度＝員工，理由與 `employments/main/
 * __tests__/employments-main.concurrency.test.ts` 檔頭相同，不重述。
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { companies, companyUsers, employees, employeeWithholdingSettings, users } from '../../../../db/schema/index.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { createWithholdingSetting } from '../withholding-main.service.ts'
import type { WithholdingMainContext } from '../domain/withholding-context.ts'

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

/** §7.3 的例外理由與 `employments-main.concurrency.test.ts` 的同名函式相同。 */
const registerCompanyWithEmployee = async (): Promise<{
  companyId: string
  operatorCompanyUserId: string
  employeeId: string
}> => {
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
    username: `withholding-concurrency-${userId}`,
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

  return { companyId, operatorCompanyUserId, employeeId }
}

describe('withholding/main 併發：§4.3 期間重疊的 FOR UPDATE 鎖（鎖的粒度＝員工）', () => {
  test('★ 兩個交易同時替同一位員工建立重疊的扣繳設定：恰好一個成功、一個失敗', async () => {
    const { companyId, operatorCompanyUserId, employeeId } = await registerCompanyWithEmployee()
    const context: WithholdingMainContext = { db: database, clock, companyId, operatorCompanyUserId }

    const [outcomeA, outcomeB] = await Promise.all([
      createWithholdingSetting(context, {
        employeeId,
        withholdingMethodCode: 1,
        effectiveFrom: '2024-01-01',
        effectiveTo: null,
      }),
      createWithholdingSetting(context, {
        employeeId,
        withholdingMethodCode: 2,
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
    expect(failure.errors.map((error) => error.code)).toContain('withholding.main.errors.period-overlap')

    const rows = await database
      .select({ id: employeeWithholdingSettings.id })
      .from(employeeWithholdingSettings)
      .where(eq(employeeWithholdingSettings.employeeId, employeeId))
    expect(rows.length).toBe(1)
  })
})
