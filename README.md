# ADB Studio

本机可视化操作 Android Debug Bridge（ADB），无需手敲命令。支持 **Windows** 与 **macOS**。

## 结构

```
apps/web        可视化界面（Vite + React）
apps/server     本机 API（仅 127.0.0.1）
packages/adb-core  安全封装的 ADB 调用
platform-tools/windows  Win 版 adb
platform-tools/darwin   Mac 版 adb
```

## macOS 开发

```bash
pnpm install
pnpm fetch:adb:mac      # 或 pnpm fetch:adb:all 同时保留 Win/Mac
pnpm build
pnpm start
```

也可：`./start.sh`（优先启动 `release/ADB-Studio`，否则 `pnpm start`）。

`.env` 可省略 `ADB_PATH`（自动选当前系统目录）；或显式：

```
ADB_PATH=./platform-tools/darwin/adb
```

## 拉取 platform-tools

```bash
pnpm fetch:adb          # 当前系统
pnpm fetch:adb:win      # → platform-tools/windows/
pnpm fetch:adb:mac      # → platform-tools/darwin/
pnpm fetch:adb:all      # 两者都要
```

打包时按目标平台从对应目录取 adb（`pnpm release` / `pnpm release:mac`）。

## 生产打包（免安装可分发）

### Windows（本机）

```bash
pnpm install
pnpm release
```

产出：
- `release/ADB-Studio/` — 独立目录（内置 Node + adb + 界面）
- `release/ADB-Studio-win.7z` / `.zip`

体积主要来自 `runtime/node.exe`。可选 UPX：下载到 `.cache/upx-4.2.4-win64/` 后重新 `pnpm release`。

### macOS（可在 Windows 交叉打包）

```bash
pnpm release:mac          # Apple Silicon arm64（默认）
pnpm release:mac:x64      # Intel Mac
```

产出：
- `release/ADB-Studio/`（含 `start.sh`、`runtime/node`、`platform-tools/adb`）
- `release/ADB-Studio-mac-arm64.zip`（或 `mac-x64`）

Mac 上首次运行：

```bash
chmod +x start.sh stop.sh runtime/node platform-tools/adb
xattr -dr com.apple.quarantine .   # 若提示「已损坏」
./start.sh
```

## 开发构建

```bash
pnpm build
pnpm start
```

开发热更新：`pnpm dev`（默认 Mock）  
- `.env` 设 `ADB_MOCK=0` → 真实 ADB  
- `pnpm dev:real` → 全栈强制真实设备（覆盖 `.env`）  
- `pnpm dev:server:real` → 仅 server 强制真实设备  
设置 `OPEN_BROWSER=0` 可禁止启动时自动开浏览器。

## 功能

- 设备列表 / 无线调试连接
- 设备属性、重启
- 第三方应用：启动 / 停止 / 清数据 / 卸载
- APK 安装
- 截图、Logcat、远程按键

## 安全说明

- API 强制绑定 `127.0.0.1`，不对外网开放
- ADB 参数数组调用，禁止 shell 拼接
- 包名、路径、按键均白名单校验
- 不提供任意 `adb shell` 自由命令入口
