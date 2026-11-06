import { useState,type ComponentProps,type ReactElement,type ReactNode } from 'react';
import { Button } from './ui/button';
import { DialogContent,DialogTitle,Dialog as Root } from './ui/dialog';
import { DropdownMenu,DropdownMenuContent,DropdownMenuTrigger } from './ui/dropdown-menu';
import { SelectContent,Select as SelectRoot,SelectTrigger,SelectValue } from './ui/select';
import { ToggleGroup as ToggleRoot } from './ui/toggle-group';
import { TooltipContent,Tooltip as TooltipRoot,TooltipTrigger } from './ui/tooltip';

// Business adapters only: presentation, focus trapping and keyboard behavior live in ui/.
export function Dialog({title,className,children,onClose}:{title:string;className?:string;children:ReactNode;onClose:()=>void}) {
  const [previous]=useState(()=>document.activeElement as HTMLElement|null);
  return <Root open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className={className} aria-describedby={undefined} onCloseAutoFocus={e=>{e.preventDefault();if(previous?.isConnected)previous.focus();}}><DialogTitle className="sr-only">{title}</DialogTitle>{children}</DialogContent></Root>;
}
export function Select({value,onValueChange,disabled,label,children,className,size}:{value:string;onValueChange:(value:string)=>void;disabled?:boolean;label:string;children:ReactNode;className?:string;size?:'sm'|'default'}) {
  return <SelectRoot value={value} onValueChange={onValueChange} disabled={disabled}><SelectTrigger aria-label={label} className={className} size={size}><SelectValue/></SelectTrigger><SelectContent position="popper">{children}</SelectContent></SelectRoot>;
}
export function Tooltip({label,children,side='bottom'}:{label:ReactNode;children:ReactElement;side?:'top'|'right'|'bottom'|'left'}) {
  return <TooltipRoot delayDuration={450}><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent side={side}>{label}</TooltipContent></TooltipRoot>;
}
export function ToggleGroup({value,onValueChange,label,children,className}:{value:string;onValueChange:(value:string)=>void;label:string;children:ReactNode;className?:string}) {
  return <ToggleRoot type="single" size="sm" value={value} onValueChange={value=>{if(value)onValueChange(value);}} aria-label={label} className={className}>{children}</ToggleRoot>;
}
export function ActionMenu({label,trigger,children,disabled=false,size='icon',className=''}:{label:string;trigger:ReactNode;children:ReactNode;disabled?:boolean;size?:ComponentProps<typeof Button>['size'];className?:string}) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size={size} className={`action-menu-trigger ${className}`} aria-label={label} disabled={disabled}>{trigger}</Button></DropdownMenuTrigger><DropdownMenuContent side="bottom" align="end">{children}</DropdownMenuContent></DropdownMenu>;
}
