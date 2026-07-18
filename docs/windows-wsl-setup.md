# Windows + WSL2 Ubuntu 22.04 开发环境

## 环境目标

- Windows 用于 Staix 桌面客户端开发。
- WSL2 Ubuntu 22.04 用于运行和验证 MTClaw Function Router。
- 正式交付目标为 Ubuntu 22.04 / MTT AIBOOK AIOS 1.4.2。

## 安装 Ubuntu 22.04

以管理员身份打开 PowerShell：

```powershell
wsl --update
wsl --set-default-version 2
wsl --list --online
wsl --install --distribution Ubuntu-22.04
```

如果下载停在 0% 或 Microsoft Store 下载失败：

```powershell
wsl --install --web-download --distribution Ubuntu-22.04
```

按提示重启 Windows。第一次启动 Ubuntu 时创建 Linux 用户名和密码。

## 验证

在 PowerShell 中运行：

```powershell
wsl --list --verbose
wsl --distribution Ubuntu-22.04 -- bash -lc "cat /etc/os-release && uname -m && python3 --version"
```

预期 Ubuntu 版本为 22.04，WSL VERSION 为 2。

## 项目访问

第一阶段继续使用现有 Windows 工作区，WSL 通过挂载路径访问：

```bash
cd /mnt/d/codexProject/staix-mtclaw-correct-architecture
```

MTClaw 和所有 Linux 服务必须从 WSL 执行。不要在业务代码中写死 `/mnt/d`、`D:\` 或 `C:\`，路径通过环境变量传入。

## WSL 基础依赖

进入 Ubuntu 后运行：

```bash
sudo apt update
sudo apt install -y bash curl git jq python3 python3-pip python3-venv build-essential
```

Node.js 版本应与仓库要求一致，安装 Node 20 或更高版本。具体安装方式在确认 WSL 安装成功后执行，避免 Windows Node 与 WSL Node 混用。

## 后续验证

完成 WSL 安装后依次验证：

```bash
mkdir -p ~/.venvs
python3 -m venv ~/.venvs/staix-mtclaw
source ~/.venvs/staix-mtclaw/bin/activate

cd /mnt/d/codexProject/staix-mtclaw-correct-architecture/MTClaw
python -m pip install --upgrade pip
python -m pip install -e '.[test]'
```

把虚拟环境放在 Linux 用户主目录可以避免 `/mnt/d` 上的权限、符号链接和文件系统性能差异。创建虚拟环境不会重新安装 Python 3，只会创建隔离的解释器入口和包目录。后续进入新的 WSL 终端时重新执行：

```bash
source ~/.venvs/staix-mtclaw/bin/activate
```

运行测试和启动 Function Router 前，还需要创建仅供本机使用的环境变量与配置文件。不得提交真实 API 密钥。
