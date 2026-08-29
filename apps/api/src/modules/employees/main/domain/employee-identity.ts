/**
 * 身分證字號的正規化。**本檔的函式本體已搬到 `shared/identity-normalization.ts`**
 * （實作計畫 `plans/05-employee-onboarding.md` §8 Stage 7）：`modules/dependents/main/`
 * 新增後成為第二個真實呼叫者，抽成 shared 讓兩邊共用同一份正規化規則，不再各自演化
 * （完整理由見該檔檔頭）。本檔保留為單純 re-export，避免動到既有的 import 路徑
 * （`employee-secrets.ts`／`employees-main.update.service.ts`／既有測試）。
 */
export { normalizeIdentityNumber } from '../../../../shared/identity-normalization.ts'
