import type { Metadata } from 'next';
import PresentWheel from './PresentWheel';

/* /present — each week Taylan, Nihal and Ansar each spin for one presentation
   topic and spend the week building it (tk, 2 Nov 2026). */
export const metadata: Metadata = { title: 'Present · Family OS' };

export default function Present() { return <PresentWheel />; }
