"""SAM 2 adapter. Not constructed when CV_BACKEND=mock.

Importing this module does not import torch and does not download weights.
Local and CI never set CV_BACKEND=sam2.
"""

from __future__ import annotations


class Sam2Segmenter:
    def __init__(self) -> None:
        raise RuntimeError(
            "SAM 2 is not available in this process. "
            "CV_BACKEND=mock is the local and CI backend. No model is downloaded."
        )
