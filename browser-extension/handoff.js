const id=new URL(location.href).searchParams.get('handoff');
if(id){
 const deliver=()=>chrome.runtime.sendMessage({type:'cheesecool:handoff',id},payload=>{if(payload)window.postMessage({type:'cheesecool:browser-capture',id,payload},location.origin);});
 window.addEventListener('message',event=>{if(event.source===window&&event.origin===location.origin&&event.data?.type==='cheesecool:request-capture'&&event.data.id===id)deliver();});deliver();
}
