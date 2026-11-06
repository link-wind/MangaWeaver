"""只读声明式编排清单：描述六个制作阶段与多 Agent 角色协作关系。

这里只负责画布架构视图的展示与阶段标签的单一来源，不驱动执行。真正的阶段完成
判断仍在 `stages.completed()`，Creator／Reviewer 的反馈循环仍由
`planning.pipeline` 与 `specialists` 承担。清单中不包含提示词、工具或模型字段，
避免与上述实现重复维护。
"""

STAGES = [
    {
        "id": "preprocess",
        "label": "漫画分格",
        "creators": [],
        "reviewers": [],
        "gate": "整页漫画已分格并识别文字，形成来源清单",
        "on_fail": "",
        "requires": [],
    },
    {
        "id": "script",
        "label": "来源脚本",
        "creators": ["script.creator", "dialogue.creator"],
        "reviewers": ["script.reviewer", "dialogue.reviewer"],
        "gate": "来源脚本与日语对白通过审查，保留原作事件、人物与对白",
        "on_fail": "",
        "requires": ["preprocess"],
    },
    {
        "id": "arrangement",
        "label": "镜头编排",
        "creators": ["arrangement.creator"],
        "reviewers": ["arrangement.reviewer"],
        "gate": "静态与动作镜头编排通过审查，多个漫画格可映射到同一镜头",
        "on_fail": "",
        "requires": ["script"],
    },
    {
        "id": "direction",
        "label": "演出方案",
        "creators": ["direction.creator"],
        "reviewers": ["direction.reviewer"],
        "gate": "动作镜头入点、节奏、出点与关键画面通过审查；无动作镜头时自动通过",
        "on_fail": "",
        "requires": ["arrangement"],
    },
    {
        "id": "storyboard",
        "label": "关键画面",
        "creators": ["storyboard.creator"],
        "reviewers": ["storyboard.reviewer"],
        "gate": "关键画面通过审查，落实彩色动画与角色配色一致",
        "on_fail": "",
        "requires": ["direction"],
    },
    {
        "id": "video",
        "label": "视频成片",
        "creators": ["video.generator"],
        "reviewers": ["video.reviewer"],
        "gate": "视频成片已生成并通过声音、对白与画面审查",
        "on_fail": "",
        "requires": ["storyboard"],
    },
]

LABELS = {stage["id"]: stage["label"] for stage in STAGES}
