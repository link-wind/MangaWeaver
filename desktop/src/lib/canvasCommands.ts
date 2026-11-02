import type { CanvasCommand } from './types';
import type { CanvasNode } from './canvas';
export function validateCanvasCommand(command: CanvasCommand, run: string | undefined, nodes: CanvasNode[]) {
  if (command.run !== run) throw new Error('页面已切换，画布命令已失效');
  if (!command.node_ids.length || command.node_ids.some(id => !nodes.some(n => n.id === id))) throw new Error('画布节点不存在');
  if (![command.dx, command.dy].every(Number.isFinite) || Math.abs(command.dx) > 10000 || Math.abs(command.dy) > 10000) throw new Error('画布位置无效');
}
