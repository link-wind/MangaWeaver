"""书籍页面与原有运行的轻量关联；不改动制作产物。"""
from pathlib import Path
from ..io import read_json, write_json


def page_runs(project, session):
    project = Path(project)
    result = dict(session.get('page_runs', {}))
    index = read_json(project/'project.json')
    for ref in index.get('runs', []):
        directory = (project/ref).resolve()
        metadata = directory/'input/book.json'
        if metadata.is_file():
            page = read_json(metadata)
            result[f"{page['book_id']}:{page['page_id']}"] = str(directory)
    if session.get('active_book_id') and session.get('active_page_id') and session.get('active_run'):
        key = f"{session['active_book_id']}:{session['active_page_id']}"
        result.setdefault(key, session['active_run'])
    return result


def bind_revision(previous, current, session):
    metadata = Path(previous)/'input/book.json'
    if metadata.is_file():
        page = read_json(metadata)
        write_json(Path(current)/'input/book.json', page)
        session.setdefault('page_runs', {})[f"{page['book_id']}:{page['page_id']}"] = str(current)


def view_path(project, book_id):
    if not book_id.startswith('book-') or '/' in book_id or '..' in book_id:
        raise ValueError('书籍标识无效')
    directory = Path(project)/'sources'/book_id
    if not (directory/'book.json').is_file():
        raise ValueError('书籍不存在')
    return directory/'canvas-view.json'


def read_view(project, book_id):
    path = view_path(project, book_id)
    return read_json(path) if path.is_file() else {}
