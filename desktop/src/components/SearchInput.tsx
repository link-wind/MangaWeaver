import { Search } from 'lucide-react';
import { InputGroup,InputGroupAddon,InputGroupInput } from './ui/input-group';

export function SearchInput({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {
  return <InputGroup className="w-48"><InputGroupAddon><Search/></InputGroupAddon><InputGroupInput aria-label={label} placeholder={label} value={value} onChange={e=>onChange(e.target.value)}/></InputGroup>;
}
