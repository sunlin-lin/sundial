/**
 * 語系檔：zh-TW × `modules/withholding/`（§1.3、§1.8.2）。對應 `modules/withholding/main/`，
 * 因此這一批 key 都長成 `withholding.main.errors.*`。
 *
 * ⚠️ **本檔只有「字」**（§3.2 的含糊化規則見 `modules/withholding/main/withholding-main.errors.ts`，
 * `employee-not-found` 同時服務「不存在」與「跨公司存取」兩種情境，理由寫在該檔，不在這裡）。
 */

export const WITHHOLDING = {
  main: {
    errors: {
      'employee-not-found': '員工不存在，或不屬於本公司',
      'period-overlap': '此期間與該員工既有的扣繳設定重疊，請確認生效日',
      'duplicate-effective-from': '同一天已經有一筆扣繳設定，請確認生效日',
    },
  },
} as const
