'use client';

import { useActionState, useEffect, useState } from 'react';
import { Icon } from '../icons';
import { AiSignal } from '../ai-signal';
import { saveAiSettings } from './actions';
import './settings.css';

type Option = { id: string; name: string; model: string; saved: boolean; deploymentKey: boolean };

export function SettingsForm({ options, initialProvider, initialModel, canEncrypt }: {
  options: Option[]; initialProvider: string; initialModel: string; canEncrypt: boolean;
}) {
  const [state, action, pending] = useActionState(saveAiSettings, {});
  const [provider, setProvider] = useState(initialProvider);
  const [edited, setEdited] = useState(false);
  const [models, setModels] = useState<Record<string, string>>({ [initialProvider]: initialModel });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [removals, setRemovals] = useState<Record<string, boolean>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const selected = options.find(option => option.id === provider);
  const chatConfigured=Boolean(selected?.saved || selected?.deploymentKey);
  const vectorConfigured=options.some(option=>option.id==='openai' && (option.saved || option.deploymentKey));

  useEffect(() => {
    if (state.message && !state.error) {
      setKeys({});
      setVisibleKeys({});
      setRemovals({});
      setEdited(false);
    }
  }, [state]);

  return <form className="settings-form admin-settings" action={action} aria-busy={pending}
    onChange={() => setEdited(true)} onReset={event => {
      // Action forms reset after completion even when the server returns an error.
      event.preventDefault();
    }}>
    <div className="admin-capabilities" aria-label="智能能力配置状态">
      {[
        {name:'内容整理',configured:chatConfigured,detail:chatConfigured?selected?.name+' 已配置':'等待配置'},
        {name:'语义搜索',configured:vectorConfigured,detail:vectorConfigured?'向量服务已配置':'使用关键词搜索'},
        {name:'知识关联',configured:vectorConfigured,detail:vectorConfigured?'语义与标签关联':'使用标签关联'},
      ].map(capability=><div key={capability.name} className="admin-capability" data-configured={capability.configured}>
        <AiSignal size={27} state={capability.configured?'connected':'idle'}/><div><strong>{capability.name}</strong><span>{capability.detail}</span></div>
      </div>)}
    </div>
    <fieldset disabled={pending}>
      <section className="admin-section" aria-labelledby="service-heading">
        <div className="admin-section-intro">
          <h2 id="service-heading">智能服务</h2>
          <p>选择整理收藏的服务和模型。</p>
        </div>
        <div className="admin-card">
          <div className="admin-service-fields">
            <div className="admin-field">
              <label htmlFor="ai-provider">服务商</label>
              <div className="admin-select">
                <select id="ai-provider" name="provider" value={provider} onChange={event => setProvider(event.target.value)}>
                  {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
                <Icon name="chevron" size={16}/>
              </div>
            </div>
            <div className="admin-field">
              <label htmlFor="chat-model">模型名称 <span>可选</span></label>
              <input id="chat-model" name="model" maxLength={100} aria-describedby="model-help"
                value={models[provider] ?? ''}
                onChange={event => {
                  const value = event.target.value;
                  setModels(current => ({ ...current, [provider]: value }));
                }}
                placeholder={selected?.model}/>
            </div>
          </div>
          <p id="model-help" className="admin-field-help">模型名称留空时使用 {selected?.model}。</p>
        </div>
      </section>

      <section className="admin-section" aria-labelledby="keys-heading">
        <div className="admin-section-intro">
          <h2 id="keys-heading">服务密钥</h2>
          <p>由站点统一配置，供用户直接使用。</p>
          <p className="admin-private-note"><Icon name="lock" size={14}/>仅在服务端使用</p>
        </div>
        <div className="admin-card admin-keys-card">
          <p className="admin-key-help">OpenAI 同时提供语义搜索与关联所需的向量服务。</p>
          {!canEncrypt && <p className="admin-config-notice">
            录入密钥前，请在部署环境设置 <code>AI_SETTINGS_ENCRYPTION_KEY</code>，或直接使用环境变量配置密钥。
          </p>}
          {options.map(option => {
            const configured = option.saved || option.deploymentKey;
            const shown = Boolean(visibleKeys[option.id]);
            return <div key={option.id} className="admin-key-row">
              <div className="admin-key-info">
                <label htmlFor={option.id + '-key'}>{option.name}</label>
                <span className="admin-key-status" data-configured={configured}>
                  <i aria-hidden="true"/>{option.saved ? '站点已保存' : option.deploymentKey ? '使用环境密钥' : '未配置'}
                </span>
              </div>
              <div className="admin-key-control">
                <div className="admin-secret-field">
                  <input id={option.id + '-key'} name={option.id + '_key'} type={shown ? 'text' : 'password'}
                    aria-label={option.name + ' 服务密钥'} autoComplete="new-password" spellCheck={false}
                    autoCapitalize="off" disabled={!canEncrypt}
                    value={keys[option.id] ?? ''}
                    onChange={event => {
                      const value = event.target.value;
                      setKeys(current => ({ ...current, [option.id]: value }));
                    }}
                    maxLength={512} placeholder={option.saved ? '留空保留现有密钥' : '输入服务密钥'}/>
                  <button type="button" className="admin-key-visibility" disabled={!canEncrypt}
                    aria-label={(shown ? '隐藏' : '显示') + option.name + ' 密钥'} aria-pressed={shown}
                    onClick={() => setVisibleKeys(current => ({ ...current, [option.id]: !shown }))}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/>
                      <circle cx="12" cy="12" r="3"/>
                      {!shown && <path d="m4 3 16 18"/>}
                    </svg>
                  </button>
                </div>
                {option.saved && <label className="settings-remove admin-remove">
                  <input type="checkbox" name={option.id + '_remove'} checked={Boolean(removals[option.id])}
                    onChange={event => {
                      const checked = event.target.checked;
                      setRemovals(current => ({ ...current, [option.id]: checked }));
                    }}/>移除已保存的密钥
                </label>}
              </div>
            </div>;
          })}
        </div>
      </section>
    </fieldset>

    <div className="settings-save-row admin-save-row">
      <div className="admin-save-feedback" aria-live="polite">
        {pending && <span className="admin-saving"><AiSignal state="thinking" size={18}/>正在保存站点配置…</span>}
        {edited && <span className="unsaved-note">有未保存的修改</span>}
        {state.message && (!edited || state.error) && <p className={state.error ? 'error' : 'admin-save-success'}
          role={state.error ? 'alert' : 'status'}>{state.message}</p>}
      </div>
      <button className="primary admin-submit" disabled={pending}
        data-phase={pending ? 'pending' : state.message && !state.error && !edited ? 'done' : 'idle'}
        aria-label={pending ? '正在保存配置' : '保存配置'}>
        <span className="admin-submit-label">保存配置</span>
        <span className="admin-submit-spinner" aria-hidden="true"><span className="capture-progress"/></span>
        <span className="admin-submit-check" aria-hidden="true"><Icon name="check" size={16}/></span>
      </button>
    </div>
  </form>;
}
