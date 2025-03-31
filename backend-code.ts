// File: src/index.ts
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import session from './routes/session';
import agent from './routes/agent';
import datastore from './routes/datastore';

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

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

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// File: src/routes/agent.ts
import { Router } from 'express';
import { DataCorrectionAgent } from '../services/dataCorrectionAgent';
import { ChatSessionService } from '../services/chatSessionService';

const router = Router();
const chatSessionService = new ChatSessionService();
const dataCorrectionAgent = new DataCorrectionAgent();

// Process a new message in a chat session
router.post('/message', async (req, res) => {
  const { sessionId, message } = req.body;
  
  try {
    // Get or create session
    let session;
    if (sessionId) {
      session = await chatSessionService.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
    } else {
      session = await chatSessionService.createSession();
    }
    
    // Process message with the agent
    const response = await dataCorrectionAgent.processMessage(session, message);
    
    // Update the session with the new message and response
    await chatSessionService.addMessageToSession(session.sessionId, message, response);
    
    return res.json({
      sessionId: session.sessionId,
      response,
    });
  } catch (error) {
    console.error('Error processing message:', error);
    return res.status(500).json({ error: 'Failed to process message' });
  }
});

// Confirm the table and column selection
router.post('/confirm-selection', async (req, res) => {
  const { sessionId, confirmed, tables } = req.body;
  
  try {
    const session = await chatSessionService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const response = await dataCorrectionAgent.confirmTableSelection(session, confirmed, tables);
    
    await chatSessionService.updateSessionMetadata(sessionId, {
      confirmedTables: tables,
      status: 'TABLE_CONFIRMED',
    });
    
    return res.json({
      sessionId,
      response,
    });
  } catch (error) {
    console.error('Error confirming selection:', error);
    return res.status(500).json({ error: 'Failed to confirm selection' });
  }
});

// Generate and apply a transformation
router.post('/apply-transformation', async (req, res) => {
  const { sessionId, apply } = req.body;
  
  try {
    const session = await chatSessionService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const result = await dataCorrectionAgent.applyTransformation(session, apply);
    
    await chatSessionService.updateSessionMetadata(sessionId, {
      status: apply ? 'TRANSFORMATION_APPLIED' : 'TRANSFORMATION_REJECTED',
      transformationResult: result,
    });
    
    return res.json({
      sessionId,
      result,
    });
  } catch (error) {
    console.error('Error applying transformation:', error);
    return res.status(500).json({ error: 'Failed to apply transformation' });
  }
});

export default router;

// File: src/services/dataCorrectionAgent.ts
import { ChatSession } from '../models/ChatSession';
import { VectorStoreService } from './vectorStoreService';
import { CSVDataService } from './csvDataService';
import { ClaudeService } from './claudeService';
import { CodeGeneratorService } from './codeGeneratorService';

export class DataCorrectionAgent {
  private vectorStore: VectorStoreService;
  private csvData: CSVDataService;
  private llm: ClaudeService;
  private codeGenerator: CodeGeneratorService;

  constructor() {
    this.vectorStore = new VectorStoreService();
    this.csvData = new CSVDataService();
    this.llm = new ClaudeService();
    this.codeGenerator = new CodeGeneratorService();
  }

  async processMessage(session: ChatSession, message: string): Promise<any> {
    // Extract session history to provide context
    const history = session.conversationHistory || [];
    
    // Analyze user intent using Claude
    const intentAnalysis = await this.llm.analyzeIntent(message, history);
    
    // Search for relevant tables and columns using the vector store
    const relevantTablesColumns = await this.vectorStore.findRelevantTablesAndColumns(
      intentAnalysis.concepts,
      intentAnalysis.entities
    );
    
    // Construct a response with the identified tables and columns
    const response = {
      message: this.constructResponseMessage(intentAnalysis, relevantTablesColumns),
      intentAnalysis,
      relevantTablesColumns,
      requiresConfirmation: true,
    };
    
    return response;
  }
  
  private constructResponseMessage(intentAnalysis: any, relevantTablesColumns: any[]): string {
    // Build a natural language response based on the intent and identified tables
    // This would be more complex in a real implementation
    return `I understand you want to ${intentAnalysis.intent}. I found these relevant tables: ${
      relevantTablesColumns.map(item => item.tableName).join(', ')
    }. Is this correct?`;
  }
  
  async confirmTableSelection(session: ChatSession, confirmed: boolean, tables: string[]): Promise<any> {
    if (!confirmed) {
      return {
        message: "Let me try again. Could you provide more details about the data you want to modify?",
        status: "SELECTION_REJECTED",
      };
    }
    
    // Read sample data from the confirmed tables
    const samplesPromises = tables.map(tableName => this.csvData.readSample(tableName, 5));
    const samples = await Promise.all(samplesPromises);
    
    // Generate transformation code based on the session history and samples
    const code = await this.codeGenerator.generateTransformationCode(
      session.conversationHistory, 
      samples,
      tables
    );
    
    // Apply the generated code to sample data to preview the transformation
    const transformedSamples = await this.codeGenerator.applySampleTransformation(code, samples);
    
    return {
      message: "I've generated the transformation code and applied it to a sample of your data. Please review and confirm.",
      status: "TRANSFORMATION_READY",
      code,
      originalSamples: samples,
      transformedSamples,
    };
  }
  
  async applyTransformation(session: ChatSession, apply: boolean): Promise<any> {
    if (!apply) {
      return {
        message: "Transformation cancelled. How else can I help you?",
        status: "CANCELLED",
      };
    }
    
    // Get the code and tables from session metadata
    const code = session.metadata.generatedCode;
    const tables = session.metadata.confirmedTables;
    
    // Apply the transformation to the full dataset
    const results = await Promise.all(
      tables.map(async (table) => {
        const data = await this.csvData.readFullTable(table);
        const transformed = await this.codeGenerator.applyFullTransformation(code, data, table);
        await this.csvData.writeTable(table, transformed);
        return {
          table,
          recordsProcessed: data.length,
          recordsChanged: transformed.changes,
        };
      })
    );
    
    return {
      message: `Transformation applied successfully to ${results.reduce((sum, r) => sum + r.recordsChanged, 0)} records.`,
      status: "COMPLETED",
      results,
    };
  }
}

// File: src/services/vectorStoreService.