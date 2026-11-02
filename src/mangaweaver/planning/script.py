"""逐格理解原作，不在此锁定最终动画镜头数。"""
from ..schemas import SourceScript


def create(client, source, directory, previous=None, feedback=()):
    candidates = {}
    for i in range(client.config.num_scripts):
        cid = f"candidate_{i+1}"
        result = client.json_to("planning/script/create.txt", {
            "source": source.model_dump(mode="json"),
            "previous": previous.model_dump(mode="json") if previous else None,
            "feedback": feedback,
        }, SourceScript, source.images + source.reference_images, directory / f"{cid}.json")
        candidates[cid] = result.check_source(source)
    return candidates
