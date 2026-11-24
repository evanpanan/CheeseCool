const pending=new Set();
chrome.action.onClicked.addListener(async tab=>{
 if(!tab.id||!/^https?:\/\//.test(tab.url||'')||new URL(tab.url).hostname==='cheese-cool.vercel.app')return;
 pending.add(tab.id);
 try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:['capture.js']});}catch{pending.delete(tab.id);chrome.action.setBadgeText({tabId:tab.id,text:'!'});}
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type==='cheesecool:captured'&&sender.tab?.id&&pending.has(sender.tab.id)){
  pending.delete(sender.tab.id);const id=crypto.randomUUID();
  chrome.storage.session.set({[id]:{...message.payload,created_at:Date.now()}}).then(()=>chrome.tabs.create({url:'https://cheese-cool.vercel.app/capture/import?handoff='+id}));return;
 }
 if(message?.type==='cheesecool:handoff'&&sender.tab?.url?.startsWith('https://cheese-cool.vercel.app/capture/import')&&/^[a-f0-9-]{36}$/.test(message.id)){
  chrome.storage.session.get(message.id).then(value=>{const data=value[message.id];reply(data&&Date.now()-data.created_at<1800000?data:null);});return true;
 }
});
