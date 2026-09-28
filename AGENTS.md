## 104my-ai

独立 Git 仓库，包含 TypeScript / Hono / LangChain 后端和 `packages/ai-pet/` 可安装前端包。后端模型配置与站点资料是本仓库事实来源，不读取主页源码。

**Important:** 密钥只在服务端；保持包协议兼容，前端和后端独立升级。禁止把相邻仓库作为运行或构建依赖。

### Important files

- `src/config.ts`、`.env.example` — 模型配置、资源预算、ALLOWED_ORIGINS 与 SITE_CONFIG_FILE。
- `src/site.config.json`、`src/siteConfig.ts` — 默认站点资料、外部文件校验、公开配置投影；外部 JSON 只读加载。
- `src/app.ts` — CORS 白名单、配置接口、限流与 SSE。
- `src/model.ts`、`src/prompt.ts` — 模型适配与协议要求；网站事实由 Config.site 注入。
- `src/replyFormat.ts` — 只转导已安装包 `/protocol`，唯一实现见 packages/ai-pet。
- `packages/ai-pet/` — 前端包，按其 AGENTS.md 维护。
- `vendor/` — 版本化包产物，是后端可独立 npm ci 的组成部分。
- `test/` — 模拟模型、取消、限流、跨域和公开配置验证。
- `Dockerfile`、`compose.yaml` — 独立部署；`.github/` 维护原站点兼容发布。

### Implementation notes

- `npm ci`、`npm run typecheck`、`npm test`、`npm run build`；包单独构建测试和打包。修改协议后更新 tgz 和 lock，不能仅修改包源码。
- GET `/api/ai/config` 不泄露 instructions、Key 或模型配置。跨域浏览器需要 ALLOWED_ORIGINS 的精确 Origin；OPTIONS 允许 Content-Type / X-Scene-Actions，非法 Origin 返回 403。
- 修改默认网站事实只编辑 src/site.config.json；SiteCard 的 ID、资料和链接由同一服务端配置生成，使用方不复制目录清单。


- 助手自称“AI 向导”或“AI 助手”，提示词与共享网站介绍不使用角色昵称；共享介绍也会直接显示在前端卡片中。
- 公开标题、介绍、回答与追问不使用作者真实姓名；主页卡片 ID 不作为显示名称。公开清单包含 2D 主页、React / Codeground、AItool、前端监控；这些 ID 与介绍以 `src/siteCatalog.ts` 为准。场景占位作品与真实关联项目分开介绍，不将占位状态套用到全部项目。仅人工核对并维护可公开的项目事实，运行时不读取私密汇总或复制其中的后台、网关资料。

- `src/` 下源码统一使用 JSDoc 文件头，以 `@file` 标注当前文件名，以 `@description 中文注释：` 简述文件职责；新增文件或调整职责时同步维护。
- 推荐使用独立的 `SiteCard` 围栏代码块，JSON 严格只有 `id`，由 `prompt.ts` 从共享清单生成规范；名称、URL 和操作不由模型生成。沿用 ready/token/done/error SSE，围栏也是文字流的一部分，不新增卡片接口；前端负责完整围栏与 ID 校验，未知或无效推荐不生成链接。
- “这里有什么”“怎么逛这里”等站点导览需由模型生成当前清单中 owned 为 true 的全部关联网站卡片，校验从清单动态读取，不硬编码已删除 ID。总览正文概括全部自有网站及用途，不能只推荐 2D 主页；总览卡片不受一般推荐的 1–3 张限制，具体主题按相关性选择。提示词不得保留已移除网站的推荐指令；3D 页面操作说明独立于卡片清单维护。后端校验导览卡片以及网站推荐问题的非空卡片；前端不根据关键词或普通文字补卡片。
- 每轮成功回答必须有且只有一个 `FollowUp` 围栏，JSON 仅含 `questions`，为模型生成的 2–3 个不重复问题，每个 2–60 字且无换行。`model.ts` 校验缺失项；只有格式本身有效但漏写时，才把缺失要求和原文交回同一模型补全一次。补全文本先缓冲、校验再发送，共用原请求取消信号和总超时；仍不合法则发送 `INVALID_REPLY_FORMAT`，不能发送 done 或用固定问题降级。网关错误不重试。
- 模型适配器累计回答上限 16000 JS 字符，与前端流解析器一致；补全缓冲上限 8000 字符，合并后仍受总上限约束，不能为格式校验引入无界内存累积。
- 在本目录执行 `npm run typecheck`、`npm test`、`npm run build`；开发用 `npm run dev`，生产本机用 `npm start`。Node.js 24 直接加载可选 `.env`，不依赖 dotenv。
- `GET /health` 和 SSE ready 携带 `replyProtocol: markdown-sites-followups-v1`，用于核对已发布代码版本；health 的 status/chatConfigured 仍只说明进程和配置，不证明模型合规。未配置模型时聊天接口返回 503。
- `POST /api/ai/chat` 接受 1–12 条 user/assistant 文字消息，单条最多 2000 JS 字符、总计 12000 字符、请求体最多 64 KiB，最后一条须为 user。模型、系统设定、输出 token 上限均由服务端配置。
- 使用 `/v1` 等 API 根地址拼接 `/chat/completions`；网关具体分组须支持此协议。LangChain 的通用 `ChatOpenAI` 可根据模型名自动选择 Responses，不能依赖 `useResponsesApi: false` 保证协议不变。
- `MODEL_THINKING_MODE` 支持 `provider`（默认，不发送扩展参数）、`disabled`、`enabled`。生产 DeepSeek 使用 `disabled`，正文和最多一次格式补全均显式发送 `thinking: { type: "disabled" }`；DeepSeek 默认思考，不能只改模型名。未来切换不支持此参数的上游时恢复 `provider`。真实联调核对上游账号/模型、非空 token、done 和卡片/追问；测量首字时排除 ready/心跳。服务器 env-file 修改后重新部署容器，restart 不重载容器环境。
- 默认最多 2 个并发生成、全站每分钟 20 次、60 秒超时；限制只保存在单进程中。并发满时立即返回 429，不排无限队列；公开访问仍需可信入口的访客限流与网关额度。
- SSE 事件为 ready、token（`{text}`）、done 和 error（`{code,message}`）。流开启后的错误仍是 HTTP 200，客户端必须检查终止事件；Nginx 禁止缓冲，客户端离场主动中止 fetch。
- 超时或浏览器断开时，将 AbortSignal 传递给 LangChain 并清理定时器、释放并发名额。测试必须验证真实 HTTP 连接关闭，而非只模拟生成器返回。
- 测试仅使用本地模拟上游与虚拟 key，不从开发 `.env` 或 `.sect/` 取真实凭据，不调用公网模型。生产模型联调另行验证。
- 容器资源预算和功能正常必须分别验证；256 MiB 容器内存及 128 MiB old space 是起始配置，不是已测量的容量承诺。Dockerfile 变更须在 Docker 引擎可用时验证构建和健康检查。

- 新客户端发送 `X-Scene-Actions: v1` 请求头，messages JSON 和原 SSE 协议保持兼容；仅显式协商时 model.ts 附加 SCENE_ACTION_PROMPT，旧客户端禁止输出动作。SceneAction JSON 严格只有 actions，允许 open_scroll/break_glass，最多两项、不得重复、最多一个围栏。仅本轮明确代为操作请求才产生动作，介绍/否定/引用/历史/追问不触发；正文不能提前声称成功。格式补全不允许新增动作，非法或未协商动作以 error 终止；前端仅在 done 后检查当前场景并执行，结果来自页面。部署需要新版前端与后端分别发布，旧后端忽略能力头时仍只能聊天。

- `/health` 返回 sceneActions 白名单；SSE ready 仅在 X-Scene-Actions=v1 时返回相同白名单，否则为空数组。发布后须检查该字段，旧版只有 replyProtocol 无法证明已部署场景动作；健康检查不证明真实模型已正确生成动作，仍需单独验证。询问操作能力时应明确说明支持的两项操作，实际动作仍要求本轮明确执行请求。

- GitHub 远程为 `neo-jack/aiPet`，私有仓库、master 主分支；主分支以独立项目初始提交重建，旧历史保存在本机归档。上传默认仅 CI，部署需仓库变量 DEPLOY_ENABLED=true。
