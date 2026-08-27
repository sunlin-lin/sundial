/**
 * 語系檔：zh-TW × `modules/sessions/`（§1.3、§1.8.2）。
 *
 * **一個大目錄一個檔案，檔案內部按「次目錄 → 類別 → 訊息名」分層**，與 `modules/sessions/main/`
 * 的目錄結構逐段對應。訊息 key 因此是機械推導的結果：`sessions.main.errors.invalid-credentials`
 * ——不必為每一則訊息想一個領域名，也就不會有人想出兩個不一樣的名字給同一件事。
 *
 * `errors` 只是**類別之一**。之後要加欄位標籤、成功訊息、確認提示時，在 `main` 底下再開一個類別
 * （`fields`、`success`…），既有的 key 一個都不用動——這正是「類別」這一段存在的理由：
 * 沒有它的話，第一則非錯誤訊息要嘛硬塞進 `errors`，要嘛得把全部 key 改成五段。
 *
 * ⚠️ **本檔只有「字」，沒有邏輯，而且這一則是刻意含糊的**（§3.2）：登入失敗不分辨四種原因。
 * **理由寫在 `modules/sessions/main/sessions-main.errors.ts`，不在這裡**——在這一頁把訊息
 * 「寫精確一點」看起來只是潤稿，實際上是把公司名單與帳號名單變成一支可枚舉的介面。
 */

export const SESSIONS = {
  main: {
    errors: {
      /**
       * ⚠️ 刻意含糊：公司代號不存在／帳號不存在／密碼錯誤／帳號不屬於這家公司，**四種一律這一句**。
       * 寫精確等於把登入端點變成公司名單與帳號名單的枚舉介面（§3.2，理由見 `sessions-main.errors.ts`）。
       */
      'invalid-credentials': '公司代號、帳號或密碼錯誤',
    },
  },
} as const
