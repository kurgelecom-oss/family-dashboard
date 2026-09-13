import {redirect} from 'next/navigation';
import SundayShell from '../components/sunday/SundayShell';
export const dynamic='force-dynamic';
export default function SundayPreview(){if((process.env.FAMILY_WORKSPACE||'production')==='production')redirect('/sunday');return <SundayShell preview/>;}
