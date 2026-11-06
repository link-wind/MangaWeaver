const $=selector=>document.querySelector(selector);
const icon=name=>`<svg class="icon"><use href="#${name}"/></svg>`;
const pages=Array.from({length:10},(_,i)=>({number:90+i,status:['done','done','idle','idle','issue','working','idle','idle','idle','idle'][i]}));
const selected=new Set();
let active=94,reference=95,filter='all',view='overview',zoom=1,toastTimer,lastSelected=94;
const label={done:'已有成片',idle:'未开始',issue:'需处理',working:'制作中'};
const dot={done:'green',idle:'',issue:'amber',working:'violet'};
const pageImage=number=>`assets/page-${String(number).padStart(3,'0')}.jpg`;
function toast(text){$('.toast').textContent=text;$('.toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('.toast').classList.remove('visible'),2500);}
function renderPages(){
  $('#page-grid').innerHTML=pages.filter(page=>filter==='all'||page.status===filter).map(page=>`
    <article class="page-card-v1 ${page.status} ${selected.has(page.number)?'selected':''}" data-page="${page.number}">
      <button class="page-select" aria-label="选择第${page.number}页" aria-pressed="${selected.has(page.number)}">${icon('check')}</button>
      <button class="page-image-button" aria-label="打开第${page.number}页" title="单击选择，双击打开"><img src="${pageImage(page.number)}" alt="原作第${page.number}页完整漫画" draggable="false"></button>
      <div class="page-meta"><span>${String(page.number).padStart(3,'0')}</span><small><i class="status-dot ${dot[page.status]}"></i> ${label[page.status]}</small></div>
    </article>`).join('');
  $('.selection-dock').hidden=!selected.size;
  $('.selection-total strong').textContent=selected.size;
  $('[data-action=batch] span').textContent=`制作所选 ${selected.size} 页`;
  $('.scope-chip span').textContent=selected.size?`所选 ${selected.size} 页`:'整本漫画';
  $('[data-action=compare-selected]').disabled=selected.size!==2;
}
function selectPage(number,range=false){
  if(range){const start=Math.min(lastSelected,number),end=Math.max(lastSelected,number);for(let i=start;i<=end;i++)selected.add(i);}
  else{selected.has(number)?selected.delete(number):selected.add(number);lastSelected=number;}
  document.querySelectorAll('[data-page]').forEach(card=>{
    const chosen=selected.has(Number(card.dataset.page));
    card.classList.toggle('selected',chosen);
    card.querySelector('.page-select').setAttribute('aria-pressed',String(chosen));
  });
  $('.selection-dock').hidden=!selected.size;
  $('.selection-total strong').textContent=selected.size;
  $('[data-action=batch] span').textContent=`制作所选 ${selected.size} 页`;
  $('.scope-chip span').textContent=selected.size?`所选 ${selected.size} 页`:'整本漫画';
  $('[data-action=compare-selected]').disabled=selected.size!==2;
}
function setView(next,number=active){
  view=next;active=number;
  document.body.dataset.view=view;
  $('.overview-link').classList.toggle('active',view==='overview');
  $('#path-page').textContent=view==='overview'?'入间同学入魔了 · 卷 01':`第 ${String(active).padStart(3,'0')} 页${view==='compare'?' / 双页对照':''}`;
  $('#page-number').textContent=`第 ${String(active).padStart(3,'0')} 页`;
  $('#source-image').src=pageImage(active);
  $('.current-page-link>span').textContent=`第 ${String(active).padStart(3,'0')} 页`;
  $('.current-page-link>small').textContent=active===94?'1 项需处理':'未开始';
  const detailed=active===94;
  $('#stage-board').hidden=!detailed;
  $('.unstarted-page').hidden=detailed;
  $('.unstarted-page img').src=pageImage(active);
  $('.page-summary').textContent=detailed?'6 格漫画 · 4 个镜头 · 20 秒':'原页浏览 · 尚未制作';
  $('.page-outline').style.visibility=detailed?'visible':'hidden';
  if(view==='compare'){
    if(reference===active)reference=active===99?98:active+1;
    $('#reference-page').src=pageImage(reference);
    $('#reference-title').textContent=`第 ${String(reference).padStart(3,'0')} 页`;
    $('#reference-page').alt=`原作第${reference}页完整漫画`;
    $('#canvas-scroll').scrollLeft=0;
  }
  if(view!=='overview'&&!detailed){
    $('.page-chat .dialogue-view').innerHTML=`<div class="date-divider">本页创作</div><p class="new-page-message">第 ${active} 页还没有创作对话。可以查看原页，或将本页加入制作范围。</p><div class="batch-status"><span class="batch-icon">${icon('book')}</span><div><strong>原作第 ${active} 页</strong><span>浏览页面不会启动生成</span></div></div>`;
    $('.page-chat .collaboration-view').innerHTML='<p class="new-page-message">本页尚无协作记录。</p>';
    $('.page-chat .reference-chip').style.display='none';
    $('.page-chat textarea').placeholder=`描述第 ${active} 页的创作要求…`;
  } else if(detailed){
    $('.page-chat .dialogue-view').innerHTML=approvedDialogue;
    $('.page-chat .collaboration-view').innerHTML=approvedCollaboration;
    $('.page-chat .reference-chip').style.display='inline-flex';
  }
  history.replaceState(null,'',`#${view}${view==='overview'?'':`-${active}`}`);
}
const approvedDialogue=$('.page-chat .dialogue-view').innerHTML;
const approvedCollaboration=$('.page-chat .collaboration-view').innerHTML;
function locate(id){
  if(view==='overview')setView('single',94);
  const target=document.getElementById(id==='video03'?'video':id==='frame03'?'frames':id==='panels'?'source':id);
  if(target){const parent=$('#canvas-scroll');parent.scrollLeft=Math.max(0,target.offsetLeft-30);}
  toast('已定位当前页的关联内容');
}
document.addEventListener('dblclick',event=>{
  const target=event.target.closest('.page-image-button');
  if(target)setView('single',Number(target.closest('[data-page]').dataset.page));
});
document.addEventListener('click',event=>{
  const card=event.target.closest('[data-page]');
  if(card){selectPage(Number(card.dataset.page),event.shiftKey);return;}
  const filterButton=event.target.closest('[data-filter]');
  if(filterButton){filter=filterButton.dataset.filter;document.querySelectorAll('[data-filter]').forEach(button=>button.setAttribute('aria-selected',String(button===filterButton)));renderPages();return;}
  const tab=event.target.closest('[data-tab]');
  if(tab){$('.page-chat .conversation').classList.toggle('is-collaboration',tab.dataset.tab==='collaboration');document.querySelectorAll('.page-chat [data-tab]').forEach(button=>button.classList.toggle('active',button===tab));return;}
  const focus=event.target.closest('[data-focus],[data-locate]');
  if(focus){locate(focus.dataset.focus||focus.dataset.locate);return;}
  const button=event.target.closest('[data-action]');
  if(!button)return;
  const action=button.dataset.action;
  if(action==='overview'){setView('overview');return;}
  if(action==='open94'){setView('single',94);return;}
  if(action==='open95'){setView('single',95);return;}
  if(action==='current'){setView('single');return;}
  if(action==='open-selected'){setView('single',[...selected].sort()[0]||94);return;}
  if(action==='compare-selected'){const numbers=[...selected].sort();reference=numbers[1];setView('compare',numbers[0]);return;}
  if(action==='compare'){reference=active<99?active+1:active-1;setView('compare');return;}
  if(action==='single'){setView('single');return;}
  if(action==='swap'){const previous=active;active=reference;reference=previous;setView('compare');return;}
  if(action==='prev'||action==='next'){setView(view,Math.min(99,Math.max(90,active+(action==='prev'?-1:1))));return;}
  if(action==='clear-selection'){selected.clear();renderPages();return;}
  if(action==='toggle-chat'){document.body.classList.toggle('chat-hidden');return;}
  if(action==='panels'){$('.extra-panels').hidden=!$('.extra-panels').hidden;return;}
  if(action==='preview'){$('.media-preview').showModal();return;}
  if(action==='close-preview'){$('.media-preview').close();$('.media-preview video').pause();return;}
  if(action==='reference'){
    $('.page-chat .reference-chip').style.display='inline-flex';
    $('.page-chat .reference-chip img').src=pageImage(reference);
    $('.page-chat .reference-chip>span').textContent=`第 ${String(reference).padStart(3,'0')} 页 · 原始漫画`;
    $('.page-chat textarea').focus();toast('已引用对照页，制作目标仍是当前页');return;
  }
  if(action==='remove-reference'){$('.page-chat .reference-chip').style.display='none';return;}
  if(action==='overview-process'){
    $('.overview-chat-content').innerHTML=`<div class="date-divider">跨页协作 · 演示</div><section class="trace-stage warning"><h3>第 094 页<span>视频需修订</span></h3><div class="role-detail">视频生成 → 视频审查</div><p>镜头03出现意外硬切，需要保留双人近景。</p><button class="inline-link" data-action="open94">查看该页反馈 ${icon('arrow-right')}</button></section><section class="trace-stage"><h3>第 095 页<span>制作中</span></h3><div class="role-detail">画面创作 → 画面审查</div><p>正在制作关键画面，不影响当前画布。</p></section><section class="trace-stage"><h3>第 096 页<span>等待处理</span></h3><p>完成上一页后继续。</p></section>`;return;
  }
  if(action==='overview-dialogue'){ $('.overview-chat-content').innerHTML=overviewDialogue;return;}
  if(['zoom-in','zoom-out','fit'].includes(action)){zoom=action==='fit'?1:Math.max(.5,Math.min(1.3,zoom+(action==='zoom-in'?.1:-.1)));$('#stage-board').style.transform=`scale(${zoom})`;$('.zoom-display').textContent=Math.round(zoom*100)+'%';return;}
  if(action==='select-frame'){toast('已选关键画面，可通过右侧引用提出修改');return;}
  if(action==='batch'){toast(`视觉初稿：制作所选 ${selected.size} 页，不提交模型请求`);return;}
  if(action==='run'||action==='send'){toast('视觉初稿：仅预览操作，不调用模型');return;}
  const notices={settings:'设置沿用现有客户端',materials:'本稿使用本地漫画素材',history:'这里将显示项目级会话历史',new:'可在下方输入新的要求',more:'完整操作沿用现有客户端',copy:'视觉初稿：复制回复入口',attachment:'视觉初稿：添加本地素材',mention:'选择页面或节点加入引用',model:'当前示例：Gemini 3.8 Flash','source-preview':'可以使用双页对照查看完整原页'};
  toast(notices[action]||'此处保留现有客户端操作');
});
const overviewDialogue=$('.overview-chat-content').innerHTML;
$('#jump').addEventListener('keydown',event=>{if(event.key!=='Enter')return;const number=Number(event.target.value);if(number>=90&&number<=99){setView('single',number);event.target.value='';}else toast('初稿提供原作90—99页，输入94试试');});
$('.comparison-divider').addEventListener('pointerdown',event=>{
  const divider=event.currentTarget;divider.setPointerCapture(event.pointerId);
  const onMove=move=>{const parent=$('.workspace-panes').getBoundingClientRect();const width=Math.min(parent.width*.58,Math.max(230,parent.right-move.clientX));$('.reference-pane').style.width=`${width}px`;};
  divider.addEventListener('pointermove',onMove);
  divider.addEventListener('pointerup',()=>divider.removeEventListener('pointermove',onMove),{once:true});
});
$('.media-preview').addEventListener('close',()=>$('.media-preview video').pause());
renderPages();
const initial=location.hash.match(/^#(single|compare)-(\d+)$/);
if(initial)setView(initial[1],Math.min(99,Math.max(90,Number(initial[2]))));
