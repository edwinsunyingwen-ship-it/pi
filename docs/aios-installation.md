# Staix on Ubuntu / MTT AIBOOK AIOS

## 目标

交付包保持唯一运行链路：

```text
Staix -> pi-agent Runtime -> MTClaw Function Router -> pi-agent Subagent
```

安装过程不写入模型、OCR、MCP 或 qcc 凭据，也不复制开发机的私有配置。

## 构建

Linux 包必须在对应架构的 Linux 环境构建，避免把 Windows 原生 Node 依赖复制进 Linux 包。

```bash
npm ci
npm run linux:dist
```

产物位于：

```text
packages/windows-client/release/Staix-1.0.0-<arch>.AppImage
packages/windows-client/release/Staix-1.0.0-<arch>.deb
```

## 安装

先执行不写入任何文件的环境检查：

```bash
./scripts/install-staix-aios.sh --preflight-only
```

预期结论：

```text
STAIX_AIOS_PREFLIGHT=PASS
```

在仓库根目录执行：

```bash
chmod +x scripts/install-staix-aios.sh
./scripts/install-staix-aios.sh --package packages/windows-client/release/Staix-1.0.0-<arch>.AppImage
```

安装器完成以下工作：

1. 检查 Linux、CPU 架构、Python、Node.js 20+ 和 npm。
2. 安装 Staix AppImage 或 DEB。
3. 在用户目录创建隔离的 MTClaw Python 环境。
4. 安装 `staix-mtclaw-router.service` 用户服务；仅在私有 Router 配置存在时启动。
5. 安装固定版本的 `qcc-agent-cli`，但不写入授权 Token。

## 首次配置边界

以下内容必须在目标机由使用者通过 Staix 配置，不进入源码或安装包：

- 路由模型与回答模型的 API Key；
- 元典 MCP Key；
- 合合 OCR 的 `OCR_APP_ID` 与 `OCR_SECRET_CODE`；
- qcc Authorization；
- 任何目标企业、案件材料或演示数据。

当前安装脚本不会替代 Staix 配置中心，也不会调用 MTClaw 的 OpenClaw 安装流程。Router 私有配置尚不存在时，用户服务保持未启动状态。

首次启动 Staix 后：

1. 在“模型配置”中配置并测试一个 OpenAI Chat Completions 兼容的路由模型和一个回答模型。
2. 在“智能体配置”中确认专业子智能体已启用 MTClaw 自动路由。
3. 打开“MTClaw Router”，勾选“由 Staix 管理本机 Router 配置（Linux / AIOS）”。
4. 选择路由模型、回答模型和监听端口，保存配置。
5. Staix 会生成 `~/.function-router/config.json` 与 `functions.jsonl`，权限分别固定为 `600`，并尝试启动 `staix-mtclaw-router.service`。

上述 Router 文件是 Staix 界面配置的运行时投影，不是需要用户维护的第二套配置。

## 目标机验收

```bash
uname -a
node --version
python3 --version
qcc --version
systemctl --user status staix-mtclaw-router.service --no-pager
curl -fsS http://127.0.0.1:18790/health
curl -fsS http://127.0.0.1:18790/ready
```

验收必须再覆盖三个专业子智能体的真实工具调用与 Router 追踪，不能只以服务进程存在作为通过依据。
