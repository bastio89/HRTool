# Fast CV and Job Parser

The parsing implementation is exposed as a FastAPI router. The host owns model startup and stores the loaded parser at `app.state.cv_job_parser`:

```python
from fast_cvjob_parsing.app.router import create_cv_job_parser_router

app.include_router(create_cv_job_parser_router())
```

The router exposes `POST /api/v1/parse/cv` and `POST /api/v1/parse/job`, each accepting a multipart PDF field named `file`. The standalone ASGI app in `app/main.py` uses the same router and owns its model lifecycle; the package Dockerfile can therefore run it separately.

## Tests

From the `graphrag` directory, install the lightweight test dependencies and run only this package's tests:

```sh
python -m pip install -r fast_cvjob_parsing/requirements-test.txt
python -m pytest -q fast_cvjob_parsing/tests
```

These tests inject a fake parser and do not download or load GLiNER or Torch. The standalone service dependencies remain in `requirements.txt`.