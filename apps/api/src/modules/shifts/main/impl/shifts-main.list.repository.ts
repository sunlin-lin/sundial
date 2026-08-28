/**
 * 資料存取：班別清單的一頁（含每一筆的工作時段與休息時段）＋ 總筆數。
 */
import { asc, count, desc, eq, inArray, like, or, type SQL } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { shiftBreaks, shiftDefinitions, shiftWorkPeriods } from '../../../../db/schema/index.ts'
import { toKeywordPattern } from '../../../../shared/list-view.ts'
import { groupByShiftDefinitionId, toShiftBreak, toShiftWorkPeriod } from '../domain/shift-children.ts'
import type { ShiftListPage, ShiftListQuery, ShiftSummary } from '../domain/shift-model.ts'

/**
 * 排序欄位 → 資料表欄位。
 *
 * 只認白名單內的值，其餘一律落到 `code`：路由的 schema 已經擋過一次，這裡是第二道
 * ——把外部字串接進 `ORDER BY` 是 SQL injection 與全表掃描的入口（§1.4）。
 */
const sortColumn = (field: string) => {
  switch (field) {
    case 'name':
      return shiftDefinitions.name
    case 'createdAt':
      return shiftDefinitions.createdAt
    case 'updatedAt':
      return shiftDefinitions.updatedAt
    default:
      return shiftDefinitions.code
  }
}

/**
 * 篩選條件。
 *
 * **軟刪除同時比對兩個欄位**（`deletedSeq = 0` 供索引使用，`deletedAt IS NULL` 是這張表軟刪除
 * 語意的本體，比照 `employees` 的既有作法，理由見該模組的同名函式）。
 *
 * `isActive` 預設值不在這裡決定——`null` 就是「不篩選」，把它收斂成「預設只顯示啟用」是 handler
 * 的責任（UI 定案），repository 只忠實執行呼叫端給的條件。
 *
 * `keyword` 同時比對 `code` 與 `name`：兩欄都是明文（班別沒有加密欄位），不像 `employees` 的
 * `email`／`phone` 那樣受限於密文無法 `LIKE`。
 */
const buildConditions = (query: ShiftListQuery): readonly (SQL | undefined)[] => {
  const conditions: (SQL | undefined)[] = [eq(shiftDefinitions.deletedSeq, 0)]

  if (query.keyword !== null && query.keyword !== '') {
    const pattern = toKeywordPattern(query.keyword)
    conditions.push(or(like(shiftDefinitions.code, pattern), like(shiftDefinitions.name, pattern)))
  }
  if (query.workTypeCode !== null) conditions.push(eq(shiftDefinitions.workTypeCode, query.workTypeCode))
  if (query.isOvernight !== null) conditions.push(eq(shiftDefinitions.isOvernight, query.isOvernight))
  if (query.isFlexible !== null) conditions.push(eq(shiftDefinitions.isFlexible, query.isFlexible))
  if (query.isActive !== null) conditions.push(eq(shiftDefinitions.isActive, query.isActive))

  return conditions
}

/**
 * 取一頁班別（含工作時段與休息時段）。
 *
 * **子表查詢與主檔分頁分開，但只各發一次，不逐筆查**（§4.5 的 N+1）：先取出這一頁的
 * `shiftDefinitionId` 清單，再各用一次 `IN (...)` 查詢取回全部子表列，最後在記憶體中依
 * `shiftDefinitionId` 分組——一頁 20 筆是「3 次查詢」而不是「41 次查詢」。
 *
 * `currentPage` 超出範圍時自然回空陣列與正確的 `pagination`，不另外判斷、也不回 404（§1.4）。
 */
export const listShiftPage = async (
  runner: QueryRunner,
  companyId: string,
  query: ShiftListQuery,
): Promise<ShiftListPage> => {
  const tenant = new TenantDatabase(runner, companyId)
  const conditions = buildConditions(query)
  const direction = query.sort.order === 'desc' ? desc : asc

  const rows = await tenant
    .select(
      {
        id: shiftDefinitions.id,
        code: shiftDefinitions.code,
        name: shiftDefinitions.name,
        workTypeCode: shiftDefinitions.workTypeCode,
        isOvernight: shiftDefinitions.isOvernight,
        isFlexible: shiftDefinitions.isFlexible,
        requiredWorkMinutes: shiftDefinitions.requiredWorkMinutes,
        isActive: shiftDefinitions.isActive,
      },
      shiftDefinitions,
      ...conditions,
    )
    // 第二排序鍵固定為 id：只依單一欄位排序時，同值的列在不同頁的順序不保證，
    // 於是同一個班別會同時出現在第 1 頁與第 2 頁，而另一個班別一頁都沒出現。
    .orderBy(direction(sortColumn(query.sort.field)), asc(shiftDefinitions.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totals = await tenant.select({ total: count() }, shiftDefinitions, ...conditions)
  const [totalRow] = totals

  const shiftIds = rows.map((row) => row.id)
  // 空頁不必查子表：`inArray(..., [])` 在多數驅動上等於恆假條件，寫成這樣比較直接，
  // 也避免在空清單時發出兩句注定回空的查詢。
  const workPeriodRows =
    shiftIds.length === 0
      ? []
      : await runner
          .select({
            shiftDefinitionId: shiftWorkPeriods.shiftDefinitionId,
            sequenceNo: shiftWorkPeriods.sequenceNo,
            startTime: shiftWorkPeriods.startTime,
            endTime: shiftWorkPeriods.endTime,
            endDayOffset: shiftWorkPeriods.endDayOffset,
            workMinutes: shiftWorkPeriods.workMinutes,
          })
          .from(shiftWorkPeriods)
          .where(inArray(shiftWorkPeriods.shiftDefinitionId, shiftIds))
          .orderBy(asc(shiftWorkPeriods.shiftDefinitionId), asc(shiftWorkPeriods.sequenceNo))
  const breakRows =
    shiftIds.length === 0
      ? []
      : await runner
          .select({
            shiftDefinitionId: shiftBreaks.shiftDefinitionId,
            sequenceNo: shiftBreaks.sequenceNo,
            startTime: shiftBreaks.startTime,
            endTime: shiftBreaks.endTime,
            startDayOffset: shiftBreaks.startDayOffset,
            endDayOffset: shiftBreaks.endDayOffset,
            breakMinutes: shiftBreaks.breakMinutes,
            isPaid: shiftBreaks.isPaid,
          })
          .from(shiftBreaks)
          .where(inArray(shiftBreaks.shiftDefinitionId, shiftIds))
          .orderBy(asc(shiftBreaks.shiftDefinitionId), asc(shiftBreaks.sequenceNo))

  const workPeriodsByShift = groupByShiftDefinitionId(workPeriodRows)
  const breaksByShift = groupByShiftDefinitionId(breakRows)

  const items: readonly ShiftSummary[] = rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    workTypeCode: row.workTypeCode,
    isOvernight: row.isOvernight,
    isFlexible: row.isFlexible,
    requiredWorkMinutes: row.requiredWorkMinutes,
    isActive: row.isActive,
    workPeriods: (workPeriodsByShift.get(row.id) ?? []).map(toShiftWorkPeriod),
    breaks: (breaksByShift.get(row.id) ?? []).map(toShiftBreak),
  }))

  return { items, totalCount: totalRow?.total ?? 0 }
}
