import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {projectForRun} from '../electron/projects';

test('本地记录打开所属项目，旧记录原地接入且不改变产物',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'manga-project-')));
  const owned=join(root,'runs','page001');await mkdir(owned,{recursive:true});
  await writeFile(join(root,'project.json'),JSON.stringify({version:1,name:'已有项目',runs:['runs/page001'],sources:[]}));
  assert.equal((await projectForRun(owned)).path,root);
  const legacy=join(root,'legacy');await mkdir(legacy);
  await writeFile(join(legacy,'final.mp4'),'original-video');
  const opened=await projectForRun(legacy);
  assert.equal(opened.path,legacy);assert.deepEqual(opened.runs,['.']);
  assert.equal(await readFile(join(legacy,'final.mp4'),'utf8'),'original-video');
  assert.equal((await projectForRun(legacy)).path,legacy);
});
