import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity, zoomTransform } from "d3-zoom";
import { wheelAction } from "@/lib/gestures";

/** Canvas colours from CSS custom properties on `el`, e.g. `{ fg: "--foreground" }`, so they follow the theme. */
export function readPalette<K extends string>(el: Element, vars: Record<K, string>): Record<K, string> {
  const css = getComputedStyle(el);
  return Object.fromEntries(Object.entries<string>(vars).map(([key, name]) => [key, css.getPropertyValue(name).trim()])) as Record<K, string>;
}

/** Sizes a canvas to `width` × `height` CSS px, with a backing store crisp on HiDPI screens. */
export function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

/**
 * Time-axis zoom on `canvas`: drag pans x only (vertical pan belongs to the scroll container), and wheel and trackpad
 * gestures follow `wheelAction`: pinch zooms around the pointer, a sideways swipe pans, a vertical swipe scrolls when
 * `overflows()` or zooms otherwise. `onZoom` gets the transform with its y dropped.
 */
export function horizontalZoom(canvas: HTMLCanvasElement, maxScale: number, overflows: () => boolean, onZoom: (transform: ZoomTransform) => void) {
  const behavior: ZoomBehavior<HTMLCanvasElement, unknown> = zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([1, maxScale])
    .filter((event: MouseEvent) => event.type !== "wheel" && !event.button)
    .on("zoom", (event: { transform: ZoomTransform }) => onZoom(zoomIdentity.translate(event.transform.x, 0).scale(event.transform.k)));
  select(canvas).call(behavior).on("dblclick.zoom", null);
  const onWheel = (event: WheelEvent) => {
    const action = wheelAction(event, overflows());
    if (action.type === "scroll") return; // the browser scrolls the container
    event.preventDefault();
    if (action.type === "zoom") select(canvas).call(behavior.scaleBy, action.factor, [event.clientX - canvas.getBoundingClientRect().left, 0]);
    else select(canvas).call(behavior.translateBy, -action.dx / zoomTransform(canvas).k, 0);
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });
  return {
    behavior,
    dispose: () => {
      select(canvas).on(".zoom", null);
      canvas.removeEventListener("wheel", onWheel);
    },
  };
}
