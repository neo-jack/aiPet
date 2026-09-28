# aiPet

使用 TypeScript、Hono 和 LangChain 构建的 AI 服务，配套可安装的 React 宠物组件，支持流式对话、网站卡片与后续追问。

前端通过组件包和服务地址接入；网站资料、模型与访问域名由后端配置。

## 在线体验

[打开 3D 主页体验 AI 向导](https://www.lanbinquan.top/)

在桌面浏览器中点击入口旁的纸艺宠物。

## 快速开始

使用 Node.js 24。

```bash
git clone https://github.com/neo-jack/aiPet.git
cd aiPet
npm ci
```

复制 `.env.example` 为 `.env`，填写 `SUB2API_BASE_URL`、`SUB2API_API_KEY` 和 `SUB2API_MODEL`，通过 `ALLOWED_ORIGINS` 配置接入网站的域名。网站资料在 `src/site.config.json` 中维护，密钥仅保存在后端。

```bash
npm run dev
```

本地服务默认监听 `http://127.0.0.1:3001`。组件接入见 [宠物组件说明](packages/ai-pet/README.md)，当前通过仓库内的安装包分发，尚未发布到 npm。

## 构建与验证

在仓库根目录执行：

```bash
# 检查后端类型并运行本地模拟模型测试
npm run typecheck
npm test

# 生成后端构建产物
npm run build

# 构建与验证宠物组件包
npm ci --prefix packages/ai-pet
npm run build --prefix packages/ai-pet
npm test --prefix packages/ai-pet
```
