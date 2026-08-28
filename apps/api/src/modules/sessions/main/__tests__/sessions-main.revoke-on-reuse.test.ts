/**
 * `revokeChainsOnReuse` 的稽核整合測試（稽核計畫 §7 Stage 2 三筆欠帳之一，§6.2 要求的整合測試）。
 *
 * **直接呼叫模組入口（`sessions-main.service.ts`），不透過 HTTP**：本檔要驗的是「作廢與稽核在
 * 同一交易」與「稽核紀錄的內容」，這兩件事在 service 層就回答得完整；偷用偵測本身的 HTTP
 * 端到端行為（舊票被拒、新票一併失效、access token 即時撤銷）已經有
 * `sessions-main.endpoints.test.ts` 在守，這裡不重複那件事。
 *
 * **不得 mock 掉 `recordAudit`／`revokeMemberChains`**（§7.3）：這幾條測試的全部價值就在於驗
 * 真的有寫進去、真的有作廢。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { createDatabase, type Database } from '../../../../db/client.ts'
import {
  AuditActorType,
  auditLogs,
  companies,
  companyUsers,
  refreshTokens,
  RefreshTokenRevokeReason,
  users,
} from '../../../../db/schema/index.ts'
import type { VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import type { SessionConfig } from '../../../../shared/config.ts'
import type { SessionsMainContext } from '../domain/session-context.ts'
import { revokeChainsOnReuse } from '../sessions-main.service.ts'
import { revokeMemberChains } from '../sessions-main.repository.ts'

const readTestDatabaseConfig = () => ({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

/** 釘住「現在」（§6.2）。台北時間 2026-08-27 12:00:00。 */
const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))

/** 本檔不透過憑證驗證器產生 session config，這裡的值只用來滿足型別，`revokeChainsOnReuse` 不讀它。 */
const sessionConfig: SessionConfig = {
  accessTokenSecret: 'revoke-on-reuse-test-secret',
  accessTokenTtlSeconds: 7200,
  refreshTokenTtlDays: 30,
}

let database: Database

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
})

/** 建立一家公司與一位成員，供外鍵指向（§7.3 的例外：`companies`／`users`／`company_users` 目前沒有正式流程）。 */
const registerMember = async (): Promise<{ companyId: string; userId: string; companyUserId: string }> => {
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
    name: `測試公司-${companyId.slice(0, 8)}`,
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
    username: `revoke-on-reuse-${userId}`,
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

  return { companyId, userId, companyUserId }
}

/**
 * 插入一張目前仍有效（`activeSessionId` 非 NULL）的 refresh token，回傳它的 id。
 *
 * `tokenHash` 必須逐張不同：`uq_refresh_tokens_company_token` 是 `(company_id, token_hash)`
 * 的唯一鍵，同一家公司內兩張票的雜湊相同會直接撞鍵——這裡不是真的加密，只是塞一個測試用的
 * 假雜湊，因此用 `crypto.randomUUID()` 保證每張票都不一樣即可。
 */
const insertActiveToken = async (companyId: string, userId: string, companyUserId: string): Promise<string> => {
  const id = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const now = clock.now()

  await database.insert(refreshTokens).values({
    id,
    companyId,
    sessionId,
    userId,
    companyUserId,
    tokenHash: Buffer.from(crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'), 'hex'),
    issuedAt: now,
    expiresAt: '2026-09-26 12:00:00',
    accessExpiresAt: '2026-08-27 14:00:00',
    activeSessionId: sessionId,
    revokedAt: null,
    revokedReason: null,
    createdAt: now,
    updatedAt: now,
  })

  return id
}

/** 顯式列出欄位而不是 `select()` 全撈（§2）。 */
const readAuditLogs = (companyId: string) =>
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
    .where(eq(auditLogs.companyId, companyId))

/** `changes` 讀回來可能是字串（MariaDB 的 JSON 實際上是 LONGTEXT），也可能已被驅動解析（見 audit-main.record.test.ts）。 */
const parseChanges = (raw: unknown): unknown => (typeof raw === 'string' ? JSON.parse(raw) : raw)

/**
 * 跑一個注定失敗的交易，回傳它拋出的錯誤（技巧與理由完整寫在 `audit-main.record.test.ts` 的
 * 同名函式檔頭：bun 1.3.5 上 `.rejects` 對「交易內做過寫入、之後才拋例外」的 promise 會卡住）。
 */
const runFailingTransaction = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('這個交易應該要失敗才對，實際上成功了')
}

describe('revokeChainsOnReuse：作廢與稽核（稽核計畫 §7 Stage 2）', () => {
  test('偷用偵測：該成員所有活躍的 token 都被作廢，且恰好新增一筆稽核', async () => {
    const { companyId, userId, companyUserId } = await registerMember()
    // 兩張活躍票，模擬同一位成員同時在兩台裝置登入——作廢範圍是「這個成員」，不是單一 token。
    const tokenId1 = await insertActiveToken(companyId, userId, companyUserId)
    const tokenId2 = await insertActiveToken(companyId, userId, companyUserId)
    // 觸發這次偵測的那張票：模擬「重用的是上一張票」——不在目前的活躍清單裡
    //（它已經被輪替掉了），用獨立的 UUID 代表它。
    const reusedTicketId = crypto.randomUUID()

    const context: SessionsMainContext = { db: database, clock, session: sessionConfig }
    const identity: VerifiedIdentity = { sessionId: crypto.randomUUID(), userId, companyId, companyUserId }

    const outcome = await revokeChainsOnReuse(context, identity, reusedTicketId)
    expect(outcome.revokedCount).toBe(2)

    const tokens = await database
      .select({
        id: refreshTokens.id,
        activeSessionId: refreshTokens.activeSessionId,
        revokedReason: refreshTokens.revokedReason,
      })
      .from(refreshTokens)
      .where(eq(refreshTokens.companyUserId, companyUserId))
    expect(tokens).toHaveLength(2)
    for (const token of tokens) {
      expect(token.activeSessionId).toBeNull()
      expect(token.revokedReason).toBe(RefreshTokenRevokeReason.ReuseDetected)
    }

    const rows = await readAuditLogs(companyId)
    expect(rows).toHaveLength(1)

    const row = rows[0]
    // 主體是成員（`company_users`），不是 token；操作者是系統，沒有人可以負責（稽核計畫已定案）。
    expect(row?.actorTypeCode).toBe(AuditActorType.System)
    expect(row?.actorCompanyUserId).toBeNull()
    expect(row?.action).toBe('sessions.main.refresh-token-reuse')
    expect(row?.subjectTable).toBe('company_users')
    expect(row?.subjectId).toBe(companyUserId)

    const changes = parseChanges(row?.changes) as readonly { field: string; before: unknown; after: unknown }[]
    expect(changes).toHaveLength(2)

    const revokedTokenIdsChange = changes.find((change) => change.field === 'revokedTokenIds')
    expect(revokedTokenIdsChange?.before).toBeNull()
    // 實際作廢的 token id 放進 changes：不排序比對，避免把查詢當下的回傳順序當成業務意義。
    const recordedIds = JSON.parse(revokedTokenIdsChange?.after as string) as string[]
    expect([...recordedIds].sort()).toEqual([tokenId1, tokenId2].sort())

    const reusedTokenIdChange = changes.find((change) => change.field === 'reusedTokenId')
    expect(reusedTokenIdChange?.before).toBeNull()
    expect(reusedTokenIdChange?.after).toBe(reusedTicketId)
  })

  test('reusedTokenId 與 revokedTokenIds 不是同一個東西：重用的是舊票，作廢的是目前的活躍票', async () => {
    const { companyId, userId, companyUserId } = await registerMember()
    // 成員身上還有兩張活躍票（例如兩台裝置）；被重用的是一張早已被輪替掉、不在這份清單裡的舊票
    // ——這正是「重用的是三次輪替之前的票」那種真正的資安情境，而不是「重用上一張票」那種
    // 網路重送的良性情境。兩種情境的作廢清單長得一模一樣（都是「這個成員目前所有活躍票」），
    // 唯一分得出兩者的欄位就是 reusedTokenId：若它與 revokedTokenIds 永遠相同，
    // 這一欄就沒有存在價值——這裡直接證明它不是。
    const tokenId1 = await insertActiveToken(companyId, userId, companyUserId)
    const tokenId2 = await insertActiveToken(companyId, userId, companyUserId)
    const reusedTicketId = crypto.randomUUID()

    const context: SessionsMainContext = { db: database, clock, session: sessionConfig }
    const identity: VerifiedIdentity = { sessionId: crypto.randomUUID(), userId, companyId, companyUserId }

    const outcome = await revokeChainsOnReuse(context, identity, reusedTicketId)
    expect(outcome.revokedCount).toBe(2)

    const rows = await readAuditLogs(companyId)
    const changes = parseChanges(rows[0]?.changes) as readonly { field: string; before: unknown; after: unknown }[]

    const revokedTokenIdsChange = changes.find((change) => change.field === 'revokedTokenIds')
    const reusedTokenIdChange = changes.find((change) => change.field === 'reusedTokenId')
    const recordedRevokedIds = JSON.parse(revokedTokenIdsChange?.after as string) as string[]

    expect([...recordedRevokedIds].sort()).toEqual([tokenId1, tokenId2].sort())
    expect(reusedTokenIdChange?.after).toBe(reusedTicketId)
    // 關鍵斷言：被重用的票不在作廢清單裡，兩欄的值明顯不同。
    expect(recordedRevokedIds).not.toContain(reusedTicketId)
    expect(reusedTokenIdChange?.after).not.toBe(revokedTokenIdsChange?.after)
  })

  test('★ 故意讓稽核失敗：作廢也在同一個交易內回滾', async () => {
    const { companyId, userId, companyUserId } = await registerMember()
    const tokenId = await insertActiveToken(companyId, userId, companyUserId)
    const now = clock.now()

    // 這裡不透過 `revokeChainsOnReuse` 的公開簽章，而是照它內部完全相同的順序（真的作廢 →
    // 真的呼叫 recordAudit）手動組一次：`revokeChainsOnReuse` 的作廢與稽核共用同一組
    // `companyId`／`companyUserId`，在合法輸入下兩者永遠同時成立或同時不成立，因此無法從
    // 公開介面單獨造出「作廢成功、稽核失敗」的真實案例。改用一個稽核本來就會擋下的政策違規
    // （未分類欄位，稽核計畫 §4.3）當作稽核那一步失敗的觸發點，藉此驗證「作廢與稽核包在同一
    // 交易」這個結構性保證——用的是真正的 `revokeMemberChains`／`buildAuditChanges`／
    // `recordAudit`，沒有任何一段被 mock（§7.3）。這個取捨已寫進交付回報。
    //
    // 這支測試驗不到的那一半——`revokeChainsOnReuse` 本體（不是這裡手工重組的複本）
    // 有沒有真的把 `recordAudit` 包進 `context.db.transaction(...)` 的回呼裡——由
    // `bun run check:audit-transaction` 靜態擋住：它會找每一處 `recordAudit(` 呼叫，
    // 沿 AST 往上確認第一個引數就是包住它的交易回呼參數，`context.db`／`db` 這種繞過交易
    // 的寫法在那支腳本會直接紅燈，不必等到這裡的整合測試造出真實案例才發現。
    const thrown = await runFailingTransaction(() =>
      database.transaction(async (tx) => {
        const revokedTokenIds = await revokeMemberChains(tx, companyId, companyUserId, {
          at: now,
          reason: RefreshTokenRevokeReason.ReuseDetected,
        })
        expect(revokedTokenIds).toEqual([tokenId])

        await recordAudit(tx, {
          companyId,
          actor: { type: 'system' },
          action: 'sessions.main.refresh-token-reuse',
          subjectTable: 'company_users',
          subjectId: companyUserId,
          changes: buildAuditChanges('company_users', null, {
            revokedTokenIds: JSON.stringify(revokedTokenIds),
            // 政策未分類的欄位：`buildAuditChanges` 對它會拋例外（稽核計畫 §4.3），
            // 這裡刻意送進去以觸發「稽核失敗」。
            bogusField: 'x',
          }),
          effectiveDate: null,
          now,
        })
      }),
    )

    expect(String(thrown)).toContain('bogusField')

    // 作廢也跟著回滾：token 仍然是活著的狀態，不是「稽核沒寫但作廢已經生效」的半套結果。
    const [token] = await database
      .select({ activeSessionId: refreshTokens.activeSessionId, revokedAt: refreshTokens.revokedAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.id, tokenId))
    expect(token?.activeSessionId).not.toBeNull()
    expect(token?.revokedAt).toBeNull()

    // 稽核也沒有留下任何紀錄——不是「查得到一半」，是完全沒有。
    expect(await readAuditLogs(companyId)).toHaveLength(0)
  })
})
