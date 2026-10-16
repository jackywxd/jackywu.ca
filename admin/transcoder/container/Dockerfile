# 轉碼容器：只有 ffmpeg 與一支 Node 腳本。沒有任何雲端憑證；
# 輸入輸出全走後台給的簽章網址，所以容器被入侵也只能動這一支影片。
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY transcode.mjs server.mjs ./
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
