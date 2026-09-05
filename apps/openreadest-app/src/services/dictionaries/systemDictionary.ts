/**
 * 系统词典（OS 自带词典）接入：可行性评估 + 防御性占位实现。
 *
 * ── 可行性结论（Part 2.5，2026-09）──────────────────────────────
 *
 * 上游 readest 0.11.20 在三个原生平台实现了系统词典（services/
 * dictionaries/systemDictionary.ts + src-tauri/src/macos/
 * system_dictionary.rs）：
 *
 * - macOS：Rust `show_lookup_popover` 命令调 AppKit
 *   `-[NSView showDefinitionForAttributedString:atPoint:]`，显示与
 *   「右键 → 查询」相同的系统 HUD 弹层。上游实现约 365 行，需新增
 *   objc / cocoa / block crate，并处理窗口 label 与锚点坐标换算。
 * - iOS：native-bridge 插件 Swift 侧新增 `show_lookup_popover` 命令，
 *   模态展示 `UIReferenceLibraryViewController`。
 * - Android：native-bridge 插件 Kotlin 侧派发 `Intent.ACTION_PROCESS_TEXT`
 *   系统选择器，交给用户安装的词典 App（ColorDict/GoldenDict/欧路/
 *   Pleco/Google 翻译等）；没有兼容 App 时返回 `unavailable: true`。
 *   Android 本身没有公开的系统词典 API，只能走第三方 App 的
 *   PROCESS_TEXT 意图。
 * - Web / Linux / Windows：上游在设置 UI 直接隐藏系统词典入口。
 *
 * 本 fork 现状（已核对 `src-tauri/plugins/tauri-plugin-native-bridge` 的
 * Swift/Kotlin 命令清单）：`show_lookup_popover` 尚未实现；`src-tauri/src`
 * 也没有 macOS 的 lookup Rust 命令。三个平台的原生改动合计约 500+ 行
 * （Rust + Swift + Kotlin + AndroidManifest/capabilities 权限），且本仓库
 * 在 Windows 上开发，无法本地编译/验证 iOS/macOS 的 AppKit/UIKit 弹层
 * （需 mac 工具链 + 真机确认 OS 弹层 UX 与 Tauri webview 的层级关系）。
 *
 * 按阶段二 Part 2.5 的降级条款：本轮不做大量原生改动，采用降级方案——
 * 系统词典在全部平台标记「不可用」（Web 端理应如此；原生端等后续有
 * mac/iOS/Android 构建环境时按上游 systemDictionary.ts 移植）。
 * 设置面板（LocalDictionaries.tsx，Part 2.6 负责）可通过
 * `isSystemDictionarySupported()` 判断，并用 i18n key
 * `'System dictionary is not available on this device.'` 展示不可用说明。
 * 查询链（WiktionaryPopup）不接入系统词典，避免不可达分支。
 */

/**
 * 当前平台是否支持系统词典。本 fork 的 native-bridge 插件尚未实现
 * `show_lookup_popover`，故恒为 false；Web/桌面端也本就不支持。
 */
export const isSystemDictionarySupported = (): boolean => false;

/**
 * 系统词典是否真正可用（区别于「支持但未安装词典 App」）。当前与
 * `isSystemDictionarySupported` 一致；保留独立函数以便以后原生端
 * 落地后，settings UI 可以区分「支持但未装词典」状态而不改调用点。
 */
export const isSystemDictionaryAvailable = (): boolean => isSystemDictionarySupported();

/** macOS 锚点提示：本 fork 未实现，保留类型以对齐上游签名。 */
export interface SystemDictionaryAnchor {
  rect: { left: number; top: number; right: number; bottom: number };
  style?: { fontSize?: number; fontFamily?: string; color?: string };
}

/**
 * 调起平台系统词典。本 fork 未实现原生侧，恒返回 false（静默 no-op，
 * 与上游对「不支持平台」的防御行为一致），调用方把它当「不可用」
 * 处理即可，不要抛错。
 */
export const invokeSystemDictionary = async (
  word: string,
  _anchor?: SystemDictionaryAnchor,
): Promise<boolean> => {
  if (!word?.trim()) return false;
  // 未移植原生桥：macOS/iOS/Android 均返回 false。
  // 移植时按上游实现：macOS invoke('show_lookup_popover', …)，
  // iOS/Android invoke('plugin:native-bridge|show_lookup_popover', …)。
  return false;
};