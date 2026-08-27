/**
 * 開發用種子資料：一家公司、一個可登入的帳號、一個握有全部可指派權限的角色。
 *
 * **為什麼是腳本而不是 migration。** 測試資料不屬於 schema 演進的一部分，而 §4.1 規定
 * 已套用的 migration 禁止修改或刪除——一旦把 demo 帳號寫進 migration 鏈，它就永遠拔不掉，
 * 而且每一個新環境（含正式環境）建起來時都會自動長出一個密碼公開在版控裡的管理員帳號。
 * 腳本則是「想跑才跑」，且下方的守衛讓它在非開發資料庫上跑不起來。
 *
 * **可重複執行。** 每次執行都先把上一次種的資料整組刪掉再重種，因此第二次、第三次跑
 * 都不會撞唯一鍵；也因為刪的範圍就是這支腳本自己種的那家公司，不會波及手動建立的其他資料。
 *
 * 執行方式：`bun run seed:dev`（根目錄或 apps/api 皆可）。
 */
import { and, eq } from 'drizzle-orm'
import { createDatabase, TenantDatabase, type QueryRunner } from '../src/db/client.ts'
import {
  companies,
  CompanyLegalType,
  CompanyStatus,
  companyUserRoles,
  companyUsers,
  CompanyUserStatus,
  CompanyType,
  employees,
  permissions,
  PermissionStatus,
  refreshTokens,
  rolePermissions,
  roles,
  RoleStatus,
  users,
} from '../src/db/schema/index.ts'
import { hashPassword } from '../src/modules/sessions/main/domain/session-password.ts'
import { systemClock } from '../src/shared/clock.ts'

/**
 * 種下去的那組帳密。**刻意好記好打**：它唯一的用途是讓人在本機打開前端就能登進去，
 * 換成隨機字串的話，每個人都得先去翻 log 才知道要輸入什麼。
 *
 * 也正因為它是公開的弱密碼，下方的資料庫守衛不是保險，是必要條件。
 */
const DEMO = {
  companyCode: 'DEMO',
  companyName: '晷光示範股份有限公司',
  username: 'admin',
  password: 'admin1234',
  roleCode: 'SYSTEM-ADMIN',
  roleName: '系統管理員',
} as const

/**
 * 固定的識別碼，不用 `crypto.randomUUID()`。
 *
 * 理由是「重複執行」這件事：id 固定之後，重跑一次腳本前後，前端 localStorage 裡的資料、
 * 開發時手動記下來的 id、以及貼在 issue 上的重現步驟都還指得到同一筆資料。
 * 每次隨機的話，重種一次就等於所有既有的參照同時失效，而失效的症狀是「查無資料」，
 * 看起來像功能壞了。
 *
 * 版本位與變體位刻意符合 `shared/field-schemas.ts` 的 `Uuid` 格式（第 3 段開頭為 `4`、
 * 第 4 段開頭為 `8`）——回應 schema 會驗它，格式不合會讓登入以 500 失敗。
 */
const IDS = {
  company: '11111111-1111-4111-8111-111111111111',
  user: '22222222-2222-4222-8222-222222222222',
  companyUser: '33333333-3333-4333-8333-333333333333',
  role: '44444444-4444-4444-8444-444444444444',
  companyUserRole: '55555555-5555-4555-8555-555555555555',
} as const

/**
 * 守衛：這支腳本只准在開發資料庫上跑（比照 `test-setup.ts` §7.4 的作法）。
 *
 * 三項條件全部成立才放行，缺一即中止：
 *   1. `NODE_ENV` 必須是 `development`；
 *   2. `DB_NAME` 必須以 `_dev` 結尾；
 *   3. `DB_NAME` 不得等於 `TEST_DB_NAME`（測試資料庫由測試自己管，種進去會讓測試看到非預期的資料）。
 *
 * 為什麼不是只看 `NODE_ENV`：正式環境的部署腳本把 `NODE_ENV` 設錯（或忘了設）是真實會發生的事，
 * 而那一刻這支腳本會在正式資料庫裡建一個密碼是 `admin1234` 的全權限帳號。
 * 多檢查一次資料庫名稱，等於要求「兩個設定同時錯」才會出事。
 */
const assertDevelopmentDatabase = (): string => {
  const nodeEnv = process.env['NODE_ENV']
  const databaseName = process.env['DB_NAME']
  const testDatabaseName = process.env['TEST_DB_NAME']

  if (nodeEnv !== 'development') {
    throw new Error(`種子資料只能種進開發環境。期望 NODE_ENV=development，實際為 ${String(nodeEnv)}。`)
  }

  if (databaseName === undefined || databaseName === '') {
    throw new Error('DB_NAME 未設定：無法判斷這次連的是不是開發資料庫，中止。')
  }

  if (!databaseName.endsWith('_dev')) {
    throw new Error(`種子資料只能種進開發資料庫（名稱須以 _dev 結尾）。實際為 ${databaseName}。`)
  }

  if (databaseName === testDatabaseName) {
    throw new Error(`DB_NAME 與 TEST_DB_NAME 同為 ${databaseName}：那是測試資料庫，不種。`)
  }

  return databaseName
}

/**
 * 清掉上一次種的資料。
 *
 * 刪除順序是外鍵的相反方向：先刪指向別人的，最後才刪被指的。順序錯了不會靜默出錯，
 * 而是被 MariaDB 以外鍵違反擋下——但錯誤訊息只會說某個 constraint 失敗，
 * 看不出「應該先刪哪一張」，所以順序寫在這裡並附上理由。
 *
 * `employees` 這支腳本不種（登入不需要它），仍然一併清：手動測試時可能透過端點建了員工，
 * 而它有指向 `companies` 的外鍵，不清就刪不掉公司。
 */
const clearPreviousSeed = async (tenant: TenantDatabase, runner: QueryRunner): Promise<void> => {
  // 指派紀錄同時指向 company_users 與 roles，必須最先刪。
  await tenant.delete(companyUserRoles)
  // 角色與權限的關聯指向 roles。
  await tenant.delete(rolePermissions)
  // 換票紀錄指向 company_users；手動登入過就會有。
  await tenant.delete(refreshTokens)
  // 員工指向 companies；company_users.employee_id 也可能指向它。
  await tenant.delete(employees)
  await tenant.delete(companyUsers)
  await tenant.delete(roles)

  // companies 與 users 都不帶 `company_id`，不在 `TenantDatabase` 的適用範圍（§4.2），
  // 因此走裸 runner；兩者都以本腳本自己的固定 id／帳號為條件，刪不到別人的資料。
  await runner.delete(companies).where(eq(companies.id, IDS.company))
  await runner.delete(users).where(eq(users.id, IDS.user))
}

const main = async (): Promise<void> => {
  const databaseName = assertDevelopmentDatabase()

  const database = createDatabase({
    host: process.env['DB_HOST'] ?? '127.0.0.1',
    port: Number(process.env['DB_PORT'] ?? '3306'),
    user: process.env['DB_USER'] ?? '',
    password: process.env['DB_PASSWORD'] ?? '',
    database: databaseName,
  })

  const now = systemClock.now()
  const passwordHash = await hashPassword(DEMO.password)

  /**
   * 可指派的權限碼**用查的，不是手寫清單**。
   *
   * 手寫的話，日後任何一支新端點的權限碼加進 migration 之後，這裡不會有任何地方變紅，
   * 症狀是「管理員帳號對新功能一律 403」——而那看起來像新功能壞了，不像種子資料舊了。
   * 分類節點（`is_assignable = 0`）不授予：它們不對應端點，授了也授不出任何東西。
   */
  const assignablePermissions = await database
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(
        eq(permissions.isAssignable, true),
        eq(permissions.status, PermissionStatus.Active),
        eq(permissions.deletedSeq, 0),
      ),
    )

  if (assignablePermissions.length === 0) {
    throw new Error('permissions 表沒有任何可指派的權限碼：migration 可能還沒跑（bun run db:migrate）。')
  }

  await database.transaction(async (tx) => {
    const tenant = new TenantDatabase(tx, IDS.company)

    await clearPreviousSeed(tenant, tx)

    await tx.insert(companies).values({
      id: IDS.company,
      companyCode: DEMO.companyCode,
      companyType: CompanyType.Company,
      legalType: CompanyLegalType.CompanyLimitedByShares,
      taxId: null,
      name: DEMO.companyName,
      shortName: '晷光',
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
      // 登入時會比對 `status = ACTIVE`（見 resolve-identity repository），設別的值就登不進去。
      status: CompanyStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedSeq: 0,
    })

    await tx.insert(users).values({
      id: IDS.user,
      username: DEMO.username,
      passwordHash,
      // 設為否：這支帳號的用途是「打開前端就能進 dashboard」，
      // 要求改密碼會讓第一次登入停在改密碼流程，而那個流程目前還沒有前端頁面。
      mustChangePassword: false,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    })

    await tenant.insert(companyUsers, (companyId) => ({
      id: IDS.companyUser,
      companyId,
      userId: IDS.user,
      // 不綁員工：登入不需要它，而顯示名稱在沒有員工時會退回帳號（見 find-profile repository）。
      employeeId: null,
      status: CompanyUserStatus.Active,
      activatedAt: now,
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now,
    }))

    await tenant.insert(roles, (companyId) => ({
      id: IDS.role,
      companyId,
      code: DEMO.roleCode,
      name: DEMO.roleName,
      description: '開發用：持有全部可指派的權限碼',
      // 不標記為系統角色：系統角色在角色模組裡有「不可修改／刪除」的限制，
      // 而這支角色的存在意義之一，就是讓人在本機拿它去試那些修改與刪除的端點。
      isSystem: false,
      status: RoleStatus.Active,
      deletedAt: null,
      deletedSeq: 0,
      createdAt: now,
      updatedAt: now,
    }))

    // 一次寫入數十列，不在迴圈裡逐筆 insert（§4.5）。
    await tenant.insertMany(rolePermissions, (companyId) =>
      assignablePermissions.map((permission) => ({
        companyId,
        roleId: IDS.role,
        permissionId: permission.id,
        createdAt: now,
      })),
    )

    await tenant.insert(companyUserRoles, (companyId) => ({
      id: IDS.companyUserRole,
      companyId,
      companyUserId: IDS.companyUser,
      roleId: IDS.role,
      assignedAt: now,
      // 指派人指向自己：外鍵要求它必須是本公司的一個成員，而這時候公司裡只有這一個人。
      assignedBy: IDS.companyUser,
      revokedAt: null,
      revokedBy: null,
      revokedSeq: 0,
      createdAt: now,
      updatedAt: now,
    }))
  })

  // 種完把帳密印出來：使用者要的就是這三行，不該讓他回頭讀原始碼才知道要輸入什麼。
  // （§5.1 禁止 log 密碼——那條管的是**使用者的**密碼；這裡印的是本腳本剛剛寫死種下去的
  //   開發用固定值，它已經公開在這個檔案裡，不印也不會比較秘密。）
  process.stdout.write(
    [
      `種子資料已寫入 ${databaseName}`,
      `  公司代號：${DEMO.companyCode}（${DEMO.companyName}）`,
      `  帳號：${DEMO.username}`,
      `  密碼：${DEMO.password}`,
      `  角色：${DEMO.roleName}，已授予 ${assignablePermissions.length} 個可指派權限碼`,
      '',
    ].join('\n'),
  )
}

await main()

// 連線池會讓行程在種完之後繼續掛著（池內連線是 active handle），
// 明確結束才不會讓 `bun run seed:dev` 看起來像卡住。
process.exit(0)
