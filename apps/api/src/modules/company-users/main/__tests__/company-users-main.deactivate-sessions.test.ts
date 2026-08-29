/**
 * `deactivateCompanyUserAccount` 停用帳號時同步作廢 session 的整合測試(安全落差修補)。
 *
 * 修的落差:`company_users.status` 只在登入那一刻被檢查
 * (`sessions-main.resolve-identity.repository.ts`),access token 續期與 refresh 都不查這個
 * 欄位,停用一個帳號後,對方手上的 refresh 票原本還能繼續換出新的 access token。本檔要證明的是
 * 修好之後的真實行為:**用真正的 `login` 換出一張真正的 refresh 票,停用帳號之後,用同一張票
 * 呼叫真正的 `verifyRefreshTicket` 不會再拿到 `valid`**——這是換不到新 access token 的
 * 直接證據,比只看 `refresh_tokens` 的欄位更貼近使用者實際會撞到的行為。
 *
 * **不得 mock 掉 `recordAudit`／`revokeSessionsForDeactivation`／`login`／`verifyRefreshTicket`**
 * (§7.3):這幾條測試的價值就在於驗真的有作廢、真的換不到新票、失敗時真的會回滾。
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createDatabase, type Database } from '../../../../db/client.ts'
import {
  auditLogs,
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
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import {
  hashPassword,
  login,
  revokeSessionsForDeactivation,
  verifyAccessToken,
  verifyRefreshTicket,
  type SessionsMainContext,
} from '../../../sessions/index.ts'
import { markCompanyUserDeactivated } from '../company-users-main.repository.ts'
import { deactivateCompanyUserAccount } from '../company-users-main.service.ts'

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
  accessTokenSecret: 'deactivate-sessions-test-secret',
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
  const username = `deactivate-sessions-${employeeUserId}`
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode,
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `停用作廢測試公司-${companyId.slice(0, 8)}`,
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
      username: `deactivate-sessions-op-${operatorUserId}`,
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
    name: '停用作廢測試員工',
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

/**
 * 跑一個注定失敗的交易,回傳它拋出的錯誤(技巧與理由完整寫在
 * `sessions-main.revoke-on-reuse.test.ts` 的同名函式檔頭)。
 */
const runFailingTransaction = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('這個交易應該要失敗才對,實際上成功了')
}

describe('company-users/main 停用帳號同步作廢 session(安全落差修補)', () => {
  test('★ 停用帳號後,同一張 refresh 票再也換不到新的 access token', async () => {
    const { companyId, companyCode, username, operatorCompanyUserId, employeeId, employeeCompanyUserId } =
      await registerFixture()

    const loggedIn = await login(sessionsContext(), { companyCode, username, password: PASSWORD })
    if (!loggedIn.ok) throw new Error('登入失敗,測試前置條件不成立')
    const { refreshTicket, accessToken } = loggedIn.value.tokens

    // 停用前:這張票本來就是有效的(用同一把清單反查資料庫,不消耗票本身——
    // `verifyRefreshTicket` 是一次性消耗,呼叫它會把這張票輪替掉,污染下面真正要驗的那一次)。
    const [beforeToken] = await database
      .select({ activeSessionId: refreshTokens.activeSessionId, revokedAt: refreshTokens.revokedAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.companyUserId, employeeCompanyUserId))
    expect(beforeToken?.activeSessionId).not.toBeNull()
    expect(beforeToken?.revokedAt).toBeNull()
    // access token 停用前也是有效的(順手驗證一次,證明下面「停用後失效」不是自始無效的假陽性)。
    expect(await verifyAccessToken(sessionsContext(), accessToken)).not.toBeNull()

    const deactivated = await deactivateCompanyUserAccount(
      database,
      companyId,
      operatorCompanyUserId,
      { employeeId },
      clock.now(),
    )
    expect(deactivated.ok).toBe(true)

    // 核心斷言之一:拿停用前發出的那張真正的 refresh 票去驗,不會再拿到 `valid`
    // ——`refreshSession`／HTTP 的 refresh 端點因此不會再對它發出新的 access token。
    const verification = await verifyRefreshTicket(sessionsContext(), refreshTicket)
    expect(verification.outcome).not.toBe('valid')
    // 精確結果是 `reuse-detected`(已作廢的票被再次使用的判定分支)——見
    // `sessions-main.verify-ticket.service.ts` 的 `stored.revokedAt !== null` 分支。
    expect(verification.outcome).toBe('reuse-detected')

    // 核心斷言之二,也是回報裡要說明的「access token 殘留視窗」的答案:
    // `touchAccessSession`(§5.4.6 即時撤銷的執行點)查的正是 `refresh_tokens.active_session_id`
    // 這一欄——而 `revokeSessionsForDeactivation` 清的正是同一欄。因此停用之後,拿停用前發出的
    // access token 打下一個請求,**立刻**就會被拒絕,不必等到 access token 自然過期
    // (本環境設定是 2 小時,`ACCESS_TOKEN_TTL_SECONDS=7200`)——殘留視窗與「登出」完全同等級,
    // 只剩「與撤銷真正同時發生的那一個請求」這個任何設計都無法消除的空窗
    //(見 `sessions-main.touch-session.repository.ts` 檔頭)。
    expect(await verifyAccessToken(sessionsContext(), accessToken)).toBeNull()

    // 資料庫層面的直接證據:這張票被標成已作廢,原因是「帳號被停用」,不是輪替或登出。
    const [afterToken] = await database
      .select({ activeSessionId: refreshTokens.activeSessionId, revokedReason: refreshTokens.revokedReason })
      .from(refreshTokens)
      .where(eq(refreshTokens.companyUserId, employeeCompanyUserId))
    expect(afterToken?.activeSessionId).toBeNull()
    expect(afterToken?.revokedReason).toBe(RefreshTokenRevokeReason.AccountDeactivated)

    // 稽核:只有一筆(停用本身那一筆),`revokedTokenIds` 併在同一筆裡,不是獨立事件。
    const logs = await database
      .select({ action: auditLogs.action, changes: auditLogs.changes })
      .from(auditLogs)
      .where(eq(auditLogs.companyId, companyId))
      .then((rows) => rows.filter((row) => row.action === 'company-users.main.deactivate'))
    expect(logs).toHaveLength(1)
    // `changes` 讀回來可能是字串(MariaDB 的 JSON 實際上是 LONGTEXT),也可能已被驅動解析
    // (見 `sessions-main.revoke-on-reuse.test.ts` 的 `parseChanges`)。
    const rawChanges = logs[0]?.changes
    const changes = (typeof rawChanges === 'string' ? JSON.parse(rawChanges) : rawChanges) as readonly {
      field: string
      after: unknown
    }[]
    const revokedTokenIdsChange = changes.find((change) => change.field === 'revokedTokenIds')
    expect(revokedTokenIdsChange).toBeDefined()
    const recordedIds = JSON.parse(revokedTokenIdsChange?.after as string) as string[]
    expect(recordedIds).toHaveLength(1)
  })

  test('★ 故意讓稽核失敗:停用與作廢也在同一個交易內回滾', async () => {
    const { companyId, companyCode, username, operatorCompanyUserId, employeeCompanyUserId } = await registerFixture()

    const loggedIn = await login(sessionsContext(), { companyCode, username, password: PASSWORD })
    if (!loggedIn.ok) throw new Error('登入失敗,測試前置條件不成立')
    const now = clock.now()

    // 手動照 `deactivateCompanyUserAccountInTransaction` 完全相同的順序重組一次(真的停用 →
    // 真的作廢 session → 真的呼叫 recordAudit),用一個稽核政策一定會擋下的未分類欄位觸發
    // 「稽核失敗」,藉此驗證「停用、作廢、稽核包在同一個交易」這個結構性保證。技巧與理由完整寫在
    // `sessions-main.revoke-on-reuse.test.ts` 的同名測試檔頭——這裡不是重寫作廢或停用的邏輯,
    // 用的是真正的 `markCompanyUserDeactivated`／`revokeSessionsForDeactivation`／
    // `buildAuditChanges`／`recordAudit`,沒有任何一段被 mock(§7.3)。
    const thrown = await runFailingTransaction(() =>
      database.transaction(async (tx) => {
        const affectedRows = await markCompanyUserDeactivated(tx, companyId, employeeCompanyUserId, now)
        expect(affectedRows).toBe(1)

        const revokedTokenIds = await revokeSessionsForDeactivation(tx, companyId, employeeCompanyUserId, now)
        expect(revokedTokenIds).toHaveLength(1)

        await recordAudit(tx, {
          companyId,
          actor: { type: 'company-user', companyUserId: operatorCompanyUserId },
          action: 'company-users.main.deactivate',
          subjectTable: 'company_users',
          subjectId: employeeCompanyUserId,
          changes: buildAuditChanges(
            'company_users',
            { status: 'ACTIVE' },
            {
              status: 'INACTIVE',
              revokedTokenIds: JSON.stringify(revokedTokenIds),
              // 政策未分類的欄位:`buildAuditChanges` 對它會拋例外,這裡刻意送進去觸發「稽核失敗」。
              bogusField: 'x',
            },
          ),
          effectiveDate: null,
          now,
        })
      }),
    )

    expect(String(thrown)).toContain('bogusField')

    // 停用回滾了:帳號仍然是 ACTIVE,不是「作廢成功但帳號其實還啟用」的半套結果,
    // 也不是「帳號停用了但作廢沒生效」——兩者都不該發生,這裡驗證的是後者。
    const [companyUserRow] = await database
      .select({ status: companyUsers.status })
      .from(companyUsers)
      .where(eq(companyUsers.id, employeeCompanyUserId))
    expect(companyUserRow?.status).toBe(CompanyUserStatus.Active)

    // 作廢也回滾了:refresh 票仍然是活著的狀態。
    const [tokenRow] = await database
      .select({ activeSessionId: refreshTokens.activeSessionId, revokedAt: refreshTokens.revokedAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.companyUserId, employeeCompanyUserId))
    expect(tokenRow?.activeSessionId).not.toBeNull()
    expect(tokenRow?.revokedAt).toBeNull()

    // 稽核也沒有留下任何紀錄。
    const logs = await database
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.companyId, companyId))
    expect(logs).toHaveLength(0)
  })
})
