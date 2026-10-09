# ---- 构建阶段：安装构建工具编译 better-sqlite3 原生模块 ----
FROM node:22-slim AS builder

# 统一时区：Node 内置 ICU 会直接读取 TZ，容器默认 UTC 会让
# toLocaleDateString('zh-CN') 把北京时间 0—8 点发的文章显示成前一天
ENV TZ=Asia/Shanghai

# better-sqlite3 编译需要 python3/make/g++
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制依赖清单，利用 Docker 缓存层
COPY package.json package-lock.json ./
RUN npm ci

# 复制源码并构建 Astro SSR 产物
COPY . .
RUN npm run build

# 移除开发依赖（tsx 已挪到 devDependencies：运行时不再需要它，
# server.mjs 现在直接 import 构建阶段预编译好的 dist/server/lib/index.mjs）
RUN npm prune --omit=dev

# ---- 运行阶段：精简镜像 ----
FROM node:22-slim AS runner

# OG 分享图动态生成（SVG→PNG）需要中文字体
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
# 时区：容器默认 UTC，而全站日期用 toLocaleDateString('zh-CN') 在服务端渲染，
# 不改这里的话北京时间 00:00–08:00 发布的文章会显示成前一天
ENV TZ=Asia/Shanghai
# Railway 持久卷挂载点；数据库文件存放在持久磁盘上
ENV DB_PATH=/data/blog.db

# 复制生产依赖（含已编译的 better-sqlite3 原生二进制）与构建产物
# dist 里已包含预编译好的 server 工具模块（dist/server/lib/index.mjs），
# 因此运行阶段不再需要源码目录 src/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.mjs ./server.mjs
COPY --from=builder /app/dist ./dist

# Railway 会自动注入 PORT 环境变量，此处仅为本地 docker 运行提供默认值
EXPOSE 4321

# 容器级健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
