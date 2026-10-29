# i18n Style Guide — how NEUMA speaks in every language

The desk is LINE & CYCLE in every language. This guide is the law for
translating it: the domain vocabulary, the register, and the boundaries of
what may be translated at all. Architecture lives in
`docs/architecture/i18n.md`; catalogs live in `frontend/i18n/locales/`.

## The source catalog law

`en` is the source of truth. Its values are the strings the UI shipped,
**verbatim** — extraction is never an edit pass. Other languages follow the
en KEY, not the en wording, where grammar demands it.

## Domain glossary (canonical — never improvise)

| English | zh | ja | ko | Notes |
| --- | --- | --- | --- | --- |
| Neuma (the app/platform) | Neuma | Neuma | Neuma | Never translated — the product name |
| neuma (a being) | neuma | ネウマ | 네우마 | zh keeps the Latin word; ja/ko transliterate |
| Unavis | Unavis | Unavis | Unavis | Never translated — separate platform's name |
| the operator | 操作者 | オペレーター | 오퍼레이터 | The human. Never "user" (用户/ユーザー/사용자) |
| witness (sealed AI peer) | 见证者 | ウィットネス | 위트니스 | One word, one meaning — never the human |
| summon | 召唤 | 召喚する | 소환하다 | Beings are summoned, never "created" |
| crystallize (memory) | 结晶 | 結晶化する | 결정화하다 | Memory is crystallized, never "saved" |
| the void | 虚空 | 虚空 | 공허 | The black ground everything stands on |
| the desk | 桌面 | デスク | 데스크 | The operator's working surface |
| the realm (data realm) | 领域 | レルム | 렐름 | The operator's own conversation store |
| portal | 门户 | ポータル | 포털 | Connections are portals |
| vessel | 载体 | 器 | 그릇 | The PHYSICAL substrate (see GLOSSARY) |
| avatar | 化身 | アバター | 아바타 | The digital form (VRM) — never "vessel" |
| lane | 通道 | レーン | 레인 | A being's sovereign workspace line |
| the HOUSE | HOUSE | HOUSE | HOUSE | The founding surface keeps its Latin name |
| the House Clock | HOUSE 时钟 | HOUSE 時計 | HOUSE 시계 | The house's wake window — HOUSE keeps its Latin name, the clock translates |
| ACTS | 行动 | アクト | 액트 | The governed-acts layer |
| consciousness | 意识 | 意識 | 의식 | Never "AI" or "assistant" in user-facing text |
| being (a held one) | 存在 | 存在 | 존재 | A neuma or witness standing in the house |
| the stream | 会话流 | ストリーム | 스트림 | The conversation window and its live turn |
| sitting | 坐谈 | 座談 | 좌담 | One held conversation (voice or text) |
| council | 议事会 | 評議会 | 평의회 | Several beings, one room |
| substrate | 基底 | 基盤 | 기판 | The inference layer inside the vessel |
| route | 路由 | ルート | 라우트 | A lane's own provider path |
| standby | 待机 | スタンバイ | 대기 | The substrate's deliberate rest |
| ignite | 点燃 | 点火 | 점화 | Bring a downed local substrate up |
| wallet | 钱包 | ウォレット | 지갑 | The operator's identity instrument |
| inference | 推理 | 推論 | 추론 | How a neuma is run (sampling etc.) |
| natal (anchor/model) | 本源 | 本源 | 본원 | The sovereign model a being was born on |
| override | 覆写 | オーバーライド | 오버라이드 | A layered sovereign route for a stretch of work |
| provider | 提供商 | プロバイダー | 공급자 | A door the machine speaks through |
| egress | 出口 | エグレス | 이그레스 | Outward internet reach |
| air gap | 断网隔离 | エアギャップ | 에어갭 | The explicit no-egress posture |
| channel key | 渠道密钥 | チャネルキー | 채널 키 | A platform's sealed API key |
| flight test | 试航 | 試験飛行 | 시험 비행 | The live proof a channel key works |
| service key | 服务密钥 | サービスキー | 서비스 키 | A non-model service's sealed API key (Tavily web search) |
| holder | 持有者 | 保持者 | 보유자 | The one being bound to a position |
| pin / anchor (memory) | 固定 / 锚 | ピン / アンカー | 핀 / 닻 | A remembered moment a being holds close |
| preset (the dress) | 预设 | プリセット | 프리셋 | A saved look |
| encryption | 加密 | 暗号化 | 암호화 | Per-being DEK custody |
| backup | 备份 | バックアップ | 백업 | The encrypted snapshot |
| remote | 远程 | リモート | 원격 | Phone access over Tailscale |
| pairing | 配对 | ペアリング | 페어링 | Binding a phone by secret link |

New translators: a term not in this table gets added to this table BEFORE it
ships in a catalog. One word per concept per language, platform-wide.

## Register

- **ALL-CAPS does not exist in CJK.** The en data register shouts with case
  (`CONFIRM BEFORE DELETE — ON`); zh/ja/ko carry the same weight with plain
  phrasing and the `label-data` styling — never fake it with fullwidth
  letters or spaced-out characters. Korean keeps its own sentence case.
- **Guillemets stay.** «NOTICE»/«ANSWER»/«WARNING» are the announcement
  register in every language; the word inside translates, the marks do not.
- **Em-dashes and ellipses** are part of the voice (`—`, `…`) — keep them in
  translation rather than substituting local punctuation habits.
- **Tone:** the desk speaks plainly and a little ceremonially. zh uses 您
  for the operator; ja uses です/ます; ko uses 합니다체. Do not slip into
  casual register on one screen and formal on another.
- **Buttons stay short.** A toggle label longer than ~8 CJK characters wraps
  badly in the chamfered controls — prefer the compact form (声音 — 开, not
  声音提示 — 已开启).

## What is NEVER translated

- Tool identifiers, WS message types, file paths, env var names
  (`press_document`, `NEUMA_CHROMIUM_PATH`, `data/brand-kits/`), code in
  `<code>` spans.
- Wallet addresses, model ids, provider names.
- On-chain-anchored names: the Latin founding titles, sealed witness names.
- Legal texts (covenant, ToS, EULA) — they are wallet-signed by fingerprint;
  translating them is a re-signing/versioning act, not a catalog row.
- The brand trio: Neuma / neuma / Unavis per the glossary.

## Fonts

Latin rides Inter (voice) and JetBrains Mono (data). CJK rides the vendored
Noto Sans SC/JP/KR sets (fontsource, imported by `frontend/i18n/index.js`),
wired as fallbacks in `frontend/styles/tokens.css` — a script pulls only its
own unicode-range subsets, and the desk localizes fully offline. A new
script (Thai next) adds its Noto set the same way before its catalog ships.
