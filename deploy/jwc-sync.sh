#!/usr/bin/env bash
# 教务课表定时同步：在容器里跑抓取脚本并推送到站点
set -uo pipefail
cd /opt/krivy-blog
STAMP=$(date '+%F %T')

TOKEN=$(grep '^SCHEDULE_TOKEN=' .env 2>/dev/null | cut -d= -f2)
if [ -z "$TOKEN" ]; then
  echo "[$STAMP] FAIL 没有 SCHEDULE_TOKEN"
  exit 1
fi

OUT=$(docker compose exec -T -w /data/jwc \
  -e SCHEDULE_TOKEN="$TOKEN" \
  -e JW_TERM="2026-2027 学年第 1 学期" \
  -e JW_START_DATE="2026-08-31" \
  -e JW_TOTAL_WEEKS="20" \
  blog node jwc-schedule.mjs --push 2>&1)
RC=$?

if [ $RC -ne 0 ]; then
  echo "[$STAMP] FAIL 同步失败（cookie 过期？需重新登录后上传 .jwc-session.json）"
  echo "$OUT" | tail -5
  exit $RC
fi

SAVED=$(echo "$OUT" | grep -o '"saved":[0-9]*' | head -1 | cut -d: -f2)
echo "[$STAMP] OK 同步成功 saved=${SAVED:-未知}"
