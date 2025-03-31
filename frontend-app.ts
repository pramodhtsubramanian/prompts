// File: frontend/src/App.tsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import ChatInterface from './components/ChatInterface';
import DataPreview from './components/DataPreview';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import { SessionProvider } from './contexts/SessionContext';
import './App.css';

const App: React.FC = () => {
  return (
    <SessionProvider>
      <Router>
        <div className="app-container">
          <Header />
          <div className="main-content">
            <Sidebar />
            <div className="content-area">
              <Routes>
                <Route path="/" element={<ChatInterface />} />
                <Route path="/preview" element={<DataPreview />} />
              </Routes>
            </div>
          </div>
        </div>
      </Router>
    </SessionProvider>
  );
};

export default App;

// File: frontend/src/components/ChatInterface.tsx
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../contexts/SessionContext';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import ConfirmationDialog from './ConfirmationDialog';
import './ChatInterface.css';
import { sendMessage, confirmSelection, applyTransformation } from '../services/api';

const ChatInterface: React.FC = () => {
  const { 
    sessionId, 
    setSessionId, 
    messages, 
    setMessages, 
    loading, 
    setLoading 
  } = useSession();
  
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationData, setConfirmationData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  
  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);
  
  const handleSendMessage = async (message: string) => {
    if (!message.trim()) return;
    
    setError(null);
    setLoading(true);
    
    try {
      // Add user message immediately
      const newMessages = [...messages, { sender: 'user', content: message }];
      setMessages(newMessages);
      
      // Send message to API
      const response = await sendMessage(sessionId, message);
      
      // Update session ID if needed
      if (response.sessionId && !sessionId) {
        setSessionId(response.sessionId);
      }
      
      // Add response message
      setMessages([...newMessages, { sender: 'bot', content: response.response }]);
      
      // Check if confirmation is required
      if (response.response.requiresConfirmation) {
        setConfirmationData(response.response);
        setShowConfirmation(true);
      }
      
      // Check if data preview is available
      if (response.response.status === 'TRANSFORMATION_READY') {
        // Navigate to preview page
        navigate('/preview', { state: { 
          preview: response.response.transformedSamples,
          code: response.response.code
        }});
      }
    } catch (err) {
      setError('Failed to send message. Please try again.');
      console.error('Error sending message:', err);
    } finally {
      setLoading(false);
    }
  };
  
  const handleConfirmSelection = async (confirmed: boolean, tables?: string[]) => {
    setShowConfirmation(false);
    setLoading(true);
    
    try {
      const response = await confirmSelection(sessionId, confirmed, tables);
      
      // Add response message
      setMessages([...messages, { sender: 'bot', content: response.response }]);
      
      // Check if data preview is available
      if (response.response.status === 'TRANSFORMATION_READY') {
        // Navigate to preview page
        navigate('/preview', { state: { 
          preview: response.response.transformedSamples,
          code: response.response.code
        }});
      }
    } catch (err) {
      setError('Failed to confirm selection. Please try again.');
      console.error('Error confirming selection:', err);
    } finally {
      setLoading(false);
    }
  };
  
  const startNewSession = () => {
    setSessionId('');
    setMessages([]);
    setError(null);
  };
  
  return (
    <div className="chat-interface">
      <div className="chat-header">
        <h2>Data Correction Agent</h2>
        <button className="new-session-button" onClick={startNewSession}>
          New Session
        </button>
      </div>
      
      <div className="chat-messages">
        <MessageList messages={messages} />
        <div ref={messagesEndRef} />
      </div>
      
      {error && <div className="error-message">{error}</div>}
      
      <ChatInput onSendMessage={handleSendMessage} disabled={loading} />
      
      {showConfirmation && confirmationData && (
        <ConfirmationDialog
          data={confirmationData}
          onConfirm={handleConfirmSelection}
          onCancel={() => handleConfirmSelection(false)}
        />
      )}
    </div>
  );
};

export default ChatInterface;

// File: frontend/src/components/DataPreview.tsx
import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../contexts/SessionContext';
import CodeViewer from './CodeViewer';
import DataTable from './DataTable';
import { applyTransformation } from '../services/api';
import './DataPreview.css';

const DataPreview: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { sessionId } = useSession();
  
  const [activeTab, setActiveTab] = useState<'before' | 'after'>('before');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { preview, code } = location.state as any || { preview: [], code: {} };
  
  const handleApplyChanges = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await applyTransformation(sessionId, true);
      
      // Show success message
      alert(`Transformation applied successfully to ${result.result.results.reduce((sum: number, r: any) => sum + r.recordsChanged, 0)} records.`);
      
      // Go back to chat
      navigate('/');
    } catch (err) {
      setError('Failed to apply transformation. Please try again.');
      console.error('Error applying transformation:', err);
    } finally {
      setLoading(false);
    }
  };
  
  const handleCancel = async () => {
    try {
      await applyTransformation(sessionId, false);
    } catch (err) {
      console.error('Error cancelling transformation:', err);
    }
    
    navigate('/');
  };
  
  return (
    <div className="data-preview">
      <h2>Data Preview</h2>
      
      <div className="preview-tabs">
        <button
          className={`tab-button ${activeTab === 'before' ? 'active' : ''}`}
          onClick={() => setActiveTab('before')}
        >
          Before
        </button>
        <button
          className={`tab-button ${activeTab === 'after' ? 'active' : ''}`}
          onClick={() => setActiveTab('after')}
        >
          After
        </button>
      </div>
      
      <div className="preview-content">
        {preview.map((item: any, index: number) => (
          <div key={index} className="table-container">
            <h3>{item.tableName}</h3>
            <DataTable
              data={activeTab === 'before' ? item.original : item.transformed}
              tableName={item.tableName}
            />
            {activeTab === 'after' && (
              <div className="changes-summary">
                {item.changes} records will be modified
              </div>
            )}
          </div>
        ))}
      </div>
      
      <div className="code-section">
        <h3>Generated Code</h3>
        <div className="code-tabs">
          <button className="code-tab active">JavaScript</button>
          <button className="code-tab">Python</button>
        </div>
        <CodeViewer code={code.javascriptCode} language="javascript" />
      </div>
      
      {error && <div className="error-message">{error}</div>}
      
      <div className="action-buttons">
        <button
          className="primary-button"
          onClick={handleApplyChanges}
          disabled={loading}
        >
          {loading ? 'Applying...' : 'Apply Changes'}
        </button>
        <button
          className="secondary-button"
          onClick={handleCancel}
          disabled={loading}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default DataPreview;

// File: frontend/src/components/MessageList.tsx
import React from 'react';
import './MessageList.css';

interface Message {
  sender: 'user' | 'bot';
  content: any;
}

interface MessageListProps {
  messages: Message[];
}

const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  // Function to render content based on type
  const renderContent = (content: any) => {
    if (typeof content === 'string') {
      return <p>{content}</p>;
    }
    
    // If content is an object from the bot
    if (typeof content === 'object' && content !== null) {
      return (
        <div>
          <p>{content.message}</p>
          
          {content.relevantTablesColumns && (
            <div className="tables-info">
              <h4>Relevant Tables:</h4>
              <ul>
                {content.relevantTablesColumns.map((table: any, index: number) => (
                  <li key={index}>
                    <strong>{table.tableName}</strong> ({table.dataSet})
                    <p>{table.description}</p>
                    <div className="fields-list">
                      <strong>Fields:</strong> {table.fields.map((f: any) => f.fieldName).join(', ')}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {content.status === 'COMPLETED' && (
            <div className="completion-info">
              <h4>Transformation Complete</h4>
              <ul>
                {content.results.map((result: any, index: number) => (
                  <li key={index}>
                    <strong>{result.table}:</strong> {result.recordsChanged} of {result.recordsProcessed} records modified
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }
    
    // Fallback
    return <p>{JSON.stringify(content)}</p>;
  };
  
  return (
    <div className="message-list">
      {messages.length === 0 ? (
        <div className="welcome-message">
          <h3>Welcome to the Data Correction Agent</h3>
          <p>
            Start by describing what data you want to correct. For example:
          </p>
          <ul>
            <li>"Move all associates in Legal Entity ABC to office Location NYC"</li>
            <li>"Update paygroup from X to Y for all employees in department Z"</li>
            <li>"Change the job code for all positions in the Finance division to FIN123"</li>
          </ul>
        </div>
      ) : (
        messages.map((message, index) => (
          <div
            key={index}
            className={`message ${message.sender === 'user' ? 'user-message' : 'bot-message'}`}
          >
            <div className="message-content">{renderContent(message.content)}</div>
          </div>
        ))
      )}
    </div>
  );
};

export default MessageList;

// File: frontend/src/components/ChatInput.tsx
import React, { useState } from 'react';
import './ChatInput.css';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, disabled = false }) => {
  const [message, setMessage] = useState('');
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || disabled) return;
    
    onSendMessage(message);
    setMessage('');
  };
  
  return (
    <form className="chat-input" onSubmit={handleSubmit}>
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Type your data correction request..."
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !message.trim()}>
        {disabled ? 'Processing...' : 'Send'}
      </button>
    </form>
  );
};

export default ChatInput;

// File: frontend/src/components/ConfirmationDialog.tsx
import React, { useState } from 'react';
import './ConfirmationDialog.css';

interface ConfirmationDialogProps {
  data: any;
  onConfirm: (confirmed: boolean, tables?: string[]) => void;
  onCancel: () => void;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  data,
  onConfirm,
  onCancel
}) => {
  const [selectedTables, setSelectedTables] = useState<string[]>(
    data.relevantTablesColumns?.map((table: any) => table.tableName) || []
  );
  
  const handleTableChange = (tableName: string, checked: boolean) => {
    if (checked) {
      setSelectedTables([...selectedTables, tableName]);
    } else {
      setSelectedTables(selectedTables.filter(name => name !== tableName));
    }
  };
  
  const handleConfirm = () => {
    onConfirm(true, selectedTables);
  };
  
  return (
    <div className="confirmation-dialog-overlay">
      <div className="confirmation-dialog">
        <h3>Confirm Table Selection</h3>
        
        <p>{data.message}</p>
        
        <div className="table-selection">
          <h4>Select tables to use:</h4>
          {data.relevantTablesColumns?.map((table: any, index: number) => (
            <div key={index} className="table-option">
              <label>
                <input
                  type="checkbox"
                  checked={selectedTables.includes(table.tableName)}
                  onChange={(e) => handleTableChange(table.tableName, e.target.checked)}
                />
                {table.tableName} - {table.dataSet}
              </label>
              <p className="table-description">{table.description}</p>
            </div>
          ))}
        </div>
        
        <div className="dialog-buttons">
          <button className="primary-button" onClick={handleConfirm} disabled={selectedTables.length === 0}>
            Confirm
          </button>
          <button className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationDialog;
