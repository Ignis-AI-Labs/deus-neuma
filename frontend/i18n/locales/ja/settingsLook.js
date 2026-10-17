// settingsLook (ja) — LOOK タブ（外観の装いボード）。register per i18n-style-guide.md；
// スロット {{label}}/{{name}} と <em>/<strong>/<a> マーカーはソースどおり保持。

export default Object.freeze({
  heading: '外観',
  note: 'プラットフォームに装いを与える——すべての色はこのボードに従います。表面・インク・ただ一つのシグナルは必須。見出し・本文・イタリック・ボールド・罫線は任意の声で、自分の色が選ばれるまでインクに従います（× で既定へ戻せます）。フォルダのラベルとレジスターは変更するまで既定色のままです。変更は即座に反映され、再起動後も保たれます。',

  groups: Object.freeze({
    surface: Object.freeze({ title: '表面', note: 'すべてが載るもの' }),
    text: Object.freeze({ title: '文字', note: 'あなたが読むもの——任意色はリセット可' }),
    signal: Object.freeze({ title: 'シグナル', note: '生きているもの' }),
    registers: Object.freeze({ title: 'レジスター', note: '状態の声——選ばれるまで既定のまま' }),
  }),

  knobs: Object.freeze({
    ground: Object.freeze({ label: '地色', hint: 'すべての背景——虚空そのもの' }),
    panel: Object.freeze({ label: 'パネル', hint: 'ウィンドウとカードの塗り' }),
    ink: Object.freeze({ label: 'インク', hint: '光——まだ選ばれていない文字と縁はみなこれに乗る' }),
    head: Object.freeze({ label: '見出し', hint: 'セクション見出し——本文から独立した自分の声' }),
    body: Object.freeze({ label: '本文', hint: '散文——ストリーム、ノート、言葉そのもの' }),
    ital: Object.freeze({ label: 'イタリック', hint: '斜体——文中の語調の陰り' }),
    emph: Object.freeze({ label: 'ボールド', hint: '太字——強い言葉の色' }),
    folder: Object.freeze({ label: 'フォルダ', hint: 'タブ内のフォーカスフォルダ——参加者の名前とは別' }),
    line: Object.freeze({ label: '罫線', hint: '細線と罫枠——インクとは別の縁' }),
    trim: Object.freeze({ label: 'トリム', hint: 'ただ一つの差し色——活動データ、フォーカス、リンク、能動タブ' }),
    alert: Object.freeze({ label: 'アラート', hint: '拒否、警告、削除されたファイル、スタンバイ' }),
    warn: Object.freeze({ label: '警告', hint: '上限への接近——コンテキストゲージ、変更済みファイル' }),
    okay: Object.freeze({ label: '平穏', hint: '静かな成功——追加ファイル、開かれた余白' }),
    colorAria: '{{label}}の色',
    hexAria: '{{label}}のHEX',
    releaseAria: '{{label}}を既定へ戻す',
    releaseTitle: '既定へ戻す',
  }),

  specimen: Object.freeze({
    heading: '見本',
    note: 'ライブ——このボード上のすべての声',
    headingVoice: '自分の声で書かれた見出し',
    body: '本文の散文は claim された本文色で、未 claim ならインクで。<em>イタリックは語調の陰り。</em> <strong>ボールドは文中の重み。</strong> <a>活動リンクはトリムをまとう。</a>',
  }),

  presets: Object.freeze({
    heading: 'プリセット',
    note: '工場出荷時の装い。ワンクリックで適用。',
  }),

  yourPresets: Object.freeze({
    heading: 'あなたのプリセット',
    note: '今の装いに自分の名前を付けて保存。',
    placeholder: 'この装いに名前を',
    save: '保存',
    removeAria: 'プリセット {{name}} を削除',
  }),
});
