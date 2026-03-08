# OpenReadest

OpenReadest 是基于 Readest 的非官方 Fork，重点保留本地阅读能力，并新增或强化 WebDAV 同步能力，用于私有云或自建 WebDAV 场景（坚果云、Nextcloud、群晖、WebDAV NAS 等）。上游项目仓库为 https://github.com/readest/readest 。

本项目遵循 AGPL-3.0 许可证发布，并保留上游项目与第三方组件的版权和许可证声明。

## 声明

- 非官方 Fork：本仓库不是 Readest 官方仓库，且当前仓库明确来源于上游项目 Readest。
- 功能保留：保留核心阅读能力与 WebDAV 同步能力。
- 许可证：沿用并遵循 AGPL-3.0，LICENSE 保持许可证正文，Fork 归属与额外版权说明见 NOTICE.md。

## 功能对比

| 能力 | 原版 Readest | OpenReadest |
|---|---:|---:|
| EPUB/PDF/FB2/MOBI/CBZ 阅读 | ✅ | ✅ |
| 批注/书签/进度 | ✅ | ✅ |
| 多端支持（桌面/移动） | ✅ | ✅ |
| WebDAV 同步 | 部分/无内置场景 | ✅ 强化 |


## 已移除能力

- 账号登录
- 原项目云空间
- 付费订阅与支付
- 遥测与错误上报
- Discord Rich Presence

## 下载

安装包不再存放在仓库目录中。发布版本应通过 GitHub Releases 或其他独立分发渠道提供。

## WebDAV 配置（简要）

1. 打开应用设置中的 WebDAV 相关入口。
2. 填写服务地址、用户名、密码、远程目录。
3. 执行连接测试后保存。
4. 选择同步方向或双向同步并开始。

建议远程目录使用独立目录（如 `/OpenReadest`），避免与其他程序混用。

## 版权与许可

- 上游项目：Readest（https://github.com/readest/readest），原始版权归 Bilingify LLC 与 Readest contributors 所有。
- Fork 修改：OpenReadest 的新增与修改部分版权归 luyishui 所有。
- 许可证文本：详见 [LICENSE](LICENSE)。
- Fork 归属与额外版权说明：详见 [NOTICE.md](NOTICE.md)。
- 第三方组件：各自许可证继续按原要求保留与分发。

如果你分发修改后的版本，仍应继续保留上游版权、许可证文本与第三方许可证声明。

## 使用的上游组件

- Tauri 与 tauri-plugins：提供桌面与移动端打包、系统能力桥接与插件基础设施。
- foliate-js：提供 EPUB、FB2、MOBI、CBZ 等电子书解析与渲染能力。
- simplecc-wasm 与 OpenCC：提供简繁转换相关能力。
- pdf.js：提供 PDF 阅读相关能力。

本仓库保留当前发布与构建需要的上游源码快照、许可证与必要说明，但不会把这些上游项目各自的完整仓库历史作为 OpenReadest 主仓库的一部分继续公开分发。

## 发布说明

公开仓库默认不提交打包产物、构建缓存与本地生成目录。最终发布前请通过独立构建流程生成 Windows 与 Android 安装包。
