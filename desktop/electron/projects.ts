import {readFile,writeFile,mkdir,realpath,stat} from 'node:fs/promises';
import {join,dirname,basename,resolve} from 'node:path';
import {existsSync} from 'node:fs';
import type {Project} from '../src/lib/types';

export async function projectForRun(path:string):Promise<Project>{
  const directory=await realpath(path);
  if(!(await stat(directory)).isDirectory())throw new Error('运行目录不存在');
  // 只采用明确索引了这条运行的所属项目，不根据同名文件猜测归属。
  for(let folder=directory;folder!==dirname(folder);folder=dirname(folder)){
    const manifest=join(folder,'project.json');
    if(!existsSync(manifest))continue;
    const data=JSON.parse(await readFile(manifest,'utf8'));
    if(data.version!==1||!Array.isArray(data.runs)||!Array.isArray(data.sources))throw new Error('项目格式无效');
    if(data.runs.some((ref:unknown)=>typeof ref==='string'&&resolve(folder,ref)===directory))
      return {...data,path:folder,pages:data.pages||[]};
    if(folder===directory)throw new Error('该项目没有索引当前运行');
  }
  // 旧运行原地接入：只补项目索引，产物、路径、签名和远端任务均保持原样。
  for(const name of ['tasks.json','session.json']){
    const file=join(directory,name);
    if(!existsSync(file))continue;
    const value=JSON.parse(await readFile(file,'utf8'));
    if(!Array.isArray(value[name==='tasks.json'?'tasks':'messages']))throw new Error(`旧记录的 ${name} 与项目记录冲突，未覆盖原文件`);
  }
  const data={version:1 as const,name:basename(directory),runs:['.'],sources:[],pages:[]};
  await mkdir(join(directory,'runs'),{recursive:true});
  await mkdir(join(directory,'sources'),{recursive:true});
  await writeFile(join(directory,'project.json'),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
  return {...data,path:directory};
}
