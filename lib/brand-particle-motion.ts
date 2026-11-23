const smooth=(value:number)=>value*value*(3-2*value);
/** A seamless scatter -> logo -> hold -> scatter cycle, in milliseconds. */
export function brandParticleSpread(milliseconds:number) {
  const time=((milliseconds%4000)+4000)%4000;
  if(time<1100)return 1-smooth(time/1100);
  if(time<1900)return 0;
  if(time<3100)return smooth((time-1900)/1200);
  return 1;
}
