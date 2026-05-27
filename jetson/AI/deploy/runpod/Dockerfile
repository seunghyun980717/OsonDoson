FROM pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV LKS_PROFILE=runpod
ENV PYTHONPATH=/workspace/LKS

WORKDIR /workspace/LKS

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-runtime.txt requirements-runtime.txt
COPY requirements-runtime-llm.txt requirements-runtime-llm.txt
COPY requirements-mvp.txt requirements-mvp.txt

RUN pip install --no-cache-dir -r requirements-mvp.txt

COPY app app
COPY core core
COPY runtime runtime
COPY data/derived data/derived
COPY .gitignore .gitignore

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

