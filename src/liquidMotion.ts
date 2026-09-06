import './liquid-motion.css';

const ATTRACT_GAP_PX = 30;

let activePointerId: number | null = null;
let activeDrop: HTMLElement | null = null;
let activeTarget: HTMLElement | null = null;

function closestDrop(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>('.interactive-drop') : null;
}

function clearPair() {
  for (const element of [activeDrop, activeTarget]) {
    if (!element) continue;
    element.classList.remove('is-attracting', 'is-attraction-source', 'is-attraction-target');
    element.style.removeProperty('--pull-angle');
    element.style.removeProperty('--pull-distance');
    element.style.removeProperty('--pull-stretch');
    element.style.removeProperty('--pull-squash');
    element.style.removeProperty('--neck-length');
    element.style.removeProperty('--neck-opacity');
  }
  activeTarget = null;
}

function clearInteraction() {
  clearPair();
  activePointerId = null;
  activeDrop = null;
}

function setAttractionStyle(element: HTMLElement, angle: number, strength: number, gap: number) {
  const pullDistance = 1.5 + strength * 4.5;
  const stretch = 1.025 + strength * 0.12;
  const squash = 1 - strength * 0.075;
  const neckLength = Math.max(8, Math.min(30, gap + 14));

  element.style.setProperty('--pull-angle', `${angle}deg`);
  element.style.setProperty('--pull-distance', `${pullDistance}px`);
  element.style.setProperty('--pull-stretch', stretch.toFixed(3));
  element.style.setProperty('--pull-squash', squash.toFixed(3));
  element.style.setProperty('--neck-length', `${neckLength}px`);
  element.style.setProperty('--neck-opacity', (0.16 + strength * 0.54).toFixed(3));
}

function updateAttraction() {
  if (!activeDrop) return;
  const board = activeDrop.closest<HTMLElement>('.drop-board');
  if (!board) return;

  const sourceRect = activeDrop.getBoundingClientRect();
  const sourceX = sourceRect.left + sourceRect.width / 2;
  const sourceY = sourceRect.top + sourceRect.height / 2;
  const sourceRadius = Math.min(sourceRect.width, sourceRect.height) / 2;

  let nearest: HTMLElement | null = null;
  let nearestGap = Number.POSITIVE_INFINITY;
  let nearestAngle = 0;

  for (const candidate of board.querySelectorAll<HTMLElement>('.interactive-drop')) {
    if (candidate === activeDrop) continue;
    const targetRect = candidate.getBoundingClientRect();
    const targetX = targetRect.left + targetRect.width / 2;
    const targetY = targetRect.top + targetRect.height / 2;
    const targetRadius = Math.min(targetRect.width, targetRect.height) / 2;
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const centerDistance = Math.hypot(dx, dy);
    const edgeGap = centerDistance - sourceRadius - targetRadius;

    if (edgeGap < nearestGap) {
      nearest = candidate;
      nearestGap = edgeGap;
      nearestAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    }
  }

  if (!nearest || nearestGap > ATTRACT_GAP_PX) {
    clearPair();
    return;
  }

  if (activeTarget && activeTarget !== nearest) clearPair();
  activeTarget = nearest;

  const normalizedGap = Math.max(0, nearestGap);
  const strength = Math.max(0, Math.min(1, (ATTRACT_GAP_PX - normalizedGap) / ATTRACT_GAP_PX));

  activeDrop.classList.add('is-attracting', 'is-attraction-source');
  nearest.classList.add('is-attracting', 'is-attraction-target');
  setAttractionStyle(activeDrop, nearestAngle, strength, normalizedGap);
  setAttractionStyle(nearest, nearestAngle + 180, strength * 0.92, normalizedGap);
}

document.addEventListener('pointerdown', (event) => {
  const drop = closestDrop(event.target);
  if (!drop) return;
  activePointerId = event.pointerId;
  activeDrop = drop;
  updateAttraction();
}, true);

document.addEventListener('pointermove', (event) => {
  if (event.pointerId !== activePointerId || !activeDrop) return;
  if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) return;
  updateAttraction();
}, true);

document.addEventListener('pointerup', (event) => {
  if (event.pointerId === activePointerId) clearInteraction();
}, true);

document.addEventListener('pointercancel', (event) => {
  if (event.pointerId === activePointerId) clearInteraction();
}, true);

document.addEventListener('lostpointercapture', (event) => {
  if (event.pointerId === activePointerId) clearInteraction();
}, true);
