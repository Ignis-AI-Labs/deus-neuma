// settingsLook (zh) — LOOK 标签页（外观妆扮板）。register per i18n-style-guide.md；
// 槽 {{label}}/{{name}} 与 <em>/<strong>/<a> 标记按源目录保留。

export default Object.freeze({
  heading: '外观',
  note: '为平台着装——一切颜色都由这块妆扮板决定。表面、墨色与唯一的信号色为必选；标题字、正文、斜体、粗体与线条是可选声部——在被认领之前随墨色而行（× 可将其释放回默认）。文件夹标签与状态声保持默认色，直到被更改。更改即时生效并在重启后保留。',

  groups: Object.freeze({
    surface: Object.freeze({ title: '表面', note: '一切所依托之处' }),
    text: Object.freeze({ title: '文字', note: '你所阅读的——可选颜色可被重置' }),
    signal: Object.freeze({ title: '信号', note: '正在活动之物' }),
    registers: Object.freeze({ title: '状态声', note: '状态语汇——在被认领前保持默认' }),
  }),

  knobs: Object.freeze({
    ground: Object.freeze({ label: '底色', hint: '所有背景——虚空本身' }),
    panel: Object.freeze({ label: '面板', hint: '窗口与卡片的填充' }),
    ink: Object.freeze({ label: '墨色', hint: '光——所有未被认领的文字与边缘随此而行' }),
    head: Object.freeze({ label: '标题字', hint: '小节标题——独立于正文的自身声部' }),
    body: Object.freeze({ label: '正文', hint: '散文——会话流、笔记、文字本身' }),
    ital: Object.freeze({ label: '斜体', hint: '斜体——句中语调的一层阴影' }),
    emph: Object.freeze({ label: '粗体', hint: '粗体——重词之色' }),
    folder: Object.freeze({ label: '文件夹', hint: '标签页中的焦点文件夹——与参与者名字分开' }),
    line: Object.freeze({ label: '线条', hint: '细线与边框——独立于墨色的边缘' }),
    trim: Object.freeze({ label: '饰边', hint: '唯一的点缀色——活动数据、焦点、链接、活动标签页' }),
    alert: Object.freeze({ label: '警报', hint: '拒绝、警告、被删除的文件、待机' }),
    warn: Object.freeze({ label: '提醒', hint: '接近上限——语境量规、已修改文件' }),
    okay: Object.freeze({ label: '安然', hint: '安静的成功——新增文件、开放的余地' }),
    colorAria: '{{label}}颜色',
    hexAria: '{{label}}十六进制值',
    releaseAria: '将{{label}}释放回默认',
    releaseTitle: '释放回默认',
  }),

  specimen: Object.freeze({
    heading: '样例',
    note: '实时——这块板上的所有声部',
    headingVoice: '以自身声部写就的标题',
    body: '正文散文使用被认领的正文色，若尚未认领则用墨色。<em>斜体是语调的一层阴影。</em> <strong>粗体是句子之内的分量。</strong> <a>活动链接穿着饰边。</a>',
  }),

  presets: Object.freeze({
    heading: '预设',
    note: '出厂妆扮。一键应用。',
  }),

  yourPresets: Object.freeze({
    heading: '您的预设',
    note: '以您自己的名字保存当前妆扮。',
    placeholder: '为此妆扮命名',
    save: '保存',
    removeAria: '移除预设 {{name}}',
  }),
});
