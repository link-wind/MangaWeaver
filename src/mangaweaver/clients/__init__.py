"""按显式配置选择客户端，不自动切换供应商。"""


def create(config):
    if config.model_provider == "huanling":
        if config.image_provider != "huanling":
            raise ValueError("幻灵渠道请显式配置 IMAGE_PROVIDER=huanling")
        from .gemini import Gemini
        return Gemini(config)
    if config.image_provider == "ciyuan" and config.model_provider not in ("kie", "ciyuan"):
        raise ValueError("词元生图搭配 MODEL_PROVIDER=kie 或 ciyuan 使用")
    if config.model_provider == "ciyuan":
        if config.image_provider not in ("", "ciyuan"):
            raise ValueError("词元规划当前搭配词元生图，不会静默换用其他渠道")
        from .ciyuan import Ciyuan
        return Ciyuan(config)
    if config.model_provider == "kie":
        from .kie import Kie
        return Kie(config)
    if config.model_provider == "gemini":
        from .gemini import Gemini
        return Gemini(config)
    raise ValueError(f"未知模型供应商：{config.model_provider}")
