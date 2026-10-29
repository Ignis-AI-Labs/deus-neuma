// common (zh) — 共用原子词（开关、操作按钮）。
export default Object.freeze({
  on: '开',
  off: '关',
  set: '设定',
  saved: '已保存',
  trainingNotice: Object.freeze({
    title: "关闭用你的数据训练",
    body: "你发送给 {{provider}} 的任何内容都会离开你的机器。在发送任何内容之前，请打开你的 {{provider}} 账户的隐私或数据设置，关闭所有允许其使用你的对话来训练模型的选项。有些提供商默认开启此项——请逐一检查你使用的每个账户和套餐。",
  }),
  textSize: Object.freeze({
    open: '文字大小',
    title: '文字大小',
    smaller: '缩小文字',
    larger: '放大文字',
    reset: '重置',
  }),
});
