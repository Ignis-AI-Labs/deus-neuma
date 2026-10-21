// settingsApi (ko) — API 탭 (채널 키 / 이메일 / 웹 접근). register per i18n-style-guide.md.

export default Object.freeze({
  channelKeys: Object.freeze({
    heading: '채널 키',
    note: '이 집이 밖으로 말하는 모든 플랫폼의 API 키입니다. 이 기계에 봉인되며 다시 표시되지 않습니다. 키만으로는 누구도 게시할 수 없습니다 — 각 플랫폼은 자기 플랫폼 창에서 유일한 보유자에게 묶이고, 게시는 \'항상 허용\'을 주지 않는 한 매번 당신에게 먼저 묻습니다. 시험 비행 한 줄이 살아 있는 증명입니다 — 플랫폼이 키를 받아들이고 계정을 지목했습니다. 재시험은 지금 즉시 다시 찔러봅니다.',
    reading: '판을 읽는 중…',
    flight: Object.freeze({
      untested: '미시험',
      proven: '실증됨',
      live: '시험 비행 ✓ {{account}}',
      liveDetail: '시험 비행 ✓ {{account}} — {{detail}}',
      down: '시험 비행 ✗ {{detail}}',
      unconfigured: '미설정 — 증명할 것이 없습니다',
    }),
    card: Object.freeze({
      flightTest: '시험 비행',
      retest: '재시험',
      retestTitle: '지금 즉시 연결을 실지로 찔러봅니다',
      retestTitleIdle: '키를 설정하기 전에는 찔러볼 것이 없습니다',
      fieldSetPlaceholder: '{{label}} — 설정됨 ({{source}})',
      save: '키 저장',
      forget: '키 지우기',
    }),
  }),

  email: Object.freeze({
    heading: '이메일',
    note: '이 집이 글을 쓰는 주소를 연결하고, 그 메일함을 이 자리를 맡은 단 한 네우마에게 묶습니다. 계정은 이 기계에 봉인되어 다시 표시되지 않습니다. 묶이지 않은 메일함으로는 누구도 쓸 수 없습니다. 전송과 수신함 읽기도 \'항상 허용\'을 주지 않는 한 매번 당신에게 먼저 묻습니다 — 그리고 메일함 자체는 언제든 자기 메일 클라이언트에서 직접 볼 수 있습니다.',
    reading: '계정을 읽는 중…',
    card: Object.freeze({
      heldBy: '{{holder}} 보유',
      holder: '보유자',
      unbound: '묶이지 않음 — 누구도 쓸 수 없습니다',
      note: 'Gmail은 2단계 인증과 앱 비밀번호가 필요합니다. 호스트와 포트 항목은 이미 Gmail 기본값입니다. 어떤 공급자든 — 자기 도메인도 — 값을 덮어쓰면 쓸 수 있습니다.',
      fieldSetPlaceholder: '{{label}} — 설정됨 ({{source}})',
      save: '계정 저장',
      forget: '계정 지우기',
      holderAria: '메일함 보유자',
      holderPlaceholder: '—— 보유자 선택 ——',
      bind: '묶기',
      release: '풀기',
    }),
  }),

  web: Object.freeze({
    heading: '웹 접근',
    note: '인터넷 조사는 기본으로 쓸 수 있습니다. 밖으로 뻗는 모든 도달은 \'항상 허용\'을 주지 않는 한 매번 당신에게 먼저 묻습니다. 끄면 명시적 에어갭입니다 — 검색 없음, 페이지 없음, 이그레스 없음.',
    egressKey: '이그레스',
    egressOn: '켬 — 존재가 인터넷에 닿을 수 있습니다',
    egressOff: '끔 — 에어갭 자세',
    lockedByOperator: '오퍼레이터가 잠금',
    searchKey: '검색 인덱스',
    pageReaderKey: '페이지 리더',
    reading: '스위치를 읽는 중…',
    switching: '전환 중…',
    switchOff: '끄기',
    switchOn: '켜기',
    envLockedNote: '«알림» 오퍼레이터의 시작 환경({{env}})이 이그레스를 끔으로 고정합니다. 잠금이 풀리기 전까지 이 스위치는 효력이 없습니다.',
  }),

  serviceKeys: Object.freeze({
    heading: '서비스 키',
    note: '모델이 아닌 외부 서비스의 키입니다. 현재는 Tavily 웹 검색으로, 검색이 필요한 벤치마크가 자체 도구로 사용합니다. 하우스 자체의 웹 검색은 사용하지 않습니다. 공급자 키와 같은 암호화 저장소에 이 기기에서 봉인되며 다시 표시되지 않습니다.',
    reading: '서비스를 읽는 중…',
    keyAria: '{{name}} API 키',
    keyPlaceholder: 'API 키',
    keyStoredPlaceholder: '••••••••(저장됨) — 입력하여 교체',
    save: '저장',
    remove: '제거',
    removeConfirmAria: '서비스 키 제거 확인',
    removeConfirm: '저장된 {{name}} 키를 이 컴퓨터에서 제거하시겠습니까? 새 키를 저장할 때까지 이를 읽는 기능은 작동하지 않습니다.',
  }),
});
