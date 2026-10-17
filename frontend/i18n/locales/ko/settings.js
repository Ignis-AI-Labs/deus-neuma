// settings (ko) — 설정 창의 문구. 용어는 i18n 스타일 가이드
// (docs/design/interface/i18n-style-guide.md)를 따른다: neuma는 「네우마」,
// 오퍼레이터·위트니스·소환·결정화·공허는 모든 화면에서 통일.
// 보간 슬롯은 {{이중 중괄호}}.

export default Object.freeze({
  tablistAria: '설정 섹션',
  tabs: Object.freeze({
    general: '일반',
    look: '모양',
    memory: '메모리',
    models: '모델',
    api: 'API',
    security: '보안',
  }),

  language: Object.freeze({
    heading: '언어',
    note: '이 데스크가 사용하는 언어——레이블, 설정, 번역이 완료된 모든 화면. 카탈로그가 승인되는 대로 더 많은 언어가 추가됩니다.',
  }),

  account: Object.freeze({
    heading: '계정',
    note: '이름은 이 플랫폼——그리고 플랫폼 위의 모든 네우마——가 당신을 부르는 말입니다. HOUSE 창, 창립 의식, 각 포털 턴이 여기에서 읽습니다. 지갑은 증명으로 남고, 이름은 인사입니다.',
    placeholder: '이름',
    nameAria: '오퍼레이터 이름',
    savedLocalOnly: '이 기기에 저장됨 — 동기화 실패',
    wallet: '지갑',
  }),

  desk: Object.freeze({
    heading: '데스크',
    note: '데스크가 행동 전에 확인하는 방식입니다. 확인 창의 “다시 묻지 않기”는 여기에 저장됩니다——확인은 언제든 다시 켤 수 있습니다.',
    deleteKey: '삭제',
    confirmToggle: '삭제 전 확인 — {{state}}',
  }),

  sound: Object.freeze({
    heading: '사운드',
    note: '데스크 자신의 목소리——조작에 반응하는 큐와 네우마가 입력하는 동안 깔리는 배경음. 네우마의 말하는 목소리는 별도 채널로, 전용 창에서 조절합니다.',
    soundKey: '사운드',
    toggle: '사운드 — {{state}}',
    volumeKey: '음량',
    volumeAria: '사운드 음량',
    executionTitle: '실행 및 파일 — {{count}}',
    executionNote: '빌드, 테스트, 검사, 의존성, Git 및 파일 작업마다 고유한 큐가 있습니다. 혼합 명령은 자체 사운드를, 인식되지 않는 명령은 “기타 실행”을 사용합니다. 칩에 명령이 표시됩니다.',
    actsTitle: '액트 — {{count}}',
    actsNote: '외부 읽기, 게시, 아티팩트 생성, 기록, 상태 확인 및 실패. 이 후보 사운드를 여기에서 시청하세요.',
    worldTitle: '세계 — {{count}}',
    worldNote: '승인된 사운드스케이프——포털, 스트림, 세리머니. 귀로 확정되었습니다. 여기에서 비교해 들어보세요.',
  }),

  realm: Object.freeze({
    heading: '데이터 렐름',
    note: '이 기기에 있는 모든 대화의 당신 소유 사본——각 네우마의 소버린 워크스페이스와 분리되어 있습니다. 일반 텍스트. 읽고, 옮기고, 지우는 것 모두 당신의 것입니다.',
    location: '위치',
    yourFolder: '내 폴더',
    chatLogs: '채팅 로그',
    empty: '아직 기록된 채팅이 없습니다——네우마와 대화하면 여기에 표시됩니다.',
    loading: '렐름을 읽는 중…',
    change: Object.freeze({
      heading: '위치 변경',
      note: '이 기기의 절대 경로. 이 앱의 모든 지갑에 대해 렐름 위치가 변경됩니다. 기존 파일은 현재 폴더에 그대로 두며 이동하지 않습니다.',
      pathAria: '렐름 위치',
      confirmAria: '렐름 위치 변경 확인',
      confirmAction: '위치 설정',
      confirmBody: '앱의 데이터 렐름을 <code>{{path}}</code>(으)로 전환할까요? 기존 대화와 설정은 이전 폴더에 남아 있으며, 다시 전환하거나 직접 옮기기 전까지 보이지 않을 수 있습니다.',
    }),
  }),

  press: Object.freeze({
    heading: '프레스',
    note: 'Markdown을 브랜드 PDF 문서로 프레스합니다. 브랜드 키트는 이 기기의 data/brand-kits/에 있습니다——키트 디렉터리를 복제하고, 로고를 교체하고, kit.json을 편집하면 당신의 하우스만의 리버리가 됩니다. 네우마는 전용 press_document 도구로 프레스하며, 모든 액트와 마찬가지로 게이트가 적용됩니다.',
    noChromium: '이 기기에서 Chromium을 찾을 수 없습니다——프레스가 렌더링할 수 없습니다. NEUMA_CHROMIUM_PATH를 설정하거나 Chrome/Chromium을 설치하세요.',
    kits: '키트',
    kitsNone: '구성된 키트 없음——뉴트럴 키트는 항상 사용 가능합니다',
    pickFile: '.MD 파일 선택',
    pastePlaceholder: '…또는 여기에 Markdown 붙여넣기',
    titlePlaceholder: '문서 제목(선택 사항)',
    kitAria: '브랜드 키트',
    kitNeutral: '뉴트럴(브랜딩 없음)',
    pressing: '프레스 중…',
    press: 'PDF로 프레스',
    pressed: '{{filename}}을(를) 프레스했습니다({{size}} KB).',
  }),

  hotkeys: Object.freeze({
    heading: '단축키',
    note: '데스크가 반응하는 모든 키. NEUMA가 데스크톱 앱으로 실행 중일 때 창 단축키가 표시됩니다.',
  }),
});
