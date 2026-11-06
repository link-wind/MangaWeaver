import type {CanvasState, RunData} from './types';

/** 每个运行只串行保存自己的快照；回包只推进该运行的读取基准。 */
export class CanvasSaveQueue {
  private revisions = new Map<string,string|null>();
  private tails = new Map<string,Promise<void>>();
  constructor(private write:(path:string,state:CanvasState,revision:string|null)=>Promise<{revision:string}>) {}
  read(run:RunData, replace=false) {
    if(replace||!this.revisions.has(run.directory))this.revisions.set(run.directory,run.canvas_revision??null);
    if(replace)this.tails.delete(run.directory);
  }
  save(path:string,state:CanvasState) {
    if(!this.revisions.has(path))return Promise.reject(new Error('请先读取画布快照后再保存'));
    const snapshot=structuredClone(state);
    const pending=(this.tails.get(path)||Promise.resolve()).catch(()=>{}).then(async()=>{
      const saved=await this.write(path,snapshot,this.revisions.get(path)!);
      this.revisions.set(path,saved.revision);
    });
    this.tails.set(path,pending);
    return pending;
  }
  async flush(){await Promise.all(this.tails.values());}
}
