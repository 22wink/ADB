# ADB Studio

本机可视化操作 Android Debug Bridge（ADB），无需手敲命令。

## 结构

```
apps/web        可视化界面（Vite + React）
apps/server     本机 API（仅 127.0.0.1）
packages/adb-core  安全封装的 ADB 调用
platform-tools  Google platform-tools（含 adb.exe）
```

## 生产打包（免安装可分发）

```bash
pnpm install
pnpm release
```

产出：
- `release/ADB-Studio/` — 独立目录（内置 Node + adb + 界面）
- `release/ADB-Studio-win.7z` — **推荐**，约 23MB（7z 极限压缩）
- `release/ADB-Studio-win.zip` — 兼容 zip

体积主要来自 `runtime/node.exe`（约 85MB 原文件）。已只打包运行所需的 `node.exe`，不含 npm。

可选进一步缩小：下载 UPX 解压到 `.cache/upx-4.2.4-win64/` 后重新 `pnpm release`  
https://github.com/upx/upx/releases/download/v4.2.4/upx-4.2.4-win64.zip  
（UPX 可能触发杀软误报，按需使用）

## 开发构建

```bash
pnpm build
pnpm start
```

开发热更新：`pnpm dev`  
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
