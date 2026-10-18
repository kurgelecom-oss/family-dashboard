// Sunday 07–10 UTC covers 6 pm and 8 pm Melbourne in both AEST and AEDT; the route decides what is due.
export const config={schedule:'0 7-10 * * 0'};
export default async function familyWeeklyEmail():Promise<Response>{
 const secret=process.env.FAMILY_CRON_SECRET;
 if(!secret)return new Response('FAMILY_CRON_SECRET is not set',{status:503});
 const site=(process.env.FAMILY_SITE_URL||process.env.URL||'https://kurgel-dashboard.netlify.app').replace(/\/$/,'');
 const r=await fetch(`${site}/api/weekly-email`,{method:'POST',headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(28000)});
 console.log('weekly email',r.status,await r.text());
 return new Response(null,{status:r.ok?204:502});
}
