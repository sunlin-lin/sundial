#!/usr/bin/env bash
# 從備份檔還原法規資料（`bun run db:restore-regulatory`）。
#
# **開發庫的法規資料沒了的時候用這支，不要重跑同步。** 重抓要打八個政府端點，慢、耗資源，
# 而且政府端點不該被我們的開發流程反覆敲。備份怎麼來的、為什麼不做成 migration，
# 見 `dump-regulatory-fixture.sh` 的檔頭。
#
# 還原是**先清空再灌入**（那三張表），不是 upsert：備份檔是一個完整的快照，
# 半灌半留會產生一個既不是備份當時、也不是還原之前的狀態，而那個狀態沒有人能解讀。
# 這三張表都是平台全域資料、不含任何公司資料，清掉不影響公司／員工／角色那一批。
set -euo pipefail

cd "$(dirname "$0")/../../.."

CONTAINER="${DB_CONTAINER:-sundial-mariadb-dev}"
INPUT="apps/api/fixtures/regulatory-dev.sql"

if [ ! -f "$INPUT" ]; then
  echo "找不到備份檔：${INPUT}" >&2
  echo "" >&2
  echo "它不進版控（見 dump-regulatory-fixture.sh 檔頭），所以乾淨 clone 上不會有。" >&2
  echo "取得方式二選一：" >&2
  echo "  1. 有人手上有這個檔案 → 複製過來" >&2
  echo "  2. 跑一次完整同步把資料抓回來，再執行 bun run db:dump-regulatory 產生它" >&2
  exit 1
fi

ROOT_PASSWORD="$(grep '^DB_ROOT_PASSWORD=' .env | cut -d= -f2-)"
DB_NAME="$(grep '^DB_NAME=' .env | cut -d= -f2-)"

# 刪除順序由外鍵決定：records 與 sync_logs 都指向 versions，versions 必須最後刪。
docker exec -i "$CONTAINER" sh -c \
  "mariadb -uroot -p'${ROOT_PASSWORD}' '${DB_NAME}' -e \
   'DELETE FROM regulatory_records; DELETE FROM regulatory_sync_logs; DELETE FROM regulatory_dataset_versions;'"

docker exec -i "$CONTAINER" sh -c "mariadb -uroot -p'${ROOT_PASSWORD}' '${DB_NAME}'" < "$INPUT"

docker exec "$CONTAINER" sh -c \
  "mariadb -uroot -p'${ROOT_PASSWORD}' '${DB_NAME}' -e \
   'SELECT COUNT(*) AS 版本數, SUM(record_count) AS 筆數 FROM regulatory_dataset_versions;'"

echo "已從 ${INPUT} 還原法規資料。"
