import {createHmac,timingSafeEqual} from 'node:crypto';
import {cookies} from 'next/headers';
export const EDIT_COOKIE='family_edit_session';
const TTL=365*86400;
function same(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function validFamilyPin(pin:unknown){const want=process.env.FAMILY_EDIT_PIN;return typeof pin==='string'&&!!want&&same(pin,want);}
export function editSession(){const secret=process.env.FAMILY_SESSION_SECRET;if(!secret)throw new Error('Edit sessions unavailable');const expiry=String(Math.floor(Date.now()/1000)+TTL);return `${expiry}.${createHmac('sha256',secret).update(expiry).digest('hex')}`;}
export async function canEditFamily(request:Request){
 const apiKey=request.headers.get('x-family-edit-key');if(apiKey&&process.env.FAMILY_EDIT_KEY&&same(apiKey,process.env.FAMILY_EDIT_KEY))return true;
 const secret=process.env.FAMILY_SESSION_SECRET;if(!secret)return false;
 const token=(await cookies()).get(EDIT_COOKIE)?.value;if(!token)return false;
 const [expiry,sig,extra]=token.split('.');if(extra||!/^\d+$/.test(expiry)||Number(expiry)<=Date.now()/1000||!sig)return false;
 return same(sig,createHmac('sha256',secret).update(expiry).digest('hex'));
}
