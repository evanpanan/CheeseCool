'use client';

import { useActionState, useState } from 'react';
import { saveAiSettings } from './actions';

type Option = { id: string; name: string; model: string; saved: boolean; deploymentKey: boolean };

export function SettingsForm({ options, initialProvider, initialModel, canEncrypt }: {
  options: Option[]; initialProvider: string; initialModel: string; canEncrypt: boolean;
}) {
  const [state, action, pending] = useActionState(saveAiSettings, {});
  const [provider, setProvider] = useState(initialProvider);
  return <form className="settings-form" action={action}>
    <label htmlFor="ai-provider">摘要和标签服务商</label>
    <select id="ai-provider" name="provider" value={provider} onChange={event => setProvider(event.target.value)}>
      {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
    <label htmlFor="chat-model">模型名称 <span>留空使用默认模型</span></label>
    <input key={provider} id="chat-model" name="model" maxLength={100}
      defaultValue={provider === initialProvider ? initialModel : ''} placeholder={options.find(option => option.id === provider)?.model}/>
    <h2>服务密钥</h2>
    <p>摘要和标签由所选服务商生成。语义搜索和语义连线使用 OpenAI 向量，可独立配置。密钥只在服务端使用。</p>
    {!canEncrypt && <p>在后台录入密钥前，需要在部署环境设置 <code>AI_SETTINGS_ENCRYPTION_KEY</code>。也可直接在部署环境配置各服务商的密钥。</p>}
    {options.map(option => <div key={option.id} className="settings-key">
      <label htmlFor={option.id + '-key'}>{option.name} 密钥 <span>{option.saved ? '已保存站点密钥' : option.deploymentKey ? '使用部署密钥' : '未配置'}</span></label>
      <input id={option.id + '-key'} name={option.id + '_key'} type="password" autoComplete="new-password" disabled={!canEncrypt}
        maxLength={512} placeholder={option.saved ? '留空保留现有密钥' : '输入 服务密钥'}/>
      {option.saved && <label className="settings-remove"><input type="checkbox" name={option.id + '_remove'}/> 移除站点密钥</label>}
    </div>)}
    <button className="primary" disabled={pending}>{pending ? '保存中…' : '保存站点配置'}</button>
    {state.message && <p className={state.error ? 'error' : undefined} role={state.error ? 'alert' : 'status'}>{state.message}</p>}
  </form>;
}
