# CV and Job Description Parser

The package exposes a reusable FastAPI router and a small standalone app for container deployment. The router expects a parser instance at `app.state.cv_job_parser`.

Run the package tests independently from this directory:

```sh
python3 -m pytest tests
```

Start the standalone container with `./start.sh`. The API provides `POST /api/v1/fast-parse/cv`, `POST /api/v1/fast-parse/job`, and `GET /healthz`.