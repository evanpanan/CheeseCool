'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useReducedMotion } from './network/use-spatial-graph';

type Grain = { x: number; y: number; homeX: number; homeY: number; vx: number; vy: number; color: string };

export function InteractiveBrand({ children }: { children: ReactNode }) {
  const mark = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const element = mark.current;
    const surface = canvas.current;
    if (!element || !surface || reduced) return;
    const context = surface.getContext('2d');
    if (!context) return;
    const target = element.closest('a') ?? element;
    const image = new Image();
    const source = element.querySelector<HTMLElement>('.brand-source');
    const icon = source?.querySelector<HTMLImageElement>('img');
    const wordmark = source?.querySelector<HTMLElement>('.brand-wordmark');
    if (!source || !icon || !wordmark) return;
    let width = 180, height = 32;
    let imageReady = false;
    let grains: Grain[] = [];
    let frame = 0;
    let clearTimer = 0;
    let disposed = false;
    let previous = 0;
    let lastBurst = -1000;
    let pointer = { x: -1000, y: -1000, expires: 0 };

    function finish() {
      element!.dataset.phase = 'solid';
      clearTimer = window.setTimeout(() => context!.clearRect(0, 0, width + 40, height + 40), 140);
    }

    function draw(now: number) {
      frame = 0;
      if (disposed || document.hidden) return;
      const step = previous ? Math.min(2, (now - previous) / 16.67) : 1;
      previous = now;
      context!.clearRect(0, 0, width + 40, height + 40);
      let moving = false;
      for (const grain of grains) {
        const dx = grain.x - pointer.x, dy = grain.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (now < pointer.expires && distance > .01 && distance < 18) {
          const force = (1 - distance / 18) * 1.2 * step;
          grain.vx += dx / distance * force;
          grain.vy += dy / distance * force;
        }
        grain.vx = (grain.vx + (grain.homeX - grain.x) * .065 * step) * Math.pow(.76, step);
        grain.vy = (grain.vy + (grain.homeY - grain.y) * .065 * step) * Math.pow(.76, step);
        grain.x += grain.vx * step;
        grain.y += grain.vy * step;
        moving ||= Math.abs(grain.vx) + Math.abs(grain.vy) + Math.abs(grain.x - grain.homeX) + Math.abs(grain.y - grain.homeY) > .045;
        context!.fillStyle = grain.color;
        context!.beginPath();
        context!.arc(grain.x, grain.y, .8, 0, Math.PI * 2);
        context!.fill();
      }
      if (moving) frame = requestAnimationFrame(draw);
      else { previous = 0; finish(); }
    }

    function wake() {
      if (frame || disposed || document.hidden) return;
      window.clearTimeout(clearTimer);
      element!.dataset.phase = 'particles';
      frame = requestAnimationFrame(draw);
    }

    function burst() {
      const now = performance.now();
      if (!grains.length || now - lastBurst < 500) return;
      lastBurst = now;
      for (let index = 0; index < grains.length; index++) {
        const grain = grains[index];
        const angle = Math.atan2(grain.y - height / 2 - 20, grain.x - width / 2 - 20);
        const force = 1.7 + (index % 4) * .35;
        grain.vx += Math.cos(angle) * force;
        grain.vy += Math.sin(angle) * force;
      }
      wake();
    }

    function move(event: Event) {
      const pointerEvent = event as PointerEvent;
      if (pointerEvent.pointerType === 'touch') return;
      const box = target.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const x = (pointerEvent.clientX - box.left) / box.width;
      const y = (pointerEvent.clientY - box.top) / box.height;
      element!.style.setProperty('--brand-x', Math.max(-1, Math.min(1, x * 2 - 1)) * 1.5 + 'px');
      element!.style.setProperty('--brand-y', Math.max(-1, Math.min(1, y * 2 - 1)) * 1.5 + 'px');
      element!.style.setProperty('--brand-tilt', Math.max(-1, Math.min(1, x * 2 - 1)) * 1.5 + 'deg');
      pointer = { x: x * width + 20, y: y * height + 20, expires: performance.now() + 150 };
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1 && grains.length) wake();
    }

    function leave() {
      pointer.expires = 0;
      element!.style.removeProperty('--brand-x');
      element!.style.removeProperty('--brand-y');
      element!.style.removeProperty('--brand-tilt');
    }

    function down(event: Event) {
      if ((event as PointerEvent).pointerType === 'touch') burst();
    }

    function reset() {
      cancelAnimationFrame(frame);
      window.clearTimeout(clearTimer);
      frame = 0; previous = 0;
      for (const grain of grains) { grain.x = grain.homeX; grain.y = grain.homeY; grain.vx = 0; grain.vy = 0; }
      element!.dataset.phase = 'solid';
      context!.clearRect(0, 0, width + 40, height + 40);
      leave();
    }

    function visibility() { if (document.hidden) reset(); }

    function rasterize() {
      if (disposed || !imageReady) return;
      reset();
      const oldTransform = element!.style.transform;
      const oldTransition = element!.style.transition;
      element!.style.transition = 'none';
      element!.style.transform = 'none';
      try {
        const box = source!.getBoundingClientRect();
        if (!box.width || !box.height) return;
        width = Math.ceil(box.width); height = Math.ceil(box.height);
        const ratio = Math.min(devicePixelRatio || 1, 2);
        surface!.width = Math.ceil((width + 40) * ratio);
        surface!.height = Math.ceil((height + 40) * ratio);
        surface!.style.width = width + 40 + 'px';
        surface!.style.height = height + 40 + 'px';
        context!.setTransform(ratio, 0, 0, ratio, 0, 0);
        const sample = document.createElement('canvas');
        sample.width = width * 2; sample.height = height * 2;
        const brush = sample.getContext('2d');
        if (!brush) return;
        brush.scale(2, 2);
        const iconBox = icon!.getBoundingClientRect();
        const iconHeight = iconBox.width * 88 / 96;
        brush.drawImage(image, iconBox.left - box.left, iconBox.top - box.top + (iconBox.height - iconHeight) / 2, iconBox.width, iconHeight);

        // Sample the live text ranges so spacing, weight and both brand colours match the DOM.
        const walker = document.createTreeWalker(wordmark!, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode();
        while (textNode) {
          const text = textNode.textContent || '';
          const style = getComputedStyle(textNode.parentElement!);
          const fontSize = parseFloat(style.fontSize) || 21;
          brush.font = style.fontStyle + ' ' + style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
          brush.fillStyle = style.color;
          brush.textBaseline = 'alphabetic';
          for (let index = 0; index < text.length; index++) {
            const range = document.createRange();
            range.setStart(textNode, index); range.setEnd(textNode, index + 1);
            const glyph = range.getBoundingClientRect();
            const metrics = brush.measureText(text[index]);
            const descent = Number.isFinite(metrics.fontBoundingBoxDescent) ? metrics.fontBoundingBoxDescent : fontSize * .22;
            brush.fillText(text[index], glyph.left - box.left, glyph.bottom - box.top - descent);
          }
          textNode = walker.nextNode();
        }
        const pixels = brush.getImageData(0, 0, sample.width, sample.height).data;
        grains = [];
        for (let y = 0; y < sample.height; y += 4) {
          for (let x = 0; x < sample.width; x += 4) {
            const offset = (y * sample.width + x) * 4;
            if (pixels[offset + 3] < 100) continue;
            const homeX = x / 2 + 20, homeY = y / 2 + 20;
            grains.push({ x: homeX, y: homeY, homeX, homeY, vx: 0, vy: 0,
              color: 'rgb(' + pixels[offset] + ' ' + pixels[offset + 1] + ' ' + pixels[offset + 2] + ')' });
          }
        }
        element!.dataset.ready = String(grains.length > 0);
      } catch {
        element!.dataset.ready = 'false';
      } finally {
        element!.style.transform = oldTransform;
        element!.style.transition = oldTransition;
      }
    }

    image.onload = () => { imageReady = true; rasterize(); };
    image.src = '/cheesecool-logo.svg';
    target.addEventListener('pointerenter', burst);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerleave', leave);
    target.addEventListener('pointerdown', down);
    target.addEventListener('focus', burst);
    target.addEventListener('blur', leave);
    document.addEventListener('visibilitychange', visibility);
    const themeObserver = new MutationObserver(rasterize);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const resizeObserver = new ResizeObserver(rasterize);
    resizeObserver.observe(source);
    document.fonts?.ready.then(() => { if (!disposed) rasterize(); });
    window.addEventListener('resize', rasterize);
    return () => {
      disposed = true;
      image.onload = null;
      cancelAnimationFrame(frame);
      window.clearTimeout(clearTimer);
      element.dataset.phase = 'solid';
      element.dataset.ready = 'false';
      leave();
      target.removeEventListener('pointerenter', burst);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerleave', leave);
      target.removeEventListener('pointerdown', down);
      target.removeEventListener('focus', burst);
      target.removeEventListener('blur', leave);
      document.removeEventListener('visibilitychange', visibility);
      themeObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', rasterize);
    };
  }, [reduced]);

  return <span ref={mark} className="brand interactive-brand" data-phase="solid" data-ready="false">
    <span className="brand-source">{children}</span>
    <canvas ref={canvas} aria-hidden="true"/>
  </span>;
}
