import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmod,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Engine} from '../electron/engine';

test('completed result wins a stop race and protocol failure terminates the process group',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'manga-engine-integrity-'));
  const python=join(dir,'offline-engine');
  await writeFile(python,`#!${resolve('../.venv/bin/python')}
import json,sys,time,subprocess,signal
r=json.loads(sys.stdin.readline())
if r['mode']=='completed':
 print(json.dumps(dict(version=1,type='completed',request_id=r['request_id'],data={'saved':True})),flush=True)
 time.sleep(60)
else:
 child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])
 with open(r['pid_file'],'w') as f:f.write(str(child.pid))
 def stopped(*args):
  child.wait(timeout=3)
  sys.exit(0)
 signal.signal(signal.SIGTERM,stopped)
 print('invalid-json',flush=True)
 time.sleep(60)
`);
  await chmod(python,0o755);
  let stopping:Promise<void>|undefined;
  const engine=new Engine(()=>({root:resolve('..'),python,ffmpeg:'/usr/bin',env_file:join(dir,'absent.env')}),event=>{
    if(event.type==='completed')stopping=engine.stop();
  });
  try{
    assert.deepEqual(await engine.run('plan',{run_dir:dir,mode:'completed'}),{saved:true});
    await stopping;
    const pidFile=join(dir,'child.pid');
    await assert.rejects(engine.run('plan',{run_dir:dir,mode:'bad',pid_file:pidFile}),/JSON|Unexpected|token/i);
    const pid=Number(await readFile(pidFile,'utf8'));
    assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
    assert.equal(engine.active.size,0);
  }finally{await engine.stop();await rm(dir,{recursive:true,force:true});}
});
