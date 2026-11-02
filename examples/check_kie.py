"""真实 Kie 接口检查：一次脚本 JSON、一张两图参考生图、一次完整视频评审。"""
import argparse
from pathlib import Path

from PIL import Image

from mangaweaver.clients import create
from mangaweaver.config import Config
from mangaweaver.generation.tasks import build, load_plan
from mangaweaver.generation.video_review import select
from mangaweaver.io import read_json, write_json
from mangaweaver.preprocessing.transcript import load_source
from mangaweaver.schemas import SourceScript

EXAMPLES = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir', type=Path, required=True)
    parser.add_argument('--video', type=Path, required=True, help='已生成的短视频，原样上传评审')
    args = parser.parse_args()
    if not args.video.is_file():
        parser.error('请提供已存在的视频；检查脚本不会自动生成视频')
    config = Config.load()
    if config.model_provider != 'kie':
        parser.error('该检查要求 MODEL_PROVIDER=kie')
    root = args.run_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    snapshot = root / 'config.json'
    if snapshot.exists() and read_json(snapshot) != config.snapshot():
        parser.error('配置变化，请使用新运行目录')
    write_json(snapshot, config.snapshot())
    client = create(config)
    try:
        before = root / 'balance_before.json'
        if not before.exists():
            write_json(before, {'credits': client.balance()})
        source = load_source(EXAMPLES / 'key-moment/source.json')
        script = client.json_to('planning/script/create.txt', {
            'source': source.model_dump(mode='json'), 'previous': None, 'feedback': []},
            SourceScript, source.images, root / 'source_script.json')
        script.check_source(source)
        print('来源脚本 JSON 与引用校验通过', flush=True)
        image = root / 'reference-keyframe.png'
        if not image.exists():
            client.image('planning/storyboard/create.txt', {
                'shot': {'shot_id': 's001', 'camera': '固定侧面全景', 'environment': '简洁球场'},
                'anchor': {'time': 4, 'role': 'source_moment',
                           'description': '保留蓝左红右的人物、配色和橙色球；球位于两人之间'},
                'requirements': '去掉输入中所有英文说明和标题，只画无文字的单张 16:9 关键画面。'},
                [EXAMPLES / 'key-moment/images/entry.png', EXAMPLES / 'key-moment/images/impact.png'], image)
        with Image.open(image) as im:
            print('两图参考生图完成：', im.size, flush=True)
        plan = load_plan(EXAMPLES / 'key-moment/production.json')
        _, report = select(client, plan, plan.shot_list.shots[0], {'actual_video': args.video.resolve()},
                           root / 'video_review.json', segment=build(plan)[0])
        print('完整视频评审 JSON 校验通过；内容 accepted=', report.accepted, flush=True)
        print(report.reason, flush=True)
        after = client.balance()
        write_json(root / 'balance_after.json', {'credits': after})
        write_json(root / 'verification.json', {'json_valid': True, 'reference_image_generated': True,
            'video_review_valid': True, 'video_accepted': report.accepted,
            'credits_before': read_json(before)['credits'], 'credits_after': after,
            'scope': '接口小样例，不是完整规划循环、漫画质量或两段接缝验收'})
    finally:
        client.save_usage(root / 'usage.json')


if __name__ == '__main__':
    main()
