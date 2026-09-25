/**
 * Wheel and trackpad gestures. A trackpad pinch arrives as a wheel event with
 * ctrlKey set, the same as Ctrl/⌘ + wheel on a mouse.
 */

export type WheelInput = { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean };
export type WheelAction = { type: "zoom"; factor: number } | { type: "pan"; dx: number } | { type: "scroll" };

/** Line- and page-mode wheel deltas in px, so mice and trackpads move alike. */
const deltaPx = (delta: number, mode: number) => delta * (mode === 1 ? 16 : mode === 2 ? 400 : 1);

/**
 * What a wheel or trackpad gesture does on the timeline. A pinch arrives as a
 * wheel event with ctrlKey set (Ctrl/⌘ + wheel on a mouse): zoom. A mostly
 * sideways swipe (or Shift + wheel) pans through time. Vertical movement scrolls
 * the lanes when they overflow, and zooms otherwise.
 */
export function wheelAction(e: WheelInput, lanesOverflow: boolean): WheelAction {
  const dx = deltaPx(e.deltaX, e.deltaMode);
  const dy = deltaPx(e.deltaY, e.deltaMode);
  if (e.ctrlKey || e.metaKey) return { type: "zoom", factor: Math.exp(-dy * 0.01) };
  if (Math.abs(dx) > Math.abs(dy)) return { type: "pan", dx };
  if (lanesOverflow) return { type: "scroll" };
  return { type: "zoom", factor: Math.exp(-dy * 0.002) };
}

export type GraphWheelAction = { type: "zoom"; factor: number } | { type: "pan"; dx: number; dy: number };

/**
 * On the node graph, like Figma: pinch (or Ctrl/⌘ + wheel) zooms; any swipe
 * pans in both directions, and a plain mouse wheel pans vertically (Shift +
 * wheel sideways).
 */
export function graphWheelAction(e: WheelInput): GraphWheelAction {
  const dx = deltaPx(e.deltaX, e.deltaMode);
  const dy = deltaPx(e.deltaY, e.deltaMode);
  if (e.ctrlKey || e.metaKey) return { type: "zoom", factor: Math.exp(-dy * 0.01) };
  return { type: "pan", dx, dy };
}
