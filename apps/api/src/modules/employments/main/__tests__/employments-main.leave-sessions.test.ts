/**
 * 離職流程同步作廢 session 的整合測試(安全落差修補)。
 *
 * 離職會呼叫 `company-users` 模組的 `deactivateCompanyUser`(見
 * `impl/employments-main.leave.service.ts`),而那支動作現在會在同一筆交易內順便作廢該員工
 * 所有的 refresh token 鏈(完整理由見 `company-users-main.deactivate.service.ts` 檔頭)。
 * 本檔要證明的是離職這條路徑上使用者實際會撞到的行為:**用真正的 `login` 換出一張真正的
 * refresh 票,辦理離職之後,用同一張票呼叫真正的 `verifyRefreshTicket` 不會再拿到 `valid`**
 * ——不是只看 `refresh_tokens` 的欄位,而是走一次真正的驗證路徑。
 *
 * **不得 mock 掉任何一段**(§7.3):`recordAudit`／`deactivateCompanyUser`／`login`／
 * `verifyRefreshTicket` 全部是真的。
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createDatabase, type Database } from '../../../../db/client.ts'
import {
  companies,
  CompanyUserStatus,
  companyUsers,
  employees,
  refreshTokens,
  RefreshTokenRevokeReason,
  users,
} from '../../../../db/schema/index.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import type { SessionConfig } from '../../../../shared/config.ts'
import {
  hashPassword,
  login,
  type SessionsMainContext,
  verifyAccessToken,
  verifyRefreshTicket,
} from '../../../sessions/index.ts'
import type { EmploymentsMainContext } from '../domain/employment-context.ts'
import { createEmployment, leaveEmployment } from '../employments-main.service.ts'

const readTestDatabaseConfig = () => ({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

/** 釘住「現在」(§6.2)。台北時間 2026-08-27 12:00:00。 */
const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))

/** 測試專用的簽章金鑰與壽命,刻意不讀 `.env`(理由與 `sessions-main.endpoints.test.ts` 相同)。 */
const sessionConfig: SessionConfig = {
  accessTokenSecret: 'leave-sessions-test-secret',
  accessTokenTtlSeconds: 7200,
  refreshTokenTtlDays: 30,
}

const PASSWORD = 'correct horse battery staple'

let database: Database

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
})

/** 建立一家公司、一位操作者,以及一位有真實密碼可以登入的員工帳號。 */
const registerFixture = async (): Promise<{
  companyId: string
  companyCode: string
  username: string
  operatorCompanyUserId: string
  employeeId: string
  employeeCompanyUserId: string
}> => {
  const companyId = crypto.randomUUID()
  const companyCode = companyId.replaceAll('-', '').slice(0, 20)
  const operatorUserId = crypto.randomUUID()
  const operatorCompanyUserId = crypto.randomUUID()
  const employeeId = crypto.randomUUID()
  const employeeUserId = crypto.randomUUID()
  const employeeCompanyUserId = crypto.randomUUID()
  const username = `leave-sessions-${employeeUserId}`
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode,
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `離職作廢測試公司-${companyId.slice(0, 8)}`,
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
  await database.insert(users).values([
    {
      id: operatorUserId,
      username: `leave-sessions-operator-${operatorUserId}`,
      passwordHash: 'not-a-real-hash',
      mustChangePassword: false,
      passwordChangedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: employeeUserId,
      username,
      passwordHash: await hashPassword(PASSWORD),
      mustChangePassword: false,
      passwordChangedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await database.insert(employees).values({
    id: employeeId,
    companyId,
    employeeCode: `E${employeeId.slice(0, 8)}`,
    name: '離職作廢測試員工',
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
  await database.insert(companyUsers).values([
    {
      id: operatorCompanyUserId,
      companyId,
      userId: operatorUserId,
      employeeId: null,
      status: CompanyUserStatus.Active,
      activatedAt: now,
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: employeeCompanyUserId,
      companyId,
      userId: employeeUserId,
      employeeId,
      status: CompanyUserStatus.Active,
      activatedAt: now,
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ])

  return { companyId, companyCode, username, operatorCompanyUserId, employeeId, employeeCompanyUserId }
}

/** 只能在 `beforeAll` 指派 `database` 之後才呼叫——寫成函式,不寫成模組層級常數,理由見它的呼叫點。 */
const sessionsContext = (): SessionsMainContext => ({ db: database, clock, session: sessionConfig })

describe('employments/main 離職同步作廢 session(安全落差修補)', () => {
  test('★ 辦理離職後,同一張 refresh 票再也換不到新的 access token', async () => {
    const { companyId, companyCode, username, operatorCompanyUserId, employeeId, employeeCompanyUserId } =
      await registerFixture()
    const context: EmploymentsMainContext = { db: database, clock, companyId, operatorCompanyUserId }

    const created = await createEmployment(context, {
      employeeId,
      employmentTypeCode: 1,
      employmentNatureCode: null,
      hireDate: '2024-01-01',
    })
    if (!created.ok) throw new Error('建立任職失敗,測試前置條件不成立')

    const loggedIn = await login(sessionsContext(), { companyCode, username, password: PASSWORD })
    if (!loggedIn.ok) throw new Error('登入失敗,測試前置條件不成立')
    const { refreshTicket, accessToken } = loggedIn.value.tokens

    // 停用前:這張票是有效的。不呼叫 `verifyRefreshTicket` 做這個檢查——它是一次性消耗,
    // 呼叫一次就會把這張票輪替掉,污染下面真正要驗的那一次。改用資料庫直接確認。
    const [beforeToken] = await database
      .select({ activeSessionId: refreshTokens.activeSessionId, revokedAt: refreshTokens.revokedAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.companyUserId, employeeCompanyUserId))
    expect(beforeToken?.activeSessionId).not.toBeNull()
    expect(beforeToken?.revokedAt).toBeNull()
    expect(await verifyAccessToken(sessionsContext(), accessToken)).not.toBeNull()

    const left = await leaveEmployment(context, {
      id: created.value.id,
      leaveDate: '2024-12-31',
      lastWorkingDate: '2024-12-30',
      leaveReasonCode: 1,
    })
    if (!left.ok) throw new Error('辦理離職失敗,測試前置條件不成立')

    // 核心斷言之一:拿離職前發出的那張真正的 refresh 票去驗,不會再拿到 `valid`
    // ——`refreshSession`／HTTP 的 refresh 端點因此不會再對它發出新的 access token。
    const verification = await verifyRefreshTicket(sessionsContext(), refreshTicket)
    expect(verification.outcome).not.toBe('valid')
    expect(verification.outcome).toBe('reuse-detected')

    // 核心斷言之二:離職前發出的 access token 也立刻失效,不必等到自然過期
    // ——理由與 `company-users-main.deactivate-sessions.test.ts` 的同一段斷言相同:
    // `touchAccessSession` 查的正是 `revokeSessionsForDeactivation` 清掉的那一欄。
    expect(await verifyAccessToken(sessionsContext(), accessToken)).toBeNull()

    // 資料庫層面的直接證據。
    const [afterToken] = await database
      .select({ activeSessionId: refreshTokens.activeSessionId, revokedReason: refreshTokens.revokedReason })
      .from(refreshTokens)
      .where(eq(refreshTokens.companyUserId, employeeCompanyUserId))
    expect(afterToken?.activeSessionId).toBeNull()
    expect(afterToken?.revokedReason).toBe(RefreshTokenRevokeReason.AccountDeactivated)
  })
})
