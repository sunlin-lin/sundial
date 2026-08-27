/**
 * 路由 meta 的型別擴充。
 *
 * 只有一個欄位：`isPublic`。守衛的預設是「需要登入」，公開頁面必須**明寫**出來——
 * 與後端「公開端點必須放在具名的公開群組」是同一條規則的兩面（後端規範 §1.9.2）：
 * 「沒有標記」與「刻意公開」若長得一樣，一個沉默的安全漏洞在程式碼上與正常程式碼逐字相同，
 * review 看不出來。
 */
import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    /** 明寫 `true` 才是公開路由；未標記一律視為需要登入。 */
    isPublic?: boolean
  }
}
