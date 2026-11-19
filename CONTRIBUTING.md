# 插件与主题上架贡献指南 (Contributing Guide)

感谢你为 SkinLoom 生态贡献插件或主题！在向 `skinloom-registry` 提交 Pull Request 前，请仔细阅读并遵守以下规范。

---

## 一、 准入基本要求

1. **开源许可证**：提交的插件或主题仓库必须采用 OSI 认可的开源许可证（推荐 `MIT`、`Apache-2.0` 或 `BSD-3-Clause`），并在仓库根目录提供 `LICENSE` 文件。
2. **固定 Commit SHA**：`manifests/<id>.yaml` 中每个版本（`releases[*]`）的 `commit` 字段必须填写**完整的 40 位小写十六进制 Git Commit SHA**（严禁填写分支名或可变 Tag 代替 SHA）。
3. **清单一致性**：目标仓库对应 Commit 中的 `plugin.json`（及主题的 `theme.json`）声明的 `id`、`kind`、`runtime`、`version`、`apiVersion`、`permissions` 必须与 `manifests/<id>.yaml` 完全一致。
4. **本地通过校验**：
   - 在你的插件仓库中运行 `npx skinloom-plugin lint` 与 `npx skinloom-plugin build` 无报错；
   - 在本仓库运行 `node scripts/validate-manifests.mjs` 无报错。

---

## 二、 双轨运行时选择规范（Tier 1 vs Tier 2）

- **优先使用 Tier 1 轻量沙箱（`runtime: "js"`，默认）**：
  - 适用于注册/登录拦截（Guard）、积分签到、通知邮件、外部 OAuth/OIDC 登录、Webhook、自定义前后端页面与插槽。
  - 运行在宿主内置 QuickJS/WASM 沙箱中，全平台通用（`any`），无需交叉编译，审核速度最快。
- **仅在必要时使用 Tier 2 系统原生（`runtime: "native"`）**：
  - 适用于需要独立关系型数据库建表与复杂 SQL 迁移（`storage.sql`）、本地流式 HTTP/SSE/WebSocket 反向代理（`http.stream`）、重度 CPU 计算或替换底层存储/搜索/渲染驱动（`provider.*`）的系统级插件。
  - 必须基于官方 Go SDK（`github.com/Entropy-Increase-Team/skinloom/sdk/go`）编写，且保证能在 `CGO_ENABLED=0` 下跨平台编译（`linux/amd64`、`linux/arm64`、`windows/amd64`、`darwin/arm64`、`darwin/amd64`）。

---

## 三、 权限最小化与安全红线

1. **最小权限原则**：仅在 `permissions` 中申请插件实际调用的宿主权限，并在 PR 描述中逐项说明敏感（`sensitive`）与高危（`high_risk`）权限的业务用途。
2. **严禁行为（一经发现立即拒绝或拉入 `blocked.yaml` 全网熔断）**：
   - 未经站点管理员显式配置，私自向第三方服务器回传用户隐私数据（邮箱、密码哈希、会话令牌、IP 等）；
   - 在 `runtime: "native"` 插件中绕过 `plugindb` 访问宿主核心表（如 `users`、`sessions`、`settings`），或监听非本地回环地址暴露未授权端口；
   - 包含混淆代码、动态拉取远程未签名可执行文件/脚本（Remote Code Execution）、挖矿或后门逻辑；
   - 在前端包（`web/index.js`）中使用硬编码颜色破坏宿主 Design Token 或篡改不属于自身插槽的宿主 DOM。

---

## 四、 提交流程

1. Fork 本仓库并新建分支（如 `feat/add-my-plugin` 或 `chore/bump-my-plugin-1.1.0`）。
2. 新增或编辑 `manifests/<id>.yaml`（新版本请插入到 `releases` 数组最上方，保留历史版本记录以便旧版宿主兼容安装）。
3. 运行 `node scripts/validate-manifests.mjs` 确认通过。
4. 发起 Pull Request 并完整填写 PR 模板中的勾选清单。
