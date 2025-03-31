// File: src/services/vectorStoreService.ts
import { Client } from '@opensearch-project/opensearch';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

export class VectorStoreService {
  private client: Client;
  private dynamoClient: DynamoDBDocumentClient;
  private readonly INDEX_NAME = 'fieldguide';
  
  constructor() {
    // Initialize OpenSearch client
    this.client = new Client({
      node: process.env.OPENSEARCH_ENDPOINT || 'https://localhost:9200',
      auth: {
        username: process.env.OPENSEARCH_USERNAME || 'admin',
        password: process.env.OPENSEARCH_PASSWORD || 'admin',
      },
      ssl: {
        rejectUnauthorized: false, // Only for development
      }
    });
    
    // Initialize DynamoDB client for metadata
    const dbClient = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.dynamoClient = DynamoDBDocumentClient.from(dbClient);
  }
  
  /**
   * Find tables and columns that are relevant to the user's query
   */
  async findRelevantTablesAndColumns(concepts: string[], entities: any[]): Promise<any[]> {
    // Generate embeddings for the concepts and entities
    // This would typically involve calling an embedding model API
    const embeddings = await this.generateEmbeddings([...concepts, ...entities.map(e => e.text)]);
    
    // Search for relevant fields in the vector store
    const fields = await this.searchVectorIndex(embeddings);
    
    // Group fields by table
    const tableToFields = fields.reduce((acc, field) => {
      if (!acc[field.tableName]) {
        acc[field.tableName] = [];
      }
      acc[field.tableName].push(field);
      return acc;
    }, {});
    
    // Get table metadata for each table
    const tables = await Promise.all(
      Object.keys(tableToFields).map(async (tableName) => {
        const tableMetadata = await this.getTableMetadata(tableName);
        return {
          tableName,
          description: tableMetadata.description,
          dataSet: tableMetadata.dataSet,
          fields: tableToFields[tableName],
          score: this.calculateTableRelevanceScore(tableToFields[tableName], tableMetadata, concepts, entities),
        };
      })
    );
    
    // Sort tables by relevance score
    return tables.sort((a, b) => b.score - a.score);
  }
  
  /**
   * Generate embeddings for search terms
   * In a real implementation, this would call an embedding model
   */
  private async generateEmbeddings(terms: string[]): Promise<number[][]> {
    // Placeholder - in a real implementation, this would call an embedding model API
    // For now, return dummy embeddings
    return terms.map(_ => Array.from({ length: 1536 }, () => Math.random()));
  }
  
  /**
   * Search the vector index for relevant fields
   */
  private async searchVectorIndex(embeddings: number[][]): Promise<any[]> {
    // Combine embeddings by averaging them
    const combinedEmbedding = this.averageEmbeddings(embeddings);
    
    // Perform the vector search
    const response = await this.client.search({
      index: this.INDEX_NAME,
      body: {
        query: {
          script_score: {
            query: { match_all: {} },
            script: {
              source: "cosineSimilarity(params.query_vector, 'embeddingVector') + 1.0",
              params: { query_vector: combinedEmbedding }
            }
          }
        },
        size: 20
      }
    });
    
    // Extract and return the results
    return response.body.hits.hits.map(hit => ({
      id: hit._id,
      score: hit._score,
      ...hit._source
    }));
  }
  
  /**
   * Average multiple embeddings into a single vector
   */
  private averageEmbeddings(embeddings: number[][]): number[] {
    const length = embeddings[0].length;
    const result = new Array(length).fill(0);
    
    for (const embedding of embeddings) {
      for (let i = 0; i < length; i++) {
        result[i] += embedding[i];
      }
    }
    
    for (let i = 0; i < length; i++) {
      result[i] /= embeddings.length;
    }
    
    return result;
  }
  
  /**
   * Get metadata for a table from DynamoDB
   */
  private async getTableMetadata(tableName: string): Promise<any> {
    const command = new GetCommand({
      TableName: 'TableMetadata',
      Key: {
        tableName,
      }
    });
    
    const response = await this.dynamoClient.send(command);
    return response.Item;
  }
  
  /**
   * Calculate a relevance score for a table based on its fields and metadata
   */
  private calculateTableRelevanceScore(fields: any[], tableMetadata: any, concepts: string[], entities: any[]): number {
    // Implement a scoring algorithm based on various signals
    // This is a simplified version
    const fieldsScore = fields.reduce((sum, field) => sum + field.score, 0);
    
    // Check if any entities match the table name or description
    const entityMatch = entities.some(entity => 
      tableMetadata.tableName.toLowerCase().includes(entity.text.toLowerCase()) || 
      tableMetadata.description.toLowerCase().includes(entity.text.toLowerCase())
    );
    
    // Check if any concepts match the table's domain or usage
    const conceptMatch = concepts.some(concept =>
      tableMetadata.domain?.includes(concept) ||
      tableMetadata.usage?.includes(concept)
    );
    
    // Combine scores with weights
    return fieldsScore * 0.5 + (entityMatch ? 1.0 : 0) + (conceptMatch ? 1.5 : 0);
  }
  
  /**
   * Initialize the vector store with field guide data
   */
  async initializeVectorStore(fieldGuideData: any[]): Promise<void> {
    // Generate embeddings for all field guides
    const embeddings = await Promise.all(
      fieldGuideData.map(async field => {
        const searchText = `${field.tableName} ${field.fieldName} ${field.description} ${field.possibleValues?.join(' ') || ''}`;
        const embedding = await this.generateEmbeddings([searchText]);
        return {
          ...field,
          embeddingVector: embedding[0],
          id: uuidv4(),
        };
      })
    );
    
    // Bulk index the embeddings
    const body = embeddings.flatMap(doc => [
      { index: { _index: this.INDEX_NAME, _id: doc.id } },
      doc
    ]);
    
    await this.client.bulk({ body });
    console.log(`Indexed ${embeddings.length} field guide entries to vector store`);
  }
}
