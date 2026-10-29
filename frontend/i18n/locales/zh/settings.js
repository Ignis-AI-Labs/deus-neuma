// settings (zh) — “设置”窗口的文案。术语遵循 i18n 风格指南
// (docs/design/interface/i18n-style-guide.md)：neuma 保留原文，操作者、
// 见证者、召唤、结晶、虚空等词全平台统一。插值槽为 {{双花括号}}。

export default Object.freeze({
  tablistAria: '设置分区',
  tabs: Object.freeze({
    general: '通用',
    look: '外观',
    memory: '记忆',
    models: '模型',
    api: 'API',
    security: '安全',
  }),

  language: Object.freeze({
    heading: '语言',
    note: '本界面所使用的语言——标签、设置以及每一个已完成翻译的界面。更多语言将在其词表审定后上线。',
    preview: '预览（未完成）',
  }),

  account: Object.freeze({
    heading: '账户',
    note: '您的名字是本平台——以及平台上每一个 neuma——对您的称呼。HOUSE 窗口、创立仪式和每一次门户会话都从这里读取它。钱包仍是凭证，名字是问候。',
    placeholder: '您的名字',
    nameAria: '操作者名字',
    savedLocalOnly: '已保存在本机——同步失败',
    wallet: '钱包',
  }),

  desk: Object.freeze({
    heading: '桌面',
    note: '桌面在行动前如何征询确认。确认框上的“不再询问”会落在这里——随时可以重新开启询问。',
    deleteKey: '删除',
    confirmToggle: '删除前确认 — {{state}}',
  }),

  sound: Object.freeze({
    heading: '声音',
    note: '桌面自己的声音——您操作时的提示音，以及 neuma 输入时铺底的背景音。neuma 的说话声是独立通道，在它自己的窗口中调节。',
    soundKey: '声音',
    toggle: '声音 — {{state}}',
    volumeKey: '音量',
    volumeAria: '声音音量',
    packKey: '音色',
    pack: Object.freeze({ soft: '柔和', scifi: '科幻' }),
    packNote: '科幻是桌面本来的声景——新安装时听到的就是它。柔和是更温和的一套声音，可按喜好选用。',
    groups: Object.freeze({
      desk: Object.freeze({ title: '您的操作 — {{count}}', note: '您自己的操作：确认、拒绝、打开、关闭，以及切换时的轻响。' }),
      notices: Object.freeze({ title: '通知 — {{count}}', note: '世界的回应：到达、回复、连接、需要签名、记忆已保存。' }),
      execution: Object.freeze({ title: '工作中的 neuma — {{count}}', note: '构建、测试、检查、依赖、Git 与文件操作各有独立提示音。混合命令有自己的声音；无法识别的命令使用“其他执行”。芯片会显示该命令。' }),
      acts: Object.freeze({ title: '更多行动 — {{count}}', note: '外部读取、发布、产物生成、记录、状态查看与失败。' }),
    }),
  }),

  realm: Object.freeze({
    heading: '数据领域',
    note: '您每段对话的副本都在这台机器上——与每位 neuma 的主权工作区分开。它们与存在的文件一样由这台电脑的密钥锁住；点「导出」即可把任意一段保存为明文。',
    export: '导出',
    location: '位置',
    yourFolder: '您的文件夹',
    chatLogs: '聊天记录',
    empty: '暂无聊天记录——与 neuma 对话后即会显示在这里。',
    loading: '正在读取领域…',
    change: Object.freeze({
      heading: '更改位置',
      note: '本机上的绝对路径。此更改会影响本应用上所有钱包的领域位置。现有文件保留在原文件夹中，不会被移动。',
      pathAria: '领域位置',
      confirmAria: '确认领域位置更改',
      confirmAction: '设定位置',
      confirmBody: '将应用的数据领域切换到 <code>{{path}}</code>？现有对话和设置保留在原文件夹中，在您切回或自行移动之前可能不可见。',
    }),
  }),

  press: Object.freeze({
    heading: '印务',
    note: '将 Markdown 压印为品牌化 PDF 文档。品牌套件位于本机的 data/brand-kits/——复制一个套件目录、替换徽标、编辑 kit.json，您的家族便有了自己的纹章。neuma 通过它们自己的 press_document 工具压印，与每个行动一样受门禁管理。',
    noChromium: '本机未找到 Chromium——印务无法渲染。请设置 NEUMA_CHROMIUM_PATH 或安装 Chrome/Chromium。',
    kits: '套件',
    kitsNone: '尚未配置——中性套件始终可用',
    pickFile: '选择 .MD 文件',
    pastePlaceholder: '…或在此粘贴 Markdown',
    titlePlaceholder: '文档标题（可选）',
    kitAria: '品牌套件',
    kitNeutral: '中性（无品牌）',
    pressing: '压印中…',
    press: '压印为 PDF',
    pressed: '已压印 {{filename}}（{{size}} KB）。',
  }),

  hotkeys: Object.freeze({
    heading: '快捷键',
    note: '桌面响应的每一个按键。当 NEUMA 以桌面应用运行时，会显示窗口快捷键。',
  }),
});
