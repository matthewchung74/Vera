FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for audio processing and health check
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy agent code, credentials, and audio files
COPY vera_agent.py .
COPY google-credentials.json .
COPY thinking-chime.mp3 .

# Run the agent
CMD ["python", "vera_agent.py", "start"]
