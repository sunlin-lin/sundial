/**
 * dependency-cruiser 設定（`bun run check:layers`，只掃 `apps/api/src`，見根 package.json）。
 *
 * 這份設定把後端規範 §0／§3.1.1／§4.2 掛在 dependency-cruiser 上的那批規則落地成可執行的檢查。
 * 每一條的理由與對照的規範章節都寫在該條規則的 `comment` 裡（`bun run check:layers` 紅燈時，
 * dependency-cruiser 會把這段 comment 原樣印出來，因此理由寫在這裡就是寫給違規當下的人看的）。
 *
 * ## 為什麼看不到型別限定（`import type`）造成的邊
 *
 * 本檔沒有開 `options.tsPreCompilationDeps`（預設關）：dependency-cruiser 在這個模式下完全不
 * 追蹤 `import type { ... }` 這種型別限定匯入（TypeScript 編譯後會整行消失，執行期沒有這條邊）。
 * 這是刻意的取捨，不是漏設：本專案多處合法地跨層引用型別而不是值——例如 `*.handler.ts`／
 * `domain/*-context.ts` 用 `import type { Database } from '../../../db/client.ts'` 只是要標註
 * 一個型別，並不會因此拿到裸 db client 去下查詢，§4.2 真正要擋的是「能不能執行查詢」，不是
 * 「認不認得這個型別」。若打開 `tsPreCompilationDeps`，下面每一條規則都要重新加一輪
 * 「排除 type-only」的條件，而且很容易漏一條；不追蹤型別邊則是一次性解決所有規則的同一個問題。
 * 代價要誠實記下：**純型別匯入造成的架構耦合，這份設定完全看不見**——例如 `*.service.ts`
 * 用 `import type` 引入 `http/` 的型別不會被下面「service 不得 import http」那條抓到。
 * `verbatimModuleSyntax`（tsconfig.base.json）強制型別匯入一律寫 `import type`，這種繞法在
 * code review 上至少是看得見的一行，不是完全沒有防線，只是防線從「機器擋」退成「人看」。
 */
module.exports = {
  forbidden: [
    // ===== §0.3：大目錄的兩個出口 =====================================================
    {
      name: 'cross-module-only-via-index',
      severity: 'error',
      comment:
        '跨大目錄只能透過對方大目錄的 index.ts（後端規範 §0.3、§8 第 3 條）。index.ts 只 export ' +
        'service 與 errors；繞過它直接 import 對方的 repository／handler／impl 等內部檔案，等於把 ' +
        '對方那個次目錄的業務規則（軟刪除判定、公司範圍、狀態過濾）整組繞掉，對方之後改了規則， ' +
        '這一邊不會知道，也不會有任何地方變紅。',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/(?!$1/)[^/]+/',
        pathNot: '^apps/api/src/modules/[^/]+/index\\.ts$',
      },
    },
    {
      name: 'repository-only-same-submodule',
      severity: 'error',
      comment:
        '`*.repository.ts` 不得被本次目錄以外的任何檔案 import（後端規範 §0.3、§8 第 3 條）。' +
        'repository 只負責把資料撈出來，不含該次目錄的業務規則；跨次目錄要資料一律走對方的 ' +
        'service，不能直接讀它的表。',
      from: { path: '^apps/api/src/modules/([^/]+)/([^/]+)/' },
      to: {
        path: '\\.repository\\.ts$',
        pathNot: '^apps/api/src/modules/$1/$2/',
      },
    },
    {
      name: 'module-routes-only-from-route-assembly-point',
      severity: 'error',
      comment:
        '`modules/<大目錄>/routes.ts` 的合法 import 者只有唯一的路由組裝點 `app/routes.ts`' +
        '（後端規範 §0.3、§8 第 6 條）。少了這條，routes.ts 就只是「另一個 index」，任何模組都能 ' +
        '從它把 HTTP 框架撈進來，繞過 §3.1.1「service／domain 不得碰 http 層」。',
      from: { pathNot: '^apps/api/src/app/routes\\.ts$' },
      to: { path: '^apps/api/src/modules/[^/]+/routes\\.ts$' },
    },

    // ===== §0.4：impl/ 的可見範圍 ======================================================
    {
      name: 'impl-not-from-other-submodule',
      severity: 'error',
      comment:
        '`impl/` 底下的檔案只能被同一個次目錄的入口檔 import，其他次目錄／大目錄一律禁止' +
        '（後端規範 §0.4、§8 第 8 條）。',
      from: { path: '^apps/api/src/modules/([^/]+)/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/[^/]+/[^/]+/impl/',
        pathNot: '^apps/api/src/modules/$1/$2/impl/',
      },
    },
    {
      name: 'impl-only-from-own-entry-file',
      severity: 'error',
      comment:
        '同一個次目錄內，`impl/` 也只能被入口檔（`<大目錄>-<次目錄>.{service,repository}.ts`，' +
        '直接位於次目錄底下、不在任何子目錄裡）import；handler、routes、domain、__tests__ 都不行' +
        '（後端規範 §0.4：「handler 不行、其他次目錄不行……測試也不行（測試打入口）」，§8 第 8 條）。' +
        '這是「所有呼叫都必須經過入口」的強制手段：少了它，入口只是裝飾，旁邊有一整排沒鎖的側門。',
      from: {
        path: '^apps/api/src/modules/([^/]+)/([^/]+)/',
        pathNot: '^apps/api/src/modules/[^/]+/[^/]+/[^/]+\\.(service|repository)\\.ts$',
      },
      to: { path: '^apps/api/src/modules/$1/$2/impl/' },
    },
    {
      name: 'impl-slices-cannot-import-each-other',
      severity: 'error',
      comment:
        '實作切片之間不得互相 import（後端規範 §0.4、§8 第 9 條）。需要共用時只有兩條路：升格成 ' +
        '入口上的一個動作切片，或（若不碰 IO）抽成 domain/ 的純函式。切片互相 import 會在實作層長出 ' +
        '一張沒有任何規則管得到的依賴網，且被共用的那個切片會變成沒有名字的隱性介面。',
      from: { path: '^apps/api/src/modules/[^/]+/[^/]+/impl/' },
      to: { path: '^apps/api/src/modules/[^/]+/[^/]+/impl/' },
    },

    // ===== §3.1.1：service／domain 對入口無關 ==========================================
    {
      name: 'service-domain-no-http-layer',
      severity: 'error',
      comment:
        'service／domain 不得 import http 層或 elysia（後端規範 §3.1.1、§8 第 34 條）。「service ' +
        '不得碰 HTTP」是支撐多入口的手段：同一段業務規則被不同入口呼叫時規則只有一份；一旦業務層碰了 ' +
        'envelope、HTTP status 或 elysia，它就只能被 Web 前端這一種入口呼叫。',
      from: { path: '(\\.service\\.ts$|/domain/)' },
      to: { path: '(^apps/api/src/http/|(^|/)node_modules/elysia)' },
    },

    // ===== §4.2：裸 db client 限資料存取層 =============================================
    {
      name: 'raw-db-client-only-data-access-layer',
      severity: 'error',
      comment:
        '裸 db client（`db/client.ts` 的 `Database`／`createDatabase`／`TenantDatabase`）在 ' +
        'modules/ 底下限資料存取層使用（後端規範 §4.2、§8 第 38 條）：只有 `*.repository.ts`（含 ' +
        'impl 切片）與整合測試（要接真的 MariaDB，通用規範 §7.4）可以直接碰它，service／handler／' +
        'domain 一律不行——那正是「每次查詢都要帶 company_id」這個封裝要堵住的破口：一旦繞得過去， ' +
        '「不帶公司條件寫不出來」就不成立了。',
      from: {
        path: '^apps/api/src/modules/',
        pathNot: '(\\.repository\\.ts$|/__tests__/|\\.test\\.ts$)',
      },
      to: { path: '^apps/api/src/db/client\\.ts$' },
    },

    // ===== §0.6.2：index.ts 是副作用的唯一集合點 ========================================
    {
      name: 'entry-point-not-importable',
      severity: 'error',
      comment:
        '`apps/api/src/index.ts` 不得被任何檔案 import（後端規範 §0.6.2、§8）。它是副作用的集合 ' +
        '點——import 它就等於執行它：連線建立、自檢、listen、起排程器全部會發生。也是 §0.6.4「排程器 ' +
        '只能被啟動一次」的結構性支點：只有它能啟動排程器，而它一個程序只跑一次。',
      from: { pathNot: '^apps/api/src/index\\.ts$' },
      to: { path: '^apps/api/src/index\\.ts$' },
    },

    // ===== §0.6.3：shared/ 不知道自己被誰用 ============================================
    {
      name: 'shared-no-other-top-level-dir',
      severity: 'error',
      comment:
        'shared/** 不得 import 其他頂層目錄（後端規範 §0.6.3 第 3 條、§0.6.6、§8）。這是「shared 不 ' +
        '知道自己被誰用」的執行手段：一旦 import 了 db/ 或 http/，「共用」就退化成「這兩個使用者剛好 ' +
        '長得像」，下一次其中一個使用者的需求變了，改它的人不會知道另一個使用者還在。',
      from: { path: '^apps/api/src/shared/' },
      to: { path: '^apps/api/src/(app|db|http|modules|scheduler)/' },
    },

    {
      name: 'envelope-and-field-schemas-only-from-handler-or-routes',
      severity: 'error',
      comment:
        '`shared/envelope.ts` 與 `shared/field-schemas.ts` 在 modules/ 底下只能被 `*.handler.ts` 與 ' +
        '`*.routes.ts` import（後端規範 §0.6.3 最後一條、§3.1.1）。這兩支用 Elysia 的 `t` 宣告 ' +
        'schema，那是**契約的形狀**，不是共用工具：service 一旦拿到它，就等於業務層開始認得回應信封的 ' +
        '欄位，§1.0.1「同一段業務規則可以被第二種入口呼叫」當場失效，而且是靜靜失效——程式跑得好好的， ' +
        '直到有人要接第二種入口才會發現業務層綁死在 HTTP 回應格式上。規範明寫這條的理由是：' +
        '「東西放在 shared/ 底下」不等於「誰都可以拿」，否則第一個把 envelope 拉進 service 的人會說 ' +
        '自己只是在用一個共用工具。' +
        '\n' +
        '**from 刻意只涵蓋 modules/，這是對規範字面的縮小，要記下來**：規範那句話沒有限定範圍，但 ' +
        '`http/response-envelope.ts` 正是把信封**做出來**的地方，`app/endpoint-inventory.ts` 要比對 ' +
        '端點契約也必然要認得它——照字面掃全樹的話這條規則落地當天就與正確的程式碼衝突。真正要擋的 ' +
        '是「業務層認得回應格式」，而業務層全部在 modules/ 底下。代價是：日後若有人在 http/ 以外、' +
        'modules/ 以外的新頂層目錄裡誤用信封，這條看不到——但那種目錄目前不存在，出現時 §0.6.6 的 ' +
        '依賴方向表本來就要為它補一列。',
      from: {
        path: '^apps/api/src/modules/',
        pathNot: '\\.(handler|routes)\\.ts$',
      },
      to: { path: '^apps/api/src/shared/(envelope|field-schemas)\\.ts$' },
    },

    // ===== §1.3／§8 第 21 條：發證能力 ==================================================
    {
      name: 'token-issuance-only-from-auth-module',
      severity: 'error',
      comment:
        '發證能力（`modules/sessions/main/domain/session-token.ts`、`session-issue.ts`）只能被認證 ' +
        '模組 `modules/sessions/` 自己 import（後端規範 §1.3、§8 第 21 條）。這兩支持有簽章金鑰的 ' +
        '用法：能 import 它們的人可以**替任何人簽出一張有效的 access token**，完全不經過帳號密碼、' +
        '不經過 refresh 票、不留任何登入紀錄。這不是「架構比較乾淨」的問題，是授權邊界本身——' +
        '而它被繞過時看起來與正常請求逐字相同，稽核也只會看到一個合法身分在做合法的事。' +
        '\n' +
        '上面的 `cross-module-only-via-index`／`impl-not-from-other-submodule` 已經擋掉大部分路徑，' +
        '這條仍要單獨存在的理由有二：一是那兩條擋不住 `modules/sessions/` 底下**其他次目錄**' +
        '（日後若長出 sessions/devices 之類），二是那兩條的動機是模組邊界，日後為了某個正當需求 ' +
        '放寬它們時，放寬的人不會知道自己順手拆掉的是金鑰邊界。安全邊界要有一條寫著自己名字的規則。' +
        '\n' +
        '`session-token.ts` 落在 `domain/` 而不是 `shared/`，本身就是這條規則的結構性前提' +
        '（見該檔檔頭）：放進 `shared/` 的話「誰都可以拿」在型別上完全成立。',
      from: { pathNot: '^apps/api/src/modules/sessions/' },
      to: {
        path: '^apps/api/src/modules/sessions/main/domain/session-(token|issue)\\.ts$',
      },
    },

    // ===== §0.6.5：http/ 對每一支端點都一樣 ============================================
    {
      name: 'http-no-modules-or-db',
      severity: 'error',
      comment:
        'http/** 不得 import modules/** 與 db/**（後端規範 §0.6.5、§8）。這是「http/ 對每一支端點 ' +
        '都一樣」的執行手段：一旦 http/ 能 import 某個模組，它會先長出一個依路徑字串判斷的分支， ' +
        '而路徑改名時它不會報錯，只是靜靜地不再命中——那支端點從此少做一件事，沒有測試會紅。',
      from: { path: '^apps/api/src/http/' },
      to: { path: '^apps/api/src/(modules|db|scheduler|app)/' },
    },

    // ===== §0.6.4：scheduler/ 的邊界 ====================================================
    {
      name: 'scheduler-no-db-http-app',
      severity: 'error',
      comment:
        'scheduler/** 不得 import db/、http/、app/（後端規範 §0.6.4、§8）。拿不到 db 是刻意的—— ' +
        '給了它資料庫連線，就等於讓「什麼時候跑」這一層有能力去改「怎麼跑」；拿不到 http/ 是因為背景 ' +
        '工作與入口無關；拿不到 app/ 是因為計時器是副作用，app/ 那一側一個都不能有。' +
        '排程器自己的測試除外（見 pathNot）：它斷言的是排程真的跑完之後 DB 狀態常數對不對' +
        '（如 `RegulatorySyncStatus`），這與 §0.6.6「modules/**/__tests__/** 可以 import app/、http/」' +
        '是同一種必要開口，只是這裡開口的目標換成 db/——不明寫的話，這條規則落地當天就會跟現況衝突。',
      from: {
        path: '^apps/api/src/scheduler/',
        pathNot: '^apps/api/src/scheduler/.*\\.test\\.ts$',
      },
      to: { path: '^apps/api/src/(db|http|app)/' },
    },
    {
      name: 'scheduler-modules-only-via-index',
      severity: 'error',
      comment:
        'scheduler/** 只能 import shared/** 與 modules/<大目錄>/index.ts（後端規範 §0.6.4、§0.6.6、' +
        '§8）：排程器和一般模組外部呼叫者一樣，只能透過對方的公開介面。',
      from: { path: '^apps/api/src/scheduler/' },
      to: {
        path: '^apps/api/src/modules/',
        pathNot: '^apps/api/src/modules/[^/]+/index\\.ts$',
      },
    },
    {
      name: 'scheduler-only-importable-by-entry-point',
      severity: 'error',
      comment:
        'scheduler/** 的合法 import 者只有 apps/api/src/index.ts（後端規範 §0.6.4、§8）。這條加上 ' +
        '「index.ts 不得被任何檔案 import」，就是「一個程序一個排程器」的結構性保證：能啟動它的地方 ' +
        '只有一處，而那一處一個程序只執行一次。排程器自己的單元測試除外——它必須直接 import 被測的 ' +
        '排程器檔案才測得到，這與「入口只能被自己的測試 import」是每一層都有的必要開口。',
      from: {
        pathNot: '(^apps/api/src/index\\.ts$|^apps/api/src/scheduler/.*\\.test\\.ts$)',
      },
      to: { path: '^apps/api/src/scheduler/' },
    },

    // ===== §0.6.6：頂層目錄之間的完整依賴方向表 =========================================
    {
      name: 'db-only-shared',
      severity: 'error',
      comment: 'db/ 只能 import db/、shared/（後端規範 §0.6.6 依賴方向表、§8）。',
      from: { path: '^apps/api/src/db/' },
      to: { path: '^apps/api/src/(http|modules|scheduler|app)/' },
    },
    {
      name: 'app-no-scheduler',
      severity: 'error',
      comment:
        'app/ 不得 import scheduler/（後端規範 §0.6.6 依賴方向表、§8）。組裝點與排程器都由 ' +
        'index.ts 各自呼叫，兩者之間沒有依賴——讓 app/ 認得排程器，等於把 §0.6.2 的副作用邊界往 ' +
        'app/ 這一側挪一格。',
      from: { path: '^apps/api/src/app/' },
      to: { path: '^apps/api/src/scheduler/' },
    },
    {
      name: 'app-modules-only-via-index-or-routes',
      severity: 'error',
      comment:
        'app/ 對 modules/ 只能 import 對方大目錄的 index.ts 或 routes.ts（後端規範 §0.6.6 依賴方向 ' +
        '表、§8）：組裝點的工作是「接線」，不是拿到模組的內部細節。',
      from: { path: '^apps/api/src/app/' },
      to: {
        path: '^apps/api/src/modules/',
        pathNot: '^apps/api/src/modules/[^/]+/(index|routes)\\.ts$',
      },
    },
    {
      name: 'modules-no-scheduler',
      severity: 'error',
      comment: 'modules/ 不得 import scheduler/（後端規範 §0.6.6 依賴方向表、§8），沒有測試例外。',
      from: { path: '^apps/api/src/modules/' },
      to: { path: '^apps/api/src/scheduler/' },
    },
    {
      name: 'modules-no-app-except-tests',
      severity: 'error',
      comment:
        'modules/ 不得 import app/，唯一的例外是 modules/**/__tests__/**（後端規範 §0.6.6：' +
        '「端點測試要驗的正是這支端點掛在哪個認證群組上會怎樣，而群組只存在於組裝點」）。非測試檔 ' +
        '沒有這個開口，否則模組就能繞過 index.ts／routes.ts 直接碰組裝細節。',
      from: {
        path: '^apps/api/src/modules/',
        pathNot: '(/__tests__/|\\.test\\.ts$)',
      },
      to: { path: '^apps/api/src/app/' },
    },
  ],

  options: {
    // 只在本地相依圖上跑；node_modules 內部彼此的相依不必分析，也拖慢掃描。
    doNotFollow: { path: 'node_modules' },
    // 見檔頭：刻意不開，型別限定匯入（import type）不會被追蹤到，理由與代價寫在檔頭。
    tsPreCompilationDeps: false,
  },
}
