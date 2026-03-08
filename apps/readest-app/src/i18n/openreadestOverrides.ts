import type i18n from 'i18next';

const BRAND_OVERRIDES: Record<string, string> = {
  'About OpenReadest': 'About Readest',
  'Download OpenReadest': 'Download Readest',
  'Exported from OpenReadest': 'Exported from Readest',
};

const EXPLICIT_OVERRIDES: Record<string, Record<string, string>> = {
  en: {
    License: 'License',
    'Project Links': 'Project Links',
    'GitHub Homepage': 'GitHub Homepage',
    '赞助一下': 'Support OpenReadest',
    '检查更新': 'Check for Updates',
    'OpenReadest Support': 'OpenReadest Support',
    'OpenReadest Update': 'OpenReadest Update',
    '请作者吃个鸡腿儿': 'Buy the maintainer a drumstick',
    'OpenReadest 是 Readest 的独立分支，继续维护 EPUB、PDF、TXT 等阅读能力，并补强 WebDAV 同步与本地优先体验。':
      'OpenReadest is an independent Readest fork focused on EPUB, PDF, TXT reading, stronger WebDAV sync, and a local-first library experience.',
    '如果这些改动帮你把书库稳定用起来了，可以扫下面这张码支持一下开发、测试设备和持续更新。':
      'If these improvements made your library stable enough to use daily, you can support development, device testing, and ongoing updates by scanning the code below.',
    '长按保存赞助码': 'Long press to save the support code',
    '保存后可在支付宝扫一扫里从相册识别，也可以直接点击下方按钮。':
      'After saving, open Alipay scanner and choose it from your photo album, or use the button below.',
    '长按试试': 'Long press',
    '赞助码已保存，请打开支付宝扫一扫并从相册选择它。':
      'Support code saved. Open Alipay scanner and choose it from your photo album.',
    '已取消保存。': 'Save cancelled.',
    '保存赞助码失败，请稍后重试。': 'Failed to save the support code. Please try again later.',
    '当前环境不支持直接唤起支付宝，请先保存图片后手动扫码。':
      'This environment cannot open Alipay directly. Please save the image first and scan it manually.',
    '如果支付宝没有自动进入扫一扫，请在支付宝里手动打开扫一扫。':
      'If Alipay did not open the scanner automatically, please open the scanner manually inside Alipay.',
    '未能直接唤起支付宝，请先保存图片后在支付宝扫一扫中从相册识别。':
      'Could not open Alipay directly. Please save the image first and scan it from your photo album inside Alipay.',
    '感谢您的鸡腿儿': 'Thanks for the drumstick',
    '下次一定': 'Maybe next time',
    '长按海报即可保存赞助码。': 'Long press the poster to save the support code.',
    '保存中...': 'Saving...',
    '赞助码准备中': 'Support code is being prepared',
    '收款码已就绪': 'Support code is ready',
    '当前页面先使用 OpenReadest logo 占位，后续会切换为可远程替换的赞助二维码。':
      'This page is temporarily using the OpenReadest logo as a placeholder. It will later switch to a remotely replaceable support QR code.',
    'Android 端可以继续长按图片保存；桌面端会显示显式按钮，避免把长按当成主要操作。':
      'Android can keep using long press to save the code. Desktop now shows explicit buttons instead of relying on a long press gesture.',
    'Windows 和桌面端改为“保存图片 / 打开大图 / 复制链接”操作，不再依赖长按。':
      'Windows and desktop now use explicit save, open, and copy-link actions instead of relying on long press.',
    '敬请期待': 'Coming soon',
    '可测试': 'Ready for testing',
    '关注项目进展': 'Follow project updates',
    '收款码链接已复制。': 'Support code link copied.',
    '复制收款码链接失败。': 'Failed to copy the support code link.',
    '收款码已开始保存，请到下载目录查看。': 'Saving the support code has started. Check your Downloads folder.',
    '保存收款码': 'Save support code',
    '打开大图': 'Open full image',
    '复制收款码链接': 'Copy support code link',
    '查看发布页': 'View release page',
    '当前版本 {{version}}': 'Current version {{version}}',
    '推荐分发通道：{{channel}}': 'Recommended distribution channel: {{channel}}',
    'OpenReadest 的独立更新源正在接入中。当前阶段先保留独立“检查更新”页面，后续会接上远程版本信息、更新日志和下载分发。':
      'OpenReadest is wiring up its independent update source. For now, this separate update page is kept in place and will later connect remote version info, changelogs, and downloads.',
    '现在你可以先通过项目主页查看最新进展；Android 包会继续按 ARM64 优先提供。':
      'For now, you can check the project homepage for the latest progress. Android builds will continue to prioritize ARM64 packages.',
    '打开项目主页': 'Open project homepage',
    '查看最新发布说明': 'View latest release notes',
    '使用系统文件管理器选择文件夹': 'Use the system file manager to choose a folder',
    'Quick Select Common Folders': 'Quick Select Common Folders',
    '常用目录快速选择': 'Quick Select Common Folders',
    'Move Current Data': 'Move Current Data',
    'Use Existing Readest Data': 'Use Existing Readest Data',
    'Existing Readest Data': 'Existing Readest Data',
    'New Data Location': 'New Data Location',
    'Choose Different Existing Folder': 'Choose Different Existing Folder',
    'Choose Existing Folder': 'Choose Existing Folder',
    'Choose Different Folder': 'Choose Different Folder',
    'Choose New Folder': 'Choose New Folder',
    'Select the folder that already contains Readest data, or its parent folder.':
      'Select the folder that already contains Readest data, or its parent folder.',
    'Use Existing Data': 'Use Existing Data',
    'Current Data Location': 'Current Data Location',
    'File count: {{size}}': 'File count: {{size}}',
    'Total size: {{size}}': 'Total size: {{size}}',
    'Calculating file info...': 'Calculating file info...',
    'Connecting existing data...': 'Connecting existing data...',
    'Migrating data...': 'Migrating data...',
    'Copying: {{file}}': 'Copying: {{file}}',
    '{{current}} of {{total}} files': '{{current}} of {{total}} files',
    'Existing data connected successfully!': 'Existing data connected successfully!',
    'Migration completed successfully!': 'Migration completed successfully!',
    'Your data has been moved to the new location. Please restart the application to complete the process.':
      'Your data has been moved to the new location. Please restart the application to complete the process.',
    'Migration failed': 'Migration failed',
    'Important Notice': 'Important Notice',
    'This will move all your app data to the new location. Make sure the destination has enough free space.':
      'This will move all your app data to the new location. Make sure the destination has enough free space.',
    'Change Data Location': 'Change Data Location',
    'Failed to select directory': 'Failed to select directory',
    'No compatible Readest data was found in the selected folder.':
      'No compatible Readest data was found in the selected folder.',
    'The selected data location is already in use.':
      'The selected data location is already in use.',
    'The new data directory must be different from the current one.':
      'The new data directory must be different from the current one.',
    'Failed to use the selected data: {{error}}': 'Failed to use the selected data: {{error}}',
    'Migration failed: {{error}}': 'Migration failed: {{error}}',
    'OpenReadest is an independent fork and continued re-development of Readest.':
      'OpenReadest is an independent fork and continued re-development of Readest.',
    'Copyright (c) 2026 luyishui. Based on Readest, originally developed by Bilingify LLC.':
      'Copyright (c) 2026 luyishui. Based on Readest, originally developed by Bilingify LLC.',
    'Get Help from the Readest Community': 'Get Help from the OpenReadest Community',
    'Need help? Contact our support team at support@readest.com':
      'Need help? Please open an issue in the OpenReadest repository.',
    'Choose a new folder for OpenReadest to move its data into.':
      'Choose a new folder for OpenReadest to move its data into.',
    'OpenReadest will use the selected Readest data after restart. Please restart the application to complete the switch.':
      'OpenReadest will use the selected Readest data after restart. Please restart the application to complete the switch.',
    'This will switch OpenReadest to the selected Readest data location. Make sure you selected the library you want to continue using.':
      'This will switch OpenReadest to the selected Readest data location. Make sure you selected the library you want to continue using.',
  },
  'zh-CN': {
    License: '许可证',
    'Project Links': '项目链接',
    'GitHub Homepage': 'GitHub 主页',
    '赞助一下': '赞助一下',
    '检查更新': '检查更新',
    'OpenReadest Support': 'OpenReadest Support',
    'OpenReadest Update': 'OpenReadest Update',
    '请作者吃个鸡腿儿': '请作者吃个鸡腿儿',
    'OpenReadest 是 Readest 的独立分支，继续维护 EPUB、PDF、TXT 等阅读能力，并补强 WebDAV 同步与本地优先体验。':
      'OpenReadest 是 Readest 的独立分支，继续维护 EPUB、PDF、TXT 等阅读能力，并补强 WebDAV 同步与本地优先体验。',
    '如果这些改动帮你把书库稳定用起来了，可以扫下面这张码支持一下开发、测试设备和持续更新。':
      '如果这些改动帮你把书库稳定用起来了，可以扫下面这张码支持一下开发、测试设备和持续更新。',
    '长按保存赞助码': '长按保存赞助码',
    '保存后可在支付宝扫一扫里从相册识别，也可以直接点击下方按钮。':
      '保存后可在支付宝扫一扫里从相册识别，也可以直接点击下方按钮。',
    '长按试试': '长按试试',
    '赞助码已保存，请打开支付宝扫一扫并从相册选择它。':
      '赞助码已保存，请打开支付宝扫一扫并从相册选择它。',
    '已取消保存。': '已取消保存。',
    '保存赞助码失败，请稍后重试。': '保存赞助码失败，请稍后重试。',
    '当前环境不支持直接唤起支付宝，请先保存图片后手动扫码。':
      '当前环境不支持直接唤起支付宝，请先保存图片后手动扫码。',
    '如果支付宝没有自动进入扫一扫，请在支付宝里手动打开扫一扫。':
      '如果支付宝没有自动进入扫一扫，请在支付宝里手动打开扫一扫。',
    '未能直接唤起支付宝，请先保存图片后在支付宝扫一扫中从相册识别。':
      '未能直接唤起支付宝，请先保存图片后在支付宝扫一扫中从相册识别。',
    '感谢您的鸡腿儿': '感谢您的鸡腿儿',
    '下次一定': '下次一定',
    '长按海报即可保存赞助码。': '长按海报即可保存赞助码。',
    '保存中...': '保存中...',
    '赞助码准备中': '赞助码准备中',
    '收款码已就绪': '收款码已就绪',
    '当前页面先使用 OpenReadest logo 占位，后续会切换为可远程替换的赞助二维码。':
      '当前页面先使用 OpenReadest logo 占位，后续会切换为可远程替换的赞助二维码。',
    'Android 端可以继续长按图片保存；桌面端会显示显式按钮，避免把长按当成主要操作。':
      'Android 端可以继续长按图片保存；桌面端会显示显式按钮，避免把长按当成主要操作。',
    'Windows 和桌面端改为“保存图片 / 打开大图 / 复制链接”操作，不再依赖长按。':
      'Windows 和桌面端改为“保存图片 / 打开大图 / 复制链接”操作，不再依赖长按。',
    '敬请期待': '敬请期待',
    '可测试': '可测试',
    '关注项目进展': '关注项目进展',
    '收款码链接已复制。': '收款码链接已复制。',
    '复制收款码链接失败。': '复制收款码链接失败。',
    '收款码已开始保存，请到下载目录查看。': '收款码已开始保存，请到下载目录查看。',
    '保存收款码': '保存收款码',
    '打开大图': '打开大图',
    '复制收款码链接': '复制收款码链接',
    '查看发布页': '查看发布页',
    '当前版本 {{version}}': '当前版本 {{version}}',
    '推荐分发通道：{{channel}}': '推荐分发通道：{{channel}}',
    'OpenReadest 的独立更新源正在接入中。当前阶段先保留独立“检查更新”页面，后续会接上远程版本信息、更新日志和下载分发。':
      'OpenReadest 的独立更新源正在接入中。当前阶段先保留独立“检查更新”页面，后续会接上远程版本信息、更新日志和下载分发。',
    '现在你可以先通过项目主页查看最新进展；Android 包会继续按 ARM64 优先提供。':
      '现在你可以先通过项目主页查看最新进展；Android 包会继续按 ARM64 优先提供。',
    '打开项目主页': '打开项目主页',
    '查看最新发布说明': '查看最新发布说明',
    '使用系统文件管理器选择文件夹': '使用系统文件管理器选择文件夹',
    'Quick Select Common Folders': '常用目录快速选择',
    '常用目录快速选择': '常用目录快速选择',
    'Move Current Data': '迁移当前数据',
    'Use Existing Readest Data': '使用现有 Readest 数据',
    'Existing Readest Data': '现有 Readest 数据',
    'New Data Location': '新的数据位置',
    'Choose Different Existing Folder': '重新选择现有数据文件夹',
    'Choose Existing Folder': '选择现有数据文件夹',
    'Choose Different Folder': '重新选择文件夹',
    'Choose New Folder': '选择新文件夹',
    'Select the folder that already contains Readest data, or its parent folder.':
      '选择已经包含 Readest 数据的文件夹，或者它的上级文件夹。',
    'Use Existing Data': '使用现有数据',
    'Current Data Location': '当前数据位置',
    'File count: {{size}}': '文件数量：{{size}}',
    'Total size: {{size}}': '总大小：{{size}}',
    'Calculating file info...': '正在统计文件信息...',
    'Connecting existing data...': '正在连接现有数据...',
    'Migrating data...': '正在迁移数据...',
    'Copying: {{file}}': '正在复制：{{file}}',
    '{{current}} of {{total}} files': '第 {{current}} / {{total}} 个文件',
    'Existing data connected successfully!': '现有数据连接成功！',
    'Migration completed successfully!': '数据迁移完成！',
    'Your data has been moved to the new location. Please restart the application to complete the process.':
      '你的数据已经迁移到新位置。请重启应用以完成整个过程。',
    'Migration failed': '迁移失败',
    'Important Notice': '重要提示',
    'This will move all your app data to the new location. Make sure the destination has enough free space.':
      '这将把所有应用数据移动到新位置。请确认目标位置有足够的可用空间。',
    'Change Data Location': '更改数据位置',
    'Failed to select directory': '选择文件夹失败',
    'No compatible Readest data was found in the selected folder.':
      '在所选文件夹中没有找到兼容的 Readest 数据。',
    'The selected data location is already in use.':
      '所选数据位置已经在使用中。',
    'The new data directory must be different from the current one.':
      '新的数据目录不能与当前目录相同。',
    'Failed to use the selected data: {{error}}': '使用所选数据失败：{{error}}',
    'Migration failed: {{error}}': '迁移失败：{{error}}',
    'OpenReadest is an independent fork and continued re-development of Readest.':
      'OpenReadest 是基于 Readest 的独立分支与持续再开发版本。',
    'Copyright (c) 2026 luyishui. Based on Readest, originally developed by Bilingify LLC.':
      '版权所有 (c) 2026 luyishui。项目基于 Readest，原始版本由 Bilingify LLC 开发。',
    'Get Help from the Readest Community': '从 OpenReadest 社区获取帮助',
    'Need help? Contact our support team at support@readest.com':
      '需要帮助？请前往 OpenReadest 仓库提交 issue。',
    'Choose a new folder for OpenReadest to move its data into.':
      '为 OpenReadest 选择一个新的文件夹，用于迁移当前数据。',
    'OpenReadest will use the selected Readest data after restart. Please restart the application to complete the switch.':
      'OpenReadest 将在重启后使用所选的 Readest 数据。请重新启动应用以完成切换。',
    'This will switch OpenReadest to the selected Readest data location. Make sure you selected the library you want to continue using.':
      '这将把 OpenReadest 切换到所选的 Readest 数据位置。请确认你选择的是准备继续使用的书库。',
  },
  'zh-TW': {
    License: '授權條款',
    'Project Links': '專案連結',
    'GitHub Homepage': 'GitHub 首頁',
    '赞助一下': '贊助一下',
    '检查更新': '檢查更新',
    'OpenReadest Support': 'OpenReadest Support',
    'OpenReadest Update': 'OpenReadest Update',
    '请作者吃个鸡腿儿': '請作者吃個雞腿兒',
    'OpenReadest 是 Readest 的独立分支，继续维护 EPUB、PDF、TXT 等阅读能力，并补强 WebDAV 同步与本地优先体验。':
      'OpenReadest 是 Readest 的獨立分支，持續維護 EPUB、PDF、TXT 等閱讀能力，並補強 WebDAV 同步與本地優先體驗。',
    '如果这些改动帮你把书库稳定用起来了，可以扫下面这张码支持一下开发、测试设备和持续更新。':
      '如果這些改動讓你的書庫穩定可用了，可以掃下面這張碼支持開發、測試設備與後續更新。',
    '长按保存赞助码': '長按保存贊助碼',
    '保存后可在支付宝扫一扫里从相册识别，也可以直接点击下方按钮。':
      '保存後可在支付寶掃一掃中從相簿識別，也可以直接點擊下方按鈕。',
    '长按试试': '長按試試',
    '赞助码已保存，请打开支付宝扫一扫并从相册选择它。':
      '贊助碼已保存，請打開支付寶掃一掃並從相簿選擇它。',
    '已取消保存。': '已取消保存。',
    '保存赞助码失败，请稍后重试。': '保存贊助碼失敗，請稍後再試。',
    '当前环境不支持直接唤起支付宝，请先保存图片后手动扫码。':
      '目前環境不支援直接喚起支付寶，請先保存圖片後手動掃碼。',
    '如果支付宝没有自动进入扫一扫，请在支付宝里手动打开扫一扫。':
      '如果支付寶沒有自動進入掃一掃，請在支付寶內手動打開掃一掃。',
    '未能直接唤起支付宝，请先保存图片后在支付宝扫一扫中从相册识别。':
      '未能直接喚起支付寶，請先保存圖片後在支付寶掃一掃中從相簿識別。',
    '感谢您的鸡腿儿': '感謝您的雞腿兒',
    '下次一定': '下次一定',
    '长按海报即可保存赞助码。': '長按海報即可保存贊助碼。',
    '保存中...': '保存中...',
    '赞助码准备中': '贊助碼準備中',
    '收款码已就绪': '收款碼已就緒',
    '当前页面先使用 OpenReadest logo 占位，后续会切换为可远程替换的赞助二维码。':
      '目前頁面先使用 OpenReadest logo 作為佔位，後續會切換為可遠端替換的贊助 QR 碼。',
    'Android 端可以继续长按图片保存；桌面端会显示显式按钮，避免把长按当成主要操作。':
      'Android 端可以繼續長按圖片保存；桌面端會顯示明確按鈕，避免把長按當成主要操作。',
    'Windows 和桌面端改为“保存图片 / 打开大图 / 复制链接”操作，不再依赖长按。':
      'Windows 與桌面端改為「保存圖片 / 打開大圖 / 複製連結」操作，不再依賴長按。',
    '敬请期待': '敬請期待',
    '可测试': '可測試',
    '关注项目进展': '關注專案進展',
    '收款码链接已复制。': '收款碼連結已複製。',
    '复制收款码链接失败。': '複製收款碼連結失敗。',
    '收款码已开始保存，请到下载目录查看。': '收款碼已開始保存，請到下載目錄查看。',
    '保存收款码': '保存收款碼',
    '打开大图': '打開大圖',
    '复制收款码链接': '複製收款碼連結',
    '查看发布页': '查看發佈頁',
    '当前版本 {{version}}': '目前版本 {{version}}',
    '推荐分发通道：{{channel}}': '推薦分發通道：{{channel}}',
    'OpenReadest 的独立更新源正在接入中。当前阶段先保留独立“检查更新”页面，后续会接上远程版本信息、更新日志和下载分发。':
      'OpenReadest 的獨立更新來源正在接入中。現階段先保留獨立「檢查更新」頁面，後續會接上遠端版本資訊、更新日誌與下載分發。',
    '现在你可以先通过项目主页查看最新进展；Android 包会继续按 ARM64 优先提供。':
      '現在你可以先透過專案首頁查看最新進展；Android 套件會繼續以 ARM64 為優先。',
    '打开项目主页': '打開專案首頁',
    '查看最新发布说明': '查看最新發佈說明',
    '使用系统文件管理器选择文件夹': '使用系統檔案管理器選擇資料夾',
    'Quick Select Common Folders': '常用目錄快速選擇',
    '常用目录快速选择': '常用目錄快速選擇',
    'Move Current Data': '遷移目前資料',
    'Use Existing Readest Data': '使用現有 Readest 資料',
    'Existing Readest Data': '現有 Readest 資料',
    'New Data Location': '新的資料位置',
    'Choose Different Existing Folder': '重新選擇現有資料夾',
    'Choose Existing Folder': '選擇現有資料夾',
    'Choose Different Folder': '重新選擇資料夾',
    'Choose New Folder': '選擇新資料夾',
    'Select the folder that already contains Readest data, or its parent folder.':
      '選擇已經包含 Readest 資料的資料夾，或它的上層資料夾。',
    'Use Existing Data': '使用現有資料',
    'Current Data Location': '目前資料位置',
    'File count: {{size}}': '檔案數量：{{size}}',
    'Total size: {{size}}': '總大小：{{size}}',
    'Calculating file info...': '正在統計檔案資訊...',
    'Connecting existing data...': '正在連接現有資料...',
    'Migrating data...': '正在遷移資料...',
    'Copying: {{file}}': '正在複製：{{file}}',
    '{{current}} of {{total}} files': '第 {{current}} / {{total}} 個檔案',
    'Existing data connected successfully!': '現有資料連接成功！',
    'Migration completed successfully!': '資料遷移完成！',
    'Your data has been moved to the new location. Please restart the application to complete the process.':
      '你的資料已經移動到新位置。請重新啟動應用程式以完成整個流程。',
    'Migration failed': '遷移失敗',
    'Important Notice': '重要提示',
    'This will move all your app data to the new location. Make sure the destination has enough free space.':
      '這將把所有應用資料移動到新位置。請確認目標位置有足夠的可用空間。',
    'Change Data Location': '更改資料位置',
    'Failed to select directory': '選擇資料夾失敗',
    'No compatible Readest data was found in the selected folder.':
      '在所選資料夾中沒有找到相容的 Readest 資料。',
    'The selected data location is already in use.':
      '所選資料位置已經在使用中。',
    'The new data directory must be different from the current one.':
      '新的資料目錄不能與目前目錄相同。',
    'Failed to use the selected data: {{error}}': '使用所選資料失敗：{{error}}',
    'Migration failed: {{error}}': '遷移失敗：{{error}}',
    'OpenReadest is an independent fork and continued re-development of Readest.':
      'OpenReadest 是基於 Readest 的獨立分支與持續再開發版本。',
    'Copyright (c) 2026 luyishui. Based on Readest, originally developed by Bilingify LLC.':
      '版權所有 (c) 2026 luyishui。此專案基於 Readest，原始版本由 Bilingify LLC 開發。',
    'Get Help from the Readest Community': '從 OpenReadest 社群獲取幫助',
    'Need help? Contact our support team at support@readest.com':
      '需要協助？請前往 OpenReadest 倉庫提交 issue。',
    'Choose a new folder for OpenReadest to move its data into.':
      '為 OpenReadest 選擇一個新的資料夾，用來遷移目前資料。',
    'OpenReadest will use the selected Readest data after restart. Please restart the application to complete the switch.':
      'OpenReadest 將在重新啟動後使用所選的 Readest 資料。請重新啟動應用程式以完成切換。',
    'This will switch OpenReadest to the selected Readest data location. Make sure you selected the library you want to continue using.':
      '這將把 OpenReadest 切換到所選的 Readest 資料位置。請確認你選擇的是準備繼續使用的書庫。',
  },
};

const resolveExplicitOverrides = (lng: string) => {
  if (EXPLICIT_OVERRIDES[lng]) {
    return EXPLICIT_OVERRIDES[lng]!;
  }

  if (lng === 'zh-HK') {
    return EXPLICIT_OVERRIDES['zh-TW']!;
  }

  return EXPLICIT_OVERRIDES['en']!;
};

export const applyOpenReadestTranslationOverrides = (instance: typeof i18n, lng: string) => {
  const bundle = instance.getResourceBundle(lng, 'translation');
  if (!bundle) {
    return;
  }

  const overrides: Record<string, string> = { ...resolveExplicitOverrides(lng) };

  for (const [targetKey, sourceKey] of Object.entries(BRAND_OVERRIDES)) {
    const sourceValue = bundle[sourceKey];
    if (typeof sourceValue === 'string' && sourceValue.trim()) {
      overrides[targetKey] = sourceValue.replaceAll('Readest', 'OpenReadest');
    }
  }

  instance.addResourceBundle(lng, 'translation', overrides, true, true);
};