/**
 * 資料庫連線與**公司範圍封裝**（§4.2）。
 *
 * MariaDB 沒有 Row Level Security，多公司隔離只能由應用層保證，而「每次查詢都要記得帶
 * `company_id`」是靠記憶力的規則——漏掉一次的後果是 A 公司的主管在列表裡看到 B 公司員工的
 * 薪資與身分證，且因為查詢**有回資料**，沒有任何錯誤會被觸發，通常是客戶先發現。
 *
 * 因此這裡的作法不是「提醒大家記得帶」，而是讓**不帶公司條件寫不出來**：
 * 對帶 `company_id` 的表做查詢只有一條路——`TenantDatabase`，而它的每個方法都先組好公司條件。
 */
import { and, eq, type SQL } from 'drizzle-orm'
import type { MySqlInsertValue, MySqlUpdateSetSource } from 'drizzle-orm/mysql-core'
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import { createPool } from 'mysql2/promise'
import type { DatabaseConfig } from '../shared/config.ts'
import type { CompanyScopedTable } from './schema/index.ts'

/**
 * 連線型別。
 *
 * **刻意不把 schema 傳給 `drizzle()`**：傳了才會有 `db.query.*` 這套 relational query API，
 * 而 §4.6 禁止使用它（它需要另外維護一份關聯宣告，那是 schema 之外的第二份真相；
 * 且產生的巢狀 JSON 聚合要另外把 SQL 印出來才知道長什麼樣，review 時等於不可讀）。
 * 不傳 schema，這條規則就從「掃描腳本要抓」變成「根本不存在這個 API」。
 */
export type Database = MySql2Database

/**
 * 資料存取的執行器：`TenantDatabase` 需要的那一組方法。
 *
 * 連線池與交易物件**都**滿足它，因此同一段 repository 程式碼在交易內外是同一個用法
 * ——repository 不自開交易，交易邊界屬於 service（§4.4）。
 *
 * **必須 export，而且各切片必須引用它、不得各自寫一份 `Pick<Database, …>`。**
 * 原本它沒有 export，於是每個 repository 切片依「自己這一支用到什麼」各自宣告了一份更窄的
 * `Pick`（`Pick<Database, 'select'>`、`Pick<Database, 'update'>`…）。那個窄化看起來是好事，
 * 實際上買不到任何安全：切片本來就只能碰它自己 import 的那幾張表，少一個 `insert` 方法
 * 並不會讓它變得更難寫壞。但它的代價是具體的——`TenantDatabase` 要的是完整的一組，
 * 於是**每個窄化過的切片都無法把 runner 交給 §4.2 的封裝**，只能退回裸 runner 自己在
 * `WHERE` 裡手寫 `companyId`，而那正是這個封裝要堵的破口。
 * 一句話：窄化擋的是「呼叫得到某個方法」，封裝擋的是「查詢漏掉公司條件」，後者才是會出事的那個。
 */
export type QueryRunner = Pick<Database, 'select' | 'selectDistinct' | 'insert' | 'update' | 'delete'>

/**
 * `Database['transaction']` 回呼收到的那個交易物件的型別。用 `Parameters` 反推而不是直接引用
 * drizzle 內部型別名稱：drizzle 的交易型別掛著一長串泛型參數（查詢結果、prepared query HKT、
 * schema…），版本升級時那些泛型參數的名字或數量都可能改變，反推法只依賴 `transaction` 這個
 * 公開方法的簽章，drizzle 版本內部怎麼變都不影響這裡。
 */
type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * 資料存取的執行器：**跨模組編排的參與者用**——與 {@link QueryRunner} 分工不同，這裡要證明的
 * 不是「呼叫得到某個方法」，而是「呼叫端手上這個東西真的是一個交易」。
 *
 * ## 為什麼需要一個比 `QueryRunner` 更窄的型別
 *
 * `recordAudit` 原本收 `QueryRunner`，而 `QueryRunner` 刻意讓連線池與交易物件滿足同一個型別
 * （見上方 {@link QueryRunner} 的檔頭，那個設計對 repository 仍然成立、不受這裡影響）。代價是
 * `recordAudit(context.db, ...)`（裸連線池，稽核與業務寫入各自另開連線）與 `recordAudit(tx, ...)`
 * （交易內）在編譯器眼裡完全等價——「稽核必須與業務寫入同一交易」這條規則因此只能靠
 * `apps/api/scripts/check-audit-transaction.ts` 讀 AST 的詞法巢狀去擋，而詞法巢狀擋不住
 * 合法的重構：一旦某個 service 動作改成收外部交易 handle 作為第一個參數（`docs/plans/
 * 05-employee-onboarding.md` §4.1），它自己的檔案裡就看不到 `.transaction(`，那支腳本會誤判
 * 為「稽核沒有包在交易裡」而擋下一次完全正確的呼叫。
 *
 * `TransactionRunner` 把這件事還給編譯器：`Pick<DbTransaction, 'rollback'>` 只有交易物件才有
 * （連線池呼叫 `rollback()` 沒有意義，drizzle 也確實沒有把它放在連線池的型別上），因此
 * `recordAudit` 的簽章改收 `TransactionRunner` 之後，`recordAudit(context.db, ...)`
 * 是**編譯錯誤**，不必再靠腳本讀語法樹去發現。腳本仍然留著，但職責改變了——見
 * `check-audit-transaction.ts` 檔頭「型別接手之後，這支腳本還剩下什麼」那一段。
 *
 * ## 用在哪裡
 *
 * 任何「會被編排進同一筆業務、因此必須收外部交易 handle 作為第一個參數」的 service 動作
 * （計畫 §4.1 定案的那一批），其收 handle 的那一支簽章都應該用 `TransactionRunner`，不是
 * `QueryRunner`——用 `QueryRunner` 的話，呼叫端傳一個裸連線池進來一樣編譯得過，型別就白設了。
 * `QueryRunner` 仍然是 repository 層該用的型別（交易內外同一套寫法，見上方檔頭），
 * 兩者不是取代關係，是**分層**：repository 收 `QueryRunner`，「證明呼叫端真的開了交易」
 * 這件事只在跨模組編排的參與者的入口簽章上才需要出現。
 *
 * `db/__tests__/transaction-runner.test.ts` 用 `@ts-expect-error` 證明連線池塞不進來，
 * 且那份測試會在 `TransactionRunner` 哪天被放寬到連線池也塞得進去時，
 * 因為「預期的錯誤沒有發生」而讓 `bun run typecheck` 變紅——比一句註解可靠。
 */
export type TransactionRunner = QueryRunner & Pick<DbTransaction, 'rollback'>

/** 建立連線池。時區設定見 {@link assertDatabaseTimeZone}——這裡設，啟動時再驗一次。 */
export const createDatabase = (config: DatabaseConfig): Database => {
  const pool = createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    // 每條連線都把 session 時區釘在 +08:00（§6）。連線池會在不同時間建立新連線，
    // 只在啟動時設一次是不夠的——後來才建立的那幾條會沿用伺服器預設（多半是 UTC），
    // 於是同一支程式寫出來的時間會隨著「這次剛好用到哪一條連線」而差 8 小時。
    timezone: '+08:00',
    waitForConnections: true,
    // 讀 decimal 一律拿字串，禁止讓驅動轉成 JS number（§4.7）：
    // 轉成 float 的那一刻精度就沒了，而薪資單上的一塊錢差額對不起來時已經追不回成因。
    decimalNumbers: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  })

  return drizzle(pool)
}

/**
 * 綁定單一公司的資料存取入口。
 *
 * 所有方法都會把 `company_id = <本公司>` 加進 `WHERE` 的第一段，因此「別家公司的資料」
 * 在查詢階段就等同於不存在。這同時是 §3.2 那條安全規則的實作手段：
 * 「目標不存在」與「目標屬於其他公司」走的是同一行程式碼，**想寫出不一致的回應都寫不出來**
 * ——而兩者一旦可區分，攻擊者拿 id 枚舉就能探測出別家公司有哪些資料存在。
 */
export class TenantDatabase {
  readonly #runner: QueryRunner
  readonly #companyId: string

  constructor(runner: QueryRunner, companyId: string) {
    this.#runner = runner
    this.#companyId = companyId
  }

  /** 本次操作的公司範圍。只讀，且只能來自已驗證的 token（§4.2）。 */
  get companyId(): string {
    return this.#companyId
  }

  /**
   * 公司條件 ＋ 呼叫端條件（單一資料表）。
   *
   * 直接暴露它，是為了讓少數必須自己組查詢的場合仍然有一條**帶著公司條件**的路
   * ——沒有這個出口，那些場合就會繞回裸 db client，而那才是真正沒人擋得住的破口。
   */
  scope(table: CompanyScopedTable, ...conditions: readonly (SQL | undefined)[]): SQL | undefined {
    return and(eq(table.companyId, this.#companyId), ...conditions)
  }

  /**
   * 公司條件 ＋ 呼叫端條件（**join 用：一次涵蓋多張表**）。
   *
   * §4.2 要求「JOIN 的每一張帶 `company_id` 的表都要帶條件」，而 {@link scope} 一次只管一張，
   * 於是 join 查詢過去只能把其餘幾張的公司條件手寫進 `ON`／`WHERE`——那些手寫的條件裡
   * `companyId` 是從參數傳進來的一個普通字串，寫成別的值或整段漏掉都不會有任何地方變紅。
   * 這個方法讓 join 的每一張表都從**同一個**私有 `#companyId` 取值，因此「其中一張表漏了公司條件」
   * 與「某一張表比對到別的公司」都變成寫不出來，而不是要記得避免。
   *
   * @param tables join 進來的每一張帶公司範圍的表（全域表如 `users`／`permissions` 不放進來）。
   */
  scopeAll(tables: readonly CompanyScopedTable[], ...conditions: readonly (SQL | undefined)[]): SQL | undefined {
    return and(...tables.map((table) => eq(table.companyId, this.#companyId)), ...conditions)
  }

  select<TTable extends CompanyScopedTable, TColumns extends SelectColumns>(
    columns: TColumns,
    table: TTable,
    ...conditions: readonly (SQL | undefined)[]
  ) {
    return this.#runner
      .select(columns)
      .from(table)
      .where(this.scope(table, ...conditions))
  }

  /**
   * 去重複查詢（`SELECT DISTINCT`）。
   *
   * join 到一對多的關聯之後同一列會重複出現（例如一位成員的多個角色指向同一個權限碼），
   * 而「多回幾列一模一樣的資料」不會報錯、只會讓上層的計數與集合悄悄變形。
   */
  selectDistinct<TTable extends CompanyScopedTable, TColumns extends SelectColumns>(
    columns: TColumns,
    table: TTable,
    ...conditions: readonly (SQL | undefined)[]
  ) {
    return this.#runner
      .selectDistinct(columns)
      .from(table)
      .where(this.scope(table, ...conditions))
  }

  /**
   * join 查詢的起點：只做到 `FROM`，`JOIN` 與 `WHERE` 由呼叫端接下去。
   *
   * 為什麼不能像 {@link select} 那樣連 `WHERE` 一起補好：drizzle 的 builder 規定 `JOIN` 要接在
   * `FROM` 與 `WHERE` 之間，一旦這裡先呼叫了 `.where()`，呼叫端就再也 join 不上去。
   *
   * **呼叫端必須以 {@link scopeAll} 作為 `where` 的來源**（把 join 進來的每一張帶公司範圍的表
   * 都列進去）。這條沒辦法由型別強制，但它比原本的狀況嚴格得多：原本 join 查詢連 runner 都是
   * 裸的，公司 ID 是一個可以被寫成任何值的參數；現在公司 ID 只存在於本物件內部，
   * 呼叫端**寫不出「別家公司」這個值**，最壞的情況只剩「忘記加條件」——那是 review 看得見的漏，
   * 不是 review 看不出來的錯值。
   */
  selectFrom<TTable extends CompanyScopedTable, TColumns extends SelectColumns>(columns: TColumns, table: TTable) {
    return this.#runner.select(columns).from(table)
  }

  /** {@link selectFrom} 的去重複版本。注意事項與它相同。 */
  selectDistinctFrom<TTable extends CompanyScopedTable, TColumns extends SelectColumns>(
    columns: TColumns,
    table: TTable,
  ) {
    return this.#runner.selectDistinct(columns).from(table)
  }

  /**
   * 更新。
   *
   * 狀態變更請把「預期的目前狀態」一併放進 `conditions` 並檢查影響列數（§4.4）：
   * 先讀再寫的話，兩個使用者同時操作會讓狀態變更的副作用被套用兩次。
   *
   * `values` 用 drizzle 自己的 `MySqlUpdateSetSource` 而不是 `Partial<InferInsertModel<>>`：
   * 後者少了「值可以是一段 `SQL`」（例如 `count = count + 1`）這一種，且它推導出的 key 集合
   * 與 `.set()` 期望的 key 集合在泛型未具現時對不起來，於是每一次呼叫都是型別錯誤。
   */
  update<TTable extends CompanyScopedTable>(
    table: TTable,
    values: MySqlUpdateSetSource<TTable>,
    ...conditions: readonly (SQL | undefined)[]
  ) {
    return this.#runner
      .update(table)
      .set(values)
      .where(this.scope(table, ...conditions))
  }

  /**
   * 新增單列。
   *
   * @param buildValues 由公司 ID 產生要寫入的列。**刻意做成回呼**：呼叫端拿不到別的公司 ID，
   *   唯一的來源就是這個參數，於是「寫進別家公司」不是「要小心避免」而是寫不出來。
   */
  insert<TTable extends CompanyScopedTable>(
    table: TTable,
    buildValues: (companyId: string) => MySqlInsertValue<TTable>,
  ) {
    return this.#runner.insert(table).values(buildValues(this.#companyId))
  }

  /**
   * 批次新增。
   *
   * 沒有它的時候，「一次寫入數十列」（§4.5：不在迴圈裡逐筆 insert）只能走裸 runner，
   * 於是**每一支批次寫入都在自己填 `company_id`**——封裝擋得住單列卻擋不住批次，
   * 而批次正是一次寫錯就錯一整批的那一種。回呼形式與 {@link insert} 相同：公司 ID 只有一個來源。
   *
   * @param buildRows 由公司 ID 產生要寫入的所有列。空陣列會被直接忽略——
   *   `INSERT ... VALUES ()` 不是合法語句，而「沒有東西要寫」時什麼都不做才是正確結果。
   */
  insertMany<TTable extends CompanyScopedTable>(
    table: TTable,
    buildRows: (companyId: string) => readonly MySqlInsertValue<TTable>[],
  ): Promise<void> {
    const rows = buildRows(this.#companyId)
    if (rows.length === 0) return Promise.resolve()
    return this.#runner
      .insert(table)
      .values([...rows])
      .then(() => undefined)
  }

  /**
   * 實體刪除。
   *
   * **本方法的存在不代表可以隨手實體刪除。** §4.3 那條規則沒有變：有歷史意義的資料一律軟刪除
   * 或標記撤銷。這裡開一個出口，是因為原本「不提供」並沒有讓實體刪除消失——真的需要它的地方
   * （純關聯表 `role_permissions` 的整組替換）改成走裸 runner，自己把 `company_id` 寫進 `WHERE`，
   * 結果是**唯一一個「刪錯就是刪掉別家公司資料」的操作，剛好是全專案唯一沒被封裝擋住的那一個**。
   * 兩害相權：把它收進封裝，公司條件就必定在；要不要實體刪除則回到 review 與 §4.3 去判斷，
   * 那本來就是個該被看見、該被質疑的決定，而不是型別能替我們決定的事。
   */
  delete<TTable extends CompanyScopedTable>(table: TTable, ...conditions: readonly (SQL | undefined)[]) {
    return this.#runner.delete(table).where(this.scope(table, ...conditions))
  }
}

/** `select()` 的欄位參數型別。由 drizzle 的簽章反推，避免相依它的內部型別名稱。 */
type SelectColumns = NonNullable<Parameters<Database['select']>[0]>

/** 綁定公司的資料存取入口（非交易）。 */
export const forCompany = (db: Database, companyId: string): TenantDatabase => new TenantDatabase(db, companyId)

/**
 * 在交易內綁定公司。
 *
 * **交易邊界屬於 service 層**（§4.4）：repository 不自開交易，否則巢狀時無法合併成一個原子操作。
 * 交易內禁止呼叫外部 HTTP、寄信、寫檔或長時間計算——交易期間持有列鎖，
 * 一次外部逾時就會連鎖鎖住整張表。
 */
export const transactionForCompany = <T>(
  db: Database,
  companyId: string,
  run: (tx: TenantDatabase) => Promise<T>,
): Promise<T> => db.transaction((tx) => run(new TenantDatabase(tx, companyId)))
