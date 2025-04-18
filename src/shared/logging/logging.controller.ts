import { Controller, Get, Query, Res, Post } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { LoggingService } from './logging.service';
import { LogType } from './types/logging.types';

@Controller('logger')
export class LoggingController {
  constructor(
    private readonly loggingService: LoggingService,
  ) {}

  private getHtmlTemplate(activeTab: 'logs' | 'events' = 'logs'): string {
    return `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Logging Dashboard</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 20px; }
        h1 { margin: 0 0 20px; color: #333; text-align: center; }
        .tabs { display: flex; gap: 10px; margin-bottom: 20px; justify-content: center; }
        .tab { padding: 10px 20px; cursor: pointer; border: none; background: #f0f0f0; border-radius: 4px; font-size: 14px; text-decoration: none; color: #333; }
        .tab.active { background: #2196F3; color: white; }
        .controls { display: flex; gap: 10px; margin-bottom: 20px; justify-content: center; align-items: center; flex-wrap: wrap; }
        select { padding: 8px; border: 1px solid #ddd; border-radius: 4px; min-width: 150px; }
        button { padding: 8px 16px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        button.danger { background: #dc3545; }
        button.danger:hover { background: #c82333; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .entry { background: #fff; border: 1px solid #eee; border-radius: 4px; padding: 15px; margin-bottom: 10px; }
        .timestamp { color: #666; font-size: 12px; }
        .level { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 12px; margin-left: 8px; }
        .level.INFO { background: #E3F2FD; color: #1976D2; }
        .level.WARN { background: #FFF3E0; color: #F57C00; }
        .level.ERROR { background: #FFEBEE; color: #D32F2F; }
        .level.DEBUG { background: #E8F5E9; color: #388E3C; }
        .type { display: inline-block; padding: 2px 6px; background: #f0f0f0; border-radius: 3px; font-size: 12px; margin-left: 8px; }
        .message { margin: 10px 0; }
        .metadata { background: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 12px; white-space: pre-wrap; }
        .empty-state { text-align: center; padding: 40px; color: #666; }
        .refresh-status { font-size: 12px; color: #666; margin-left: 10px; }
        .button-group { display: flex; gap: 10px; }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .loading {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid #f3f3f3;
          border-top: 2px solid #2196F3;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-right: 8px;
          vertical-align: middle;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Logging Dashboard</h1>
        <div class="tabs">
          <a href="/logger/logs" class="tab ${activeTab === 'logs' ? 'active' : ''}">Logs</a>
          <a href="/logger/events" class="tab ${activeTab === 'events' ? 'active' : ''}">Events</a>
        </div>
        
        <div id="logs" class="tab-content ${activeTab === 'logs' ? 'active' : ''}">
          <div class="controls">
            <select id="logType">
              <option value="">All Types</option>
              <option value="SYSTEM">System</option>
              <option value="USER">User</option>
              <option value="AUTH">Auth</option>
              <option value="SECURITY">Security</option>
              <option value="ERROR">Error</option>
            </select>
            <select id="logLevel">
              <option value="">All Levels</option>
              <option value="INFO">Info</option>
              <option value="WARN">Warning</option>
              <option value="ERROR">Error</option>
              <option value="DEBUG">Debug</option>
            </select>
            <div class="button-group">
              <button id="refreshButton" onclick="manualRefresh()">Refresh</button>
              <button id="clearLogsButton" class="danger" onclick="clearLogs()">Clear Logs</button>
            </div>
            <span id="refreshStatus" class="refresh-status"></span>
          </div>
          <div id="logsContent"></div>
        </div>
        
        <div id="events" class="tab-content ${activeTab === 'events' ? 'active' : ''}">
          <div class="controls">
            <select id="eventType">
              <option value="">All Types</option>
              <option value="user.loggedIn">User Logged In</option>
              <option value="user.registered">User Registered</option>
              <option value="clinic.created">Clinic Created</option>
              <option value="clinic.updated">Clinic Updated</option>
              <option value="clinic.deleted">Clinic Deleted</option>
            </select>
            <div class="button-group">
              <button id="eventRefreshButton" onclick="manualRefresh()">Refresh</button>
              <button id="clearEventsButton" class="danger" onclick="clearEvents()">Clear Events</button>
            </div>
            <span id="eventRefreshStatus" class="refresh-status"></span>
          </div>
          <div id="eventsContent"></div>
        </div>
      </div>
      
      <script>
        let currentTab = '${activeTab}';
        let refreshInterval;
        let isRefreshing = false;
        const REFRESH_INTERVAL = 5000; // 5 seconds

        function updateRefreshStatus(isLoading) {
          const statusElement = document.getElementById(currentTab === 'logs' ? 'refreshStatus' : 'eventRefreshStatus');
          const refreshButton = document.getElementById(currentTab === 'logs' ? 'refreshButton' : 'eventRefreshButton');
          
          if (isLoading) {
            statusElement.innerHTML = '<span class="loading"></span>Refreshing...';
            refreshButton.disabled = true;
          } else {
            const currentTime = new Date().toLocaleTimeString();
            statusElement.innerHTML = 'Last updated: ' + currentTime;
            refreshButton.disabled = false;
          }
        }

        async function clearLogs() {
          if (!confirm('Are you sure you want to clear all logs?')) return;
          
          try {
            const response = await fetch('/logger/logs/clear', { method: 'POST' });
            if (!response.ok) throw new Error('Failed to clear logs');
            refreshContent();
          } catch (error) {
            console.error('Error clearing logs:', error);
            alert('Failed to clear logs');
          }
        }

        async function clearEvents() {
          if (!confirm('Are you sure you want to clear all events?')) return;
          
          try {
            const response = await fetch('/logger/events/clear', { method: 'POST' });
            if (!response.ok) throw new Error('Failed to clear events');
            refreshContent();
          } catch (error) {
            console.error('Error clearing events:', error);
            alert('Failed to clear events');
          }
        }

        async function refreshContent() {
          if (isRefreshing) return;
          isRefreshing = true;
          
          updateRefreshStatus(true);
          const contentId = currentTab === 'logs' ? 'logsContent' : 'eventsContent';
          const container = document.getElementById(contentId);
          
          try {
            let url = '/logger/' + currentTab + '/data';
            const params = new URLSearchParams();
            
            if (currentTab === 'logs') {
              const type = document.getElementById('logType').value;
              const level = document.getElementById('logLevel').value;
              if (type) params.append('type', type);
              if (level) params.append('level', level);
            } else {
              const type = document.getElementById('eventType').value;
              if (type) params.append('type', type);
            }
            
            if (params.toString()) {
              url += '?' + params.toString();
            }

            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch data');
            
            const data = await response.json();
            if (!data || data.length === 0) {
              container.innerHTML = '<div class="empty-state">No data found</div>';
              return;
            }

            if (currentTab === 'logs') {
              container.innerHTML = data.map(log => \`
                <div class="entry">
                  <span class="timestamp">\${new Date(log.timestamp).toLocaleString()}</span>
                  <span class="level \${log.level}">\${log.level}</span>
                  <span class="type">\${log.type}</span>
                  <div class="message">\${log.message}</div>
                  <div class="metadata">\${JSON.stringify(log.metadata, null, 2)}</div>
                </div>
              \`).join('');
            } else {
              container.innerHTML = data.map(event => \`
                <div class="entry">
                  <span class="timestamp">\${new Date(event.timestamp).toLocaleString()}</span>
                  <span class="type">\${event.type}</span>
                  <div class="metadata">\${JSON.stringify(event.payload, null, 2)}</div>
                </div>
              \`).join('');
            }
          } catch (error) {
            console.error('Error:', error);
            container.innerHTML = '<div class="empty-state">Error loading data</div>';
          } finally {
            isRefreshing = false;
            updateRefreshStatus(false);
          }
        }

        function manualRefresh() {
          clearInterval(refreshInterval);
          refreshContent();
          startAutoRefresh();
        }

        function startAutoRefresh() {
          if (refreshInterval) {
            clearInterval(refreshInterval);
          }
          refreshInterval = setInterval(refreshContent, REFRESH_INTERVAL);
        }

        // Initial load
        refreshContent();
        startAutoRefresh();

        // Cleanup on page unload
        window.addEventListener('unload', () => {
          if (refreshInterval) {
            clearInterval(refreshInterval);
          }
        });

        // Add click handlers for tabs
        document.querySelectorAll('.tab').forEach(tab => {
          tab.addEventListener('click', (e) => {
            e.preventDefault();
            const isLogs = e.target.href.includes('logs');
            currentTab = isLogs ? 'logs' : 'events';
            
            // Update tab active states
            document.querySelectorAll('.tab').forEach(t => {
              t.classList.remove('active');
            });
            e.target.classList.add('active');
            
            // Update content visibility
            document.querySelectorAll('.tab-content').forEach(content => {
              content.classList.remove('active');
            });
            document.getElementById(currentTab).classList.add('active');
            
            refreshContent();
          });
        });

        // Add change handlers for filters
        document.getElementById('logType').addEventListener('change', manualRefresh);
        document.getElementById('logLevel').addEventListener('change', manualRefresh);
        document.getElementById('eventType').addEventListener('change', manualRefresh);
      </script>
    </body>
    </html>`;
  }

  @Get()
  async getUI(@Res() reply: FastifyReply) {
    reply.header('Content-Type', 'text/html');
    return reply.send(this.getHtmlTemplate('logs'));
  }

  @Get('logs')
  async getLogsPage(@Res() reply: FastifyReply) {
    reply.header('Content-Type', 'text/html');
    return reply.send(this.getHtmlTemplate('logs'));
  }

  @Get('events')
  async getEventsPage(@Res() reply: FastifyReply) {
    reply.header('Content-Type', 'text/html');
    return reply.send(this.getHtmlTemplate('events'));
  }

  @Get('logs/data')
  async getLogs(
    @Query('type') type?: LogType,
    @Query('level') level?: string,
  ) {
    return this.loggingService.getLogs(type, undefined, undefined, level);
  }

  @Get('events/data')
  async getEvents(
    @Query('type') type?: string,
  ) {
    return this.loggingService.getEvents(type);
  }

  @Post('logs/clear')
  async clearLogs() {
    return this.loggingService.clearLogs();
  }

  @Post('events/clear')
  async clearEvents() {
    return this.loggingService.clearEvents();
  }
} 