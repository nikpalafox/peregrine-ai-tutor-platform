# API Keys
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Application Settings
APP_NAME=Peregrine AI Tutor
APP_VERSION=1.0.0
DEBUG=True
HOST=0.0.0.0
PORT=8000

# CORS Settings
ALLOWED_ORIGINS=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8080"]

# Database (for future use)
DATABASE_URL=postgresql://username:password@localhost:5432/peregrine_db
TEST_DATABASE_URL=postgresql://username:password@localhost:5432/peregrine_test_db

# Redis (for caching, optional)
REDIS_URL=redis://localhost:6379/0

# AI Model Settings
DEFAULT_MODEL=gpt-3.5-turbo
MAX_TOKENS=500
TEMPERATURE=0.7

# Rate Limiting
RATE_LIMIT_PER_MINUTE=60

# Logging
LOG_LEVEL=INFO
LOG_FORMAT=json

# Security
SECRET_KEY=your_secret_key_here_generate_a_strong_one
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# Email Settings (for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_email@gmail.com
SMTP_PASSWORD=your_email_password

# File Storage (if using cloud storage)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_BUCKET_NAME=your_s3_bucket_name
AWS_REGION=us-east-1