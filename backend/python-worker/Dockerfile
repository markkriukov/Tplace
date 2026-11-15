FROM python:3.14-slim AS build

# TgCrypto has no wheel for this Python, so it compiles here; the compiler
# stays in this stage instead of the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt ./
RUN --mount=type=bind,from=build,source=/wheels,target=/wheels \
    pip install --no-cache-dir --no-index --find-links /wheels -r requirements.txt

COPY . .

CMD ["python", "worker.py"]
