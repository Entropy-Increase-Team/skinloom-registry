## 提交概览 (Submission Summary)

- **扩展 ID (`id`)**: ``
- **类型 (`kind`)**: `plugin` / `theme`
- **运行时 (`runtime`)**: `js` (Tier 1 轻量沙箱) / `native` (Tier 2 系统原生 Go)
- **变更性质**: 首次上架 / 版本升级 (`vX.Y.Z`) / 撤回 (`yanked`) / 安全阻断 (`blocked.yaml`)
- **源码仓库与固定 Commit SHA**: `https://github.com/<org>/<repo>/commit/<40-hex-sha>`

---

## 权限与安全说明 (Permissions & Security Justification)

> 若本次提交包含首次申请或新增的**敏感权限 (`sensitive`)** 或**高危权限 (`high_risk` / `native.exec` / `storage.sql` / `http.stream`)**，请在此逐条说明用途：

- 

---

## 提交者自检清单 (Author Checklist)

- [ ] `manifests/<id>.yaml` 中的 `commit` 为完整的 40 位小写十六进制 Git Commit SHA（非分支名或可变 Tag）。
- [ ] 目标 Commit 下的 `plugin.json`（及主题的 `theme.json`）中的 `id`、`kind`、`runtime`、`version`、`permissions` 与本清单完全一致。
- [ ] 已在本地运行 `node scripts/validate-manifests.mjs` 且零报错通过。
- [ ] 已在插件/主题仓库运行 `npx skinloom-plugin lint` 与 `npx skinloom-plugin build`（原生插件已测试 `CGO_ENABLED=0` 编译与 `go test ./...`）且全部通过。
- [ ] 仓库根目录包含开源许可证（如 MIT / Apache-2.0），且无任何混淆代码、远程未签名脚本加载或违规隐私回传逻辑。
