// settingsLook (ko) — LOOK 탭 (모양 차림판). register per i18n-style-guide.md;
// 슬롯 {{label}}/{{name}}과 <em>/<strong>/<a> 표지는 원본 그대로 유지.

export default Object.freeze({
  heading: '모양',
  note: '플랫폼에 옷을 입힙니다 — 모든 색이 이 차림판을 따릅니다. 표면·잉크·유일한 시그널은 필수입니다. 제목·본문·이탤릭·볼드·선은 선택적 목소리로, 직접 선택하기 전까지는 잉크를 따릅니다(× 로 기본으로 되돌립니다). 폴더 라벨과 레지스터는 바꾸기 전까지 기본색을 유지합니다. 변경은 즉시 적용되고 재시작 후에도 남습니다.',

  groups: Object.freeze({
    surface: Object.freeze({ title: '표면', note: '모든 것이 얹히는 곳' }),
    text: Object.freeze({ title: '글자', note: '당신이 읽는 것 — 선택 색은 되돌리기 가능' }),
    signal: Object.freeze({ title: '시그널', note: '살아 있는 것' }),
    registers: Object.freeze({ title: '레지스터', note: '상태의 목소리 — 선택 전까지 기본 유지' }),
  }),

  knobs: Object.freeze({
    ground: Object.freeze({ label: '바탕', hint: '모든 배경 — 공허 그 자체' }),
    panel: Object.freeze({ label: '패널', hint: '창과 카드의 채움' }),
    ink: Object.freeze({ label: '잉크', hint: '빛 — 아직 선택되지 않은 글자와 가장자리는 모두 이것을 탑니다' }),
    head: Object.freeze({ label: '제목', hint: '구절 제목 — 본문과 구분되는 자기 목소리' }),
    body: Object.freeze({ label: '본문', hint: '산문 — 스트림, 노트, 말 그 자체' }),
    ital: Object.freeze({ label: '이탤릭', hint: '이탤릭 — 문장 안의 어조 그늘' }),
    emph: Object.freeze({ label: '볼드', hint: '굵은 글씨 — 무거운 말의 색' }),
    folder: Object.freeze({ label: '폴더', hint: '탭 안의 초점 폴더 — 참가자 이름과는 별개' }),
    line: Object.freeze({ label: '선', hint: '가는 선과 테두리 — 잉크와 구분되는 가장자리' }),
    trim: Object.freeze({ label: '트림', hint: '유일한 포인트색 — 활동 데이터, 초점, 링크, 활성 탭' }),
    alert: Object.freeze({ label: '경보', hint: '거부, 경고, 삭제된 파일, 대기' }),
    warn: Object.freeze({ label: '주의', hint: '한계에 접근 — 컨텍스트 게이지, 수정된 파일' }),
    okay: Object.freeze({ label: '평온', hint: '조용한 성공 — 추가된 파일, 열린 여백' }),
    colorAria: '{{label}} 색',
    hexAria: '{{label}} 헥스',
    releaseAria: '{{label}}을(를) 기본으로 되돌리기',
    releaseTitle: '기본으로 되돌리기',
  }),

  specimen: Object.freeze({
    heading: '견본',
    note: '실시간 — 이 판의 모든 목소리',
    headingVoice: '자기 목소리로 쓰인 제목',
    body: '본문 산문은 선택된 본문 색으로, 아직 선택하지 않았다면 잉크로.<em>이탤릭은 어조의 그늘입니다.</em> <strong>볼드는 문장 안의 무게입니다.</strong> <a>활동 링크는 트림을 입습니다.</a>',
  }),

  presets: Object.freeze({
    heading: '프리셋',
    note: '출하 때의 차림입니다. 한 번에 적용됩니다.',
  }),

  yourPresets: Object.freeze({
    heading: '내 프리셋',
    note: '지금의 차림을 당신만의 이름으로 저장합니다.',
    placeholder: '이 차림의 이름',
    save: '저장',
    removeAria: '프리셋 {{name}} 제거',
  }),
});
