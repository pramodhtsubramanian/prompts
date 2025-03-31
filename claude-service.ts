// File: src/services/claudeService.ts
import { AnthropicClient } from './anthropic'; // This would be imported from the Anthropic SDK
import { PromptTemplate } from './promptTemplate';

export class ClaudeService {
  private client: AnthropicClient;
  private promptTemplates: Record<string, PromptTemplate>;
  
  constructor() {
    this.client = new AnthropicClient({
      apiKey: process.env.ANTHROPIC_API_KEY || '',
    });
    
    // Initialize prompt templates
    this.promptTemplates = {
      intentAnalysis: new PromptTemplate(`
You are a data analysis expert helping with HR and payroll data corrections.
Analyze the following user request and identify:
1. The primary intent (e.g., move data, update values, delete records)
2. The specific entities mentioned (like tables, columns, values)
3. The conditions or criteria for the operation
4. Any specific business concepts mentioned

User request: {{message}}

Previous conversation context:
{{conversationHistory}}

Provide your analysis in JSON format with the following structure:
{
  "intent": string,
  "operation": string,
  "entities": [{ "type": string, "text": string, "role": string }],
  "conditions": [{ "field": string, "operator": string, "value": string }],
  "concepts": [string],
  "confidence": number
}
      `),
      
      tableConfirmation: new PromptTemplate(`
You are a data analysis expert helping with HR and payroll data corrections.
The user wants to perform the following operation:

{{intent}}

We've identified these potential tables and columns that might be relevant:
{{tableInfo}}

Based on your knowledge of HR and payroll data, which tables and columns would you most likely need to modify to fulfill this request?

Respond in JSON format:
{
  "relevantTables": [
    {
      "tableName": string,
      "reason": string,
      "columns": [
        {
          "columnName": string,
          "role": "source" | "target" | "condition"
        }
      ]
    }
  ],
  "explanation": string
}
      `),
      
      functionGeneration: new PromptTemplate(`
You are a data transformation expert. Generate both Python and JavaScript functions to perform the following data operation:

Operation: {{operation}}

The data is structured as follows:
{{tableSchema}}

Sample data:
{{sampleData}}

Create functions that perform the requested transformation. Include appropriate error handling and validation.

Respond with:
1. A Python function to perform the transformation
2. A JavaScript function to perform the same transformation
3. An explanation of how the functions work and what they're doing
      `),
    };
  }
  
  /**
   * Analyze the user's intent from their message
   */
  async analyzeIntent(message: string, conversationHistory: any[] = []): Promise<any> {
    const formattedHistory = this.formatConversationHistory(conversationHistory);
    
    const prompt = this.promptTemplates.intentAnalysis.format({
      message,
      conversationHistory: formattedHistory,
    });
    
    const response = await this.client.create({
      model: 'claude-3-7-sonnet-20250219',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
    });
    
    // Extract and parse the JSON response
    const content = response.content[0].text;
    try {
      // Find JSON in the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('No JSON found in response');
    } catch (error) {
      console.error('Failed to parse intent analysis response:', error);
      throw new Error('Failed to analyze intent');
    }
  }
  
  /**
   * Confirm table and column selection
   */
  async confirmTableSelection(intent: any, tableInfo: any[]): Promise<any> {
    const formattedTableInfo = tableInfo.map(table => {
      return `Table: ${table.tableName}
Description: ${table.description}
Fields: ${table.fields.map(f => f.fieldName).join(', ')}
Dataset: ${table.dataSet}
`;
    }).join('\n');
    
    const prompt = this.promptTemplates.tableConfirmation.format({
      intent: JSON.stringify(intent, null, 2),
      tableInfo: formattedTableInfo,
    });
    
    const response = await this.client.create({
      model: 'claude-3-7-sonnet-20250219',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
    });
    
    // Extract and parse the JSON response
    const content = response.content[0].text;
    try {
      // Find JSON in the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('No JSON found in response');
    } catch (error) {
      console.error('Failed to parse table confirmation response:', error);
      throw new Error('Failed to confirm table selection');
    }
  }
  
  /**
   * Generate transformation functions for the data operation
   */
  async generateFunctions(operation: string, tableSchema: any[], sampleData: any[]): Promise<any> {
    const formattedSchema = tableSchema.map(table => {
      return `Table: ${table.tableName}
Columns: ${Object.keys(table.columns).map(col => `${col} (${table.columns[col]})`).join(', ')}
`;
    }).join('\n');
    
    const formattedSampleData = sampleData.map(table => {
      return `Table: ${table.tableName}
Sample Data (first 3 rows):
${JSON.stringify(table.data.slice(0, 3), null, 2)}
`;
    }).join('\n');
    
    const prompt = this.promptTemplates.functionGeneration.format({
      operation,
      tableSchema: formattedSchema,
      sampleData: formattedSampleData,
    });
    
    const response = await this.client.create({
      model: 'claude-3-7-sonnet-20250219',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
    });
    
    // Extract the Python and JavaScript code from the response
    const content = response.content[0].text;
    
    // Extract Python code
    const pythonMatch = content.match(/```python([\s\S]*?)```/);
    const pythonCode = pythonMatch ? pythonMatch[1].trim() : '';
    
    // Extract JavaScript code
    const jsMatch = content.match(/```javascript([\s\S]*?)```/) || content.match(/```js([\s\S]*?)```/);
    const jsCode = jsMatch ? jsMatch[1].trim() : '';
    
    // Extract explanation (text after the code blocks)
    let explanation = '';
    const lastCodeBlock = content.lastIndexOf('```');
    if (lastCodeBlock !== -1) {
      explanation = content.substring(lastCodeBlock + 3).trim();
    }
    
    return {
      pythonCode,
      javascriptCode: jsCode,
      explanation,
    };
  }
  
  /**
   * Format conversation history for inclusion in prompts
   */
  private formatConversationHistory(history: any[]): string {
    if (!history || history.length === 0) {
      return 'No previous conversation.';
    }
    
    return history.map((entry, index) => {
      return `Message ${index + 1}:
User: ${entry.message}
Response: ${typeof entry.response === 'string' ? entry.response : JSON.stringify(entry.response)}
`;
    }).join('\n');
  }
}

// Simple prompt template class (would normally be in a separate file)
export class PromptTemplate {
  private template: string;
  
  constructor(template: string) {
    this.template = template;
  }
  
  format(variables: Record<string, string>): string {
    let result = this.template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return result;
  }
}
