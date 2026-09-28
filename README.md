# 104my-ai

独立 AI 服务和可安装宠物前端包；不需要 3D 页面仓库即可开发、运行、构建。

## 后端

Node.js 24：`npm ci`，复制 `.env.example` 为 `.env`，填写模型网关、Key、模型名，然后 `npm run dev`。生产 `npm run build`、`npm start`，或 `docker compose up -d --build`。默认宿主端口只监听回环，公网由自己的 HTTPS 反向代理暴露。

- `ALLOWED_ORIGINS`：允许接入的网页完整 Origin，逗号分隔，例如 `https://www.example.com,http://localhost:5173`；不使用 `*`。
- `src/site.config.json`：本项目默认网站资料、欢迎语、首轮问题和公开卡片；其他使用者修改此配置，不改组件或模型代码。
- `SITE_CONFIG_FILE`：可选外部 JSON 配置文件，结构同上；容器使用时自行只读挂载到该路径。未指定时使用构建内的默认配置。
- 模型配置与 Key 只在后端环境变量，不能放入浏览器或站点 JSON。

`GET /api/ai/config` 只返回公开卡片和欢迎语，不返回提示词或模型配置。`POST /api/ai/chat` 使用 ready/token/done/error SSE，代理必须关闭缓冲，保留取消连接。`GET /health` 用于健康检查，不调用真实模型。

默认 2 个并发、每分钟 20 次、60 秒超时，仍需自己的公网入口限流。配置白名单不是用户鉴权。场景能力通过显式请求头协商，行为由消费端回调执行。

## 安装宠物

完整接入见 [packages/ai-pet/README.md](packages/ai-pet/README.md)。普通 React 网站安装包后挂载 `<AiPet endpoint="https://ai.example.com/api/ai/chat" />`；现有 3D 页面从 `/three` 使用纸宠物模型。

`vendor/` 保存已构建的版本化 tgz；后端通过该包 `/protocol` 复用协议，`npm ci` 不需要先构建前端，也不读取相邻项目。当前包未发布到 npm。

修改包：在 `packages/ai-pet` 执行 `npm ci`、`npm run build`、`npm test`、`npm run pack:release`；然后在根目录 `npm install ./vendor/<新版本包>.tgz`。使用方自行复制并升级安装包，不建立跨仓库 file 链接。

验证：`npm run typecheck`、`npm test`、`npm run build`。测试只访问本地模拟模型，不消耗真实额度。

`.github/workflows/3dpageai-cicd.yml` 是本仓库独立 CI/CD。其中 `.github/deploy/deploy.sh` 保留原站点服务器名称与网络作为兼容发布；任意新环境使用本仓库 compose 和自己的代理即可。仓库上传默认只执行 CI，线上部署需显式开启。

## GitHub 与提交历史

仓库：<https://github.com/neo-jack/aiPet>（私有）。独立仓库主分支为 master，从整理后的项目初始提交开始维护；拆分前历史保存在本机项目归档中。CI 自动检查，只有仓库变量 `DEPLOY_ENABLED=true` 才执行镜像发布及服务器部署。npm 包发布仍单独维护。
