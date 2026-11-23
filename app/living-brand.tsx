'use client';

import { useEffect, useRef, useState } from 'react';
import { CheeseMark } from './icons';
import { useReducedMotion } from './network/use-spatial-graph';

const phrases = ['把好东西都存起来。', 'Save the cool stuff.', '让灵感，连起来。'];

type Grain = { x: number; y: number; homeX: number; homeY: number; vx: number; vy: number; color: string };

export function LivingBrand() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const interact = useRef<(x: number, y: number, burst?: boolean) => void>(() => {});
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<'solid' | 'particles' | 'gathered'>('solid');
  const [phrase, setPhrase] = useState(0);
  const lastChange = useRef(0);

  function nextPhrase() {
    const now = performance.now();
    if (now - lastChange.current < 650) return;
    lastChange.current = now;
    setPhrase(value => (value + 1) % phrases.length);
  }

  useEffect(() => {
    const surface = canvas.current;
    if (!surface || reduced) return;
    setPhase('solid');
    setReady(false);
    const context = surface.getContext('2d');
    if (!context) return;
    const image = new Image();
    let disposed = false;
    let frame = 0;
    let previous = 0;
    let active = false;
    let resolveTimer = 0;
    let grains: Grain[] = [];
    let pointer = { x: -1000, y: -1000 };
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    surface.width = 176 * ratio;
    surface.height = 144 * ratio;
    context.scale(ratio, ratio);

    function draw(time: number) {
      frame = 0;
      if (disposed || document.hidden) return;
      const step = previous ? Math.min(2, (time - previous) / 16.67) : 1;
      previous = time;
      context!.clearRect(0, 0, 176, 144);
      let moving = false;
      for (const grain of grains) {
        const dx = grain.x - pointer.x;
        const dy = grain.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 38 && distance > .01) {
          const force = (1 - distance / 38) * 1.9;
          grain.vx += dx / distance * force * step;
          grain.vy += dy / distance * force * step;
        }
        grain.vx = (grain.vx + (grain.homeX - grain.x) * .034 * step) * Math.pow(.82, step);
        grain.vy = (grain.vy + (grain.homeY - grain.y) * .034 * step) * Math.pow(.82, step);
        grain.x += grain.vx * step;
        grain.y += grain.vy * step;
        moving ||= Math.abs(grain.vx) + Math.abs(grain.vy) + Math.abs(grain.x - grain.homeX) + Math.abs(grain.y - grain.homeY) > .08;
        context!.fillStyle = grain.color;
        context!.beginPath();
        context!.arc(grain.x, grain.y, 1.12, 0, Math.PI * 2);
        context!.fill();
      }
      if (moving) frame = requestAnimationFrame(draw);
      else {
        previous = 0;
        if (active) {
          active = false;
          setPhase('gathered');
          resolveTimer = window.setTimeout(() => setPhase('solid'), 200);
        }
      }
    }

    function wake() {
      if (!frame && !disposed && !document.hidden) frame = requestAnimationFrame(draw);
    }

    image.onload = () => {
      if (disposed) return;
      const sample = document.createElement('canvas');
      sample.width = 96;
      sample.height = 88;
      const sampleContext = sample.getContext('2d');
      if (!sampleContext) return;
      sampleContext.drawImage(image, 0, 0, 96, 88);
      let pixels: Uint8ClampedArray;
      try { pixels = sampleContext.getImageData(0, 0, 96, 88).data; }
      catch { return; }
      for (let y = 0; y < 88; y += 2.3) {
        for (let x = 0; x < 96; x += 2.3) {
          const offset = (Math.floor(y) * 96 + Math.floor(x)) * 4;
          if (pixels[offset + 3] < 110) continue;
          const homeX = x + 40;
          const homeY = y + 28;
          grains.push({ x: homeX, y: homeY, homeX, homeY, vx: 0, vy: 0,
            color: `rgb(${pixels[offset]} ${pixels[offset + 1]} ${pixels[offset + 2]})` });
        }
      }
      setReady(true);
      wake();
    };
    image.src = '/cheesecool-logo.svg';
    interact.current = (x, y, burst) => {
      if (!grains.length) return;
      if (x >= 0 || burst) {
        window.clearTimeout(resolveTimer);
        active = true;
        setPhase('particles');
      } else if (!active) return;
      pointer = { x, y };
      if (burst) {
        pointer = { x: -1000, y: -1000 };
        for (const grain of grains) {
          const angle = Math.atan2(grain.y - 72, grain.x - 88);
          grain.vx += Math.cos(angle) * 5;
          grain.vy += Math.sin(angle) * 5;
        }
      }
      wake();
    };
    function visibility() { previous = 0; if (!document.hidden) wake(); }
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(resolveTimer);
      image.onload = null;
      interact.current = () => {};
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [reduced]);

  return <div className="living-brand">
    <button className="living-mark" data-phase={reduced ? 'solid' : phase} type="button" aria-label="轻触芝士，唤醒灵感"
      onPointerMove={event => {
        if (event.pointerType === 'touch') return;
        const rect = event.currentTarget.getBoundingClientRect();
        interact.current((event.clientX - rect.left) * 176 / rect.width, (event.clientY - rect.top) * 144 / rect.height);
      }}
      onPointerLeave={() => interact.current(-1000, -1000)}
      onBlur={() => interact.current(-1000, -1000)}
      onClick={() => { interact.current(88, 72, true); nextPhrase(); }}>
      <span className="living-fallback" data-hidden={ready && !reduced && phase !== 'solid'}><CheeseMark size={96}/></span>
      <canvas ref={canvas} aria-hidden="true" data-ready={ready && !reduced && phase !== 'solid'}/>
    </button>
    <h1 id="hero-title" className="living-slogan">
      <button type="button" aria-label={phrases[phrase] + ' 切换标语'}
        onPointerEnter={event => { if (event.pointerType === 'mouse') nextPhrase(); }}
        onClick={nextPhrase}>
        <span className="slogan-line" key={phrase} aria-hidden="true" lang={phrase === 1 ? 'en' : 'zh-CN'}>
          {Array.from(phrases[phrase]).map((letter, index) => <span key={index}
            style={{ animationDelay: `${index * 17}ms` }}>{letter === ' ' ? '\u00a0' : letter}</span>)}
        </span>
      </button>
    </h1>
  </div>;
}
