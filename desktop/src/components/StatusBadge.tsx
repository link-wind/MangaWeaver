import type { ReactNode } from 'react';
import { Badge } from './ui/badge';
import { Spinner } from './ui/spinner';

export function StatusBadge({status,children}:{status:string;children:ReactNode}) {
  const danger=['failed','blocked','interrupted'].includes(status);
  const warning=['waiting','waiting_user','needs_user','rejected','queued','pending'].includes(status);
  const success=status==='completed'||status==='ready';
  const tone=danger?'danger':warning?'warning':success?'success':status==='running'?'running':'neutral';
  return <Badge variant="secondary" className={`status-badge status-badge-${tone}`}>{status==='running'&&<Spinner className="size-3"/>}{children}</Badge>;
}
