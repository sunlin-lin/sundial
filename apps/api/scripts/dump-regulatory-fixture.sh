#!/usr/bin/env bash
# 把開發資料庫裡的法規資料匯出成備份檔（`bun run db:dump-regulatory`）。
#
# **為什麼要有這支：** 法規資料（40 個版本、7463 筆、約 2.3 MB）是八支解析器實際去八個
# 政府網站抓回來的，不是 migration 種的。開發過程中只要有人把開發庫清掉重跑 migration，
# 這批資料就跟著消失，而補回來要再打八個政府端點一次——慢、耗資源、而且政府端點不該被
# 我們的開發流程反覆敲。
#
# **為什麼不做成 migration：** migration 不可修改（後端規範 §4.1），而這批資料是新寫的
# 解析器產出的——日後發現某支解析錯了，migration 裡的錯資料永遠改不掉，只能再發一支去修。
# 而且 migration 會在正式環境也跑，等於把某一天的快照凍進每一個環境。備份檔達成同樣效果
# （不必重抓），又可以隨時重新產生。
#
# 產物 `apps/api/fixtures/regulatory-dev.sql` **不進版控**：3.4 MB 的外部資料快照放進 git
# 會永久留在歷史裡，而它本來就是可以重新產生的東西。乾淨 clone 的人第一次跑同步即可。
set -euo pipefail

cd "$(dirname "$0")/../../.."

CONTAINER="${DB_CONTAINER:-sundial-mariadb-dev}"
OUTPUT="apps/api/fixtures/regulatory-dev.sql"

# 密碼從 .env 讀，不寫死也不要求呼叫端先 export。
ROOT_PASSWORD="$(grep '^DB_ROOT_PASSWORD=' .env | cut -d= -f2-)"
DB_NAME="$(grep '^DB_NAME=' .env | cut -d= -f2-)"

mkdir -p "$(dirname "$OUTPUT")"

# `--no-create-info`：只要資料，不要 CREATE TABLE——表結構的唯一來源是 migration，
# 備份檔裡再放一份會在兩者不一致時安靜地蓋掉正確的結構。
# `--complete-insert`：欄位名寫進 INSERT，日後欄位順序變了不會錯位。
docker exec "$CONTAINER" sh -c \
  "mariadb-dump -uroot -p'${ROOT_PASSWORD}' --no-create-info --complete-insert --single-transaction \
   '${DB_NAME}' regulatory_dataset_versions regulatory_records regulatory_sync_logs" \
  > "$OUTPUT"

echo "已匯出法規資料備份：${OUTPUT}（$(du -h "$OUTPUT" | cut -f1)）"
