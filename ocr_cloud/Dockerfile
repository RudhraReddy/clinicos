FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download PaddleOCR models at build time so they are baked into the image.
# This avoids a 30-60s cold-start download on first request.
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(lang='en'); print('OCR models ready')"

COPY ocr_service.py .
COPY main.py .

CMD exec gunicorn --bind 0.0.0.0:$PORT --workers 1 --timeout 120 main:app
