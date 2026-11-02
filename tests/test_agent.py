"""只检查关键身份、页序与回执，不用 Mock 声称模型链路通过。"""
import tempfile
import unittest
import zipfile
from pathlib import Path
from PIL import Image
from mangaweaver.io import write_json, read_json
from mangaweaver.preprocessing.import_manga import import_manga, unpack
from mangaweaver.agent.loop import handle
from mangaweaver.agent.tools import execute
from mangaweaver.schemas import AgentAction


class AgentTests(unittest.TestCase):
    def test_cbz_order_and_new_page_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)
            write_json(p/'project.json',{'runs':[]})
            image=p/'one.png'; Image.new('RGB',(32,48)).save(image)
            z=p/'book.cbz'
            with zipfile.ZipFile(z,'w') as f:
                for n in [10,2,1]: f.write(image,f'{n}.png')
            book=import_manga(p,z)
            self.assertEqual(book['page_count'],3)
            self.assertEqual(import_manga(p,z),book)
            s={'active_book_id':book['id'],'goal':'test'}
            def select(n): return execute(p,s,AgentAction(kind='call_tool',tool='select_page',arguments={'page':n}),{})
            first=select(1)['run']; self.assertEqual(select(1)['run'],first)
            second=select(2)['run']; self.assertNotEqual(first,second)
            self.assertEqual(select(1)['run'], first)
            self.assertEqual(len(read_json(p/'project.json')['runs']), 2)
            self.assertTrue((Path(first)/'canvas.json').exists())
            with self.assertRaises(ValueError): select(4)

    def test_book_pages_reopen_view_and_explicit_revision_without_models(self):
        from unittest.mock import patch
        from mangaweaver.desktop import dispatch
        from mangaweaver.agent.loop import load_session
        from mangaweaver.agent.pages import bind_revision, page_runs
        from mangaweaver.agent.tools import new_run
        with tempfile.TemporaryDirectory() as tmp, patch('socket.socket.connect', side_effect=AssertionError('本地画布不应联网')):
            p=Path(tmp).resolve();write_json(p/'project.json', {'version':1,'runs':[],'sources':[]})
            image=p/'page.png';Image.new('RGB',(32,48)).save(image)
            z=p/'book.cbz'
            with zipfile.ZipFile(z,'w') as archive:
                for n in (1,2):archive.write(image,f'{n}.png')
            book=import_manga(p,z)
            session=load_session(p);session.update(active_book_id=book['id'],goal='本地画布验证')
            write_json(p/'session.json',session)
            request={'project':str(p),'command':'agent_open_pages','pages':[1,2]}
            result=dispatch(request)
            first=result['page_runs'][f"{book['id']}:{book['pages'][0]['id']}"]
            self.assertEqual(len(read_json(p/'project.json')['runs']),2)
            dispatch(request)
            self.assertEqual(len(read_json(p/'project.json')['runs']),2)
            view={'collapsed_groups':[first+'::group:panel'],'collapsed_pages':[first],'book_collapsed':True,'positions':{'book:'+book['id']:{'x':12,'y':20}}}
            dispatch({'project':str(p),'command':'save_book_view','book_id':book['id'],'view':view})
            before=(p/'session.json').read_bytes()
            reopened=dispatch({'project':str(p),'command':'read_session'})
            self.assertEqual(reopened['book_view'],view)
            self.assertEqual((p/'session.json').read_bytes(),before)
            second=new_run(p);bind_revision(first,second,session)
            self.assertEqual(page_runs(p,session)[f"{book['id']}:{book['pages'][0]['id']}"],str(second))
            self.assertTrue(Path(first).is_dir())
            revision=new_run(p)
            dispatch({'command':'start_canvas','run_dir':str(revision),'page':str(Path(first)/'input/page.jpg'),'from_run':first})
            self.assertEqual(read_json(revision/'input/book.json')['page_id'],book['pages'][0]['id'])
            selected=dispatch({'command':'agent_select_page','project':str(p),'page_number':1})
            self.assertEqual(selected['active_run'],str(revision))

    def test_archive_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp); z=p/'bad.cbz'
            with zipfile.ZipFile(z,'w') as f:f.writestr('../outside','bad')
            with self.assertRaises(ValueError):unpack(z,p/'extract')

    def test_ten_page_import_and_requested_page_loading(self):
        from mangaweaver.desktop import dispatch
        from mangaweaver.preprocessing.import_manga import load_pages
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp).resolve();write_json(p/'project.json',{'runs':[]})
            image=p/'page.png';im=Image.new('RGB',(64,96),'white');im.save(image)
            archive=p/'book.cbz'
            with zipfile.ZipFile(archive,'w') as z:
                for n in range(25,0,-1):z.write(image,f'{n}.png')
            pdf=p/'book.pdf';im.save(pdf,save_all=True,append_images=[im]*24)
            for path in [archive,pdf]:
                book=import_manga(p,path);folder=p/'sources'/book['id']
                self.assertEqual(book['page_count'],25)
                self.assertEqual([x['number'] for x in book['pages'] if x['loaded']],list(range(1,11)))
                self.assertEqual(len(list((folder/'pages').glob('*.jpg'))),10)
                book=dispatch({'command':'load_book_pages','project':str(p),'book_id':book['id'],'pages':list(range(11,21))})
                self.assertEqual(len(list((folder/'pages').glob('*.jpg'))),20)
                session={'active_book_id':book['id'],'goal':'本地验证'}
                execute(p,session,AgentAction(kind='call_tool',tool='select_page',arguments={'page':25}),{})
                self.assertTrue(Path(read_json(folder/'book.json')['pages'][24]['image']).is_file())
                self.assertFalse(Path(book['pages'][20]['image']).exists())
                if path==archive:
                    from types import SimpleNamespace
                    from mangaweaver.events import subscribe
                    seen=[]
                    def answer(*args):
                        self.assertIn('book.ready',seen)
                        self.assertEqual(read_json(p/'session.json')['active_book_id'],book['id'])
                        return AgentAction(kind='ask_user',text='请选择文件页序')
                    with subscribe(lambda kind,stage,data:seen.append(stage)):
                        handle({'command':'agent_message','project':str(p),'attachment':str(path),'text':'打开漫画'},
                               client=SimpleNamespace(stream_json=lambda *a,**kw:answer(*a),json=answer,save_usage=lambda _:None))
                # 原文件移走仍能继续加载项目已保存的漫画。
                path.rename(path.with_suffix(path.suffix+'.moved'))
                load_pages(p,book['id'],[22])
                self.assertTrue(Path(book['pages'][21]['image']).exists())
            legacy=import_manga(p,image)
            for entry in legacy['pages']:entry.pop('loaded');entry.pop('source')
            legacy.pop('format');legacy['version']=1
            write_json(p/'sources'/legacy['id']/'book.json',legacy)
            self.assertEqual(load_pages(p,legacy['id'],[1]),legacy)

    def test_explicit_stage_routes_to_professional_tools_and_stops(self):
        from unittest.mock import patch
        from mangaweaver.agent.loop import load_session
        from mangaweaver.generation.tasks import load_plan
        plan=load_plan(Path(__file__).resolve().parents[1]/'examples/cross-panel/production.json')
        with tempfile.TemporaryDirectory() as tmp, patch('socket.socket.connect',side_effect=AssertionError('阶段路由检查不可联网')):
            p=Path(tmp).resolve();write_json(p/'project.json',{'runs':[]})
            directory=p/'runs'/'page';directory.mkdir(parents=True)
            session=load_session(p);session['active_run']=str(directory);write_json(p/'session.json',session)
            def run(stage):return handle({'command':'agent_run_stage','project':str(p),'run_dir':str(directory),'stage':stage})
            self.assertIn('缺少分格',run('script')['pending']['question'])
            write_json(directory/'source/manifest.json',plan.source)
            self.assertIn('关键画面',run('video')['pending']['question'])
            draft={}
            def professional(request):
                stage=request['until_stage']
                draft['script']=plan.script.model_dump(mode='json')
                if stage!='script':draft['shot_list']=plan.shot_list.model_dump(mode='json')
                if stage in ('direction','storyboard'):draft['directions']=[d.model_dump(mode='json') for d in plan.directions]
                draft.setdefault('reviews',[]).append({'scope':stage,'accepted':True})
                write_json(directory/'planning_draft.json',draft)
                if stage=='storyboard':write_json(directory/'production.json',plan)
            with patch('mangaweaver.desktop.dispatch',side_effect=professional) as delegated:
                for stage in ['script','arrangement','direction','storyboard']:
                    result=run(stage)
                    self.assertIsNone(result['pending'])
                    self.assertEqual(delegated.call_args.args[0]['until_stage'],stage)
                    self.assertIsNone(delegated.call_args.args[0]['from_stage'])
                self.assertEqual(delegated.call_count,4)
                run('script')
                self.assertEqual(delegated.call_count,4)
            with patch('mangaweaver.desktop.dispatch',return_value={}) as generate:
                run('video');self.assertEqual(generate.call_args.args[0]['command'],'generate')
            from mangaweaver.agent.tasks import load as load_tasks
            self.assertTrue(any(t['origin']=='stage' and t['stage']=='script' for t in load_tasks(p)['tasks']))
            self.assertFalse(any(m['text']=='运行 · 来源脚本' for m in result['messages']))
            with patch('mangaweaver.agent.stages.run_stage',side_effect=KeyboardInterrupt):
                with self.assertRaises(KeyboardInterrupt):run('script')
            stopped=read_json(p/'session.json')
            self.assertEqual(stopped['pending']['kind'],'interrupted')
            self.assertIn('已停止',stopped['messages'][-1]['text'])

    def test_stale_receipt_and_read_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);write_json(p/'project.json',{'runs':[]})
            original={'revision':3,'pending':{'kind':'canvas','call_id':'a','revision':3,'run':'run'},'messages':[]}
            write_json(p/'session.json',original)
            self.assertEqual(handle({'command':'read_session','project':tmp}),original)
            with self.assertRaises(ValueError):handle({'command':'agent_continue','project':tmp,'call_id':'wrong','revision':3,'run_dir':'run'})
            self.assertEqual(read_json(p/'session.json'),original)

    def test_single_page_and_pdf(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);write_json(p/'project.json',{'runs':[]})
            image=p/'page.png';pdf=p/'pages.pdf'
            im=Image.new('RGB',(64,96),'white');im.save(image);im.save(pdf,save_all=True,append_images=[im])
            self.assertEqual(import_manga(p,image)['page_count'],1)
            self.assertEqual(import_manga(p,pdf)['page_count'],2)
