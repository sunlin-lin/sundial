/**
 * 業務動作：查出一位公司成員目前擁有的權限碼集合。
 *
 * 這一層是純轉手，仍然要有：呼叫者是入口層的身分驗證 middleware，而入口層不得直接碰
 * repository（§0.3、`shared/access-control.ts` 檔頭）。讓 middleware 直接 import 查詢函式，
 * 等於把「Web 前端這個入口怎麼驗身分」與「權限資料怎麼存」綁在一起——第二種入口出現時，
 * 它要換掉的是驗證方式，不該連帶把權限查詢也複製一份。
 */
import {
  listPermissionCodes as listPermissionCodesFromDb,
  type QueryRunner,
} from '../company-users-roles.repository.ts'

export const listPermissionCodes = (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<ReadonlySet<string>> => listPermissionCodesFromDb(runner, companyId, companyUserId)
