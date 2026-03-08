# WebDAV 配置与同步（Readest）

## 适用范围
- 支持任何符合 WebDAV（RFC 4918）的服务端，例如：坚果云、Nextcloud、群晖/NAS、自建 WebDAV 等。
- 桌面端（Tauri）与 Android（APK）均可使用；Web 端受 CORS 影响，需服务端允许跨域。

## 在应用内配置
打开：书库页面右上角菜单 → WebDAV中心

### 字段说明
- 服务器地址：WebDAV 服务端 URL，例如 `https://dav.example.com` 或 `https://dav.jianguoyun.com/dav`
- 远端路径：你希望 Readest 存放同步数据的目录前缀，例如 `/`、`/我的书库`、`/dav`
  - Readest 会在该路径下创建自己的同步目录（见下文目录结构）
- 用户名/密码：WebDAV 账号与密码（或应用专用密码）
- 冲突策略：
  - 手动处理：检测到冲突时不自动覆盖，转到“同步日志”查看冲突项
  - 时间戳优先：尽可能按最近更新时间选择一方（在缺少时间信息时会退化为默认行为）
  - 本地优先 / 云端优先：自动选择一方覆盖
- 开启自动同步（仅在应用运行时）：默认关闭；开启后会按“同步间隔”定期触发一次双向增量同步

### 测试连接
点击“测试连接”会尝试对远端发起 PROPFIND 请求，并在可用时读取云端书架清单用于“下载（云端）”列表展示。

## 同步内容与目录结构
同步范围包含：
- 书籍文件（EPUB/PDF/MOBI 等）
- `config.json`（阅读进度、书签、笔记、标注等）
- 封面 `cover.png`
- 书架清单 `library.json`

远端目录结构固定（位于“远端路径”之下）：
- `Readest/Books/`
  - `library.json`
  - `{book.hash}/`
    - `{safeTitle}.{ext}`
    - `cover.png`
    - `config.json`
- `Readest/System/`
  - `webdav-sync-state.json`（同步状态与基线，用于增量与冲突检测）

## 增量同步与冲突
- 增量判断：
  - JSON 文件：对比内容 md5
  - 大文件：对比文件大小与抽样指纹（partial md5）
  - 远端：优先使用 ETag/Last-Modified/Content-Length
- 冲突：当本地与云端相对同一基线都发生变化时判定为冲突，按“冲突策略”处理。

## 日志与导出
- “同步日志”会记录每次同步操作的时间、方向、文件路径、状态与错误信息。
- 可导出为 `webdav-sync-log.json` 便于排查问题。

## 开发者：模块 API（摘要）
### WebDAV 客户端
位置：`src/services/webdav/client/`
- `WebDavClient.propfind(path, { depth })`
- `WebDavClient.get(path, { range })`
- `WebDavClient.put(path, body, { ifMatch/ifNoneMatch })`
- `WebDavClient.mkcol/delete/move/copy`

### 同步引擎
位置：`src/services/webdav/sync/engine.ts`
- `syncWebDavSelection(appService, profile, { books, includeLibrary, ... }, callbacks, control)`
  - callbacks：进度与日志回调
  - control：暂停/恢复与停止（按“文件粒度”生效）

## 测试
只运行 WebDAV 相关测试：
```bash
pnpm --filter @readest/readest-app exec vitest run src/__tests__/webdav/propfind-parse.test.ts src/__tests__/webdav/sync.integration.test.ts
```

