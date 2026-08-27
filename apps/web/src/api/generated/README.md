# `api/generated/`（產生物，不進版控）

這個目錄由 `bun run gen:api` 產生：**後端 OpenAPI → 前端型別與 API client**
（後端規範 §1.7、前端規範 §3.2）。

## 規則

- **目錄內容不進版控**，`.gitignore` 已排除 `apps/web/src/api/generated/`。
  進版控後必然出現「忘了重跑」的髒 diff，review 時也分不出哪些行是人改的、哪些是機器產的。
- **禁止手動修改產生物**——改了下次重跑就沒了。
- **禁止在前端手寫描述 API 形狀的 `interface` / `type`**（§3.2）。手寫 DTO 的本質是把後端契約
  複製一份；後端把某個單一欄位改成一張關聯表之後，前端那份副本仍然編譯得過，
  錯誤延後到執行期畫面顯示 `undefined` 才爆，而且爆在離改動最遠的地方。
- **`api/` 底下只允許 `generated/`**（§0.10）：不建立手寫的 `api/<領域>/*.api.ts` 包裝樹。
  所有端點都是 `POST`、無路徑參數、無 query，產生的 client 函式簽章已經統一、
  回傳型別已經收窄，再包一層換到的是零。
- **產生器的 fetcher 必須注入 `src/shared/api/client.ts`**（§3.1），禁止使用預設 fetcher。
  用預設 fetcher 的請求會繞過 token 附加、single-flight refresh、envelope 拆解與 `code` 分支，
  而且在本機開發時完全看不出來——refresh 那條路徑要等兩、三個小時後才走得到。

## 目前狀態

**`gen:api` 尚不存在**：後端的路由還沒掛上組裝點，因此還產不出 `openapi.json`。

在那之前，登入／登出／換票的請求與回應形狀**就地寫在 `src/shared/api/sessions.ts`
與 `src/shared/api/client.ts` 內**，並在該處標記為暫時。要換掉的清單列在 `sessions.ts` 檔頭。
