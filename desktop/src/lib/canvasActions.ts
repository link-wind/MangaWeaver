export type DeleteSelection = {run_dir:string;node_ids:string[];scope:'node'|'downstream'};
export type DeletePreview = {revision:string;file_count:number;record_count:number;remote_tasks:number;runs:{run_dir:string;files:string[];records:string[]}[]};
