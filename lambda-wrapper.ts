// File: src/lambda.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import serverless from 'serverless-http';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import session from './routes/session';
import agent from './routes/agent';
import datastore from './routes/datastore';

// Initialize Express app
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
export const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Routes
app.use('/api/session', session);
app.use('/api/agent', agent);
app.use('/api/datastore', datastore);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create serverless handler
const handler = serverless(app);

// Lambda handler
export const main = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  // Run the serverless handler
  return await handler(event, context);
};
