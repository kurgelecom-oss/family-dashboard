export interface CycleRecord {active:boolean;startedOn:string|null;endedOn:string|null;version:number}
/** Explicit state only. Elapsed time never turns the switch off. */
export function cyclePayload(row:CycleRecord,today:string) {
 const since=row.startedOn ? Math.floor((Date.parse(today+'T12:00:00Z')-Date.parse(row.startedOn+'T12:00:00Z'))/86400000) : -1;
 return {...row,activeDay:row.active && since>=0 ? since+1:null,totalDays:null,expectedInDays:null};
}
export function parseCycleChange(body:unknown) {
 if (!body || typeof body!=='object') throw new Error('Choose on or off');
 const b=body as Record<string,unknown>;
 if (typeof b.active!=='boolean' || !Number.isInteger(b.version) || Number(b.version)<1) throw new Error('Reload the switch and try again');
 return {active:b.active,version:b.version as number};
}
