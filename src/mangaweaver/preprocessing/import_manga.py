"""本地漫画导入：文档顺序优先，页面索引固定为从 1 开始的文件页序。"""
import re
import shutil
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET

from PIL import Image, ImageOps
from ..io import file_signature, read_json, write_json
from ..events import emit

IMAGES = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'}
PAGE_BATCH = 10


def contained(root, name):
    path = (Path(root) / unquote(name.split('#')[0])).resolve()
    if not path.is_relative_to(Path(root).resolve()):
        raise ValueError('漫画文件包含越界路径')
    return path


def unpack(archive, destination):
    with zipfile.ZipFile(archive) as z:
        for item in z.infolist():
            contained(destination, item.filename)
            if item.file_size > 100_000_000:
                raise ValueError('压缩包单文件过大')
        if sum(i.file_size for i in z.infolist()) > 2_000_000_000:
            raise ValueError('解包大小超过 2GB')
        z.extractall(destination)


class Images(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        ref = values.get('src') if tag == 'img' else values.get('href', values.get('xlink:href')) if tag == 'image' else None
        if ref:
            self.sources.append(ref)


def html_images(document, root):
    root, document = Path(root).resolve(), Path(document).resolve()
    parser = Images()
    parser.feed(document.read_text(encoding='utf-8', errors='replace'))
    return [contained(root, str(document.parent.relative_to(root) / ref)) for ref in parser.sources]


def load_pages(project, book_id, numbers):
    if not isinstance(book_id, str) or not book_id.startswith('book-') or '/' in book_id or '..' in book_id:
        raise ValueError('无效书籍')
    folder = Path(project).resolve() / 'sources' / book_id
    book = read_json(folder / 'book.json')
    if not isinstance(numbers, list) or not numbers or any(type(n) is not int or not 1 <= n <= book['page_count'] for n in numbers):
        raise ValueError('请选择有效的文件页序')
    pending = [book['pages'][n - 1] for n in dict.fromkeys(numbers)
               if not Path(book['pages'][n - 1]['image']).is_file() or not Path(book['pages'][n - 1]['thumbnail']).is_file()]
    if not pending:
        return book

    def save(page, image):
        full, thumb = Path(page['image']), Path(page['thumbnail'])
        full.parent.mkdir(exist_ok=True)
        thumb.parent.mkdir(exist_ok=True)
        image = ImageOps.exif_transpose(image).convert('RGB')
        image.save(full, quality=95)
        image.thumbnail((240, 320))
        image.save(thumb, quality=80)
        page['loaded'] = True

    emit('book.load', message=f"加载文件第 {pending[0]['number']}～{pending[-1]['number']} 页")
    kind = book.get('format')
    if kind == 'cbz':
        with zipfile.ZipFile(book['original']) as archive:
            for page in pending:
                with archive.open(page['source']) as stream, Image.open(stream) as image:
                    save(page, image)
    elif kind == 'pdf':
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(book['original'])
        try:
            for page in pending:
                pdf_page = pdf[page['number'] - 1]
                bitmap = pdf_page.render(scale=1.5)
                try:
                    save(page, bitmap.to_pil())
                finally:
                    bitmap.close()
                    pdf_page.close()
        finally:
            pdf.close()
    elif kind in {'mobi', 'image'}:
        for page in pending:
            with Image.open(contained(folder, page['source'])) as image:
                save(page, image)
    else:
        raise ValueError('旧书籍的页面文件缺失，请重新导入')
    write_json(folder / 'book.json', book)
    return book


def import_manga(project, source):
    project, source = Path(project).resolve(), Path(source).resolve()
    fingerprint = file_signature(source)
    folder = project / 'sources' / ('book-' + fingerprint[:16])
    index = folder / 'book.json'
    if index.exists():
        book = read_json(index)
        return load_pages(project, folder.name, list(range(1, min(PAGE_BATCH, book['page_count']) + 1)))
    folder.mkdir(parents=True, exist_ok=True)
    emit('book.import', message='读取页序，首批加载 10 页')
    suffix = source.suffix.lower()
    original = folder / ('original' + suffix)
    shutil.copyfile(source, original)
    files = []
    kind = suffix.lstrip('.')
    if suffix in IMAGES:
        kind, files = 'image', [original.name]
    elif suffix == '.pdf':
        try:
            import pypdfium2 as pdfium
        except ImportError:
            raise ValueError("PDF 解析依赖缺失，请安装 book-import 可选依赖") from None
        pdf = pdfium.PdfDocument(original)
        try:
            files = list(range(len(pdf)))
        finally:
            pdf.close()
    elif suffix == '.cbz':
        with zipfile.ZipFile(original) as archive:
            for item in archive.infolist():
                contained(folder, item.filename)
                if item.file_size > 100_000_000:
                    raise ValueError('压缩包单文件过大')
            if sum(i.file_size for i in archive.infolist()) > 2_000_000_000:
                raise ValueError('解包大小超过 2GB')
            files = sorted((i.filename for i in archive.infolist() if not i.is_dir() and Path(i.filename).suffix.lower() in IMAGES and not Path(i.filename).name.startswith('.')),
                key=lambda name: [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', name)])
    elif suffix == '.mobi':
        tmp = folder / 'unpacked'
        tmp.mkdir(exist_ok=True)
        # 作为独立 CLI 使用 GPL 的 mobi/KindleUnpack，不复制其源代码。
        import subprocess, sys
        executable = Path(sys.executable).parent / 'mobiunpack'
        if not executable.is_file():
            raise ValueError('MOBI 解析依赖缺失，请安装 book-import 可选依赖（mobiunpack）')
        command = [str(executable), str(original), str(tmp)]
        result = subprocess.run(command, capture_output=True, timeout=120)
        if result.returncode:
            raise ValueError('MOBI 解包失败；请检查文件是否损坏或加密')
        opfs = sorted(Path(tmp).rglob('*.opf'))
        docs = sorted(Path(tmp).rglob('*.html'))
        # 该导出工具的 mobi7 HTML 已按阅读顺序写好 img；mobi8 优先 OPF spine。
        if opfs:
            opf = opfs[-1]
            tree = ET.parse(opf)
            manifest = {e.attrib['id']: e.attrib['href'] for e in tree.iter() if e.tag.endswith('}item')}
            files = []
            for e in tree.iter():
                if e.tag.endswith('itemref'):
                    doc = contained(Path(tmp), str(opf.parent.relative_to(tmp) / manifest[e.attrib['idref']]))
                    files.extend(html_images(doc, Path(tmp)))
        elif len(docs) == 1:
            files = html_images(docs[0], Path(tmp))
        else:
            raise ValueError('MOBI 缺少明确的阅读顺序文档')
        files = [str(path.relative_to(folder)) for path in files]
    else:
        raise ValueError('支持 MOBI、PDF、CBZ 或单页图片')
    if not files:
        raise ValueError('未找到漫画页面')
    pages = [{'id': f'page{n:04d}', 'number': n, 'image': str(folder / 'pages' / f'page{n:04d}.jpg'),
              'thumbnail': str(folder / 'thumbnails' / f'page{n:04d}.jpg'), 'source': item, 'loaded': False}
             for n, item in enumerate(files, 1)]
    book = {'version': 2, 'id': folder.name, 'name': source.name, 'sha256': fingerprint,
            'original': str(original), 'format': kind, 'page_count': len(pages), 'pages': pages}
    write_json(index, book)
    return load_pages(project, folder.name, list(range(1, min(PAGE_BATCH, len(pages)) + 1)))
