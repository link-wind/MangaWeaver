import {useEffect,useState} from 'react';

// Read the existing pixel preferences; the panel library owns resize gestures.
export function usePanelWidth(key:string,initial:number,min:number,max:number) {
  const [width,setWidth]=useState(()=>{
    const saved=Number(localStorage.getItem(key));
    return Number.isFinite(saved)&&saved>=min?Math.min(saved,max):initial;
  });
  useEffect(()=>{localStorage.setItem(key,String(width));},[key,width]);
  return [width,setWidth] as const;
}
