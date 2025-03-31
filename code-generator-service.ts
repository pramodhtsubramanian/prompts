// File: src/services/codeGeneratorService.ts
import { ClaudeService } from './claudeService';
import { CSVDataService } from './csvDataService';
import { NodeVM } from 'vm2';
import { PythonShell } from 'python-shell';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);

export class CodeGeneratorService {
  private llm: ClaudeService;
  private csvData: CSVDataService;
  private tmpDir: string;
  
  constructor() {
    this.llm = new ClaudeService();
    this.csvData = new CSVDataService();
    this.tmpDir = process.env.TMP_DIR || path.join(__dirname, '../../tmp');
    
    // Ensure tmp directory exists
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }
  }
  
  /**
   * Generate transformation code based on the user's request
   */
  async generateTransformationCode(
    conversationHistory: any[],
    samples: any[],
    tables: string[]
  ): Promise<any> {
    // Extract the intent and operation from conversation history
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    const intent = lastMessage.response.intentAnalysis;
    
    // Get table schemas
    const schemas = await Promise.all(
      tables.map(async (tableName) => {
        const sample = samples.find(s => s.tableName === tableName);
        if (!sample || !sample.data || sample.data.length === 0) {
          return { tableName, columns: {} };
        }
        
        // Infer schema from sample data
        const columns = this.inferSchema(sample.data);
        
        return {
          tableName,
          columns
        };
      })
    );
    
    // Generate code using the LLM
    const result = await this.llm.generateFunctions(
      intent.operation,
      schemas,
      samples.map(sample => ({
        tableName: sample.tableName,
        data: sample.data
      }))
    );
    
    return {
      ...result,
      schemas,
      samples,
    };
  }
  
  /**
   * Apply the generated transformation to sample data
   */
  async applySampleTransformation(code: any, samples: any[]): Promise<any> {
    const results = [];
    
    for (const sample of samples) {
      // Apply JavaScript transformation to sample
      try {
        const jsResult = await this.executeJavaScript(code.javascriptCode, sample.data);
        
        results.push({
          tableName: sample.tableName,
          original: sample.data,
          transformed: jsResult.data,
          changes: jsResult.changes,
        });
      } catch (error) {
        console.error(`Error applying JavaScript transformation to ${sample.tableName}:`, error);
        results.push({
          tableName: sample.tableName,
          error: error.message,
          original: sample.data,
          transformed: sample.data,
          changes: 0,
        });
      }
    }
    
    return results;
  }
  
  /**
   * Apply the transformation to the full dataset
   */
  async applyFullTransformation(code: any, data: any[], tableName: string): Promise<any> {
    // For full dataset, use JavaScript transformation for performance
    try {
      return await this.executeJavaScript(code.javascriptCode, data);
    } catch (error) {
      console.error(`Error applying JavaScript transformation to ${tableName}:`, error);
      throw new Error(`Failed to transform data: ${error.message}`);
    }
  }
  
  /**
   * Execute JavaScript code safely using VM2
   */
  private async executeJavaScript(code: string, data: any[]): Promise<any> {
    // Wrap the provided code in a function that counts changes
    const wrappedCode = `
      ${code}
      
      function processData(inputData) {
        // Clone the input data to avoid modifying it directly
        const original = JSON.parse(JSON.stringify(inputData));
        
        // Apply the transformation
        const transformed = updateEntityLocation(inputData);
        
        // Count changes
        let changes = 0;
        for (let i = 0; i < original.length; i++) {
          const origRecord = JSON.stringify(original[i]);
          const transRecord = JSON.stringify(transformed[i]);
          if (origRecord !== transRecord) {
            changes++;
          }
        }
        
        return {
          data: transformed,
          changes
        };
      }
      
      processData(${JSON.stringify(data)});
    `;
    
    // Create a secure VM
    const vm = new NodeVM({
      console: 'inherit',
      sandbox: {},
      timeout: 5000,
      require: {
        external: false,
        builtin: ['util'],
        root: "./",
        mock: {
          fs: {
            readFileSync: () => { throw new Error('No file access allowed'); }
          }
        }
      }
    });
    
    // Execute the code
    return vm.run(wrappedCode);
  }
  
  /**
   * Execute Python code using PythonShell
   */
  private async executePython(code: string, data: any[]): Promise<any> {
    // Create temporary files for input and output
    const timestamp = Date.now();
    const inputFile = path.join(this.tmpDir, `input_${timestamp}.json`);
    const outputFile = path.join(this.tmpDir, `output_${timestamp}.json`);
    const scriptFile = path.join(this.tmpDir, `script_${timestamp}.py`);
    
    try {
      // Write the input data to a file
      await writeFileAsync(inputFile, JSON.stringify(data), 'utf8');
      
      // Wrap the provided code in a script that reads from input file and writes to output file
      const wrappedCode = `
import json
import copy

# Load input data
with open('${inputFile.replace(/\\/g, '\\\\')}', 'r') as f:
    input_data = json.load(f)

# Make a deep copy of the input for comparison
original_data = copy.deepcopy(input_data)

${code}

# Apply the transformation
transformed_data = update_entity_location(input_data)

# Count changes
changes = 0
for i in range(len(original_data)):
    if json.dumps(original_data[i]) != json.dumps(transformed_data[i]):
        changes += 1

# Write output
with open('${outputFile.replace(/\\/g, '\\\\')}', 'w') as f:
    json.dump({
        'data': transformed_data,
        'changes': changes
    }, f)
      `;
      
      // Write the script to a file
      await writeFileAsync(scriptFile, wrappedCode, 'utf8');
      
      // Execute the script
      await new Promise<void>((resolve, reject) => {
        PythonShell.run(scriptFile, {}, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      // Read the output
      const output = JSON.parse(fs.readFileSync(