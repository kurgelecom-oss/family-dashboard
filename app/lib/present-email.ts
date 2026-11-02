import { personById, STARTER, type Kind } from '../present/topics';

/* The Present email: same build as Ansar's homeschool weekly report (header,
   white cards with small-caps kickers, numbered rows, one dark note card), in
   its own "stage" palette (aubergine + spotlight gold) so it never reads as a
   school report. Tables + inline styles only: Gmail, Outlook and Apple Mail. */

const C = { page: '#F7F3FA', card: '#FFFFFF', line: '#E6DDEE', ink: '#24123A', muted: '#76688A', plum: '#6B3FA0', gold: '#E0A526', shock: '#FFD23F', wild: '#0D0D0D' };
const FONT = "-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const t = (size: number, color: string, extra = '') => `font-size:${size}px;color:${color};${extra}`;
const td = (bg: string, style = '', attrs = '') => `<td${attrs ? ` ${attrs}` : ''} style="${bg ? `background:${bg};` : ''}${style}">`;
const table = (inner: string, w = '100%') => `<table cellpadding="0" cellspacing="0"${w === 'auto' ? '' : ` width="${w}"`}>${inner}</table>`;
const kicker = (s: string) => `<div style="${t(11, C.muted, 'font-weight:700;letter-spacing:1px;padding-bottom:12px;')}">${esc(s.toUpperCase())}</div>`;
const card = (inner: string, bg = C.card) => `<tr>${td('', 'padding:0 16px 14px 16px;')}${table(`<tr>${td(bg, `padding:20px;border:1px solid ${C.line};border-radius:16px;`)}${inner}</td></tr>`)}</td></tr>`;
const badge = (txt: string, bg: string, fg = '#FFFFFF', size = 32) => table(`<tr>${td(bg, `width:${size}px;height:${size}px;border-radius:${size / 2}px;${t(Math.round(size * 0.45), fg, `font-weight:800;line-height:${size}px;`)}`, `align="center" width="${size}" height="${size}"`)}${txt}</td></tr>`, 'auto');
const numbered = (rows: { title: string; body: string; tag?: string }[], bg = C.ink) => table(rows.map((r, i) => `<tr>${td('', 'width:44px;vertical-align:top;padding:0 0 16px 0;', 'width="44"')}${badge(String(i + 1), bg)}</td>${td('', 'vertical-align:top;padding:0 0 16px 0;')}
  <div style="${t(15, C.ink, 'font-weight:700;line-height:1.35;')}">${esc(r.title)}</div>
  <div style="${t(14, C.muted, 'line-height:1.5;padding-top:3px;')}">${esc(r.body)}</div>${r.tag ? `<div style="${t(11, C.plum, 'font-weight:700;letter-spacing:0.5px;text-transform:uppercase;padding-top:5px;')}">${esc(r.tag)}</div>` : ''}</td></tr>`).join(''));

export type PresentMail = { subject: string; html: string; text: string };

const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-AU', { timeZone: 'UTC', ...o });

export function presentEmail(personId: string, topic: string, kind: Kind, week: string): PresentMail {
  const p = personById(personId); if (!p) throw new Error('Unknown person');
  const kid = p.id === 'ansar';
  const mon = new Date(week + 'T00:00:00Z'), due = new Date(mon.getTime() + 7 * 86_400_000);
  const range = `Spun Mon ${mon.getUTCDate()} ${fmt(mon, { month: 'short' })} · present Monday night ${due.getUTCDate()} ${fmt(due, { month: 'short', year: 'numeric' })}`;
  const slice = p.slices.find(s => s.t === topic);
  const T = kind === 'wild' ? '[the topic the family chose]' : topic;
  const others = ['taylan', 'nihal', 'ansar'].filter(x => x !== p.id).map(x => personById(x)!.name).join(' and ');

  const headline = kind === 'wild' ? 'Wild card. The family chooses your topic.' : topic;
  const pill = kind === 'wild' ? { txt: '🃏 WILD CARD', bg: C.wild, fg: C.gold } : kind === 'shock' ? { txt: '⚡ SHOCK CHALLENGE', bg: C.shock, fg: C.ink } : { txt: 'YOUR TOPIC', bg: C.plum, fg: '#FFFFFF' };
  const why = kind === 'wild' ? `${others} pick it tonight. No vetoes. Write it at the top of your notes, then follow this plan with it.`
    : kind === 'shock' ? 'Nobody here knows this yet, you included. Start from zero. Next Monday night you teach it to us.'
    : kid ? 'You have one week to become the family expert on this. Next Monday night you teach us.'
    : 'One week to go deep enough that you could teach it to a stranger. Next Monday night, you teach us.';

  const days = kid ? [
    ['Tue', 'Wonder', 'Write 10 questions you have about it. Ask Claude prompt 1.'],
    ['Wed', 'Find out', 'Read, watch one good video, and write your 3 best facts.'],
    ['Fri', 'Build', 'Make your 5 slides. One picture and a few words on each.'],
    ['Sun', 'Practise', 'Say it out loud twice. Ask Claude prompt 4 to test you.'],
    ['Mon', 'Present', 'Monday night. 5 minutes. Finish with your question.'],
  ] : [
    ['Tue', 'Map it', 'Prompt 1: get the lay of the land. Pick your angle.'],
    ['Wed', 'Go deep', 'Prompt 2: research and three facts that surprise you.'],
    ['Fri', 'Build', 'Prompt 3: outline, then make the 5 slides yourself.'],
    ['Sun', 'Rehearse', 'Prompt 4: hard questions. Run it twice, timed.'],
    ['Mon', 'Present', 'Monday night. 7 minutes, then questions, then spin again.'],
  ];

  const prompts = kid ? [
    ['Wonder (Tue)', `I'm Ansar and I'm doing a 5-minute presentation for my family about "${T}". Ask me 5 questions to find out what I already know, then tell me the 5 most amazing things kids usually don't know about it. Keep it simple and true, and tell me where each fact comes from.`],
    ['Find out (Wed)', `Explain "${T}" to me like a great teacher would, in 6 short steps. After each step, give me one question to check I understood. Do not give me the answers until I try.`],
    ['Build (Fri)', `Help me plan 5 slides about "${T}": 1 a hook question, 2 the big idea, 3 three facts, 4 why it matters to our family and our faith, 5 a question for my family. Give me ideas only. I will write the words myself.`],
    ['Practise (Sun)', `Be my family at my presentation about "${T}". Ask me 5 questions one at a time, from easy to hard. After each answer, tell me one thing I did well and one thing to fix.`],
  ] : [
    ['Map it (Tue)', `I'm preparing a 7-minute talk for my family on "${T}". Give me a map of the subject: the 5 big ideas, the 3 most common misconceptions, and 3 angles I could take. For each angle, tell me why it would land with a family of three: me, my spouse, and our son who is homeschooled. Be concise.`],
    ['Go deep (Wed)', `Research brief on "${T}". Give me: the core explanation in plain English, 5 surprising facts with the source for each (say clearly if you are unsure), one story or real example that makes it memorable, and the strongest counter-argument or open question. Flag anything that is contested.`],
    ['Build (Fri)', `Here is my angle and notes on "${T}": [paste your notes]. Turn them into a 5-slide outline. Slide 1 is a hook, 2 the big idea in one sentence, 3 three facts, 4 why it matters to our family, our faith or our work, and 5 a question for the room. Max 12 words per slide plus speaker notes. Critique my notes before you outline them.`],
    ['Rehearse (Sun)', `Play a sharp, curious audience for my talk on "${T}". Here is my script: [paste it]. Ask me the 5 hardest questions, one at a time, and wait for my answer each time. Then score me out of 10 on clarity, story and confidence, and tell me the single change that would make the biggest difference.`],
  ];

  const guide = kid ? [
    { title: 'Pictures over words', body: 'A big picture and 5 words beats a full slide of writing.' },
    { title: 'Look at us, not the screen', body: 'Hold a card with your 3 facts if you need it.' },
    { title: 'Check what Claude tells you', body: 'Ask "how do you know?", and find one fact in a book or on a real website.' },
  ] : [
    { title: 'One idea, said three ways', body: 'Say it in the hook, explain it in the middle, land it at the end.' },
    { title: 'Story beats statistics', body: 'One real example will be remembered. Ten numbers will not.' },
    { title: 'Claude drafts, you decide', body: 'Use it to research and pressure-test. The words and the opinion on the slides are yours. Verify every fact you present.' },
  ];

  const dayRow = table(`<tr>${days.map(([d, h]) => `${td('', 'width:20%;vertical-align:top;text-align:center;padding:0 2px;', 'width="20%" align="center"')}<div style="text-align:center;">${badge(h === 'Present' ? '🎤' : d.slice(0, 1), h === 'Present' ? C.gold : C.plum, h === 'Present' ? C.ink : '#FFFFFF', 44).replace('<table', '<table align="center"')}</div>
    <div style="${t(14, C.ink, 'font-weight:700;padding-top:8px;')}">${d}</div><div style="${t(12, C.muted)}">${h}</div></td>`).join('')}</tr>`);
  const dayList = numbered(days.map(([d, h, b]) => ({ title: `${d} · ${h}`, body: b })), C.plum);

  const promptRows = prompts.map(([h, q], i) => `<div style="padding:${i ? '14px' : '0'} 0 0 0;"><div style="${t(11, C.plum, 'font-weight:700;letter-spacing:0.5px;text-transform:uppercase;padding-bottom:6px;')}">Prompt ${i + 1} · ${esc(h)}</div>
    ${table(`<tr>${td(C.page, `padding:12px 14px;border-radius:10px;border-left:4px solid ${C.gold};${t(13, C.ink, "line-height:1.55;font-family:Menlo,Consolas,'Courier New',monospace;")}`)}${esc(q)}</td></tr>`)}</div>`).join('');

  const header = `<tr>${td('', 'padding:8px 20px 18px 20px;')}
    <div style="${t(11, C.muted, 'font-weight:700;letter-spacing:1.5px;text-transform:uppercase;')}">Present · wheel of presentation · due Monday ${esc(fmt(due, { day: 'numeric', month: 'short' }))}</div>
    <div style="${t(28, C.ink, 'font-weight:800;letter-spacing:-0.5px;line-height:1.2;padding-top:6px;')}">${esc(p.name)}'s presentation</div>
    <div style="${t(14, C.muted, 'padding-top:4px;')}">${esc(range)}</div></td></tr>`;

  const topicCard = card(`${kicker('The wheel landed on')}
    ${table(`<tr>${td(pill.bg, 'padding:8px 16px;border-radius:999px;', 'align="center"')}<span style="${t(15, pill.fg, 'font-weight:800;letter-spacing:1px;')}">${pill.txt}</span></td></tr>`, 'auto')}
    <div style="${t(40, C.ink, 'line-height:1;padding-top:16px;')}">${esc(slice?.e ?? '🎤')}</div>
    <div style="${t(24, C.ink, 'font-weight:800;line-height:1.25;padding-top:8px;')}">${esc(headline)}</div>
    <div style="${t(15, C.muted, 'line-height:1.5;padding-top:8px;')}">${esc(why)}</div>`);

  const note = `<tr>${td('', 'padding:0 16px 14px 16px;')}${table(`<tr>${td(C.ink, 'padding:20px;border-radius:16px;')}<div style="${t(11, C.gold, 'font-weight:700;letter-spacing:1.5px;text-transform:uppercase;')}">The rules</div>
    <div style="${t(14, '#FFFFFF', 'line-height:1.6;padding-top:8px;')}">${kid ? 'Five minutes. Five slides. Don&rsquo;t read your slides out. End with a question for us. Everyone claps, no matter what.' : 'Seven minutes, five slides, no reading the slides out. End with a question. The family scores it out of 10 for clarity, story and confidence. No phones while someone is presenting.'}</div></td></tr>`)}</td></tr>`;

  const footer = `<tr>${td('', 'padding:6px 24px 28px 24px;')}<div style="${t(11, C.muted, 'line-height:1.6;')}">Sent by the Present wheel on the Family OS · kurgel-dashboard.netlify.app/present · One spin a week, and topics never repeat.</div></td></tr>`;

  const body = [header, topicCard,
    card(`${kicker('The week, day by day')}${dayRow}<div style="padding-top:18px;border-top:1px solid ${C.line};margin-top:16px;"></div>${dayList}`),
    card(`${kicker('The five slides')}${numbered(STARTER.map(([h, d]) => ({ title: h, body: d })))}`),
    card(`${kicker('Claude prompts, copy and paste')}${promptRows}<div style="${t(12, C.muted, 'line-height:1.5;padding-top:14px;')}">Open claude.ai, paste the prompt, and fill in anything in [brackets].${kind === 'wild' ? ' Replace [the topic the family chose] with your topic.' : ''}</div>`),
    card(`${kicker('How to do it well')}${numbered(guide, C.gold)}`),
    note, footer].join('\n');

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background-color:${C.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="width:100%;background-color:${C.page};"><tr><td align="center" style="padding:20px 0;font-family:${FONT};">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;">
${body}
</table></td></tr></table></body></html>`;

  const text = [`${p.name.toUpperCase()}'S PRESENTATION · ${range}`, '', `${pill.txt}: ${headline}`, why, '', 'THE WEEK',
    ...days.map(([d, h, b]) => `- ${d} · ${h}: ${b}`), '', 'THE FIVE SLIDES', ...STARTER.map(([h, d], i) => `${i + 1}. ${h}: ${d}`), '',
    'CLAUDE PROMPTS', ...prompts.map(([h, q], i) => `${i + 1}. ${h}\n${q}\n`)].join('\n');

  const subject = kind === 'wild' ? `🃏 ${p.name}, wild card: the family picks your topic this week`
    : `${kind === 'shock' ? '⚡' : '🎤'} ${p.name}, your presentation this week: ${topic}`;
  return { subject, html, text };
}

export const PRESENT_TO: Record<string, string> = {
  taylan: 'taylan.k8@hotmail.com',
  nihal: 'nils_gvi@hotmail.com',
  ansar: 'ansar.k11@hotmail.com',
};
