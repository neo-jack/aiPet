## ai-pet

可独立安装的 React 宠物包，源码与发布包由 AI 仓库维护。主入口是 DOM 向导，`/three` 是可选 R3F 模型，`/protocol` 是无框架协议。

**Important:** 不得导入其他仓库源码或写入个人域名、模型密钥；配置按组件实例传递，不能使用跨实例可变全局配置。场景动作由宿主回调执行。

### Important files

- `src/dom/` — 现有纸张面板、Markdown、卡片及状态 hook；细则见本层子目录说明。
- `src/three/` — 纸宠物模型；不得操作宿主相机。
- `src/AiPet.tsx` — 普通 React 网站可直接挂载的入口。
- `src/replyFormat.ts` — 协议唯一源码，后端使用已安装包的 `/protocol`。
- `src/siteCards.ts` / `src/aiChat.ts` — 显式配置的网站卡片和 SSE 工具。
- `src/style.css` — 包自带 Tailwind 生成样式，不注入全局 preflight。
- `src/assets/paper.webp` — 从原主页迁入的纸纹；库构建发布独立资源供消费端重新哈希，不能内联到 JS 造成重复下载。
- `vite.config.js` / `tsconfig.json` — ES 模块构建及声明输出，React/Three 保持外部 peer，协议入口不得包含浏览器依赖。
- `test/` — SSE、动作、追问、链接及跨实例卡片输入测试。

### Implementation notes

- `npm ci`、`npm run build`、`npm test`；`npm run pack:release` 输出根仓库 vendor。版本更新后重新安装 tarball 并同步后端锁文件，消费仓库独立升级。
- 保留请求取消、过期流隔离、失败不执行动作、模型标记校验；配置端点失败不阻断页面，但未知卡片不可生成链接。
- DOM 样式维护在 JSX className，生成的 CSS 和声明随 dist 打包；README 接入示例必须只需安装包和服务地址。
