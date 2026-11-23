import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRecord} from '../lib/knowledge-records';
test('complete dialogue keeps tool calls, role metadata and message ordering',()=>{
 const messages=[{role:'user',content:'完整问题',timestamp:'2026-11-23T01:00:00Z'},{role:'assistant',content:null,tool_calls:[{id:'call1',function:{name:'lookup',arguments:'{"query":"原文"}'}}]},{role:'tool',content:'完整工具结果',tool_call_id:'call1'},{role:'assistant',content:'完整回答'}];
 const record=prepareRecord({kind:'ai_conversation',title:'对话原件',messages});
 assert.deepEqual(JSON.parse(record.raw).messages,messages);assert(record.content.includes('tool_call_id'));assert(record.content.indexOf('完整问题')<record.content.indexOf('完整回答'));
});
test('journal requires valid date and explicit timezone',()=>{
 assert.throws(()=>prepareRecord({kind:'journal',content:'日记',date:'2026-02-31',timezone:'Asia/Shanghai'}));
 const record=prepareRecord({kind:'journal',content:'日记原稿',date:'2026-11-23',timezone:'Asia/Shanghai'});assert.equal(record.attributes.timezone,'Asia/Shanghai');assert.equal(record.attributes.date,'2026-11-23');
});
