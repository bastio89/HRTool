FROM python:3.13.1-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY backend_new/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend_new /app/backend_new

EXPOSE 8001

CMD ["uvicorn", "backend_new.main:app", "--host", "0.0.0.0", "--port", "8001"]
