import { useEffect, useRef, useState } from 'preact/hooks';
import { fmtNum } from './format';

/** Número que se desliza hacia su nuevo valor y "late" cuando sube de golpe. */
export function AnimatedNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const [bump, setBump] = useState(0);
  const from = useRef(value);
  const lastBump = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const origin = shown;
    from.current = origin;
    if (value - lastBump.current >= 10 || value < lastBump.current - 1) {
      setBump((n) => n + 1);
      lastBump.current = value;
    }
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 450);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(origin + (value - origin) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [Math.floor(value)]);
  return (
    <b key={bump} class={bump ? 'num bump' : 'num'}>
      {fmtNum(shown)}
    </b>
  );
}
