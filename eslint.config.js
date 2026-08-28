// ESLint flat config（根目錄唯一一份，通用規範 §4.1：全 repo 只有一套 linter／formatter）。
//
// 這份設定刻意只開規範明文要求、且答得出「這條靠什麼擋」的規則（通用規範 §7.1）。
// 不開一堆與本專案無關的預設規則——那只會製造大量雜訊，而人對雜訊的反應是關掉整個檢查
//（任務說明原文）。所有非預設關閉的規則旁邊都留一句「為什麼」。
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  // 產生物、第三方碼、不受本規範管轄的目錄一律不掃。
  // apps/api/drizzle 是 migration 產物（drizzle-kit 自己寫的 SQL 與 meta json），
  // 掃它只會對著別人產生的格式報錯，且後端規範 §4.1 禁止修改已套用的 migration。
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.tsbuild/**',
      '**/coverage/**',
      'apps/api/drizzle/**',
      'apps/web/src/api/generated/**',
      'openapi.json',
    ],
  },

  // 基底：ESLint 內建推薦規則，全語言共用。
  js.configs.recommended,

  // eslint:recommended 內建的 no-irregular-whitespace 在本專案會對著故意寫的內容報錯，
  // 不是抓到 bug：法規同步模組大量處理政府公開資料的原始怪癖（UTF-8 BOM、全形空白），
  // 相關檔頭與測試會刻意在註解或測試資料中放進那個字元，用來說明「原始資料長這樣」
  // （例如 regulatory-csv.ts 檔頭用一段含 BOM 的文字示範壞掉的欄位名）。這條規則抓的是
  // 「打字打錯的空白」，在這裡卻命中「故意重現的髒資料」，兩者在這個專案裡無法用同一條
  // 規則同時分辨——關掉它、靠 review 判斷才是對的處置，而不是逐一加白名單去追著髒資料跑。
  { rules: { 'no-irregular-whitespace': 'off' } },

  // ---------------------------------------------------------------------------------------
  // apps/api/src 與 apps/api/scripts：型別感知的 TypeScript 規則。
  // parserOptions.project 明寫指向該 workspace 的 tsconfig（通用規範 §4.2 明文要求，
  // 不用 typescript-eslint 的自動 projectService——那條規則的理由就是「新增 package
  // 時必須同步納入」，用自動探索會讓這件事變成不必做，於是漏掉的那個 package 會在
  // 「型別感知規則靜默不生效」而不是「掃描器報錯」的方式下失效）。
  // ---------------------------------------------------------------------------------------
  {
    files: ['apps/api/src/**/*.ts', 'apps/api/scripts/**/*.ts'],
    // 用 `recommended`（語法層級）而不是 `recommendedTypeChecked`：後者會一併打開
    // no-unsafe-assignment／no-unsafe-argument／no-redundant-type-constituents 這一批
    // 「型別感知但與本輪規範無關」的規則，在既有程式碼上大量誤中（任務說明明講「不要開
    // 一堆與規範無關的預設規則」）。`parserOptions.project` 照樣設定，型別資訊仍然可用，
    // 下面手動點名的兩條型別感知規則（no-floating-promises／require-await）一樣生效。
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        project: ['apps/api/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // TypeScript 編譯器本身已檢查未定義的識別字；no-undef 在型別檔案（.d.ts）與
      // 環境全域型別（如 Bun）上會產生 TS 已經擋掉的假警報。typescript-eslint 官方
      // 建議關閉，理由與連結見 README「Rules」一節。
      'no-undef': 'off',

      // 通用規範 §4.2：漏 await 時 DB 交易會在 promise 完成前 commit/rollback，
      // 資料寫一半且不報錯。必須 error，不得降級（降級等於不存在）。
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // 前綴底線的參數／變數是全專案通用的「刻意不用」慣例（例如測試裡的假時鐘
      // callback 簽章要對齊真正的介面，某些參數用不到），不是死程式碼——與
      // §0.4「動作切片」等處的既有寫法一致，不應強迫改名或加無意義的用途。
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-console': 'error',
      eqeqeq: 'error',

      // §6.2：業務程式碼禁止直接讀系統時間，一律透過 shared/clock.ts 注入的 Clock。
      // 直接使用 new Date()／Date.now() 會讓涉及日期的業務邏輯（跨日、月底、级距生效日）
      // 無法用固定時間測試，也無法在時區切換時重現問題。
      //
      // 只抓「零參數」的 `new Date()`：那是唯一真的在讀系統當下時間的形狀。
      // `new Date('2026-...')`／`new Date(0)`／`new Date(someInstant.getTime() + x)`
      // 是把一個**已知、固定**的時刻轉成 Date 物件，不是在問「現在幾點」——
      // fixedClock(new Date(0))、測試裡建構固定時鐘用的 new Date('...') 都屬於這一類，
      // 抓過頭的話這條規則會連「刻意寫死一個時刻」都擋下來，逼人為了過 lint 把常數改成
      // 更難懂的寫法，而規則真正該擋的「偷偷讀系統時間」反而不會因此更少。
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: '業務程式碼禁止 `new Date()`（§6.2）。改注入 shared/clock.ts 的 Clock，取得可控的「現在」。',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: '業務程式碼禁止 `Date.now()`（§6.2）。改注入 shared/clock.ts 的 Clock，取得可控的「現在」。',
        },
      ],
    },
  },
  {
    // clock.ts 自己與所有測試檔（不論在 apps/api/src 或 apps/api/scripts 底下）
    // 是 §6.2 唯一的例外：關掉上面那條 no-restricted-syntax。
    files: [
      'apps/api/src/shared/clock.ts',
      'apps/api/src/**/__tests__/**',
      'apps/api/scripts/__tests__/**',
      'apps/api/**/*.test.ts',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // apps/api/scripts/** 是開發期／CI 用的 CLI 工具（gen:api、各種 check:*），
    // 不是執行期 API：它們本來就該把結果印到 stdout 給人或 CI 看。no-console 的理由
    // 「生產環境把個資或薪資印到 stdout」（通用規範 §4.2）在這裡不成立，硬套只會逼
    // 這些腳本繞道用 process.stdout.write 講同一件事，於是規則只換了個殼子還是被繞過。
    files: ['apps/api/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // ---------------------------------------------------------------------------------------
  // §4.7「金額不得退化為 number」的可行程度（誠實記錄，不假裝做得到）：
  //
  // 本專案目前用 TypeBox 的 `t.String({ pattern: ... })` 表達 Money（apps/api/src/shared/
  // field-schemas.ts），在 TypeScript 型別層它就是 `string`，與其他任何字串（sort_order、
  // 代碼、日期片段……）沒有型別上的差異。沒有一個能被型別系統認出來的 Money 型別，
  // ESLint／typescript-eslint 就沒有依據判斷「這個 Number(x) 的 x 是不是金額」——
  // 型別感知規則靠的正是型別，而這裡的型別對兩種情境是同一個。
  //
  // 因此以下只做得到「命名慣例」層級的提醒（warn，非 error）：`Number(`／`parseFloat(`／
  // `parseInt(` 的引數若讀起來像金額欄位（amount／salary／wage／premium／price／balance／
  // money／payroll），才提醒。這是啟發式，不是型別保證——取不到真正的保證，只能做到
  // 「常見誤用會被提醒」。真正的修法是替 Money 建立實際的 branded type（例如
  // `type Money = string & { readonly __brand: 'Money' }`），屆時可以把這條換成
  // `no-unsafe-argument` 之類的型別感知規則直接擋下所有非法互轉。這件事涉及在
  // apps/api/src 引入一個新的共用型別並回頭套用到既有 schema，是架構層級的變動，
  // 依本輪任務範圍不自行實作，回報給人類決定是否要做。
  // ---------------------------------------------------------------------------------------
  {
    files: ['apps/api/src/modules/**/*.ts'],
    ignores: ['**/__tests__/**', '**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            'CallExpression[callee.name=/^(Number|parseFloat|parseInt)$/] Identifier[name=/[Aa]mount|[Ss]alary|[Ww]age|[Pp]remium|[Pp]rice|[Bb]alance|[Mm]oney|[Pp]ayroll/]',
          message:
            '§4.7：金額欄位疑似被轉成 number 計算。decimal 欄位讀出來是字串，禁止 Number(...) 後再計算——' +
            '若這不是金額欄位可忽略此警告（本規則僅能依變數命名啟發式判斷，見 eslint.config.js 檔頭說明）。',
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------------------
  // apps/web/src：TypeScript（含 .vue 的 <script>）＋ Vue 規則。
  // 型別感知規則需要兩份 tsconfig：tsconfig.json（排除 *.test.ts）與 tsconfig.test.json
  // （只收 *.test.ts 以外全部＋測試，見兩份檔案的檔頭）；缺一份，那一半的檔案就會在
  // 「找不到所屬 project」下被型別感知規則靜默跳過。
  // ---------------------------------------------------------------------------------------
  {
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.vue'],
    // 理由同後端那一塊：只要 `recommended`，不要 `recommendedTypeChecked` 整包的
    // no-unsafe-* 系列，避免與本輪規範無關的規則製造大量誤報。
    extends: [...tseslint.configs.recommended, ...vue.configs['flat/recommended']],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        project: ['apps/web/tsconfig.json', 'apps/web/tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-console': 'error',
      eqeqeq: 'error',

      // Vue 元件的 <template> 檢查：eslint-plugin-vue 的 recommended 集合本身就含
      // 反應式依賴（無漏列 watch/computed 依賴的規則屬 Vue 3 編譯期已處理，這裡
      // 開的是模板內容規則，例如禁止未宣告的元件、v-for 缺 key），已足以涵蓋通用
      // 規範 §4.2 表格中「Vue 反應式相依規則」與「<template> 內容規則」兩項。

      // 前端規範 §3.1：元件／store／composable 一律禁止 import axios，
      // 所有請求走專案唯一的 HTTP client（apps/web/src/shared/api/http-transport.ts）。
      // 繞過統一 client 直接發請求，session 續期、逾時、統一錯誤映射（前端規範 §3.x）
      // 全部不會套用到那一次呼叫。
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'axios',
              message: '禁止直接 import axios（前端規範 §3.1）。所有請求一律經 shared/api/http-transport.ts。',
            },
          ],
        },
      ],
    },
  },
  {
    // 統一 client 檔案本身：它就是「axios 只能被誰用」規則裡唯一的合法使用者。
    files: ['apps/web/src/shared/api/http-transport.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // 測試檔（後端 __tests__、前端 *.test.ts）放寬 no-explicit-any 之外皆不放寬——
  // 測試碼一樣要抓漏 await 與死變數，那兩者在測試裡出問題一樣會讓測試變得不可信。
  // 這裡刻意不整批關掉型別感知規則，只在真的需要動態組出任意形狀測資的地方才用
  // 行內 eslint-disable 並附理由（code-commenting 技能的要求）。

  // 根目錄的設定檔本身（eslint.config.js、.prettierrc.cjs、vite.config.ts 等）不在任何
  // workspace 的 tsconfig `include` 內，型別感知規則對它們一定會報「不在 project 裡」。
  // 這裡改用純語法層級檢查，不接 TypeScript 型別系統。
  {
    files: ['*.js', '*.cjs', '*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },

  // eslint-config-prettier 必須排在陣列最後才生效（通用規範 §4.1）：
  // 它只做一件事——關掉所有跟排版有關、會跟 Prettier 打架的 ESLint 規則。
  prettier,
)
