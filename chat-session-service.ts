// File: src/services/chatSessionService.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  UpdateCommand, 
  QueryCommand 
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

export interface ChatSession {
  sessionId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  conversationHistory: Array<{
    timestamp: string;
    message: string;
    response: any;
  }>;
  metadata: Record<string, any>;
}

export class ChatSessionService {
  private docClient: DynamoDBDocumentClient;
  private readonly tableName = 'ChatSessions';
  
  constructor() {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.docClient = DynamoDBDocumentClient.from(client);
  }
  
  /**
   * Create a new chat session
   */
  async createSession(userId: string = 'anonymous'): Promise<ChatSession> {
    const timestamp = new Date().toISOString();
    const sessionId = uuidv4();
    
    const session: ChatSession = {
      sessionId,
      userId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'CREATED',
      conversationHistory: [],
      metadata: {},
    };
    
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: session,
      })
    );
    
    return session;
  }
  
  /**
   * Get a chat session by ID
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { sessionId },
      })
    );
    
    return response.Item as ChatSession || null;
  }
  
  /**
   * Add a message and response to a chat session
   */
  async addMessageToSession(
    sessionId: string,
    message: string,
    response: any
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { sessionId },
        UpdateExpression: 'SET conversationHistory = list_append(conversationHistory, :message), updatedAt = :timestamp',
        ExpressionAttributeValues: {
          ':message': [{
            timestamp,
            message,
            response,
          }],
          ':timestamp': timestamp,
        },
      })
    );
  }
  
  /**
   * Update session metadata
   */
  async updateSessionMetadata(
    sessionId: string,
    metadata: Record<string, any>
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    
    // Create update expression dynamically based on metadata keys
    const updateExpressions = ['updatedAt = :timestamp'];
    const expressionAttributeValues: Record<string, any> = {
      ':timestamp': timestamp,
    };
    
    Object.entries(metadata).forEach(([key, value]) => {
      updateExpressions.push(`metadata.${key} = :${key}`);
      expressionAttributeValues[`:${key}`] = value;
    });
    
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { sessionId },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );
  }
  
  /**
   * Update session status
   */
  async updateSessionStatus(sessionId: string, status: string): Promise<void> {
    const timestamp = new Date().toISOString();
    
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { sessionId },
        UpdateExpression: 'SET status = :status, updatedAt = :timestamp',
        ExpressionAttributeValues: {
          ':status': status,
          ':timestamp': timestamp,
        },
      })
    );
  }
  
  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string): Promise<ChatSession[]> {
    const response = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'UserIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        ScanIndexForward: false, // Sort by most recent first
      })
    );
    
    return response.Items as ChatSession[] || [];
  }
  
  /**
   * Delete a chat session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.docClient.send({
      TableName: this.tableName,
      Key: { sessionId },
    });
  }
}
