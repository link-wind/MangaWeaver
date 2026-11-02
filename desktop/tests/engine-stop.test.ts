import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Engine} from '../electron/engine';

test('live read_run cannot unregister the task; stopping really exits and preserves its checkpoint',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'manga-stop-'));
  let ready!:()=>void;
  const started=new Promise<void>(resolve=>ready=resolve);
  const engine=new Engine(()=>({root:resolve('..'),python:resolve('../.venv/bin/python'),ffmpeg:'/opt/homebrew/bin',env_file:join(directory,'absent.env')}),event=>{
    if(event.stage==='magi.load')ready();
  });
  await engine.run('create_simulation',{run_dir:directory});
  const outcome=engine.run('simulate',{run_dir:directory}).then(()=>'',error=>(error as Error).message);
  try{
    await started;
    await engine.run('read_run',{run_dir:directory});
    assert.equal(engine.active.size,1,'read-only refresh must not remove the active mutation');
    const before=Date.now();
    await engine.stop();
    assert.ok(Date.now()-before<8000);
    assert.match(await outcome,/本地执行已停止/);
    assert.equal(engine.active.size,0);
    const checkpoint=await readFile(join(directory,'simulation.json'),'utf8');
    assert.equal(JSON.parse(checkpoint).completed,false);
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(await readFile(join(directory,'simulation.json'),'utf8'),checkpoint);
    const events=(await readFile(join(directory,'runtime_events.jsonl'),'utf8')).trim().split('\n').map(x=>JSON.parse(x));
    assert.equal(events.at(-1).data.status,'interrupted');
  }finally{await engine.stop();}
});
