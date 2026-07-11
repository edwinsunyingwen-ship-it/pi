# Windows + WSL2 Ubuntu 22.04 开发环境

## 当前检测结果

当前 Windows 已有 WSL 2 平台，但尚未安装默认 Linux 发行版。`wsl --list --verbose` 返回 `WSL_E_DEFAULT_DISTRO_NOT_FOUND`。

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
cd /mnt/d/codexProject/staix-mtclaw
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
cd /mnt/d/codexProject/staix-mtclaw/MTClaw
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[test]'
```

运行测试和启动 Function Router 前，还需要创建仅供本机使用的环境变量与配置文件。不得提交真实 API 密钥。

