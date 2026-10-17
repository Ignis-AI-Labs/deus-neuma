// common (ko) — 공용 최소 단어(토글, 실행 버튼).
export default Object.freeze({
  on: '켜짐',
  off: '꺼짐',
  set: '설정',
  saved: '저장됨',
  trainingNotice: Object.freeze({
    title: "내 데이터로 학습 끄기",
    body: "{{provider}}에 보내는 모든 내용은 내 기기 밖으로 나갑니다. 무엇이든 보내기 전에 {{provider}} 계정의 개인정보 또는 데이터 설정을 열고, 내 대화를 모델 학습에 쓰도록 허용하는 모든 옵션을 끄세요. 기본값으로 켜 둔 제공자도 있습니다 — 사용하는 계정과 요금제를 하나씩 확인하세요.",
  }),
});
