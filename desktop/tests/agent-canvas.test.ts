import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCanvasCommand} from '../src/lib/canvasCommands';
import type {CanvasNode} from '../src/lib/canvas';
test('canvas receipt rejects stale run, missing identity and invalid position',()=>{
  const node = {id:'source'} as CanvasNode;
  const command = {kind:'canvas' as const,call_id:'call', revision:1,run:'run',operation:'focus' as const,node_ids:['source'],dx:0,dy:0};
  assert.doesNotThrow(()=>validateCanvasCommand(command,'run',[node]));
  assert.throws(()=>validateCanvasCommand(command,'other',[node]));
  assert.throws(()=>validateCanvasCommand({...command,node_ids:['missing']},'run',[node]));
  assert.throws(()=>validateCanvasCommand({...command,dx:NaN},'run',[node]));
});
