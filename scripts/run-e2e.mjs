import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const port=process.env.PLAYWRIGHT_PORT??String(45000+(process.pid%1000));
const output=[];
const server=spawn(process.execPath,[resolve(root,"node_modules/vinext/dist/cli.js"),"dev","--port",port],{
  cwd:root,env:{...process.env,NO_COLOR:"1"},stdio:["ignore","pipe","pipe"],
});
for(const stream of [server.stdout,server.stderr])stream.on("data",chunk=>{const text=chunk.toString();output.push(text);process.stderr.write(text);});

const sleep=ms=>new Promise(resolvePromise=>setTimeout(resolvePromise,ms));
async function waitForServer(){
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    if(server.exitCode!==null)throw new Error(`Browser QA server exited early (${server.exitCode}).\n${output.join("")}`);
    const match=output.join("").match(/Local:\s+http:\/\/localhost:(\d+)/);if(match)return `http://localhost:${match[1]}`;
    await sleep(200);
  }
  throw new Error(`Browser QA server did not become ready.\n${output.join("")}`);
}

async function stopTree(pid){
  if(!pid)return;
  if(process.platform==="win32")await new Promise(resolvePromise=>{const killer=spawn("taskkill",["/pid",String(pid),"/t","/f"],{stdio:"ignore"});killer.once("exit",resolvePromise);killer.once("error",resolvePromise);});
  else{server.kill("SIGTERM");await Promise.race([new Promise(resolvePromise=>server.once("exit",resolvePromise)),sleep(2000)]);if(server.exitCode===null)server.kill("SIGKILL");}
}

let tests=null;
const shutdown=async code=>{if(tests?.pid)tests.kill("SIGTERM");await stopTree(server.pid);process.exit(code);};
process.on("SIGINT",()=>void shutdown(130));process.on("SIGTERM",()=>void shutdown(143));

let exitCode=1;
try{
  const baseURL=await waitForServer();
  exitCode=await new Promise(resolvePromise=>{
    tests=spawn(process.execPath,[resolve(root,"node_modules/@playwright/test/cli.js"),"test",...process.argv.slice(2)],{cwd:root,env:{...process.env,PLAYWRIGHT_EXTERNAL_SERVER:"1",PLAYWRIGHT_BASE_URL:baseURL},stdio:"inherit"});
    tests.once("exit",code=>resolvePromise(code??1));tests.once("error",()=>resolvePromise(1));
  });
}finally{
  await stopTree(server.pid);
}
process.exit(exitCode);
