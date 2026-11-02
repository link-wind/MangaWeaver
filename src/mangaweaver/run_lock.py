"""CLI 与桌面共享的进程锁；进程退出后操作系统自动释放。"""
import fcntl
import json
import os
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def run_lock(directory: Path, operation: str):
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / '.run.lock').open('a+') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('该运行正在由其他 CLI 或桌面任务使用') from None
        try:
            handle.seek(0)
            handle.truncate()
            json.dump({'pid': os.getpid(), 'operation': operation}, handle)
            handle.flush()
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)
