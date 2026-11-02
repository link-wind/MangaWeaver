import { useEffect, useRef, useState } from "react";

export function usePanelWidth(key: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved >= min ? Math.min(saved, max) : initial;
  });
  useEffect(() => {
    localStorage.setItem(key, String(width));
  }, [key, width]);
  return [width, setWidth] as const;
}

export function PanelResizeHandle({ label, width, min, max, initial, direction = 1, onChange }: {
  label: string;
  width: number;
  min: number;
  max: () => number;
  initial: number;
  direction?: 1 | -1;
  onChange: (width: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const limit = () => Math.max(min, max());
  const change = (value: number) => onChange(Math.round(Math.max(min, Math.min(value, limit()))));
  function end() {
    start.current = null;
    setDragging(false);
  }
  return <div
    className={`panel-resizer ${dragging ? "dragging" : ""}`}
    role="separator"
    aria-label={label}
    aria-orientation="vertical"
    aria-valuenow={width}
    aria-valuemin={min}
    aria-valuemax={limit()}
    tabIndex={0}
    title="拖动调整宽度，双击还原"
    onPointerDown={(e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = { x: e.clientX, width: Math.min(width, limit()) };
      setDragging(true);
    }}
    onPointerMove={(e) => {
      if (start.current) change(start.current.width + (e.clientX - start.current.x) * direction);
    }}
    onPointerUp={end}
    onPointerCancel={end}
    onLostPointerCapture={end}
    onDoubleClick={() => change(initial)}
    onKeyDown={(e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        change(width + (e.key === "ArrowRight" ? 10 : -10) * direction);
      } else if (e.key === "Home") {
        e.preventDefault();
        change(initial);
      }
    }}
  />;
}
