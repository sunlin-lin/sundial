/**
 * ★ 併發測試：兩個交易同時對同一位員工建立重疊任職，必須恰好一個成功、一個失敗
 * （實作計畫 `plans/05-employee-onboarding.md` §4.3）。
 *
 * 這是這一塊唯一能證明「鎖的粒度＝員工」真的有效的東西——純邏輯測試只能驗證
 * `overlapsAnyPeriod` 這個純函式本身算得對不對，驗不出 `FOR UPDATE` 有沒有真的擋住第二個
 * 交易；`FOR UPDATE` 寫錯位置（鎖到空集合、鎖在交易外、鎖了但沒等）在純邏輯測試裡完全看不出來
 * ——兩個「並發」呼叫在同一個 process 內用假的 clock／假的 repository 跑，本來就不會真的競爭
 * 同一列。因此本測試對**真的 MariaDB** 開兩個連線（同一個 pool，`mysql2` 的
 * `waitForConnections: true` 保證併發呼叫各自拿到獨立連線），不 mock 任何一層。
 *
 * **不得 mock 掉 repository 或 `db.transaction`**（§7.3）：這幾條測試的全部價值就在於驗真的
 * 有鎖住。
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { companies, companyUsers, employeeEmployments, employees, users } from '../../../../db/schema/index.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { createEmployment } from '../employments-main.service.ts'
import type { EmploymentsMainContext } from '../domain/employment-context.ts'

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
 * 建立一家公司、一位操作者（`company_users`，供稽核的 `actor_company_user_id` 外鍵）與一位目標員工。
 *
 * §7.3 的例外：`companies`／`users`／`company_users`／`employees` 目前沒有從零開始的正式流程可以
 * 呼叫（`employees/main/create` 要求呼叫者已經登入且已經有權限碼），只能直接寫入——與
 * `company-users/roles` 稽核測試（`registerCompanyWithRoles`）、`sessions` 重用偵測測試
 * （`registerMember`）同一個理由、同一種處置。員工的加密欄位內容不影響本測試（只驗證存在性與
 * `FOR UPDATE` 序列化，不讀回個資明文），因此用隨機位元組即可，不需要真的加密。
 */
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
    username: `employments-concurrency-${userId}`,
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

describe('employments/main 併發：§4.3 期間重疊的 FOR UPDATE 鎖（鎖的粒度＝員工）', () => {
  test('★ 兩個交易同時替同一位員工建立重疊任職：恰好一個成功、一個失敗', async () => {
    const { companyId, operatorCompanyUserId, employeeId } = await registerCompanyWithEmployee()
    const context: EmploymentsMainContext = { db: database, clock, companyId, operatorCompanyUserId }

    // 兩筆任職的到職日不同（避開 `uq_employee_employments_employee_hire_date` 唯一鍵），
    // 但都沒有離職日——兩段「到職日～無窮未來」的區間必然重疊，因此只有靠 FOR UPDATE 鎖住
    // `employees` 那一列、序列化兩個交易，第二個交易才會在拿到鎖之後看到第一個已經寫入的紀錄，
    // 進而被 `overlapsAnyPeriod` 擋下。若鎖失效（例如鎖到空集合、鎖在交易外、或沒有真的
    // 等待），兩個交易會同時讀到「沒有重疊」，兩筆都會寫入成功——這正是本測試要抓的那個 bug。
    const [outcomeA, outcomeB] = await Promise.all([
      createEmployment(context, {
        employeeId,
        employmentTypeCode: 1,
        employmentNatureCode: null,
        hireDate: '2024-01-01',
      }),
      createEmployment(context, {
        employeeId,
        employmentTypeCode: 1,
        employmentNatureCode: null,
        hireDate: '2024-06-01',
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
    expect(failure.errors.map((error) => error.code)).toContain('employments.main.errors.period-overlap')

    // 額外從資料庫直接驗證：這位員工名下確實只有一筆未刪除任職，不是「service 說失敗，
    // 但兩筆其實都寫進去了」這種更糟的情況。
    const rows = await database
      .select({ id: employeeEmployments.id })
      .from(employeeEmployments)
      .where(eq(employeeEmployments.employeeId, employeeId))
    expect(rows.length).toBe(1)
  })
})
