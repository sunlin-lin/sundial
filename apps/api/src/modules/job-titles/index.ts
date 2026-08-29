/**
 * `job-titles` 大目錄的唯一出口（§0.3）。只 re-export service 與 errors，理由與
 * `departments/index.ts` 同構。
 */
export * from './main/job-titles-main.service.ts'
export * from './main/job-titles-main.errors.ts'
