# OpenReadest

OpenReadest 是基于 Readest 的非官方 Fork，重点保留本地阅读能力，并新增或强化 WebDAV 同步能力，用于私有云或自建 WebDAV 场景（坚果云、Nextcloud、群晖、WebDAV NAS 等）。上游项目 Readest： https://github.com/readest/readest 。

本项目遵循 AGPL-3.0 许可证发布，并保留上游项目与第三方组件的版权和许可证声明。

## ⚠️ 免责声明 & 项目说明

**本项目 (OpenReadest) 是基于原项目 [Readest](https://github.com/readest/readest) 的一个独立 Fork（分支/衍生版本）。**

为了避免混淆，特此说明：

1. **独立性**：本项目与原项目 `readest/readest` 是两个相互独立的项目，拥有不同的更新计划和功能路线。
2. **功能差异**：本项目在原项目基础上增加了特定的新功能，这些修改仅代表本项目的方向。
3. **问题反馈**：如果你在使用 _本 Fork 版本_ 时遇到问题或有功能建议，请直接在本仓库 (`luyishui/OpenReadest`) 提出，不要打扰原项目的开发者。
4. **尊重原项目**：原项目的所有荣誉归原作者所有。本项目严格遵循原项目的开源协议 (AGPL-3.0) 进行分发。

感谢原项目 [Readest](https://github.com/readest/readest) 提供的优秀基础！

---

## 功能对比

| 能力                       |  原版 Readest   | OpenReadest |
| :------------------------- | :-------------: | :---------: |
| EPUB/PDF/FB2/MOBI/CBZ 阅读 |       ✅        |     ✅      |
| 批注/书签/进度             |       ✅        |     ✅      |
| 多端支持（桌面/移动）      |       ✅        |     ✅      |
| WebDAV 同步                | 部分/无内置场景 |   ✅ 强化   |
| AI 朗读（无限）            |       ✅        |     ❌      |
| DeepL 翻译                 |       ✅        |     ❌      |

> **提示：** 如需体验完整功能（AI 朗读、DeepL 翻译等），建议使用原版 Readest：https://github.com/readest/readest

## 已移除能力

- 账号登录
- 原项目云空间
- 付费订阅与功能
- 遥测与错误上报
- Discord Rich Presence
- KOReader 插件中的原 Readest 云同步入口

## 下载

当前临时构建产物可放在仓库根目录的 `release/` 目录中，便于本地测试与直接分发。

正式公开发布时，仍建议通过 GitHub Releases 或其他独立分发渠道提供。

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

## 💖 支持本项目

如果你觉得本项目对你有帮助，欢迎考虑支持项目的持续维护和开发。你的支持将用于服务器成本、代码维护以及新功能的开发。

### 捐赠方式

可以扫码支持项目维护：

![OpenReadest 捐赠码](./assets/donate.jpg)
