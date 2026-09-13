from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
for path in (REPO_ROOT,):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from graphrag.linkedin_profile_to_pdf import main


if __name__ == "__main__":
    raise SystemExit(main())