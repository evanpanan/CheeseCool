/** Completeness describes the collected scope, never permission to infer missing material. */
export function captureIsPartial(level:unknown,truncated:unknown=false){
 return truncated===true||typeof level==='string'&&/(?:partial|truncated|metadata|blocked|limited)/i.test(level);
}
