"""CLI 与桌面共享的进程锁；进程退出后操作系统自动释放。"""
import fcntl
import json
import os
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from threading import get_ident


class RunBusy(ValueError):
    pass


_held = ContextVar('held_run_locks', default=frozenset())


@contextmanager
def run_lock(directory: Path, operation: str):
    directory = Path(directory).resolve()
    owner = (os.getpid(), get_ident(), directory)
    held = _held.get()
    if owner in held:
        yield
        return
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / '.run.lock').open('a+') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RunBusy('该运行正在由其他 CLI 或桌面任务使用') from None
        token = _held.set(held | {owner})
        try:
            handle.seek(0)
            handle.truncate()
            json.dump({'pid': os.getpid(), 'operation': operation}, handle)
            handle.flush()
            yield
        finally:
            _held.reset(token)
            fcntl.flock(handle, fcntl.LOCK_UN)
