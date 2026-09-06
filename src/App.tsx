import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type View = 'home' | 'play';
type Sheet = 'settings' | 'record' | null;
type Droplet = { id: number; x: number; y: number; r: number; tone: number; special?: boolean };
type IconName = 'drop' | 'gear' | 'back' | 'check' | 'sparkle' | 'calendar' | 'gift' | 'wave' | 'history';
type AdKind = 'native' | 'banner';
type Palette = { key: 'sky' | 'mint' | 'aqua' | 'dawn'; label: string };
type CompletionMode = 'interstitial' | 'rewarded' | 'free';
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

const DAILY_REWARD = 10;
const TOTAL_ROUNDS = 3;
const WATER_PALETTES: Palette[] = [
  { key: 'sky', label: '맑은 하늘' },
  { key: 'mint', label: '민트 글라스' },
  { key: 'aqua', label: '아쿠아 빛' },
  { key: 'dawn', label: '새벽빛' },
];
const DAILY_TIPS = [
  '가까운 물방울끼리 먼저 합치면 더 빠르게 모을 수 있어요.',
  '큰 물방울을 작은 물방울 쪽으로 천천히 밀어보세요.',
  '한 번에 세게 움직이기보다 짧게 밀면 위치를 잡기 쉬워요.',
  '가장자리 물방울부터 안쪽으로 모으면 화면이 금방 깔끔해져요.',
];

let sharedAudioContext: AudioContext | null = null;

function getAudioContext() {
  if (sharedAudioContext) return sharedAudioContext;
  const AudioContextCtor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!AudioContextCtor) return null;
  sharedAudioContext = new AudioContextCtor();
  return sharedAudioContext;
}

function playInteractionFeedback(sound: boolean, vibration: boolean, kind: 'merge' | 'complete') {
  if (vibration && typeof navigator.vibrate === 'function') {
    navigator.vibrate(kind === 'complete' ? [14, 38, 18] : 9);
  }
  if (!sound) return;

  try {
    const audioContext = getAudioContext();
    if (!audioContext) return;
    if (audioContext.state === 'suspended') void audioContext.resume();

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(kind === 'complete' ? 520 : 620, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'complete' ? 760 : 720, now + 0.07);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === 'complete' ? 0.045 : 0.025, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'complete' ? 0.16 : 0.09));
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + (kind === 'complete' ? 0.17 : 0.10));
  } catch {
    // WebView/브라우저가 오디오 생성을 제한하는 환경에서는 조용히 무시한다.
  }
}

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const c = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true } as const;
  if (name === 'drop') return <svg {...c}><path d="M12 2.8C9.2 7.1 5.6 10.3 5.6 14.5A6.4 6.4 0 0 0 12 20.9a6.4 6.4 0 0 0 6.4-6.4C18.4 10.3 14.8 7.1 12 2.8Z" fill="currentColor" /></svg>;
  if (name === 'gear') return <svg {...c}><path d="M9.8 3.7h4.4l.6 2.1 1.7 1 2.1-.5 2.2 3.8-1.5 1.6v2l1.5 1.6-2.2 3.8-2.1-.5-1.7 1-.6 2.1H9.8l-.6-2.1-1.7-1-2.1.5-2.2-3.8 1.5-1.6v-2l-1.5-1.6 2.2-3.8 2.1.5 1.7-1 .6-2.1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.5" /></svg>;
  if (name === 'back') return <svg {...c}><path d="m14.5 5-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (name === 'check') return <svg {...c}><path d="m5 12.5 4.2 4.2L19.5 6.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (name === 'calendar') return <svg {...c}><path d="M6.5 3.8v2.4M17.5 3.8v2.4M4.2 9.2h15.6M5.5 5.5h13a1.3 1.3 0 0 1 1.3 1.3v11.3a1.3 1.3 0 0 1-1.3 1.3h-13a1.3 1.3 0 0 1-1.3-1.3V6.8a1.3 1.3 0 0 1 1.3-1.3Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (name === 'gift') return <svg {...c}><path d="M4 10h16v10H4V10Zm-1-4h18v4H3V6Zm9 0v14M12 6H8.8a2.4 2.4 0 1 1 2.1-3.55L12 6Zm0 0h3.2a2.4 2.4 0 1 0-2.1-3.55L12 6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>;
  if (name === 'wave') return <svg {...c}><path d="M3 9.2c2.1-2.5 4.2-2.5 6.3 0s4.2 2.5 6.3 0 4.2-2.5 5.4-1.2M3 14.8c2.1-2.5 4.2-2.5 6.3 0s4.2 2.5 6.3 0 4.2-2.5 5.4-1.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  if (name === 'history') return <svg {...c}><path d="M4.3 5.7v4.6h4.6M5.2 9.5a7.6 7.6 0 1 1-.4 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 8.1v4.4l3 1.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  return <svg {...c}><path d="m12 2 1.4 5.2L18 4.8l-2.4 4.6L21 11l-5.4 1.4L18 17l-4.6-2.4L12 20l-1.4-5.4L6 17l2.4-4.6L3 11l5.4-1.6L6 4.8l4.6 2.4L12 2Z" fill="currentColor" /></svg>;
}

const ROUND_DROPS: Record<number, Droplet[]> = {
  1: [{ id: 1, x: 20, y: 24, r: 27, tone: 0 }, { id: 2, x: 48, y: 19, r: 21, tone: 1 }, { id: 3, x: 75, y: 27, r: 25, tone: 2 }, { id: 4, x: 30, y: 58, r: 23, tone: 1 }, { id: 5, x: 62, y: 55, r: 30, tone: 0 }, { id: 6, x: 80, y: 71, r: 18, tone: 2 }, { id: 7, x: 14, y: 78, r: 16, tone: 1 }, { id: 8, x: 89, y: 48, r: 15, tone: 0 }],
  2: [{ id: 11, x: 18, y: 26, r: 20, tone: 1 }, { id: 12, x: 44, y: 18, r: 29, tone: 0 }, { id: 13, x: 77, y: 25, r: 18, tone: 2, special: true }, { id: 14, x: 26, y: 67, r: 31, tone: 0 }, { id: 15, x: 58, y: 55, r: 22, tone: 1 }, { id: 16, x: 81, y: 69, r: 27, tone: 2 }, { id: 17, x: 49, y: 82, r: 17, tone: 1 }, { id: 18, x: 12, y: 47, r: 15, tone: 2 }, { id: 19, x: 70, y: 86, r: 16, tone: 0 }],
  3: [{ id: 21, x: 15, y: 22, r: 18, tone: 2 }, { id: 22, x: 38, y: 17, r: 22, tone: 1 }, { id: 23, x: 67, y: 20, r: 28, tone: 0 }, { id: 24, x: 84, y: 43, r: 20, tone: 2 }, { id: 25, x: 23, y: 53, r: 29, tone: 0 }, { id: 26, x: 51, y: 52, r: 18, tone: 1 }, { id: 27, x: 72, y: 69, r: 24, tone: 1 }, { id: 28, x: 37, y: 81, r: 20, tone: 2 }, { id: 29, x: 12, y: 73, r: 15, tone: 0 }, { id: 30, x: 91, y: 61, r: 14, tone: 1 }],
};

function freshRound(round: number, showSurprise: boolean): Droplet[] {
  return ROUND_DROPS[round].map((drop) => ({ ...drop, special: Boolean(showSurprise && drop.special) }));
}
function daySeed() { const now = new Date(); return now.getFullYear() * 1000 + (now.getMonth() + 1) * 40 + now.getDate(); }
function dailyPalette() { return WATER_PALETTES[daySeed() % WATER_PALETTES.length]; }
function dailyTip() { return DAILY_TIPS[daySeed() % DAILY_TIPS.length]; }
function weeklyStatus(streak: number, checked: boolean) {
  const previous = Math.min(6, Math.max(0, streak - (checked ? 1 : 0)));
  return Array.from({ length: 7 }, (_, index) => index < previous || (index === 6 && checked));
}
function AdSlot({ compact = false, kind = 'native' }: { compact?: boolean; kind?: AdKind }) {
  const copy = kind === 'banner'
    ? ['배너 광고 영역', '실제 SDK 연결 시 고정 높이로 교체돼요']
    : ['추천 콘텐츠 영역', '실제 네이티브 광고가 들어갈 자리예요'];
  return <section className={`ad-slot ${compact ? 'compact' : ''}`} aria-label="광고 영역 미리보기"><span className="ad-badge">AD</span><div><strong>{copy[0]}</strong><p>{copy[1]}</p></div></section>;
}

function Home({
  onStart, onOpenRecord, onSettings, onAttendance, completedRounds, points, attendanceChecked, streak, mergeCount, surpriseFound, rewardClaimed,
}: {
  onStart: () => void;
  onOpenRecord: () => void;
  onSettings: () => void;
  onAttendance: () => void;
  completedRounds: number;
  points: number;
  attendanceChecked: boolean;
  streak: number;
  mergeCount: number;
  surpriseFound: boolean;
  rewardClaimed: boolean;
}) {
  const missionDone = completedRounds >= TOTAL_ROUNDS;
  const palette = dailyPalette();
  const week = weeklyStatus(streak, attendanceChecked);
  const weekCount = week.filter(Boolean).length;
  const weeklyGoal = Math.min(5, weekCount);
  const taskStates = [attendanceChecked, mergeCount >= 10, missionDone];
  const tasks = [
    ['출석하기', attendanceChecked ? '완료' : '오늘 1회'],
    ['물방울 10번 합치기', mergeCount >= 10 ? '완료' : `${Math.min(mergeCount, 10)}/10`],
    ['물방울 3번 모으기', missionDone ? '완료' : `${Math.min(completedRounds, TOTAL_ROUNDS)}/${TOTAL_ROUNDS}`],
  ] as const;

  const heroTitle = rewardClaimed ? '오늘 10원 받기 완료!' : missionDone ? '10원 받을 준비 완료!' : '세 번 모으면 10원 준비 완료';
  const heroCta = rewardClaimed ? '물방울 더 모아보기' : missionDone ? '10원 받으러 가기' : '물방울 모으기';
  const heroHelp = rewardClaimed ? '오늘 보상은 완료했어요. 물방울은 계속 자유롭게 모을 수 있어요.' : '물방울을 밀어 서로 닿게 하면 하나로 합쳐져요';

  return <div className="screen home-screen">
    <header className="topbar"><div className="topbar-copy"><span>이번 달 받은 토스포인트</span><strong>{points}<small>원</small></strong></div><button className="icon-button" onClick={onSettings} aria-label="설정"><Icon name="gear" /></button></header>
    <section className="brand-row"><div className="brand-mark"><Icon name="drop" size={24} /></div><div><h1>물방울모으기</h1><p>흩어진 물방울을 하나로 모아보세요</p></div></section>
    <section className={`hero-card hero-card-v2 palette-${palette.key} ${rewardClaimed ? 'reward-claimed' : ''}`}>
      <div className="hero-ambient ambient-one" /><div className="hero-ambient ambient-two" />
      <div className="hero-topline"><div><span className="eyebrow">오늘의 물방울</span><h2>{heroTitle}</h2></div><div className="round-count"><strong>{Math.min(completedRounds, TOTAL_ROUNDS)}</strong><span>/ {TOTAL_ROUNDS}</span></div></div>
      <div className="water-scene water-scene-v2" aria-hidden="true"><div className="water-tone-pill"><Icon name="wave" size={15} /><span>오늘의 물빛</span><strong>{palette.label}</strong></div><div className="water-shimmer shimmer-one" /><div className="water-shimmer shimmer-two" /><div className="surface-glow" /><div className="hero-drop hero-drop-main"><i /></div><div className="hero-drop hero-drop-a"><i /></div><div className="hero-drop hero-drop-b"><i /></div><div className="hero-drop hero-drop-c"><i /></div><div className="hero-drop hero-drop-d"><i /></div><div className="hero-drop hero-drop-e"><i /></div><div className="hero-drop hero-drop-f"><i /></div><div className="hero-drop hero-drop-g"><i /></div><div className="hero-ripple ripple-one" /><div className="hero-ripple ripple-two" /><div className="hero-ripple ripple-three" /></div>
      <div className="drop-progress" aria-label={`오늘 ${completedRounds}회 완료`}>{[1, 2, 3].map((index) => <div key={index} className={`drop-progress-item ${completedRounds >= index ? 'done' : completedRounds + 1 === index ? 'current' : ''}`}><span><Icon name="drop" size={index === 3 ? 22 : 18} /></span><small>{index}번째</small></div>)}</div>
      <button className="primary-button hero-cta" onClick={onStart}><span>{heroCta}</span><span className="button-arrow">›</span></button><p className="hero-help">{heroHelp}</p>
    </section>

    <section className="daily-hub"><div className="section-heading"><div><span className="eyebrow">오늘 할 일</span><h3>가볍게 챙겨가세요</h3></div></div><button className={`attendance-card ${attendanceChecked ? 'done' : ''}`} onClick={onAttendance} disabled={attendanceChecked}><span className="daily-icon calendar"><Icon name={attendanceChecked ? 'check' : 'calendar'} size={21} /></span><div><strong>{attendanceChecked ? '오늘 출석 완료' : '출석체크'}</strong><p>{attendanceChecked ? `${streak}일 연속으로 들렀어요` : '오늘 한 번 눌러 출석을 남겨요'}</p></div><span className="attendance-action">{attendanceChecked ? '완료' : '+ 출석'}</span></button><div className="mission-card"><div className="mission-head"><span className="daily-icon drop"><Icon name="drop" size={21} /></span><div><strong>오늘의 물방울</strong><p>3번 모으면 10원 받기 준비 완료</p></div><b>{Math.min(completedRounds, TOTAL_ROUNDS)}/{TOTAL_ROUNDS}</b></div><div className="mission-track"><i style={{ width: `${Math.min(100, completedRounds / TOTAL_ROUNDS * 100)}%` }} /></div><div className="mission-steps">{[1, 2, 3].map((step) => <span key={step} className={completedRounds >= step ? 'done' : completedRounds + 1 === step ? 'current' : ''}>{completedRounds >= step ? <Icon name="check" size={13} /> : step}</span>)}</div></div><div className={`reward-card ${missionDone ? 'ready' : ''} ${rewardClaimed ? 'claimed' : ''}`}><span className="daily-icon gift"><Icon name={rewardClaimed ? 'check' : 'gift'} size={21} /></span><div><strong>{rewardClaimed ? '오늘 10원 받았어요' : missionDone ? '10원 받을 준비가 됐어요' : '오늘 보상'}</strong><p>{rewardClaimed ? '내일 다시 받을 수 있어요' : missionDone ? '리워드 광고 완료 후 10원 지급' : `${TOTAL_ROUNDS - Math.min(completedRounds, TOTAL_ROUNDS)}번만 더 모으면 돼요`}</p></div><span className="reward-amount">{rewardClaimed ? '완료' : `${DAILY_REWARD}원`}</span></div></section>

    <section className="daily-mission-card"><div className="daily-mission-head"><div><span className="eyebrow">오늘의 미션</span><h3>평소처럼 모으면 자동 완료</h3></div><strong>{taskStates.filter(Boolean).length}/3</strong></div><div className="daily-task-list">{tasks.map(([title, status], index) => <div className={taskStates[index] ? 'done' : ''} key={title}><span>{taskStates[index] ? <Icon name="check" size={14} /> : index + 1}</span><b>{title}</b><small>{status}</small></div>)}</div><div className={`surprise-teaser ${surpriseFound ? 'found' : ''}`}><span className="surprise-mini"><Icon name="sparkle" size={16} /></span><div><strong>{surpriseFound ? '깜짝 물방울 발견 완료' : '깜짝 물방울이 숨어 있어요'}</strong><p>{surpriseFound ? '오늘 한 번의 반짝 이벤트를 찾았어요' : '오늘 물방울을 모으다 보면 한 번 나타나요'}</p></div><em>{surpriseFound ? '완료' : '?'}</em></div></section>
    <section className="weekly-card"><div className="weekly-head"><div><span className="eyebrow">이번 주</span><h3>물방울 출석</h3></div><div className="streak-pill"><Icon name="sparkle" size={14} />{streak}일 연속</div></div><div className="weekly-strip">{['월', '화', '수', '목', '금', '토', '오늘'].map((day, index) => <div className={`weekly-day ${week[index] ? 'done' : ''} ${index === 6 ? 'today' : ''}`} key={day}><span>{week[index] ? <Icon name="drop" size={15} /> : index === 6 ? '오늘' : '·'}</span><small>{day}</small></div>)}</div><div className={`weekly-goal ${weekCount >= 5 ? 'done' : ''}`}><div><strong>{weekCount >= 5 ? '이번 주 5일 방문 완료' : '이번 주 5일 방문'}</strong><small>{weekCount >= 5 ? '주간 목표를 채웠어요' : '한 주에 5일만 들러도 목표 완료'}</small></div><b>{weeklyGoal}/5</b><span><i style={{ width: `${weeklyGoal / 5 * 100}%` }} /></span></div><button className="inline-record-button" type="button" onClick={onOpenRecord}><span><Icon name="history" size={17} /><b>출석·보상 기록 보기</b></span><em>›</em></button></section>
    <AdSlot kind="native" /><section className="tip-card"><span className="tip-icon"><Icon name="sparkle" size={18} /></span><div><span className="eyebrow">오늘의 팁</span><strong>{dailyTip()}</strong><p>날짜 기준으로 가볍게 바뀌는 안내예요.</p></div></section>
  </div>;
}

function Play({
  round, onBack, onRoundComplete, onMerge, onSurprise, showSurprise, rewardClaimed, sound, vibration,
}: {
  round: number;
  onBack: () => void;
  onRoundComplete: (mode: CompletionMode) => void;
  onMerge: () => void;
  onSurprise: () => void;
  showSurprise: boolean;
  rewardClaimed: boolean;
  sound: boolean;
  vibration: boolean;
}) {
  const [drops, setDrops] = useState(() => freshRound(round, showSurprise));
  const [complete, setComplete] = useState(false);
  const [surpriseNotice, setSurpriseNotice] = useState(false);
  const [mergedDropId, setMergedDropId] = useState<number | null>(null);
  const [actionLocked, setActionLocked] = useState(false);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: number; pointerId: number } | null>(null);
  const dropsRef = useRef<Droplet[]>(drops);
  const mergeTimerRef = useRef<number | null>(null);
  const completionTimerRef = useRef<number | null>(null);
  const surpriseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const initialDrops = freshRound(round, showSurprise);
    dropsRef.current = initialDrops;
    setDrops(initialDrops);
    setComplete(false);
    setSurpriseNotice(false);
    setMergedDropId(null);
    setActionLocked(false);
    dragRef.current = null;
    return () => {
      if (mergeTimerRef.current) window.clearTimeout(mergeTimerRef.current);
      if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
      if (surpriseTimerRef.current) window.clearTimeout(surpriseTimerRef.current);
    };
  }, [round, showSurprise]);

  const mergeIfNeeded = (draggedId: number) => {
    const currentDrops = dropsRef.current;
    const dragged = currentDrops.find((drop) => drop.id === draggedId);
    if (!dragged) return;

    let target: Droplet | undefined;
    let bestDistance = Infinity;
    for (const candidate of currentDrops) {
      if (candidate.id === draggedId) continue;
      const distance = Math.hypot(candidate.x - dragged.x, candidate.y - dragged.y);
      const threshold = Math.max(9, (candidate.r + dragged.r) * 0.82);
      if (distance < threshold && distance < bestDistance) {
        target = candidate;
        bestDistance = distance;
      }
    }
    if (!target) return;

    const foundSurprise = Boolean(dragged.special || target.special);
    const nextDrop: Droplet = {
      id: Math.max(dragged.id, target.id) + 100,
      x: (dragged.x * dragged.r + target.x * target.r) / (dragged.r + target.r),
      y: (dragged.y * dragged.r + target.y * target.r) / (dragged.r + target.r),
      r: Math.min(66, Math.sqrt(dragged.r ** 2 + target.r ** 2) * 1.02),
      tone: (dragged.tone + target.tone + 1) % 3,
      special: false,
    };
    const result = [...currentDrops.filter((drop) => drop.id !== dragged.id && drop.id !== target!.id), nextDrop];

    dropsRef.current = result;
    setDrops(result);
    setMergedDropId(nextDrop.id);
    if (mergeTimerRef.current) window.clearTimeout(mergeTimerRef.current);
    mergeTimerRef.current = window.setTimeout(() => setMergedDropId(null), 360);
    onMerge();
    playInteractionFeedback(sound, vibration, result.length === 1 ? 'complete' : 'merge');

    if (foundSurprise) {
      setSurpriseNotice(true);
      onSurprise();
      if (surpriseTimerRef.current) window.clearTimeout(surpriseTimerRef.current);
      surpriseTimerRef.current = window.setTimeout(() => setSurpriseNotice(false), 1800);
    }
    if (result.length === 1) {
      completionTimerRef.current = window.setTimeout(() => setComplete(true), 300);
    }
  };

  const moveDrop = (event: ReactPointerEvent<HTMLButtonElement>, id: number) => {
    if (!dragRef.current || dragRef.current.id !== id || dragRef.current.pointerId !== event.pointerId || !boardRef.current) return;
    const bounds = boardRef.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(92, (event.clientX - bounds.left) / bounds.width * 100));
    const y = Math.max(8, Math.min(92, (event.clientY - bounds.top) / bounds.height * 100));
    setDrops((all) => {
      const next = all.map((drop) => drop.id === id ? { ...drop, x, y } : drop);
      dropsRef.current = next;
      return next;
    });
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: number) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    mergeIfNeeded(id);
  };

  const completionMode: CompletionMode = round < TOTAL_ROUNDS ? 'interstitial' : rewardClaimed ? 'free' : 'rewarded';
  const handleCompletionAction = () => {
    if (actionLocked) return;
    setActionLocked(true);
    onRoundComplete(completionMode);
  };

  const completionTitle = round < TOTAL_ROUNDS
    ? '깔끔하게 하나로 모였어요'
    : rewardClaimed ? '오늘도 한 방울 완성!' : '오늘 물방울을 모두 모았어요';
  const completionDescription = round < TOTAL_ROUNDS
    ? `다음은 ${round + 1}번째 물방울이에요.`
    : rewardClaimed ? '오늘 10원 보상은 이미 받았어요.' : `${DAILY_REWARD}원 받기 단계로 이어져요.`;
  const actionLabel = round < TOTAL_ROUNDS ? '다음 물방울' : rewardClaimed ? '홈으로' : `${DAILY_REWARD}원 받기`;

  return <div className="screen play-screen">
    <header className="play-topbar"><button className="icon-button back-button" onClick={onBack} aria-label="뒤로"><Icon name="back" /></button><div className="play-progress"><span>{rewardClaimed ? '자유 모으기' : `오늘 ${round}번째`}</span><strong>{round}<small>/{TOTAL_ROUNDS}</small></strong></div><div className="topbar-spacer" /></header>
    <section className="play-copy"><span className="eyebrow">물방울 {drops.length}개 남았어요</span><h1>{drops.length > 1 ? '서로 가까이 밀어보세요' : '마지막 물방울 완성!'}</h1><p>물방울끼리 닿으면 자연스럽게 하나로 합쳐져요</p></section>
    <section className={`drop-board ${complete ? 'is-complete' : ''}`} ref={boardRef}><div className="board-light board-light-one" /><div className="board-light board-light-two" /><div className="board-grid" />{drops.map((drop) => <button type="button" className={`interactive-drop tone-${drop.tone} ${drop.special ? 'surprise-drop' : ''} ${mergedDropId === drop.id ? 'just-merged' : ''}`} key={drop.id} style={{ left: `${drop.x}%`, top: `${drop.y}%`, width: drop.r * 2, height: drop.r * 2 }} aria-label={drop.special ? '깜짝 물방울 이동' : '물방울 이동'} onPointerDown={(event) => { dragRef.current = { id: drop.id, pointerId: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => moveDrop(event, drop.id)} onPointerUp={(event) => endDrag(event, drop.id)} onPointerCancel={(event) => endDrag(event, drop.id)}><i className="drop-shine" /><i className="drop-reflect" />{mergedDropId === drop.id && <span className="merge-burst" aria-hidden="true" />}{drop.special && <span className="surprise-spark"><Icon name="sparkle" size={13} /></span>}</button>)}<div className="board-caption"><span className="finger-dot" /> 손가락으로 천천히 밀어보세요</div>{surpriseNotice && <div className="surprise-toast"><Icon name="sparkle" size={16} /><span><strong>깜짝 물방울 발견!</strong><small>오늘 한 번의 반짝 이벤트예요</small></span></div>}</section>
    <div className="play-tip"><Icon name="sparkle" size={18} /><span>팁</span><p>큰 물방울부터 작은 물방울 쪽으로 밀면 더 쉽게 모여요.</p></div>

    {complete && <div className="completion-overlay" role="dialog" aria-modal="true" aria-label="라운드 완료"><div className={`completion-card completion-${completionMode}`}><div className="completion-drop"><Icon name={completionMode === 'free' ? 'check' : 'drop'} size={38} /><span /></div><span className="eyebrow">{round}번째 완료</span><h2>{completionTitle}</h2><p>{completionDescription}</p>{completionMode === 'interstitial' && <div className="ad-transition-preview"><span>AD</span><div><strong>다음 물방울 전에 전면 광고 1회</strong><small>라운드가 완전히 끝난 뒤 자연스럽게 연결돼요</small></div></div>}{completionMode === 'rewarded' && <div className="rewarded-transition-preview"><Icon name="gift" size={19} /><div><strong>광고를 끝까지 보면 {DAILY_REWARD}원</strong><small>보상형 광고 완료가 확인된 경우에만 지급해요</small></div></div>}{completionMode === 'free' && <div className="claimed-transition-preview"><Icon name="check" size={19} /><div><strong>오늘 보상 수령 완료</strong><small>추가 포인트 지급 없이 자유롭게 더 모을 수 있어요</small></div></div>}<button className="primary-button" disabled={actionLocked} onClick={handleCompletionAction}>{actionLocked ? '처리 중…' : actionLabel}</button></div></div>}
  </div>;
}

function RecordSheet({ completedRounds, points, attendanceChecked, streak, rewardClaimed, onClose }: { completedRounds: number; points: number; attendanceChecked: boolean; streak: number; rewardClaimed: boolean; onClose: () => void }) {
  const week = weeklyStatus(streak, attendanceChecked);
  const days = ['월', '화', '수', '목', '금', '토', '오늘'];
  return <div className="sheet-backdrop" onMouseDown={onClose} role="presentation"><section className="settings-sheet record-sheet" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="출석과 보상 기록"><div className="sheet-handle" /><div className="sheet-title"><div><span className="eyebrow">나의 기록</span><h2>출석·보상 기록</h2></div><button className="sheet-close" onClick={onClose}>닫기</button></div><div className="record-summary"><div><span>이번 달 포인트</span><strong>{points}<small>원</small></strong></div><div><span>오늘 물방울</span><strong>{Math.min(completedRounds, TOTAL_ROUNDS)}<small>/{TOTAL_ROUNDS}</small></strong></div></div>{rewardClaimed && <div className="record-reward-complete"><Icon name="check" size={17} /><span><strong>오늘 {DAILY_REWARD}원 수령 완료</strong><small>중복 지급 없이 오늘 보상은 한 번만 처리돼요</small></span></div>}<div className="record-block"><div className="record-block-head"><div><span className="eyebrow">최근 7일</span><strong>{streak}일 연속 들렀어요</strong></div></div><div className="weekly-strip sheet-weekly">{days.map((day, index) => <div className={`weekly-day ${week[index] ? 'done' : ''} ${index === 6 ? 'today' : ''}`} key={day}><span>{week[index] ? <Icon name="drop" size={15} /> : index === 6 ? '오늘' : '·'}</span><small>{day}</small></div>)}</div></div><AdSlot compact kind="banner" /><div className="record-block"><span className="eyebrow">이용 방법</span><div className="record-guide"><div><b>1</b><span><strong>밀기</strong><small>물방울을 손가락으로 움직여요</small></span></div><div><b>2</b><span><strong>합치기</strong><small>서로 닿으면 하나가 돼요</small></span></div><div><b>3</b><span><strong>받기</strong><small>세 번 완료 후 보상형 광고를 보고 10원을 받아요</small></span></div></div></div></section></div>;
}

function SettingsSheet({ sound, vibration, onSound, onVibration, onClose }: { sound: boolean; vibration: boolean; onSound: () => void; onVibration: () => void; onClose: () => void }) {
  return <div className="sheet-backdrop" onMouseDown={onClose} role="presentation"><section className="settings-sheet" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="설정"><div className="sheet-handle" /><div className="sheet-title"><div><span className="eyebrow">설정</span><h2>사용 환경</h2></div><button className="sheet-close" onClick={onClose}>닫기</button></div><button className="setting-row" onClick={onSound}><div><strong>효과음</strong><p>물방울이 합쳐질 때 가벼운 물소리를 들려줘요</p></div><span className={`switch ${sound ? 'on' : ''}`}><i /></span></button><button className="setting-row" onClick={onVibration}><div><strong>진동</strong><p>합쳐질 때 짧은 햅틱으로 손맛을 더해요</p></div><span className={`switch ${vibration ? 'on' : ''}`}><i /></span></button><div className="sheet-info">광고·토스포인트 SDK는 실제 연동 전이에요. 현재는 전면형 2회 + 최종 리워드형 1회의 흐름과 중복 지급 방지 UX까지 검증하는 단계예요.</div></section></div>;
}

export default function App() {
  const [view, setView] = useState<View>('home');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [round, setRound] = useState(1);
  const [completedRounds, setCompletedRounds] = useState(0);
  const [points, setPoints] = useState(0);
  const [sound, setSound] = useState(true);
  const [vibration, setVibration] = useState(true);
  const [attendanceChecked, setAttendanceChecked] = useState(false);
  const [streak, setStreak] = useState(4);
  const [mergeCount, setMergeCount] = useState(0);
  const [surpriseFound, setSurpriseFound] = useState(false);
  const [rewardClaimed, setRewardClaimed] = useState(false);

  const start = () => {
    setSheet(null);
    setRound(completedRounds >= TOTAL_ROUNDS ? 1 : Math.max(1, completedRounds + 1));
    setView('play');
  };

  const finishRound = (mode: CompletionMode) => {
    if (round < TOTAL_ROUNDS) {
      setCompletedRounds((current) => Math.max(current, round));
      setRound(round + 1);
      return;
    }

    setCompletedRounds(TOTAL_ROUNDS);
    if (mode === 'rewarded' && !rewardClaimed) {
      // 실제 Apps-in-Toss 연동 시 이 블록은 rewarded userEarnedReward/동등한 성공 이벤트에서만 실행한다.
      setRewardClaimed(true);
      setPoints((current) => current + DAILY_REWARD);
    }
    setView('home');
  };

  const checkAttendance = () => {
    if (attendanceChecked) return;
    setAttendanceChecked(true);
    setStreak((current) => current + 1);
  };

  return <div className="app-shell"><main className="app-content">{view === 'home' && <Home onStart={start} onOpenRecord={() => setSheet('record')} onSettings={() => setSheet('settings')} onAttendance={checkAttendance} completedRounds={completedRounds} points={points} attendanceChecked={attendanceChecked} streak={streak} mergeCount={mergeCount} surpriseFound={surpriseFound} rewardClaimed={rewardClaimed} />} {view === 'play' && <Play round={round} onBack={() => setView('home')} onRoundComplete={finishRound} onMerge={() => setMergeCount((value) => value + 1)} onSurprise={() => setSurpriseFound(true)} showSurprise={!surpriseFound} rewardClaimed={rewardClaimed} sound={sound} vibration={vibration} />}</main>{sheet === 'settings' && <SettingsSheet sound={sound} vibration={vibration} onSound={() => setSound((value) => !value)} onVibration={() => setVibration((value) => !value)} onClose={() => setSheet(null)} />} {sheet === 'record' && <RecordSheet completedRounds={completedRounds} points={points} attendanceChecked={attendanceChecked} streak={streak} rewardClaimed={rewardClaimed} onClose={() => setSheet(null)} />}</div>;
}
