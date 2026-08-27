/**
 * 導覽選單（前端規範 §0.2）。
 *
 * **選單是一份資料結構，不是目錄結構。** 分組、排序、層級全部寫在這裡；
 * 選單改版只改這個檔案，**不得造成任何檔案搬動**。
 *
 * 理由是把「便宜且可變」的東西（導覽分組是 UX 產物，改版是常態）與「昂貴且難改」的東西
 *（目錄，搬動要連帶改 import、改檔名、動到 git 歷史）分開。兩者綁在一起的話，
 * 第一次導覽改版就會面臨二選一：搬目錄（連帶改 URL 與所有角色檔的檔名），
 * 或不搬（目錄從此與選單矛盾，而且矛盾只會愈積愈多）。
 *
 * 項目指向的是**路由名稱**而不是路徑，理由同 router.ts：交換字串，不建立 import 方向。
 */
import type { MessageKey } from '../shared/i18n/messages.ts'

export type MenuItem = {
  readonly labelKey: MessageKey
  readonly routeName: string
}

export type MenuGroup = {
  readonly labelKey: MessageKey
  readonly items: readonly MenuItem[]
}

export const MAIN_MENU: readonly MenuGroup[] = [
  {
    labelKey: 'menu.overview',
    items: [{ labelKey: 'menu.dashboard', routeName: 'dashboard-main' }],
  },
]
