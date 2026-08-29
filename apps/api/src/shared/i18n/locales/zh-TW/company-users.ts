/**
 * 語系檔：zh-TW × `modules/company-users/`（§1.3、§1.8.2）。
 *
 * 形狀與 key 的推導規則見同目錄的 `sessions.ts` 檔頭。本大目錄有兩個次目錄：`main`（登入帳號
 * 與公司成員關係，實作計畫 `05-employee-onboarding.md` Stage 4 新增）與 `roles`（角色指派），
 * 因此這一批 key 分別長成 `company-users.main.errors.*` 與 `company-users.roles.errors.*`
 * ——這一段就是目錄名，不是另外取的領域名。
 *
 * ⚠️ **本檔只有「字」，而且有兩則是刻意含糊的**（§3.2）：`main.errors.username-taken`
 * 不透露這個帳號屬於哪一家公司；`roles.errors.company-user-not-found` 則是「查無此成員」與
 * 「這位成員屬於別家公司」共用同一句。**理由分別寫在
 * `modules/company-users/main/company-users-main.errors.ts` 與
 * `modules/company-users/roles/company-users-roles.errors.ts`，不在這裡。**
 */

export const COMPANY_USERS = {
  main: {
    errors: {
      /** ⚠️ 不透露這個帳號現在屬於哪一家公司（§3.2）。 */
      'username-taken': '此登入帳號已被使用',
    },
  },
  roles: {
    errors: {
      /** ⚠️ 「查無此成員」與「這位成員屬於別家公司」共用的唯一出口（§3.2）。 */
      'company-user-not-found': '找不到指定的公司成員',
      'company-user-inactive': '成員帳號已停用，無法指派角色',
      /** ⚠️ 同上：別家公司的角色、已軟刪除的角色，與不存在回同一句（§3.2、§4.3）。 */
      'role-not-found': '找不到指定的角色',
      'role-inactive': '角色已停用，無法指派',
      'already-assigned': '這位成員已經擁有這個角色',
      'not-found': '找不到可撤銷的角色指派',
      'last-role-required': '每個帳號至少要保留一個角色，無法全部撤銷',
      'state-changed': '角色指派狀態已變更，請重新載入',
    },
  },
} as const
