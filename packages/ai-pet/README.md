# @my-page/ai-pet

独立 React 19 AI 向导包：聊天面板、SSE、网站卡片、追问与可选 React Three Fiber 纸宠物模型。没有主页源码、作者域名或服务端密钥依赖。

## 普通 React 网站接入

先安装本仓库生成的 tgz（当前未发布到 npm），项目自身需要 React / ReactDOM 19。

```sh
npm install ./my-page-ai-pet-0.1.0.tgz
```

```tsx
import { AiPet } from '@my-page/ai-pet';
import '@my-page/ai-pet/style.css';

<AiPet endpoint="https://ai.example.com/api/ai/chat" />
```

默认在右下角提供可点击向导入口与对话面板，不要求宿主使用 Tailwind。后端通过 `ALLOWED_ORIGINS` 允许网站域名；配置请求默认将 endpoint 末尾 `/chat` 替换为 `/config`，也可传 `configEndpoint`。欢迎语、问题和卡片自动读取服务端公开配置；props 的 `greeting`、`welcomeQuestions`、`sites`、`siteOrigin` 可以覆盖。

## 现有 3D 场景接入

`@my-page/ai-pet/three` 导出 `PaperPet`，依赖宿主的 Three.js 0.182、R3F 9、Drei 10；主入口不会自动导入 Three.js。

主入口导出 `usePaperPet(enabled, onSceneActions, options)`、`PaperPetReply`、`PaperPetTrigger`。现有场景可以继续提供纸纹/木纹、位置和 portal。面板传入 hook 返回的 `sites`、`siteOrigin` 与其他状态。3D 模型只消费状态，不控制相机。

场景操作默认关闭；传 `sceneActions: true` 才协商协议。具体行为必须由宿主的白名单回调实现，只有成功 done 后才提交；离场/卸载/切换服务地址中止请求。关闭面板保留当前生成。

纯协议、网络与卡片工具分别通过 `/protocol`、`/client`、`/site-cards` 导出，后端只导入 `/protocol`。

## 维护和打包

在本目录执行 `npm ci`、`npm run build`、`npm test`、`npm run pack:release`。最后一个命令生成 `../../vendor/my-page-ai-pet-<版本>.tgz`；发布新版本后分别更新后端和使用方锁文件，不自动覆盖其他仓库。
