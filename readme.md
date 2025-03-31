# HR Data Correction Agent

An AI-powered chat interface for HR data corrections, supporting data movement and transformation across multiple HR payroll and position datasets.

## Architecture Overview

The HR Data Correction Agent is built with the following components:

- **Frontend**: React with TypeScript, providing a chat interface and data preview capabilities
- **Backend**: Express.js API running on Node.js with TypeScript
- **AI Components**: Claude 3.7 Sonnet for understanding queries and generating transformation code
- **Vector Store**: OpenSearch for semantic search of table and field metadata
- **Storage**: DynamoDB for session and metadata storage, S3 for CSV data files
- **Deployment**: AWS Lambda, API Gateway, S3, CloudFront (via Serverless Framework)

## Features

- Chat-based interface for data corrections
- AI-powered understanding of user intent
- Automatic identification of relevant tables and columns
- Preview of data transformations before applying changes
- Code generation for data transformations (JavaScript and Python)
- Backup of data before modifications
- Session management for tracking corrections

## Project Structure

```
project-root/
├── src/                    # Backend source code
│   ├── index.ts            # Entry point
│   ├── routes/             # API routes
│   ├── services/           # Business logic
│   ├── models/             # Data models
│   └── lambda.ts           # Lambda wrapper for serverless
├── frontend/               # Frontend React application
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── contexts/       # React contexts
│   │   ├── services/       # API services
│   │   └── App.tsx         # Main application
├── data/                   # CSV data files
│   ├── worker_data/
│   ├── position_data/
│   ├── payroll_data/
│   ├── company_data/
│   └── payroll_setup/
├── tmp/                    # Temporary files (not versioned)
├── dist/                   # Compiled backend code
├── node_modules/           # Backend dependencies
├── serverless.yml          # Serverless Framework configuration
└── package.json            # Backend package configuration
```

## Prerequisites

- Node.js 16+
- npm or yarn
- AWS CLI configured with appropriate credentials (for deployment)
- OpenSearch instance or AWS OpenSearch Service
- DynamoDB tables or local DynamoDB
- S3 buckets for data storage

## Setup and Installation

### Backend Setup

1. Clone the repository
```bash
git clone https://github.com/your-repo/hr-data-correction-agent.git
cd hr-data-correction-agent
```

2. Install dependencies
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```
PORT=3000
AWS_REGION=us-east-1
ANTHROPIC_API_KEY=your_anthropic_api_key
OPENSEARCH_ENDPOINT=https://localhost:9200
OPENSEARCH_USERNAME=admin
OPENSEARCH_PASSWORD=admin
DATA_ROOT_PATH=./data
TMP_DIR=./tmp
```

4. Create the necessary directories for data and temporary files:
```bash
mkdir -p tmp
mkdir -p data/worker_data
mkdir -p data/position_data
mkdir -p data/payroll_data
mkdir -p data/company_data
mkdir -p data/payroll_setup
```

5. Build the backend
```bash
npm run build
```

### Frontend Setup

1. Navigate to the frontend directory
```bash
cd frontend
```

2. Install dependencies
```bash
npm install
```

3. Create a `.env` file in the frontend directory:
```
REACT_APP_API_BASE_URL=http://localhost:3000/api
```

## Running the Application Locally

### Start the Backend

```bash
# In the root directory
npm run dev
```

### Start the Frontend

```bash
# In the frontend directory
npm start
```

The frontend will be available at `http://localhost:3000` and the backend API at `http://localhost:3000/api`.

## Deploying to AWS

The application can be deployed to AWS using the Serverless Framework:

```bash
# Install Serverless Framework globally if not already installed
npm install -g serverless

# Deploy backend
serverless deploy --stage prod --region us-east-1

# Build the frontend
cd frontend
npm run build

# Deploy frontend to S3
aws s3 sync build/ s3://hr-data-correction-agent-prod-frontend
```

## Vector Store Initialization

Before using the application, you need to initialize the vector store with the field guide data:

1. Prepare a JSON file with the field guide data
2. Run the initialization script:
```bash
node dist/scripts/initialize-vector-store.js --file=/path/to/field-guide.json
```

## Example Usage

1. Start a new chat session
2. Ask for a data correction, e.g., "Move all associates in Legal Entity ABC to office Location NYC"
3. Confirm the identified tables and columns
4. Review the preview of data changes
5. Apply the transformation

## Development Guidelines

- Use TypeScript for type safety
- Follow the existing code structure
- Write unit tests for all business logic
- Use descriptive commit messages
- Document all API endpoints and services

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Anthropic](https://www.anthropic.com/) for the Claude API
- [OpenSearch](https://opensearch.org/) for vector search capabilities
- [Serverless Framework](https://www.serverless.com/) for AWS deployment
