// File: src/scripts/initialize-vector-store.js
const fs = require('fs');
const path = require('path');
const { Client } = require('@opensearch-project/opensearch');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('file', {
    alias: 'f',
    description: 'Path to field guide JSON file',
    type: 'string',
    demandOption: true
  })
  .help()
  .alias('help', 'h')
  .argv;

// Initialize OpenSearch client
const opensearchClient = new Client({
  node: process.env.OPENSEARCH_ENDPOINT || 'https://localhost:9200',
  auth: {
    username: process.env.OPENSEARCH_USERNAME || 'admin',
    password: process.env.OPENSEARCH_PASSWORD || 'admin',
  },
  ssl: {
    rejectUnauthorized: false, // Only for development
  }
});

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Constants
const INDEX_NAME = 'fieldguide';
const TABLE_METADATA_TABLE = process.env.DYNAMODB_TABLE_METADATA_TABLE || 'TableMetadata';
const FIELD_METADATA_TABLE = process.env.DYNAMODB_FIELD_METADATA_TABLE || 'FieldMetadata';

/**
 * Generate a simple embedding vector (this is a placeholder)
 * In a real application, you would call an embedding model API
 */
function generateEmbedding(text) {
  // Placeholder - generate a random vector of 1536 dimensions
  // In a real app, call an embedding model API
  return Array.from({ length: 1536 }, () => Math.random() * 2 - 1);
}

/**
 * Create or update the OpenSearch index
 */
async function createIndex() {
  try {
    const indexExists = await opensearchClient.indices.exists({ index: INDEX_NAME });
    
    if (indexExists.body) {
      console.log(`Index ${INDEX_NAME} already exists. Deleting...`);
      await opensearchClient.indices.delete({ index: INDEX_NAME });
    }
    
    console.log(`Creating index ${INDEX_NAME}...`);
    
    await opensearchClient.indices.create({
      index: INDEX_NAME,
      body: {
        mappings: {
          properties: {
            embeddingVector: {
              type: 'knn_vector',
              dimension: 1536,
              method: {
                name: 'hnsw',
                space_type: 'cosinesimil',
                engine: 'nmslib',
                parameters: {
                  ef_construction: 128,
                  m: 24
                }
              }
            },
            tableName: { type: 'keyword' },
            fieldName: { type: 'keyword' },
            description: { type: 'text' },
            dataType: { type: 'keyword' },
            possibleValues: { type: 'keyword' },
            relatedFields: { type: 'keyword' },
            searchText: { type: 'text' }
          }
        }
      }
    });
    
    console.log(`Index ${INDEX_NAME} created successfully.`);
  } catch (error) {
    console.error('Error creating index:', error);
    process.exit(1);
  }
}

/**
 * Process field guide data and insert into OpenSearch and DynamoDB
 */
async function processFieldGuideData(filePath) {
  try {
    console.log(`Reading field guide data from ${filePath}...`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Process tables
    const tables = {};
    for (const field of data) {
      if (!tables[field.tableName]) {
        tables[field.tableName] = {
          tableId: uuidv4(),
          tableName: field.tableName,
          description: field.tableDescription || `Table containing ${field.tableName} data`,
          dataSet: field.dataSet || 'Unknown',
          fields: []
        };
      }
      
      tables[field.tableName].fields.push(field.fieldName);
    }
    
    // Insert tables into DynamoDB
    console.log(`Inserting ${Object.keys(tables).length} tables into DynamoDB...`);
    for (const tableName in tables) {
      const table = tables[tableName];
      
      await docClient.send(new PutCommand({
        TableName: TABLE_METADATA_TABLE,
        Item: {
          ...table,
          searchText: `${table.tableName} ${table.description} ${table.dataSet}`,
          embeddingVector: generateEmbedding(`${table.tableName} ${table.description} ${table.dataSet}`)
        }
      }));
    }
    
    // Process and insert fields
    console.log(`Processing ${data.length} fields...`);
    const bulkOperations = [];
    
    for (const field of data) {
      const fieldId = uuidv4();
      const searchText = `${field.tableName} ${field.fieldName} ${field.description || ''} ${(field.possibleValues || []).join(' ')}`;
      const embeddingVector = generateEmbedding(searchText);
      
      // Prepare OpenSearch document
      bulkOperations.push(
        { index: { _index: INDEX_NAME, _id: fieldId } },
        {
          fieldId,
          tableName: field.tableName,
          fieldName: field.fieldName,
          description: field.description || '',
          dataType: field.dataType || 'string',
          possibleValues: field.possibleValues || [],
          relatedFields: field.relatedFields || [],
          embeddingVector,
          searchText
        }
      );
      
      // Insert field into DynamoDB
      await docClient.send(new PutCommand({
        TableName: FIELD_METADATA_TABLE,
        Item: {
          fieldId,
          tableName: field.tableName,
          fieldName: field.fieldName,
          description: field.description || '',
          dataType: field.dataType || 'string',
          possibleValues: field.possibleValues || [],
          relatedFields: field.relatedFields || [],
          embeddingVector
        }
      }));
    }
    
    // Bulk insert into OpenSearch
    console.log(`Bulk inserting ${data.length} fields into OpenSearch...`);
    const response = await opensearchClient.bulk({ body: bulkOperations });
    
    if (response.body.errors) {
      console.error('Errors occurred during bulk insert:', response.body.items);
      process.exit(1);
    }
    
    console.log(`Successfully processed ${data.length} fields.`);
  } catch (error) {
    console.error('Error processing field guide data:', error);
    process.exit(1);
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('Starting vector store initialization...');
    
    // Create or update the index
    await createIndex();
    
    // Process field guide data
    await processFieldGuideData(argv.file);
    
    console.log('Vector store initialization completed successfully.');
  } catch (error) {
    console.error('Error initializing vector store:', error);
    process.exit(1);
  }
}

// Run the main function
main();
