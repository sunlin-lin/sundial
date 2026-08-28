/**
 * 語系檔：zh-TW × `modules/regulatory/`（§1.3、§1.8.2）。
 *
 * 形狀與 key 的推導規則見同目錄的 `sessions.ts` 檔頭：次目錄 → 類別 → 訊息名，
 * 對應 `modules/regulatory/datasets/`，因此這一批 key 都長成 `regulatory.datasets.errors.*`。
 *
 * ⚠️ **本檔只有「字」，規格在 `modules/regulatory/datasets/regulatory-datasets.errors.ts`。**
 * 改字之前請先讀那一頁——尤其是「這一則錯誤有兩個形狀不同的呼叫者」那一段。
 */

export const REGULATORY = {
  datasets: {
    errors: {
      /**
       * 該基準日沒有適用版本。
       *
       * ⚠️ 訊息**不提「請改用今天」或任何替代基準日的建議**：基準日是法規適用日，
       * 換一個日期等於換一套法規（實作計畫 §4.2）。正確的處置是去補那一段期間的資料，
       * 而不是挑一個查得到的日期。
       *
       * 句子裡刻意不插入 `{{asOfDate}}`：那個值已經在 `errors[].data` 裡（連同 `datasetCode`），
       * 前端要顯示就從那裡取——訊息插值另外需要一份參數宣告（`MESSAGE_PARAM_SPECS`），
       * 而多一份宣告就多一個「句子與宣告對不上」的失效點。
       */
      'no-effective-version': '該法規適用基準日沒有可用的版本資料',
    },
  },
} as const
