#!/usr/bin/env bash
# 轉檔 + 抽 poster + 上傳 R2。
#
#   scripts/media/encode-video.sh <來源> <id>
#
# 例：scripts/media/encode-video.sh ~/Downloads/'Metal Dome Ski Touring.mp4' metal-dome
set -euo pipefail

IN="${1:?需要來源檔}"
ID="${2:?需要 id（小寫連字號）}"
BUCKET="${R2_BUCKET:-zhuiyunzhuxue-media}"
OUT="$(mktemp -d)/${ID}"
mkdir -p "$OUT"

# 已經編好的檔不要重編 —— 用 crf 21 重編一支 32MB 的 H.264 會變成 61MB。
# 只有在編碼/像素格式/解析度不合時才真的轉。
VCODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$IN")
PIXFMT=$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 "$IN")
WIDTH=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$IN")
ACODEC=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$IN" || echo none)

if [ "$VCODEC" = "h264" ] && [ "$PIXFMT" = "yuv420p" ] && [ "$WIDTH" -le 1920 ] \
   && { [ "$ACODEC" = "aac" ] || [ "$ACODEC" = "none" ]; }; then
  echo "→ 已是相容的 H.264/AAC，只做 remux（無損、瞬間）"
  ffmpeg -hide_banner -loglevel error -y -i "$IN" -c copy -movflags +faststart "$OUT/1080p.mp4"
else
  echo "→ 重新編碼（codec=$VCODEC pix=$PIXFMT w=$WIDTH audio=$ACODEC）"
  ffmpeg -hide_banner -loglevel error -y -i "$IN" \
    -c:v libx264 -profile:v high -level 4.1 -preset slow -crf 23 \
    -vf "scale='min(1920,iw)':-2" \
    -c:a aac -b:a 128k -ac 2 \
    -movflags +faststart \
    -pix_fmt yuv420p \
    "$OUT/1080p.mp4"
fi
#   -movflags +faststart：把 moov atom 移到檔頭，否則要下載完才能播
#   -pix_fmt yuv420p    ：確保 Safari / iOS 相容

SRC_BYTES=$(stat -f%z "$IN" 2>/dev/null || stat -c%s "$IN")
NEW_BYTES=$(stat -f%z "$OUT/1080p.mp4" 2>/dev/null || stat -c%s "$OUT/1080p.mp4")
# remux 會因為 moov 搬家多出幾十 KB，那是正常的；只有明顯變大才值得警告
if [ "$NEW_BYTES" -gt $(( SRC_BYTES * 105 / 100 )) ]; then
  echo "⚠ 產物 ($((NEW_BYTES/1048576))MB) 比原檔 ($((SRC_BYTES/1048576))MB) 大 —— 檢查編碼參數"
fi

echo "→ 抽 poster"
ffmpeg -hide_banner -loglevel error -y -i "$OUT/1080p.mp4" -ss 00:00:02 -frames:v 1 -q:v 3 "$OUT/poster.jpg"

BYTES=$(stat -f%z "$OUT/1080p.mp4" 2>/dev/null || stat -c%s "$OUT/1080p.mp4")
SECS=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/1080p.mp4" | cut -d. -f1)
DIM=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$OUT/1080p.mp4")

echo "→ 上傳 R2（$BUCKET）"
for f in 1080p.mp4 poster.jpg; do
  npx --no-install wrangler r2 object put "$BUCKET/video/$ID/$f" \
    --file "$OUT/$f" --remote \
    --cache-control "public, max-age=31536000, immutable"
done

cat <<EOF

完成。把 poster 放進內容資料夾，然後建條目：

  src/content/reel/${ID}.yaml
  ---
  title: '…'
  id: ${ID}
  poster: ./poster.jpg      # 從 $OUT/poster.jpg 複製過去
  posterAlt: '…'
  duration: ${SECS}
  bytes: ${BYTES}
  ratio: '16/9'             # 實際 ${DIM}
  realm: snow               # run | snow | road | wild
  date: YYYY-MM-DD

檔案暫存在：$OUT
EOF
