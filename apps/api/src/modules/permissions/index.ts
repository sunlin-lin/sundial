/**
 * `permissions` 大目錄的唯一對外出口（§0.3）。
 *
 * **只 re-export，沒有任何宣告或函式本體**：`index.ts` 是唯一沒有層後綴的檔案，
 * 所有分層規則都不以它為對象——不限制的話它會長成一個沒有規則管得到的第六層，
 * 而且是最方便亂放東西的那一層（「這段兩邊都要用，先放 index」）。
 *
 * **只 export service 與 errors，不 export repository 與 routes**：
 * re-export repository 會讓跨模組的一行 import 把資料庫連線一起拖進來，
 * §4.2「裸 db client 限資料存取層」那條規則會被繞過，而繞過的路徑在 import 語句上完全看不出來。
 * routes 由組裝點（`app/routes.ts`）直接掛載，不從這裡流出去。
 */
export {
  checkAssignable,
  loadPermissionTree,
  type AssignabilityCheck,
  type QueryRunner,
  type PermissionNode,
} from './main/permissions-main.service.ts'
export { PERMISSIONS_MAIN_TREE_ERROR_CODES } from './main/permissions-main.errors.ts'
