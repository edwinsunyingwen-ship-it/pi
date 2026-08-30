# Staix + MTClaw 明日现场安装、配置、验证与故障处理手册

适用日期：2026-08-09 现场演示  
适用机器：MTT AIBOOK，arm64，Ubuntu 22.04 / AIOS  
适用安装包：`staix-mtclaw-ubuntu22.04-arm64-offline.tar.gz`

本手册按“完全不熟悉 Ubuntu 也能照着执行”的方式编写。正常情况下只执行第一至第九部分；只有出现异常时才查阅第十部分以后。

## 一、今晚出发前必须准备好的内容

### 1. U 盘中应当有三个项目

请在 U 盘根目录建立以下结构：

```text
STAIX_DEMO/
├── staix-mtclaw-ubuntu22.04-arm64-offline.tar.gz
├── staix-mtclaw-ubuntu22.04-arm64-offline.tar.gz.sha256
└── STAIX_PRIVATE/
    ├── config.json
    └── qcc-config.json
```

其中：

- `tar.gz` 是公开离线安装包，可以复制或备份。
- `.sha256` 是安装包完整性校验文件。
- `STAIX_PRIVATE/config.json` 是 Staix 的模型、OCR、MCP、智能体等私密配置。
- `STAIX_PRIVATE/qcc-config.json` 是企查查 CLI 的私密授权配置。
- `STAIX_PRIVATE` 不得上传 Git、网盘、聊天群或公开服务器。

### 2. 修正服务器上的便携校验文件

当前服务器最初生成的校验文件含服务器绝对路径。请在服务器终端执行一次：

```bash
cd /root/staix-mtclaw-build/output/offline
sha256sum staix-mtclaw-ubuntu22.04-arm64-offline.tar.gz \
  > staix-mtclaw-ubuntu22.04-arm64-offline.tar.gz.sha256
cat staix-mtclaw-ubuntu22.04-arm64-offline.tar.gz.sha256
```

应当看到：

```text
edec93df4d74e5160f8a7845d13486ae5f11ca985840634a63cba495132e79dc  staix-mtclaw-ubuntu22.04-arm64-offline.tar.gz
```

重新下载这个 `.sha256` 文件并放入 U 盘。

### 3. 在 Windows 准备私密配置目录

在 Windows 上打开 PowerShell：

1. 按键盘 `Win` 键。
2. 输入 `PowerShell`。
3. 点击“Windows PowerShell”或“终端”。
4. 复制下面整个代码块，粘贴后按回车。

```powershell
$privateDir = 'D:\STAIX_PRIVATE'
New-Item -ItemType Directory -Force -Path $privateDir | Out-Null

Copy-Item -LiteralPath "$env:APPDATA\Staix\config.json" `
  -Destination "$privateDir\config.json" -Force

Copy-Item -LiteralPath "$env:USERPROFILE\.qcc\config.json" `
  -Destination "$privateDir\qcc-config.json" -Force

Get-ChildItem -LiteralPath $privateDir
```

预期看到两个文件：

```text
config.json
qcc-config.json
```

将整个 `D:\STAIX_PRIVATE` 目录复制到 U 盘的 `STAIX_DEMO` 目录中。不要用记事本打开后截图，不要发送给其他人。

### 4. 准备两份物理备份

建议至少准备：

- U 盘一份。
- 你的 Windows 电脑本地一份。
- 服务器保留一份公开安装包，但不要把私密配置上传服务器。

### 5. 准备网络备用方案

离线安装不需要互联网，但模型、OCR、企查查和元典调用都需要互联网。准备手机热点，并提前确认手机热点可用。

## 二、到达现场后如何打开 Ubuntu 终端

终端是输入安装指令的窗口。可以使用任意一种方式：

### 方法 A：键盘快捷键

同时按下：

```text
Ctrl + Alt + T
```

出现一个深色或浅色、带命令提示符的窗口，即为终端。

### 方法 B：从应用列表打开

1. 点击屏幕左下角或左侧栏的“显示应用程序”。
2. 在搜索框输入 `Terminal` 或“终端”。
3. 点击“终端”图标。

### 如何判断命令已经执行结束

当终端重新出现类似下面的提示符时，表示上一条命令已经结束：

```text
ubuntu@aibook:~$
```

提示符中的用户名和机器名可能不同，这是正常现象。

## 三、正常流程：检查目标机器

打开终端后，逐行复制下面命令。每复制一行按一次回车：

```bash
uname -m
lsb_release -ds
python3 --version
df -h /
```

正确结果应满足：

- `uname -m` 显示 `aarch64` 或 `arm64`。
- 系统显示 Ubuntu 22.04。
- Python 显示 3.10 或更高。
- 磁盘可用空间建议至少 4 GB。

如果显示 `x86_64`，不要继续安装这个 arm64 包，直接查看“异常 1：CPU 架构不对”。

## 四、正常流程：把安装包从 U 盘复制到电脑

不要直接在 U 盘中运行安装包，避免 U 盘被以 `noexec` 方式挂载导致无法执行。

1. 将 U 盘插入 AIBOOK。
2. 打开 Ubuntu 左侧栏中的“文件”。
3. 在左侧找到 U 盘名称并点击。
4. 打开 U 盘中的 `STAIX_DEMO`。
5. 选中以下三个项目并复制：
   - `staix-mtclaw-ubuntu22.04-arm64-offline.tar.gz`
   - `staix-mtclaw-ubuntu22.04-arm64-offline.tar.gz.sha256`
   - `STAIX_PRIVATE` 文件夹
6. 点击左侧“下载”目录。
7. 将三个项目粘贴到“下载”目录。

复制完成后，终端执行：

```bash
cd ~/Downloads
ls -lh
```

如果系统中文目录实际叫“下载”，但 `~/Downloads` 不存在，可以使用：

```bash
cd ~/下载
ls -lh
```

应当看到约 849 MB 的压缩包、校验文件和 `STAIX_PRIVATE` 目录。

## 五、正常流程：校验、解压并安装

以下示例假定文件位于 `~/Downloads`。如果你的目录是 `~/下载`，把命令中的 `~/Downloads` 换成 `~/下载`。

### 1. 校验安装包

```bash
cd ~/Downloads
sha256sum -c staix-mtclaw-ubuntu22.04-arm64-offline.tar.gz.sha256
```

正确结果：

```text
staix-mtclaw-ubuntu22.04-arm64-offline.tar.gz: OK
```

只有看到 `OK` 才继续。

### 2. 解压

```bash
cd ~/Downloads
tar -xzf staix-mtclaw-ubuntu22.04-arm64-offline.tar.gz
cd staix-mtclaw-ubuntu22.04-arm64-offline
```

检查目录：

```bash
ls -lh
```

应当看到：

```text
install.sh
offline
packages
README.txt
SHA256SUMS
```

### 3. 一键离线安装 Staix、MTClaw、qcc 和 Node

```bash
chmod +x install.sh
./install.sh --offline-only --profile ~/Downloads/STAIX_PRIVATE/config.json
```

安装过程可能打印很多 `OK` 和 Python 包名称，这是正常现象。等待终端重新出现提示符。

正确结果应包含：

```text
STAIX_OFFLINE_CHECKSUMS=PASS
Staix AIOS installation completed.
Private Staix profile imported:
```

### 4. 导入企查查私密配置

企查查授权不在 Staix 的 `config.json` 中，需要单独导入：

```bash
mkdir -p ~/.qcc
chmod 700 ~/.qcc
install -m 600 ~/Downloads/STAIX_PRIVATE/qcc-config.json ~/.qcc/config.json
```

检查权限，但不要使用 `cat` 查看文件：

```bash
ls -l ~/.qcc/config.json
```

权限开头应当是：

```text
-rw-------
```

## 六、正常流程：启动 Staix

安装器把启动命令放在 `~/.local/bin`。现场首次启动前执行：

```bash
export PATH="$HOME/.local/bin:$PATH"
~/.local/bin/staix
```

Staix 窗口打开后，先不要关闭终端。终端窗口可以最小化。

如果 Staix 窗口没有出现，按 `Ctrl+C` 返回提示符，然后查看“异常 4：Staix 无法启动”。

## 七、正常流程：确认配置文件和密钥分别在哪里

### 1. Staix 主配置

Linux 路径：

```text
~/.config/Staix/config.json
```

完整含义通常是：

```text
/home/当前用户名/.config/Staix/config.json
```

它保存：

- 模型 Provider、Base URL、模型 ID 和直接填写的模型 API Key。
- OCR 的 `OCR_APP_ID`、`OCR_SECRET_CODE`。
- 元典法规 MCP、案例 MCP 的 URL 与 Token。
- 智能体、子智能体、能力绑定、知识和任务模板。
- Staix 的 MTClaw 开关、端口、路由模型和回答模型选择。

配置中心标题旁边有一个信息图标。鼠标停留在信息图标上，也能看到当前配置文件实际路径。

### 2. MTClaw 运行配置

```text
~/.function-router/config.json
~/.function-router/functions.jsonl
~/.function-router/scripts/
~/.function-router/logs/
```

这些文件由 Staix 在 Linux 上“保存 Router 配置”时生成。正常情况下不要手工填写第二套模型配置。

### 3. 企查查 qcc 配置

```text
~/.qcc/config.json
```

它保存：

- `mcp.baseUrl`，正常为 `https://agent.qcc.com/mcp`。
- `mcp.authorization`，即企查查授权。
- 超时和启用状态。

### 4. Staix 操作日志

```text
~/.config/Staix/logs/audit-日期.jsonl
```

也可以在 Staix 顶部点击“操作日志”查看。

### 5. MTClaw 日志

```text
~/.function-router/logs/router.out
~/.function-router/logs/router.log
```

## 八、正常流程：在 Staix 中逐项检查并让 MTClaw 生效

### 第 1 步：检查模型

1. 在 Staix 顶部点击“配置中心”，或点击左下角“设置”。
2. 点击“模型配置”。
3. 找到明天准备使用的模型，建议优先使用已经直接保存了密钥并经过验证的豆包模型。
4. 点击该模型右侧“编辑”。
5. 检查以下内容：
   - 模型名称。
   - 模型 ID。
   - Base URL。
   - API Key 是否已经填写。
   - “高级接入参数”中的 API 类型是否为 `OpenAI Chat Completions`。MTClaw 托管模式只接受这一类型。
   - “启用该模型”是否开启。
6. 点击“测试”。
7. 看到测试成功后，点击“保存模型”。

注意：列表里显示的“联通”可能是从 Windows 配置带来的上次状态，必须在 AIBOOK 上重新点一次“测试”。

### 第 2 步：检查 OCR

1. 打开“配置中心”。
2. 点击 `Tools / Skills`。
3. 找到“OCR通用文本识别”。
4. 点击“编辑”。
5. 检查：
   - 已启用。
   - 接口地址是合合 TextIn 多页识别接口。
   - Header JSON 中引用 `${OCR_APP_ID}` 和 `${OCR_SECRET_CODE}`。
6. 点击“保存能力”。

OCR 的真实值不直接显示在能力页面中，而是在 Staix 主配置的 `variables` 数组中。私密配置导入后应当已经存在。

验证是否存在但不显示值：关闭 Staix 后或另开一个终端，完整粘贴下面代码块：

```bash
python3 - <<'PY'
import json
from pathlib import Path

path = Path.home() / ".config" / "Staix" / "config.json"
data = json.loads(path.read_text(encoding="utf-8"))
variables = {item.get("name"): item.get("value", "") for item in data.get("variables", [])}
for name in ("OCR_APP_ID", "OCR_SECRET_CODE"):
    print(f"{name}: {'已配置' if variables.get(name) else '未配置'}")
PY
```

正确结果：

```text
OCR_APP_ID: 已配置
OCR_SECRET_CODE: 已配置
```

最后用一张不含真实个人信息的测试图片，在“民事诉讼文书生成”相关会话中要求识别，确认有真实 OCR 返回。

### 第 3 步：检查企查查 qcc

在终端执行：

```bash
export PATH="$HOME/.local/bin:$PATH"
qcc --version
qcc check
```

版本应显示 `1.0.8`，`qcc check` 应显示授权已配置，不应打印完整 Token。

再做一次真实测试：

```bash
qcc company get_company_registration_info --json "企查查科技股份有限公司"
```

正常时返回结构化企业信息。

Staix 中对应能力的位置：

1. “配置中心”。
2. `Tools / Skills`。
3. “企业工商信息查询 CLI”。
4. 本地命令应为 `qcc`，能力应启用。

### 第 4 步：检查元典 MCP Token

法规与案例是两个独立能力，分别检查：

1. 打开“配置中心” -> `Tools / Skills`。
2. 编辑“元典法律法规检索mcp”。
3. MCP 认证方式选择 `Bearer Token`。
4. “API Key / Token”应显示已保存的掩码，而不是空白。
5. 点击“发现 MCP 工具”。
6. 出现工具列表后点击“保存能力”。
7. 对“元典裁判案例检索”重复以上操作。

元典 Token 保存在 Staix 主配置每个 MCP 能力的 `mcpApiKeyValue` 字段中，请勿复制到 MTClaw 配置或终端历史中。

### 第 5 步：检查三个专业子智能体

打开“配置中心” -> “智能体配置”。逐个检查：

1. 企业主体核验与风险尽调：
   - 类型为“子智能体”。
   - 专业角色为企业尽调。
   - MTClaw 自动路由选择“允许”。
   - 已选择可用模型和默认模型。
   - 已绑定“企业工商信息查询 CLI”等需要的能力。
   - 已选择上级主智能体。
   - “启用该智能体”已勾选。
2. 法律法规与类案研究：
   - 已绑定元典法规和案例 MCP。
   - 已选择模型、上级主智能体和专业角色。
3. 民事诉讼文书生成：
   - 已绑定 OCR 和民事诉讼文书生成能力。
   - 已选择模型、上级主智能体和专业角色。

每次修改后点击“保存智能体”。

### 第 6 步：开启 Staix 托管 MTClaw

当前版本中，“由 Staix 管理本机 Router 配置（Linux / AIOS）”复选框暂时显示在“上下文压缩”页面，这是当前界面布局位置，并非操作错误。

1. 打开“配置中心”。
2. 点击“上下文压缩”。
3. 勾选“由 Staix 管理本机 Router 配置（Linux / AIOS）”。
4. 不要关闭配置中心，接着点击“MTClaw Router”。
5. 请求模式选择“MTClaw 专业路由”。
6. Base URL 填写：

```text
http://127.0.0.1:18790/v1
```

7. Router 监听端口填写：

```text
18790
```

8. “路由模型”选择已在本机测试成功、API 类型为 OpenAI Chat Completions 的模型。
9. “回答模型”同样选择已测试成功的模型。可以与路由模型相同。
10. “API Key 环境变量”通常留空。
11. “本地 Router Token”保留已有值；它不是大模型 API Key。
12. 点击“保存 Router 配置”。

保存成功时，Staix 会生成：

```text
~/.function-router/config.json
~/.function-router/functions.jsonl
```

并尝试启动：

```text
staix-mtclaw-router.service
```

13. 等待 3 至 10 秒。
14. 点击“测试 Router”。
15. Router 状态应显示“已就绪”。

提示：请求模式保存后只对新会话生效。验证时请新建一个会话，不要继续使用保存前已经打开的旧会话。

## 九、正常流程：终端验收和演示前测试

保持互联网连接，然后在终端逐行执行：

```bash
export PATH="$HOME/.local/bin:$PATH"

uname -m
qcc --version
qcc check

systemctl --user status staix-mtclaw-router.service --no-pager
curl -fsS http://127.0.0.1:18790/health
echo
curl -fsS http://127.0.0.1:18790/ready
echo

grep -n 'delegate_to_subagent' ~/.function-router/functions.jsonl
```

验收条件：

- CPU 为 `aarch64` 或 `arm64`。
- qcc 能显示版本并通过检查。
- systemd 服务显示 `active (running)`。
- `/health` 和 `/ready` 请求成功。
- `functions.jsonl` 中存在 `delegate_to_subagent`。

然后在 Staix 新会话依次做四个短测试：

1. 普通问答：确认模型能回复。
2. 企业查询：要求查询一家公开测试企业的工商登记信息，确认出现 MTClaw 路由追踪和 qcc 真实结果。
3. 法规/案例查询：确认元典 MCP 被真实调用。
4. OCR/文书：上传不含真实个人隐私的测试图片，确认 OCR；再用虚构材料生成文书预览，确认后再生成 DOCX。

在 Staix 顶部打开“操作日志”，确认能看到：

- MTClaw 路由追踪。
- 子智能体执行。
- qcc、MCP 或 OCR 能力调用。
- 成功或失败状态。

不要只用“Router 服务正在运行”作为演示通过依据；必须至少有一次真实专业请求经过 Router、子智能体和工具。

# 异常情况处理

## 异常 1：`uname -m` 显示 `x86_64`

原因：当前机器不是 arm64，不能运行本安装包。

处理：

1. 停止安装。
2. 向现场人员确认是否拿错机器或启动了错误系统。
3. 不要尝试强行安装或使用模拟器。

## 异常 2：校验显示 `FAILED` 或找不到文件

先确认当前目录：

```bash
pwd
ls -lh
```

如果文件在“下载”目录：

```bash
cd ~/Downloads
```

如果系统目录是中文：

```bash
cd ~/下载
```

重新校验：

```bash
sha256sum staix-mtclaw-ubuntu22.04-arm64-offline.tar.gz
```

正确哈希必须是：

```text
edec93df4d74e5160f8a7845d13486ae5f11ca985840634a63cba495132e79dc
```

如果不同：删除电脑上的副本，重新从 U 盘复制。仍然不同则换用第二份备份，不要安装损坏文件。

## 异常 3：出现 `Permission denied`

在解压目录执行：

```bash
chmod +x install.sh
./install.sh --offline-only --profile ~/Downloads/STAIX_PRIVATE/config.json
```

如果仍然失败，确认不是直接在 U 盘运行。将整个文件复制到 `~/Downloads` 后重试。

## 异常 4：Staix 无法启动

先执行：

```bash
export PATH="$HOME/.local/bin:$PATH"
~/.local/bin/staix
```

### 提示缺少 `libgbm.so.1`

联网情况下：

```bash
sudo apt-get update
sudo apt-get install -y libgbm1
```

### 提示缺少 `libasound.so.2`

联网情况下：

```bash
sudo apt-get update
sudo apt-get install -y libasound2
```

### 其他动态库错误

```bash
ldd ~/.local/share/staix/Staix.AppImage 2>/dev/null | grep 'not found' || true
```

AppImage 外壳本身不一定能直接用 `ldd` 完整检查。可以改查安装包中的 DEB，或将终端错误完整保存并拍照。AIBOOK 的桌面版 Ubuntu 正常情况下应自带 Electron 所需图形和声音库。

### 程序启动后白屏或立即退出

```bash
~/.local/bin/staix --disable-gpu
```

如果这样能启动，先完成演示，之后再排查 GPU/驱动兼容问题。

## 异常 5：`qcc: command not found`

执行：

```bash
export PATH="$HOME/.local/bin:$PATH"
qcc --version
```

仍然找不到时检查文件：

```bash
ls -l ~/.local/bin/qcc
ls -l ~/.local/share/staix/qcc-runtime/node_modules/qcc-agent-cli/bin/index.js
```

如果文件缺失，回到离线包目录重新执行安装，但跳过 Router 重配不是必须的：

```bash
cd ~/Downloads/staix-mtclaw-ubuntu22.04-arm64-offline
./install.sh --offline-only --profile ~/Downloads/STAIX_PRIVATE/config.json
```

## 异常 6：qcc 显示未授权或 401

先重新复制私密配置：

```bash
install -m 600 ~/Downloads/STAIX_PRIVATE/qcc-config.json ~/.qcc/config.json
qcc check
```

如果需要现场输入一个新 Token，使用下面方式，输入内容不会显示在屏幕上：

```bash
read -rsp "请输入企查查 API Key，然后按回车：" QCC_API_KEY
echo
qcc init --authorization "Bearer $QCC_API_KEY"
unset QCC_API_KEY
qcc check
```

如果旧配置写了错误地址，只执行 `qcc init --authorization ...` 会恢复默认地址：

```text
https://agent.qcc.com/mcp
```

## 异常 7：OCR 提示缺少凭据或 401

先用第八部分的安全检查命令确认两个变量是否“已配置”。

如果需要修改，不要直接用 `cat` 打印配置。先关闭 Staix，然后备份：

```bash
cp ~/.config/Staix/config.json \
  ~/.config/Staix/config.json.backup.$(date +%Y%m%d%H%M%S)
```

安全输入新值并更新配置：

```bash
read -rp "请输入 OCR_APP_ID，然后按回车：" OCR_APP_ID_NEW
read -rsp "请输入 OCR_SECRET_CODE，然后按回车：" OCR_SECRET_CODE_NEW
echo

OCR_APP_ID_NEW="$OCR_APP_ID_NEW" \
OCR_SECRET_CODE_NEW="$OCR_SECRET_CODE_NEW" \
python3 - <<'PY'
import json
import os
from pathlib import Path

path = Path.home() / ".config" / "Staix" / "config.json"
data = json.loads(path.read_text(encoding="utf-8"))
values = {
    "OCR_APP_ID": os.environ["OCR_APP_ID_NEW"],
    "OCR_SECRET_CODE": os.environ["OCR_SECRET_CODE_NEW"],
}
variables = data.setdefault("variables", [])
by_name = {item.get("name"): item for item in variables}
for name, value in values.items():
    if name in by_name:
        by_name[name]["value"] = value
    else:
        variables.append({"name": name, "value": value, "description": ""})
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

unset OCR_APP_ID_NEW OCR_SECRET_CODE_NEW
chmod 600 ~/.config/Staix/config.json
python3 -m json.tool ~/.config/Staix/config.json >/dev/null \
  && echo "STAIX_CONFIG_JSON=PASS"
```

重新启动 Staix，再用测试图片验证。

## 异常 8：元典 MCP “发现工具”失败

检查顺序：

1. 确认 AIBOOK 可以访问互联网。
2. 打开能力编辑页，确认 MCP URL 没有多余空格。
3. 认证方式为 `Bearer Token`。
4. Token 输入框显示已保存掩码。
5. 点击“发现 MCP 工具”。
6. 成功后点击“保存能力”。

如果返回 401/403，通常是 Token 错误、失效或无权限。更换 Token 后再次“发现 MCP 工具”。

如果法规能用而案例不能用，分别检查两个能力，不要认为它们共用同一个联通状态。

## 异常 9：保存 Router 配置时报模型不符合要求

MTClaw 托管 Router 要求“路由模型”和“回答模型”同时满足：

- 模型已启用。
- 已测试联通。
- API 类型是 `OpenAI Chat Completions`。
- Base URL、模型 ID、API Key 均可解析。

回到“模型配置”编辑模型：

1. 打开“高级接入参数”。
2. API 类型选 `OpenAI Chat Completions`。
3. 填写 Base URL、模型 ID 和 API Key。
4. 点击“测试”。
5. 点击“保存模型”。
6. 返回“MTClaw Router”重新选择并保存。

## 异常 10：Router 测试失败或服务不是 running

执行：

```bash
systemctl --user status staix-mtclaw-router.service --no-pager
journalctl --user -u staix-mtclaw-router.service -n 100 --no-pager
tail -n 100 ~/.function-router/logs/router.out 2>/dev/null || true
tail -n 100 ~/.function-router/logs/router.log 2>/dev/null || true
```

### 配置文件不存在

```bash
ls -l ~/.function-router/config.json ~/.function-router/functions.jsonl
```

如果不存在：

1. 在“上下文压缩”勾选 Staix 托管 Router。
2. 回到“MTClaw Router”。
3. 选择路由模型和回答模型。
4. 点击“保存 Router 配置”。

### 端口被占用

```bash
ss -ltnp | grep ':18790' || true
```

如果其他程序占用了 18790：

1. 在 Staix Router 页面把端口改成 `18791`。
2. Base URL 同时改成：

```text
http://127.0.0.1:18791/v1
```

3. 保存 Router 配置。
4. 使用新端口验证：

```bash
curl -fsS http://127.0.0.1:18791/health
```

### 服务配置已经存在但没有启动

```bash
systemctl --user daemon-reload
systemctl --user enable --now staix-mtclaw-router.service
systemctl --user restart staix-mtclaw-router.service
```

等待 3 秒后：

```bash
curl -fsS http://127.0.0.1:18790/health
```

## 异常 11：复用机器上已经安装的 MTClaw

只有当已有 MTClaw 满足以下条件时才建议复用：

- 已提供 OpenAI-compatible `/v1` 地址。
- `/health`、`/ready` 能访问。
- 已加载 `delegate_to_subagent`。
- 与 Staix 使用同一当前 Linux 用户。

先验证已有服务，假设端口为 18790：

```bash
curl -fsS http://127.0.0.1:18790/health
echo
curl -fsS http://127.0.0.1:18790/ready
echo
grep -n 'delegate_to_subagent' ~/.function-router/functions.jsonl
```

复用外部 MTClaw 的界面配置：

1. “由 Staix 管理本机 Router 配置”保持不勾选。
2. 打开“MTClaw Router”。
3. Base URL 填已有 Router 地址，例如 `http://127.0.0.1:18790/v1`。
4. 填写已有 Router 所需的本地 Token。
5. 选择“MTClaw 专业路由”。
6. 保存并点击“测试 Router”。

如果已有 MTClaw 没有 `delegate_to_subagent`，即使健康检查成功，也不能证明专业子智能体链路可用。此时改用本离线包的 Staix 托管模式。

## 异常 12：修改 MTClaw 配置后没有生效

推荐顺序：

1. 不直接编辑 `~/.function-router/config.json`。
2. 在 Staix 中修改模型或子智能体。
3. 打开“MTClaw Router”，再次点击“保存 Router 配置”。
4. 重启服务：

```bash
systemctl --user restart staix-mtclaw-router.service
```

5. 检查文件更新时间：

```bash
ls -l --time-style=long-iso \
  ~/.function-router/config.json \
  ~/.function-router/functions.jsonl
```

6. 再点“测试 Router”，并新建会话测试。

## 异常 13：MTClaw 配置损坏，需要重装

以下操作不会直接删除旧文件，而是改名备份。先关闭 Staix，然后在终端执行：

```bash
MTCLAW_BACKUP_STAMP=$(date +%Y%m%d%H%M%S)

systemctl --user disable --now staix-mtclaw-router.service 2>/dev/null || true

if [ -d ~/.function-router ]; then
  mv ~/.function-router \
    ~/.function-router.backup.$MTCLAW_BACKUP_STAMP
fi

if [ -d ~/.local/share/staix/mtclaw-runtime ]; then
  mv ~/.local/share/staix/mtclaw-runtime \
    ~/.local/share/staix/mtclaw-runtime.backup.$MTCLAW_BACKUP_STAMP
fi

cd ~/Downloads/staix-mtclaw-ubuntu22.04-arm64-offline
./install.sh --offline-only --skip-qcc \
  --profile ~/Downloads/STAIX_PRIVATE/config.json
```

重新启动 Staix：

```bash
export PATH="$HOME/.local/bin:$PATH"
~/.local/bin/staix
```

然后重新执行：

1. 检查模型。
2. 检查三个专业子智能体。
3. 勾选 Staix 托管 Router。
4. 在 Router 页面选择两个模型并保存。
5. 测试 Router。

如果需要恢复旧 MTClaw 配置，先停止新服务，再把对应 `.backup.时间` 目录改回 `~/.function-router`。

## 异常 14：Staix 主配置修改失败或启动后配置消失

检查 JSON 是否有效：

```bash
python3 -m json.tool ~/.config/Staix/config.json >/dev/null \
  && echo "STAIX_CONFIG_JSON=PASS"
```

如果报错，从私密配置恢复：

```bash
cp ~/.config/Staix/config.json \
  ~/.config/Staix/config.json.invalid.$(date +%Y%m%d%H%M%S)

install -m 600 ~/Downloads/STAIX_PRIVATE/config.json \
  ~/.config/Staix/config.json
```

重新启动 Staix。恢复后再次保存 Router 配置，使 `~/.function-router` 与 Staix 主配置同步。

## 异常 15：模型、OCR、MCP 都同时无法访问

这通常不是三个密钥同时失效，而是网络问题。

检查：

```bash
ping -c 3 223.5.5.5
getent hosts ark.cn-beijing.volces.com
getent hosts agent.qcc.com
```

如果 IP 能通但域名解析失败，属于 DNS 问题。切换手机热点或请现场网络管理员处理。

如果现场 Wi-Fi 有认证网页，先打开浏览器访问任意网页，完成联网认证后再测试 API。

## 异常 16：演示请求没有经过 MTClaw

检查：

1. Router 页面请求模式是否为“MTClaw 专业路由”。
2. 保存后是否新建了会话。
3. 当前主智能体是否挂载了三个专业子智能体。
4. 子智能体是否启用并允许 MTClaw 自动路由。
5. Router 服务是否 running。
6. `functions.jsonl` 是否存在 `delegate_to_subagent`。

终端检查：

```bash
systemctl --user is-active staix-mtclaw-router.service
grep -n 'delegate_to_subagent' ~/.function-router/functions.jsonl
tail -n 100 ~/.function-router/logs/router.log 2>/dev/null || true
```

Staix 中打开“操作日志”，寻找“MTClaw 路由追踪”。如果只有回答模型调用而没有路由追踪，当前请求没有形成已验证的 MTClaw 专业链路。

## 十、演示当天不要做的事情

- 不要升级到 Ubuntu 24.04。
- 不要执行 `do-release-upgrade`。
- 不要临时升级 Node、npm、Python 或 Electron。
- 不要现场重新构建源码。
- 不要把私密配置上传 Git。
- 不要在直播、投屏或截图时执行 `cat ~/.qcc/config.json` 或 `cat ~/.config/Staix/config.json`。
- 不要为了排错删除配置；优先使用带时间戳的备份或改名。
- 不要把“健康检查成功”说成完整业务链路成功；还要展示实际 Router、Subagent 和工具调用。

## 十一、演示结束后的安全收尾

1. 关闭 Staix。
2. 弹出 U 盘，不要直接拔出。
3. 删除现场机器中的私密复制文件：

```bash
rm -f ~/Downloads/STAIX_PRIVATE/config.json
rm -f ~/Downloads/STAIX_PRIVATE/qcc-config.json
rmdir ~/Downloads/STAIX_PRIVATE 2>/dev/null || true
```

这只删除“下载”目录中的私密副本，不会删除 Staix 正在使用的配置。

4. 如果现场机器需要归还，应在确认不再演示后删除运行配置：

```bash
rm -f ~/.config/Staix/config.json
rm -f ~/.qcc/config.json
rm -f ~/.function-router/config.json
```

5. 在模型、OCR、企查查和元典控制台吊销或轮换本次演示使用的临时凭据。

## 十二、最终一分钟检查表

出发前：

- [ ] U 盘里有 849 MB 左右的离线包。
- [ ] SHA-256 是 `edec93df4d74e5160f8a7845d13486ae5f11ca985840634a63cba495132e79dc`。
- [ ] U 盘有 `STAIX_PRIVATE/config.json`。
- [ ] U 盘有 `STAIX_PRIVATE/qcc-config.json`。
- [ ] 手机热点可用。
- [ ] 使用的是临时演示凭据或已准备演示后吊销。

安装后：

- [ ] Staix 能打开。
- [ ] 模型在 AIBOOK 上重新测试成功。
- [ ] qcc `1.0.8` 且 `qcc check` 通过。
- [ ] OCR 两个变量均显示已配置。
- [ ] 两个元典 MCP 均能发现工具。
- [ ] 三个专业子智能体启用、绑定模型和能力。
- [ ] Staix 托管 Router 已勾选。
- [ ] Router 保存并显示“已就绪”。
- [ ] systemd 服务为 `active (running)`。
- [ ] 企业、法规/案例、OCR/文书各完成一次真实短测试。
- [ ] 操作日志显示 MTClaw 路由追踪和真实工具调用。
