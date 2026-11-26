"""Stable error codes. The API maps these to client text and never stores a traceback."""


class IngestError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code
