// common (ja) — 共有の最小語（トグル、操作ボタン）。
export default Object.freeze({
  on: 'オン',
  off: 'オフ',
  set: '設定',
  saved: '保存済み',
  trainingNotice: Object.freeze({
    title: "データによる学習をオフに",
    body: "{{provider}} に送るものはすべてあなたのマシンの外に出ます。何かを送る前に、{{provider}} アカウントのプライバシーまたはデータ設定を開き、会話をモデルの学習に使うことを許すオプションをすべてオフにしてください。初期設定でオンになっているプロバイダーもあります——使っているアカウントとプランをそれぞれ確認してください。",
  }),
  textSize: Object.freeze({
    open: '文字サイズ',
    title: '文字サイズ',
    smaller: '文字を小さく',
    larger: '文字を大きく',
    reset: 'リセット',
  }),
});
