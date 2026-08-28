import { describe, expect, test } from 'bun:test'
import { MAIN_MENU, visibleMenuGroups } from './main-menu.ts'
import type { PermissionCode } from '../shared/permission/permission-code.ts'

/** 只有指定那幾個權限碼的使用者。 */
const grantedOnly =
  (...codes: readonly PermissionCode[]) =>
  (code: PermissionCode): boolean =>
    codes.includes(code)

const routeNamesOf = (groups: ReturnType<typeof visibleMenuGroups>): readonly string[] =>
  groups.flatMap((group) => group.items.map((item) => item.routeName))

describe('選單的權限過濾', () => {
  test('全部權限都有時，看得到選單上的每一項', () => {
    const visible = routeNamesOf(visibleMenuGroups(() => true))
    expect(visible).toEqual(routeNamesOf(MAIN_MENU))
  })

  test('沒有 regulatory.datasets.overview 的人看不到資料集總覽', () => {
    const visible = routeNamesOf(visibleMenuGroups(grantedOnly('regulatory.sync.list')))
    expect(visible).not.toContain('regulatory-datasets')
    expect(visible).toContain('regulatory-sync')
  })

  test('沒有 regulatory.sync.list 的人看不到同步歷程', () => {
    const visible = routeNamesOf(visibleMenuGroups(grantedOnly('regulatory.datasets.overview')))
    expect(visible).not.toContain('regulatory-sync')
    expect(visible).toContain('regulatory-datasets')
  })

  test('沒有標權限碼的項目一律看得到——首頁不對應任何一支端點', () => {
    const visible = routeNamesOf(visibleMenuGroups(() => false))
    expect(visible).toEqual(['dashboard-main'])
  })

  test('整組項目都被藏掉時連分組標題一起不顯示，畫面上不會出現空分組', () => {
    const groups = visibleMenuGroups(() => false)
    expect(groups.map((group) => group.labelKey)).toEqual(['menu.overview'])
  })

  test('過濾不會改動原始的選單資料——它每次都是同一份', () => {
    const before = routeNamesOf(MAIN_MENU)
    visibleMenuGroups(() => false)
    expect(routeNamesOf(MAIN_MENU)).toEqual(before)
  })
})

describe('選單項目與路由的對應', () => {
  test('路由名稱不重複——兩項指到同一頁時其中一項永遠打不開對的地方', () => {
    const names = routeNamesOf(MAIN_MENU)
    expect(new Set(names).size).toBe(names.length)
  })
})
