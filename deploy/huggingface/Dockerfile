# Hugging Face Docker Space: builds the app straight from GitHub and serves
# frontend + backend from one container on port 7860.
#
# Only this file and README.md go into the Space repo; the code (and its
# images, models and sounds) are cloned from GitHub at build time, because
# Hugging Face rejects binary files pushed without large-file storage.
# To deploy new commits: Space settings -> "Factory rebuild".

ARG REPO=https://github.com/MohamedTouaa/JutsuHandSigns.git
ARG BRANCH=feature/3d-jutsu-vfx

# ---- frontend build --------------------------------------------------------
FROM node:24-slim AS web
ARG REPO
ARG BRANCH
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$BRANCH" "$REPO" /src
WORKDIR /src/web
RUN npm ci && npm run build

# ---- runtime ---------------------------------------------------------------
FROM python:3.12-slim
# OpenCV / MediaPipe runtime libraries.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

# Spaces run the container as user 1000.
RUN useradd -m -u 1000 user
WORKDIR /home/user/app
COPY --from=web --chown=user /src/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=web --chown=user /src/backend .
COPY --from=web --chown=user /src/web/dist ./static

# The face model isn't in the repo; fetch it at build time.
RUN mkdir -p models && curl -fsSL -o models/face_landmarker.task \
    https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task \
    && chown -R user models

USER user
# Serve the built site, and never store visitors' face photos.
ENV STATIC_DIR=/home/user/app/static \
    SAVE_CAPTURES=0

EXPOSE 7860
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
