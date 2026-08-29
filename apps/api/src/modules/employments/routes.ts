/**
 * `employments` 大目錄對「路由組裝點」的唯一出口（§0.3）。只允許 `export ... from`，
 * 來源檔名後綴只能是 `.routes.ts`。
 */
export { employmentsMainRoutes } from './main/employments-main.routes.ts'
export { employmentsDepartmentHistoriesRoutes } from './department-histories/employments-department-histories.routes.ts'
