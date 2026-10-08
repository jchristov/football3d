// A tap with a finger (a short touch that hardly moves) on `el`: calls onTap(clientX, clientY). Drags, long presses and
// mouse clicks are not taps, so the stick and the mouse controls are not disturbed.
export const TAP_MS = 320, TAP_PX = 14;

export function bindTapSelect(el, onTap, now = () => performance.now()) {
  const down = new Map(); // pointerId -> { x, y, t }
  const onDown = (e) => { if (e.pointerType === 'touch') down.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now() }); };
  const onUp = (e) => {
    const d = down.get(e.pointerId);
    down.delete(e.pointerId);
    if (d && now() - d.t <= TAP_MS && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= TAP_PX) onTap(e.clientX, e.clientY);
  };
  const onCancel = (e) => down.delete(e.pointerId);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onCancel); };
}
