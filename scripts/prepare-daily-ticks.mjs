import fs from 'node:fs/promises';
import postgres from 'postgres';
const workspace=process.argv.includes('--production')?'production':process.env.FAMILY_WORKSPACE;
if(!workspace||(!process.argv.includes('--production')&&workspace==='production'))throw new Error('Choose the preview workspace or pass --production explicitly.');
const db=postgres(process.env.FAMILY_DATABASE_URL,{ssl:'require',prepare:false,max:1});
try{
 await db.begin(async tx=>{await tx.unsafe(await fs.readFile(new URL('../db/003-daily-ticks.sql',import.meta.url),'utf8'));});
 console.log(JSON.stringify({ready:true,workspace}));
}finally{await db.end();}
