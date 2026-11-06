import type {Edge, Node} from "@xyflow/react";

/** read_agent_harness 返回的只读阶段条目。 */
export type AgentStage = {
  id:string;label:string;creators:string[];reviewers:string[];gate:string;on_fail:string;requires:string[];
};

export type AgentNodeData = {
  kind:"stage"|"creator"|"reviewer";stage:string;title:string;subtitle:string;text:string;roles:string[];
};

export type AgentNode = Node<AgentNodeData,"agent">;

const COLUMN=300;

/**
 * 把声明式清单投影成只读架构图：六阶段横向排列，Creator/Reviewer 位于阶段下方，
 * Reviewer 未通过时回到本阶段 Creator 修订。这里不读取运行目录，也不产生任何任务。
 */
export function agentGraph(stages:AgentStage[]):{nodes:AgentNode[];edges:Edge[]} {
  const nodes:AgentNode[]=[],edges:Edge[]=[];
  const stageId=(id:string)=>`stage:${id}`;
  const roleId=(id:string,kind:"creator"|"reviewer")=>`${kind}:${id}`;
  stages.forEach((stage,index)=>{
    const x=index*COLUMN;
    nodes.push({id:stageId(stage.id),type:"agent",position:{x,y:0},data:{
      kind:"stage",stage:stage.id,title:stage.label,
      subtitle:stage.requires.length?`依赖 ${stage.requires.join(" → ")}`:"流程入口",
      text:stage.gate,roles:[],
    }});
    if(stage.creators.length) nodes.push({id:roleId(stage.id,"creator"),type:"agent",position:{x,y:168},data:{
      kind:"creator",stage:stage.id,title:"Creator",subtitle:"创作",text:"",roles:stage.creators,
    }});
    if(stage.reviewers.length) nodes.push({id:roleId(stage.id,"reviewer"),type:"agent",position:{x:x+160,y:168},data:{
      kind:"reviewer",stage:stage.id,title:"Reviewer",subtitle:"审查",text:"",roles:stage.reviewers,
    }});
    if(stage.creators.length){
      edges.push({id:`${stageId(stage.id)}>creator:${stage.id}`,source:stageId(stage.id),target:roleId(stage.id,"creator"),
        sourceHandle:"down",targetHandle:"in",type:"smoothstep"});
    }
    if(stage.creators.length&&stage.reviewers.length){
      edges.push({id:`forward:${stage.id}`,source:roleId(stage.id,"creator"),target:roleId(stage.id,"reviewer"),
        sourceHandle:"forward",targetHandle:"forward",type:"smoothstep"});
      edges.push({id:`loop:${stage.id}`,source:roleId(stage.id,"reviewer"),target:stage.on_fail
          ? roleId(stage.on_fail,"creator"):roleId(stage.id,"creator"),
        sourceHandle:"loop-out",targetHandle:"loop-in",type:"smoothstep",animated:true,label:"未通过 · 回环",
        labelStyle:{fill:"#8a6a1f",fontSize:10},style:{stroke:"#b58a2b",strokeDasharray:"5 5"}});
    }
    const next=stages[index+1];
    if(next)edges.push({id:`seq:${stage.id}>${next.id}`,source:stageId(stage.id),target:stageId(next.id),type:"smoothstep"});
  });
  return {nodes,edges};
}
