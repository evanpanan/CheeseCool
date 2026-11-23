'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { workspaceIntent } from '@/lib/workspace-input';
import { submitWorkspace, type WorkspaceResult } from './actions';
import { useWorkspaceActivity } from './workspace-activity';
import { Icon } from './icons';
import { AiSignal } from './ai-signal';

async function submitWithFeedback(state: WorkspaceResult, form: FormData): Promise<WorkspaceResult> {
  try {
    return await submitWorkspace(state, form);
  } catch (error) {
    // Let Next.js complete authentication redirects.
    if (error instanceof Error && 'digest' in error && String(error.digest).startsWith('NEXT_REDIRECT')) throw error;
    return {
      kind: workspaceIntent(String(form.get('url') ?? '')).kind,
      error: '这次没能提交成功，内容已保留，请再试一次。',
    };
  }
}

export function WorkspaceInput({ onResult }: { onResult: (result: WorkspaceResult) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const submitted = useRef('');
  const discardSearch = useRef(false);
  const { search, clearSearch } = useWorkspaceActivity();
  const previousSearch = useRef(search);
  const [value, setValue] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [feedbackLeaving, setFeedbackLeaving] = useState(false);
  const [state, action, pending] = useActionState(submitWithFeedback, {});
  const intent = workspaceIntent(value).kind;
  const error = showResult && !pending ? state.error : undefined;

  useEffect(() => {
    const collapse=()=>{
      const active=document.activeElement;
      if(active instanceof HTMLElement && form.current?.contains(active))active.blur();
      setFocused(false);setHovered(false);setExpanded(false);
    };
    const outside=(event:PointerEvent)=>{
      if(event.target instanceof Node && !form.current?.contains(event.target))collapse();
    };
    document.addEventListener('pointerdown',outside,true);
    window.addEventListener('cheesecool:workspace-outside',collapse);
    return ()=>{
      document.removeEventListener('pointerdown',outside,true);
      window.removeEventListener('cheesecool:workspace-outside',collapse);
    };
  },[]);

  useEffect(() => {
    inFlight.current = false;
    if (!state.ok || (state.kind === 'search' && discardSearch.current)) return;
    if (state.kind === 'save') setValue(current => current === submitted.current ? '' : current);
    onResult(state);
  }, [state, onResult]);

  useEffect(() => {
    setFeedbackLeaving(false);
    if (!showResult || pending || !state.ok || state.kind !== 'save') return;
    const fade = window.setTimeout(() => setFeedbackLeaving(true), 2300);
    const dismiss = window.setTimeout(() => { setShowResult(false); setFeedbackLeaving(false); }, 2700);
    return () => { window.clearTimeout(fade); window.clearTimeout(dismiss); };
  }, [state, pending, showResult]);

  useEffect(() => {
    if (focused || hovered || pending || error) return;
    const timeout = window.setTimeout(() => setExpanded(false), 2400);
    return () => window.clearTimeout(timeout);
  }, [focused, hovered, pending, error, value, state]);

  useEffect(() => {
    const oldQuery = previousSearch.current?.query;
    if (oldQuery && !search && state.kind !== 'save') {
      setValue(current => current === oldQuery ? '' : current);
      setShowResult(false);
    }
    previousSearch.current = search;
  }, [search, state.kind]);

  function submit() {
    const composer = form.current;
    if (!composer || !value.trim() || pending || inFlight.current) return;
    if (!composer.reportValidity()) return;
    submitted.current = value;
    discardSearch.current = false;
    setShowResult(true);
    inFlight.current = true;
    const data = new FormData(composer);
    startTransition(() => action(data));
  }

  function clear() {
    discardSearch.current = true;
    setValue('');
    setShowResult(false);
    clearSearch();
    setExpanded(true);
    input.current?.focus();
  }

  const saved = showResult && !pending && state.kind === 'save' && state.ok;
  const found = showResult && !pending && state.kind === 'search' && state.ok;
  const matches=state.bookmarks?.length ?? 0;
  const message = pending ? (workspaceIntent(submitted.current).kind === 'save' ? '正在收藏…' : '正在寻找相关芝士…')
    : error || (saved ? (state.duplicate ? '已在芝士库，已为你定位' : '已收藏，看看亮起的芝士') : found ? (matches ? `${state.searchMode==='semantic'?'语义匹配':'找到'} ${matches} 条相关芝士` : '暂未找到相关芝士，试试其他关键词') : '');
  const feedbackState = pending ? 'pending' : error ? 'error' : saved ? 'saved' : found ? 'matched' : 'idle';

  return <form ref={form} className="capture-form unified-input" data-state={feedbackState}
    data-expanded={expanded} aria-busy={pending} aria-label="收藏或搜索芝士库"
    onPointerEnter={event => {
      if (event.pointerType === 'mouse') { setHovered(true); setExpanded(true); }
    }} onPointerLeave={() => setHovered(false)}
    onFocus={() => { setFocused(true); setExpanded(true); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
    onSubmit={event => { event.preventDefault(); submit(); }}>
    <div className="capture-field">
      <span className="capture-link-icon">{pending?<AiSignal state="thinking" size={22}/>:value?<Icon name={intent === 'save' ? 'link' : 'search'} size={19}/>:<AiSignal size={22}/>}</span>
      <input ref={input} id="capture-url" name="url" aria-label="粘贴链接收藏，或输入文字搜索芝士库"
        aria-invalid={Boolean(error)} aria-describedby="capture-feedback"
        autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false}
        enterKeyHint={intent === 'save' ? 'done' : 'search'} placeholder={expanded ? '存个链接，或搜搜你的芝士…' : '收藏或搜索芝士…'}
        required maxLength={8000} value={value}
        onChange={event => { setValue(event.target.value); setShowResult(false); }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
          if (event.key === 'Escape') {
            if (value || search) clear();
            else { input.current?.blur(); setExpanded(false); }
          }
        }}/>
      {(value || search) && <button type="button" className="composer-clear icon-button" aria-label="清空输入与搜索" onClick={clear}><Icon name="close" size={17}/></button>}
      <button className="primary add-button" type="button" onClick={submit}
        aria-label={intent === 'save' ? '收藏链接' : '搜索芝士库'}
        title={intent === 'save' ? '收藏链接' : '搜索芝士库'} disabled={pending || !value.trim()}>
        <span className="action-glyph" key={pending ? 'pending' : saved && !value ? 'saved' : intent}>
          {pending ? <span className="capture-progress" aria-hidden="true"/> :
            <Icon name={saved && !value ? 'check' : intent === 'save' ? 'plus' : 'search'} size={20}/>}
        </span>
      </button>
      <button type="button" className="composer-fold icon-button" aria-label="收起输入框"
        onClick={() => { input.current?.blur(); setFocused(false); setHovered(false); setExpanded(false); }}>
        <Icon name="chevron" size={16}/>
      </button>
    </div>
    <div className="capture-feedback" data-visible={Boolean(message)} data-leaving={feedbackLeaving}>
      <span id="capture-feedback" role="status" className={message?'capture-status':undefined}>{message && <AiSignal size={18} state={pending?'thinking':error?'error':saved?'done':'connected'}/>}<span>{message}</span></span>
    </div>
  </form>;
}
