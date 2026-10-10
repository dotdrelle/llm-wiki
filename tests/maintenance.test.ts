import * as outputGuard from '../src/maintenance/outputGuard.ts';
import { OUTPUT_HASH_VERSION, knowledgeUnchanged, outputEditedSinceBuild } from '../src/maintenance/buildInputs.ts';
import { normalizeGeneratedMarkdown } from '../src/utils/markdown.ts';
import { mkdtemp,mkdir,writeFile,readFile,readdir,rm,utimes,symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach,expect,it,vi } from 'vitest';
import { resolveConfig } from '../src/config/schema.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';
import { publishOutput } from '../src/maintenance/outputGuard.ts';
import { pendingSources,validateMaintenanceSources,maintenanceState,vectorInputHash } from '../src/maintenance/state.ts';
import { preparePublication,finishPublication,publicationState,transformSignature } from '../src/maintenance/publications.ts';
import { hashText } from '../src/utils/hash.ts';
const roots:string[]=[];
async function root(){const r=await mkdtemp(path.join(os.tmpdir(),'maintenance-engine-'));roots.push(r);await mkdir(path.join(r,'wiki'),{recursive:true});await mkdir(path.join(r,'raw/untracked'),{recursive:true});return r;}
afterEach(async()=>{await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true})));});
it('navigation and logs do not invalidate build knowledge; real knowledge does',async()=>{const r=await root();const w=new WorkspaceService(resolveConfig({},r));await writeFile(path.join(r,'wiki/facts.md'),'one');const h=await w.computeWikiHash();await writeFile(path.join(r,'wiki/index.md'),'navigation');await writeFile(path.join(r,'wiki/log.md'),'run');expect(await w.computeWikiHash()).toBe(h);await writeFile(path.join(r,'wiki/facts.md'),'two');expect(await w.computeWikiHash()).not.toBe(h);});
it('an edit during generation refuses overwrite without losing current bytes',async()=>{const r=await root();const f=path.join(r,'deliverables/a.md');await mkdir(path.dirname(f));await writeFile(f,'manual edit');await expect(publishOutput(r,f,'old',()=>writeFile(f,'generated'))).rejects.toThrow('output_changed');expect(await readFile(f,'utf8')).toBe('manual edit');});
it('every overwritten output has a verified backup independent of git',async()=>{const r=await root();const f=path.join(r,'deliverables/a.md');await mkdir(path.dirname(f));await writeFile(f,'old');await publishOutput(r,f,'old',()=>writeFile(f,'new'));const dirs=await readdir(path.join(r,'.wiki/output-backups'));const files=await readdir(path.join(r,'.wiki/output-backups',dirs[0]));expect(await readFile(path.join(r,'.wiki/output-backups',dirs[0],files[0]),'utf8')).toBe('old');});
it('two writers with the same snapshot cannot both publish',async()=>{const r=await root();const f=path.join(r,'a.md');await writeFile(f,'old');const results=await Promise.allSettled(['first','second'].map(text=>publishOutput(r,f,'old',()=>writeFile(f,text))));expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);});
it('output symlinks and workspace escapes are refused',async()=>{const r=await root();const outside=await root();await writeFile(path.join(outside,'a.md'),'safe');await symlink(path.join(outside,'a.md'),path.join(r,'a.md'));await expect(publishOutput(r,path.join(r,'a.md'),'safe',()=>Promise.resolve())).rejects.toThrow('symlink');await expect(publishOutput(r,path.join(r,'../escape'),'x',()=>Promise.resolve())).rejects.toThrow('escapes');});
it('pending sources exclude recent uploads, local edits and corrupt sync markers',async()=>{const r=await root();await writeFile(path.join(r,'raw/untracked/a.md'),'a');expect((await pendingSources(r,60_000))[0].stable).toBe(false);await utimes(path.join(r,'raw/untracked/a.md'),0,0);await mkdir(path.join(r,'.wiki'));await writeFile(path.join(r,'.wiki/cme-sync.json'),JSON.stringify({modifiedLocally:['a.md']}));expect((await pendingSources(r,0))[0].protected).toBe(true);await writeFile(path.join(r,'.wiki/cme-sync.json'),'broken');expect((await pendingSources(r,0))[0].reason).toBe('sync_marker_invalid');});
it('approval covers exact source hash and cannot override local protection',async()=>{const r=await root();await writeFile(path.join(r,'raw/untracked/a.md'),'a');const selection=[{path:'raw/untracked/a.md',hash:hashText('a')}];await validateMaintenanceSources(r,selection,0);await writeFile(path.join(r,'raw/untracked/a.md'),'b');await expect(validateMaintenanceSources(r,selection,0)).rejects.toThrow('changed_or_protected');});
it('publication intent recovers after output write and detects later source/output edits',async()=>{const r=await root();await writeFile(path.join(r,'source.md'),'source');const record=await preparePublication(r,{source:'source.md',sourceHash:hashText('source'),operation:'export',parameters:{signature:'v1'},output:'export.md',outputHash:hashText('expanded')});expect((await publicationState(r))[0].fresh).toBe(false);await writeFile(path.join(r,'export.md'),'expanded');expect((await publicationState(r))[0].recovered).toBe(true);await finishPublication(r,record);expect((await publicationState(r))[0].fresh).toBe(true);await writeFile(path.join(r,'source.md'),'modified');expect((await publicationState(r))[0].fresh).toBe(false);await writeFile(path.join(r,'export.md'),'edited');await expect(finishPublication(r,record)).rejects.toThrow('readback');});
it('freshness state works for an empty workspace without an LLM',async()=>{const r=await root();const config=resolveConfig({retrieval:{vector:{enabled:false}}},r);const state=await maintenanceState(config,0);expect(state.pending).toEqual([]);expect(state.deliverables).toEqual([]);expect(state.index.fresh).toBe(true);});
it('a hand edit is reported only against a hash of the normalized bytes, never against a legacy record',()=>{const written=normalizeGeneratedMarkdown('# T\n\n\n\nbody');expect(outputEditedSinceBuild({outputHash:hashText(written),outputHashVersion:OUTPUT_HASH_VERSION},written)).toBe(false);expect(outputEditedSinceBuild({outputHash:hashText(written),outputHashVersion:OUTPUT_HASH_VERSION},written+'edit')).toBe(true);expect(outputEditedSinceBuild({outputHash:hashText('# T\n\n\n\nbody')},written+'edit')).toBe(false);});
it('an engine upgrade does not stale a deliverable whose wiki is unchanged',async()=>{const r=await root();const w=new WorkspaceService(resolveConfig({},r));await writeFile(path.join(r,'wiki/facts.md'),'one');await writeFile(path.join(r,'wiki/index.md'),'nav');const recorded=await w.computeLegacyWikiHash();expect(knowledgeUnchanged(recorded,await w.computeWikiHash(),await w.computeLegacyWikiHash())).toBe(true);await writeFile(path.join(r,'wiki/facts.md'),'two');expect(knowledgeUnchanged(recorded,await w.computeWikiHash(),await w.computeLegacyWikiHash())).toBe(false);});
it('an export made with other settings is stale; an older receipt without settings is not',async()=>{const r=await root();await writeFile(path.join(r,'source.md'),'source');await writeFile(path.join(r,'a.export.md'),'out');await writeFile(path.join(r,'b.export.md'),'out');const common={source:'source.md',sourceHash:hashText('source'),operation:'export' as const,outputHash:hashText('out')};await finishPublication(r,await preparePublication(r,{...common,output:'a.export.md',parameters:{transform:transformSignature('export','fr')}}));await finishPublication(r,await preparePublication(r,{...common,output:'b.export.md',parameters:{signature:'export-v1'}}));const fr=await publicationState(r,{language:'fr'});expect(fr.every(p=>p.fresh)).toBe(true);const en=await publicationState(r,{language:'en'});expect(en.find(p=>p.output==='a.export.md')).toMatchObject({fresh:false,reason:'settings_changed'});expect(en.find(p=>p.output==='b.export.md')?.fresh).toBe(true);});

it('physical state exposes the current export and polish signatures before a publication exists',async()=>{
  const r=await root();const config=resolveConfig({language:'fr',retrieval:{vector:{enabled:false}}},r);
  const fr=await maintenanceState(config,0);
  expect(fr.publicationTransforms).toEqual({export:transformSignature('export','fr'),polish:transformSignature('polish','fr')});
  const en=await maintenanceState({...config,language:'en'},0);
  expect(en.publicationTransforms.export).not.toBe(fr.publicationTransforms.export);
  expect(en.publicationTransforms.polish).not.toBe(fr.publicationTransforms.polish);
});


it('only authoritative publication receipts inspect bytes and shared sources are read once', async () => {
  const r=await root();await writeFile(path.join(r,'source.md'),'source');await writeFile(path.join(r,'out.md'),'current');await writeFile(path.join(r,'other.md'),'current');
  for(let i=0;i<8;i++) {
    const record=await preparePublication(r,{source:'source.md',sourceHash:hashText('source'),operation:'export',parameters:{revision:i},output:'out.md',outputHash:hashText(i===7?'current':'old')});
    await writeFile(path.join(r,'.wiki/publications',record.id+'.json'),JSON.stringify({...record,createdAt:'2026-10-05T00:00:0'+i+'Z'}));
  }
  const other=await preparePublication(r,{source:'source.md',sourceHash:hashText('source'),operation:'export',parameters:{},output:'other.md',outputHash:hashText('current')});
  const spy=vi.spyOn(outputGuard,'outputSnapshot');
  try {
    const state=await publicationState(r);
    expect(state).toHaveLength(2);expect(state.every(p=>p.fresh&&p.recovered)).toBe(true);
    expect(state.find(p=>p.output==='out.md')?.parameters.revision).toBe(7);
    expect(state.find(p=>p.output==='other.md')?.id).toBe(other.id);
    expect(spy).toHaveBeenCalledTimes(3);
  } finally {spy.mockRestore();}
});

it('vector freshness reuses supplied wiki pages without changing its hash', async () => {
  const r=await root();const w=new WorkspaceService(resolveConfig({},r));await writeFile(path.join(r,'wiki/facts.md'),'fact');
  const pages=await w.listWikiPages();const expected=await vectorInputHash(w);
  const spy=vi.spyOn(w,'listWikiPages');
  try {expect(await vectorInputHash(w,pages)).toBe(expected);expect(spy).not.toHaveBeenCalled();} finally {spy.mockRestore();}
});

it('a metadata line doctor adds to a built deliverable is not a hand edit, a real edit still is',async()=>{
  // juno: doctor --apply added `status: draft` to four freshly built
  // deliverables; maintenance then read them as hand-edited and asked a human
  // to approve each rebuild, cycle after cycle.
  const { applyOkfV02Migration } = await import('../src/okf/scan.ts');
  const r=await root();await mkdir(path.join(r,'deliverables'),{recursive:true});
  const w=new WorkspaceService(resolveConfig({},r));
  const built='---\ntype: deliverable\n---\n# Report\n\nBody.\n';
  const edited='---\ntype: deliverable\n---\n# Report\n\nBody, edited by hand.\n';
  await writeFile(path.join(r,'deliverables/a.md'),built);
  await writeFile(path.join(r,'deliverables/b.md'),edited);
  await w.writeBuildState({deliverables:{
    'templates/a.md':{templateHash:'t',wikiHash:'w',buildContextHash:'c',outputHash:hashText(built),outputHashVersion:OUTPUT_HASH_VERSION,outputRelativePath:'deliverables/a.md'},
    'templates/b.md':{templateHash:'t',wikiHash:'w',buildContextHash:'c',outputHash:hashText(built),outputHashVersion:OUTPUT_HASH_VERSION,outputRelativePath:'deliverables/b.md'},
  }} as any);
  const { rewrites }=await applyOkfV02Migration(r);
  expect(rewrites.map(x=>x.file).sort()).toEqual(['deliverables/a.md','deliverables/b.md']);
  expect(await w.reanchorDeliverableHashes(rewrites)).toEqual(['deliverables/a.md']);
  const state=await w.readBuildState();
  expect(outputEditedSinceBuild(state.deliverables['templates/a.md']!,await readFile(path.join(r,'deliverables/a.md'),'utf8'))).toBe(false);
  expect(outputEditedSinceBuild(state.deliverables['templates/b.md']!,await readFile(path.join(r,'deliverables/b.md'),'utf8'))).toBe(true);
});
