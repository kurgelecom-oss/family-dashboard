// Ship the canonical TypeScript as browser ES modules. No financial formulas here.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const source=new URL('../app/lib/ecom/',import.meta.url);
const output=new URL('../public/offer-math/',import.meta.url);
await mkdir(output,{recursive:true});
for(const name of ['shopify-fees','tiers','bundles']){
  const sourceFile=new URL(name+'.ts',source);
  const result=ts.transpileModule(await readFile(sourceFile,'utf8'),{
    fileName:fileURLToPath(sourceFile),reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2020,removeComments:true},
  });
  const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  if(errors.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(errors,{
    getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:f=>f,getNewLine:()=> '\n',
  }));
  const code=result.outputText.replace(/(from\s+['"]\.\/[^'"]+)\.ts(['"])/g,'$1.mjs$2');
  await writeFile(new URL(name+'.mjs',output),`// Generated from app/lib/ecom/${name}.ts by scripts/build-offer-model.mjs. Do not edit.\n${code}`);
}
console.log('Offer Engine: generated browser modules from canonical maths.');
