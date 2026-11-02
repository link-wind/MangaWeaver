import {spawn} from 'node:child_process'
import {build} from 'esbuild'
import {createServer} from 'vite'
await build({entryPoints:['electron/main.ts','electron/preload.ts'],outdir:'dist-electron',bundle:true,platform:'node',external:['electron']})
const server=await createServer(); await server.listen()
const child=spawn('node_modules/.bin/electron',['.'],{stdio:'inherit',env:{...process.env,VITE_DEV_SERVER_URL:'http://127.0.0.1:5173'}})
child.on('exit',async(code)=>{await server.close(); process.exit(code??0)})
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal))
