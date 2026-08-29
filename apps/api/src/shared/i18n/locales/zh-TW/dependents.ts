/**
 * 語系檔：zh-TW × `modules/dependents/`（§1.3、§1.8.2）。對應 `modules/dependents/main/`，
 * 因此這一批 key 都長成 `dependents.main.errors.*`。
 *
 * ⚠️ **本檔只有「字」**（§3.2 的含糊化規則見
 * `modules/dependents/main/dependents-main.errors.ts`）。
 */

export const DEPENDENTS = {
  main: {
    errors: {
      'employee-not-found': '員工不存在，或不屬於本公司',
      'identity-number-duplicated': '這位員工已經有一筆相同身分證字號的眷屬',
      'not-found': '眷屬不存在，或不屬於本公司',
      'already-terminated': '這筆眷屬已經終止扶養',
      'state-changed': '眷屬資料已被異動，請重新整理後再試',
    },
  },
} as const
