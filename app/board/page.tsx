import type { Metadata } from 'next';
import CalendarApp from './CalendarApp';

/* /board is the family calendar (tk, 1 Nov 2026): an Apple Calendar-style
   Day / Week / Month / Year view with the home board's key numbers across the
   top, tap editing and pen ink for the Samsung Flip. Spec: BOARD-SPEC.md. */
export const metadata: Metadata = { title: 'Family Calendar' };

export default function Board() { return <CalendarApp />; }
