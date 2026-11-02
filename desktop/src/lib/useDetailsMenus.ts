import {useEffect,useRef} from 'react';

/** 原生 details 菜单：Escape 返回触发器，外部点击保持外部焦点。 */
export function useDetailsMenus<T extends HTMLElement>(){
  const root=useRef<T>(null);
  useEffect(()=>{
    const menus=()=>[...(root.current?.matches('details[data-menu][open]')?[root.current as unknown as HTMLDetailsElement]:[]),...Array.from(root.current?.querySelectorAll<HTMLDetailsElement>('details[data-menu][open]')||[])];
    const pointer=(e:PointerEvent)=>menus().forEach(menu=>{if(!menu.contains(e.target as Node))menu.open=false;});
    const escape=(e:KeyboardEvent)=>{
      if(e.key!=='Escape')return;
      const open=menus();
      const menu=open.find(m=>m.contains(document.activeElement))||open.at(-1);
      if(menu){e.preventDefault();e.stopPropagation();menu.open=false;menu.querySelector<HTMLElement>('summary')?.focus();}
    };
    const choose=(e:MouseEvent)=>{
      const element=e.target as Element;
      if(root.current?.contains(element)&&element.closest('button'))element.closest<HTMLDetailsElement>('details[data-menu]')?.removeAttribute('open');
    };
    document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',escape);
    document.addEventListener('click',choose);
    return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',escape);document.removeEventListener('click',choose);};
  },[]);
  return root;
}
