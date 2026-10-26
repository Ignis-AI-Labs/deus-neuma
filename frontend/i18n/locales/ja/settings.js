// settings (ja) — 設定ウィンドウの文言。用語は i18n スタイルガイド
// (docs/design/interface/i18n-style-guide.md) に従う：neuma はカタカナ
// 「ネウマ」、オペレーター・ウィットネス・召喚・結晶化・虚空は全画面で
// 統一。補間スロットは {{二重ブレース}}。

export default Object.freeze({
  tablistAria: '設定セクション',
  tabs: Object.freeze({
    general: '一般',
    look: '外観',
    memory: 'メモリー',
    models: 'モデル',
    api: 'API',
    security: 'セキュリティ',
  }),

  language: Object.freeze({
    heading: '言語',
    note: 'このデスクが話す言語——ラベル、設定、翻訳が完了したすべての画面。カタログが承認され次第、さらに言語が追加されます。',
    preview: 'プレビュー（未完成）',
  }),

  account: Object.freeze({
    heading: 'アカウント',
    note: 'あなたの名前は、このプラットフォーム——そして平台上のすべてのネウマ——があなたを呼ぶ言葉です。HOUSE ウィンドウ、創立の儀式、各ポータルターンがここから読み取ります。ウォレットは証明のまま、名前は挨拶です。',
    placeholder: 'あなたの名前',
    nameAria: 'オペレーター名',
    savedLocalOnly: 'この端末に保存——同期失敗',
    wallet: 'ウォレット',
  }),

  desk: Object.freeze({
    heading: 'デスク',
    note: 'デスクが行動前に確認する方法です。確認ダイアログの「今後は聞かない」はここに保存されます——確認はいつでも再び有効にできます。',
    deleteKey: '削除',
    confirmToggle: '削除前に確認 — {{state}}',
  }),

  sound: Object.freeze({
    heading: 'サウンド',
    note: 'デスク自身の声——あなたの操作に応えるキューと、ネウマの入力の下に流れるベッド。ネウマの話し声は別チャンネルで、専用のウィンドウで調整します。',
    soundKey: 'サウンド',
    toggle: 'サウンド — {{state}}',
    volumeKey: '音量',
    volumeAria: 'サウンド音量',
    executionTitle: '実行とファイル — {{count}}',
    executionNote: 'ビルド、テスト、チェック、依存関係、Git とファイル操作にはそれぞれ専用のキューがあります。混合コマンドには独自の音が、認識されないコマンドには「その他の実行」が使われます。チップにはコマンドが表示されます。',
    actsTitle: 'アクト — {{count}}',
    actsNote: '外部の読み取り、公開、アーティファクト生成、記録、状態の確認と失敗。これらの候補サウンドをここで試聴してください。',
    worldTitle: '世界 — {{count}}',
    worldNote: '承認済みのサウンドスケープ——ポータル、ストリーム、セレモニー。耳で確定済みです。ここで聴き比べてください。',
  }),

  realm: Object.freeze({
    heading: 'データレルム',
    note: 'すべての会話のあなた自身のコピーです。このマシン上にあり、各ネウマの主権ワークスペースとは別です。存在たちのファイルと同じく、このコンピューターの鍵で施錠されています。「書き出す」で、どれでも平文として手元に残せます。',
    export: '書き出す',
    location: '場所',
    yourFolder: 'あなたのフォルダ',
    chatLogs: 'チャットログ',
    empty: 'まだチャットが記録されていません——ネウマと話すとここに表示されます。',
    loading: 'レルムを読み込んでいます…',
    change: Object.freeze({
      heading: '場所を変更',
      note: 'このマシン上の絶対パス。このアプリのすべてのウォレットのレルム場所が変わります。既存のファイルは現在のフォルダに残り、移動されません。',
      pathAria: 'レルムの場所',
      confirmAria: 'レルム場所の変更を確認',
      confirmAction: '場所を設定',
      confirmBody: 'アプリのデータレルムを <code>{{path}}</code> に切り替えますか？既存の会話と設定は以前のフォルダに残り、切り戻すか自分で移動するまで表示されない場合があります。',
    }),
  }),

  press: Object.freeze({
    heading: 'プレス',
    note: 'Markdown をブランド付き PDF ドキュメントにプレスします。ブランドキットはこのマシンの data/brand-kits/ にあります——キットのディレクトリを複製し、ロゴを差し替え、kit.json を編集すれば、あなたのハウス独自の装いになります。ネウマは専用の press_document ツールでプレスし、すべてのアクトと同様にゲートで管理されます。',
    noChromium: 'このマシンに Chromium が見つかりません——プレスはレンダリングできません。NEUMA_CHROMIUM_PATH を設定するか、Chrome/Chromium をインストールしてください。',
    kits: 'キット',
    kitsNone: '未設定——ニュートラルキットは常に利用できます',
    pickFile: '.MD ファイルを選択',
    pastePlaceholder: '…またはここに Markdown を貼り付け',
    titlePlaceholder: 'ドキュメントタイトル（任意）',
    kitAria: 'ブランドキット',
    kitNeutral: 'ニュートラル（ブランドなし）',
    pressing: 'プレス中…',
    press: 'PDF にプレス',
    pressed: '{{filename}} をプレスしました（{{size}} KB）。',
  }),

  hotkeys: Object.freeze({
    heading: 'ホットキー',
    note: 'デスクが応答するすべてのキー。NEUMA がデスクトップアプリとして動作している場合、ウィンドウショートカットが表示されます。',
  }),
});
