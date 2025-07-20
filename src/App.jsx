import React, { useState, useEffect, useRef } from 'react';
import { Play, Settings, Database, Info, Bug, X, RefreshCw, Plus } from 'lucide-react';
import SqlEditor from './components/SqlEditor';
import ResultsDisplay from './components/ResultsDisplay';
import ExecutionHistory from './components/ExecutionHistory';
import SessionInfo from './components/SessionInfo';
import CatalogSidebar from './components/CatalogSidebar';
import { flinkApi, sessionManager } from './services/index.js';
import { useResizable } from './hooks/useResizable.js';

const DEFAULT_QUERY = `-- Welcome to Flink SQL Editor
-- Example queries to get you started:

-- Create a table from values
CREATE TABLE sample_data (
  name STRING,
  age INT,
  city STRING
) WITH (
  'connector' = 'values',
  'data-id' = 'sample'
);

-- Insert some data
INSERT INTO sample_data VALUES
  ('Alice', 25, 'New York'),
  ('Bob', 30, 'San Francisco'),
  ('Charlie', 35, 'London');

-- Query the data
SELECT name, age, city FROM sample_data WHERE age > 25;`;

function App() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [result, setResult] = useState(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [history, setHistory] = useState([]);
  const [flinkUrl, setFlinkUrl] = useState('http://localhost:8083');
  const [flinkInfo, setFlinkInfo] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(true); // Start with debug panel open
  const [showDebugLogs, setShowDebugLogs] = useState(false); // Hide logs by default
  const [debugLogs, setDebugLogs] = useState([]);
  const [activeBottomTab, setActiveBottomTab] = useState('history'); // 'history' or 'logs'
  
  // Resizable panels
  const sidebarResize = useResizable(240, 200, 400, 'vertical', 'sidebar');
  const editorPanelResize = useResizable(window.innerWidth * 0.4, 200, window.innerWidth * 0.7, 'vertical', 'editor-results');
  const bottomPanelResize = useResizable(200, 100, window.innerHeight * 0.5, 'horizontal');
  const [sessionInfo, setSessionInfo] = useState({
    sessionHandle: null,
    isActive: false,
    startTime: null,
    age: 0,
    properties: {}
  });
  
  // Ref to access SqlEditor methods
  const sqlEditorRef = useRef(null);

  // Capture console logs for debug panel
  useEffect(() => {
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = (...args) => {
      originalLog(...args);
      setDebugLogs(prev => [...prev.slice(-49), {
        type: 'log',
        message: args.join(' '),
        timestamp: new Date().toLocaleTimeString()
      }]);
    };
    
    console.error = (...args) => {
      originalError(...args);
      setDebugLogs(prev => [...prev.slice(-49), {
        type: 'error',
        message: args.join(' '),
        timestamp: new Date().toLocaleTimeString()
      }]);
    };
    
    return () => {
      console.log = originalLog;
      console.error = originalError;
    };
  }, []);

  // Set up session manager listener
  useEffect(() => {
    const handleSessionChange = (newSessionInfo) => {
      setSessionInfo(newSessionInfo);
    };

    sessionManager.addListener(handleSessionChange);
    
    // Initialize session info
    setSessionInfo(sessionManager.getSessionInfo());

    return () => {
      sessionManager.removeListener(handleSessionChange);
    };
  }, []);

  // Update session age every second
  useEffect(() => {
    const interval = setInterval(() => {
      if (sessionInfo.isActive) {
        setSessionInfo(prev => ({
          ...prev,
          age: prev.startTime ? Date.now() - prev.startTime : 0
        }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionInfo.isActive, sessionInfo.startTime]);

  // Load history from localStorage on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('flink-sql-history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (error) {
        console.error('Failed to load history:', error);
      }
    }
  }, []);

  // Save history to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('flink-sql-history', JSON.stringify(history));
  }, [history]);

  // Session management functions
  const handleRefreshSession = async () => {
    try {
      await sessionManager.refreshSession();
      console.log('✅ Session refreshed successfully');
    } catch (error) {
      console.error('❌ Failed to refresh session:', error);
    }
  };

  const handleCloseSession = async () => {
    try {
      await sessionManager.closeSession();
      console.log('✅ Session closed successfully');
    } catch (error) {
      console.error('❌ Failed to close session:', error);
    }
  };

  const handleNewSession = async () => {
    try {
      console.log('🆕 Starting new session...');
      await sessionManager.refreshSession(); // This closes current and creates new
      console.log('✅ New session started successfully');
    } catch (error) {
      console.error('❌ Failed to start new session:', error);
    }
  };

  // Test connection and get Flink info
  const testConnection = async (direct = false) => {
    console.log(`🔍 Testing connection ${direct ? 'DIRECT' : 'via PROXY'}...`);
    
    try {
      const originalUseProxy = flinkApi.useProxy;
      if (direct) {
        flinkApi.useProxy = false;
      }
      
      flinkApi.setBaseUrl(flinkUrl);
      const info = await flinkApi.getInfo();
      setFlinkInfo(info);
      
      flinkApi.useProxy = originalUseProxy;
      return true;
    } catch (error) {
      console.error('Connection test failed:', error);
      setFlinkInfo(null);
      return false;
    }
  };

  // Test both proxy and direct connections
  const testBothConnections = async () => {
    console.log('🔍 Testing both proxy and direct connections...');
    
    const proxyResult = await testConnection(false);
    console.log(`📊 Proxy connection: ${proxyResult ? '✅ SUCCESS' : '❌ FAILED'}`);
    
    const directResult = await testConnection(true);
    console.log(`📊 Direct connection: ${directResult ? '✅ SUCCESS' : '❌ FAILED'}`);
    
    if (!proxyResult && directResult) {
      console.log('💡 Direct works but proxy fails - this is a proxy configuration issue');
    } else if (proxyResult && !directResult) {
      console.log('💡 Proxy works but direct fails - this is expected due to CORS');
    } else if (!proxyResult && !directResult) {
      console.log('💡 Both failed - check if Flink SQL Gateway is running');
    }
  };

  // Test connection on URL change
  useEffect(() => {
    testConnection();
  }, [flinkUrl]);

  const executeSelectedQuery = async () => {
    if (!sqlEditorRef.current) {
      // Fallback to full query if ref not available
      return executeQuery();
    }
    
    const queryToExecute = sqlEditorRef.current.getQueryToExecute();
    console.log(`🎯 Execute button clicked - query to execute: "${queryToExecute.substring(0, 100)}${queryToExecute.length > 100 ? '...' : ''}"`);
    
    return executeQuery(queryToExecute);
  };

  const executeQuery = async (customQuery = null) => {
    const queryToExecute = customQuery || query.trim();
    
    if (!queryToExecute || isExecuting) return;

    console.log(`🚀 Starting execution of query: ${queryToExecute.length > 50 ? queryToExecute.substring(0, 50) + '...' : queryToExecute}`);
    
    setIsExecuting(true);
    setResult(null);

    const executionId = Date.now();
    const execution = {
      id: executionId,
      query: queryToExecute,
      timestamp: Date.now(),
      status: 'RUNNING'
    };

    // Add to history immediately
    setHistory(prev => [execution, ...prev.slice(0, 49)]); // Keep last 50 executions

    try {
      // Set Flink API base URL
      flinkApi.setBaseUrl(flinkUrl);
      
      // Use session manager for execution
      const result = await sessionManager.executeSQL(queryToExecute);
      
      setResult(result);
      
      // Update history with result
      setHistory(prev => prev.map(h => 
        h.id === executionId 
          ? { ...h, ...result, status: result.status }
          : h
      ));

      return result; // Return result for use by sidebar

    } catch (error) {
      console.error('❌ Query execution failed in App:', error);
      
      const errorResult = {
        status: 'ERROR',
        error: error.message,
        errorDetails: {
          message: error.message,
          type: error.name || 'Unknown',
          timestamp: new Date().toISOString(),
          stack: error.stack,
          query: queryToExecute.substring(0, 200) + (queryToExecute.length > 200 ? '...' : '')
        },
        results: [],
        columns: []
      };
      
      setResult(errorResult);
      
      // Update history with error
      setHistory(prev => prev.map(h => 
        h.id === executionId 
          ? { ...h, ...errorResult }
          : h
      ));

      return errorResult; // Return error result
    } finally {
      setIsExecuting(false);
    }
  };

  // Execute query for sidebar (silent - doesn't update main UI)
  const executeQueryForSidebar = async (queryToExecute, silent = false) => {
    if (!queryToExecute) return;

    console.log(`🔍 Sidebar executing: ${queryToExecute}`);
    
    try {
      // Set Flink API base URL
      flinkApi.setBaseUrl(flinkUrl);
      
      // Use session manager for execution
      const result = await sessionManager.executeSQL(queryToExecute);
      
      if (!silent) {
        // If not silent, update the main UI as well
        setResult(result);
        
        const executionId = Date.now();
        const execution = {
          id: executionId,
          query: queryToExecute,
          timestamp: Date.now(),
          ...result,
          status: result.status
        };
        
        setHistory(prev => [execution, ...prev.slice(0, 49)]);
      }
      
      return result;

    } catch (error) {
      console.error('❌ Sidebar query execution failed:', error);
      
      const errorResult = {
        status: 'ERROR',
        error: error.message,
        results: [],
        columns: []
      };
      
      return errorResult;
    }
  };

  const handleSelectExecution = (execution) => {
    setQuery(execution.query);
    setResult({
      status: execution.status,
      results: execution.results || [],
      columns: execution.columns || [],
      error: execution.error,
      jobId: execution.jobId,
      resultKind: execution.resultKind
    });
  };

  const handleClearHistory = () => {
    setHistory([]);
    localStorage.removeItem('flink-sql-history');
  };

  const handleUrlChange = (e) => {
    setFlinkUrl(e.target.value);
  };

  return (
    <div className="app-layout">
      <header className="header">
        <div className="header-left">
          <Database className="w-8 h-8 text-blue-500 flex-shrink-0" />
          <div className="header-title-section">
            <h1>Flink SQL Editor</h1>
            <p className="header-subtitle">Interactive query editor for Apache Flink</p>
            <p className="header-user">@Avichay Marciano</p>
          </div>
        </div>
        
        <div className="header-right">
          {flinkInfo && (
            <div className="connection-status">
              <div className="connection-dot"></div>
              Connected to {flinkInfo.productName} {flinkInfo.version}
            </div>
          )}
          
          {/* Session Controls */}
          <div className="header-controls-group">
            <button
              onClick={handleNewSession}
              className="btn-success btn-compact"
              title="Start New Session (closes current session)"
            >
              <Plus className="w-4 h-4" />
              New Session
            </button>
            {sessionInfo.isActive && (
              <>
                <button
                  onClick={handleRefreshSession}
                  className="btn-primary btn-compact"
                  title="Refresh Session"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
                <button
                  onClick={handleCloseSession}
                  className="btn-danger btn-compact"
                  title="Close Session"
                >
                  <X className="w-4 h-4" />
                  Close
                </button>
              </>
            )}
          </div>
          
          {/* App Controls */}
          <div className="header-controls-group">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="btn-secondary"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="app-content">
        <div 
          className="catalog-sidebar"
          style={{ width: sidebarResize.size }}
        >
          <CatalogSidebar
            sessionInfo={sessionInfo}
            onExecuteQuery={executeQueryForSidebar}
            isExecuting={isExecuting}
          />
        </div>

        <div 
          className="resize-handle-vertical"
          onMouseDown={sidebarResize.startResize}
        ></div>
        <div className="main-area">
          {showSettings && (
            <div className="settings-panel">
              <div className="config-section">
                <label htmlFor="flink-url">Flink SQL Gateway URL:</label>
                <input
                  id="flink-url"
                  type="text"
                  value={flinkUrl}
                  onChange={handleUrlChange}
                  placeholder="http://localhost:8083"
                />
                <button onClick={testConnection} className="btn-primary">
                  Test Connection
                </button>
              </div>
              {!flinkInfo && (
                <p className="text-sm text-red-400 mt-4 flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Unable to connect to Flink SQL Gateway.
                </p>
              )}
            </div>
          )}

          <div className="main-content resizable-container">
            <div 
              className="editor-panel resizable-panel-left"
              style={{ width: editorPanelResize.size }}
            >
              <div className="panel-header">
                <h2>SQL Query</h2>
                <button
                  onClick={executeSelectedQuery}
                  disabled={isExecuting || !query.trim()}
                  className="btn-primary"
                >
                  <Play className="w-4 h-4" />
                  {isExecuting ? 'Executing...' : 'Execute'}
                </button>
              </div>
              <div className="panel-content">
                <SqlEditor
                  ref={sqlEditorRef}
                  value={query}
                  onChange={setQuery}
                  onExecute={executeSelectedQuery}
                  isExecuting={isExecuting}
                />
              </div>
            </div>

            <div 
              className="resize-handle-vertical"
              onMouseDown={editorPanelResize.startResize}
            ></div>

            <div className="results-panel resizable-panel-right">
              <div className="panel-header">
                <h2>Results</h2>
                {result && result.status === 'FINISHED' && result.results && (
                  <span className="text-sm text-gray-400">
                    {result.results.length} row{result.results.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="panel-content">
                <ResultsDisplay result={result} isExecuting={isExecuting} />
              </div>
            </div>
          </div>

          {/* Horizontal Resize Handle */}
          <div 
            className="resize-handle-horizontal"
            onMouseDown={bottomPanelResize.startResize}
          ></div>

          {/* VS Code Bottom Panel */}
          <div 
            className="bottom-panel"
            style={{ height: bottomPanelResize.size }}
          >
            <div className="bottom-panel-header">
              <div className="bottom-panel-tabs">
                <button 
                  className={`bottom-tab ${activeBottomTab === 'history' ? 'active' : ''}`}
                  onClick={() => setActiveBottomTab('history')}
                >
                  History
                </button>
                <button 
                  className={`bottom-tab ${activeBottomTab === 'logs' ? 'active' : ''}`}
                  onClick={() => setActiveBottomTab('logs')}
                >
                  Debug Logs
                </button>
              </div>
              <button
                onClick={activeBottomTab === 'history' ? handleClearHistory : () => setDebugLogs([])}
                className="btn-secondary"
                title={activeBottomTab === 'history' ? 'Clear History' : 'Clear Logs'}
              >
                Clear
              </button>
            </div>
            <div className="bottom-panel-content">
              {activeBottomTab === 'history' ? (
                <ExecutionHistory
                  history={history}
                  onSelectExecution={handleSelectExecution}
                  onClearHistory={handleClearHistory}
                />
              ) : (
                <div className="debug-logs">
                  {debugLogs.length === 0 ? (
                    <div style={{ color: 'var(--vscode-text-secondary)', padding: '8px' }}>
                      No debug logs yet...
                    </div>
                  ) : (
                    debugLogs.map((log, index) => (
                      <div key={index} style={{ marginBottom: '4px' }}>
                        <span style={{ color: 'var(--vscode-text-secondary)' }}>
                          [{log.timestamp}]
                        </span>{' '}
                        <span style={{ color: log.type === 'error' ? 'var(--vscode-red)' : 'var(--vscode-green)' }}>
                          {log.message}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
