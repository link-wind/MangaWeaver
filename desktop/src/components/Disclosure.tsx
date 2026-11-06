import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './ui/button';
import { Collapsible,CollapsibleContent,CollapsibleTrigger } from './ui/collapsible';

export function Disclosure({title,children,className,defaultOpen=false}:{title:ReactNode;children:ReactNode;className?:string;defaultOpen?:boolean}) {
  return <Collapsible defaultOpen={defaultOpen} className={className}><CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="disclosure-trigger group w-full justify-start text-left whitespace-normal"><span className="min-w-0 flex-1">{title}</span><ChevronDown className="size-3 shrink-0 group-data-[state=open]:rotate-180"/></Button></CollapsibleTrigger><CollapsibleContent className="disclosure-content">{children}</CollapsibleContent></Collapsible>;
}
