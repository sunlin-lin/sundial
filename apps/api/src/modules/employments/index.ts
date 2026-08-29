/**
 * `employments` 大目錄的唯一對外出口（§0.3）。只 re-export service 與 errors，不 export
 * repository 與 routes，理由與 `departments/index.ts` 同構。
 */
export * from './main/employments-main.service.ts'
export * from './main/employments-main.errors.ts'
export * from './department-histories/employments-department-histories.service.ts'
export * from './department-histories/employments-department-histories.errors.ts'
export * from './job-title-histories/employments-job-title-histories.service.ts'
export * from './job-title-histories/employments-job-title-histories.errors.ts'
export * from './job-position-histories/employments-job-position-histories.service.ts'
export * from './job-position-histories/employments-job-position-histories.errors.ts'
