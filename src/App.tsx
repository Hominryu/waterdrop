import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type View = 'home' | 'play';
type Sheet = 'settings' | 'record' | null;
type Droplet = { id: number; x: number; y: number; r: number; tone: number };
type IconName = 'drop' | 'gear' | 'back' | 'check' | 'sparkle' | 'calendar' | 'gift' | 'wave' | 'history';
type AdKind = 'native' | 'banner';

type Palette = {
  key: 'sky' | 'mint' | 'aqua' | 'dawn';
  label: string;
};

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

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true } as const;
  if (name === 'drop') return <svg {...common}><path d="M12 2.8C9.2 7.1 5.6 10.3 5.6 14.5A6.4 6.4 0 0 0 12 20.9a6.4 6.4 0 0 0 6.4-6.4C18.4 10.3 14.8 7.1 12 2.8Z" fill="currentColor"/></svg>;
  if (name === 'gear') return <svg {...common}><path d="M9.8 3.7h4.4l.6 2.1 1.7 1 2.1-.5 2.2 3.8-1.5 1.6v2l1.5 1.6-2.2 3.8-2.1-.5-1.7 1-.6 2.1H9.8l-.6-2.1-1.7-1-2.1.5-2.2-3.8 1.5-1.6v-2l-1.5-1.6 2.2-3.8 2.1.5 1.7-1 .6-2.1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.5"/></svg>;
  if (name === 'back') return <svg {...common}><path d="m14.5 5-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (name === 'check') return <svg {...common}><path d="m5 12.5 4.2 4.2L19.5 6.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (name === 'calendar') return <svg {...common}><path d="M6.5 3.8v2.4M17.5 3.8v2.4M4.2 9.2h15.6M5.5 5.5h13a1.3 1.3 0 0 1 1.3 1.3v11.3a1.3 1.3 0 0 1-1.3 1.3h-13a1.3 1.3 0 0 1-1.3-1.3V6.8a1.3 1.3 0 0 1 1.3-1.3Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
  if (name === 'gift') return <svg {...common}><path d="M4 10h16v10H4V10Zm-1-4h18v4H3V6Zm9 0v14M12 6H8.8a2.4 2.4 0 1 1 2.1-3.55L12 6Zm0 0h3.2a2.4 2.4 0 1 0-2.1-3.55L12 6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>;
  if (name === 'wave') return <svg {...common}><path d="M3 9.2c2.1-2.5 4.2-2.5 6.3 0s4.2 2.5 6.3 0 4.2-2.5 5.4-1.2M3 14.8c2.1-2.5 4.2-2.5 6.3 0s4.2 2.5 6.3 0 4.2-2.5 5.4-1.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
  if (name === 'history') return <svg {...common}><path d="M4.3 5.7v4.6h4.6M5.2 9.5a7.6 7.6 0 1 1-.4 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 8.1v4.4l3 1.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
  return <svg {...common}><path d="m12 2 1.4 5.2L18 4.8l-2.4 4.6L21 11l-5.4 1.4L18 17l-4.6-2.4L12 20l-1.4-5.4L6 17l2.4-4.6L3 11l5.4-1.6L6 4.8l4.6 2.4L12 2Z" fill="currentColor"/></svg>;
}

const ROUND_DROPS: Record<number, Droplet[]> = {
  1: [{ id:1,x:20,y:24,r:27,tone:0 },{ id:2,x:48,y:19,r:21,tone:1 },{ id:3,x:75,y:27,r:25,tone:2 },{ id:4,x:30,y:58,r:23,tone:1 },{ id:5,x:62,y:55,r:30,tone:0 },{ id:6,x:80,y:71,r:18,tone:2 }],
  2: [{ id:11,x:18,y:26,r:20,tone:1 },{ id:12,x:44,y:18,r:29,tone:0 },{ id:13,x:77,y:25,r:18,tone:2 },{ id:14,x:26,y:67,r:31,tone:0 },{ id:15,x:58,y:55,r:22,tone:1 },{ id:16,x:81,y:69,r:27,tone:2 },{ id:17,x:49,y:82,r:17,tone:1 }],
  3: [{ id:21,x:15,y:22,r:18,tone:2 },{ id:22,x:38,y:17,r:22,tone:1 },{ id:23,x:67,y:20,r:28,tone:0 },{ id:24,x:84,y:43,r:20,tone:2 },{ id:25,x:23,y:53,r:29,tone:0 },{ id:26,x:51,y:52,r:18,tone:1 },{ id:27,x:72,y:69,r:24,tone:1 },{ id:28,x:37,y:81,r:20,tone:2 }],
};

function freshRound(round: number) {
  return ROUND_DROPS[round].map((drop) => ({ ...drop }));
}

function daySeed() {
  const now = new Date();
  return now.getFullYear() * 1000 + (now.getMonth() + 1) * 40 + now.getDate();
}

function dailyPalette() {
  return WATER_PALETTES[daySeed() % WATER_PALETTES.length];
}

function dailyTip() {
  return DAILY_TIPS[daySeed() % DAILY_TIPS.length];
}

function weeklyStatus(streak: number, attendanceChecked: boolean) {
  const previousDone = Math.min(6, Math.max(0, streak - (attendanceChecked ? 1 : 0)));
  return Array.from({ length: 7 }, (_, index) => index < previousDone || (index === 6 && attendanceChecked));
}

function AdSlot({ compact = false, kind = 'native' }: { compact?: boolean; kind?: AdKind }) {
  const copy = kind === 'banner'
    ? ['배너 광고 영역', '실제 SDK 연결 시 고정 높이로 교체돼요']
    : ['추천 콘텐츠 영역', '실제 네이티브 광고가 들어갈 자리예요'];
  return <section className={`ad-slot ${compact ? 'compact' : ''}`} aria-label="광고 영역 미리보기"><span className="ad-badge">AD</span><div><strong>{copy[0]}</strong><p>{copy[1]}</p></div></section>;
}

function Home({ onStart, onOpenRecord, onSettings, onAttendance, completedRounds, points, attendanceChecked, streak }: {
  onStart: () => void;
  onOpenRecord: () => void;
  onSettings: () => void;
  onAttendance: () => void;
  completedRounds: number;
  points: number;
  attendanceChecked: boolean;
  streak: number;
}) {
  const missionDone = completedRounds >= 3;
  const palette = dailyPalette();
  const week = weeklyStatus(streak, attendanceChecked);

  return <div className="screen home-screen">
    <header className="topbar">
      <div className="topbar-copy"><span>이번 달 받은 토스포인트</span><strong>{points}<small>원</small></strong></div>
      <button className="icon-button" onClick={onSettings} aria-label="설정"><Icon name="gear" /></button>
    </header>

    <section className="brand-row">
      <div className="brand-mark"><Icon name="drop" size={24}/></div>
      <div><h1>물방울모으기</h1><p>흩어진 물방울을 하나로 모아보세요</p></div>
    </section>

    <section className={`hero-card hero-card-v2 palette-${palette.key}`}>
      <div className="hero-ambient ambient-one"/><div className="hero-ambient ambient-two"/>
      <div className="hero-topline">
        <div><span className="eyebrow">오늘의 물방울</span><h2>{missionDone ? '오늘도 한 방울로 완성!' : '세 번 모으면 10원 준비 완료'}</h2></div>
        <div className="round-count"><strong>{Math.min(completedRounds,3)}</strong><span>/ 3</span></div>
      </div>
      <div className="water-scene water-scene-v2" aria-hidden="true">
        <div className="water-tone-pill"><Icon name="wave" size={15}/><span>오늘의 물빛</span><strong>{palette.label}</strong></div>
        <div className="water-shimmer shimmer-one"/><div className="water-shimmer shimmer-two"/><div className="surface-glow"/>
        <div className="hero-drop hero-drop-main"><i/></div><div className="hero-drop hero-drop-a"><i/></div><div className="hero-drop hero-drop-b"><i/></div><div className="hero-drop hero-drop-c"><i/></div><div className="hero-drop hero-drop-d"><i/></div>
        <div className="hero-ripple ripple-one"/><div className="hero-ripple ripple-two"/><div className="hero-ripple ripple-three"/>
      </div>
      <div className="drop-progress" aria-label={`오늘 ${completedRounds}회 완료`}>
        {[1,2,3].map((index)=><div key={index} className={`drop-progress-item ${completedRounds>=index?'done':completedRounds+1===index?'current':''}`}><span><Icon name="drop" size={index===3?22:18}/></span><small>{index}번째</small></div>)}
      </div>
      <button className="primary-button hero-cta" onClick={onStart}><span>{missionDone?'한 번 더 모아보기':'물방울 모으기'}</span><span className="button-arrow">›</span></button>
      <p className="hero-help">물방울을 밀어 서로 닿게 하면 하나로 합쳐져요</p>
    </section>

    <section className="daily-hub">
      <div className="section-heading"><div><span className="eyebrow">오늘 할 일</span><h3>가볍게 챙겨가세요</h3></div></div>
      <button className={`attendance-card ${attendanceChecked?'done':''}`} onClick={onAttendance} disabled={attendanceChecked}>
        <span className="daily-icon calendar"><Icon name={attendanceChecked?'check':'calendar'} size={21}/></span>
        <div><strong>{attendanceChecked?'오늘 출석 완료':'출석체크'}</strong><p>{attendanceChecked?`${streak}일 연속으로 들렀어요`:'오늘 한 번 눌러 출석을 남겨요'}</p></div>
        <span className="attendance-action">{attendanceChecked?'완료':'+ 출석'}</span>
      </button>
      <div className="mission-card">
        <div className="mission-head"><span className="daily-icon drop"><Icon name="drop" size={21}/></span><div><strong>오늘의 물방울</strong><p>3번 모으면 10원 받기 준비 완료</p></div><b>{Math.min(completedRounds,3)}/3</b></div>
        <div className="mission-track"><i style={{ width:`${Math.min(100,completedRounds/3*100)}%` }}/></div>
        <div className="mission-steps">{[1,2,3].map((step)=><span key={step} className={completedRounds>=step?'done':completedRounds+1===step?'current':''}>{completedRounds>=step?<Icon name="check" size={13}/>:step}</span>)}</div>
      </div>
      <div className={`reward-card ${missionDone?'ready':''}`}>
        <span className="daily-icon gift"><Icon name="gift" size={21}/></span>
        <div><strong>{missionDone?'10원 받을 준비가 됐어요':'오늘 보상'}</strong><p>{missionDone?'최종 리워드 광고 연결 예정':`${3-Math.min(completedRounds,3)}번만 더 모으면 돼요`}</p></div>
        <span className="reward-amount">10원</span>
      </div>
    </section>

    <section className="weekly-card">
      <div className="weekly-head"><div><span className="eyebrow">이번 주</span><h3>물방울 출석</h3></div><div className="streak-pill"><Icon name="sparkle" size={14}/>{streak}일 연속</div></div>
      <div className="weekly-strip">{['월','화','수','목','금','토','오늘'].map((day,index)=><div className={`weekly-day ${week[index]?'done':''} ${index===6?'today':''}`} key={day}><span>{week[index]?<Icon name="drop" size={15}/>:index===6?'오늘':'·'}</span><small>{day}</small></div>)}</div>
      <button className="inline-record-button" type="button" onClick={onOpenRecord}><span><Icon name="history" size={17}/><b>출석·보상 기록 보기</b></span><em>›</em></button>
    </section>

    <AdSlot kind="native"/>

    <section className="tip-card">
      <span className="tip-icon"><Icon name="sparkle" size={18}/></span>
      <div><span className="eyebrow">오늘의 팁</span><strong>{dailyTip()}</strong><p>앱을 열 때마다 같은 안내만 반복되지 않도록 날짜 기준으로 바뀌어요.</p></div>
    </section>
  </div>;
}

function Play({ round, onBack, onRoundComplete }: { round:number; onBack:()=>void; onRoundComplete:()=>void }) {
  const [drops,setDrops] = useState(() => freshRound(round));
  const [complete,setComplete] = useState(false);
  const boardRef = useRef<HTMLDivElement|null>(null);
  const dragRef = useRef<{id:number;pointerId:number}|null>(null);

  useEffect(() => {
    setDrops(freshRound(round));
    setComplete(false);
    dragRef.current = null;
  }, [round]);

  const mergeIfNeeded = (draggedId:number) => setDrops((current) => {
    const dragged = current.find((item) => item.id === draggedId);
    if (!dragged) return current;
    let target: Droplet | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of current) {
      if (candidate.id === draggedId) continue;
      const distance = Math.hypot(candidate.x-dragged.x,candidate.y-dragged.y);
      const threshold = Math.max(9,(candidate.r+dragged.r)*.82);
      if (distance < threshold && distance < best) { target = candidate; best = distance; }
    }
    if (!target) return current;
    const next: Droplet = {
      id: Math.max(dragged.id,target.id)+100,
      x: (dragged.x*dragged.r+target.x*target.r)/(dragged.r+target.r),
      y: (dragged.y*dragged.r+target.y*target.r)/(dragged.r+target.r),
      r: Math.min(66,Math.sqrt(dragged.r**2+target.r**2)*1.02),
      tone: (dragged.tone+target.tone+1)%3,
    };
    const result = current.filter((item) => item.id !== dragged.id && item.id !== target!.id).concat(next);
    if (result.length === 1) window.setTimeout(() => setComplete(true),220);
    return result;
  });

  const moveDrop = (event:ReactPointerEvent<HTMLButtonElement>,id:number) => {
    if (!dragRef.current || dragRef.current.id !== id || dragRef.current.pointerId !== event.pointerId || !boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const x = Math.max(8,Math.min(92,((event.clientX-rect.left)/rect.width)*100));
    const y = Math.max(8,Math.min(92,((event.clientY-rect.top)/rect.height)*100));
    setDrops((current) => current.map((item) => item.id===id ? {...item,x,y} : item));
  };

  const endDrag = (event:ReactPointerEvent<HTMLButtonElement>,id:number) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    mergeIfNeeded(id);
  };

  return <div className="screen play-screen">
    <header className="play-topbar"><button className="icon-button back-button" onClick={onBack} aria-label="뒤로"><Icon name="back"/></button><div className="play-progress"><span>오늘 {round}번째</span><strong>{round}<small>/3</small></strong></div><div className="topbar-spacer"/></header>
    <section className="play-copy"><span className="eyebrow">물방울 {drops.length}개 남았어요</span><h1>{drops.length>1?'서로 가까이 밀어보세요':'마지막 물방울 완성!'}</h1><p>물방울끼리 닿으면 자연스럽게 하나로 합쳐져요</p></section>
    <section className={`drop-board ${complete?'is-complete':''}`} ref={boardRef}>
      <div className="board-light board-light-one"/><div className="board-light board-light-two"/><div className="board-grid"/>
      {drops.map((drop)=><button type="button" className={`interactive-drop tone-${drop.tone}`} key={drop.id} style={{left:`${drop.x}%`,top:`${drop.y}%`,width:drop.r*2,height:drop.r*2}} aria-label="물방울 이동" onPointerDown={(event)=>{dragRef.current={id:drop.id,pointerId:event.pointerId};event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={(event)=>moveDrop(event,drop.id)} onPointerUp={(event)=>endDrag(event,drop.id)} onPointerCancel={(event)=>endDrag(event,drop.id)}><i className="drop-shine"/><i className="drop-reflect"/></button>)}
      <div className="board-caption"><span className="finger-dot"/> 손가락으로 천천히 밀어보세요</div>
    </section>
    <div className="play-tip"><Icon name="sparkle" size={18}/><span>팁</span><p>큰 물방울부터 작은 물방울 쪽으로 밀면 더 쉽게 모여요.</p></div>
    {complete&&<div className="completion-overlay" role="dialog" aria-modal="true" aria-label="라운드 완료"><div className="completion-card"><div className="completion-drop"><Icon name="drop" size={38}/><span/></div><span className="eyebrow">{round}번째 완료</span><h2>{round<3?'깔끔하게 하나로 모였어요':'오늘 물방울을 모두 모았어요'}</h2><p>{round<3?`이제 ${round+1}번째 물방울로 넘어가요.`:'10원 받기 단계로 이어져요.'}</p>{round<3?<div className="ad-transition-preview"><span>AD</span><div><strong>전면 광고 연결 구간</strong><small>라운드가 완전히 끝난 뒤에만 노출 예정</small></div></div>:<div className="rewarded-transition-preview"><Icon name="gift" size={19}/><div><strong>리워드 광고 연결 구간</strong><small>10원 받기 버튼에서만 연결 예정</small></div></div>}<button className="primary-button" onClick={onRoundComplete}>{round<3?'다음 물방울':'10원 받기'}</button></div></div>}
  </div>;
}

function RecordSheet({ completedRounds, points, attendanceChecked, streak, onClose }: { completedRounds:number; points:number; attendanceChecked:boolean; streak:number; onClose:()=>void }) {
  const week = weeklyStatus(streak, attendanceChecked);
  const days = ['월','화','수','목','금','토','오늘'];
  return <div className="sheet-backdrop" onMouseDown={onClose} role="presentation"><section className="settings-sheet record-sheet" onMouseDown={(event)=>event.stopPropagation()} role="dialog" aria-modal="true" aria-label="출석과 보상 기록">
    <div className="sheet-handle"/>
    <div className="sheet-title"><div><span className="eyebrow">나의 기록</span><h2>출석·보상 기록</h2></div><button className="sheet-close" onClick={onClose}>닫기</button></div>
    <div className="record-summary"><div><span>이번 달 포인트</span><strong>{points}<small>원</small></strong></div><div><span>오늘 물방울</span><strong>{Math.min(completedRounds,3)}<small>/3</small></strong></div></div>
    <div className="record-block"><div className="record-block-head"><div><span className="eyebrow">최근 7일</span><strong>{streak}일 연속 들렀어요</strong></div></div><div className="weekly-strip sheet-weekly">{days.map((day,index)=><div className={`weekly-day ${week[index]?'done':''} ${index===6?'today':''}`} key={day}><span>{week[index]?<Icon name="drop" size={15}/>:index===6?'오늘':'·'}</span><small>{day}</small></div>)}</div></div>
    <AdSlot compact kind="banner"/>
    <div className="record-block"><span className="eyebrow">이용 방법</span><div className="record-guide"><div><b>1</b><span><strong>밀기</strong><small>물방울을 손가락으로 움직여요</small></span></div><div><b>2</b><span><strong>합치기</strong><small>서로 닿으면 하나가 돼요</small></span></div><div><b>3</b><span><strong>받기</strong><small>세 번 완료 후 10원을 받아요</small></span></div></div></div>
  </section></div>;
}

function SettingsSheet({ sound,vibration,onSound,onVibration,onClose }: { sound:boolean; vibration:boolean; onSound:()=>void; onVibration:()=>void; onClose:()=>void }) {
  return <div className="sheet-backdrop" onMouseDown={onClose} role="presentation"><section className="settings-sheet" onMouseDown={(event)=>event.stopPropagation()} role="dialog" aria-modal="true" aria-label="설정"><div className="sheet-handle"/><div className="sheet-title"><div><span className="eyebrow">설정</span><h2>사용 환경</h2></div><button className="sheet-close" onClick={onClose}>닫기</button></div><button className="setting-row" onClick={onSound}><div><strong>효과음</strong><p>물방울이 합쳐지는 소리를 들려줘요</p></div><span className={`switch ${sound?'on':''}`}><i/></span></button><button className="setting-row" onClick={onVibration}><div><strong>진동</strong><p>합쳐질 때 가벼운 손맛을 더해요</p></div><span className={`switch ${vibration?'on':''}`}><i/></span></button><div className="sheet-info">광고·포인트·토스 SDK는 실제 연동 전이며, 현재는 자리와 흐름만 미리 잡아둔 상태예요.</div></section></div>;
}

export default function App() {
  const [view,setView] = useState<View>('home');
  const [sheet,setSheet] = useState<Sheet>(null);
  const [round,setRound] = useState(1);
  const [completedRounds,setCompletedRounds] = useState(0);
  const [points,setPoints] = useState(0);
  const [sound,setSound] = useState(true);
  const [vibration,setVibration] = useState(true);
  const [attendanceChecked,setAttendanceChecked] = useState(false);
  const [streak,setStreak] = useState(4);

  const start = () => {
    const nextRound = completedRounds>=3 ? 1 : Math.max(1,completedRounds+1);
    if(completedRounds>=3) setCompletedRounds(0);
    setSheet(null);
    setRound(nextRound);
    setView('play');
  };

  const finishRound = () => {
    if(round<3){ setCompletedRounds(round); setRound(round+1); return; }
    setCompletedRounds(3);
    setPoints((current)=>current+10);
    setView('home');
  };

  const checkAttendance = () => {
    if(attendanceChecked) return;
    setAttendanceChecked(true);
    setStreak((current)=>current+1);
  };

  return <div className="app-shell"><main className="app-content">{view==='home'&&<Home onStart={start} onOpenRecord={()=>setSheet('record')} onSettings={()=>setSheet('settings')} onAttendance={checkAttendance} completedRounds={completedRounds} points={points} attendanceChecked={attendanceChecked} streak={streak}/>} {view==='play'&&<Play round={round} onBack={()=>setView('home')} onRoundComplete={finishRound}/>}</main>{sheet==='settings'&&<SettingsSheet sound={sound} vibration={vibration} onSound={()=>setSound((value)=>!value)} onVibration={()=>setVibration((value)=>!value)} onClose={()=>setSheet(null)}/>} {sheet==='record'&&<RecordSheet completedRounds={completedRounds} points={points} attendanceChecked={attendanceChecked} streak={streak} onClose={()=>setSheet(null)}/>}</div>;
}
